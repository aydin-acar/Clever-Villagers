// ============================================================
// cv2/integration_construction_bridge.js — v1 construction systems
// (walls/torches/gates/notes) draw materials from the CONSTRUCTION
// DEPOT (/cv:construction add). The old bell-side chest is GONE.
// ============================================================
import { world, system, ItemStack } from "@minecraft/server";
import * as V from "./core/village.js";
import * as D from "./core/depot.js";
import * as CU from "./core/container_utils.js";
import * as L from "./core/ledger.js";
import * as LOG from "../log.js";

const warnAt = new Map();

export function villageForBell(bell) {
  return V.get(`${bell.x},${bell.y},${bell.z}`);
}

function containers(dim, v) {
  D.loadDepots(v);
  const d = v.depots.get("construction");
  if (!d) return [];
  return d.blocks.map(b => D.containerAt(dim, b)).filter(c => !!c);
}

export function hasMat(dim, bell, typeId, count) {
  const v = villageForBell(bell);
  if (!v) return false;
  let total = 0;
  for (const c of containers(dim, v)) total += CU.countItems(c, typeId);
  return total >= count;
}

// all-or-nothing, clone-guarded consumption + ledger entry
export function consumeMat(dim, bell, typeId, count, what) {
  const v = villageForBell(bell);
  if (!v) return false;
  const cs = containers(dim, v);
  let left = count;
  const done = [];
  for (const c of cs) {
    if (left <= 0) break;
    const have = CU.countItems(c, typeId);
    if (have <= 0) continue;
    const take = Math.min(have, left);
    if (CU.removeItemsExact(c, [{ typeId, count: take }])) { left -= take; done.push([c, take]); }
  }
  if (left > 0) {
    // rollback partial takes (should not happen: pre-checked)
    for (const [c, take] of done) CU.addItemsSafe(c, typeId, take);
    return false;
  }
  L.push(v, { kind: "consume", items: [{ itemId: typeId, count }], to: what || "construction" });
  const d = v.depots.get("construction");
  if (d) d.dirty = true;
  return true;
}

export function warnMissing(dim, bell, missing, tick) {
  const v = villageForBell(bell);
  const k = (v ? v.id : "novillage");
  const last = warnAt.get(k) || 0;
  if (tick - last < 6000) return;
  warnAt.set(k, tick);
  const hint = v ? "" : " (köy kurulumu: /cv:setup)";
  try {
    world.sendMessage(`§c[CV]§7 İnşaat malzemesi yok: §f${missing.join(", ")}§7 → inşaat deposuna bırakın (/cv:construction add ile kayıt${hint}).`);
  } catch (e) { /* ignore */ }
  LOG.warn(`[CV] eksik malzeme: ${missing.join(", ")}`);
}

// note paper lives in the construction depot now
export function writeNote(dim, bell, lines) {
  const v = villageForBell(bell);
  if (!v) return false;
  const cs = containers(dim, v);
  if (!cs.length) return false;
  const c = cs[0];
  try {
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it && it.typeId === "minecraft:paper") {
        it.nameTag = "§eKöy İnşaat Notu";
        it.setLore(lines);
        c.setItem(i, it);
        return true;
      }
    }
    const paper = new ItemStack("minecraft:paper", 1);
    paper.nameTag = "§eKöy İnşaat Notu";
    paper.setLore(lines);
    c.addItem(paper);
    return true;
  } catch (e) { return false; }
}

export function stockLinesForBell(dim, bell) {
  const v = villageForBell(bell);
  if (!v) return ["§7köy ekonomisi kurulu değil: §e/cv:setup"];
  D.loadDepots(v);
  const d = v.depots.get("construction");
  if (!d || !d.blocks.length) return ["§7inşaat deposu kayıtlı değil: §e/cv:construction add"];
  try { D.refreshDepot(dim, v, "construction"); } catch (e) { /* ignore */ }
  return D.stockLines(v, "construction");
}
