// ============================================================
// roads.js (v4 — 27.09 user spec, terrace-chaos eliminated)
//
// GOLDEN RULE: only ROAD columns are ever raised/lowered.
// Natural terrain is touched ONLY when a road line passes THROUGH
// it (opposite-side road neighbours = a missing road piece).
// Structures are never touched.
//
// Algorithm (user images):
//  1) cross row (3 wide, perpendicular): level the ROAD cells of the
//     row to their median (a 3-step row becomes flat)
//  2) longitudinal: if the next road column along the road differs
//     by >=2, ease it by 1 per pass => clean 1-step ramps form
//  3) gap bridge: natural column with ROAD neighbours on OPPOSITE
//     sides (road continues through it) -> convert to road at their
//     median height (reconnects broken lines, never widens)
//  4) upkeep: plants/snow on road tops cleared; air under a road top
//     filled down to 10
// ============================================================
import { getConfig, stats } from "./config.js";
import * as U from "./util.js";

const ROAD_IDS = U.ROAD_IDS;
function isRoad(id) { return !!id && ROAD_IDS.has(id); }
const pathPerm = () => U.PERMS.grassPath();

const NATURAL = new Set([
  "minecraft:grass_block", "minecraft:dirt_with_grass", "minecraft:dirt", "minecraft:coarse_dirt",
  "minecraft:gravel", "minecraft:sand", "minecraft:red_sand", "minecraft:stone", "minecraft:podzol",
  "minecraft:mycelium", "minecraft:moss_block", "minecraft:clay", "minecraft:rooted_dirt"
]);
function columnClass(id) {
  if (isRoad(id)) return "road";
  if (NATURAL.has(id)) return "natural";
  return "structure";
}

function cellTop(dim, x, z, yRef) {
  for (let y = yRef + 4; y >= yRef - 6; y--) {
    const b = U.getBlock(dim, U.vec(x, y, z));
    if (!b) continue;
    const t = U.typeId(b);
    if (t === undefined || t === "minecraft:air") continue;
    if (U.GRASS_PLANTS.has(t) || U.DOUBLE_PLANTS.has(t) || U.FLOWERS.has(t) || t === "minecraft:snow_layer") continue;
    return { y, id: t, cls: columnClass(t) };
  }
  return undefined;
}

function fillBelow(dim, x, topY, z) {
  for (let k = 1; k <= 10; k++) {
    const loc = U.vec(x, topY - k, z);
    const t = U.typeId(U.getBlock(dim, loc));
    if (t === "minecraft:air") U.setBlock(dim, loc, k <= 3 ? "minecraft:dirt" : "minecraft:stone");
    else if (t && t !== "minecraft:water" && t !== "minecraft:flowing_water") break;
  }
}

// raise a ROAD column by up to 3 (or convert a gap natural column)
function raiseRoad(dim, x, z, top, targetY, villager) {
  if (top.cls === "structure") return false;
  if (top.y >= targetY || targetY - top.y > 3) return false;
  const rp = pathPerm();
  if (!rp) return false;
  let changed = false;
  for (let y = top.y + 1; y <= targetY; y++) {
    if (U.setBlock(dim, U.vec(x, y, z), rp)) changed = true;
  }
  if (top.cls === "natural") {
    // gap conversion: top natural block becomes path
    if (U.setBlock(dim, U.vec(x, top.y, z), rp)) changed = true;
  }
  if (changed) {
    fillBelow(dim, x, targetY, z);
    stats.roadsRepaired++;
    if (villager) U.workerAct(villager, U.vec(x, targetY, z));
  }
  return changed;
}

function lowerRoad(dim, x, z, top, targetY, villager) {
  if (top.cls !== "road") return false;          // never dig natural/structure
  if (top.y <= targetY || top.y - targetY > 3) return false;
  let changed = false;
  for (let y = top.y; y > targetY; y--) {
    if (U.clearBlock(dim, U.vec(x, y, z))) changed = true;
  }
  const at = U.typeId(U.getBlock(dim, U.vec(x, targetY, z)));
  if (!isRoad(at)) {
    const rp = pathPerm();
    if (rp && U.setBlock(dim, U.vec(x, targetY, z), rp)) changed = true;
  }
  if (changed) {
    stats.roadsRepaired++;
    if (villager) U.workerAct(villager, U.vec(x, targetY, z));
  }
  return changed;
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// is this column a damaged road spot? (for the job dispatcher)
export function columnDamaged(dim, x, z, yRef) {
  const top = cellTop(dim, x, z, yRef);
  if (!top) return null;
  const above = U.typeId(U.getBlock(dim, U.vec(x, top.y + 1, z)));
  if (top.cls === "road") {
    if (above && (U.GRASS_PLANTS.has(above) || U.DOUBLE_PLANTS.has(above) || U.FLOWERS.has(above) || above === "minecraft:snow_layer")) return { r: "overgrowth", y: top.y };
    const below = U.typeId(U.getBlock(dim, U.vec(x, top.y - 1, z)));
    if (below === "minecraft:air") return { r: "floating", y: top.y };
    for (const [ox, oz] of DIRS4) {
      const n = cellTop(dim, x + ox, z + oz, yRef);
      if (n && n.cls === "road" && Math.abs(n.y - top.y) >= 1) return { r: "uneven", y: top.y };
    }
    return null;
  }
  if (top.cls === "natural") {
    // gap: road continues THROUGH this column (opposite pair)
    const e = cellTop(dim, x + 1, z, yRef), w = cellTop(dim, x - 1, z, yRef);
    const n = cellTop(dim, x, z + 1, yRef), s = cellTop(dim, x, z - 1, yRef);
    const ew = e && e.cls === "road" && w && w.cls === "road";
    const ns = n && n.cls === "road" && s && s.cls === "road";
    if (ew || ns) return { r: "gap", y: top.y };
  }
  return null;
}

// fix one specific column (dispatcher-driven); villager = visual worker
export function fixAtColumn(dim, villager, colLoc) {
  const cfg = getConfig();
  if (!cfg.roadsOn) return false;
  const foot = U.vec(colLoc.x, colLoc.y, colLoc.z);
  if (!U.canSeeSky(dim, U.vec(foot.x, foot.y + 1, foot.z))) return false;
  const gy = foot.y - 1;
  const top = cellTop(dim, foot.x, foot.z, gy);
  if (!top || top.cls === "structure") return false;

  // upkeep first
  const above = U.typeId(U.getBlock(dim, U.vec(foot.x, top.y + 1, foot.z)));
  if (top.cls === "road" && above && (U.GRASS_PLANTS.has(above) || U.DOUBLE_PLANTS.has(above) || U.FLOWERS.has(above) || above === "minecraft:snow_layer")) {
    const ab = U.getBlock(dim, U.vec(foot.x, top.y + 1, foot.z));
    if (ab) { U.removePlant(dim, ab); stats.grassCut++; return true; }
  }
  if (top.cls === "road" && U.typeId(U.getBlock(dim, U.vec(foot.x, top.y - 1, foot.z))) === "minecraft:air") {
    fillBelow(dim, foot.x, top.y, foot.z);
    stats.roadsRepaired++;
    if (villager) U.workerAct(villager, U.vec(foot.x, top.y, foot.z));
    return true;
  }

  // gap bridge (opposite pair only)
  if (top.cls === "natural") {
    const e = cellTop(dim, foot.x + 1, foot.z, gy), w = cellTop(dim, foot.x - 1, foot.z, gy);
    const n = cellTop(dim, foot.x, foot.z + 1, gy), s = cellTop(dim, foot.x, foot.z - 1, gy);
    let target = null;
    if (e && e.cls === "road" && w && w.cls === "road") target = Math.round((e.y + w.y) / 2);
    else if (n && n.cls === "road" && s && s.cls === "road") target = Math.round((n.y + s.y) / 2);
    if (target !== null && Math.abs(target - top.y) <= 4) {
      if (raiseRoad(dim, foot.x, foot.z, top, target, villager)) {
        U.sound(dim, foot, "dig.grass", 0.5);
        U.debug(2, `Road gap bridged at ${foot.x},${target},${foot.z}`, dim, foot);
        return true;
      }
    }
    return false;
  }

  // ---- road column: cross row level (ROAD cells only) ----
  const e = cellTop(dim, foot.x + 1, foot.z, gy), w = cellTop(dim, foot.x - 1, foot.z, gy);
  const n = cellTop(dim, foot.x, foot.z + 1, gy), s = cellTop(dim, foot.x, foot.z - 1, gy);
  const ewRoad = (e && e.cls === "road") || (w && w.cls === "road");
  const nsRoad = (n && n.cls === "road") || (s && s.cls === "road");
  const dirEW = ewRoad && !nsRoad ? true : nsRoad && !ewRoad ? false : ewRoad;
  const row = dirEW
    ? [w, top, e]
    : [n, top, s];
  const roadYs = row.filter(t => t && t.cls === "road").map(t => t.y);
  let acted = false;
  if (roadYs.length >= 2) {
    roadYs.sort((a, b) => a - b);
    const maj = roadYs[Math.floor(roadYs.length / 2)];
    for (let i = 0; i < row.length; i++) {
      const t = row[i];
      if (!t || t.cls !== "road" || t.y === maj) continue;
      const cx = dirEW ? foot.x + (i - 1) : foot.x;
      const cz = dirEW ? foot.z : foot.z + (i - 1);
      if (t.y > maj) acted = lowerRoad(dim, cx, cz, t, maj, villager) || acted;
      else acted = raiseRoad(dim, cx, cz, t, maj, villager) || acted;
    }
  }

  // ---- longitudinal ramp easing (road columns only) ----
  for (const [ox, oz] of DIRS4) {
    const nb = cellTop(dim, foot.x + ox, foot.z + oz, gy);
    if (!nb || nb.cls !== "road") continue;
    const diff = nb.y - top.y;
    if (Math.abs(diff) >= 2) {
      const step = diff > 0 ? nb.y - 1 : nb.y + 1;
      if (diff > 0) acted = lowerRoad(dim, foot.x + ox, foot.z + oz, nb, step, villager) || acted;
      else acted = raiseRoad(dim, foot.x + ox, foot.z + oz, nb, step, villager) || acted;
      break; // one easing per pass
    }
  }

  if (acted) {
    U.sound(dim, foot, "dig.grass", 0.4);
    U.debug(2, `Road worked at ${foot.x},${gy},${foot.z}`, dim, foot);
  }
  return acted;
}

// legacy entry: villager's own foot column
export function fixAt(dim, villager, foot, ground) {
  return fixAtColumn(dim, villager, foot);
}
