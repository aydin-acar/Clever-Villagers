// ============================================================
// Clever Villagers (Regrowth for Bedrock) — engine.js
// Runtime bootstrap + main heartbeat loop.
//
// Some Bedrock builds discard event subscriptions and interval
// schedules that were created during the early startup phase,
// which leaves commands working but the simulation dead.
// Therefore everything runtime-related is (re)initialized
// idempotently from a NORMAL-mode task, and every custom command
// callback pokes ensureRuntime() so the engine self-heals on the
// first /cv:* command of a session.
// ============================================================
import { world, system } from "@minecraft/server";
import { getConfig, loadConfig, loadStats, saveStats, flushIfDirty } from "./config.js";
import { initGui } from "./gui.js";
import { initCv2 } from "./cv/bootstrap.js";
import { economyLastTick } from "./cv/core/scheduler.js";
import { villagerWork } from "./villagers.js";
import { MOB_ACTIONS, mobTick } from "./mobs.js";
import * as J from "./jobs.js";
import * as W from "./walls.js";
import * as L from "./lighting.js";
import * as U from "./util.js";
import * as VV from "./cv/core/village.js";

let bootstrapped = false;
let loopStarted = false;
let eventsSubscribed = false;
let cycle = 0;
let lastEconHeal = 0;
let lastDispatchRun = -1000;
let lastSteerHeal = 0;

export function isBootstrapped() { return bootstrapped && loopStarted; }

// ---------- loop ----------
function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  try {
    system.runInterval(() => {
      try { mainLoop(); } catch (e) { console.error("[CV] loop error: " + e); }
    }, 20);
    console.warn("[CV] runInterval scheduled.");
  } catch (e) {
    console.error("[CV] runInterval failed: " + e);
  }
  // redundant self-rescheduling chain: takes over if the interval dies
  try {
    const chain = () => {
      try {
        if (U.lastLoopTick < system.currentTick - 60) mainLoop(); // interval appears dead
      } catch (e) { /* ignore */ }
      try { system.runTimeout(chain, 20); } catch (e) { /* ignore */ }
    };
    system.runTimeout(chain, 21);
  } catch (e) { /* ignore */ }
}

// ---------- events ----------
function subscribeRuntimeEvents() {
  if (eventsSubscribed) return;
  eventsSubscribed = true;
  try {
    world.afterEvents.worldLoad.subscribe(() => {
      try {
        loadConfig();
        loadStats();
        startLoop();
        const cfg = getConfig();
        world.sendMessage(`§a§lClever Villagers§r §7(Clever Villagers) yüklendi — durum: ${cfg.enabled ? "§açalışıyor" : "§cduraklatılmış"}§7 · §e/cv:help`);
      } catch (e) { console.error("[CV] worldLoad handler error: " + e); }
    });
  } catch (e) { /* ignore */ }
  try {
    world.afterEvents.playerJoin.subscribe(() => { startLoop(); });
  } catch (e) { /* ignore */ }
  try { initGui(); } catch (e) { /* ignore */ }
  try { initCv2(); } catch (e) { console.error("[CV] bootstrap failed: " + e); }
}

// ---------- idempotent bootstrap; safe to call from anywhere ----------
export function ensureRuntime() {
  if (bootstrapped) {
    if (!loopStarted) startLoop(); // heal if only half-alive
    return;
  }
  bootstrapped = true;
  try {
    // defer into normal execution mode (works even when called from
    // restricted contexts such as custom command callbacks)
    system.run(() => {
      startLoop();
      subscribeRuntimeEvents();
    });
  } catch (e) {
    try { startLoop(); subscribeRuntimeEvents(); } catch (e2) {
      console.error("[CV] bootstrap failed: " + e2);
    }
  }
}

// v2.6.0 KILLER BUG FIX: the old "early boost pass" lived in a
// module-load runInterval and called J.dispatch() WITHOUT importing
// jobs.js. The ReferenceError was swallowed by the inner try/catch, so
// the workforce dispatcher (orders/fetch-work-deliver, walls, roads,
// zones) silently never ran: dispatch last=-1, orders stuck "ready".
// Both the boost pass and the dispatcher now live in mainLoop(), which
// is self-healing (startLoop + timeout chain + ensureRuntime poke).

// ---------- main heartbeat ----------
function mainLoop() {
  const cfg = getConfig();
  U.beat(system.currentTick);
  if (!cfg.enabled) return;
  cycle++;
  U.resetBudget();
  const tick = system.currentTick;
  const half = cycle % 2; // Regrowth alternating-entities trick

  const dims = [world.getDimension("overworld")];
  if (!cfg.onlyOverworld) {
    try {
      dims.push(world.getDimension("nether"));
      dims.push(world.getDimension("the_end"));
    } catch (e) { /* ignore */ }
  }

  for (const dim of dims) {
    // ----- villagers -----
    const villagerCycles = Math.max(1, Math.round(cfg.workIntervalTicks / 20));
    if (cycle % villagerCycles === 0) {
      let villagers = [];
      for (const t of ["minecraft:villager_v2", "minecraft:villager"]) {
        try { villagers = villagers.concat(dim.getEntities({ type: t })); } catch (e) { /* ignore */ }
      }
      villagers = villagers.filter(U.isValidEntity).filter(e => !U.isBaby(e)); // v2.9.0: no child labor
      let processed = 0;
      for (let i = 0; i < villagers.length && processed < 32; i++) {
        const e = villagers[i];
        if (U.hashId(e.id) % 2 !== half) continue; // process half per cycle
        processed++;
        try {
          villagerWork(e, dim, tick, false);
        } catch (err) {
          U.debug(1, "villager error: " + err);
        }
        if (U.changeBudget <= 0) break;
      }
      if (processed > 0) U.debug(1, `villagers processed: ${processed}/${villagers.length}`);
    }

    // ----- animals & monsters -----
    if (cfg.mobsEnabled) {
      let mobCount = 0;
      for (const def of MOB_ACTIONS) {
        if (mobCount >= 48 || U.changeBudget <= 0) break;
        let ents;
        try { ents = dim.getEntities({ type: def.type }); } catch (e) { continue; }
        for (const e of ents) {
          if (mobCount >= 48) break;
          if (!U.isValidEntity(e)) continue;
          if (U.hashId(e.id) % 2 !== half) continue;
          mobCount++;
          try {
            mobTick(e, dim, tick, def.action, def.seconds);
          } catch (err) {
            U.debug(1, "mob error (" + def.type + "): " + err);
          }
        }
      }
    }
  }

  // ----- slow tasks -----
  const ow = world.getDimension("overworld");
  // v2.6.0: workforce dispatcher (single impulse owner) now runs HERE,
  // in the self-healing loop: orders (fetch/work/deliver) + wall/road/
  // light + farm + forest/quarry zones all hang off J.dispatch.
  // v2.8.0 KILLER BUG (user: "kayıt+yeniden girişte siparişler ready
  // kalıyor, mod yüklenmemiş gibi"): the gate was `tick % 20 === 0`, but
  // the 20t heartbeat lands on a FIXED tick offset per session. After a
  // save+reload that offset is non-zero => the gate NEVER fired =>
  // dispatch last=-1, no assigns, no nametags, orders frozen "ready"
  // while /info still showed a live loop. Accumulator gate is offset-safe.
  if (tick - lastDispatchRun >= 20) {
    lastDispatchRun = tick;
    let bells = W.getBells();
    if (!bells.length) {
      // v2.8.0: villages survived the reload but the bell list did not
      // => restore bells from the persisted village registry so the
      // dispatcher self-heals without any command from the player.
      for (const vv of VV.all()) {
        try { if (vv.bell) W.addBell(vv.bell.x, vv.bell.y, vv.bell.z); } catch (e) { /* ignore */ }
      }
      bells = W.getBells();
      if (bells.length) console.warn(`[CV] çan listesi köy kaydından geri yüklendi (${bells.length})`);
    }
    for (const b of bells) {
      try { J.dispatch(ow, b, tick); } catch (e) { /* ignore */ }
    }
  }
  // v2.8.0: smooth-steer interval self-heal (intervals can be discarded)
  if (tick - lastSteerHeal > 240) {
    lastSteerHeal = tick;
    try { J.healSteer(); } catch (e) { /* ignore */ }
  }
  // v2.6.0: economy heartbeat self-heal (interval can be discarded by
  // some builds; initCv2's `started` flag used to block re-arming)
  if (tick - economyLastTick() > 100 && tick - lastEconHeal > 600) {
    lastEconHeal = tick;
    try {
      initCv2(true);
      console.warn("[CV] ekonomi döngüsü cansızdı → yeniden kuruldu (v2.6.0 self-heal)");
    } catch (e) { /* ignore */ }
  }
  try { W.scanSlice(ow); W.scanSlice(ow); W.scanSlice(ow); } catch (e) { /* ignore */ } // chunked village mapping (3 slices/cycle)
  // v2.5.3: job-site -> workshop sync (catches maps that finished before
  // /cv:setup existed, and new job blocks built since the last scan)
  if (tick % 600 < 20) {
    for (const b of W.getBells()) {
      try { W.syncWorkshopsFromMap(ow, b); } catch (e) { /* ignore */ }
    }
  }
  try { W.boundsTick(ow); } catch (e) { /* ignore */ }                  // particle frame of detected border
  try { L.lightingPass(ow, tick); } catch (e) { /* ignore */ }          // deterministic village lighting
  if (tick % 1200 < 20) {
    try { W.repairPatrol(world.getDimension("overworld")); } catch (e) { /* ignore */ }
  }
  if (tick % 1200 < 20) {
    flushIfDirty();
    try { saveStats(); } catch (e) { /* ignore */ }
  }
}
