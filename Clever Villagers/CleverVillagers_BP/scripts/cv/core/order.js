// ============================================================
// cv/core/order.js — order registry + paper lifecycle + validation
// Sprint 2 scope: draft -> (paper in order chest) -> validating ->
//   waiting_* | ready.  Production/reservation/courier = Sprint 3+.
// ============================================================
import { world, system, ItemStack } from "@minecraft/server";
import * as V from "./village.js";
import * as D from "./depot.js";
import * as W from "./workshop.js";
import * as R from "./recipe.js";
import * as LOG from "../../log.js";
import * as U from "../../util.js";

const PAPER = "cv:order_paper";

function orders(v) {
  if (v.orders) return v.orders;
  let arr = [];
  try {
    const raw = world.getDynamicProperty(`cv:v:${v.id}:orders`);
    if (typeof raw === "string") arr = JSON.parse(raw) || [];
  } catch (e) { arr = []; }
  v.orders = arr;
  return v.orders;
}
export function saveOrders(v) {
  try { world.setDynamicProperty(`cv:v:${v.id}:orders`, JSON.stringify(v.orders || [])); } catch (e) { /* ignore */ }
}

export function createOrder(v, workshopType, itemId, qty, internal) {
  const recipe = R.findByOutput(itemId);
  if (!recipe) return { ok: false, reason: "recipe_not_found:" + itemId };
  if (recipe.workshop !== workshopType) return { ok: false, reason: `workshop_mismatch:${recipe.workshop}` };
  if (!Number.isFinite(qty) || qty < 1 || qty > 2304) return { ok: false, reason: "bad_qty" };
  if (internal) {
    // v2.9.0: ONE open village order per item, ever (belt & braces with
    // the demandMonitor dedupe — a reload could otherwise stack twins)
    for (const o of orders(v)) {
      if (o.itemId === itemId && !["completed", "cancelled", "failed"].includes(o.status)) {
        return { ok: false, reason: "duplicate_open:" + itemId };
      }
    }
  }
  const id = `o${system.currentTick}_${Math.floor(Math.random() * 46656).toString(36)}`;
  let num = 0;
  try {
    num = (Number(world.getDynamicProperty(`cv:v:${v.id}:seq`) || 0) || 0) + 1;
    world.setDynamicProperty(`cv:v:${v.id}:seq`, String(num));
  } catch (e) { num = orders(v).length + 1; }
  const order = {
    id, num, itemId, quantity: qty, requester: internal ? "village" : "player", workshopType,
    status: "draft", missing: [], failureReason: null,
    createdAtTick: system.currentTick, updatedAtTick: system.currentTick
  };
  if (internal) order.status = "ready"; // village demand: materials pre-checked by monitor
  else {
    // player order replaces a pending village demand for the same job+item (no confusing twins)
    for (const o of orders(v)) {
      if (o.requester === "village" && o.workshopType === workshopType && o.itemId === itemId &&
          !["completed", "cancelled", "failed", "in_progress"].includes(o.status)) {
        releaseAll(v, o);
        o.status = "cancelled";
        o.failureReason = "replaced_by_player_order";
        LOG.info(`[CV] köy talebi iptal (oyuncu siparişi öncelik): ${o.id}`);
      }
    }
  }
  orders(v).push(order);
  saveOrders(v);
  LOG.info(`[CV] sipariş oluşturuldu ${id}: ${qty}x ${itemId} (${workshopType})`);
  return { ok: true, id, order };
}

export function makePaper(v, order) {
  const p = new ItemStack(PAPER, 1);
  p.nameTag = `§eSipariş #${order.num}`;
  p.setLore(paperLore(v, order));
  return p;
}
// needs + live depot state on the paper (draft dahil — user 28.09)
export function needLines(v, order) {
  const recipe = R.findByOutput(order.itemId);
  if (!recipe) return ["§cTarif bilinmiyor"];
  const need = R.materialNeed(recipe, Math.min(recipe.outputCount, order.quantity - (order.producedCount || 0)));
  const lines = [];
  for (const inp of need.items) {
    D.loadDepots(v);
    let phys = 0, own = 0;
    for (const c of [inp.itemId, ...(inp.alternatives || [])]) {
      for (const t of D.depotPriority(c)) phys += D.physical(v, t, c);
      const r = (order.reserved || []).find(x => x.typeId === c);
      if (r) own += r.count;
    }
    const usable = D.availableSmart(v, inp.itemId) + own; // own reservation counts for THIS order
    const name = inp.itemId.replace("minecraft:", "");
    lines.push(`${usable >= inp.count ? "§a" : "§c"}${inp.count}x ${name} §7(depoda ${phys}${own ? ", rezerven " + own : ""})`);
  }
  const totalNeed = R.materialNeed(recipe, order.quantity - (order.producedCount || 0));
  lines.push(`§8kalan toplam: ${totalNeed.items.map(i => (i.count) + "x " + i.itemId.replace("minecraft:", "")).join(", ") || "-"}`);
  if (recipe.fuelRequired > 0) {
    D.loadDepots(v);
    let fuel = 0;
    for (const f of ["minecraft:coal", "minecraft:charcoal", "minecraft:coal_block"]) fuel += D.available(v, "fuel", f);
    lines.push(`${fuel >= recipe.fuelRequired * need.cycles ? "§a" : "§c"}yakıt §7(depoda ${fuel})`);
  }
  return lines;
}
function paperLore(v, order) {
  const lines = [
    `§7Atölye: §f${order.workshopType} §7· §f${order.quantity}x ${order.itemId.replace("minecraft:", "")}`,
    `§7Üretim: §f${order.producedCount || 0}/${order.quantity}`,
    `§7Durum: §f${order.status}`
  ];
  // v2.7.0: WHY is it waiting? (user: "ready de kaldı" — the paper never
  // said what was missing). Show the blocker right on the paper.
  if (order.missing && order.missing.length) {
    lines.push(`§cEksik: §f${order.missing.slice(0, 2).join(", ")}`);
  } else if (order.status === "completed") {
    lines.push(`§aTeslim edildi — kağıdı çıkarabilirsin`);
  } else if (order.status === "cancelled") {
    lines.push(`§8İptal edildi`);
  }
  lines.push(...needLines(v, order).slice(0, 4));
  lines.push(`§8Kağıdı herhangi bir DEPO sandığına koy`);
  return lines;
}

export function findOrder(v, idOrNum) {
  const list = orders(v);
  const clean = String(idOrNum ?? "").trim().replace(/^#/, "");
  if (/^\d+$/.test(clean)) {
    const byNum = list.find(o => String(o.num) === clean);
    if (byNum) return byNum;
  }
  return list.find(o => o.id === idOrNum || o.id === clean);
}
export function listOrders(v) { return orders(v); }
export function cancelOrder(v, id) {
  const o = findOrder(v, id);
  if (!o) return false;
  releaseAll(v, o);
  o.status = "cancelled";
  o.missing = []; // v2.10.0: a closed order never wears a stale "eksik" list
  o.updatedAtTick = system.currentTick;
  saveOrders(v);
  LOG.info(`[CV] sipariş iptal: ${id}`);
  return true;
}

// ---------- depot availability helpers (warehouse + construction) ----------
function depotAvailable(dim, v, itemId, count) {
  D.loadDepots(v);
  let total = D.available(v, "warehouse", itemId) + D.available(v, "construction", itemId);
  return total >= count;
}
function missingList(dim, v, need) {
  const missing = [];
  for (const inp of need.items) {
    const cands = [inp.itemId, ...(inp.alternatives || [])];
    let have = 0;
    for (const c of cands) {
      D.loadDepots(v);
      have += D.available(v, "warehouse", c) + D.available(v, "construction", c);
    }
    if (have < inp.count) missing.push(`${inp.count - have}x ${inp.itemId.replace("minecraft:", "")}`);
  }
  return missing;
}

// ---------- periodic scan: order papers live in ANY depot chest ----------
export function tickOrders(dim, v, tick) {
  D.loadDepots(v);
  const papersOnSite = new Set();
  for (const type of D.DEPOT_TYPES) {
    const d = v.depots.get(type);
    if (!d) continue;
    for (const b of d.blocks) {
      const c = D.containerAt(dim, b);
      if (!c) continue;
      for (let i = 0; i < c.size; i++) {
        let it;
        try { it = c.getItem(i); } catch (e) { continue; }
        if (!it || it.typeId !== PAPER) continue;
        const oid = parseOrderId(it);
        if (!oid) continue;
        // v2.5.3: the suspend-check below compares against ORDER IDS, so
        // store the resolved id (parseOrderId yields the seq number).
        const owner = findOrder(v, oid);
        papersOnSite.add(owner ? owner.id : oid);
        const o = owner;
        if (!o) continue;
        if (["draft", "suspended_no_paper", "validating", "waiting_materials", "waiting_food", "waiting_worker", "waiting_workshop", "station_invalid", "blocked_output_full"].includes(o.status)) {
          let res;
          try {
            res = validateOrder(dim, v, o);
          } catch (err) {
            LOG.warn(`[CV] doğrulama hatası (${o.id}): ${err && err.message ? err.message : err}`);
            continue;
          }
          if (res.status !== o.status || JSON.stringify(res.missing) !== JSON.stringify(o.missing || [])) {
            if (!["ready", "in_progress"].includes(res.status)) releaseAll(v, o);
            o.status = res.status;
            o.missing = res.missing || [];
            o.failureReason = res.reason || null;
            o.updatedAtTick = tick;
            saveOrders(v);
            LOG.info(`[CV] sipariş ${o.id} -> ${o.status}${o.missing.length ? " eksik: " + o.missing.join(",") : ""}`);
          }
        }
        // v2.7.0: the paper itself must always tell the truth (user:
          // "sipariş kağıdı hala ready de duruyordu" after completion).
          // Refresh lore whenever the status/production lines went stale
          // — completed/cancelled included, not only validating states.
          try {
            const lore = it.getLore() || [];
            const wantProd = `§7Üretim: §f${o.producedCount || 0}/${o.quantity}`;
            const wantStatus = `§7Durum: §f${o.status}`;
            if (lore[1] !== wantProd || lore[2] !== wantStatus) {
              it.nameTag = `§eSipariş #${o.num}`;
              it.setLore(paperLore(v, o));
              c.setItem(i, it);
            }
        } catch (e) { /* ignore */ }
      }
    }
  }
  for (const o of orders(v)) {
    if (o.requester === "village") continue; // internal demand has no paper
    if (["ready", "validating", "waiting_materials", "station_invalid", "in_progress"].includes(o.status) && !papersOnSite.has(o.id)) {
      if (o.status !== "in_progress") releaseAll(v, o);
      o.status = "suspended_no_paper";
      o.updatedAtTick = tick;
      saveOrders(v);
      LOG.info(`[CV] sipariş ${o.id} askıda: kağıt depo sandıklarında değil`);
    }
  }
}

function parseOrderId(stack) {
  try {
    const nt = stack.nameTag || "";
    const m = nt.match(/#(\d+)/);
    if (m) return m[1];           // numeric seq
    const m2 = nt.match(/#([a-z0-9_]+)/i);
    if (m2) return m2[1];         // legacy id
    const lore = stack.getLore();
    for (const l of lore) { const mm = String(l).match(/#([a-z0-9_]+)/i); if (mm) return mm[1]; }
  } catch (e) { /* ignore */ }
  return undefined;
}

function markWorkshopOrders(v, w, status) {
  for (const o of orders(v)) {
    if (o.workshopType === w.type && (o.status === "ready" || o.status === "in_progress")) {
      o.status = status;
      saveOrders(v);
    }
  }
}

// ---------- validation chain (v2.2 depot-only) ----------
function validateOrder(dim, v, o) {
  const recipe = R.findByOutput(o.itemId);
  if (!recipe) return { status: "failed", reason: "recipe_not_found" };
  // v2.5.3: prefer a VALID station of the type — a stale/broken duplicate
  // registration must not block production while a good one exists.
  const w = W.findValid(dim, v, recipe.workshop) || W.findByType(v, recipe.workshop);
  if (!w) return { status: "waiting_workshop", reason: "workshop_missing:" + recipe.workshop, missing: ["atölye: /cv:workshop add " + recipe.workshop] };
  if (!W.isValid(dim, v, w)) return { status: "station_invalid", reason: "job_block_missing:" + w.id, missing: ["atölye iş bloğu kırık: " + w.id] };

  let worker = false;
  try {
    for (const e of dim.getEntities({ location: w.jobBlock, maxDistance: 24 })) {
      // v2.9.0: children don't count as available workforce
      if ((e.typeId === "minecraft:villager_v2" || e.typeId === "minecraft:villager") && !U.isBaby(e)) { worker = true; break; }
    }
  } catch (e) { /* ignore */ }
  if (!worker) return { status: "waiting_worker", reason: "no_worker_nearby", missing: [] };

  D.loadDepots(v);
  if (!(v.depots.get("warehouse") || { blocks: [] }).blocks.length &&
      !(v.depots.get("construction") || { blocks: [] }).blocks.length) {
    return { status: "waiting_materials", reason: "no_depot", missing: ["depo kaydı (/cv:warehouse add)"] };
  }
  if (recipe.foodRequired > 0) {
    const food = Object.keys(FOODS);
    let have = 0;
    for (const f of food) have += D.available(v, "food", f);
    if (have < recipe.foodRequired * Math.ceil(o.quantity / recipe.outputCount)) {
      return { status: "waiting_food", reason: "food_missing", missing: ["yiyecek (/cv:food add deposu)"] };
    }
  }
  if (recipe.fuelRequired > 0) {
    let have = 0;
    for (const f of ["minecraft:coal", "minecraft:charcoal", "minecraft:coal_block"]) have += D.available(v, "fuel", f);
    if (have <= 0) {
      // v2.6.0 (user): no coal is not a dead end — cut logs burn directly
      // and the demand monitor turns them into charcoal stock.
      for (const t of ["fuel", "warehouse", "construction"]) {
        for (const lg of U.BURNABLE_LOGS.concat(["minecraft:oak_planks"])) { // v2.11.0: tüm ağaç türleri
          have += D.available(v, t, lg);
        }
      }
    }
    if (have <= 0) return { status: "waiting_fuel", reason: "fuel_missing", missing: ["yakıt (/cv:fuel add deposu)"] };
  }
  // PARTIAL fulfillment (user 28.09): one BATCH at a time is enough to be ready
  const remaining = o.quantity - (o.producedCount || 0);
  // v2.6.0: reserve a FULL carrier trip (was: single run => "/stock shows
  // 1 raw copper reserved" while 64 sat idle). Capped at 32 runs/trip.
  let execs = Math.min(Math.ceil(remaining / recipe.outputCount), 32);
  for (const inp of recipe.inputs) {
    let avail = 0;
    for (const cc of [inp.itemId, ...(inp.alternatives || [])]) avail += D.availableSmart(v, cc);
    execs = Math.min(execs, Math.floor(avail / inp.count));
  }
  execs = Math.max(1, execs);
  const need = R.materialNeed(recipe, execs * recipe.outputCount);
  const missing = [];
  for (const inp of need.items) {
    let have = 0;
    for (const cc of [inp.itemId, ...(inp.alternatives || [])]) have += D.availableSmart(v, cc);
    const own = (o.reserved || []).find(x => x.typeId === inp.itemId);
    if (own) have += own.count;
    if (have < inp.count) missing.push(`${inp.count - have}x ${inp.itemId.replace("minecraft:", "")}`);
  }
  if (missing.length) { releaseAll(v, o); return { status: "waiting_materials", reason: "materials_missing", missing }; }
  reserveBatch(v, o, need.items);
  return { status: "ready", missing: [] };
}
// ---------- batch reservations (Sprint 3) ----------
export function reserveBatch(v, o, items) {
  releaseAll(v, o);
  o.reserved = [];
  for (const inp of items) {
    const cands = [inp.itemId, ...(inp.alternatives || [])];
    outer:
    for (const c of cands) {
      for (const t of D.depotPriority(c)) {
        if (D.available(v, t, c) >= inp.count) {
          D.addReservation(v, t, c, inp.count, o.id);
          o.reserved.push({ typeId: c, count: inp.count, depot: t });
          break outer;
        }
      }
    }
  }
  saveOrders(v);
}
export function releaseForItems(v, o, items) {
  if (!o.reserved) return;
  for (const it of items || []) {
    const r = o.reserved.find(x => x.typeId === it.typeId);
    if (r) {
      const n = Math.min(r.count, it.count);
      D.releaseReservation(v, r.depot, r.typeId, n);
      r.count -= n;
    }
  }
  o.reserved = o.reserved.filter(x => x.count > 0);
}
export function releaseAll(v, o) {
  if (!o.reserved) return;
  for (const r of o.reserved) D.releaseReservation(v, r.depot, r.typeId, r.count);
  o.reserved = [];
}

const FOODS = { "minecraft:bread": 1, "minecraft:cooked_beef": 1, "minecraft:cooked_porkchop": 1, "minecraft:cooked_chicken": 1, "minecraft:cooked_mutton": 1, "minecraft:baked_potato": 1, "minecraft:carrot": 1, "minecraft:potato": 1 };


