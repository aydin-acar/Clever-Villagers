// ============================================================
// Clever Villagers (Regrowth for Bedrock) — lighting.js (v1.3)
//
// Replaces the old random "villager drops torches while walking"
// behaviour (user complaint C1) with a DETERMINISTIC village
// lighting grid:
//  * grid points every torchGrid blocks inside the village rect
//  * a point needs a torch when its BLOCK light (== night light)
//    is below minVillageLight (monster-spawn safety level)
//  * a villager within 16 blocks still "places" it (lookAt,
//    particles, sound) — no phantom placing
//  * torches are paid from the construction chest; a shortage
//    only warns and NEVER blocks wall building (C2 / G1)
// ============================================================
import { system, world } from "@minecraft/server";
import { getConfig, stats } from "./config.js";
import * as U from "./util.js";
import * as B from "./cv/integration_construction_bridge.js";
import * as W from "./walls.js";

const state = new Map(); // bellKey -> { idx }
let lastPass = 0;        // v2.8.0 accumulator cadence (offset-safe)

function findWorker(dim, loc, radius) {
  try {
    let best, bd = radius;
    for (const e of dim.getEntities({ location: loc, maxDistance: radius })) {
      if (!U.isValidEntity(e)) continue;
      if (e.typeId !== "minecraft:villager_v2" && e.typeId !== "minecraft:villager") continue;
      let sleeping = false;
      try { sleeping = !!e.isSleeping; } catch (err) { /* ignore */ }
      if (sleeping) continue;
      const d = U.dist2d(e.location, loc);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  } catch (e) { return undefined; }
}

let darkCache = { key: "", tick: 0, pts: [] };
export function isDarkPoint(dim, bell, x, z) {
  const cfg = getConfig();
  const sy = W.surfaceY(dim, bell.y, x, z);
  if (sy === null) return false;
  const airLoc = U.vec(x, sy + 1, z);
  const air = U.getBlock(dim, airLoc);
  if (U.typeId(air) !== "minecraft:air") return false;
  if (U.skyLight(air) < 15) return false;
  let tod = 12000;
  try { tod = world.getTimeOfDay(); } catch (e) { /* ignore */ }
  if (tod >= 13000 && tod <= 23000) return U.blockLight(air) < cfg.minVillageLight;
  return !lightSourceNear(dim, x, sy + 1, z, 6);
}
export function listDarkPoints(dim, bell) {
  const key = `${bell.x},${bell.y},${bell.z}`;
  const tick = system.currentTick;
  if (darkCache.key === key && tick - darkCache.tick < 200) return darkCache.pts;
  const cfg = getConfig();
  const rect = W.coreRectOf(bell);
  const pts = [];
  if (rect) {
    const step = Math.max(6, cfg.torchGrid);
    outer:
    for (let x = rect.minX; x <= rect.maxX; x += step) {
      for (let z = rect.minZ; z <= rect.maxZ; z += step) {
        if (isDarkPoint(dim, bell, x, z)) pts.push({ x, z });
        if (pts.length >= 40) break outer;
      }
    }
  }
  darkCache = { key, tick, pts };
  return pts;
}

const LIGHT_SOURCES = /(torch|lantern|glowstone|shroomlight|sea_lantern|sea_pickle|froglight|end_rod|beacon|conduit|copper_bulb|lit_pumpkin|crying_obsidian|campfire)/;
function lightSourceNear(dim, x, y, z, r) {
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++)
      for (let dy = -2; dy <= 2; dy++) {
        const t = U.typeId(U.getBlock(dim, U.vec(x + dx, y + dy, z + dz)));
        if (t && LIGHT_SOURCES.test(t)) return true;
      }
  return false;
}

// v2.9.0: the old nudgeNearestVillager() impulse (tick % 40 == every 2s!)
// is DELETED. Movement belongs to the villagers' vanilla AI + the jobs.js
// monitor (escort hops). No module may push villagers with impulses —
// fighting the wander AI was the "her 2 saniyede bir ters istikamette
// itilme" bug the user reported.

export function lightingPass(dim, tick) {
  const cfg = getConfig();
  if (!String(cfg.villagerFlags || "").includes("t")) return;
  // Bedrock has no block-light layer:
  //  - at NIGHT total light == block light  -> measure directly
  //  - at DAY sky hides torch light         -> a point counts as lit when a
  //    light source sits within 6 blocks (prevents the old infinite retry)
  let tod = 12000;
  try { tod = world.getTimeOfDay(); } catch (e) { /* ignore */ }
  const night = tod >= 13000 && tod <= 23000;
  // v2.8.0: accumulator cadence (a `tick % 60 === 0` gate can NEVER hit
  // when the heartbeat interval runs on a non-zero tick offset — which
  // is exactly what happened after some reloads: lighting silently died)
  if (tick - lastPass < 60) return;
  lastPass = tick;
  for (const bell of W.getBells()) {
    const rect = W.coreRectOf(bell); // light the LIVING area (house boxes), not the wall line
    if (!rect) continue;
    const k = `${bell.x},${bell.y},${bell.z}`;
    const st = state.get(k) || { idx: 0 };
    const step = Math.max(6, cfg.torchGrid);
    const nx = Math.floor((rect.maxX - rect.minX) / step) + 1;
    const nz = Math.floor((rect.maxZ - rect.minZ) / step) + 1;
    const total = nx * nz;
    if (total <= 0) continue;

    let placed = 0;
    for (let n = 0; n < total && placed < 2; n++) {
      const i = (st.idx + n) % total;
      st.idx = (i + 1) % total;
      const gx = rect.minX + (i % nx) * step;
      const gz = rect.minZ + Math.floor(i / nx) * step;
      const sy = W.surfaceY(dim, bell.y, gx, gz);
      if (sy === null) continue;
      const airLoc = U.vec(gx, sy + 1, gz);
      const air = U.getBlock(dim, airLoc);
      if (U.typeId(air) !== "minecraft:air") continue;
      if (U.skyLight(air) < 15) continue;                        // indoors/under roof: skip
      if (night) {
        if (U.blockLight(air) >= cfg.minVillageLight) continue;  // truly lit at night
      } else if (lightSourceNear(dim, gx, sy + 1, gz, 6)) {
        continue;                                                // day: torch already covers it
      }
      const skipUntil = (st.skip || {})[i];
      if (skipUntil && tick < skipUntil) continue;               // recently failed here
      const gid = U.typeId(U.getBlock(dim, U.vec(gx, sy, gz)));
      if (!gid || U.isLiquidId(gid)) continue;
      if (U.PROTECTED.has(gid) || U.CROPS.has(gid) || U.ROAD_IDS.has(gid)) continue;

      // a villager must WALK to the spot, stand and face it (user rule)
      const worker = findWorker(dim, airLoc, 2.5); // villager must have walked here itself
      if (!worker) continue;
      // no second torch next to an existing one
      let torchNear = false;
      for (let dx = -2; dx <= 2 && !torchNear; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const t = U.typeId(U.getBlock(dim, U.vec(gx + dx, sy + 1, gz + dz)));
          if (t && t.includes("torch")) { torchNear = true; break; }
        }
      }
      if (torchNear) { st.skip = st.skip || {}; st.skip[i] = tick + 2400; continue; }

      if (!B.hasMat(dim, bell, cfg.torchBlock, 1)) {
        B.warnMissing(dim, bell, [cfg.torchBlock.replace("minecraft:", "")], system.currentTick);
        st.skip = st.skip || {}; st.skip[i] = tick + 1200;
        continue;
      }
      const tp = U.PERMS.torch(cfg.torchBlock);
      U.workerAct(worker, airLoc); // walk-arrive-look happens here, then place
      if (tp && U.setBlock(dim, airLoc, tp)) {
        B.consumeMat(dim, bell, cfg.torchBlock, 1); // pay only after success
        U.spendEnergy(worker, 6); // v2.8.0 stamina: placing is real work
        stats.torchesPlaced++;
        U.sound(dim, airLoc, "dig.wood", 0.5);
        U.debug(2, `Village light at ${gx},${sy + 1},${gz} (blockLight was ${U.blockLight(air)})`, dim, airLoc);
        placed++;
      } else {
        st.skip = st.skip || {}; st.skip[i] = tick + 600; // don't hammer a failing spot
      }
    }
    state.set(k, st);
  }
}
