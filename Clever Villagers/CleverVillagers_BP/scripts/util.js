// ============================================================
// Clever Villagers (Regrowth for Bedrock) — util.js
// Safe block/entity access, permutation resolver with legacy
// fallbacks, biome categorization, particles/sounds, budget.
// ============================================================
import { BlockPermutation, ItemStack, world } from "@minecraft/server";
import { getConfig } from "./config.js";
import * as LOG from "./log.js";

// ---------- engine heartbeat (diagnostics for /cv:info) ----------
export let loopTicks = 0;
export let lastLoopTick = -1;
export function beat(tick) { loopTicks++; lastLoopTick = tick; }

// ---------- per-cycle block-change budget (performance guard) ----------
export let changeBudget = 32;
export function resetBudget() { changeBudget = getConfig().maxBlockChangesPerCycle; }
function takeBudget() {
  if (changeBudget <= 0) return false;
  changeBudget--;
  return true;
}

// ---------- tiny vector helpers ----------
export function vec(x, y, z) { return { x, y, z }; }
export function dist2d(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
export function dist3d(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
export function randInt(n) { return Math.floor(Math.random() * n); }

export function hashId(str) {
  let h = 7;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---------- safe entity / block access ----------
export function isValidEntity(e) {
  try {
    if (!e) return false;
    const v = e.isValid;
    return typeof v === "function" ? v() : v !== false;
  } catch (err) { return false; }
}

// v2.9.0: baby villagers are NEVER workers (user rule 12.10: "çocuklara
// iş ataması yapılmamalı !!"). Detected via the is_baby component with a
// vanilla "baby" type-family fallback. Any lookup error => treated as
// ADULT so a component hiccup never idles the whole workforce.
export function isBaby(e) {
  try {
    const c = e && e.getComponent ? e.getComponent("minecraft:is_baby") : undefined;
    if (c && typeof c.value === "boolean") return c.value;
  } catch (err) { /* fall through to type family */ }
  try {
    const tf = e && e.getComponent ? e.getComponent("minecraft:type_family") : undefined;
    const fam = tf && tf.value;
    if (Array.isArray(fam)) return fam.indexOf("baby") >= 0;
  } catch (err) { /* ignore */ }
  return false;
}

export function getBlock(dim, loc) {
  try {
    const b = dim.getBlock(loc);
    if (!b) return undefined;
    const v = b.isValid;
    const ok = typeof v === "function" ? v() : v !== false;
    return ok ? b : undefined;
  } catch (e) { return undefined; } // unloaded chunk / out of bounds
}

export function typeId(block) {
  try {
    if (!block) return undefined;
    const v = block.isValid;
    const ok = typeof v === "function" ? v() : v !== false;
    return ok ? block.typeId : undefined;
  } catch (e) { return undefined; }
}

export function lightLevel(block) {
  try { return block.getLightLevel(); } catch (e) { return 15; } // fail-safe: assume bright
}

// ---------- permutation cache & resolver ----------
const permCache = new Map();
export function perm(id, states) {
  const key = states ? id + "|" + JSON.stringify(states) : id;
  if (permCache.has(key)) return permCache.get(key);
  let p;
  try { p = BlockPermutation.resolve(id, states || undefined); } catch (e) { p = undefined; }
  permCache.set(key, p);
  return p;
}

// candidates: [[id, states?], ...] → first that resolves on this client
export function firstPerm(candidates) {
  for (const c of candidates) {
    const p = Array.isArray(c) ? perm(c[0], c[1]) : perm(c);
    if (p) return p;
  }
  return undefined;
}

// ---------- block mutation ----------
export function setBlock(dim, loc, permutationOrId, states) {
  if (!takeBudget()) return false;
  try {
    const b = dim.getBlock(loc);
    if (!b) return false;
    const p = typeof permutationOrId === "string" ? perm(permutationOrId, states) : permutationOrId;
    if (!p) return false;
    b.setPermutation(p);
    return true;
  } catch (e) {
    debug(1, `setBlock failed at ${loc.x},${loc.y},${loc.z}: ${e}`);
    return false;
  }
}

const AIR = () => perm("minecraft:air");
export function clearBlock(dim, loc) { return setBlock(dim, loc, AIR()); }

export function spawnDrop(dim, loc, itemId, count = 1) {
  try {
    dim.spawnItem(new ItemStack(itemId, count), vec(loc.x + 0.5, loc.y + 0.3, loc.z + 0.5));
    return true;
  } catch (e) { return false; }
}

export function particle(dim, loc, name) {
  try { dim.spawnParticle(name, vec(loc.x + 0.5, loc.y + 0.5, loc.z + 0.5)); } catch (e) { /* particle missing — ignore */ }
}

export function sound(dim, loc, name, volume = 0.6, pitch = 1.0) {
  try { dim.playSound(name, vec(loc.x + 0.5, loc.y + 0.5, loc.z + 0.5), { volume, pitch }); } catch (e) { /* ignore */ }
}

// ---------- debug (Java mod's debugLevel 0/1/2) ----------
export function debug(level, msg, dim, loc) {
  const cfg = getConfig();
  LOG.dbg(msg);
  if (cfg.debugLevel < level) return;
  console.warn("[CV] " + msg);
  if (cfg.debugLevel >= 2) {
    try {
      for (const p of world.getAllPlayers()) {
        if (dim && loc && p.dimension && p.dimension.id === dim.id && dist3d(p.location, loc) > 24) continue;
        p.onScreenDisplay.setActionBar("§7[CV]§r " + msg);
      }
    } catch (e) { /* ignore */ }
  }
}

// ============================================================
// Block id sets — modern (flattened 26.x) + legacy names both
// ============================================================
export const GRASS_PLANTS = new Set([
  "minecraft:short_grass", "minecraft:tallgrass", "minecraft:fern", "minecraft:deadbush"
]);

export const DOUBLE_PLANTS = new Set([
  "minecraft:tall_grass", "minecraft:large_fern", "minecraft:sunflower", "minecraft:lilac",
  "minecraft:rose_bush", "minecraft:peony", "minecraft:pitcher_plant", "minecraft:double_plant"
]);

export const FLOWERS = new Set([
  "minecraft:poppy", "minecraft:dandelion", "minecraft:blue_orchid", "minecraft:allium",
  "minecraft:azure_bluet", "minecraft:red_tulip", "minecraft:orange_tulip", "minecraft:white_tulip",
  "minecraft:pink_tulip", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley",
  "minecraft:wildflowers", "minecraft:golden_dandelion", "minecraft:red_flower", "minecraft:yellow_flower"
]);

export const CUTTABLE = new Set([...GRASS_PLANTS, ...DOUBLE_PLANTS]); // grass-like, always cuttable near villages

export const CROPS = new Set([
  "minecraft:wheat", "minecraft:carrots", "minecraft:potatoes", "minecraft:beetroot"
]);

// blocks that must never get a torch / wall / fence on top
export const PROTECTED = new Set([
  "minecraft:farmland", "minecraft:wheat", "minecraft:carrots", "minecraft:potatoes", "minecraft:beetroot",
  "minecraft:melon_stem", "minecraft:pumpkin_stem", "minecraft:torchflower_crop", "minecraft:pitcher_crop",
  "minecraft:sweet_berry_bush", "minecraft:grass_path", "minecraft:dirt_path", "minecraft:bed",
  "minecraft:cave_vines", "minecraft:cave_vines_body_with_berries", "minecraft:cave_vines_head_with_berries"
]);

export const ROAD_IDS = new Set(["minecraft:grass_path", "minecraft:dirt_path"]);

// WallFoundationDataManager equivalent — ground villagers may build walls on
export const FOUNDATION = new Set([
  "minecraft:grass_block", "minecraft:dirt_with_grass", "minecraft:dirt", "minecraft:coarse_dirt",
  "minecraft:podzol", "minecraft:mycelium", "minecraft:sand", "minecraft:red_sand", "minecraft:gravel",
  "minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff",
  "minecraft:deepslate", "minecraft:cobbled_deepslate", "minecraft:moss_block", "minecraft:mud",
  "minecraft:muddy_mangrove_roots", "minecraft:sandstone", "minecraft:red_sandstone", "minecraft:smooth_sandstone",
  "minecraft:netherrack", "minecraft:calcite", "minecraft:dripstone_block", "minecraft:clay", "minecraft:packed_mud",
  "minecraft:rooted_dirt", "minecraft:snowy_dirt"
]);

// road repair: dirt-like blocks that can be flattened into path
export const SMOOTHABLE = new Set([
  "minecraft:grass_block", "minecraft:dirt_with_grass", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:gravel"
]);

export const MUSHROOM_GROUND = new Set([
  "minecraft:grass_block", "minecraft:dirt_with_grass", "minecraft:dirt", "minecraft:podzol",
  "minecraft:mycelium", "minecraft:moss_block"
]);

const LIGHT_SOURCE_RE = /(torch|lantern|glowstone|shroomlight|sea_pickle|froglight|end_rod|beacon|conduit|copper_bulb|lit_pumpkin|crying_obsidian|campfire|sea_lantern)/;
export function isLightSource(id) { return !!id && LIGHT_SOURCE_RE.test(id); }

export function isLeaves(id) {
  if (!id) return false;
  return id.endsWith("_leaves") || id === "minecraft:leaves" || id === "minecraft:leaves2";
}

export function isTreeish(id) {
  if (!id) return false;
  return /(_log$|^minecraft:log$|log2$|_wood$|^minecraft:wood$|sapling|propagule)/.test(id);
}

// ---------- v2.11.0 wood families (user: "minecraft'ta sadece meşe kütüğü
// yok — bir sürü biyom ve ağaç çeşidi var, diğerlerini de eklemelisin") ----------
// EVERY log/wood/stem id the game has (modern flattened ids + legacy ids of
// old worlds). Forest scanning, chopping, fuel, planks & charcoal all use
// these lists — an acacia/cherry/mangrove forest is now a real forest.
export const LOG_IDS = [
  "minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log", "minecraft:jungle_log",
  "minecraft:acacia_log", "minecraft:dark_oak_log", "minecraft:mangrove_log", "minecraft:cherry_log",
  "minecraft:pale_oak_log", "minecraft:crimson_stem", "minecraft:warped_stem", "minecraft:bamboo_block",
  "minecraft:oak_wood", "minecraft:spruce_wood", "minecraft:birch_wood", "minecraft:jungle_wood",
  "minecraft:acacia_wood", "minecraft:dark_oak_wood", "minecraft:mangrove_wood", "minecraft:cherry_wood",
  "minecraft:pale_oak_wood", "minecraft:crimson_hyphae", "minecraft:warped_hyphae",
  "minecraft:log", "minecraft:log2", "minecraft:wood" // legacy ids (pre-flatten worlds)
];
const LOG_ID_SET = new Set(LOG_IDS);
export const PLANK_IDS = [
  "minecraft:oak_planks", "minecraft:spruce_planks", "minecraft:birch_planks", "minecraft:jungle_planks",
  "minecraft:acacia_planks", "minecraft:dark_oak_planks", "minecraft:mangrove_planks", "minecraft:cherry_planks",
  "minecraft:pale_oak_planks", "minecraft:bamboo_planks", "minecraft:crimson_planks", "minecraft:warped_planks",
  "minecraft:planks" // legacy
];
// burnable wood (crimson/warped are fireproof; bamboo block has its own value)
export const BURNABLE_LOGS = LOG_IDS.filter(id => !/crimson|warped/.test(id));
export function isLogId(id) {
  if (!id) return false;
  if (LOG_ID_SET.has(id)) return true;
  return /(_log$|_wood$|_stem$|_hyphae$|^minecraft:log2?$|^minecraft:wood$)/.test(id);
}
// sapling that regrows the given log (legacy ids read wood_type from the block)
const SAPLING_FOR_LOG = {
  "minecraft:oak_log": "minecraft:oak_sapling", "minecraft:oak_wood": "minecraft:oak_sapling",
  "minecraft:spruce_log": "minecraft:spruce_sapling", "minecraft:spruce_wood": "minecraft:spruce_sapling",
  "minecraft:birch_log": "minecraft:birch_sapling", "minecraft:birch_wood": "minecraft:birch_sapling",
  "minecraft:jungle_log": "minecraft:jungle_sapling", "minecraft:jungle_wood": "minecraft:jungle_sapling",
  "minecraft:acacia_log": "minecraft:acacia_sapling", "minecraft:acacia_wood": "minecraft:acacia_sapling",
  "minecraft:dark_oak_log": "minecraft:dark_oak_sapling", "minecraft:dark_oak_wood": "minecraft:dark_oak_sapling",
  "minecraft:mangrove_log": "minecraft:mangrove_propagule", "minecraft:mangrove_wood": "minecraft:mangrove_propagule",
  "minecraft:cherry_log": "minecraft:cherry_sapling", "minecraft:cherry_wood": "minecraft:cherry_sapling",
  "minecraft:pale_oak_log": "minecraft:pale_oak_sapling", "minecraft:pale_oak_wood": "minecraft:pale_oak_sapling",
  "minecraft:bamboo_block": "minecraft:bamboo",
  "minecraft:crimson_stem": "minecraft:crimson_fungus", "minecraft:crimson_hyphae": "minecraft:crimson_fungus",
  "minecraft:warped_stem": "minecraft:warped_fungus", "minecraft:warped_hyphae": "minecraft:warped_fungus"
};
const LEGACY_SAPLING = {
  oak: "minecraft:oak_sapling", spruce: "minecraft:spruce_sapling", birch: "minecraft:birch_sapling",
  jungle: "minecraft:jungle_sapling", acacia: "minecraft:acacia_sapling", dark_oak: "minecraft:dark_oak_sapling"
};
export function saplingForLog(id, block) {
  if (SAPLING_FOR_LOG[id]) return SAPLING_FOR_LOG[id];
  if (id === "minecraft:log" || id === "minecraft:log2" || id === "minecraft:wood") {
    let wt = "";
    try { wt = String((block && block.permutation ? block.permutation.getState("wood_type") : "") || ""); } catch (e) { wt = ""; }
    return LEGACY_SAPLING[wt] || "minecraft:oak_sapling";
  }
  return null; // unknown wood: chop it, just don't replant
}
// zone column scan: blocks the scan may LOOK THROUGH (v2.11.0 root cause of
// "2 akasya var ama iş=0": the old scan treated the leaf canopy as a wall and
// never reached the trunk underneath)
export function isScanPassable(id) {
  if (!id) return true;
  if (id === "minecraft:air" || id === "minecraft:cave_air") return true;
  if (id === "minecraft:water" || id === "minecraft:flowing_water") return true;
  if (id === "minecraft:snow_layer") return true;
  if (GRASS_PLANTS.has(id) || FLOWERS.has(id)) return true;
  if (isLeaves(id)) return true;
  if (/(vine$|^minecraft:vine|cocoa$|propagule$|hanging_roots$|glow_lichen$|bee_nest$|beehive$|moss_carpet$)/.test(id)) return true;
  return false;
}

export function isLiquidId(id) { return id === "minecraft:water" || id === "minecraft:flowing_water" || id === "minecraft:lava" || id === "minecraft:flowing_lava"; }

// space that walls/fences may occupy (never destroys player builds)
export function isBuildableSpace(id) {
  if (!id) return false;
  if (id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water") return true;
  if (id === "minecraft:snow_layer") return true;
  if (GRASS_PLANTS.has(id) || DOUBLE_PLANTS.has(id) || FLOWERS.has(id)) return true;
  if (id === "minecraft:vine" || id === "minecraft:seagrass" || id === "minecraft:deadbush") return true;
  return false;
}

// ---------- double-plant removal (upper_block_bit aware, legacy-safe) ----------
export function removePlant(dim, block) {
  const loc = block.location;
  let upper = false;
  try { upper = block.permutation.getState("upper_block_bit") === true; } catch (e) { /* legacy: no such state */ }
  if (upper) {
    clearBlock(dim, loc);
    clearBlock(dim, vec(loc.x, loc.y - 1, loc.z));
  } else {
    const aboveId = typeId(getBlock(dim, vec(loc.x, loc.y + 1, loc.z)));
    clearBlock(dim, loc);
    if (aboveId && (DOUBLE_PLANTS.has(aboveId) || aboveId === "minecraft:double_plant" || aboveId === "minecraft:tall_grass" || aboveId === "minecraft:large_fern")) {
      clearBlock(dim, vec(loc.x, loc.y + 1, loc.z));
    }
  }
  return true;
}

// ---------- placeable permutations (modern first, legacy fallback) ----------
export const PERMS = {
  shortGrass: () => firstPerm([["minecraft:short_grass"], ["minecraft:tallgrass", { tall_grass_type: "default" }]]),
  fern: () => firstPerm([["minecraft:fern"], ["minecraft:tallgrass", { tall_grass_type: "fern" }]]),
  tallGrassLower: () => firstPerm([["minecraft:tall_grass", { upper_block_bit: false }]]),
  tallGrassUpper: () => firstPerm([["minecraft:tall_grass", { upper_block_bit: true }]]),
  tallGrassLegacy: () => firstPerm([["minecraft:tallgrass", { tall_grass_type: "tall" }]]),
  largeFernLower: () => firstPerm([["minecraft:large_fern", { upper_block_bit: false }]]),
  largeFernUpper: () => firstPerm([["minecraft:large_fern", { upper_block_bit: true }]]),
  largeFernLegacy: () => firstPerm([["minecraft:double_plant", { double_plant_type: "fern", upper_block_bit: false }]]),
  grassPath: () => firstPerm([["minecraft:grass_path"], ["minecraft:dirt_path"]]),
  farmland: () => firstPerm([["minecraft:farmland", { moisturized_amount: 0 }], ["minecraft:farmland"]]),
  torch: (id) => firstPerm([[id || "minecraft:torch", { torch_facing_direction: "top" }], [id || "minecraft:torch"]]),
  lantern: () => firstPerm([["minecraft:lantern", { hanging: false }], ["minecraft:lantern"]]),
  snowLayer0: () => firstPerm([["minecraft:snow_layer", { height: 0, covered_bit: false }], ["minecraft:snow_layer"]])
};

// tries to place a two-block plant (tall grass / large fern); returns true on success
export function placeDoublePlant(dim, loc, lower, upper, legacySingle) {
  const b0 = getBlock(dim, loc);
  const b1 = getBlock(dim, vec(loc.x, loc.y + 1, loc.z));
  const id0 = typeId(b0), id1 = typeId(b1);
  if (id0 === "minecraft:air" && id1 === "minecraft:air" && lower && upper) {
    if (setBlock(dim, loc, lower) && setBlock(dim, vec(loc.x, loc.y + 1, loc.z), upper)) return true;
  }
  if (id0 === "minecraft:air" && legacySingle) return setBlock(dim, loc, legacySingle);
  return false;
}

// ---------- flower choice per biome category ----------
const FLOWER_LISTS = {
  plains: ["minecraft:poppy", "minecraft:dandelion", "minecraft:azure_bluet", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:wildflowers"],
  forest: ["minecraft:poppy", "minecraft:dandelion", "minecraft:lily_of_the_valley", "minecraft:oxeye_daisy", "minecraft:allium"],
  flower_forest: ["minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet", "minecraft:red_tulip", "minecraft:orange_tulip", "minecraft:white_tulip", "minecraft:pink_tulip", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley"],
  swamp: ["minecraft:blue_orchid", "minecraft:poppy"],
  meadow: ["minecraft:dandelion", "minecraft:poppy", "minecraft:oxeye_daisy", "minecraft:cornflower"]
};
export function randomFlowerPerm(category) {
  const list = FLOWER_LISTS[category] || FLOWER_LISTS.plains;
  const id = list[randInt(list.length)];
  return firstPerm([[id], ["minecraft:red_flower", { flower_type: "poppy" }], ["minecraft:yellow_flower"]]);
}

// ---------- biome categorization (WallBiomeDataManager-style) ----------
export function biomeCategory(dim, loc) {
  let id = "plains";
  try { id = dim.getBiome(loc).id.toLowerCase(); } catch (e) { return "plains"; }
  if (id.includes("mushroom")) return "mushroom";
  if (id.includes("pale_garden") || id.includes("pale")) return "pale";
  if (id.includes("cherry")) return "cherry";
  if (id.includes("mangrove")) return "mangrove_swamp";
  if (id.includes("swamp") || id.includes("marsh")) return "swamp";
  if (id.includes("desert")) return "desert";
  if (id.includes("mesa") || id.includes("badlands")) return "mesa";
  if (id.includes("jungle") || id.includes("bamboo")) return "jungle";
  if (id.includes("savanna")) return "savanna";
  if (id.includes("taiga") || id.includes("mega") || id.includes("redwood") || id.includes("grove")) return "taiga";
  if (id.includes("roofed") || id.includes("dark_forest")) return "dark_forest";
  if (id.includes("birch")) return "birch";
  if (id.includes("flower_forest")) return "flower_forest";
  if (id.includes("forest") || id.includes("dappled")) return "forest";
  if (id.includes("ocean") || id.includes("river") || id.includes("beach")) return "water";
  if (id.includes("ice") || id.includes("frozen") || id.includes("snow") || id.includes("cold")) return "snowy";
  if (id.includes("peak") || id.includes("slope") || id.includes("extreme_hills") || id.includes("mountain") || id.includes("stony") || id.includes("highland") || id.includes("windswept")) return "mountain";
  if (id.includes("the_end") || id.startsWith("end")) return "end";
  if (id.includes("nether") || id.includes("hell") || id.includes("crimson") || id.includes("warped") || id.includes("soulsand") || id.includes("basalt")) return "nether";
  if (id.includes("meadow")) return "meadow";
  return "plains";
}

// ---------- saplings per biome (pig reforestation) ----------
export function saplingPermsFor(category) {
  switch (category) {
    case "taiga": case "snowy": case "mountain":
      return firstPerm([["minecraft:spruce_sapling"], ["minecraft:sapling", { sapling_type: "spruce" }]]);
    case "birch": case "meadow":
      return firstPerm([["minecraft:birch_sapling"], ["minecraft:sapling", { sapling_type: "birch" }]]);
    case "jungle":
      return firstPerm([["minecraft:jungle_sapling"], ["minecraft:sapling", { sapling_type: "jungle" }]]);
    case "savanna":
      return firstPerm([["minecraft:acacia_sapling"], ["minecraft:sapling", { sapling_type: "acacia" }]]);
    case "dark_forest":
      return firstPerm([["minecraft:dark_oak_sapling"], ["minecraft:sapling", { sapling_type: "dark_oak" }]]);
    case "cherry":
      return firstPerm([["minecraft:cherry_sapling"]]);
    case "pale":
      return firstPerm([["minecraft:pale_oak_sapling"]]);
    case "mangrove_swamp":
      return firstPerm([["minecraft:mangrove_propagule"]]);
    case "swamp":
      return firstPerm([["minecraft:oak_sapling"], ["minecraft:sapling", { sapling_type: "oak" }]]);
    case "mushroom": case "desert": case "mesa": case "water": case "end": case "nether":
      return undefined; // nothing to plant there
    default:
      return firstPerm([["minecraft:oak_sapling"], ["minecraft:sapling", { sapling_type: "oak" }]]);
  }
}

// item id of a sapling that matches a leaves block (leaf-trim bonus drops)
export function saplingItemIdForLeaves(leavesId) {
  const map = {
    "minecraft:oak_leaves": "minecraft:oak_sapling",
    "minecraft:birch_leaves": "minecraft:birch_sapling",
    "minecraft:spruce_leaves": "minecraft:spruce_sapling",
    "minecraft:jungle_leaves": "minecraft:jungle_sapling",
    "minecraft:acacia_leaves": "minecraft:acacia_sapling",
    "minecraft:dark_oak_leaves": "minecraft:dark_oak_sapling",
    "minecraft:cherry_leaves": "minecraft:cherry_sapling",
    "minecraft:pale_oak_leaves": "minecraft:pale_oak_sapling",
    "minecraft:mangrove_leaves": "minecraft:mangrove_propagule"
  };
  if (map[leavesId]) return map[leavesId];
  if (leavesId === "minecraft:leaves" || leavesId === "minecraft:leaves2") return "minecraft:oak_sapling";
  return undefined;
}

// ---------- wall / fence materials per biome category ----------
const COBBLE = [["minecraft:cobblestone_wall"]];
export function wallMaterialFor(category) {
  switch (category) {
    case "desert":
      return { wall: [["minecraft:sandstone_wall"], ["minecraft:cobblestone_wall", { wall_block_type: "sandstone" }], COBBLE[0]], fence: null };
    case "mesa":
      return { wall: [["minecraft:red_sandstone_wall"], ["minecraft:cobblestone_wall", { wall_block_type: "red_sandstone" }], COBBLE[0]], fence: null };
    case "taiga": case "snowy": case "mountain":
      return { wall: [["minecraft:stone_brick_wall"], ["minecraft:cobblestone_wall", { wall_block_type: "stone_brick" }], COBBLE[0]], fence: [["minecraft:spruce_fence"], ["minecraft:fence", { wood_type: "spruce" }]] };
    case "jungle":
      return { wall: COBBLE, fence: [["minecraft:jungle_fence"], ["minecraft:fence", { wood_type: "jungle" }]] };
    case "savanna":
      return { wall: COBBLE, fence: [["minecraft:acacia_fence"], ["minecraft:fence", { wood_type: "acacia" }]] };
    case "birch":
      return { wall: [["minecraft:mossy_cobblestone_wall"], COBBLE[0]], fence: [["minecraft:birch_fence"], ["minecraft:fence", { wood_type: "birch" }]] };
    case "dark_forest":
      return { wall: [["minecraft:mossy_cobblestone_wall"], COBBLE[0]], fence: [["minecraft:dark_oak_fence"], ["minecraft:fence", { wood_type: "dark_oak" }]] };
    case "cherry":
      return { wall: COBBLE, fence: [["minecraft:cherry_fence"]] };
    case "pale":
      return { wall: COBBLE, fence: [["minecraft:pale_oak_fence"]] };
    case "swamp": case "mushroom":
      return { wall: [["minecraft:mossy_cobblestone_wall"], COBBLE[0]], fence: [["minecraft:oak_fence"], ["minecraft:fence", { wood_type: "oak" }]] };
    case "mangrove_swamp":
      return { wall: COBBLE, fence: [["minecraft:mangrove_fence"], ["minecraft:oak_fence"], ["minecraft:fence", { wood_type: "oak" }]] };
    case "forest": case "flower_forest": case "meadow":
      return { wall: [["minecraft:mossy_cobblestone_wall"], COBBLE[0]], fence: [["minecraft:oak_fence"], ["minecraft:fence", { wood_type: "oak" }]] };
    case "water": case "end": case "nether":
      return null; // no village walls here
    default: // plains etc.
      return { wall: COBBLE, fence: [["minecraft:oak_fence"], ["minecraft:fence", { wood_type: "oak" }]] };
  }
}

// ---------- light helpers (Java LightLayer semantics) ----------
export function skyLight(block) {
  try { return block.getSkyLightLevel(); } catch (e) { return 15; }
}
// Bedrock exposes only combined light; block light ~= total - sky
export function blockLight(block) {
  try {
    const total = block.getLightLevel();
    const sky = block.getSkyLightLevel();
    return Math.max(0, total - sky);
  } catch (e) { return 15; }
}
export function canSeeSky(dim, loc) {
  const b = getBlock(dim, loc);
  return b ? skyLight(b) >= 15 : false;
}

// ---------- Java helpJumpAway equivalent ----------
export function jumpAway(entity, dim) {
  try {
    const foot = getBlock(dim, vec(Math.floor(entity.location.x), Math.floor(entity.location.y), Math.floor(entity.location.z)));
    const t = typeId(foot);
    if (!t) return;
    const inside = /(wall|fence|gate)/.test(t) || t === "minecraft:grass_path" || t === "minecraft:dirt_path";
    if (!inside) return;
    const dir = entity.getViewDirection();
    entity.applyImpulse(vec(dir.x * 0.3, 0.42, dir.z * 0.3));
  } catch (e) { /* ignore */ }
}

// ---------- house markers for village mapping ----------
export function isHouseMarker(id) {
  if (!id) return false;
  if (id === "minecraft:bed" || id.endsWith("_bed")) return true;
  if (id.endsWith("_door") || id === "minecraft:wooden_door" || id === "minecraft:iron_door" || id === "minecraft:copper_door") return true;
  if (id.includes("glass")) return true; // windows
  return false;
}

// ---------- health helper ----------
export function healEntity(entity, amount) {
  try {
    const h = entity.getComponent("minecraft:health");
    if (!h) return false;
    const cur = h.currentValue, max = h.effectiveMax ?? h.currentValue;
    if (cur >= max) return false;
    h.setCurrentValue(Math.min(max, cur + amount));
    return true;
  } catch (e) { return false; }
}

export function healthOf(entity) {
  try {
    const h = entity.getComponent("minecraft:health");
    return h ? { cur: h.currentValue, max: h.effectiveMax ?? h.currentValue } : undefined;
  } catch (e) { return undefined; }
}

export function addEffectSafe(entity, effectId, ticks, amplifier = 0, showParticles = true) {
  try {
    if (typeof entity.addEffect === "function") {
      return entity.addEffect(effectId, ticks, { amplifier, showParticles });
    }
  } catch (e) { /* ignore */ }
  return undefined;
}

// make work visibly villager-driven: the worker turns to face the
// site and emits a small "working" puff at themselves
// H2: ONE shared work cue for every mod action:
// face the site + swing animation (best-effort) + sparkle at the worker
export function workerAct(villager, targetLoc) {
  try {
    if (villager && typeof villager.lookAt === "function") villager.lookAt(targetLoc);
  } catch (e) { /* ignore */ }
  try {
    if (villager && typeof villager.playAnimation === "function") {
      villager.playAnimation("animation.villager.celebrating", { blendTime: 0.1 });
    }
  } catch (e) {
    try { villager.playAnimation("swing"); } catch (e2) { /* ignore */ }
  }
  try {
    if (villager && Math.random() < 0.7) {
      particle(villager.dimension ?? targetLoc.dimension, villager.location, "minecraft:villager_happy");
    }
  } catch (e) { /* ignore */ }
}

export function isNight() {
  try {
    const t = world.getTimeOfDay();
    return t >= 12800 && t <= 23200;
  } catch (e) { return false; }
}

// ============================================================
// v2.8.0 — WORK ENERGY (user: "20 külçe için 40 ekmek yendi!"):
// Food is NO LONGER eaten per production leg. Every villager has a
// stamina pool; real work actions drain points and a hungry villager
// walks to the food depot, takes ONE bread and eats it (physical:
// the bread leaves the chest). 1 bread = MEAL_POINTS ≈ 11 work
// actions, so a 20-ingot order costs ~2 bread instead of ~40.
// ============================================================
export const ENERGY_MAX = 100;
export const MEAL_POINTS = 70;
export const MEAL_HUNGER = 25;   // at or below this the villager seeks food
const energyMap = new Map();    // entityId -> points
export function energyOf(ent) {
  if (!ent || !ent.id) return ENERGY_MAX;
  let p = energyMap.get(ent.id);
  if (p === undefined) { p = 80; energyMap.set(ent.id, p); }
  return p;
}
export function spendEnergy(ent, pts) {
  if (!ent || !ent.id) return energyOf(ent);
  const p = Math.max(0, energyOf(ent) - pts);
  energyMap.set(ent.id, p);
  return p;
}
export function feedEnergy(ent, pts) {
  if (!ent || !ent.id) return ENERGY_MAX;
  const p = Math.min(ENERGY_MAX, energyOf(ent) + pts);
  energyMap.set(ent.id, p);
  return p;
}
export function dropEnergy(ent) { try { energyMap.delete(ent.id); } catch (e) { /* ignore */ } }
