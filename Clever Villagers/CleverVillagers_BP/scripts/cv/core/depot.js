// ============================================================
// cv2/core/depot.js — registered depot blocks + physical/reserved
// stock cache with event/chunk-safe refresh (PLAN §3, §19).
// ============================================================
import { world } from "@minecraft/server";
import * as CU from "./container_utils.js";
import * as V from "./village.js";
import * as LOG from "../../log.js";

export const DEPOT_TYPES = ["warehouse", "food", "fuel", "construction"];
const CONTAINERS = ["minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel"];

export function isContainerId(id) { return !!id && CONTAINERS.includes(id); }

// ---------- persistence ----------
function saveDepots(v) {
  const obj = {};
  for (const [type, d] of v.depots) obj[type] = d.blocks;
  try { world.setDynamicProperty(`cv:v:${v.id}:depots`, JSON.stringify(obj)); } catch (e) { /* ignore */ }
}
export function loadDepots(v) {
  if (v.depots.size) return;
  let obj = {};
  try {
    const raw = world.getDynamicProperty(`cv:v:${v.id}:depots`);
    if (typeof raw === "string") obj = JSON.parse(raw) || {};
  } catch (e) { obj = {}; }
  for (const type of DEPOT_TYPES) {
    v.depots.set(type, { type, blocks: (obj[type] || []).map(b => ({ x: b.x, y: b.y, z: b.z })), cache: {}, dirty: true });
  }
}

// ---------- registration ----------
export function registerDepot(v, type, loc) {
  loadDepots(v);
  const d = v.depots.get(type);
  if (!d) return false;
  if (d.blocks.some(b => b.x === loc.x && b.y === loc.y && b.z === loc.z)) return false;
  d.blocks.push({ x: loc.x, y: loc.y, z: loc.z });
  d.dirty = true;
  saveDepots(v);
  LOG.info(`[CV] depo eklendi: ${type} @ ${loc.x},${loc.y},${loc.z}`);
  return true;
}

export function onBlockBroken(loc) {
  for (const v of V.all()) {
    loadDepots(v);
    for (const [type, d] of v.depots) {
      const i = d.blocks.findIndex(b => b.x === loc.x && b.y === loc.y && b.z === loc.z);
      if (i >= 0) {
        d.blocks.splice(i, 1);
        d.dirty = true;
        saveDepots(v);
        LOG.warn(`[CV] depo bloğu kırıldı: ${type} @ ${loc.x},${loc.y},${loc.z}`);
      }
    }
  }
}

// ---------- containers & cache ----------
export function containerAt(dim, loc) {
  try {
    const b = dim.getBlock(loc);
    if (!b) return undefined;
    const comp = b.getComponent("minecraft:inventory");
    return comp ? comp.container : undefined;
  } catch (e) { return undefined; }
}

export function refreshDepot(dim, v, type) {
  loadDepots(v);
  const d = v.depots.get(type);
  if (!d) return;
  const counts = {};
  const alive = [];
  for (const b of d.blocks) {
    const c = containerAt(dim, b);
    if (!c) continue; // broken or unloaded: drop broken ones only when chunk loaded
    alive.push(b);
    try {
      for (let i = 0; i < c.size; i++) {
        const it = c.getItem(i);
        if (it) counts[it.typeId] = (counts[it.typeId] || 0) + it.amount;
      }
    } catch (e) { /* skip */ }
  }
  d.blocks = alive;
  const old = d.cache;
  d.cache = {};
  for (const id of new Set([...Object.keys(counts), ...Object.keys(old)])) {
    const physical = counts[id] || 0;
    // self-heal: reserved can never exceed what physically exists (v2.4.1)
    const reserved = Math.min(physical, (old[id] && old[id].reserved) || 0);
    d.cache[id] = { physical, reserved };
  }
  d.dirty = false;
}

// v2.4.2: type-appropriate depot preference (user: food first for food etc.)
const FOOD_RE = /(bread|cooked_|carrot|potato|beetroot|apple|_pie|cookie|suspicious_stew|mushroom_stew)/;
const FUEL_RE = /^(minecraft:)(coal|charcoal|coal_block|lava_bucket|dried_kelp_block)$/;
const CONSTR_RE = /(wall|torch|lantern|fence|gate|_path|^minecraft:gravel$)/;
export function depotPriority(itemId) {
  if (FOOD_RE.test(itemId)) return ["food", "warehouse", "construction"];
  if (FUEL_RE.test(itemId)) return ["fuel", "warehouse"];
  if (CONSTR_RE.test(itemId)) return ["construction", "warehouse"];
  return ["warehouse", "construction", "food", "fuel"];
}
export function availableSmart(v, itemId) {
  let n = 0;
  for (const t of depotPriority(itemId)) n += available(v, t, itemId);
  return n;
}

export function physical(v, type, typeId) {
  const d = v.depots.get(type);
  return d && d.cache[typeId] ? d.cache[typeId].physical : 0;
}
export function reserved(v, type, typeId) {
  const d = v.depots.get(type);
  return d && d.cache[typeId] ? d.cache[typeId].reserved : 0;
}
export function available(v, type, typeId) {
  return Math.max(0, physical(v, type, typeId) - reserved(v, type, typeId));
}
export function addReservation(v, type, typeId, count, resId) {
  const d = v.depots.get(type);
  if (!d) return false;
  const c = d.cache[typeId] || (d.cache[typeId] = { physical: 0, reserved: 0 });
  c.reserved += count;
  return true;
}
export function releaseReservation(v, type, typeId, count) {
  const d = v.depots.get(type);
  if (!d || !d.cache[typeId]) return;
  d.cache[typeId].reserved = Math.max(0, d.cache[typeId].reserved - count);
}

// ---------- physical moves (ledger-backed, all-or-nothing) ----------
export function consumeFromDepot(dim, v, type, requests, orderId) {
  loadDepots(v);
  const d = v.depots.get(type);
  if (!d) return false;
  // gather containers
  const pairs = [];
  for (const b of d.blocks) {
    const c = containerAt(dim, b);
    if (c) pairs.push(c);
  }
  // all-or-nothing across the whole depot: check totals first
  for (const r of requests) {
    let total = 0;
    for (const c of pairs) total += CU.countItems(c, r.typeId);
    if (total < r.count) return false;
  }
  for (const r of requests) {
    let left = r.count;
    for (const c of pairs && left > 0 ? pairs : []) {
      if (left <= 0) break;
      const have = CU.countItems(c, r.typeId);
      if (have <= 0) continue;
      const take = Math.min(have, left);
      if (!CU.removeItemsExact(c, [{ typeId: r.typeId, count: take }])) return false;
      left -= take;
    }
    if (left > 0) return false;
    releaseReservation(v, type, r.typeId, r.count);
  }
  d.dirty = true;
  return true;
}

export function addToDepot(dim, v, type, typeId, count, orderId) {
  loadDepots(v);
  const d = v.depots.get(type);
  if (!d) return count;
  let left = count;
  for (const b of d.blocks) {
    if (left <= 0) break;
    const c = containerAt(dim, b);
    if (!c) continue;
    left = CU.addItemsSafe(c, typeId, left);
  }
  d.dirty = true;
  return left; // leftover (0 = all stored)
}

// ---------- stock report ----------
export function stockLines(v, type) {
  loadDepots(v);
  const d = v.depots.get(type);
  if (!d) return ["§7(depo yok)"];
  const entries = Object.entries(d.cache).filter(([, c]) => c.physical > 0 || c.reserved > 0);
  entries.sort((a, b) => b[1].physical - a[1].physical);
  if (!entries.length) return [`§7${type}: boş (${d.blocks.length} blok)`];
  const lines = [`§6${type}§r (${d.blocks.length} blok):`];
  for (const [id, c] of entries.slice(0, 12)) {
    lines.push(`§f${c.physical}x§7 ${id.replace("minecraft:", "")}${c.reserved ? ` §c(${c.reserved} rezerve)` : ""}`);
  }
  return lines;
}
