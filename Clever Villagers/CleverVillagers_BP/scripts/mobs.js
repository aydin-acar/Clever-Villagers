// ============================================================
// Clever Villagers (Regrowth for Bedrock) — mobs.js
// Animal & monster nature actions, mirroring the Java mod's
// defaultRegrowthMobs string:
//   cow=both(300s) horse=eats(180s) sheep=eats(120s)
//   pig=reforest(450s) creeper=tall(90s) zombie=stumble(30s)
//   skeleton=mushroom squid=coral
// Plus Bedrock bonuses: donkey grazing, husk/stray variants,
// glow squid coral, dead-coral revival.
// ============================================================
import { getConfig, stats } from "./config.js";
import * as U from "./util.js";

export const MOB_ACTIONS = [
  { type: "minecraft:cow", action: "both", seconds: 300 },
  { type: "minecraft:sheep", action: "eat", seconds: 120 },
  { type: "minecraft:horse", action: "eat", seconds: 180 },
  { type: "minecraft:donkey", action: "eat", seconds: 240 },      // bonus
  { type: "minecraft:pig", action: "reforest", seconds: 450 },
  { type: "minecraft:creeper", action: "tall", seconds: 90 },
  { type: "minecraft:zombie", action: "stumble", seconds: 30 },
  { type: "minecraft:husk", action: "stumble", seconds: 45 },     // bonus
  { type: "minecraft:skeleton", action: "mushroom", seconds: 120 },
  { type: "minecraft:stray", action: "mushroom", seconds: 150 },  // bonus
  { type: "minecraft:squid", action: "coral", seconds: 120 },
  { type: "minecraft:glow_squid", action: "coral", seconds: 150 }  // bonus
];

const nextActionTick = new Map();

export function mobTick(entity, dim, tick, action, seconds) {
  const cfg = getConfig();
  const due = nextActionTick.get(entity.id) || 0;
  if (tick < due) return;
  const jitter = 0.75 + Math.random() * 0.5;
  nextActionTick.set(entity.id, tick + Math.max(20, Math.round(seconds * 20 * cfg.mobIntervalScale * jitter)));
  switch (action) {
    case "eat": eatMob(entity, dim); break;
    case "grow": growMob(entity, dim); break;
    case "both": if (Math.random() < 0.15) growMob(entity, dim); else eatMob(entity, dim); break; // Java: 15% grow / 85% eat
    case "tall": tallMob(entity, dim); break;
    case "stumble": stumbleMob(entity, dim); break;
    case "reforest": reforestMob(entity, dim); break;
    case "mushroom": mushroomMob(entity, dim); break;
    case "coral": coralMob(entity, dim); break;
    default: break;
  }
}

// ---------- helpers ----------
function feetOf(entity) {
  const l = entity.location;
  return U.vec(Math.floor(l.x), Math.floor(l.y), Math.floor(l.z));
}

function groundBelow(dim, feet) {
  const b = U.getBlock(dim, U.vec(feet.x, feet.y - 1, feet.z));
  return { block: b, id: U.typeId(b) };
}

const GRAZABLE = new Set(["minecraft:grass_block", "minecraft:dirt_with_grass"]);

// ---------- eat: animals graze grass (Java 'eat' action) ----------
function eatMob(entity, dim) {
  const cfg = getConfig();
  const feet = feetOf(entity);
  let ate = false;
  // 1) eat nearby grass plants
  for (let s = 0; s < 6 && !ate; s++) {
    const loc = U.vec(feet.x + U.randInt(5) - 2, feet.y + U.randInt(3) - 1, feet.z + U.randInt(5) - 2);
    const b = U.getBlock(dim, loc);
    const t = U.typeId(b);
    if (t && (U.GRASS_PLANTS.has(t) || t === "minecraft:short_grass")) {
      U.removePlant(dim, b);
      ate = true;
    }
  }
  // 2) or nibble the grass block itself (like vanilla grazing)
  if (!ate) {
    const g = groundBelow(dim, feet);
    if (g.id && GRAZABLE.has(g.id) && U.typeId(U.getBlock(dim, feet)) === "minecraft:air") {
      // only nibble where nothing is growing on it
      ate = U.setBlock(dim, U.vec(feet.x, feet.y - 1, feet.z), U.firstPerm([["minecraft:dirt"]]));
    }
  }
  if (!ate) return;
  stats.grassEaten++;
  U.particle(dim, entity.location, "minecraft:villager_happy");
  U.sound(dim, feet, "dig.grass", 0.5);
  if (Math.random() < cfg.eatingHeals) {
    if (U.healEntity(entity, 2)) U.particle(dim, entity.location, "minecraft:heart_particle"); // Java eatingHeals
  }
  U.debug(2, `${entity.typeId} grazed near ${feet.x},${feet.y},${feet.z}`, dim, feet);
}

// ---------- grow: animals fertilize the ground (Java 'grow') ----------
function growMob(entity, dim) {
  const feet = feetOf(entity);
  const cat = U.biomeCategory(dim, feet);
  let grown = 0;
  for (let s = 0; s < 5 && grown < 3; s++) {
    const loc = U.vec(feet.x + U.randInt(5) - 2, feet.y - 1, feet.z + U.randInt(5) - 2);
    const g = U.getBlock(dim, loc);
    if (!g.id || !GRAZABLE.has(g.id)) continue;
    const aboveLoc = U.vec(loc.x, loc.y + 1, loc.z);
    if (U.typeId(U.getBlock(dim, aboveLoc)) !== "minecraft:air") continue;
    const roll = Math.random();
    let ok = false;
    if (roll < 0.45) {
      ok = U.setBlock(dim, aboveLoc, U.PERMS.shortGrass());
    } else if (roll < 0.65) {
      ok = U.placeDoublePlant(dim, aboveLoc, U.PERMS.tallGrassLower(), U.PERMS.tallGrassUpper(), U.PERMS.tallGrassLegacy());
    } else if (roll < 0.8) {
      ok = U.setBlock(dim, aboveLoc, U.PERMS.fern());
    } else {
      const f = U.randomFlowerPerm(cat === "plains" && Math.random() < 0.1 ? "flower_forest" : cat);
      if (f) ok = U.setBlock(dim, aboveLoc, f);
    }
    if (ok) grown++;
  }
  if (grown > 0) {
    stats.plantsGrown += grown;
    U.particle(dim, entity.location, "minecraft:villager_happy");
    U.debug(2, `${entity.typeId} grew ${grown} plant(s) near ${feet.x},${feet.y},${feet.z}`, dim, feet);
  }
}

// ---------- tall: creepers grow tall grass (Java 'tall') ----------
function tallMob(entity, dim) {
  const feet = feetOf(entity);
  let grown = 0;
  for (let s = 0; s < 8 && grown < 3; s++) {
    const loc = U.vec(feet.x + U.randInt(7) - 3, feet.y + U.randInt(3) - 1, feet.z + U.randInt(7) - 3);
    const b = U.getBlock(dim, loc);
    const t = U.typeId(b);
    if (t === "minecraft:short_grass" || t === "minecraft:tallgrass") {
      const up1 = U.vec(loc.x, loc.y + 1, loc.z);
      const up2 = U.vec(loc.x, loc.y + 2, loc.z);
      if (U.typeId(U.getBlock(dim, up1)) === "minecraft:air" && U.typeId(U.getBlock(dim, up2)) === "minecraft:air") {
        if (U.placeDoublePlant(dim, loc, U.PERMS.tallGrassLower(), U.PERMS.tallGrassUpper(), U.PERMS.tallGrassLegacy())) grown++;
      }
    } else if (t === "minecraft:fern") {
      const up1 = U.vec(loc.x, loc.y + 1, loc.z);
      const up2 = U.vec(loc.x, loc.y + 2, loc.z);
      if (U.typeId(U.getBlock(dim, up1)) === "minecraft:air" && U.typeId(U.getBlock(dim, up2)) === "minecraft:air") {
        if (U.placeDoublePlant(dim, loc, U.PERMS.largeFernLower(), U.PERMS.largeFernUpper(), U.PERMS.largeFernLegacy())) grown++;
      }
    }
  }
  // nothing to upgrade? sprout fresh tall grass on the ground below
  if (grown === 0) {
    const g = groundBelow(dim, feet);
    if (g.id && GRAZABLE.has(g.id)) {
      if (U.placeDoublePlant(dim, feet, U.PERMS.tallGrassLower(), U.PERMS.tallGrassUpper(), U.PERMS.tallGrassLegacy())) grown = 1;
    }
  }
  if (grown > 0) {
    stats.plantsGrown += grown;
    U.debug(2, `Creeper grew ${grown} tall grass near ${feet.x},${feet.y},${feet.z} (hiss!)`, dim, feet);
  }
}

// ---------- stumble: zombies knock torches down (Java 'stumble') ----------
function stumbleMob(entity, dim) {
  const cfg = getConfig();
  const feet = feetOf(entity);
  const torchIds = new Set(["minecraft:torch", "minecraft:soul_torch", "minecraft:copper_torch", cfg.torchBlock]);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        const loc = U.vec(feet.x + dx, feet.y + dy, feet.z + dz);
        const t = U.typeId(U.getBlock(dim, loc));
        if (t && torchIds.has(t)) {
          if (U.clearBlock(dim, loc)) {
            stats.torchesStomped++;
            if (cfg.torchDrops) U.spawnDrop(dim, loc, t, 1);
            U.sound(dim, loc, "dig.wood", 0.8, 0.6);
            U.particle(dim, loc, "minecraft:basic_smoke_particle");
            U.debug(2, `${entity.typeId} stumbled and knocked down a torch at ${loc.x},${loc.y},${loc.z}!`, dim, loc);
            return;
          }
        }
      }
    }
  }
}

// ---------- reforest: pigs plant saplings (Java 'reforest') ----------
function reforestMob(entity, dim) {
  const feet = feetOf(entity);
  const cat = U.biomeCategory(dim, feet);
  if (cat === "desert" || cat === "mesa" || cat === "water" || cat === "end" || cat === "nether" || cat === "snowy" || cat === "mountain") return;

  const g = groundBelow(dim, feet);
  const plantable = new Set(["minecraft:grass_block", "minecraft:dirt_with_grass", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:podzol"]);
  if (!g.id || !plantable.has(g.id)) return;
  if (U.typeId(U.getBlock(dim, feet)) !== "minecraft:air") return;
  const head = U.vec(feet.x, feet.y + 1, feet.z);
  if (U.typeId(U.getBlock(dim, head)) !== "minecraft:air") return;

  // spacing: no tree/sapling nearby (Java checks room to grow)
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dy = -1; dy <= 3; dy++) {
        const t = U.typeId(U.getBlock(dim, U.vec(feet.x + dx, feet.y + dy, feet.z + dz)));
        if (t && U.isTreeish(t)) return;
      }
    }
  }

  if (cat === "mushroom") {
    // mushroom island: pigs spread mushrooms instead
    const m = U.firstPerm([["minecraft:brown_mushroom"], ["minecraft:red_mushroom"]]);
    if (m && U.setBlock(dim, feet, m)) {
      stats.mushroomsGrown++;
      U.debug(2, `Pig planted a mushroom at ${feet.x},${feet.y},${feet.z}`, dim, feet);
    }
    return;
  }

  const sap = U.saplingPermsFor(cat);
  if (!sap) return;
  if (U.setBlock(dim, feet, sap)) {
    stats.saplingsPlanted++;
    U.particle(dim, feet, "minecraft:villager_happy");
    U.debug(2, `Pig reforested: sapling at ${feet.x},${feet.y},${feet.z} (${cat})`, dim, feet);
  }
}

// ---------- mushroom: skeletons farm mushrooms (Java 'mushroom') ----------
function mushroomMob(entity, dim) {
  const cfg = getConfig();
  const feet = feetOf(entity);
  const cat = U.biomeCategory(dim, feet);
  const okCats = new Set(["forest", "flower_forest", "dark_forest", "taiga", "swamp", "mangrove_swamp", "mushroom", "birch", "cherry", "pale", "plains", "meadow"]);
  if (!okCats.has(cat)) return;

  // density check (Java mushroomDensity)
  let count = 0;
  for (let dx = -4; dx <= 4 && count < cfg.mushroomDensity; dx++) {
    for (let dz = -4; dz <= 4 && count < cfg.mushroomDensity; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        const t = U.typeId(U.getBlock(dim, U.vec(feet.x + dx, feet.y + dy, feet.z + dz)));
        if (t === "minecraft:red_mushroom" || t === "minecraft:brown_mushroom") count++;
      }
    }
  }
  if (count >= cfg.mushroomDensity) return;

  for (let s = 0; s < 6; s++) {
    const loc = U.vec(feet.x + U.randInt(7) - 3, feet.y + U.randInt(3) - 1, feet.z + U.randInt(7) - 3);
    const b = U.getBlock(dim, loc);
    if (U.typeId(b) !== "minecraft:air") continue;
    if (U.lightLevel(b) > cfg.mushroomLightLevel) continue; // darkness required
    const belowId = U.typeId(U.getBlock(dim, U.vec(loc.x, loc.y - 1, loc.z)));
    if (!belowId || !U.MUSHROOM_GROUND.has(belowId)) continue;
    const redBias = (cat === "swamp" || cat === "dark_forest" || cat === "mushroom" || cat === "mangrove_swamp") ? 0.7 : (cat === "taiga" ? 0.3 : 0.5);
    const m = Math.random() < redBias
      ? U.firstPerm([["minecraft:red_mushroom"]])
      : U.firstPerm([["minecraft:brown_mushroom"]]);
    if (m && U.setBlock(dim, loc, m)) {
      stats.mushroomsGrown++;
      U.particle(dim, loc, "minecraft:villager_happy");
      U.debug(2, `Skeleton farmed a mushroom at ${loc.x},${loc.y},${loc.z}`, dim, loc);
      return;
    }
  }
}

// ---------- coral: squid grow & revive coral (Java 'coral') ----------
const CORAL_FANS = ["minecraft:tube_coral_fan", "minecraft:brain_coral_fan", "minecraft:bubble_coral_fan", "minecraft:fire_coral_fan", "minecraft:horn_coral_fan"];
const CORAL_COLORS = ["blue", "pink", "purple", "red", "yellow"];

function coralMob(entity, dim) {
  let inWater = false;
  try { inWater = entity.isInWater; } catch (e) { inWater = false; }
  if (!inWater) return;
  const feet = feetOf(entity);

  let biomeId = "";
  try { biomeId = dim.getBiome(feet).id.toLowerCase(); } catch (e) { return; }
  const warm = biomeId.includes("warm_ocean") || biomeId.includes("lukewarm") || biomeId.includes("deep_warm");

  // find coral or dead coral nearby (colonies expand from existing coral)
  let coralNear = false, deadSpot = null;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = -3; dy <= 3; dy++) {
        const loc = U.vec(feet.x + dx, feet.y + dy, feet.z + dz);
        const t = U.typeId(U.getBlock(dim, loc));
        if (!t) continue;
        if (t.startsWith("minecraft:dead_") && t.includes("coral")) {
          if (!deadSpot) deadSpot = { loc, t };
          coralNear = true;
        } else if (t.includes("coral")) {
          coralNear = true;
        }
      }
    }
  }
  if (!warm && !coralNear) return;

  // 1) revive dead coral (bonus improvement — very "regrowth")
  if (deadSpot) {
    const aliveId = deadSpot.t.replace("minecraft:dead_", "minecraft:");
    const p = U.perm(aliveId);
    if (p && U.setBlock(dim, deadSpot.loc, p)) {
      stats.coralRevived++;
      U.particle(dim, deadSpot.loc, "minecraft:villager_happy");
      U.debug(2, `Squid revived coral at ${deadSpot.loc.x},${deadSpot.loc.y},${deadSpot.loc.z}`, dim, deadSpot.loc);
      return;
    }
  }

  // 2) grow new coral fans on solid ground underwater
  for (let s = 0; s < 8; s++) {
    const loc = U.vec(feet.x + U.randInt(7) - 3, feet.y + U.randInt(5) - 3, feet.z + U.randInt(7) - 3);
    const b = U.getBlock(dim, loc);
    const waterId = U.typeId(b);
    if (waterId !== "minecraft:water" && waterId !== "minecraft:flowing_water") continue;
    const belowId = U.typeId(U.getBlock(dim, U.vec(loc.x, loc.y - 1, loc.z)));
    if (!belowId) continue;
    const okBottom = belowId.includes("coral") || belowId.includes("sand") ||
      belowId === "minecraft:gravel" || belowId === "minecraft:dirt" ||
      belowId === "minecraft:stone" || belowId === "minecraft:clay";
    if (!okBottom) continue;
    const i = U.randInt(CORAL_FANS.length);
    let p = U.perm(CORAL_FANS[i], { coral_fan_direction: U.randInt(2) });
    if (!p) p = U.perm("minecraft:coral_fan", { coral_color: CORAL_COLORS[i], coral_fan_direction: U.randInt(2) }); // legacy
    if (p && U.setBlock(dim, loc, p)) {
      stats.coralsGrown++;
      U.particle(dim, loc, "minecraft:villager_happy");
      U.debug(2, `Squid grew coral at ${loc.x},${loc.y},${loc.z}`, dim, loc);
      return;
    }
  }
}
