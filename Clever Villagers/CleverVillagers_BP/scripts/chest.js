// ============================================================
// Clever Villagers (Regrowth for Bedrock) — chest.js
// Construction chest & material economy (user design):
//  - a "village construction chest" is placed next to the bell
//  - every wall/gate/torch/lantern placement CONSUMES the matching
//    item from the chest (partial materials => partial building)
//  - a lore note (paper) inside the chest + rate-limited chat
//    messages tell the player what is needed
// ============================================================
import { world, ItemStack, BlockVolume } from "@minecraft/server";
import { getConfig, stats } from "./config.js";
import * as U from "./util.js";

const chestPos = new Map();      // bellKey -> {x,y,z}
const lastWarn = new Map();      // bellKey -> tick

const CHEST_IDS = ["minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel"];

function bellKey(b) { return `${b.x},${b.y},${b.z}`; }

// locate (or create) the construction chest next to the bell
export function ensureChest(dim, bell) {
  const k = bellKey(bell);
  if (chestPos.has(k)) {
    const p = chestPos.get(k);
    const t = U.typeId(U.getBlock(dim, p));
    if (t && CHEST_IDS.includes(t)) return p;
    chestPos.delete(k);
  }
  // search nearby
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = -1; dy <= 2; dy++) {
        const p = U.vec(bell.x + dx, bell.y + dy, bell.z + dz);
        const t = U.typeId(U.getBlock(dim, p));
        if (t && CHEST_IDS.includes(t)) { chestPos.set(k, p); return p; }
      }
    }
  }
  if (!getConfig().constructionChest) return undefined;
  // find ground in the 8 neighbour columns, place the chest on top of it
  const spots = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (const [ox, oz] of spots) {
    for (let dy = 2; dy >= -4; dy--) {
      const gLoc = U.vec(bell.x + ox, bell.y + dy, bell.z + oz);
      const t = U.typeId(U.getBlock(dim, gLoc));
      if (!t || t === "minecraft:air" || U.isLiquidId(t)) continue;
      if (U.GRASS_PLANTS.has(t) || U.FLOWERS.has(t) || U.DOUBLE_PLANTS.has(t)) continue;
      const cLoc = U.vec(gLoc.x, gLoc.y + 1, gLoc.z);
      const at = U.typeId(U.getBlock(dim, cLoc));
      if (at === "minecraft:air" || U.isLiquidId(at) || U.GRASS_PLANTS.has(at) || U.FLOWERS.has(at)) {
        const cp = U.perm("minecraft:chest");
        if (cp) {
          try {
            dim.getBlock(cLoc).setPermutation(cp);
            chestPos.set(k, cLoc);
            U.debug(1, `Construction chest placed at ${cLoc.x},${cLoc.y},${cLoc.z}`);
            return cLoc;
          } catch (e) { /* try next spot */ }
        }
      }
      break;
    }
  }
  return undefined;
}

function containerAt(dim, p) {
  try {
    const b = dim.getBlock(p);
    const comp = b.getComponent("minecraft:inventory");
    return comp ? comp.container : undefined;
  } catch (e) { return undefined; }
}

export function countItems(dim, bell, typeId) {
  const p = ensureChest(dim, bell);
  if (!p) return 0;
  const c = containerAt(dim, p);
  if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.size; i++) {
    try {
      const slot = c.getSlot(i);
      if (slot.hasItem() && slot.typeId === typeId) n += slot.amount;
    } catch (e) { /* skip problematic slot, keep scanning others */ }
  }
  return n;
}

// cheap availability check (no mutation)
export function hasItems(dim, bell, typeId, count) {
  if (!getConfig().constructionChest) return true;
  return countItems(dim, bell, typeId) >= count;
}

// consume count x typeId from ANY slots (split stacks included);
// all-or-nothing: on failure nothing is removed (TODO G2)
export function consume(dim, bell, typeId, count) {
  if (!getConfig().constructionChest) return true; // economy disabled => free
  const p = ensureChest(dim, bell);
  if (!p) return false;
  const c = containerAt(dim, p);
  if (!c) return false;
  if (countItemsRaw(c, typeId) < count) return false;
  let left = count;
  const undo = [];
  try {
    for (let i = 0; i < c.size && left > 0; i++) {
      let slot;
      try { slot = c.getSlot(i); } catch (e) { continue; }
      if (!slot.hasItem() || slot.typeId !== typeId) continue;
      const st = slot.getItem();
      const take = Math.min(left, st.amount);
      undo.push([i, st]);
      st.amount -= take;
      left -= take;
      try {
        if (st.amount <= 0) slot.setItem(undefined);
        else slot.setItem(st);
      } catch (e) {
        try { slot.setItem(st.amount <= 0 ? undefined : st); } catch (e2) { /* ignore */ }
      }
    }
  } catch (e) { left = 1; }
  if (left > 0) {
    // rollback best-effort
    for (const [i, st] of undo) { try { c.getSlot(i).setItem(st); } catch (e) { /* ignore */ } }
    return false;
  }
  return true;
}

function countItemsRaw(c, typeId) {
  let n = 0;
  for (let i = 0; i < c.size; i++) {
    try {
      const slot = c.getSlot(i);
      if (slot.hasItem() && slot.typeId === typeId) n += slot.amount;
    } catch (e) { /* keep scanning */ }
  }
  return n;
}

// drop a lore note into the chest once (material list)
export function dropNote(dim, bell, needsLines) {
  const p = ensureChest(dim, bell);
  if (!p) return;
  const c = containerAt(dim, p);
  if (!c) return;
  try {
    for (let i = 0; i < c.size; i++) {
      const slot = c.getSlot(i);
      if (slot.hasItem() && slot.typeId === "minecraft:paper" && slot.getLore().length > 0) return;
    }
    const paper = new ItemStack("minecraft:paper", 1);
    paper.nameTag = "§eKöy İnşaat Notu";
    paper.setLore(needsLines);
    c.addItem(paper);
  } catch (e) { /* ignore */ }
}

// H3: write/refresh the lore note paper in the chest
export function updateNote(dim, bell, lines) {
  const p = ensureChest(dim, bell);
  if (!p) return;
  const c = containerAt(dim, p);
  if (!c) return;
  try {
    for (let i = 0; i < c.size; i++) {
      let slot;
      try { slot = c.getSlot(i); } catch (e) { continue; }
      if (slot.hasItem() && slot.typeId === "minecraft:paper") {
        const it = slot.getItem();
        it.nameTag = "§eKöy İnşaat Notu";
        it.setLore(lines);
        slot.setItem(it);
        return;
      }
    }
    const paper = new ItemStack("minecraft:paper", 1);
    paper.nameTag = "§eKöy İnşaat Notu";
    paper.setLore(lines);
    c.addItem(paper);
  } catch (e) { /* ignore */ }
}

// rate-limited "materials missing" chat warning
export function warnMissing(dim, bell, missing, tick) {
  const k = bellKey(bell);
  const last = lastWarn.get(k) || 0;
  if (tick - last < 6000) return; // ~5 minutes
  lastWarn.set(k, tick);
  try {
    world.sendMessage(`§c[CV]§7 İnşaat durakladı — sandıkta eksik: §f${missing.join(", ")}§7. Çan yanındaki inşaat sandığına malzeme bırakın.`);
  } catch (e) { /* ignore */ }
}

// estimate what the whole perimeter needs (for the note + chat)
export function needsSummary(rect, mat, wallItemIds, columnsArg) {
  const cfg0 = getConfig();
  const w = (rect.maxX - rect.minX) + 1;
  const h = (rect.maxZ - rect.minZ) + 1;
  const columns = columnsArg || (2 * (w + h) - 4);
  const cfg = cfg0;
  const walls = columns * Math.max(1, cfg.wallHeight) + 8; // + corner posts
  const gates = 8;      // expected road crossings
  const spacing = cfg.wallTorchEvery > 0 ? cfg.wallTorchEvery : 6;
  const torches = Math.ceil(columns / spacing) + 4;
  return {
    columns,
    lines: [
      `§7Sur malzemesi: §f${walls}x ${wallItemIds[0].replace("minecraft:", "")}`,
      `§7Kapılar: §f${gates}x fence_gate §7· Meşale: §f${torches}x torch`,
      `§7Köşe feneri: §f4x lantern §7· Kolon: ${columns}`
    ]
  };
}
