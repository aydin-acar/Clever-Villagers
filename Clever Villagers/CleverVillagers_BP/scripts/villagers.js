// ============================================================
// Clever Villagers (Regrowth for Bedrock) — villagers.js (v1.3)
// Java-faithful action engine:
//  * every work cycle evaluates ALL flags in Java order
//    (farm → h → v → c → r → w → p), no early exit
//  * every action happens at the villager's OWN position
//    (foot block / ground block / view direction)
//  * guards: foot != bed, ground != torch, sleeping villagers
//    skip outdoor work (day/night rhythm)
//  * t (lighting) is handled by lighting.js grid planner — the
//    old random walking-torch behaviour was removed (user C1)
//  * boost window: right after bell registration, w & r cooldowns
//    are bypassed on a 12-tick pass (Java new-chunk boost)
// ============================================================
import { BlockVolume, world } from "@minecraft/server";
import { getConfig, stats } from "./config.js";
import * as U from "./util.js";
import * as W from "./walls.js";
import * as R from "./roads.js";

const profCache = new Map();
const cooldowns = new Map();
const bedCache = new Map();

const JOB_SITES = [
  // v2.7.0 (user rule): profession names == workshop types, so that
  // "own profession's order" needs no translation table. A villager is
  // a professional of the station it stands next to; a MOD tag (set by
  // the dispatcher when an unemployed villager is converted) always
  // wins over proximity.
  { prof: "cleric", types: ["minecraft:brewing_stand"] },
  { prof: "armorer", types: ["minecraft:blast_furnace", "minecraft:lit_blast_furnace"] },
  { prof: "weaponsmith", types: ["minecraft:grindstone"] },
  { prof: "cook", types: ["minecraft:smoker", "minecraft:lit_smoker"] },
  { prof: "toolsmith", types: ["minecraft:smithing_table"] },
  { prof: "mason", types: ["minecraft:stonecutter", "minecraft:stonecutter_block"] },
  { prof: "farmer", types: ["minecraft:composter"] },
  { prof: "smelter", types: ["minecraft:furnace", "minecraft:lit_furnace"] },
  { prof: "librarian", types: ["minecraft:lectern"] },
  { prof: "shepherd", types: ["minecraft:loom"] },
  { prof: "leatherworker", types: ["minecraft:cauldron"] },
  { prof: "fletcher", types: ["minecraft:fletching_table"] },
  { prof: "cartographer", types: ["minecraft:cartography_table"] }
];
// NOTE (v2.7.0): crafting_table & barrel are NOT profession markers —
// crafting tables sit in every house (everyone would turn "forester")
// and barrels are depot containers (everyone would turn "fisherman").
// forester/fisherman professions only exist via mod-tag conversion.

const PROF_TAG = "cvprof:";
export function profTag(entity) {
  try {
    for (const t of entity.getTags()) if (t.startsWith(PROF_TAG)) return t.slice(PROF_TAG.length);
  } catch (e) { /* ignore */ }
  return null;
}
export function setProfTag(entity, type) {
  try {
    for (const t of entity.getTags()) if (t.startsWith(PROF_TAG) && t !== PROF_TAG + type) entity.removeTag(t);
    entity.addTag(PROF_TAG + type);
    profCache.delete(entity.id);
    return true;
  } catch (e) { return false; }
}
export function clearProfTag(entity) {
  try {
    for (const t of entity.getTags()) if (t.startsWith(PROF_TAG)) entity.removeTag(t);
    profCache.delete(entity.id);
  } catch (e) { /* ignore */ }
}

export function professionOf(entity, dim, tick) {
  const tagged = profTag(entity); // mod assignment beats proximity (v2.7.0)
  if (tagged) return tagged;
  const c = profCache.get(entity.id);
  if (c && tick - c.tick < 600) return c.prof; // v2.9.0: 600t (was 1200) — a broken station must free the villager quickly
  let prof = null;
  // v2.10.0 (user: "Çoban tarla işine atanıyor ama tarlaya bakmıyor"):
  // the old scan asked "is ANY station of type X inside 12 blocks?" in
  // JOB_SITES ORDER — a shepherd standing 3 blk from his loom but 8 blk
  // from a composter read as FARMER (farmer is checked first) and got
  // dragged into the fields. Now the profession is the NEAREST station
  // (vanilla-like: a villager belongs to the site it actually works at).
  try {
    const loc = entity.location;
    const fx = Math.floor(loc.x), fy = Math.floor(loc.y), fz = Math.floor(loc.z);
    const r = 5;
    const vol = new BlockVolume(U.vec(fx - r, fy - 3, fz - r), U.vec(fx + r, fy + 3, fz + r));
    let bestD = 99;
    for (const js of JOB_SITES) {
      let blocks = null;
      try { blocks = dim.getBlocks(vol, { includeTypes: js.types }); } catch (e) { blocks = null; }
      if (blocks === null || blocks === undefined) {
        try { if (dim.containsBlock(vol, { includeTypes: js.types }, true)) { prof = js.prof; break; } } catch (e) { /* ignore */ }
        continue;
      }
      for (const b of blocks) {
        const bl = b.location || b;
        const dd = Math.max(Math.abs(bl.x - fx), Math.abs(bl.y - fy), Math.abs(bl.z - fz));
        if (dd < bestD) { bestD = dd; prof = js.prof; }
      }
    }
  } catch (e) { /* ignore */ }
  profCache.set(entity.id, { prof, tick });
  return prof;
}

// v2.9.0 profession lifecycle helpers (used by jobs.js profWatchdog):
// marker blocks per profession + "is any station of this trade nearby?"
export function markerTypesFor(prof) {
  for (const js of JOB_SITES) if (js.prof === prof) return js.types;
  return undefined; // tag-only professions (forester/fisherman…) have no markers
}
export function stationNearby(dim, loc, types, rH = 24, rV = 8) {
  try {
    const vol = new BlockVolume(
      U.vec(Math.floor(loc.x) - rH, Math.floor(loc.y) - rV, Math.floor(loc.z) - rH),
      U.vec(Math.floor(loc.x) + rH, Math.floor(loc.y) + rV, Math.floor(loc.z) + rH)
    );
    return dim.containsBlock(vol, { includeTypes: types }, true);
  } catch (e) { return true; } // unverifiable (unloaded etc.) => NEVER strip a profession on error
}

export function villagerWork(entity, dim, tick, boost) {
  const cfg = getConfig();
  const flags = String(cfg.villagerFlags || "");
  if (!flags) return false;
  const cd = cooldowns.get(entity.id) || {};
  const loc = entity.location;
  const footLoc = U.vec(Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z));
  const foot = U.getBlock(dim, footLoc);
  const ground = U.getBlock(dim, U.vec(footLoc.x, footLoc.y - 1, footLoc.z));
  const footId = U.typeId(foot);
  const groundId = U.typeId(ground);

  let sleeping = false;
  try { sleeping = !!entity.isSleeping; } catch (e) { /* ignore */ }

  // Java guards: standing on a bed or on a torch => skip outdoor work
  if (groundId === "minecraft:bed" || (groundId && groundId.includes("torch"))) {
    cooldowns.set(entity.id, cd);
    return false;
  }

  let acted = false;

  // ---- bonus: farmer re-tills trampled farmland ----
  if (cfg.farmRepair && (cd.farm || 0) <= tick) {
    cd.farm = tick + 240;
    if (professionOf(entity, dim, tick) === "farmer" && doFarmRepair(entity, dim, footLoc)) acted = true;
  }

  // ---- h: cleric healing / smith golem repair ----
  if (flags.includes("h") && (cd.heal || 0) <= tick) {
    cd.heal = tick + 140;
    if (doHeal(entity, dim, tick, footLoc)) acted = true;
  }

  // ---- v: trim leaves/cactus in view ----
  if (flags.includes("v") && !sleeping && (cd.trim || 0) <= tick) {
    cd.trim = tick + 70;
    if (doTrim(entity, dim)) acted = true;
  }

  // ---- c: cut the grass the villager stands in (Java vCutGrass) ----
  if (flags.includes("c") && !sleeping && (cd.cut || 0) <= tick) {
    cd.cut = tick + 20;
    if (foot && U.CUTTABLE.has(footId)) {
      U.removePlant(dim, foot);
      stats.grassCut++;
      acted = true;
      U.debug(2, `Grass cut underfoot at ${footLoc.x},${footLoc.y},${footLoc.z}`, dim, footLoc);
    } else if (cfg.cutFlowers && foot && U.FLOWERS.has(footId)) {
      U.removePlant(dim, foot);
      stats.grassCut++;
      acted = true;
    }
  }

  // ---- r: road repairs where the villager walks (Java vRoadImprove) ----
  if (flags.includes("r") && !sleeping && ((cd.road || 0) <= tick || boost)) {
    if (!boost) cd.road = tick + 30; else cd.road = tick + 12;
    if (foot && ground && R.fixAt(dim, entity, footLoc, { typeId: groundId })) acted = true;
  }

  // ---- w: village wall column (worker walks to the site) ----
  if (flags.includes("w") && !sleeping && ((cd.wall || 0) <= tick || boost)) {
    if (!boost) cd.wall = tick + 20; else cd.wall = tick + 12;
    // bells are registered ONLY via /cv:bell add (user request)
    const bell = W.nearestBell(dim, loc, 128);
    if (bell && W.wallEnabledAt(dim, bell)) {
      if (W.tryBuildAtVillager(dim, bell, entity)) acted = true;
    }
  }

  // ---- p: personal home fence (Java square ring around the bed) ----
  if (flags.includes("p") && !sleeping && (cd.fence || 0) <= tick) {
    cd.fence = tick + 40;
    if (doHomeFence(entity, dim, footLoc, groundId)) acted = true;
  }

  cooldowns.set(entity.id, cd);
  if (acted && Math.random() < 0.5) U.particle(dim, loc, "minecraft:villager_happy");
  return acted;
}

// ============================================================
// h — healing (works fine per user report F1 — unchanged)
// ============================================================
function doHeal(entity, dim, tick, feet) {
  const prof = professionOf(entity, dim, tick);
  if (prof !== "cleric" && prof !== "toolsmith" && prof !== "armorer" && prof !== "weaponsmith") return false;
  const targets = [];
  try {
    for (const e of dim.getEntities({ location: feet, maxDistance: 8 })) {
      if (!U.isValidEntity(e) || e.id === entity.id) continue;
      const t = e.typeId;
      if (prof === "cleric") {
        if (t === "minecraft:villager_v2" || t === "minecraft:villager" || t === "minecraft:player") targets.push(e);
      } else if (t === "minecraft:iron_golem" || t === "minecraft:copper_golem") targets.push(e);
    }
  } catch (e) { return false; }
  let hurt = null, ratio = 1;
  for (const t of targets) {
    const hp = U.healthOf(t);
    if (hp && hp.cur < hp.max && hp.cur / hp.max < ratio) { ratio = hp.cur / hp.max; hurt = t; }
  }
  if (!hurt) return false;
  U.addEffectSafe(hurt, "minecraft:regeneration", 160, 1, true);
  U.particle(dim, hurt.location, prof === "toolsmith" ? "minecraft:totem_particle" : "minecraft:heart_particle");
  U.sound(dim, hurt.location, "random.orb", 0.5, 1.2);
  U.workerAct(entity, hurt.location);
  stats.heals++;
  U.debug(2, `${prof} healed ${hurt.typeId} (${Math.round(ratio * 100)}%)`, dim, hurt.location);
  return true;
}

// ============================================================
// v — leaves / cactus in view
// ============================================================
function doTrim(entity, dim) {
  const cfg = getConfig();
  let hit;
  try { hit = entity.getBlockFromViewDirection({ maxDistance: 3.5, includeLiquidBlocks: false, includePassableBlocks: true }); } catch (e) { return false; }
  const block = hit && hit.block ? hit.block : undefined;
  const t = U.typeId(block);
  if (!t) return false;
  if (U.isLeaves(t)) {
    U.clearBlock(dim, block.location);
    stats.leavesTrimmed++;
    if (cfg.leafDrops) {
      const r = Math.random();
      if (r < 0.18) { const sap = U.saplingItemIdForLeaves(t); if (sap) U.spawnDrop(dim, block.location, sap, 1); }
      else if (r < 0.22) U.spawnDrop(dim, block.location, "minecraft:apple", 1);
    }
    U.sound(dim, block.location, "dig.grass", 0.4);
    U.workerAct(entity, block.location);
    return true;
  }
  if (t === "minecraft:cactus") {
    const loc = block.location;
    U.clearBlock(dim, loc);
    U.spawnDrop(dim, loc, "minecraft:cactus", 1);
    const up = U.vec(loc.x, loc.y + 1, loc.z);
    if (U.typeId(U.getBlock(dim, up)) === "minecraft:cactus") { U.clearBlock(dim, up); U.spawnDrop(dim, up, "minecraft:cactus", 1); }
    stats.leavesTrimmed++;
    U.workerAct(entity, loc);
    return true;
  }
  return false;
}

// ============================================================
// p — home fence: Java square ring (r = 4) around the bed
// ============================================================
function doHomeFence(entity, dim, footLoc, groundId) {
  let bed = bedCache.get(entity.id);
  if (!bed) {
    bed = findBedNear(dim, footLoc, 10);
    if (!bed) return false;
    bedCache.set(entity.id, bed);
  }
  const r = 4;
  const dx = footLoc.x - bed.x, dz = footLoc.z - bed.z;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const onRing = (adx === r && adz <= r) || (adz === r && adx <= r);
  if (!onRing) return false;
  if (U.ROAD_IDS.has(groundId) || groundId === "minecraft:gravel") return false;
  if (!U.FOUNDATION.has(groundId)) return false;
  const footId = U.typeId(U.getBlock(dim, footLoc));
  if (footId && !U.isBuildableSpace(footId)) return false;
  const fenceP = U.firstPerm([["minecraft:oak_fence"], ["minecraft:fence", { wood_type: "oak" }]]);
  if (!fenceP) return false;
  if (U.setBlock(dim, footLoc, fenceP)) {
    stats.fencesBuilt++;
    U.workerAct(entity, footLoc);
    U.jumpAway(entity, dim);
    U.sound(dim, footLoc, "dig.wood", 0.3);
    U.debug(2, `Home fence piece at ${footLoc.x},${footLoc.y},${footLoc.z}`, dim, footLoc);
    return true;
  }
  return false;
}

function findBedNear(dim, feet, radius) {
  for (let dx = -radius; dx <= radius; dx += 2)
    for (let dz = -radius; dz <= radius; dz += 2)
      for (let dy = -3; dy <= 3; dy++) {
        const t = U.typeId(U.getBlock(dim, U.vec(feet.x + dx, feet.y + dy, feet.z + dz)));
        if (t === "minecraft:bed" || (t && t.endsWith("_bed"))) return U.vec(feet.x + dx, feet.y + dy, feet.z + dz);
      }
  return undefined;
}

// ============================================================
// bonus — farmer re-tills trampled farmland
// ============================================================
function doFarmRepair(entity, dim, feet) {
  let fixed = 0;
  for (let dx = -5; dx <= 5 && fixed < 2; dx++)
    for (let dz = -5; dz <= 5 && fixed < 2; dz++)
      for (let dy = -2; dy <= 2 && fixed < 2; dy++) {
        const loc = U.vec(feet.x + dx, feet.y + dy, feet.z + dz);
        const t = U.typeId(U.getBlock(dim, loc));
        if (!t || !U.CROPS.has(t)) continue;
        const belowLoc = U.vec(loc.x, loc.y - 1, loc.z);
        const belowId = U.typeId(U.getBlock(dim, belowLoc));
        if (belowId === "minecraft:dirt" || belowId === "minecraft:coarse_dirt") {
          const farmland = U.PERMS.farmland();
          if (farmland && U.setBlock(dim, belowLoc, farmland)) {
            fixed++;
            stats.farmlandRepaired++;
            U.particle(dim, belowLoc, "minecraft:villager_happy");
          }
        }
      }
  if (fixed > 0) {
    U.workerAct(entity, feet);
    U.sound(dim, feet, "dig.grass", 0.4);
    U.debug(2, `Farmer re-tilled ${fixed} trampled farmland`, dim, feet);
    return true;
  }
  return false;
}
