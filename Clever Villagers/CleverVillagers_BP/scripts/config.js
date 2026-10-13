// ============================================================
// Clever Villagers (Regrowth for Bedrock) — config.js
// Configuration, persistence (world dynamic properties), stats.
// Mirrors the Java mod's MyConfig.java options where possible.
// ============================================================
import { world } from "@minecraft/server";

const CONFIG_KEY = "cv:config";
const BELLS_KEY = "cv:bells";
const WALLPROG_KEY = "cv:wallprog";
const STATS_KEY = "cv:stats";

// ---------- defaults (Regrowth-inspired) ----------
export const DEFAULTS = {
  enabled: true,               // master switch (pause/resume)
  wallsOn: false,              // construction switch (/cv:walls on|off) — default OFF
  roadsOn: false,              // road standard engine (/cv:roads on|off) — default OFF
  debugLevel: 0,               // 0=off, 1=log, 2=log+action bar (like Java debugLevel 0-2)
  villagerFlags: "chrwvt",     // c=cut grass h=heal r=roads w=walls v=trim leaves t=torches p=home fences (off by default, like Java)
  workIntervalTicks: 40,       // villager work cadence (Java: 2.0 seconds)
  torchLightLevel: 3,          // Java torchLightLevel: place torches where light <= this
  torchBlock: "minecraft:torch",
  eatingHeals: 0.99,           // Java eatingHeals: chance animals heal when eating grass
  cutFlowers: false,           // improvement: also cut single flowers when trimming (default off, keeps gardens safe)
  leafDrops: true,             // improvement: trimmed leaves can drop saplings/apples
  mushroomDensity: 6,          // Java mushroomDensity
  mushroomLightLevel: 7,       // improvement: skeletons farm mushrooms only in darkness
  wallControlBlock: "minecraft:cobblestone_wall", // Java playerWallControlBlockString
  wallsAlwaysOn: false,        // improvement: skip the control-block requirement
  wallRadius: 19,              // Java: bell-centred square ring radius (diameter/2-1)
  wallHeight: 1,               // Java look: single wall block + corner lantern posts
  wallTorchEvery: 0,           // 0 = Java auto spacing ((radius+1)/4); N = every Nth column
  villageWallMargin: 10,       // wall line distance beyond the outermost house
  wallGates: true,             // fence gates where roads cross the wall line
  centerGates: true,           // Java: open-ish gate at the middle of each wall side
  houseSeedRadius: 50,         // seed frame radius (user: 100 wide frame)
  houseWaveRadius: 60,         // directional wave scan radius (user: 60)
  logEnabled: true,            // ring-buffer log + console mirror (/cv:log)
  houseClusterRadius: 10,      // markers of the SAME building chain (10 blk; +rect-merge 2)
  houseGrowRadius: 20,         // border houses re-scanned with 40 block diameter
  houseWallPad: 2,             // marker bbox -> house outer wall allowance
  wallOffset: 10,              // wall line distance beyond outer house walls (10..30)
  minVillageLight: 1,          // night light floor (monster spawn safety, 0..7)
  torchGrid: 16,               // lighting grid spacing inside the village
  earlyBoostMinutes: 60,       // Java-like fast build window after bell registration
  workerRadius: 100,           // crew recruitment radius around the bell (user: 100)
  constructionChest: true,     // build materials are consumed from the bell chest
  torchDrops: true,            // improvement: torches stomped by zombies drop as items
  farmRepair: true,            // improvement: farmers re-till trampled farmland (Bedrock take on TrampleEventHandler)
  mobsEnabled: true,           // animal/monster regrowth actions
  mobIntervalScale: 1.0,       // multiplier on all mob action intervals
  maxBlockChangesPerCycle: 32, // performance guard (Java skips half of entities; we cap block edits too)
  onlyOverworld: true,         // process only the Overworld (villages live there)
  breedingOn: true,            // v2.10.0: evening breeding support (food-surplus gate)
  breedMinBread: 24,           // v2.10.0: food-depot bread surplus required to breed
  popCap: 24                   // v2.10.0: adult population ceiling for breeding support
};

// validation metadata used by /cv:config and the GUI
export const CONFIG_META = {
  enabled:               { type: "boolean", desc: "Master switch — pause/resume everything" },
  wallsOn:               { type: "boolean", desc: "Wall construction switch (/cv:walls on|off)" },
  roadsOn:               { type: "boolean", desc: "Road levelling engine (/cv:roads on|off)" },
  debugLevel:            { type: "int", min: 0, max: 2, desc: "0=off, 1=log, 2=log+action bar" },
  villagerFlags:         { type: "flags", desc: "Subset of 'chrwvtp' — see /cv:help" },
  workIntervalTicks:     { type: "int", min: 10, max: 400, desc: "Villager work cadence in ticks (20 = 1s)" },
  torchLightLevel:       { type: "int", min: 0, max: 14, desc: "Torches are placed where light level <= this" },
  torchBlock:            { type: "string", desc: "Block id villagers place as light source" },
  eatingHeals:           { type: "float", min: 0, max: 1, desc: "Chance (0..1) that grazing heals an animal" },
  cutFlowers:            { type: "boolean", desc: "Also cut single flowers when trimming grass" },
  leafDrops:             { type: "boolean", desc: "Trimmed leaves may drop saplings/apples" },
  mushroomDensity:       { type: "int", min: 0, max: 32, desc: "Max mushrooms per patch (skeleton farming)" },
  mushroomLightLevel:    { type: "int", min: 0, max: 15, desc: "Mushrooms planted only at light <= this" },
  wallControlBlock:      { type: "string", desc: "Block placed on/next to the bell to enable walls" },
  wallsAlwaysOn:         { type: "boolean", desc: "Build village walls without a control block" },
  wallRadius:            { type: "int", min: 11, max: 32, desc: "Bell-centred square ring radius (Java)" },
  wallHeight:            { type: "int", min: 1, max: 3, desc: "Wall height (Java = 1)" },
  wallTorchEvery:        { type: "int", min: 0, max: 16, desc: "0 = auto spacing, else every Nth column" },
  villageWallMargin:     { type: "int", min: 4, max: 24, desc: "Wall distance beyond outermost house" },
  wallGates:             { type: "boolean", desc: "Fence gates where roads cross the wall" },
  centerGates:           { type: "boolean", desc: "Gate at the middle of each wall side (Java)" },
  houseSeedRadius:       { type: "int", min: 24, max: 160, desc: "Seed frame radius around bell" },
  houseWaveRadius:       { type: "int", min: 20, max: 96, desc: "Directional wave scan radius" },
  logEnabled:            { type: "boolean", desc: "Ring-buffer log (/cv:log) + console" },
  houseClusterRadius:    { type: "int", min: 3, max: 12, desc: "Markers within this = one building" },
  houseGrowRadius:       { type: "int", min: 10, max: 48, desc: "Border-house re-scan radius" },
  houseWallPad:          { type: "int", min: 0, max: 6, desc: "Marker bbox to outer-wall allowance" },
  wallOffset:            { type: "int", min: 2, max: 30, desc: "Wall distance beyond outer house walls (bounds dist N)" },
  minVillageLight:       { type: "int", min: 0, max: 7, desc: "Night light floor vs mob spawning" },
  torchGrid:             { type: "int", min: 8, max: 32, desc: "Village lighting grid spacing" },
  earlyBoostMinutes:     { type: "int", min: 0, max: 240, desc: "Fast-build window after bell register" },
  workerRadius:          { type: "int", min: 16, max: 200, desc: "Crew recruitment radius around bell" },
  constructionChest:     { type: "boolean", desc: "Consume materials from the bell chest" },
  torchDrops:            { type: "boolean", desc: "Stomped torches drop as items" },
  farmRepair:            { type: "boolean", desc: "Farmers re-till trampled farmland" },
  mobsEnabled:           { type: "boolean", desc: "Animal/monster nature actions" },
  mobIntervalScale:      { type: "float", min: 0.1, max: 10, desc: "Scale all mob action intervals" },
  maxBlockChangesPerCycle:{ type: "int", min: 1, max: 512, desc: "Block edits per second (performance cap)" },
  onlyOverworld:         { type: "boolean", desc: "Only process the Overworld" },
  breedingOn:            { type: "boolean", desc: "v2.10.0 evening breeding support (needs food surplus + beds)" },
  breedMinBread:         { type: "int", min: 8, max: 256, desc: "Bread surplus in the food depot required before breeding" },
  popCap:                { type: "int", min: 4, max: 64, desc: "Adult population ceiling for breeding support" },
};

let cfg = { ...DEFAULTS };
let initialized = false;
let dirty = false;

export function loadConfig() {
  try {
    const raw = world.getDynamicProperty(CONFIG_KEY);
    if (typeof raw === "string") {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(DEFAULTS)) {
        if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k]) {
          cfg[k] = saved[k];
        }
      }
      if (typeof cfg.villagerFlags === "string") {
        cfg.villagerFlags = sanitizeFlags(cfg.villagerFlags);
        // v1.0.0 argument bug could persist a single-character flag string
        // (e.g. "c") into the world. Auto-heal it back to the defaults.
        if (cfg.villagerFlags.length === 1) {
          console.warn("[CV] corrupted villagerFlags detected ('" + cfg.villagerFlags + "') — resetting to defaults.");
          cfg.villagerFlags = DEFAULTS.villagerFlags;
          try {
            world.sendMessage("§e[CV]§7 v1.0.0 hatasından bozulan köylü bayrakları onarıldı → §f" + cfg.villagerFlags);
          } catch (e) { /* ignore */ }
        }
      }
    }
  } catch (e) {
    console.warn("[CV] config load failed: " + e);
  }
  initialized = true;
}

export function getConfig() {
  if (!initialized) loadConfig();
  return cfg;
}

export function saveConfig() {
  try {
    world.setDynamicProperty(CONFIG_KEY, JSON.stringify(cfg));
    dirty = false;
  } catch (e) {
    console.warn("[CV] config save failed: " + e);
  }
}

export function markDirty() { dirty = true; }
export function flushIfDirty() { if (dirty) saveConfig(); }

export function sanitizeFlags(s) {
  let out = "";
  for (const ch of String(s).toLowerCase()) {
    if ("chrwvtp".includes(ch) && !out.includes(ch)) out += ch;
  }
  return out;
}

// set a config value from a string (commands / GUI). Returns {ok, message}
export function setConfig(key, rawValue) {
  getConfig();
  const meta = CONFIG_META[key];
  if (!meta) return { ok: false, message: `Unknown config key: ${key}. Try /cv:config` };
  const def = DEFAULTS[key];
  let value;
  if (meta.type === "boolean") {
    const s = String(rawValue).toLowerCase();
    if (!["true", "false", "on", "off", "1", "0"].includes(s)) {
      return { ok: false, message: `${key} expects true/false` };
    }
    value = s === "true" || s === "on" || s === "1";
  } else if (meta.type === "int") {
    value = Math.round(Number(rawValue));
    if (!Number.isFinite(value)) return { ok: false, message: `${key} expects a number` };
    if (value < meta.min || value > meta.max) return { ok: false, message: `${key} must be ${meta.min}..${meta.max}` };
  } else if (meta.type === "float") {
    value = Number(rawValue);
    if (!Number.isFinite(value)) return { ok: false, message: `${key} expects a number` };
    if (value < meta.min || value > meta.max) return { ok: false, message: `${key} must be ${meta.min}..${meta.max}` };
  } else if (meta.type === "flags") {
    value = sanitizeFlags(rawValue);
  } else {
    value = String(rawValue).trim();
    if (!/^minecraft:[a-z0-9_.:/]+$/.test(value)) {
      return { ok: false, message: `${key} expects a block id like minecraft:torch` };
    }
  }
  cfg[key] = value;
  saveConfig();
  return { ok: true, message: `§a${key} = §f${value}` };
}

export function listConfigLines() {
  getConfig();
  const lines = [];
  for (const k of Object.keys(DEFAULTS)) {
    const meta = CONFIG_META[k];
    lines.push(`§e${k}§7=§f${cfg[k]}§8 — ${meta.desc}`);
  }
  return lines;
}

// ---------- bells ----------
export function loadBells() {
  try {
    const raw = world.getDynamicProperty(BELLS_KEY);
    if (typeof raw === "string") {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) { /* ignore */ }
  return [];
}
export function saveBells(bells) {
  try { world.setDynamicProperty(BELLS_KEY, JSON.stringify(bells)); } catch (e) { /* ignore */ }
}

// ---------- wall progress ----------
export function loadWallProg() {
  try {
    const raw = world.getDynamicProperty(WALLPROG_KEY);
    if (typeof raw === "string") return JSON.parse(raw) || {};
  } catch (e) { /* ignore */ }
  return {};
}
export function saveWallProg(prog) {
  try { world.setDynamicProperty(WALLPROG_KEY, JSON.stringify(prog)); } catch (e) { /* ignore */ }
}

// ---------- stats ----------
export const stats = {
  grassCut: 0,
  grassEaten: 0,
  plantsGrown: 0,
  torchesPlaced: 0,
  torchesStomped: 0,
  wallsBuilt: 0,
  wallsRepaired: 0,
  roadsRepaired: 0,
  snowCleared: 0,
  heals: 0,
  saplingsPlanted: 0,
  mushroomsGrown: 0,
  coralsGrown: 0,
  coralRevived: 0,
  leavesTrimmed: 0,
  fencesBuilt: 0,
  farmlandRepaired: 0,
  farmHarvested: 0,
  farmPlanted: 0,
  gathered: 0
};

export function loadStats() {
  try {
    const raw = world.getDynamicProperty(STATS_KEY);
    if (typeof raw === "string") {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(stats)) {
        if (typeof saved[k] === "number") stats[k] = saved[k];
      }
    }
  } catch (e) { /* ignore */ }
}
export function saveStats() {
  try { world.setDynamicProperty(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
}
export function statsLines() {
  return [
    `§aGrass cut:§f ${stats.grassCut}   §aGrass eaten:§f ${stats.grassEaten}   §aPlants grown:§f ${stats.plantsGrown}`,
    `§eTorches placed:§f ${stats.torchesPlaced}   §cTorches stomped (zombies!):§f ${stats.torchesStomped}`,
    `§7Walls built:§f ${stats.wallsBuilt}   §7Walls repaired:§f ${stats.wallsRepaired}   §7Fences:§f ${stats.fencesBuilt}`,
    `§bRoads repaired:§f ${stats.roadsRepaired}   §bSnow cleared:§f ${stats.snowCleared}   §bFarmland re-tilled:§f ${stats.farmlandRepaired}`,
    `§dHeals:§f ${stats.heals}   §2Saplings:§f ${stats.saplingsPlanted}   §cMushrooms:§f ${stats.mushroomsGrown}   §5Corals:§f ${stats.coralsGrown + stats.coralRevived}`,
    `§dLeaves trimmed:§f ${stats.leavesTrimmed}`
  ];
}
