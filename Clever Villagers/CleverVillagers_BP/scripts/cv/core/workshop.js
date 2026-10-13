// ============================================================
// cv/core/workshop.js — workshop registration & validation
// Hardcore rule: the system never PLACEs containers; the player
// places them and links them explicitly.
// ============================================================
import { world } from "@minecraft/server";
import * as V from "./village.js";
import * as LOG from "../../log.js";

// NOTE: lit_* variants MUST be listed — a burning furnace/smoker is a
// different block id and the workshop must stay valid while working (v2.4.1 fix)
export const JOB_BLOCKS = {
  toolsmith: ["minecraft:smithing_table", "minecraft:crafting_table"],
  weaponsmith: ["minecraft:grindstone", "minecraft:crafting_table"],
  armorer: ["minecraft:blast_furnace", "minecraft:lit_blast_furnace"],
  mason: ["minecraft:stonecutter", "minecraft:stonecutter_block"],
  smelter: ["minecraft:furnace", "minecraft:lit_furnace", "minecraft:blast_furnace", "minecraft:lit_blast_furnace"],
  cook: ["minecraft:smoker", "minecraft:lit_smoker", "minecraft:furnace", "minecraft:lit_furnace", "minecraft:campfire", "minecraft:soul_campfire"],
  butcher: ["minecraft:smoker", "minecraft:lit_smoker"],
  forester: ["minecraft:crafting_table"],
  farmer: ["minecraft:composter"]
};

function load(v) {
  if (v.workshops) return v.workshops;
  let obj = {};
  try {
    const raw = world.getDynamicProperty(`cv2w:${v.id}`) ?? world.getDynamicProperty(`cv:v:${v.id}:workshops`);
    if (typeof raw === "string") obj = JSON.parse(raw) || {};
  } catch (e) { obj = {}; }
  v.workshops = obj; // id -> WorkshopData
  return v.workshops;
}
function save(v) {
  try { world.setDynamicProperty(`cv:v:${v.id}:workshops`, JSON.stringify(v.workshops || {})); } catch (e) { /* ignore */ }
}

export function list(v) { load(v); return Object.values(v.workshops); }
export function get(v, wid) { load(v); return v.workshops[wid]; }
export function findByType(v, type) { load(v); return Object.values(v.workshops).find(w => w.type === type); }
// v2.5.3: first workshop of the type whose job block is actually present
export function findValid(dim, v, type) {
  load(v);
  for (const w of Object.values(v.workshops)) {
    if (w.type !== type) continue;
    if (isValid(dim, v, w)) return w;
  }
  return undefined;
}

export function register(v, type, block) {
  load(v);
  const allowed = JOB_BLOCKS[type];
  if (!allowed) return { ok: false, reason: "unknown_workshop_type" };
  const typeId = block && block.typeId;
  if (!typeId || !allowed.includes(typeId)) return { ok: false, reason: "wrong_job_block:" + typeId };
  const loc = block.location;
  // v2.5.3: same block + same type already registered? reuse it (no twins)
  for (const w of Object.values(v.workshops)) {
    if (w.type === type && w.jobBlock &&
        w.jobBlock.x === loc.x && w.jobBlock.y === loc.y && w.jobBlock.z === loc.z) {
      return { ok: true, id: w.id, existing: true };
    }
  }
  const id = `${type}_${Object.keys(v.workshops).length + 1}`;
  v.workshops[id] = {
    id, type,
    jobBlock: { x: loc.x, y: loc.y, z: loc.z },
    inputChest: null, outputChest: null, orderChest: null, fuelChest: null,
    state: "idle"
  };
  save(v);
  LOG.info(`[CV] atölye kaydedildi: ${id} @ ${loc.x},${loc.y},${loc.z}`);
  return { ok: true, id };
}

export function link(v, wid, slot, loc) {
  load(v);
  const w = v.workshops[wid];
  if (!w) return false;
  if (!["inputChest", "outputChest", "orderChest", "fuelChest"].includes(slot)) return false;
  w[slot] = { x: loc.x, y: loc.y, z: loc.z };
  save(v);
  LOG.info(`[CV] ${wid}.${slot} -> ${loc.x},${loc.y},${loc.z}`);
  return true;
}

export function removeWorkshop(v, wid) {
  load(v);
  if (!v.workshops[wid]) return false;
  delete v.workshops[wid];
  save(v);
  return true;
}

// job block still there?
export function isValid(dim, v, w) {
  try {
    const b = dim.getBlock(w.jobBlock);
    const allowed = JOB_BLOCKS[w.type] || [];
    return !!b && allowed.includes(b.typeId);
  } catch (e) { return false; }
}
