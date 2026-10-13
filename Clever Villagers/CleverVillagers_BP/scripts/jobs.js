// ============================================================
// cv-adjacent jobs.js — village workforce dispatcher (27.09 user spec)
//
// "Bir köylü bir işe atanır, hava kararana dek EN YAKININDAKI işleri
//  zincirleme yapar." Öncelik: sipariş(üz.) > duvar > yol > ışık.
//
// v2.11.0 HAREKET MODELİ — "KAMPYOLU" (user: "vanilla'nın zaten köylüyü
// göreve götüren sistemi var; ikinci bir yürüme sistemi yazma, çakışıyor.
// Köylüye vanilla'daki gibi bir hedef ver, doğal yoldan ilerlesin."):
// The script NEVER moves a villager (no walker, no hops, no impulses).
// Movement = vanilla POI schedule: the addon places job-site GOAL blocks
// (cv/core/anchor.js — camps in zones, side anchors at non-POI workshops),
// an unemployed villager claims one, and vanilla pathfinding walks it
// there every work slot (tod 0–2000 & 10000–11000); noon it goes to the
// bell, evening to its bed. The dispatcher only hands out jobs the worker
// can do WHERE VANILLA ALREADY TAKES IT, and does the block/container ops
// when the worker is physically present. The 4t loop is a pure monitor:
// presence binding, ground-loot pickup, labels — nothing else.
// ============================================================
import { world, system } from "@minecraft/server";
import { getConfig, stats } from "./config.js";
import * as D from "./cv/core/depot.js";
import * as CU from "./cv/core/container_utils.js";
import * as B from "./cv/integration_construction_bridge.js";
import * as LG from "./cv/core/ledger.js";
import * as U from "./util.js";
import * as W from "./walls.js";
import * as R from "./roads.js";
import * as L from "./lighting.js";
import * as P from "./cv/core/production.js";
import * as OD from "./cv/core/order.js";
import { professionOf, setProfTag, profTag, clearProfTag, markerTypesFor, stationNearby } from "./villagers.js";
import * as LOG from "./log.js";
import { BlockPermutation } from "@minecraft/server";
import * as V from "./cv/core/village.js";
import * as WS from "./cv/core/workshop.js";
import * as PATH from "./cv/core/path.js";
import * as ANCHOR from "./cv/core/anchor.js";

const assigns = new Map(); // villagerId -> { type, x, z, since, ent }
const noGo = new Map();    // v2.9.0: villagerId -> { x, z, until } (given-up job point)
const roadJobs = { list: [], refresh: 0, cursor: 0, rectKey: "" };
let lightStarved = 0;      // v2.8.0: last tick the construction depot had no torch
const mealRetry = new Map(); // v2.8.0: villagerId -> meal-errand retry cooldown
let farmGapWarn = 0;       // v2.9.0: rate-limited "no farmer" warning
let profWatchCursor = 0;   // v2.9.0: one tagged villager per pass (cheap)
const LIGHT_CAP = 2;       // v2.9.0: max concurrent torch errands (was: everyone)

function awakeVillagers(dim, bell, radius) {
  let vs = [];
  try {
    for (const t of ["minecraft:villager_v2", "minecraft:villager"]) {
      vs = vs.concat(dim.getEntities({ type: t, location: bell, maxDistance: radius }));
    }
  } catch (e) { return []; }
  // v2.9.0: children are NOT part of the workforce — no errands, no
  // conversions, no meals-for-work, nothing (user rule 12.10).
  return vs.filter(U.isValidEntity).filter(e => !U.isBaby(e)).filter(e => {
    try { return !e.isSleeping; } catch (err) { return true; }
  });
}

// incremental damaged-road discovery inside the village core
function refreshRoadJobs(dim, bell, tick) {
  const rect = W.coreRectOf(bell);
  if (!rect) { roadJobs.list = []; return; }
  const key = `${rect.minX},${rect.maxX},${rect.minZ},${rect.maxZ}`;
  if (key !== roadJobs.rectKey) { roadJobs.rectKey = key; roadJobs.cursor = 0; roadJobs.list = []; }
  if (tick - roadJobs.refresh < 240 && roadJobs.cursor === 0) return;
  roadJobs.refresh = tick;
  // prune fixed jobs
  roadJobs.list = roadJobs.list.filter(j => R.columnDamaged(dim, j.x, j.z, bell.y));
  let budget = 500;
  const width = rect.maxX - rect.minX + 1;
  const height = rect.maxZ - rect.minZ + 1;
  const total = width * height;
  for (let n = 0; n < budget; n++) {
    const i = roadJobs.cursor % total;
    roadJobs.cursor = (roadJobs.cursor + 2) % total; // step 2: every other column
    const x = rect.minX + (i % width);
    const z = rect.minZ + Math.floor(i / width);
    if (roadJobs.list.length >= 80) break;
    const d = R.columnDamaged(dim, x, z, bell.y);
    if (d && !roadJobs.list.some(j => j.x === x && j.z === z)) roadJobs.list.push({ x, z, y: d.y });
  }
}

const ACTIONABLE = ["ready", "waiting_materials", "waiting_food", "waiting_fuel", "waiting_workshop", "in_progress"];
// v2.7.0: visible intent — a working villager wears its current task so
// the player sees "going to work", not "being shoved around".
const JOB_TAGS = {
  order: "§6Sipariş taşıyor", farm: "§2Tarla işi", forest: "§2Odun kesiyor",
  quarry: "§8Madende", sweep: "§6Fırın topluyor", wall: "§7Duvar örüyor",
  road: "§7Yol yapıyor", light: "§eFener dikiyor",
  deposit: "§6Depoya boşaltıyor", meal: "§cYemek yiyor"
};
const JOB_TAG_SET = new Set(Object.values(JOB_TAGS)); // v2.10.0 label watchdog
// v2.7.0 (user rule 29.09): profession names == workshop types (see
// villagers.js). NO translation table — a "smelter" order belongs to a
// "smelter" professional, period. Unemployed villagers only step in for
// professions nobody has (and get converted via a persistent tag).

function actionableTypes(v) {
  const set = new Set();
  for (const od of (v.orders || [])) if (ACTIONABLE.includes(od.status)) set.add(od.workshopType);
  return set;
}

function orderTargetFor(dim, v, bell, vl, tick, wantType) {
  for (const w of WS.list(v)) {
    if (!WS.isValid(dim, v, w)) continue; // v2.5.3: WS=workshop (W=walls! alias bug killed the dispatcher)
    if (wantType && w.type !== wantType) continue;
    const has = (v.orders || []).some(od => ACTIONABLE.includes(od.status) && od.workshopType === w.type);
    if (!has) continue;
    let cy = P.getActive(v, w);
    if (!cy && has) { P.startCycle(dim, v, w, tick); cy = P.getActive(v, w); }
    if (!cy) continue;
    const t = P.legTarget(dim, v, cy);
    if (t && Math.max(Math.abs(t.x - vl.x), Math.abs(t.z - vl.z)) <= 96) return { t, wid: w.id };
  }
  return undefined;
}

// v2.7.0 (user rule 29.09, birebir):
//   * a professional ONLY serves: own profession's order > own inherent
//     production (farmer->fields) > sweep/zone errands > village infra.
//     A farmer harvesting fields will NEVER carry ore to the smelter.
//   * an UNEMPLOYED villager serves orders of professions that NO awake
//     villager holds — and is CONVERTED to that profession (persistent
//     tag) the moment it takes the job.
//   * nobody else is ever dragged into a foreign order.
function pickJob(dim, bell, vl, tick, cfg, prof, ctx) {
  try {
  const v = V.get(`${bell.x},${bell.y},${bell.z}`);
  if (!v) return undefined;
  ctx = ctx || {};
  const profCounts = ctx.profCounts || new Map();
  // (0) threat slot — reserved for future combat/flee cycle
  // (0.5) v2.8.0 MEAL ERRAND: a hungry villager walks to the food depot
  //       and eats ONE item (stamina model) before taking new work.
  //       v2.11.0: food IN THE PACK is eaten first (a camp worker far
  //       from the depot cannot commute mid-slot — movement is vanilla
  //       now, so no meal may ever depend on scripted walking).
  if (ctx.entity && U.energyOf(ctx.entity) <= U.MEAL_HUNGER) {
    if (!eatFromPack(dim, v, ctx.entity, tick) && (mealRetry.get(ctx.entity.id) || 0) <= tick) {
      if (ctx.mealOk === undefined) ctx.mealOk = !!foodDepotHasMeal(v);
      if (ctx.mealOk) {
        const mb = depotBlockFor(dim, v, ["food", "warehouse"]);
        if (mb) return { type: "meal", x: mb.x, z: mb.z, since: tick };
      }
    }
  }
  // (1) OWN profession's order first
  if (prof) {
    const mine = orderTargetFor(dim, v, bell, vl, tick, prof);
    if (mine) return { type: "order", x: mine.t.x, z: mine.t.z, since: tick, wid: mine.wid };
  }
  // (2) own inherent production: farmer -> fields.
  // v2.9.0 USER RULE (12.10, "bu kısım çok önemli"): farm work belongs
  // to FARMERS ONLY. No farmer in the crew? ONE unemployed villager is
  // assigned AND CONVERTED to farmer (persistent tag). Professionals of
  // other trades are NEVER dragged into the fields. No farmer AND no
  // unemployed? The player gets a rate-limited warning: break/remove a
  // job station so a villager falls into the unemployed pool (the
  // profWatchdog below then retargets them to the new station).
  if (cfg.farmJobs !== false && (prof === "farmer" || !prof)) {
    const farmers = profCounts.get("farmer") || 0;
    if (prof === "farmer" || farmers === 0) {
      refreshFarmJobs(dim, bell, tick);
      // v2.11.0: LOCAL-ONLY. Movement is vanilla now: a farmer works the
      // plots around the composter IT CLAIMED (vanilla farmer commute +
      // vanilla farming AI). A plot 60 blocks away would be an assign
      // nobody can ever arrive at — so jobs are picked within reach.
      let best, bd = 10;
      const ng = ctx.entity ? noGo.get(ctx.entity.id) : undefined;
      for (const j of farmJobs.list) {
        if (ng && tick < ng.until && Math.max(Math.abs(j.x - ng.x), Math.abs(j.z - ng.z)) <= 4) continue;
        const d = Math.max(Math.abs(j.x - vl.x), Math.abs(j.z - vl.z));
        if (d < bd) { bd = d; best = j; }
      }
      if (best) {
        if (!prof && ctx.entity) {
          setProfTag(ctx.entity, "farmer");
          profCounts.set("farmer", (profCounts.get("farmer") || 0) + 1);
          jobsStats.converted = (jobsStats.converted || 0) + 1;
          LOG.info("[CV] mesleksiz köylü çiftçiliğe atandı (tarla işi, başka çiftçi yok)");
          try { world.sendMessage("§a[CV]§7 Çiftçi olmadığı için mesleksiz bir köylü §fçiftçi§7 olarak atandı."); } catch (e) { /* ignore */ }
        }
        return { type: "farm", x: best.x, z: best.z, y: best.y, since: tick };
      }
    }
  }
  // (2.5) machine output sweep (player-smelted / real-smelt leftovers)
  let outs = [];
  try { outs = P.machineOutputs(dim, v); } catch (e) { outs = []; }
  if (outs.length) {
    let best, bd = 24; // v2.11.0: sweep happens where vanilla takes the worker
    for (const o of outs) {
      const d = Math.max(Math.abs(o.x - vl.x), Math.abs(o.z - vl.z));
      if (d < bd) { bd = d; best = o; }
    }
    if (best) return { type: "sweep", x: best.x, z: best.z, since: tick, wid: best.wid };
  }
  // (2.7) zone work: forest & quarry — v2.11.0 CAMP MODEL.
  // Nobody is steered anymore: the zone gets a JOB-SITE CAMP (composter /
  // stonecutter, addon-owned). An unemployed villager claims it and VANILLA
  // walks it there every work slot. Jobs are handed out only around the
  // camp and only to the villager that actually stands there (the claimer).
  refreshZoneJobs(dim, v, bell, tick);
  for (const kind of ["forest", "quarry"]) {
    const list = zoneJobs[kind].list;
    if (!list.length) continue;
    const camp = ANCHOR.campOf(v, kind);
    if (!camp) {
      // no camp yet: place one at the densest cluster; the claim comes later
      const cc = clusterCenter(list);
      if (cc) ANCHOR.ensureCamp(dim, v, kind, cc, tick);
      continue;
    }
    const bound = ANCHOR.campWorker(v, kind);
    if (bound && (!ctx.entity || bound !== ctx.entity.id)) continue; // the camp belongs to its claimer
    const dc = Math.max(Math.abs(camp.x - vl.x), Math.abs(camp.z - vl.z));
    if (dc > ANCHOR.WORK_R) continue; // worker is not at the camp: no zone job
    let best, bd = 7;
    const ng = ctx.entity ? noGo.get(ctx.entity.id) : undefined;
    for (const j of list) {
      if (ng && tick < ng.until && Math.max(Math.abs(j.x - ng.x), Math.abs(j.z - ng.z)) <= 4) continue;
      const d = Math.max(Math.abs(j.x - vl.x), Math.abs(j.z - vl.z));
      if (d < bd) { bd = d; best = j; }
    }
    if (best) return { type: kind, x: best.x, z: best.z, y: best.y, since: tick };
  }
  // (2.8) v2.9.0 LEFTOVER CARRY: an idle worker whose pack still holds
  // goods (aborted production materials, stray harvest, sweep leftovers)
  // walks them home BEFORE taking new work. Production carriers are
  // excluded — their cycle owns the pack until deliver/abort.
  if (ctx.entity && !P.isCarrier(ctx.entity.id) && carryWorthDepositing(ctx.entity) >= 1) {
    const mb = depotBlockFor(dim, v, ["food", "warehouse", "construction", "fuel"]);
    if (mb) return { type: "deposit", x: mb.x, z: mb.z, since: tick };
  }
  // (3) UNEMPLOYED only: orders of professions with no professional in
  //     the village => the taker is converted to that profession.
  if (!prof && ctx && ctx.entity) {
    const wanted = actionableTypes(v);
    for (const t of wanted) {
      if ((profCounts.get(t) || 0) > 0) continue; // a professional exists: not our business
      const tgt = orderTargetFor(dim, v, bell, vl, tick, t);
      if (!tgt) continue;
      setProfTag(ctx.entity, t);
      profCounts.set(t, (profCounts.get(t) || 0) + 1); // no twin conversions in the same pass
      jobsStats.converted = (jobsStats.converted || 0) + 1;
      LOG.info(`[CV] mesleksiz köylü ${t} mesleğine yönlendirildi (sipariş talebi)`);
      try { world.sendMessage(`§a[CV]§7 Mesleksiz bir köylü §f${t}§7 mesleğine yönlendirildi.`); } catch (e) { /* ignore */ }
      return { type: "order", x: tgt.t.x, z: tgt.t.z, since: tick, wid: tgt.wid };
    }
  }
  // (4) village infrastructure (everyone, lowest priority)
  if (cfg.wallsOn && W.wallEnabledAt(dim, bell)) {
    // v2.11.0: along-the-path infra only (movement is vanilla) — villagers
    // fix wall gaps they naturally walk past (commutes + outskirts wander)
    const col = W.unbuiltNear(dim, bell, vl, 16);
    if (col) return { type: "wall", x: col.x, z: col.z, since: tick };
  }
  if (cfg.roadsOn) {
    let best, bd = 14; // v2.11.0: along-the-path only
    for (const j of roadJobs.list) {
      const d = Math.max(Math.abs(j.x - vl.x), Math.abs(j.z - vl.z));
      if (d < bd) { bd = d; best = j; }
    }
    if (best) return { type: "road", x: best.x, z: best.z, since: tick };
  }
  // v2.8.0 (user: "sandıkta meşale yokken herkes 'fener dikiyor' yazıp
  // sonsuz döngüye giriyor"): light errands are ONLY handed out while
  // the construction depot actually holds a torch. No material => no
  // assign, no nametag, no stuck workers; lighting.js keeps planning.
  if (String(cfg.villagerFlags || "").includes("t")) {
    if (ctx.lightMat === undefined) {
      ctx.lightMat = B.hasMat(dim, bell, cfg.torchBlock || "minecraft:torch", 1);
      if (!ctx.lightMat) lightStarved = tick;
    }
    // v2.9.0 (user: "depoda meşale varken BOŞTA KALAN TÜM köylüler fener
    // dikiyor'a atanıyor"): torch errands are capped — 2 workers suffice
    // for the grid; everyone else keeps their real trades/idle wander.
    if (ctx.lightBusy === undefined) {
      ctx.lightBusy = 0;
      for (const aa of assigns.values()) if (aa.type === "light") ctx.lightBusy++;
    }
    if (ctx.lightMat && ctx.lightBusy < LIGHT_CAP && tick - lightStarved > 1200) {
      const pts = L.listDarkPoints(dim, bell);
      let best, bd = 14; // v2.11.0: along-the-path only
      const ng = ctx.entity ? noGo.get(ctx.entity.id) : undefined;
      for (const pt of pts) {
        if (ng && tick < ng.until && Math.max(Math.abs(pt.x - ng.x), Math.abs(pt.z - ng.z)) <= 4) continue;
        const d = Math.max(Math.abs(pt.x - vl.x), Math.abs(pt.z - vl.z));
        if (d < bd) { bd = d; best = pt; }
      }
      if (best) { ctx.lightBusy++; return { type: "light", x: best.x, z: best.z, since: tick }; }
    }
  }
  return undefined;
  } catch (e) { jobsStats.errors++; LOG.warn("[CV] pickJob hata: " + e); return undefined; }
}

// ---------- farm jobs: mature crops -> food depot ----------
const CROPS = {
  "minecraft:wheat": { produce: "minecraft:wheat", seed: "minecraft:wheat_seeds", n: 1 },
  "minecraft:carrots": { produce: "minecraft:carrot", seed: "minecraft:carrot", n: 2 },
  "minecraft:potatoes": { produce: "minecraft:potato", seed: "minecraft:potato", n: 2 },
  "minecraft:beetroot": { produce: "minecraft:beetroot", seed: "minecraft:beetroot_seeds", n: 1 }
};
const farmJobs = { list: [], refresh: 0, cursor: 0 };
// autonomy loop (user 28.09): plant -> grow -> harvest -> seeds+produce -> cook -> food
const PLANTABLE = {
  "minecraft:wheat_seeds": "minecraft:wheat",
  "minecraft:beetroot_seeds": "minecraft:beetroot",
  "minecraft:carrot": "minecraft:carrots",
  "minecraft:potato": "minecraft:potatoes"
};
export const jobsStats = { lastTick: -1, assigned: 0, arrivals: 0, hops: 0, errors: 0, converted: 0, rescues: 0, deposits: 0, meals: 0, pickups: 0, giveups: 0, unemployed: 0 };
export function walkStats() { return { ...ANCHOR.stats, buried: PATH.stats.buried }; } // v2.11.0 KAMPYOLU counters (movement is vanilla)
export function dumpAssigns() {
  const out = [];
  for (const [vid, a] of assigns) out.push({ vid: String(vid).slice(-6), type: a.type, x: a.x, z: a.z, age: a.since });
  return out;
}

// ============================================================
// v2.8.0 — PHYSICAL CARRY (user: "çiftçinin envanteri dolunca ürün
// yere düşüyor, sandığa boşaltmıyorlar" + "tohum almıyorlar").
// Harvest / chop / mine yields now enter THE VILLAGER'S OWN inventory
// (a real container, no teleport into depots). When the pack is full
// — or at dusk — the villager walks to a depot and unloads item by
// item (verified slot clears). Seeds are replanted straight from the
// carry; on depot visits the farmer also pockets up to 8 seeds from
// the chest, so planting works even right after setup.
// ============================================================
function invOf(ent) {
  try {
    const c = ent.getComponent("minecraft:inventory");
    return c ? c.container : undefined;
  } catch (e) { return undefined; }
}
function invStats(cont) {
  let items = 0, empty = 0;
  try {
    for (let i = 0; i < cont.size; i++) {
      const it = cont.getItem(i);
      if (it) items += it.amount; else empty++;
    }
  } catch (e) { /* ignore */ }
  return { items, empty };
}
const SEED_IDS = ["minecraft:wheat_seeds", "minecraft:beetroot_seeds", "minecraft:carrot", "minecraft:potato"];
function carryInto(ent, itemId, count) {
  const cont = invOf(ent);
  if (!cont) return count;             // no container on this build: caller falls back
  return CU.addItemsSafe(cont, itemId, count);
}
function carryCount(ent) {
  const cont = invOf(ent);
  if (!cont) return 0;
  return invStats(cont).items;
}
function carryEmptySlots(ent) {
  const cont = invOf(ent);
  if (!cont) return 99;
  return invStats(cont).empty;
}
// v2.9.0: items worth a deposit trip — a farmer's seed pocket (<=8/seed)
// is working stock, not luggage; everything else should reach a depot.
function carryWorthDepositing(ent) {
  const cont = invOf(ent);
  if (!cont) return 0;
  let worth = 0;
  for (let i = 0; i < cont.size; i++) {
    let it; try { it = cont.getItem(i); } catch (e) { continue; }
    if (!it) continue;
    if (SEED_IDS.includes(it.typeId)) worth += Math.max(0, it.amount - 8);
    else worth += it.amount;
  }
  return worth;
}
// depot block of preference for a carry deposit
function depotBlockFor(dim, v, types) {
  D.loadDepots(v);
  for (const t of types) {
    const d = v.depots.get(t);
    if (!d) continue;
    for (const b of d.blocks) if (D.containerAt(dim, b)) return b;
  }
  return undefined;
}
// unload the whole personal inventory into routed depots, slot by slot
function depositCarry(dim, v, ent, tick) {
  const cont = invOf(ent);
  if (!cont) return false;
  let moved = 0;
  for (let i = 0; i < cont.size; i++) {
    let it; try { it = cont.getItem(i); } catch (e) { continue; }
    if (!it || it.amount <= 0) continue;
    const id = it.typeId, n = it.amount;
    const pref = D.depotPriority(id);
    let left = D.addToDepot(dim, v, pref[0], id, n);
    for (let k = 1; k < pref.length && left > 0; k++) left = D.addToDepot(dim, v, pref[k], id, left);
    if (left > 0) left = D.addToDepot(dim, v, "warehouse", id, left);
    if (left >= n) continue;           // depots full: keep carrying
    if (!CU.clearSlot(cont, i)) {      // clone-guard: only credit a verified clear
      let still; try { still = cont.getItem(i); } catch (e) { still = undefined; }
      if (still) continue;
    }
    moved += (n - left);
    LG.push(v, { kind: "carry", items: [{ itemId: id, count: n - left }], to: pref[0], by: "worker" });
  }
  // farmer restock: pocket seeds from the chest while standing here
  if (moved > 0) {
    for (const seed of SEED_IDS) {
      const have = CU.countItems(cont, seed);
      if (have >= 8) continue;
      const want = 8 - have;
      const deps = D.depotPriority(seed);
      if (P.consumeFromAny(dim, v, deps, [{ typeId: seed, count: want }])) {
        const left = CU.addItemsSafe(cont, seed, want);
        if (left > 0) D.addToDepot(dim, v, deps[0], seed, left);
      }
    }
  }
  if (moved > 0) {
    jobsStats.deposits++;
    U.spendEnergy(ent, 2);
    U.particle(dim, ent.location, "minecraft:villager_happy");
    U.sound(dim, ent.location, "random.pop", 0.4);
    U.debug(2, `İşçi depoya boşalttı: ${moved} eşya`, dim, ent.location);
    return true;
  }
  return false;
}

// ---------- v2.8.0 MEAL ERRAND (food optimization) ----------
function foodDepotHasMeal(v) {
  const ids = ["minecraft:bread", "minecraft:cooked_beef", "minecraft:cooked_porkchop", "minecraft:cooked_chicken", "minecraft:baked_potato", "minecraft:carrot", "minecraft:potato"];
  for (const id of ids) if (D.available(v, "food", id) >= 1) return id;
  return undefined;
}
function eatAtDepot(dim, v, ent, tick) {
  const id = foodDepotHasMeal(v);
  if (!id) return false;
  if (!P.consumeFromAny(dim, v, ["food"], [{ typeId: id, count: 1 }])) return false;
  U.feedEnergy(ent, U.MEAL_POINTS);
  jobsStats.meals++;
  U.workerAct(ent, ent.location);
  U.particle(dim, ent.location, "minecraft:villager_happy");
  U.sound(dim, ent.location, "random.burp", 0.5);
  LG.push(v, { kind: "meal", items: [{ itemId: id, count: 1 }], from: "food", by: "worker" });
  U.debug(2, `İşçi yemek yedi: 1x ${id} (enerji ${U.energyOf(ent)})`, dim, ent.location);
  return true;
}

// ---------- v2.11.0 EAT FROM PACK (camp workers can't commute on demand) ----------
const PACK_FOOD = [
  "minecraft:bread", "minecraft:cooked_beef", "minecraft:cooked_porkchop", "minecraft:cooked_chicken",
  "minecraft:baked_potato", "minecraft:apple", "minecraft:cooked_cod", "minecraft:cooked_salmon",
  "minecraft:cooked_mutton", "minecraft:cookie", "minecraft:pumpkin_pie", "minecraft:carrot", "minecraft:potato"
];
function eatFromPack(dim, v, ent, tick) {
  const cont = invOf(ent);
  if (!cont) return false;
  for (let i = 0; i < cont.size; i++) {
    let it; try { it = cont.getItem(i); } catch (e) { continue; }
    if (!it || !PACK_FOOD.includes(it.typeId)) continue;
    if (SEED_IDS.includes(it.typeId) && it.amount <= 8) continue; // seed pocket is working stock
    if (!CU.clearSlot(cont, i)) continue;   // verified removal only (clone-guard doctrine)
    U.feedEnergy(ent, U.MEAL_POINTS);
    jobsStats.meals++;
    U.workerAct(ent, ent.location);
    U.sound(dim, ent.location, "random.burp", 0.5);
    LG.push(v, { kind: "meal", items: [{ itemId: it.typeId, count: 1 }], from: "pack", by: "worker" });
    U.debug(2, `İşçi çantasından yedi: 1x ${it.typeId} (enerji ${U.energyOf(ent)})`, dim, ent.location);
    return true;
  }
  return false;
}

// ---------- v2.11.0 KAMPYOLU monitor (user: "vanilla'nın zaten köylüyü
// göreve götüren sistemi var; ikinci bir yürüme sistemi yazarsan çakışıyor
// — iki adım ileri gidiyor (vanilla), iki adım geriye ışınlanıyor (kod)") ----------
// The v2.10.0 walker (teleport-stepping along an A* path) is DELETED: it
// fought the villager's own AI every 4 ticks. This loop now MOVES NOTHING.
// It only: keeps assigns honest (dead entities), faces an arrived worker
// toward its site, and pockets ground loot stacks. Walking is 100% vanilla
// (POI schedule — see cv/core/anchor.js); a job nobody can reach simply
// expires via the dispatch validity timeout and rotates (noGo).
let steerArmed = false;
let steerLast = -1;
export function steerLastTick() { return steerLast; }
// engine calls this periodically: if the 4t interval was discarded by
// the build (or never armed), re-arm it so monitoring never dies silently
export function healSteer() {
  if (system.currentTick - steerLast > 120) {
    steerArmed = false;
    ensureSteerLoop();
    LOG.warn("[CV] iş gözcüsü cansızdı → yeniden kuruldu (self-heal)");
  }
}
export function ensureSteerLoop() {
  if (steerArmed) return;
  steerArmed = true;
  try {
    system.runInterval(() => {
      try { steerPass(); } catch (e) { /* never kill the loop */ }
    }, 4);
  } catch (e) { steerArmed = false; }
}
function steerPass() {
  const tick = system.currentTick;
  steerLast = tick;
  if (assigns.size === 0) return;
  const dim = world.getDimension("overworld");
  for (const [vid, a] of [...assigns]) {
    const ent = a.ent;
    if (!ent || !U.isValidEntity(ent)) { assigns.delete(vid); noGo.delete(vid); continue; }
    const vl = ent.location;
    const d = Math.max(Math.abs(a.x - vl.x), Math.abs(a.z - vl.z));
    if (d <= arriveRadius(a.type) && tick - (a.lastLook || 0) >= 40) {
      a.lastLook = tick;
      try { ent.lookAt(U.vec(a.x, vl.y + 1, a.z)); } catch (e) { /* ignore */ }
    }
    // ground-drop pickup: trampled crops / stray loot enter the carry
    // physically instead of lying on the ground forever. v2.10.0 (user:
    // "1 tane buğday tohumu bile bulsa sandıklara götürüyor, kısır döngü"):
    // single items are NOT worth a trip — only stacks of PICK_MIN+.
    if ((tick + (a.phase || 0)) % 20 === 0) pickupNear(dim, ent, vl);
  }
}
// one arrival rule for both loops (dispatch + monitor). v2.11.0: a worker
// stands NEXT TO its claimed site; 4 blocks covers the adjacent-column
// rule plus the villager's own short "gather supplies" steps.
function arriveRadius(type) {
  return (type === "farm" || type === "forest" || type === "quarry") ? 4 : 3;
}

const PICK_MIN = 4; // v2.10.0: a lone seed stays on the ground
function pickupNear(dim, ent, vl) {
  const cont = invOf(ent);
  if (!cont) return;
  if (invStats(cont).empty <= 0) return;
  let ents;
  try { ents = dim.getEntities({ type: "minecraft:item", location: vl, maxDistance: 1.6 }); } catch (e) { return; }
  for (const e of ents) {
    let stack;
    try { stack = e.getComponent("minecraft:item") ? e.getComponent("minecraft:item").itemStack : undefined; } catch (err) { stack = undefined; }
    if (!stack) continue;
    if (stack.amount < PICK_MIN) continue; // v2.10.0: no 1-seed taxi trips
    const left = CU.addItemsSafe(cont, stack.typeId, stack.amount);
    if (left < stack.amount) {
      jobsStats.pickups++;
      try { e.kill(); } catch (err) { /* ignore */ }
      U.debug(2, `Yerdeki eşya çantaya: ${stack.amount - left}x ${stack.typeId}`, dim, vl);
    }
    if (invStats(cont).empty <= 0) break;
  }
}

// ---------- v2.8.0 zone border sparkle (active forest/quarry) ----------
let zoneSparkle = 0;
function zoneBorderParticles(dim, v, bell, tick) {
  if (tick - zoneSparkle < 60) return;
  zoneSparkle = tick;
  for (const kind of ["forest", "quarry"]) {
    const r = zoneRect(v, kind);
    if (!r) continue;
    let n = 0;
    for (let x = r.minX; x <= r.maxX && n < 40; x += 4) {
      for (const z of [r.minZ, r.maxZ]) {
        const y = W.surfaceY(dim, bell.y, x, z);
        if (y === null) continue;
        U.particle(dim, U.vec(x + 0.5, y + 1.2, z + 0.5), "minecraft:villager_happy");
        n++;
      }
    }
    for (let z = r.minZ; z <= r.maxZ && n < 80; z += 4) {
      for (const x of [r.minX, r.maxX]) {
        const y = W.surfaceY(dim, bell.y, x, z);
        if (y === null) continue;
        U.particle(dim, U.vec(x + 0.5, y + 1.2, z + 0.5), "minecraft:villager_happy");
        n++;
      }
    }
  }
}

function refreshFarmJobs(dim, bell, tick) {
  const rect = W.rectOf(bell) || W.coreRectOf(bell); // fields live inside the WALLS, not the house core
  if (!rect) { farmJobs.list = []; return; } // mapping not done yet — NEVER crash the dispatcher (v2.4.2 killer bug)
  if (!rect) { farmJobs.list = []; return; }
  if (tick - farmJobs.refresh < 240 && farmJobs.cursor === 0) return;
  farmJobs.refresh = tick;
  farmJobs.list = farmJobs.list.filter(j => isMature(dim, j));
  const width = rect.maxX - rect.minX + 1;
  const total = width * (rect.maxZ - rect.minZ + 1);
  let budget = 400;
  for (let n = 0; n < budget; n++) {
    const i = farmJobs.cursor % total;
    farmJobs.cursor = (farmJobs.cursor + 2) % total;
    if (farmJobs.list.length >= 48) break;
    const x = rect.minX + (i % width);
    const z = rect.minZ + Math.floor(i / width);
    for (let y = bell.y + 8; y >= bell.y - 8; y--) {
      const b = U.getBlock(dim, U.vec(x, y, z));
      const t = U.typeId(b);
      if (t && CROPS[t] && isMatureAt(b)) {
        if (!farmJobs.list.some(j => j.x === x && j.z === z)) farmJobs.list.push({ x, y, z });
        break;
      }
      if (t === "minecraft:farmland") {
        const above = U.typeId(U.getBlock(dim, U.vec(x, y + 1, z)));
        if (above === "minecraft:air" && !farmJobs.list.some(j => j.x === x && j.z === z)) {
          farmJobs.list.push({ x, y: y + 1, z, plant: true });
        }
        break;
      }
      if (t && t !== "minecraft:air" && !U.GRASS_PLANTS.has(t) && !U.FLOWERS.has(t)) break;
    }
  }
}
function isMatureAt(block) {
  try { return block.permutation.getState("growth") >= 7; } catch (e) { return false; }
}
function isMature(dim, j) {
  const b = U.getBlock(dim, U.vec(j.x, j.y, j.z));
  return !!b && !!CROPS[U.typeId(b)] && isMatureAt(b);
}
// v2.8.0 CARRY MODEL: the crop enters THE FARMER'S PACK, not the depot
// (no teleport). Full pack => the crop stays on the stem and the
// dispatcher sends the farmer on a deposit errand first. Replant uses
// a seed from the pack (harvest yields seeds) or — user rule — takes
// one from a depot chest when the pack has none.
function harvestAt(dim, v, worker, job) {
  if (!v) return false;
  const loc = U.vec(job.x, job.y, job.z);
  if (job.plant) return plantAt(dim, v, worker, loc);
  const b = U.getBlock(dim, loc);
  const t = U.typeId(b);
  const info = CROPS[t];
  if (!info || !isMatureAt(b)) return false;
  const cont = worker ? invOf(worker) : undefined;
  if (cont && invStats(cont).empty <= 0) return false; // pack full: go deposit first
  const gains = [{ itemId: info.produce, count: info.n + (Math.random() < 0.3 ? 1 : 0) }];
  if (t === "minecraft:wheat") gains.push({ itemId: "minecraft:wheat_seeds", count: 1 });
  if (t === "minecraft:beetroot") gains.push({ itemId: "minecraft:beetroot_seeds", count: 1 });
  U.clearBlock(dim, loc); // no drop entities: the yield goes into the pack
  let banked = 0;
  for (const g of gains) {
    let left = cont ? CU.addItemsSafe(cont, g.itemId, g.count) : g.count;
    if (left > 0) { // pack overflow mid-harvest: never vanish produce
      let l2 = D.addToDepot(dim, v, D.depotPriority(g.itemId)[0], g.itemId, left);
      if (l2 > 0) l2 = D.addToDepot(dim, v, "warehouse", g.itemId, l2);
      left = l2;
    }
    banked += g.count - left;
  }
  // replant: seed from the pack first, else physically from a depot chest
  const seed = info.seed;
  let planted = false;
  if (cont && CU.countItems(cont, seed) >= 1 && CU.removeItemsExact(cont, [{ typeId: seed, count: 1 }])) {
    try { b.setPermutation(BlockPermutation.resolve(t, { growth: 0 })); planted = true; } catch (e) { CU.addItemsSafe(cont, seed, 1); }
  }
  if (!planted) {
    const deps = D.depotPriority(seed);
    let have = 0;
    for (const t2 of deps) have += D.available(v, t2, seed);
    if (have >= 1 && P.consumeFromAny(dim, v, deps, [{ typeId: seed, count: 1 }])) {
      try { b.setPermutation(BlockPermutation.resolve(t, { growth: 0 })); planted = true; } catch (e) { /* ignore */ }
    }
  }
  stats.farmHarvested = (stats.farmHarvested || 0) + 1;
  if (worker) U.spendEnergy(worker, 6);
  U.particle(dim, loc, "minecraft:villager_happy");
  U.sound(dim, loc, "dig.grass", 0.5);
  if (worker) U.workerAct(worker, loc);
  U.debug(2, `Çiftçi hasadı: ${banked}x ürün çantaya${planted ? " + ekim" : ""}`, dim, loc);
  return true;
}

function plantAt(dim, v, worker, loc) {
  const below = U.typeId(U.getBlock(dim, U.vec(loc.x, loc.y - 1, loc.z)));
  if (below !== "minecraft:farmland") return false;
  if (U.typeId(U.getBlock(dim, loc)) !== "minecraft:air") return false;
  const cont = worker ? invOf(worker) : undefined;
  for (const [seed, crop] of Object.entries(PLANTABLE)) {
    // 1) seed from the farmer's own carry (harvest leftovers)
    if (cont && CU.countItems(cont, seed) >= 1) {
      if (!CU.removeItemsExact(cont, [{ typeId: seed, count: 1 }])) continue;
      if (!tryPlant(dim, loc, crop, worker)) { CU.addItemsSafe(cont, seed, 1); return false; }
      return true;
    }
    // 2) user rule: plant only when a depot chest actually holds seeds
    const deps = D.depotPriority(seed);
    let have = 0;
    for (const t2 of deps) have += D.available(v, t2, seed);
    if (have < 1) continue;
    if (!P.consumeFromAny(dim, v, deps, [{ typeId: seed, count: 1 }])) continue;
    if (!tryPlant(dim, loc, crop, worker)) return false;
    return true;
  }
  return false;
}
function tryPlant(dim, loc, crop, worker) {
  try {
    const perm = BlockPermutation.resolve(crop, { growth: 0 });
    dim.getBlock(loc).setPermutation(perm);
    stats.farmPlanted = (stats.farmPlanted || 0) + 1;
    if (worker) { U.spendEnergy(worker, 3); U.workerAct(worker, loc); }
    U.particle(dim, loc, "minecraft:villager_happy");
    U.debug(2, `Çiftçi ekim yaptı: ${crop}`, dim, loc);
    return true;
  } catch (e) { return false; }
}

// ---------- zones (quarry / forest) ----------
function zones(v) {
  try {
    const raw = world.getDynamicProperty(`cv:v:${v.id}:zones`);
    return normZoneObj((typeof raw === "string" && JSON.parse(raw)) || {});
  } catch (e) { return {}; }
}
// v2.6.0: zones used to live ONLY in a world dynamic property. When that
// write silently failed (restricted mode / discarded write), /cv:forest
// pos1+pos2 reported success but diag showed "kurulu değil". Corners now
// live in a memory mirror (always works, session-scoped) AND are mirrored
// to the dynamic property with read-back verification (reload-scoped).
const zoneMem = new Map(); // `${v.id}|${kind}` -> {p1,p2,persisted}
function zKey(v, kind) { return v.id + "|" + kind; }
// v2.7.0 KILLER BUG: corners were stored under the COMMAND arg names
// ("pos1"/"pos2") but read back as "p1"/"p2" => /cv:forest pos1+pos2
// reported AKTİF while zoneRect() saw nothing ("kurulu değil iş=0").
function cornerKey(which) { return which === "pos1" ? "p1" : "p2"; }
function normZoneObj(z) {
  // migrate legacy saves that carry pos1/pos2 keys
  for (const kind of Object.keys(z || {})) {
    const e = z[kind];
    if (e && (e.pos1 || e.pos2)) {
      if (e.pos1 && !e.p1) e.p1 = e.pos1;
      if (e.pos2 && !e.p2) e.p2 = e.pos2;
      delete e.pos1; delete e.pos2;
    }
  }
  return z || {};
}
export function setZoneCorner(v, kind, which, pos) {
  const key = zKey(v, kind);
  const m = zoneMem.get(key) || { p1: undefined, p2: undefined, persisted: false };
  const ck = cornerKey(which);
  m[ck] = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
  zoneMem.set(key, m);
  try {
    const z = normZoneObj(zones(v));
    z[kind] = z[kind] || {};
    z[kind][ck] = m[ck];
    world.setDynamicProperty(`cv:v:${v.id}:zones`, JSON.stringify(z));
    const back = normZoneObj(zones(v));
    m.persisted = !!(back && back[kind] && back[kind][ck]);
  } catch (e) {
    m.persisted = false;
    LOG.warn(`[CV] zone kalıcı kayıt hatası (${kind}): ${e && e.message ? e.message : e}`);
  }
  LOG.info(`[CV] zone ${kind} ${ck} = ${m[ck].x},${m[ck].y},${m[ck].z} (kalıcı=${m.persisted ? "evet" : "HAYIR-bellek"})`);
  return { corner: m[ck], zone: { p1: m.p1, p2: m.p2 }, persisted: m.persisted };
}
export function clearZone(v, kind) {
  zoneMem.delete(zKey(v, kind));
  try {
    const z = zones(v);
    delete z[kind];
    world.setDynamicProperty(`cv:v:${v.id}:zones`, JSON.stringify(z));
  } catch (e) { /* ignore */ }
  // v2.11.0: the camp anchor goes with the zone (addon-owned block — removed
  // without drops; the player's own blocks are never touched)
  try { ANCHOR.removeCamp(world.getDimension("overworld"), v, kind); } catch (e) { /* ignore */ }
  if (zoneJobs[kind]) { zoneJobs[kind].list = []; zoneJobs[kind].cursor = 0; }
  LOG.info(`[CV] zone temizlendi: ${kind}`);
}
export function zoneCorners(v, kind) {
  const m = zoneMem.get(zKey(v, kind));
  const d = zones(v)[kind];
  return {
    p1: (m && m.p1) || (d && d.p1),
    p2: (m && m.p2) || (d && d.p2),
    // v2.7.0: "kalıcı" must mean corners actually persisted, not just an
    // empty object (old bug showed kalıcı✓ next to p1✗ p2)
    persisted: m ? !!m.persisted : !!(d && (d.p1 || d.p2))
  };
}
function zoneRect(v, kind) {
  const c = zoneCorners(v, kind);
  if (!c.p1 || !c.p2) return undefined;
  return {
    minX: Math.min(c.p1.x, c.p2.x), maxX: Math.max(c.p1.x, c.p2.x),
    minZ: Math.min(c.p1.z, c.p2.z), maxZ: Math.max(c.p1.z, c.p2.z),
    minY: Math.min(c.p1.y, c.p2.y) - 8, maxY: Math.max(c.p1.y, c.p2.y) + 16
  };
}
// v2.11.0 (user: "bölgede 2 tane akasya ağacı var, büyük ihtimalle kodda
// sadece meşe kütüğü aradığı için ağaç yok diyor"): two root causes fixed.
// (1) The column scan treated the LEAF CANOPY as a wall and broke before
// ever reaching the trunk below — NO tree with a crown was visible. The
// scan now looks through leaves/vines/cocoa/propagules (U.isScanPassable).
// (2) Wood coverage: every log/wood/stem family counts now (acacia, dark
// oak, mangrove, cherry, pale oak, bamboo, crimson/warped + legacy
// minecraft:log / log2 of old worlds) via U.isLogId — not just *_log.
// A hit records the WHOLE trunk (scan down to its base) so one visit
// fells the tree bottom-up.
// quarry targets: ores + real quarry stone + overburden (v2.5.3: a marked
// grass field now strips top-down until it reaches the ore body instead
// of silently yielding nothing)
const ORE_IDS = new Set([
  "minecraft:stone", "minecraft:cobblestone", "minecraft:deepslate", "minecraft:cobbled_deepslate",
  "minecraft:coal_ore", "minecraft:deepslate_coal_ore", "minecraft:iron_ore", "minecraft:deepslate_iron_ore",
  "minecraft:copper_ore", "minecraft:deepslate_copper_ore", "minecraft:gold_ore", "minecraft:deepslate_gold_ore",
  "minecraft:diamond_ore", "minecraft:deepslate_diamond_ore",
  "minecraft:andesite", "minecraft:diorite", "minecraft:granite", "minecraft:tuff",
  "minecraft:dirt", "minecraft:grass_block", "minecraft:gravel", "minecraft:sand", "minecraft:sandstone"
]);
const LOOT = {
  "minecraft:stone": "minecraft:cobblestone", "minecraft:deepslate": "minecraft:cobbled_deepslate",
  "minecraft:coal_ore": "minecraft:coal", "minecraft:deepslate_coal_ore": "minecraft:coal",
  "minecraft:iron_ore": "minecraft:raw_iron", "minecraft:deepslate_iron_ore": "minecraft:raw_iron",
  "minecraft:copper_ore": "minecraft:raw_copper", "minecraft:deepslate_copper_ore": "minecraft:raw_copper",
  "minecraft:gold_ore": "minecraft:raw_gold", "minecraft:deepslate_gold_ore": "minecraft:raw_gold",
  "minecraft:diamond_ore": "minecraft:diamond",
  "minecraft:grass_block": "minecraft:dirt", "minecraft:dirt": "minecraft:dirt",
  "minecraft:gravel": "minecraft:gravel", "minecraft:sand": "minecraft:sand",
  "minecraft:sandstone": "minecraft:sandstone", "minecraft:andesite": "minecraft:andesite",
  "minecraft:diorite": "minecraft:diorite", "minecraft:granite": "minecraft:granite",
  "minecraft:tuff": "minecraft:tuff", "minecraft:cobblestone": "minecraft:cobblestone",
  "minecraft:cobbled_deepslate": "minecraft:cobbled_deepslate"
};
const zoneJobs = { forest: { list: [], cursor: 0, refresh: 0, unloaded: 0 }, quarry: { list: [], cursor: 0, refresh: 0, unloaded: 0 } };
// v2.11.0: camp placement — the densest job cluster in the zone (one camp
// covers WORK_R around it; when the cluster empties, dispatch moves the camp)
function clusterCenter(list) {
  let best = null, bn = -1;
  for (const j of list) {
    let n = 0;
    for (const k of list) if (Math.max(Math.abs(j.x - k.x), Math.abs(j.z - k.z)) <= 10) n++;
    if (n > bn) { bn = n; best = j; }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : undefined;
}
// v2.10.0 (user: "Orman kesilmiyor 3 oyun günü bekledim... ormancı için bir
// iş istasyonu mu gerekiyor?"): a zone with ZERO choppable/minable columns
// silently did nothing for days. Now the game explains itself: the zone is
// empty of targets, and forestry needs NO job station — the zone IS the
// workplace. Rate-limited chat guidance + the diag iş=0 line agree.
const zoneEmptySince = { forest: 0, quarry: 0 };
const zoneWarnAt = { forest: 0, quarry: 0 };
const zoneClaimWarnAt = { forest: 0, quarry: 0 };
function zoneGapGuide(v, tick, tod) {
  for (const kind of ["forest", "quarry"]) {
    const r = zoneRect(v, kind);
    const zj = zoneJobs[kind];
    if (!r) { zoneEmptySince[kind] = 0; continue; }
    // (a) zone active but NO targets
    if (!zj.list.length && zj.unloaded === 0) {
      if (!zoneEmptySince[kind]) zoneEmptySince[kind] = tick;
      if (tick - zoneEmptySince[kind] >= 2400 && tick - zoneWarnAt[kind] >= 12000) {
        zoneWarnAt[kind] = tick;
        const msg = kind === "forest"
          ? "§e[CV]§7 forest bölgesi AKTİF ama içinde kesilecek kütük yok (iş=0). Tarama yaprakların ALTINI da görür ve TÜM ağaç türlerini sayar (meşe, akasya, huş, ladin, kiraz, mangrov…). Bölgede gerçekten ağaç var mı? Kamp otomatik kurulur; ormancının köyde ayrıca istasyona ihtiyacı yok."
          : "§e[CV]§7 quarry bölgesi AKTİF ama içinde kazılacak taş/maden yok (iş=0). Bölgeyi taş/maden alanını kapsayacak şekilde yeniden işaretleyin.";
        try { world.sendMessage(msg); } catch (e) { /* ignore */ }
        LOG.info("[CV] bölge rehberi: " + kind + " aktif ama iş=0 (bölgede hedef yok)");
      }
      continue;
    }
    zoneEmptySince[kind] = 0;
    // (b) targets exist, camp placed, but NOBODY claimed it for a long time:
    // vanilla rule — only an UNEMPLOYED villager claims a job site.
    const camp = ANCHOR.campOf(v, kind);
    if (camp && !ANCHOR.campWorker(v, kind) && tick - (camp.placedAt || tick) > 24000 && tick - zoneClaimWarnAt[kind] > 24000) {
      zoneClaimWarnAt[kind] = tick;
      try {
        world.sendMessage(`§e[CV]§7 ${kind} kampı (§f${camp.x},${camp.z}§7) bir türlü §fsahiplenilmedi§7: köyde §fişsiz§7 köylü kalmamış olabilir. Vanilla kuralı: iş istasyonunu yalnızca işsiz bir köylü sahiplenir → yatak ekleyip nüfusu büyütün ya da bir köylünün istasyonunu kırıp onu işsiz bırakın.`);
      } catch (e) { /* ignore */ }
      LOG.info(`[CV] kamp sahiplenilmedi (${kind}) — işsiz köylü yok mu?`);
    }
  }
}
// ---------- v2.11.0 camp & anchor upkeep (KAMPYOLU) ----------
// The camp lives at the densest cluster of zone jobs. When the cluster
// around it runs dry, the camp is MOVED (break + re-place of an
// addon-owned block) during the wander hours, so the claimer re-claims
// and vanilla walks it to the fresh work. Rate-limited by anchor.js.
function zoneCampUpkeep(dim, v, tick, tod) {
  for (const kind of ["forest", "quarry"]) {
    const list = zoneJobs[kind] ? zoneJobs[kind].list : [];
    const camp = ANCHOR.campOf(v, kind);
    if (!camp) {
      if (list.length) {
        const cc = clusterCenter(list);
        if (cc) ANCHOR.ensureCamp(dim, v, kind, cc, tick);
      }
      continue;
    }
    if (!list.length) continue;
    let near = 0;
    for (const j of list) if (Math.max(Math.abs(j.x - camp.x), Math.abs(j.z - camp.z)) <= 6) near++;
    if (near > 0) continue;
    if (!ANCHOR.isWanderSlot(tod)) continue; // claims/re-claims happen while wandering
    const cc = clusterCenter(list);
    if (cc && Math.max(Math.abs(cc.x - camp.x), Math.abs(cc.z - camp.z)) > 6) ANCHOR.moveCamp(dim, v, kind, cc, tick);
  }
}
// workshops whose station is not a vanilla POI (furnace, crafting table,
// campfire) get a claimable side anchor so a villager can commute there
let wsAnchorTick = 0;
function workshopAnchorUpkeep(dim, v, tick) {
  if (tick - wsAnchorTick < 200) return; // every 10s is plenty
  wsAnchorTick = tick;
  try {
    for (const w of WS.list(v)) {
      if (!WS.isValid(dim, v, w)) continue;
      ANCHOR.ensureWorkshopAnchor(dim, v, w, tick);
    }
  } catch (e) { /* ignore */ }
}
function refreshZoneJobs(dim, v, bell, tick) {
  for (const kind of ["forest", "quarry"]) {
    const zj = zoneJobs[kind];
    const rect = zoneRect(v, kind);
    if (!rect) { zj.list = []; continue; }
    if (tick - zj.refresh < 240 && zj.cursor !== 0) continue;
    zj.refresh = tick;
    zj.list = [];
    zj.unloaded = 0;
    const width = rect.maxX - rect.minX + 1;
    const depth = rect.maxZ - rect.minZ + 1;
    const total = width * depth;
    let budget = 500;
    for (let n = 0; n < budget; n++) {
      const i = zj.cursor % total;
      zj.cursor = (zj.cursor + 1) % total;
      const x = rect.minX + (i % width);
      const z = rect.minZ + Math.floor(i / width);
      // v2.5.3: unloaded chunk => skip column (getBlock would throw/lie)
      try { if (!dim.isChunkLoaded({ x, y: bell.y, z })) { zj.unloaded++; continue; } } catch (e) { continue; }
      for (let y = rect.maxY; y >= rect.minY; y--) {
        const t = U.typeId(U.getBlock(dim, U.vec(x, y, z)));
        if (!t || t === "minecraft:air") continue;
        if (kind === "forest") {
          if (U.isLogId(t)) {
            // walk DOWN to the base of the trunk: one job = one tree
            let by = y;
            for (let y2 = y - 1; y2 >= rect.minY; y2--) {
              const t2 = U.typeId(U.getBlock(dim, U.vec(x, y2, z)));
              if (U.isLogId(t2)) by = y2; else break;
            }
            zj.list.push({ x, y: by, z, id: U.typeId(U.getBlock(dim, U.vec(x, by, z))) || t });
            break;
          }
          if (U.isScanPassable(t)) continue; // leaf canopy is NOT a wall: look through it
          break; // solid ground reached without a trunk: nothing here
        }
        const hit = ORE_IDS.has(t);
        if (hit) { zj.list.push({ x, y, z, id: t }); break; }
        if (t !== "minecraft:water" && !U.GRASS_PLANTS.has(t) && !U.FLOWERS.has(t) && t !== "minecraft:snow_layer") break;
      }
      if (zj.list.length >= 40) break;
    }
  }
}
// /cv:diag visibility (v2.5.3)
export function zoneStats(v) {
  const out = {};
  for (const kind of ["forest", "quarry"]) {
    const r = zoneRect(v, kind);
    const c = zoneCorners(v, kind);
    const camp = ANCHOR.campOf(v, kind);
    out[kind] = {
      set: !!r,
      rect: r ? `${r.minX},${r.minZ}..${r.maxX},${r.maxZ}` : null,
      jobs: zoneJobs[kind].list.length,
      unloaded: zoneJobs[kind].unloaded,
      refresh: zoneJobs[kind].refresh,
      p1: !!c.p1, p2: !!c.p2, persisted: c.persisted,
      camp: camp ? `${camp.x},${camp.z}` : null,
      campWorker: camp ? (ANCHOR.campWorker(v, kind) ? "✓" : "✗") : "-"
    };
  }
  return out;
}
// v2.8.0: zone yield enters the worker's pack (physical carry) instead
// of teleporting into a depot. Full pack => block stays, the dispatcher
// sends the worker to unload first.
// v2.11.0: sapling permutation resolver (modern id first, then bare, then
// legacy sapling_type) — a failed resolve must NEVER write undefined.
function sapPerm(sap) {
  try { return BlockPermutation.resolve(sap, { age_bit: false }); } catch (e) { /* next */ }
  try { return BlockPermutation.resolve(sap); } catch (e) { /* next */ }
  const fam = String(sap).replace("minecraft:", "").replace("_sapling", "").replace("_propagule", "");
  try { return BlockPermutation.resolve("minecraft:sapling", { sapling_type: fam === "oak" ? "oak" : fam }); } catch (e) { return undefined; }
}
function chopOrMineAt(dim, v, worker, job, kind) {
  const loc = U.vec(job.x, job.y, job.z);
  const blk = U.getBlock(dim, loc);
  const t = U.typeId(blk);
  if (!t) return false;
  if (kind === "forest" && !U.isLogId(t)) return false;
  if (kind === "quarry" && !ORE_IDS.has(t)) return false;
  const cont = worker ? invOf(worker) : undefined;
  if (cont && invStats(cont).empty <= 0) return false; // pack full: deposit errand first
  // v2.11.0: sapling choice BEFORE the block is cleared (legacy log/log2
  // carry wood_type in the permutation) — every family replants its OWN
  // kind: acacia→acacia, cherry→cherry, mangrove→propagule, bamboo…
  const sap = kind === "forest" ? U.saplingForLog(t, blk) : null;
  U.clearBlock(dim, loc);
  let gained = [];
  if (kind === "forest") {
    gained = [{ itemId: t, count: 1 }];
    // replant with a sapling from depot if available
    if (sap) {
      const deps = D.depotPriority(sap);
      if (P.consumeFromAny(dim, v, deps, [{ typeId: sap, count: 1 }])) {
        const p = sapPerm(sap);
        if (p) { try { dim.getBlock(loc).setPermutation(p); } catch (e) { /* ignore */ } }
      }
    }
  } else {
    gained = [{ itemId: LOOT[t] || t, count: 1 }];
  }
  for (const g of gained) {
    let left = cont ? CU.addItemsSafe(cont, g.itemId, g.count) : g.count;
    if (left > 0) { // overflow: bank it, never vanish
      let l2 = D.addToDepot(dim, v, D.depotPriority(g.itemId)[0], g.itemId, left);
      if (l2 > 0) D.addToDepot(dim, v, "warehouse", g.itemId, l2);
      left = l2;
    }
    if (g.count - left > 0) LG.push(v, { kind: "gather", items: [{ itemId: g.itemId, count: g.count - left }], by: kind });
  }
  stats.gathered = (stats.gathered || 0) + 1;
  if (worker) U.spendEnergy(worker, 6);
  if (worker) U.workerAct(worker, loc);
  U.sound(dim, loc, kind === "forest" ? "dig.wood" : "dig.stone", 0.5);
  U.debug(2, `${kind}: +${gained.map(g => g.count + "x" + g.itemId).join(",")} → çanta`, dim, loc);
  return true;
}

// ---------- v2.9.0 chain work ("en yakınındaki işleri zincirleme yapar") ----------
// One arrival harvests the assigned plot PLUS every other pending job
// within a few blocks — natural wandering through a field now clears it
// instead of one-crop-per-visit.
// v2.10.0 (user: "çiftçiler önce kendi işlerine odaklanmalı: önce tarladaki
// tüm hasada hazır mahsulleri hasat edip SONRA yenilerini ekmeli; işi
// bitince üzerinde kalan fazla tohum/mahsulü depoya götürmeli").
// Pass 1 harvests EVERY mature plot near the worker (pack space
// permitting), pass 2 sows the empty plots from the seeds in the pack —
// only the leftover surplus rides home on the deposit errand.
function chainFarmWork(dim, v, worker, a) {
  let did = harvestAt(dim, v, worker, a);
  farmJobs.list = farmJobs.list.filter(j => !(j.x === a.x && j.y === a.y && j.z === a.z));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 10; k++) {
      if (carryEmptySlots(worker) <= 0) break; // pack full => deposit first
      let wl; try { wl = worker.location; } catch (e) { break; }
      let bj, bd = 4.5;
      for (const j of farmJobs.list) {
        if (pass === 0 ? j.plant : !j.plant) continue; // pass0 harvest, pass1 sow
        const dd = Math.max(Math.abs(j.x - wl.x), Math.abs(j.z - wl.z));
        if (dd < bd) { bd = dd; bj = j; }
      }
      if (!bj) break;
      farmJobs.list = farmJobs.list.filter(j => j !== bj);
      if (harvestAt(dim, v, worker, bj)) did = true;
    }
  }
  return did;
}
function chainZoneWork(dim, v, worker, a) {
  let did = chopOrMineAt(dim, v, worker, a, a.type);
  if (did && a.type === "forest") did = chopTrunkUp(dim, v, worker, a) || did; // fell the whole trunk
  const zj = zoneJobs[a.type];
  if (zj) zj.list = zj.list.filter(j => !(j.x === a.x && j.y === a.y && j.z === a.z));
  for (let k = 0; k < 3 && zj; k++) {
    if (carryEmptySlots(worker) <= 0) break;
    let wl; try { wl = worker.location; } catch (e) { break; }
    let bj, bd = 3;
    for (const j of zj.list) {
      const dd = Math.max(Math.abs(j.x - wl.x), Math.abs(j.z - wl.z));
      if (dd < bd) { bd = dd; bj = j; }
    }
    if (!bj) break;
    zj.list = zj.list.filter(j => j !== bj);
    if (chopOrMineAt(dim, v, worker, bj, a.type)) did = true;
  }
  return did;
}
// fells the rest of the trunk above a chopped log (leaves: trim flag "v")
function chopTrunkUp(dim, v, worker, job) {
  let any = false;
  const cont = invOf(worker);
  for (let dy = 1; dy <= 12; dy++) {
    if (cont && invStats(cont).empty <= 0) break; // pack full: rest waits for the next trip
    const loc = U.vec(job.x, job.y + dy, job.z);
    const t = U.typeId(U.getBlock(dim, loc));
    if (!t || !U.isLogId(t)) break;
    U.clearBlock(dim, loc);
    const left = cont ? CU.addItemsSafe(cont, t, 1) : 1;
    if (left > 0) {
      let l2 = D.addToDepot(dim, v, D.depotPriority(t)[0], t, left);
      if (l2 > 0) D.addToDepot(dim, v, "warehouse", t, l2);
    }
    LG.push(v, { kind: "gather", items: [{ itemId: t, count: 1 }], by: "forest" });
    stats.gathered = (stats.gathered || 0) + 1;
    any = true;
  }
  if (any) {
    U.spendEnergy(worker, 4);
    U.workerAct(worker, U.vec(job.x, job.y + 1, job.z));
    U.sound(dim, U.vec(job.x, job.y, job.z), "dig.wood", 0.4);
    U.debug(2, "Orman: gövde yukarı doğru devrildi", dim, U.vec(job.x, job.y, job.z));
  }
  return any;
}

// ---------- v2.9.0 profession lifecycle watchdog (user rule 12.10) ----------
// A tagged professional whose station is GONE (broken/removed) falls back
// into the UNEMPLOYED pool: the dispatcher can then convert it to any
// ownerless profession or bind it to a newly added station — "güzel bir
// döngü halinde devam etmeli". Clears ONLY when (a) the village holds no
// valid workshop of that type AND (b) no marker block sits within 24
// blocks, and only for IDLE villagers (a carrier on a long trip keeps its
// trade). Markerless tag professions (forester/fisherman) are never
// cleared — they exist only by conversion.
function profWatchdog(dim, v, ent, tick) {
  const tag = profTag(ent);
  if (!tag) return;
  const markers = markerTypesFor(tag);
  if (!markers) return;
  try { if (WS.findValid(dim, v, tag)) return; } catch (e) { return; }
  if (stationNearby(dim, ent.location, markers, 24)) return;
  clearProfTag(ent);
  jobsStats.unemployed = (jobsStats.unemployed || 0) + 1;
  LOG.info(`[CV] ${tag} istasyonu kalkmış → köylü işsiz sınıfına düştü (…${String(ent.id).slice(-6)})`);
  try { world.sendMessage(`§e[CV]§7 Bir §f${tag}§7 köylüsünün iş istasyonu kalkmış → köylü artık §fişsiz§7; yeni istasyonlara/sahipsiz siparişlere atanabilir.`); } catch (e) { /* ignore */ }
}

// ---------- v2.7.0 SAFE MOVEMENT ----------
// User report: "köylüler ışınlandığı için blokların altına ışınlanıp
// sıkışıp ölüyorlardı" + "2 adım ileri 5 adım geri ışınlanma". The old
// hop teleported blind to (target+1, y+1) — often inside solid blocks.
// Now every teleport destination is validated: passable feet+head,
// solid (non-liquid) floor, loaded chunk. If no safe spot exists near
// the target we simply do NOT teleport (impulses keep working).
// v2.10.0: safeStand/safeHop/rescueIfStuck are GONE (they were the roof
// teleports). Ground truth + the single sideways bury-fix live in path.js.

export function dispatch(dim, bell, tick) {
  const cfg = getConfig();
  jobsStats.lastTick = tick;
  ensureSteerLoop(); // v2.8.0: smooth movement loop self-arms from here
  if (!cfg.enabled) return;
  let tod = 12000;
  try { tod = world.getTimeOfDay(); } catch (e) { /* ignore */ }

  const vs = awakeVillagers(dim, bell, cfg.workerRadius);
  if (!vs.length) return;
  const vMain = V.get(`${bell.x},${bell.y},${bell.z}`);

  // v2.8.0 DUSK: everyone goes home — but a full pack is unloaded at a
  // depot on the way (previously yields sat in villagers overnight).
  if (tod >= 12500) {
    for (const e of vs.slice(0, 16)) {
      const a = assigns.get(e.id);
      if (a && a.type === "deposit") continue;
      if (vMain && carryCount(e) >= 1) {
        const mb = depotBlockFor(dim, vMain, ["food", "warehouse", "construction", "fuel"]);
        if (mb) {
          assigns.set(e.id, { type: "deposit", x: mb.x, z: mb.z, since: tick, ent: e, phase: U.hashId(e.id) % 4 });
          try { if ((e.nameTag || "") !== JOB_TAGS.deposit) e.nameTag = JOB_TAGS.deposit; } catch (err) { /* ignore */ }
          continue;
        }
      }
      assigns.delete(e.id);
      try { if (e.nameTag) e.nameTag = ""; } catch (err) { /* ignore */ }
    }
    for (const [vid, a] of [...assigns]) {
      if (a.type !== "deposit") { assigns.delete(vid); continue; }
      if (!a.ent || !U.isValidEntity(a.ent)) { assigns.delete(vid); continue; }
      const vl = a.ent.location;
      if (Math.max(Math.abs(a.x - vl.x), Math.abs(a.z - vl.z)) <= 3) {
        if (vMain && depositCarry(dim, vMain, a.ent, tick)) {
          assigns.delete(vid);
          try { a.ent.nameTag = ""; } catch (err) { /* ignore */ }
        }
      }
    }
    return;
  }

  refreshRoadJobs(dim, bell, tick);
  if (vMain) {
    refreshZoneJobs(dim, vMain, bell, tick);
    zoneBorderParticles(dim, vMain, bell, tick); // v2.8.0 green border sparkle
    zoneGapGuide(vMain, tick, tod); // v2.10.0: "orman kesilmiyor" => tell WHY
    // v2.11.0 KAMPYOLU: bind anchor claimers by presence (work slots),
    // keep camps/workshop anchors alive, move camps when clusters run dry.
    ANCHOR.notePresence(dim, vMain, tick, tod);
    zoneCampUpkeep(dim, vMain, tick, tod);
    workshopAnchorUpkeep(dim, vMain, tick);
  }

  // v2.7.0: profession census of the awake crew — decides which orders
  // an unemployed villager may take (only ownerless professions).
  const profCounts = new Map();
  const profOf = new Map();
  for (const e of vs) {
    const p = professionOf(e, dim, tick);
    profOf.set(e.id, p);
    if (p) profCounts.set(p, (profCounts.get(p) || 0) + 1);
  }
  // v2.11.0 ANCHOR-CLAIM ALIGNMENT: vanilla assigned this villager to the
  // workshop (they CLAIMED its anchor and stand there in work slots) — the
  // addon's tag follows vanilla's choice instead of fighting it. Only for
  // workshops with side anchors (non-POI stations); POI-station professions
  // are read by proximity (villagers.js) as before.
  if (vMain) {
    for (const w of WS.list(vMain)) {
      const bw = ANCHOR.workshopWorker(vMain, w.id);
      if (!bw) continue;
      for (const e of vs) {
        if (e.id !== bw) continue;
        if (profTag(e) !== w.type) {
          setProfTag(e, w.type);
          profOf.set(e.id, w.type);
          profCounts.set(w.type, (profCounts.get(w.type) || 0) + 1);
          jobsStats.converted = (jobsStats.converted || 0) + 1;
          LOG.info(`[CV] ${w.id} çapasını sahiplenen köylü §f${w.type}§r sayıldı (vanilla ataması, …${String(e.id).slice(-6)})`);
          try { world.sendMessage(`§a[CV]§7 Bir köylü §f${w.type}§7 istasyonunu sahiplendi ve işbaşında (vanilla yürüyüşü).`); } catch (e2) { /* ignore */ }
        }
        break;
      }
    }
  }

  // v2.9.0 PROFESSION LIFECYCLE (user rule 12.10, "güzel bir döngü"):
  // station broken/removed => the tagged villager falls back into the
  // UNEMPLOYED pool => can be assigned to newly added stations/orders.
  // One idle tagged villager is checked per pass (round-robin, cheap).
  if (vMain && vs.length) {
    profWatchCursor = (profWatchCursor + 1) % vs.length;
    try {
      const pw = vs[profWatchCursor];
      if (pw && !assigns.has(pw.id)) profWatchdog(dim, vMain, pw, tick);
    } catch (e) { /* ignore */ }
    // farm-gap guidance: mature/plantable fields but NO farmer and NO
    // unemployed villager => tell the player what to do (rate-limited)
    if (tick - farmGapWarn > 6000 && (profCounts.get("farmer") || 0) === 0) {
      let idle = 0;
      for (const e2 of vs) if (!profOf.get(e2.id)) idle++;
      if (idle === 0) {
        refreshFarmJobs(dim, bell, tick);
        if (farmJobs.list.length) {
          farmGapWarn = tick;
          try { world.sendMessage("§e[CV]§7 Tarlada iş var ama hiç §fçiftçi§7/§fişsiz§7 köylü yok: bir köylünün iş istasyonunu kırın/kaldırın — işsiz düşen köylü çiftçiliğe (veya yeni istasyona) atanır."); } catch (e) { /* ignore */ }
          LOG.info("[CV] tarla boşluğu uyarısı: çiftçi yok, mesleksiz yok, tarlada iş bekliyor");
        }
      }
    }
  }

  // v2.10.0 LABEL WATCHDOG (user: "üzerlerinde 'depoya boşaltıyor',
  // 'sipariş taşıyor' yazıyor ama herhangi bir iş yapmıyorlar"): a nametag
  // without a live assign or production cycle is a lie — clear it. Stale
  // labels were also what made old builds LOOK like phantom steering.
  for (const e of vs) {
    try {
      const nt = e.nameTag || "";
      if (!nt || assigns.has(e.id) || P.isCarrier(e.id)) continue;
      if (JOB_TAG_SET.has(nt)) e.nameTag = "";
    } catch (err) { /* ignore */ }
  }

  const ctx = { profCounts }; // shared per-pass cache (meal/light material)
  for (const v of vs.slice(0, 16)) {
    const vl = v.location;
    if (PATH.unstuckBuried(dim, v, Math.floor(vl.x), Math.floor(vl.y), Math.floor(vl.z))) {
      jobsStats.rescues++; // same-ground sidestep only (path.js) — no roofs
      continue;
    }
    const prof = profOf.get(v.id);
    ctx.entity = v;
    let a = assigns.get(v.id);
    // v2.8.0: a FULL pack beats every errand except eating — the worker
    // is rerouted to a depot instead of dropping loot on the ground.
    // v2.9.0: ...except ORDER trips — a production carrier's pack belongs
    // to its cycle (materials/product); the deliver leg unloads it.
    // v2.10.0 (user: "envanteri dolunca ve dolmamışsa bile öğlen ve akşam
    // olmadan önce getirsinler"): scheduled deposit windows on top of the
    // full-pack reroute — a half-full pack goes home at noon and at dusk.
    // v2.11.0: windows follow the vanilla Bedrock schedule
    // (minecraft.wiki Villager §Schedules): work 0–2000 & 10000–11000,
    // gather-at-bell 8000–10000, home 11000→, sleep 12000+. Commutes pass
    // through the village — that is when a half-full pack rides home.
    const depositWindow = tod <= 2200 || (tod >= 7800 && tod <= 10200) || (tod >= 10800 && tod <= 14200);
    if (a && a.type !== "deposit" && a.type !== "meal" && a.type !== "order" && vMain &&
        (carryEmptySlots(v) <= 0 || (depositWindow && carryCount(v) >= 8 && !P.isCarrier(v.id)))) {
      const mb = depotBlockFor(dim, vMain, ["food", "warehouse", "construction", "fuel"]);
      if (mb) {
        a = { type: "deposit", x: mb.x, z: mb.z, since: tick, ent: v, phase: U.hashId(v.id) % 4 };
        assigns.set(v.id, a);
      }
    }
    if (a && !a.ent) a.ent = v;
    if (a) {
      let valid = tick - a.since <= 2400;
      if (valid && a.type === "road") valid = !!R.columnDamaged(dim, a.x, a.z, bell.y);
      if (valid && a.type === "light") valid = L.isDarkPoint(dim, bell, a.x, a.z);
      if (valid && a.type === "order") {
        const vv = V.get(`${bell.x},${bell.y},${bell.z}`);
        const ww = vv && WS.get(vv, a.wid);
        const cyc = vv && ww && P.getActive(vv, ww);
        // v2.9.0 WORKER BINDING: once a carrier owns the cycle, nobody
        // else may follow it (bystanders used to crowd the same depot)
        valid = !!cyc && (!cyc.workerId || cyc.workerId === v.id);
        if (valid) {
          const t = P.legTarget(dim, vv, cyc); // follow the leg (depot/station/depot)
          if (t) { a.x = t.x; a.z = t.z; }
        }
      }
      if (valid && a.type === "farm") {
        valid = tick - a.since <= 2400; // natural walking takes time; harvest validates the block itself
      }
      // v2.7.0: a professional must drop a foreign order if it got one
      // before the rule change (stale assigns from older builds)
      if (valid && a.type === "order" && prof) {
        const vv = V.get(`${bell.x},${bell.y},${bell.z}`);
        const ww = vv && WS.get(vv, a.wid);
        if (ww && ww.type !== prof) valid = false;
      }
      if (!valid) {
        // v2.11.0: expired WITHOUT ever arriving => blacklist the point for
        // 5 min so the job ROTATES instead of re-picking the same spot that
        // no vanilla commute ever passes. (Movement is vanilla now; this is
        // the replacement for the old walker's nopath release.)
        try {
          const rot = a.type === "farm" || a.type === "light" || a.type === "road" || a.type === "wall" || a.type === "sweep";
          if (rot && U.isValidEntity(v)) {
            const vl2 = v.location;
            if (Math.max(Math.abs(a.x - vl2.x), Math.abs(a.z - vl2.z)) > arriveRadius(a.type)) {
              noGo.set(v.id, { x: a.x, z: a.z, until: tick + 6000 });
              jobsStats.giveups = (jobsStats.giveups || 0) + 1;
              U.debug(2, `iş hiç varılmadan bayatladı → nokta kara listeye (${a.type} @${a.x},${a.z})`, dim, vl2);
            }
          }
        } catch (e) { /* ignore */ }
        assigns.delete(v.id); a = undefined;
      }
    }
    if (!a) {
      a = pickJob(dim, bell, vl, tick, cfg, prof, ctx);
      if (!a) {
        try { if (v.nameTag) v.nameTag = ""; } catch (e) { /* ignore */ }
        continue;
      }
      a.ent = v;
      if (a.phase === undefined) a.phase = U.hashId(v.id) % 4;
      assigns.set(v.id, a);
      jobsStats.assigned++;
    }
    try {
      const want = JOB_TAGS[a.type] || "";
      if ((v.nameTag || "") !== want) v.nameTag = want;
    } catch (e) { /* ignore */ }
    const d = Math.max(Math.abs(a.x - vl.x), Math.abs(a.z - vl.z));
    // v2.11.0: movement is the vanilla POI schedule (anchor.js). Arrival
    // simply HAPPENS when a commute/wander brings the worker to the job —
    // the radius covers standing next to a claimed site + its short
    // "gather supplies" steps. Nothing here ever writes a position.
    const arriveR = arriveRadius(a.type); // shared with the 4t monitor
    if (d <= arriveR) {
      jobsStats.arrivals++;
      if (a.type === "order") {
        const v2 = V.get(`${bell.x},${bell.y},${bell.z}`);
        const w = v2 && WS.get(v2, a.wid);
        if (v2 && w) P.onArrival(dim, v2, w, v, tick);
      } else if (a.type === "farm") {
        const vv = V.get(`${bell.x},${bell.y},${bell.z}`);
        if (vv) chainFarmWork(dim, vv, v, a); // chain the plots near the worker
        assigns.delete(v.id); // done or stale => re-pick next pass
      } else if (a.type === "forest" || a.type === "quarry") {
        const vv = V.get(`${bell.x},${bell.y},${bell.z}`);
        if (vv) chainZoneWork(dim, vv, v, a); // fell the whole trunk + neighbours
        assigns.delete(v.id);
      } else if (a.type === "sweep") {
        const vv = V.get(`${bell.x},${bell.y},${bell.z}`);
        if (vv && P.collectMachine(dim, vv, a.wid, v)) { U.spendEnergy(v, 4); assigns.delete(v.id); }
        else assigns.delete(v.id);
      } else if (a.type === "deposit") {
        const vv = V.get(`${bell.x},${bell.y},${bell.z}`);
        if (vv && depositCarry(dim, vv, v, tick)) assigns.delete(v.id);
        else if (carryCount(v) <= 0) assigns.delete(v.id); // nothing left to unload
        else if (tick - a.since > 1200) assigns.delete(v.id); // depots full: give up for now
      } else if (a.type === "meal") {
        const vv = V.get(`${bell.x},${bell.y},${bell.z}`);
        if (vv && eatAtDepot(dim, vv, v, tick)) assigns.delete(v.id);
        else {
          // chest was empty despite the cache: don't loop trips for 2 min
          mealRetry.set(v.id, tick + 2400);
          assigns.delete(v.id);
        }
      } else if (a.type === "wall") {
        if (W.tryBuildAtVillager(dim, bell, v)) U.spendEnergy(v, 6);
        assigns.delete(v.id); // next tick picks the nearest remaining job
      } else if (a.type === "road") {
        let did = false;
        for (let dx = -2; dx <= 2 && !did; dx++) {
          for (let dz = -2; dz <= 2 && !did; dz++) {
            const dmg = R.columnDamaged(dim, a.x + dx, a.z + dz, bell.y);
            if (dmg) did = R.fixAtColumn(dim, v, U.vec(a.x + dx, dmg.y + 1, a.z + dz)) || did;
          }
        }
        if (did) U.spendEnergy(v, 6);
        if (!did) assigns.delete(v.id);
      } else if (a.type === "light") {
        try { v.lookAt(U.vec(a.x, vl.y + 1, a.z)); } catch (e) { /* ignore */ }
        // lighting.js places the torch (worker <=2.5 rule); clear when lit
        if (!L.isDarkPoint(dim, bell, a.x, a.z)) assigns.delete(v.id);
        // v2.8.0: no torch in the construction depot => FREE the worker
        // (old build kept him tagged "fener dikiyor" in an endless loop)
        else if (!B.hasMat(dim, bell, cfg.torchBlock || "minecraft:torch", 1)) { lightStarved = tick; assigns.delete(v.id); }
        else if (tick - a.since > 900) assigns.delete(v.id); // stood too long: release
      }
    }
    // v2.11.0: no mover anywhere — the walker that fought vanilla AI is
    // deleted. A far assign simply expires (2400t) and rotates; zone work
    // only exists around a claimed camp, which vanilla walks the worker to.
  }
}
