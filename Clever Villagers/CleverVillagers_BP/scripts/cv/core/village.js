// ============================================================
// cv2/core/village.js — VillageCore registry (id == v1 bellKey)
// Sharded dynamic-property persistence, reload-safe.
// ============================================================
import { world } from "@minecraft/server";

const INDEX_KEY = "cv:villages";

const DEFAULT_FLAGS = {
  economyEnabled: true,
  warehouseEnabled: true,
  craftingEnabled: true,
  smeltingEnabled: true,
  miningEnabled: false,
  forestryEnabled: true,
  courierEnabled: true,
  constructionIntegration: true,
  verboseChat: false,
  verboseLog: true
};

let villages = null; // Map<id, VillageCore>

function load() {
  villages = new Map();
  let index = [];
  try {
    const raw = world.getDynamicProperty(INDEX_KEY);
    if (typeof raw === "string") index = JSON.parse(raw) || [];
  } catch (e) { index = []; }
  for (const entry of index) {
    const core = {
      id: entry.id,
      bell: entry.bell,
      dimension: entry.dimension || "minecraft:overworld",
      flags: { ...DEFAULT_FLAGS },
      depots: new Map(),     // type -> DepotData (depot.js fills from shard)
      ledger: [],
      doorIdx: 0
    };
    try {
      const craw = world.getDynamicProperty(`cv:v:${entry.id}:core`);
      if (typeof craw === "string") {
        const c = JSON.parse(craw);
        if (c.flags) core.flags = { ...DEFAULT_FLAGS, ...c.flags };
      }
    } catch (e) { /* defaults */ }
    villages.set(entry.id, core);
  }
  return villages;
}

export function all() {
  if (!villages) load();
  return [...villages.values()];
}
export function get(id) {
  if (!villages) load();
  return villages.get(id);
}
export function idOf(bell) { return `${bell.x},${bell.y},${bell.z}`; }

export function ensureVillage(bell, dimensionId) {
  if (!villages) load();
  const id = idOf(bell);
  if (villages.has(id)) return villages.get(id);
  const core = {
    id,
    bell: { x: bell.x, y: bell.y, z: bell.z },
    dimension: dimensionId || "minecraft:overworld",
    flags: { ...DEFAULT_FLAGS },
    depots: new Map(),
    ledger: [],
    doorIdx: 0
  };
  villages.set(id, core);
  saveIndex();
  saveCore(core);
  return core;
}

export function saveIndex() {
  try {
    world.setDynamicProperty(INDEX_KEY, JSON.stringify(all().map(v => ({ id: v.id, bell: v.bell, dimension: v.dimension }))));
  } catch (e) { /* ignore */ }
}
export function saveCore(v) {
  try {
    world.setDynamicProperty(`cv:v:${v.id}:core`, JSON.stringify({ bell: v.bell, flags: v.flags }));
  } catch (e) { /* ignore */ }
}
