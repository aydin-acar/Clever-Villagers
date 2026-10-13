// ============================================================
// cv/core/path.js — v2.11.0 "KAMPYOLU" (user: "sistemin zaten bir köylüyü
// hareket ettirme sistemi var: vanilla'nın verilen göreve gitme sistemi.
// Bunun üzerine ikinci bir yürüme sistemi yazarsan çakışıyor — köylü iki
// adım ileri gidiyor (vanilla), iki adım geriye ışınlanıyor (kod).")
//
// v2.10.0's YOLADAM walker is GONE. It stepped the villager with
// teleport() every 4t while the villager's OWN vanilla AI was also
// moving it — two movers on one entity = the "2 forward / 2 back"
// stutter the user saw in the field.
//
// Movement now belongs 100% to vanilla (see cv/core/anchor.js): the
// addon places job-site GOAL blocks and the villager's own schedule +
// pathfinding walks it there. This module keeps only:
//   * nodeOk/standY — "can somebody stand here?" geometry, used to
//     choose safe anchor spots (and by walls/roads builders);
//   * unstuckBuried — the ONLY position fix left in the whole addon:
//     a villager whose feet AND head are inside solid blocks (sand
//     fall, door glitch — vanilla accidents) is stepped SIDEWAYS at
//     the SAME y to the nearest breathable column. Never upward,
//     never to a roof, never across the map.
// ============================================================
import * as U from "../../util.js";
import * as LOG from "../../log.js";

export const stats = { buried: 0 };

const PASSABLE = new Set([
  "minecraft:air", "minecraft:cave_air", "minecraft:snow_layer",
  "minecraft:torch", "minecraft:soul_torch", "minecraft:wall_torch",
  "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern"
]);
// doors/gates count as passable: vanilla villagers OPEN doors themselves
const OPENABLE_RE = /(_door$|^minecraft:wooden_door$|fence_gate$)/;
export function isPassableId(id) {
  if (!id || PASSABLE.has(id)) return true;
  if (OPENABLE_RE.test(id)) return true;
  if (U.GRASS_PLANTS.has(id) || U.FLOWERS.has(id) || U.CUTTABLE.has(id)) return true;
  return false;
}
function isFloorId(id) { return !!id && !U.isLiquidId(id) && !isPassableId(id); }
// a standable column: breathable feet+head, solid (non-liquid) floor
export function nodeOk(dim, x, y, z) {
  try { if (!dim.isChunkLoaded({ x, y, z })) return false; } catch (e) { return false; }
  const feet = U.typeId(U.getBlock(dim, U.vec(x, y, z)));
  const head = U.typeId(U.getBlock(dim, U.vec(x, y + 1, z)));
  if (!isPassableId(feet) || !isPassableId(head)) return false;
  const floor = U.typeId(U.getBlock(dim, U.vec(x, y - 1, z)));
  return isFloorId(floor);
}
// nearest standable y at a column (search around the hint, ground-first)
export function standY(dim, x, z, yHint) {
  const hy = Math.floor(yHint);
  for (const dy of [0, -1, -2, -3, 1, 2, 3, -4, 4]) {
    if (nodeOk(dim, x, hy + dy, z)) return hy + dy;
  }
  return undefined;
}

// ---------- the ONLY position fix left in the whole addon ----------
// feet AND head inside solid blocks => step SIDEWAYS at the same height
// (then one block lower) into the nearest breathable column. No upward
// climbs, no roof drops, no "rescue" leaps: same-ground sidestep.
export function unstuckBuried(dim, ent, fx, fy, fz) {
  for (const dy of [0, -1]) {
    for (let r = 1; r <= 3; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (nodeOk(dim, fx + dx, fy + dy, fz + dz)) {
            try {
              ent.teleport(U.vec(fx + dx + 0.5, fy + dy, fz + dz + 0.5), { dimension: dim });
              stats.buried++;
              LOG.warn(`[CV] gömülü köylü yana adımladı (aynı zemin, y=${fy + dy}) → (${fx + dx},${fz + dz})`);
              return true;
            } catch (e) { /* try next */ }
          }
        }
      }
    }
  }
  return false;
}
