// ============================================================
// cv/core/production.js (v2.9.0) — PHYSICAL production cycle
//
// User rule (12.10 report, birebir): "malzemeler sanal olarak alınıp
// yapıldı — kimse sandığa gelip malzemeleri alıp üretim masasına gidip
// kazmaları üretip geri gelip sandığa bırakmadı." Artık HER bacak fiziksel:
//   1) FETCH : worker walks to the depot; materials+fuel are consumed
//              there (all-or-nothing) INTO THE WORKER'S REAL INVENTORY
//              (minecraft:inventory container — the same pack the farm
//              carry model uses). No virtual manifests as source of
//              truth: the pack IS the truth; the manifest only tracks
//              what THIS order put inside (for reload recovery).
//   2) WORK  : only executes when the worker physically STANDS at the
//              station (v2.8 bug: bench crafting fired at the depot
//              because depot+table were adjacent — nothing ever moved).
//              * furnace/blast/smoker => REAL smelting: input+fuel move
//                pack -> machine slots (verified writes), vanilla engine
//                smelts, output moves machine -> pack when the worker
//                is back at the furnace (<=8 blocks; else it waits).
//              * crafting stations    => per-run script crafting that
//                CONSUMES FROM THE PACK and puts the product INTO THE
//                PACK (legal stacks only — unstackables one by one).
//   3) DELIVER: worker walks to the routed depot; output moves
//              pack -> chest with verified container ops. The order is
//              credited ONLY with items PHYSICALLY deposited (v2.8 bug:
//              producedCount += batchesDone even when the deposit had
//              silently failed => "2 kazma siparişi, 1 kazma, tamamlandı").
//              producedCount is now in ITEM units (v2.8 credited BATCHES
//              while quantity counts items => x4 undercount on planks).
//
// Safety: worker lost/despawned => manifest refund (items died with it).
// Worker ALIVE => aborts never refund (that would dupe what the pack
// holds); the idle deposit errand in jobs.js walks leftovers home.
// Reload => persisted manifests rebind to the living worker entity.
// ============================================================
import { world, system, ItemStack } from "@minecraft/server";
import * as V from "./village.js";
import * as D from "./depot.js";
import * as CU from "./container_utils.js";
import * as R from "./recipe.js";
import * as L from "./ledger.js";
import * as O from "./order.js";
import * as WS from "./workshop.js";
import * as LOG from "../../log.js";
import * as U from "../../util.js";

const FUEL_UNITS = {
  "minecraft:stick": 0.5, "minecraft:oak_planks": 1.5, "minecraft:charcoal": 8, "minecraft:coal": 8,
  "minecraft:dried_kelp_block": 80, "minecraft:coal_block": 80, "minecraft:lava_bucket": 100,
  "minecraft:oak_log": 1.5, "minecraft:birch_log": 1.5, "minecraft:spruce_log": 1.5,
  "minecraft:jungle_log": 1.5, "minecraft:acacia_log": 1.5, "minecraft:dark_oak_log": 1.5
};
// v2.11.0 (user: "minecraft'ta sadece meşe kütüğü yok — bir sürü biyom ve
// ağaç çeşidi var"): EVERY burnable wood family is fuel and smelts to
// charcoal. Crimson/warped are fireproof in vanilla, bamboo block burns
// but makes no charcoal — both follow the vanilla rules.
for (const id of U.BURNABLE_LOGS) if (FUEL_UNITS[id] === undefined) FUEL_UNITS[id] = id === "minecraft:bamboo_block" ? 0.5 : 1.5;
for (const id of U.PLANK_IDS) if (FUEL_UNITS[id] === undefined) FUEL_UNITS[id] = 1.5;
// coal first (user preference); logs are the emergency tail (v2.6.0)
const FUEL_PREF = ["minecraft:coal", "minecraft:charcoal", "minecraft:coal_block", "minecraft:dried_kelp_block", "minecraft:oak_planks", "minecraft:stick", "minecraft:lava_bucket"];
const LOG_FUEL = U.BURNABLE_LOGS.filter(id => id !== "minecraft:bamboo_block");
const FUEL_DEPOTS = ["fuel", "warehouse", "construction"];
const BEST_FUEL_UNIT = 8;
const CARRY_SLOTS = 8; // one stack per material + one fuel stack must fit
const VANILLA_SMELT = {
  "minecraft:raw_iron": "minecraft:iron_ingot", "minecraft:raw_copper": "minecraft:copper_ingot",
  "minecraft:raw_gold": "minecraft:gold_ingot", "minecraft:potato": "minecraft:baked_potato",
  "minecraft:beef": "minecraft:cooked_beef", "minecraft:porkchop": "minecraft:cooked_porkchop",
  "minecraft:chicken": "minecraft:cooked_chicken", "minecraft:mutton": "minecraft:cooked_mutton",
  "minecraft:cod": "minecraft:cooked_cod", "minecraft:salmon": "minecraft:cooked_salmon",
  "minecraft:oak_log": "minecraft:charcoal"
};
// v2.11.0: player-smelted charcoal from ANY burnable log (sweep credit)
for (const id of U.BURNABLE_LOGS) {
  if (/bamboo/.test(id)) continue; // bamboo block does not smelt to charcoal
  if (VANILLA_SMELT[id] === undefined) VANILLA_SMELT[id] = "minecraft:charcoal";
}
const FURNACES = ["minecraft:furnace", "minecraft:blast_furnace", "minecraft:smoker", "minecraft:lit_furnace", "minecraft:lit_blast_furnace", "minecraft:lit_smoker"];

function routeDepot(itemId) {
  if (/(bread|cooked_|carrot|potato|beetroot|apple|_pie|cookie|stew)/.test(itemId)) return "food";
  if (FUEL_UNITS[itemId]) return "fuel";
  if (/(wall|torch|lantern|fence|gate|_path|^minecraft:gravel$)/.test(itemId)) return "construction";
  return "warehouse";
}

const active = new Map(); // cycleKey -> cycle
function cycleKey(v, w) { return v.id + "|" + w.id; }

// ---------- worker pack helpers ----------
function packOf(worker) {
  try {
    const c = worker && worker.getComponent ? worker.getComponent("minecraft:inventory") : undefined;
    return c ? c.container : undefined;
  } catch (e) { return undefined; }
}
function workerValid(cy) {
  return !!(cy && cy.workerEnt && U.isValidEntity(cy.workerEnt));
}
export function isCarrier(vid) {
  for (const [, cy] of active) if (cy.workerId === vid) return true;
  return false;
}
// entity lookup for reload rebind (world.getEntity with a village-scan fallback)
function findEntity(dim, v, id) {
  if (!id) return undefined;
  try { const e = world.getEntity(id); if (e && U.isValidEntity(e)) return e; } catch (err) { /* ignore */ }
  try {
    for (const t of ["minecraft:villager_v2", "minecraft:villager"]) {
      for (const e of dim.getEntities({ type: t, location: v.bell, maxDistance: 256 })) {
        if (e.id === id) return e;
      }
    }
  } catch (err) { /* ignore */ }
  return undefined;
}

// ---------- carry persistence (reload-safe) ----------
function carryKey(v) { return `cv:v:${v.id}:carry`; }
function persistCarry(v, cy) {
  try {
    let m = {};
    const raw = world.getDynamicProperty(carryKey(v));
    if (typeof raw === "string") m = JSON.parse(raw) || {};
    m[cy.wid] = {
      orderId: cy.orderId, recipe: cy.recipeId, leg: cy.leg,
      items: cy.carryManifest || [], fuel: cy.fuelManifest || [],
      workerId: cy.workerId || null, toProduce: cy.toProduce || 0,
      output: cy.output || null, execs: cy.execs || 1,
      furnace: cy.furnaceLoc || null, furnaceLoaded: !!cy.furnaceLoaded,
      crafted: !!cy.crafted
    };
    world.setDynamicProperty(carryKey(v), JSON.stringify(m));
  } catch (e) { /* ignore */ }
}
function clearPersisted(v, wid) {
  try {
    const raw = world.getDynamicProperty(carryKey(v));
    if (typeof raw !== "string") return;
    const m = JSON.parse(raw) || {};
    delete m[wid];
    world.setDynamicProperty(carryKey(v), JSON.stringify(m));
  } catch (e) { /* ignore */ }
}
// on reload: rebind living workers to their cycles; refund ONLY manifests
// whose worker entity is gone (its pack died with it — refunding while the
// pack lives would dupe, v2.7.0 lesson).
export function recoverCarries(dim, v) {
  try {
    const raw = world.getDynamicProperty(carryKey(v));
    if (typeof raw !== "string") return;
    const m = JSON.parse(raw) || {};
    for (const wid of Object.keys(m)) {
      const key = v.id + "|" + wid;
      if (active.has(key)) continue; // live cycle keeps it
      const cy0 = m[wid];
      const w = WS.get(v, wid);
      const order = (v.orders || O.listOrders(v)).find(od => od.id === cy0.orderId);
      const ent = w ? findEntity(dim, v, cy0.workerId) : undefined;
      const manifest = (cy0.items || []).concat(cy0.fuel || []);
      if (ent && w) {
        // REBIND: the worker still carries the goods — resume the cycle
        const cy = {
          wid, orderId: cy0.orderId, recipeId: cy0.recipe,
          leg: cy0.leg === "fetch" ? "fetch" : cy0.leg,
          carryManifest: cy0.items || [], fuelManifest: cy0.fuel || [],
          startTick: system.currentTick, workerSeen: system.currentTick,
          workerId: ent.id, workerEnt: ent,
          station: { x: w.jobBlock.x, y: w.jobBlock.y, z: w.jobBlock.z },
          output: cy0.output || null, toProduce: cy0.toProduce || 0,
          execs: cy0.execs || 1, expectedOut: cy0.toProduce || 0,
          furnaceLoc: cy0.furnace || null, furnaceLoaded: !!cy0.furnaceLoaded,
          crafted: !!cy0.crafted, workEnd: 0, drainTick: 0, recovered: true
        };
        if (cy.leg === "work" && cy.crafted) cy.workEnd = system.currentTick + 40; // finish the bench pause
        active.set(key, cy);
        if (order && order.status !== "in_progress") { order.status = "in_progress"; O.saveOrders(v); }
        LOG.warn(`[CV] taşıma yeniden bağlandı (${wid}): işçi sağ, ${manifest.length} kalem çantada, bacak=${cy.leg}`);
      } else {
        for (const it of manifest) D.addToDepot(dim, v, routeDepot(it.itemId), it.itemId, it.count);
        if (order && order.status === "in_progress") { order.status = "ready"; O.saveOrders(v); }
        LOG.warn(`[CV] taşıma kurtarıldı (${wid}): işçi yok → ${manifest.length} kalem depoya iade`);
      }
    }
    world.setDynamicProperty(carryKey(v), JSON.stringify({}));
  } catch (e) { /* ignore */ }
}

// ---------- targets for the dispatcher ----------
function depotTarget(dim, v, types) {
  D.loadDepots(v);
  for (const t of types) {
    const d = v.depots.get(t);
    if (!d) continue;
    for (const b of d.blocks) {
      if (D.containerAt(dim, b)) return b;
    }
  }
  return undefined;
}
export function legTarget(dim, v, cy) {
  // v2.11.0 KAMPYOLU: every leg must be reachable by VANILLA commutes —
  // prefer the workshop's OWN linked chests (they sit next to the station
  // the worker stands at in work slots); fall back to any depot chest.
  const w = WS.get(v, cy.wid);
  if (cy.leg === "fetch") {
    if (w && w.inputChest) return { x: w.inputChest.x, y: w.inputChest.y, z: w.inputChest.z };
    return depotTarget(dim, v, ["warehouse", "construction", "food", "fuel"]);
  }
  if (cy.leg === "deliver") {
    const c = w && (w.outputChest || w.orderChest);
    if (c) return { x: c.x, y: c.y, z: c.z };
    return depotTarget(dim, v, [...D.depotPriority(cy.output || "minecraft:stick"), "warehouse"]);
  }
  return cy.station; // work
}

export function getActive(v, w) { return active.get(cycleKey(v, w)); }

// ---------- start a cycle ----------
export function startCycle(dim, v, w, tick) {
  const key = cycleKey(v, w);
  if (active.has(key)) return false;
  const readyOnes = (v.orders || O.listOrders(v)).filter(o => o.status === "ready" && o.workshopType === w.type);
  const order = readyOnes.find(o => o.requester === "player") || readyOnes[0];
  if (!order) return false;
  const recipe = R.findByOutput(order.itemId);
  if (!recipe) return false;
  const cy = {
    wid: w.id, orderId: order.id, recipeId: recipe.id,
    leg: "fetch", carryManifest: [], fuelManifest: [],
    startTick: tick, workerSeen: tick, workerId: null, workerEnt: undefined,
    station: { x: w.jobBlock.x, y: w.jobBlock.y, z: w.jobBlock.z },
    output: null, toProduce: 0, expectedOut: 0, execs: 1,
    furnaceLoc: null, furnaceLoaded: false, crafted: false, workEnd: 0, drainTick: 0
  };
  active.set(key, cy);
  order.status = "in_progress";
  O.saveOrders(v);
  LOG.info(`[CV] üretim döngüsü başladı: ${order.id} ${recipe.id} (${w.id}) — fetch bacağı`);
  return true;
}

// availability INCLUDING the order's own reservation (v2.8 deadlock:
// validate reserved the batch, doFetch then saw stock-minus-own-reservation
// and aborted "missing" forever on tight stock)
function availForOrder(v, order, itemId) {
  let n = D.availableSmart(v, itemId);
  for (const r of (order.reserved || [])) if (r.typeId === itemId) n += r.count;
  return n;
}

// ---------- FETCH: depot chest -> worker's REAL pack ----------
function doFetch(dim, v, w, cy, tick, worker) {
  const recipe = R.get(cy.recipeId);
  const order = O.listOrders(v).find(o => o.id === cy.orderId);
  if (!recipe || !order) { abortCycle(dim, v, cy, "no_recipe"); return; }
  const pack = packOf(worker);
  if (!pack) { order.status = "waiting_materials"; abortCycle(dim, v, cy, "no_pack", true); return; }
  const remaining = order.quantity - (order.producedCount || 0); // ITEM units
  if (remaining <= 0) { finishOrder(v, order); abortCycle(dim, v, cy, "already_done"); return; }

  // 1) pick a material per input (all-or-nothing per run)
  const inputs = [];
  for (const inp of recipe.inputs) {
    const cands = [inp.itemId, ...(inp.alternatives || [])];
    let chosen = null;
    for (const c of cands) {
      if (availForOrder(v, order, c) >= inp.count) { chosen = c; break; }
    }
    if (!chosen) { order.status = "waiting_materials"; abortCycle(dim, v, cy, "missing:" + inp.itemId, true); return; }
    inputs.push({ typeId: chosen, per: inp.count });
  }
  // 2) how many runs fit in ONE trip?
  let execs = Math.ceil(remaining / recipe.outputCount);
  for (const it of inputs) {
    execs = Math.min(execs, Math.floor(availForOrder(v, order, it.typeId) / it.per));
    execs = Math.min(execs, Math.floor(64 / it.per)); // one stack per material
  }
  execs = Math.min(execs, Math.floor(64 / recipe.outputCount));
  execs = Math.min(execs, 32);
  if (inputs.length + (recipe.fuelRequired > 0 ? 1 : 0) > CARRY_SLOTS) execs = 0;
  // 3) furnace-aware fuel planning
  let fuelTake = [];
  let fuelInUnits = 0;
  const jb = w.jobBlock;
  const isFurnace = FURNACES.includes(U.typeId(U.getBlock(dim, jb)));
  if (recipe.fuelRequired > 0 && isFurnace) {
    const c0 = D.containerAt(dim, jb);
    let fuelRoom = 64;
    if (c0) {
      let fs; try { fs = c0.getItem(1); } catch (e) { fs = undefined; }
      if (fs && FUEL_UNITS[fs.typeId]) fuelInUnits = fs.amount * FUEL_UNITS[fs.typeId];
      fuelRoom = Math.max(0, 64 - (fs ? fs.amount : 0));
    }
    execs = Math.min(execs, Math.floor((fuelInUnits + fuelRoom * BEST_FUEL_UNIT) / recipe.fuelRequired));
  }
  if (execs < 1) { order.status = "waiting_materials"; abortCycle(dim, v, cy, "batch_empty", true); return; }
  if (recipe.fuelRequired > 0) {
    const deficit = Math.max(0, execs * recipe.fuelRequired - fuelInUnits);
    if (deficit > 0) {
      let ft = pickUnitsAny(v, FUEL_DEPOTS, FUEL_UNITS, FUEL_PREF, deficit) ||
               pickUnitsAny(v, FUEL_DEPOTS, FUEL_UNITS, LOG_FUEL, deficit);
      if (ft && isFurnace) ft.count = Math.min(ft.count, Math.max(0, 64 - fuelSlotAmount(dim, jb)));
      if (ft && ft.count > 0) {
        const units = ft.count * (FUEL_UNITS[ft.typeId] || 0);
        execs = Math.min(execs, Math.floor((fuelInUnits + units) / recipe.fuelRequired));
        fuelTake = [ft];
      } else {
        const inside = Math.floor(fuelInUnits / recipe.fuelRequired);
        if (inside >= 1) execs = Math.min(execs, inside);
        else { order.status = "waiting_fuel"; abortCycle(dim, v, cy, "no_fuel", true); return; }
      }
    }
  }
  if (execs < 1) { order.status = "waiting_fuel"; abortCycle(dim, v, cy, "no_fuel", true); return; }
  // 4) v2.9.0 PACK CAPACITY: everything must physically FIT the worker
  const requests = inputs.map(it => ({ typeId: it.typeId, count: it.per * execs }));
  let fits = requests.every(r => CU.canAddItems(pack, r.typeId, r.count)) &&
             fuelTake.every(f => CU.canAddItems(pack, f.typeId, f.count));
  while (!fits && execs > 1) {
    execs--;
    for (let i = 0; i < requests.length; i++) requests[i].count = inputs[i].per * execs;
    if (fuelTake.length) fuelTake[0].count = Math.min(fuelTake[0].count, Math.max(1, Math.ceil(execs * recipe.fuelRequired / (FUEL_UNITS[fuelTake[0].typeId] || 1))));
    fits = requests.every(r => CU.canAddItems(pack, r.typeId, r.count)) &&
           fuelTake.every(f => CU.canAddItems(pack, f.typeId, f.count));
  }
  if (!fits) { order.status = "waiting_materials"; abortCycle(dim, v, cy, "pack_full", true); return; }

  // 5) consume from chests (all-or-nothing) -> straight into the pack
  if (!consumeFromAny(dim, v, ["warehouse", "construction", "food", "fuel"], requests)) {
    order.status = "waiting_materials"; abortCycle(dim, v, cy, "consume_fail", true); return;
  }
  const manifest = [];
  for (const r of requests) {
    const left = CU.addItemsSafe(pack, r.typeId, r.count);
    if (left > 0) { // should not happen (canAdd pre-check): bank the rest, shrink the trip
      D.addToDepot(dim, v, routeDepot(r.typeId), r.typeId, left);
      LOG.warn(`[CV] çantaya sığmadı: ${left}x ${r.typeId} depoya geri`);
    }
    if (r.count - left > 0) manifest.push({ itemId: r.typeId, count: r.count - left });
  }
  O.releaseForItems(v, order, manifest.map(mm => ({ typeId: mm.itemId, count: mm.count })));
  const fuelManifest = [];
  if (fuelTake.length && fuelTake[0].count > 0) {
    if (!consumeFromAny(dim, v, FUEL_DEPOTS, fuelTake)) {
      refundItems(dim, v, manifest);
      abortCycle(dim, v, cy, "fuel_consume_fail", true);
      return;
    }
    const fl = fuelTake[0];
    const left = CU.addItemsSafe(pack, fl.typeId, fl.count);
    if (left > 0) D.addToDepot(dim, v, routeDepot(fl.typeId), fl.typeId, left);
    if (fl.count - left > 0) fuelManifest.push({ itemId: fl.typeId, count: fl.count - left });
  }
  // trip size may have shrunk at the pack step — recompute from what is REALLY carried
  let eff = Math.ceil(remaining / recipe.outputCount);
  for (let i = 0; i < inputs.length; i++) {
    const got = (manifest.find(mm => mm.itemId === inputs[i].typeId) || { count: 0 }).count;
    eff = Math.min(eff, Math.floor(got / inputs[i].per));
  }
  if (eff < 1) { refundItems(dim, v, manifest); refundItems(dim, v, fuelManifest); order.status = "waiting_materials"; abortCycle(dim, v, cy, "pack_overflow", true); return; }

  cy.carryManifest = manifest;
  cy.fuelManifest = fuelManifest;
  cy.execs = eff;
  cy.expectedOut = eff * recipe.outputCount;
  cy.toProduce = 0;
  cy.crafted = false;
  cy.leg = "work";
  cy.startTick = tick;
  persistCarry(v, cy);
  LOG.info(`[CV] malzeme çantaya alındı (${w.id}): ${manifest.map(c => c.count + "x " + c.itemId.replace("minecraft:", "")).join(", ")}${fuelManifest.length ? " + yakıt " + fuelManifest.map(c => c.count + "x " + c.itemId.replace("minecraft:", "")).join(", ") : ""} → ${eff} batch`);
}
function fuelSlotAmount(dim, jb) {
  try {
    const c = D.containerAt(dim, jb);
    if (!c) return 0;
    const fs = c.getItem(1);
    return fs ? fs.amount : 0;
  } catch (e) { return 0; }
}
function pickUnitsAny(v, types, table, pref, needUnits) {
  for (const id of pref) {
    if (!table[id]) continue;
    let have = 0;
    for (const t of types) have += D.available(v, t, id);
    if (have <= 0) continue;
    return { typeId: id, count: Math.min(have, Math.ceil(needUnits / table[id])) };
  }
  return null;
}

// ---------- pack <-> machine slot (verified both ways) ----------
function movePackToSlot(pack, c, slot, itemId, wantN) {
  let cur; try { cur = c.getItem(slot); } catch (e) { return 0; }
  if (cur && cur.typeId !== itemId) return 0; // foreign stack: come back later
  const maxA = CU.maxStackOf(itemId);
  const room = cur ? Math.max(0, maxA - cur.amount) : maxA;
  const have = CU.countItems(pack, itemId);
  const n = Math.min(wantN, have, room);
  if (n <= 0) return 0;
  // remove from the pack FIRST (verified), then insert with read-back;
  // a failed insert goes straight back into the pack (it always fits —
  // we just vacated the space).
  if (!CU.removeItemsExact(pack, [{ typeId: itemId, count: n }])) return 0;
  const want = (cur ? cur.amount : 0) + n;
  try {
    c.setItem(slot, new ItemStack(itemId, want));
    const back = c.getItem(slot);
    if (!back || back.amount !== want || back.typeId !== itemId) throw new Error("write-verify");
  } catch (e) {
    CU.addItemsSafe(pack, itemId, n);
    return 0;
  }
  return n;
}
function moveSlotToPack(dim, v, c, slot, itemId, worker) {
  // extract ONLY into a pack that is physically at the machine (<=8 blocks)
  let it; try { it = c.getItem(slot); } catch (e) { return 0; }
  if (!it || it.typeId !== itemId || it.amount <= 0) return 0;
  const pack = packOf(worker);
  if (!pack) return 0;
  if (!CU.canAddItems(pack, itemId, it.amount)) return 0; // pack full: wait
  if (!CU.clearSlot(c, slot)) {
    let still; try { still = c.getItem(slot); } catch (e) { still = undefined; }
    if (still) return 0; // clear failed (old Bedrock bug): retry next tick, never credit
  }
  const left = CU.addItemsSafe(pack, itemId, it.amount);
  if (left > 0) {
    // pack rejected part of it (race): put the remainder BACK into the slot
    try { c.setItem(slot, new ItemStack(itemId, left)); } catch (e) {
      D.addToDepot(dim, v, routeDepot(itemId), itemId, left); // last resort: bank it
    }
  }
  return it.amount - left;
}

// ---------- WORK: at the station, from the pack ----------
function atStation(cy, worker) {
  try {
    const l = worker.location, s = cy.station;
    return Math.max(Math.abs(l.x - s.x), Math.abs(l.z - s.z)) <= 3 && Math.abs(l.y - s.y) <= 4;
  } catch (e) { return false; }
}
function doWorkArrival(dim, v, w, cy, tick, worker) {
  const recipe = R.get(cy.recipeId);
  if (!recipe) { abortCycle(dim, v, cy, "no_recipe"); return; }
  if (!atStation(cy, worker)) return; // v2.9.0: work happens AT the bench, nowhere else
  const pack = packOf(worker);
  if (!pack) { abortCycle(dim, v, cy, "no_pack"); return; }
  const jb = w.jobBlock;
  const jbId = U.typeId(U.getBlock(dim, jb));
  const inp0 = (cy.carryManifest || [])[0];
  const realPair = inp0 && VANILLA_SMELT[inp0.itemId] === recipe.output;
  if (FURNACES.includes(jbId) && recipe.machine && realPair) {
    const c = D.containerAt(dim, jb);
    if (c) {
      const inp = cy.carryManifest[0];
      const fuel = (cy.fuelManifest || [])[0];
      let s0; try { s0 = c.getItem(0); } catch (e) { s0 = undefined; }
      if (s0 && (!inp || s0.typeId !== inp.itemId)) {
        abortCycle(dim, v, cy, "furnace_busy_other_input"); // materials stay in the pack
        return;
      }
      const loadedInp = movePackToSlot(pack, c, 0, inp.itemId, inp.count);
      if (loadedInp <= 0) { abortCycle(dim, v, cy, "furnace_input_blocked"); return; }
      let loadedFuel = 0;
      if (fuel) loadedFuel = movePackToSlot(pack, c, 1, fuel.itemId, fuel.count);
      // manifests shrink by what physically entered the machine
      inp.count -= loadedInp;
      cy.carryManifest = cy.carryManifest.filter(m => m.count > 0);
      if (fuel) { fuel.count -= loadedFuel; cy.fuelManifest = cy.fuelManifest.filter(m => m.count > 0); }
      cy.furnaceLoaded = true;
      cy.furnaceLoc = { x: jb.x, y: jb.y, z: jb.z };
      cy.output = recipe.output;
      cy.expectedOut = loadedInp; // 1:1 smelt map
      cy.toProduce = 0;
      cy.furnaceStart = tick;
      cy.drainTick = 0;
      persistCarry(v, cy);
      LOG.info(`[CV] gerçek eritme başladı: ${loadedInp}x ${inp.itemId.replace("minecraft:", "")} çantadan fırına (hedef ${loadedInp} çıktı)`);
      return;
    }
  }
  // ---- bench crafting: consume FROM THE PACK, product INTO THE PACK ----
  const perRun = recipe.inputs.map((inp, i) => {
    const mm = (cy.carryManifest || [])[i];
    return { typeId: mm ? mm.itemId : inp.itemId, count: inp.count };
  });
  let runs = cy.execs || 1;
  for (const pr of perRun) {
    const got = CU.countItems(pack, pr.typeId);
    runs = Math.min(runs, Math.floor(got / pr.count));
  }
  if (runs < 1) { abortCycle(dim, v, cy, "craft_inputs_missing"); return; }
  let made = 0, done = 0;
  for (let k = 0; k < runs; k++) {
    if (!CU.canRemoveItems(pack, perRun)) break;
    if (!CU.canAddItems(pack, recipe.output, recipe.outputCount)) break;
    if (!CU.removeItemsExact(pack, perRun)) break;
    const leftOut = CU.addItemsSafe(pack, recipe.output, recipe.outputCount);
    made += recipe.outputCount - leftOut;
    done++;
    if (leftOut > 0) { // canAdd said yes but addItem disagreed: drop it at the bench, never vanish
      U.spawnDrop(dim, jb, recipe.output, leftOut);
      LOG.warn(`[CV] ürün çantaya sığmadı: ${leftOut}x ${recipe.output} tezgâhın önüne düştü`);
      break;
    }
    for (const pr of perRun) {
      const mm = cy.carryManifest.find(m => m.itemId === pr.typeId);
      if (mm) mm.count -= pr.count;
    }
  }
  if (done < 1) { abortCycle(dim, v, cy, "craft_blocked"); return; }
  cy.carryManifest = (cy.carryManifest || []).filter(m => m.count > 0);
  cy.crafted = true;
  cy.output = recipe.output;
  cy.toProduce = made;
  cy.expectedOut = made;
  cy.execs = done;
  cy.workEnd = tick + Math.max(20, recipe.workTicks) * Math.min(done, 16); // bench animation pause
  persistCarry(v, cy);
  U.workerAct(worker, U.vec(jb.x, jb.y + 1, jb.z));
  U.sound(dim, U.vec(jb.x, jb.y, jb.z), "random.orb", 0.3, 1.3);
  LOG.info(`[CV] tezgâh üretimi: ${done} batch → ${made}x ${recipe.output.replace("minecraft:", "")} çantada (${w.id})`);
}

// ---------- tick: furnace polling / bench pause completion (scheduler, 20t) ----------
export function tickProduction(dim, v, tick) {
  for (const [key, cy] of [...active]) {
    if (!key.startsWith(v.id + "|")) continue;
    if (cy.leg !== "work") continue;
    const recipe = R.get(cy.recipeId);
    if (!recipe) continue;
    if (cy.furnaceLoaded && cy.furnaceLoc) {
      const c = D.containerAt(dim, cy.furnaceLoc);
      if (!c) continue;
      let out;
      try { out = c.getItem(2); } catch (e) { out = undefined; }
      const worker = workerValid(cy) ? cy.workerEnt : undefined;
      const near = worker && (() => {
        try {
          const l = worker.location, f = cy.furnaceLoc;
          return Math.max(Math.abs(l.x - f.x), Math.abs(l.z - f.z)) <= 8 && Math.abs(l.y - f.y) <= 6;
        } catch (e) { return false; }
      })();
      // worker gone for good => unload the machine to the depot (last resort)
      if (!worker && tick - (cy.workerSeen || tick) > 1200) {
        unloadFurnaceToDepot(dim, v, cy);
        abortCycle(dim, v, cy, "smelter_left");
        continue;
      }
      const needOut = cy.expectedOut || 1;
      if (out && out.typeId === recipe.output && out.amount >= needOut && near) {
        collectToFurnaceWorker(dim, v, cy, c, out.amount, recipe);
      } else if (out && out.typeId === recipe.output && out.amount > 0 && near) {
        // input+fuel exhausted but trip target not reached => settle, then take the partial
        let s0, s1;
        try { s0 = c.getItem(0); s1 = c.getItem(1); } catch (e) { s0 = s1 = undefined; }
        if (!s0 && !s1) {
          if (!cy.drainTick) cy.drainTick = tick;
          else if (tick - cy.drainTick > 120) collectToFurnaceWorker(dim, v, cy, c, out.amount, recipe);
        } else {
          cy.drainTick = 0;
        }
      } else if (tick - (cy.furnaceStart || cy.startTick) > 600 + needOut * 240) {
        // smelt timeout (fuel died mid-trip etc.): unload & refund, order retries
        unloadFurnaceToDepot(dim, v, cy);
        abortCycle(dim, v, cy, "smelt_timeout");
      }
    } else if (cy.crafted && cy.workEnd && tick >= cy.workEnd) {
      cy.leg = "deliver";
      persistCarry(v, cy);
      LOG.info(`[CV] tezgâh üretimi tamam: ${cy.toProduce}x ${cy.output ? cy.output.replace("minecraft:", "") : "?"} çantada → teslim bacağı`);
    }
  }
}
function collectToFurnaceWorker(dim, v, cy, c, amount, recipe) {
  const worker = cy.workerEnt;
  const moved = moveSlotToPack(dim, v, c, 2, recipe.output, worker);
  if (moved <= 0) return; // pack full / clear failed: retry next production tick
  cy.toProduce = (cy.toProduce || 0) + moved;
  cy.output = recipe.output;
  cy.furnaceLoaded = false;
  cy.leg = "deliver";
  persistCarry(v, cy);
  LOG.info(`[CV] eritme tamam: ${moved}x ${recipe.output.replace("minecraft:", "")} fırından çantaya → teslim bacağı`);
}
function unloadFurnaceToDepot(dim, v, cy) {
  try {
    const c = D.containerAt(dim, cy.furnaceLoc);
    if (c) {
      for (const slot of [0, 1, 2]) {
        let it; try { it = c.getItem(slot); } catch (e) { it = undefined; }
        if (!it) continue;
        if (!CU.clearSlot(c, slot)) {
          let still; try { still = c.getItem(slot); } catch (e) { still = undefined; }
          if (still) continue; // stays in the machine; the sweep job banks it later
        }
        const left = D.addToDepot(dim, v, routeDepot(it.typeId), it.typeId, it.amount);
        if (left > 0) LOG.warn(`[CV] fırın iadesi sığmadı: ${left}x ${it.typeId}`);
        else L.push(v, { kind: "refund", items: [{ itemId: it.typeId, count: it.amount }], by: "furnace_unload" });
      }
    }
  } catch (e) { /* ignore */ }
  cy.furnaceLoaded = false;
}

// ---------- DELIVER: pack -> depot chest, credit ONLY verified deposits ----------
function depositItem(dim, v, pack, typeId, count, kind) {
  // returns physically deposited count (verified container->container moves)
  let left = count;
  const order0 = routeDepot(typeId);
  const types = order0 === "warehouse" ? ["warehouse", "construction", "food", "fuel"] : [order0, "warehouse"];
  for (const t of types) {
    if (left <= 0) break;
    const d = v.depots.get(t);
    if (!d) continue;
    for (const b of d.blocks) {
      if (left <= 0) break;
      const c = D.containerAt(dim, b);
      if (!c) continue;
      const room = CU.roomFor(c, typeId, left);
      if (room <= 0) continue;
      if (CU.moveItems(pack, c, [{ typeId, count: room }])) {
        left -= room;
        L.push(v, { kind: kind || "produce", items: [{ itemId: typeId, count: room }], to: t });
      }
    }
  }
  return count - left;
}
function doDeliver(dim, v, cy, tick, worker) {
  const recipe = R.get(cy.recipeId);
  const order = O.listOrders(v).find(o => o.id === cy.orderId);
  const pack = packOf(worker);
  if (!pack) return; // worker container unreadable this tick: retry later
  D.loadDepots(v);
  const output = recipe ? recipe.output : cy.output;
  const expected = Math.max(0, cy.toProduce || 0);
  const inPack = output ? CU.countItems(pack, output) : 0;
  let delivered = 0;
  if (output && inPack > 0) {
    delivered = depositItem(dim, v, pack, output, Math.min(expected || inPack, inPack), "produce");
    if (delivered <= 0) {
      // depots cannot take anything right now — wait here, retry each pass
      if (!cy.blockedAt) cy.blockedAt = tick;
      if (tick - cy.blockedAt <= 1200) return;
      // blocked too long: close the cycle; the idle deposit errand will
      // still bring the product home later (producedCount NOT credited
      // for undelivered items — no phantom completion, ever).
      LOG.warn(`[CV] teslim depoya sığmadı: ${inPack}x ${output} çantada kaldı (boşaltma angaryası deneyecek)`);
      closeCycle(v, cy, worker, order, 0);
      return;
    }
  }
  cy.blockedAt = 0;
  // leftover order materials/fuel still in the pack go home too (physical)
  for (const m of [...(cy.carryManifest || []), ...(cy.fuelManifest || [])]) {
    const have = CU.countItems(pack, m.itemId);
    const n = Math.min(have, m.count);
    if (n <= 0) continue;
    const dep = depositItem(dim, v, pack, m.itemId, n, "refund");
    if (dep > 0) m.count -= dep;
  }
  cy.carryManifest = (cy.carryManifest || []).filter(m => m.count > 0);
  cy.fuelManifest = (cy.fuelManifest || []).filter(m => m.count > 0);
  const outLeft = output ? CU.countItems(pack, output) : 0;
  const doneDelivering = delivered >= expected || (expected > 0 && outLeft <= 0) || expected <= 0;
  if (!doneDelivering) return; // still output in the pack: keep depositing next pass
  if (expected > 0 && delivered <= 0 && outLeft <= 0) {
    // the pack lost the product (should be impossible) — never credit ghosts
    LOG.warn(`[CV] teslim kaydı: beklenen ${expected}x ${output} çantada yok — kredi YOK, sipariş hazır kalır`);
  }
  closeCycle(v, cy, worker, order, delivered);
}
function closeCycle(v, cy, worker, order, delivered) {
  clearPersisted(v, cy.wid);
  active.delete(v.id + "|" + cy.wid);
  try { if (worker) worker.nameTag = ""; } catch (e) { /* ignore */ }
  if (order) {
    if (delivered > 0) order.producedCount = (order.producedCount || 0) + delivered; // ITEM units
    if ((order.producedCount || 0) >= order.quantity) finishOrder(v, order);
    else { order.status = "ready"; O.saveOrders(v); }
  }
}

function finishOrder(v, order) {
  order.status = "completed";
  order.missing = []; // v2.10.0: closed orders never show stale "eksik"
  order.updatedAtTick = system.currentTick;
  O.releaseAll(v, order);
  O.saveOrders(v);
  LOG.info(`[CV] sipariş tamamlandı: ${order.id} (${order.producedCount}/${order.quantity})`);
  try { world.sendMessage(`§a[CV]§7 Sipariş tamamlandı: §f${order.quantity}x ${order.itemId.replace("minecraft:", "")} §7(depo fiziken ${order.producedCount} aldı)`); } catch (e) { /* ignore */ }
}

// ---------- dispatcher entry point ----------
export function onArrival(dim, v, w, worker, tick) {
  const cy0 = active.get(cycleKey(v, w));
  if (!cy0) return startCycle(dim, v, w, tick);
  // v2.9.0 WORKER BINDING: one carrier per cycle — bystanders never
  // advance legs (the old code let ANY arriving villager craft/deliver).
  if (!cy0.workerId) {
    cy0.workerId = worker.id;
    cy0.workerEnt = worker;
    LOG.info(`[CV] taşıyıcı bağlandı: ${cy0.wid} ← …${String(worker.id).slice(-6)}`);
  } else if (cy0.workerId !== worker.id) {
    return false; // someone else's trip
  }
  const cy = cy0;
  cy.workerEnt = worker;
  cy.workerSeen = tick;
  const legBefore = cy.leg;
  if (cy.leg === "fetch") doFetch(dim, v, w, cy, tick, worker);
  else if (cy.leg === "work" && !cy.furnaceLoaded && !cy.crafted) doWorkArrival(dim, v, w, cy, tick, worker);
  else if (cy.leg === "deliver") doDeliver(dim, v, cy, tick, worker);
  if (cy.leg !== legBefore) U.spendEnergy(worker, 8);
  if (cy.leg === "work" || cy.leg === "deliver") {
    try { worker.lookAt(U.vec(w.jobBlock.x, w.jobBlock.y + 1, w.jobBlock.z)); } catch (e) { /* ignore */ }
  }
  if (cy.leg === "work") {
    cy.puff = (cy.puff || 0) + 1;
    if (cy.puff % 8 === 0) U.particle(dim, U.vec(w.jobBlock.x, w.jobBlock.y + 1, w.jobBlock.z), "minecraft:villager_happy");
  }
  return true;
}

// ---------- abort / cancel / watchdog ----------
// v2.9.0 physical rule: a LIVING worker keeps everything in its pack
// (the idle deposit errand brings it home — refunding on top would dupe).
// Only a GONE worker's manifest is refunded (the items died with it).
function abortCycle(dim, v, cy, reason, keepOrderStatus) {
  if (cy.furnaceLoaded && cy.furnaceLoc) unloadFurnaceToDepot(dim, v, cy);
  if (workerValid(cy)) {
    // v2.10.0 (user: "rezerve edilen malzemeler yok oluyor"): an aborted
    // cycle used to leave its fetched materials as GHOST CARGO in the
    // living worker's pack — invisible to the depot, re-fetched (and
    // re-consumed) by the next cycle => stock "vanished". The manifest
    // now rides home IMMEDIATELY as a verified pack->chest move.
    const pack = packOf(cy.workerEnt);
    if (pack) {
      for (const m of (cy.carryManifest || []).concat(cy.fuelManifest || [])) {
        if (!m || m.count <= 0) continue;
        const dep = depositItem(dim, v, pack, m.itemId, m.count, "refund");
        if (dep > 0) LOG.info(`[CV] iptal iadesi: ${dep}x ${m.itemId} çantadan depoya (doğrulanmış)`);
      }
    }
  } else {
    refundItems(dim, v, (cy.carryManifest || []).concat(cy.fuelManifest || []));
  }
  cy.carryManifest = [];
  cy.fuelManifest = [];
  clearPersisted(v, cy.wid);
  active.delete(v.id + "|" + cy.wid);
  const order = O.listOrders(v).find(o => o.id === cy.orderId);
  if (order && order.status === "in_progress" && !keepOrderStatus) order.status = "ready";
  if (order && !keepOrderStatus) O.saveOrders(v);
  LOG.info(`[CV] döngü iptal (${reason})${order ? " sipariş: " + order.status : ""}${workerValid(cy) ? " — malzeme işçinin çantasında (depoya boşaltılacak)" : ""}`);
}
function refundItems(dim, v, items) {
  for (const it of items || []) {
    if (!it || it.count <= 0) continue;
    const left = D.addToDepot(dim, v, routeDepot(it.itemId), it.itemId, it.count);
    if (left > 0) LOG.warn(`[CV] iade sığmadı: ${left}x ${it.itemId} (düştü)`);
    else L.push(v, { kind: "refund", items: [{ itemId: it.itemId, count: it.count }] });
  }
}

// player cancelled the order: refund everything in flight
export function cancelOrderCycle(dim, v, orderId) {
  let did = false;
  for (const [key, cy] of [...active]) {
    if (!key.startsWith(v.id + "|") || cy.orderId !== orderId) continue;
    abortCycle(dim, v, cy, "cancelled_by_player");
    did = true;
  }
  const order = O.listOrders(v).find(o => o.id === orderId);
  if (order) O.releaseAll(v, order);
  return did;
}

export function watchdog(dim, v, tick) {
  for (const [key, cy] of [...active]) {
    if (!key.startsWith(v.id + "|")) continue;
    // v2.10.0: a cycle nobody ever picked up (carrier never bound) must
    // not pin the order "in_progress" forever (diag: işçi=- workerIdle=729t)
    if (!cy.workerId) {
      if (tick - (cy.startTick || tick) > 2400) {
        const o0 = O.listOrders(v).find(o => o.id === cy.orderId);
        abortCycle(dim, v, cy, "no_carrier");
        if (o0) { o0.status = "ready"; O.saveOrders(v); }
      }
      continue;
    }
    if (cy.leg === "work" && cy.furnaceLoaded && workerValid(cy)) { cy.workerSeen = tick; continue; } // furnace works alone, worker will return
    // v2.11.0: a bound carrier now commutes ON VANILLA SCHEDULE — it goes
    // home and SLEEPS every night (tod 12000→0). The old 1200t leash
    // aborted every cycle at dusk. New rule: dead/gone worker aborts fast,
    // a living worker may be away one full night (14400t) before we give up.
    if (!workerValid(cy) && tick - (cy.workerSeen || tick) > 600) {
      const order0 = O.listOrders(v).find(o => o.id === cy.orderId);
      abortCycle(dim, v, cy, "worker_gone");
      if (order0) { order0.status = "ready"; O.saveOrders(v); }
      continue;
    }
    if (tick - (cy.workerSeen || tick) > 14400) {
      const order = O.listOrders(v).find(o => o.id === cy.orderId);
      abortCycle(dim, v, cy, "worker_left");
      if (order) { order.status = "ready"; O.saveOrders(v); }
    }
  }
}

// ---------- consumption helpers (shared) ----------
function depotContainers(dim, v, types) {
  D.loadDepots(v);
  const out = [];
  for (const t of types) {
    const d = v.depots.get(t);
    if (!d) continue;
    for (const b of d.blocks) {
      const c = D.containerAt(dim, b);
      if (c) out.push([t, c]);
    }
  }
  return out;
}
export function consumeFromAny(dim, v, types, requests) {
  const conts = depotContainers(dim, v, types);
  for (const r of requests) {
    let total = 0;
    for (const [, c] of conts) total += CU.countItems(c, r.typeId);
    if (total < r.count) return false;
  }
  const taken = [];
  const pendLedger = []; // v2.9.0: ledger entries only after FULL success
  for (const r of requests) {
    let left = r.count;
    for (const [t, c] of conts) {
      if (left <= 0) break;
      const have = CU.countItems(c, r.typeId);
      if (have <= 0) continue;
      const take = Math.min(have, left);
      if (!CU.removeItemsExact(c, [{ typeId: r.typeId, count: take }])) {
        for (const q of taken) D.addToDepot(dim, v, q.t, q.typeId, q.count);
        return false;
      }
      taken.push({ t, typeId: r.typeId, count: take });
      pendLedger.push({ kind: "consume", items: [{ itemId: r.typeId, count: take }], from: t, by: "production" });
      left -= take;
    }
    if (left > 0) {
      for (const q of taken) D.addToDepot(dim, v, q.t, q.typeId, q.count);
      return false; // rolled back: NO phantom consume lines (v2.8 ledger leak)
    }
  }
  for (const e of pendLedger) L.push(v, e);
  return true;
}

// ---------- /cv:diag snapshot of live cycles ----------
export function cycleDump(v, tick) {
  const out = [];
  for (const [key, cy] of active) {
    if (!key.startsWith(v.id + "|")) continue;
    out.push({
      wid: cy.wid,
      leg: cy.leg,
      order: cy.orderId || "-",
      idleFor: Math.max(0, tick - (cy.workerSeen || tick)),
      execs: cy.execs || 1,
      expectedOut: cy.expectedOut || 0,
      toProduce: cy.toProduce || 0,
      bound: cy.workerId ? "…" + String(cy.workerId).slice(-6) : "-",
      carry: (cy.carryManifest || []).concat(cy.fuelManifest || []).map(it => `${it.count}x ${String(it.itemId).replace("minecraft:", "")}`)
    });
  }
  return out;
}

// ---------- machine output sweep (v2.5.3) ----------
function furnaceBusy(jb) {
  for (const [, cy] of active) {
    if (cy.furnaceLoaded && cy.furnaceLoc &&
        cy.furnaceLoc.x === jb.x && cy.furnaceLoc.y === jb.y && cy.furnaceLoc.z === jb.z) return true;
  }
  return false;
}
export function machineOutputs(dim, v) {
  const out = [];
  try {
    for (const w of WS.list(v)) {
      const jb = w.jobBlock;
      if (!jb) continue;
      let b;
      try { b = dim.getBlock(jb); } catch (e) { continue; }
      if (!b || !FURNACES.includes(b.typeId)) continue;
      if (furnaceBusy(jb)) continue;
      const c = D.containerAt(dim, jb);
      if (!c) continue;
      let o;
      try { o = c.getItem(2); } catch (e) { continue; }
      if (o && o.amount > 0) out.push({ x: jb.x, y: jb.y, z: jb.z, wid: w.id });
    }
  } catch (e) { /* ignore */ }
  return out;
}
export function collectMachine(dim, v, wid, worker) {
  try {
    const w = WS.get(v, wid);
    if (!w || !w.jobBlock) return false;
    if (!WS.isValid(dim, v, w)) return false;
    const jb = w.jobBlock;
    if (furnaceBusy(jb)) return false;
    const c = D.containerAt(dim, jb);
    if (!c) return false;
    const o = c.getItem(2);
    if (!o || o.amount <= 0) return false;
    const itemId = o.typeId;
    let n = o.amount;
    // v2.9.0: verified clear (raw setItem(undefined) can be silently
    // ignored on some builds => the sweep would bank a GHOST copy)
    if (!CU.clearSlot(c, 2)) {
      let still; try { still = c.getItem(2); } catch (e) { still = undefined; }
      if (still) return false;
    }
    let left = D.addToDepot(dim, v, routeDepot(itemId), itemId, n);
    if (left > 0) left = D.addToDepot(dim, v, "warehouse", itemId, left);
    if (left > 0) { // depot full: put the remainder back (no vanishing)
      try { c.setItem(2, new ItemStack(itemId, left)); } catch (e) { /* ignore */ }
      n -= left;
      if (n <= 0) return false;
    }
    L.push(v, { kind: "sweep", items: [{ itemId, count: n }], to: routeDepot(itemId), by: wid });
    const loc = U.vec(jb.x, jb.y + 1, jb.z);
    U.particle(dim, loc, "minecraft:villager_happy");
    U.sound(dim, loc, "random.pop", 0.4);
    if (worker) U.workerAct(worker, loc);
    LOG.info(`[CV] süpürme: ${n}x ${itemId} (${wid}) → ${routeDepot(itemId)} deposu`);
    return true;
  } catch (e) {
    LOG.warn(`[CV] süpürme hatası: ${e}`);
    return false;
  }
}
