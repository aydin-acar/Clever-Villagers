// ============================================================
// cv/core/anchor.js — v2.11.0 "KAMPYOLU" (user: "köylüye vanilla'da
// olduğu gibi bir hedef vermek ve köylünün doğal yoldan o göreve
// ilerlemesi. bunu yapamıyor musun?" — evet, tam olarak bunu yapıyoruz.)
//
// Bedrock script API CANNOT inject a movement goal into a villager, and
// any second walker fights vanilla AI (the v2.10.0 stutter bug). But
// vanilla HAS its own goal system — the POI + schedule machine:
//
//   * An UNEMPLOYED villager that spots an unclaimed job-site block
//     (composter, stonecutter, blast furnace…) CLAIMS it — the claim
//     itself is pathfinding-validated by the game — and immediately
//     starts following the employed schedule.
//   * Every WORK SLOT (Bedrock schedule: tod 0–2000 = 06:00–08:00 and
//     10000–11000 = 16:00–17:00) the villager walks to its claimed
//     site with REAL vanilla pathfinding and stands next to it.
//   * Noon (8000–10000) it walks to the bell, evening (11000→14000)
//     home to its bed. Doors are opened by the villager itself.
//
// So the addon's only job is to PUT THE GOAL BLOCK WHERE THE WORK IS:
//   * forest zone  -> a composter CAMP at the densest cluster of logs;
//   * quarry zone  -> a stonecutter CAMP at the densest cluster of stone;
//   * workshops whose station is not a POI (furnace, crafting table,
//     campfire) -> a side ANCHOR block (blast furnace / smoker / …) that
//     a villager can actually claim and commute to.
// The camp MOVES (break + re-place, addon-owned block, never the
// player's) when the work around it runs dry — the claimer loses the
// site, re-claims the new one during its wander hours and walks over.
// Nobody is ever teleported; the script never writes a villager's
// position (the only exception remains path.js unstuckBuried).
//
// Presence binding: during a work slot, whoever STANDS at an anchor is
// its claimer — that is how the dispatcher knows "the camp has a
// worker" without any claim API.
// ============================================================
import { world } from "@minecraft/server";
import * as U from "../../util.js";
import * as LOG from "../../log.js";
import { nodeOk } from "./path.js";

export const stats = { placed: 0, replaced: 0, moves: 0, refused: 0, claims: 0, lost: 0 };
export const CLAIM_R = 10;   // presence-binding radius around an anchor
export const WORK_R = 12;    // work radius: jobs this far from the camp are "at the camp"
export const MOVE_CD = 12000; // a camp moves at most once per 10 min

const CAMP_BLOCK = { forest: "minecraft:composter", quarry: "minecraft:stonecutter" };

// Real vanilla job sites (POI blocks a villager can claim)
const JOB_SITE_IDS = new Set([
  "minecraft:composter", "minecraft:barrel",
  "minecraft:blast_furnace", "minecraft:lit_blast_furnace",
  "minecraft:smoker", "minecraft:lit_smoker",
  "minecraft:grindstone", "minecraft:smithing_table",
  "minecraft:stonecutter", "minecraft:stonecutter_block",
  "minecraft:loom", "minecraft:lectern", "minecraft:brewing_stand",
  "minecraft:fletching_table", "minecraft:cartography_table", "minecraft:cauldron"
]);
// side anchor for workshops whose own station is NOT claimable
const WORKSHOP_ANCHOR = {
  smelter: "minecraft:blast_furnace",    // furnace is not a POI
  cook: "minecraft:smoker",              // campfire/furnace are not POIs
  forester: "minecraft:composter",       // crafting table is not a POI
  toolsmith: "minecraft:smithing_table", // crafting-table variant
  weaponsmith: "minecraft:grindstone"
};
export function isJobSiteId(id) { return JOB_SITE_IDS.has(id); }
export function anchorBlockFor(type, stationId) {
  if (stationId && JOB_SITE_IDS.has(stationId)) return null; // station itself is claimable
  return WORKSHOP_ANCHOR[type] || null;
}

// Bedrock work slots (minecraft.wiki Villager §Schedules, Bedrock table)
export function isWorkSlot(tod) { return tod <= 2200 || (tod >= 9800 && tod <= 11200); }
// wander window — claims/re-claims happen while villagers wander
export function isWanderSlot(tod) { return tod > 2200 && tod < 9800; }

// ---------- persistence (same pattern as workshop.js) ----------
function load(v) {
  if (v.anchors) return v.anchors;
  let obj = {};
  try {
    const raw = world.getDynamicProperty(`cv:v:${v.id}:anchors`);
    if (typeof raw === "string") obj = JSON.parse(raw) || {};
  } catch (e) { obj = {}; }
  v.anchors = obj;
  if (!v.anchors.camps) v.anchors.camps = {};
  if (!v.anchors.workshops) v.anchors.workshops = {};
  return v.anchors;
}
function save(v) {
  try { world.setDynamicProperty(`cv:v:${v.id}:anchors`, JSON.stringify(v.anchors || {})); } catch (e) { /* ignore */ }
}

// in-memory presence: key -> { workerId, seenTick }
const presence = new Map();
function pKey(v, slot, id) { return `${v.id}|${slot}|${id}`; }
// v2.11.0: a refused placement (no standable spot) retries at most once
// per 2 min — no per-pass findSpot burns, no stat spam
const refuseCd = new Map();
function refuseOk(key, tick) {
  const last = refuseCd.get(key) || 0;
  if (tick - last < 2400) return false;
  refuseCd.set(key, tick);
  return true;
}

// ---------- spot finding ----------
// a place where an anchor block can stand AND a villager can stand beside it
function findSpot(dim, x0, y0, z0) {
  for (let r = 0; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const dy of [0, -1, 1, -2, 2]) {
          const x = x0 + dx, y = y0 + dy, z = z0 + dz;
          if (!nodeOk(dim, x, y, z)) continue;       // feet+head free, solid floor
          // at least one neighbour the claimer can stand on ("reach" rule:
          // a villager works from any of the 8 columns around the site)
          let side = false;
          for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            if (nodeOk(dim, x + nx, y, z + nz)) { side = true; break; }
          }
          if (side) return { x, y, z };
        }
      }
    }
  }
  return undefined;
}
function placeVerified(dim, spot, blockId) {
  if (!U.setBlock(dim, U.vec(spot.x, spot.y, spot.z), blockId)) return false;
  // read-back verify (doctrine: a silent write is a lie)
  const back = U.typeId(U.getBlock(dim, U.vec(spot.x, spot.y, spot.z)));
  const ok = back === blockId || (blockId === "minecraft:blast_furnace" && back === "minecraft:lit_blast_furnace") ||
             (blockId === "minecraft:smoker" && back === "minecraft:lit_smoker");
  if (!ok) { try { U.clearBlock(dim, U.vec(spot.x, spot.y, spot.z)); } catch (e) { /* ignore */ } }
  return ok;
}

// ---------- camps (forest / quarry) ----------
export function campOf(v, kind) {
  const c = load(v).camps[kind];
  return (c && c.x !== undefined) ? c : null;
}
// place (or re-place) the camp anchor near `nearLoc`; returns the record
export function ensureCamp(dim, v, kind, nearLoc, tick, silent) {
  const a = load(v);
  const want = CAMP_BLOCK[kind];
  const c = a.camps[kind];
  if (c && c.x !== undefined) {
    // unloaded chunk => we cannot KNOW the camp is gone: never relocate on
    // a lie (a duplicate camp would split the claimers)
    try { if (!dim.isChunkLoaded({ x: c.x, y: c.y, z: c.z })) return c; } catch (e) { return c; }
    const t = U.typeId(U.getBlock(dim, U.vec(c.x, c.y, c.z)));
    if (t === want) return c; // camp intact
    if (tick - (c.placedAt || 0) < MOVE_CD) return c; // broken by player: don't churn, cooldown first
  }
  if (!nearLoc) return c || null;
  if (!refuseOk(pKey(v, "camp", kind), tick)) return c || null;
  const spot = findSpot(dim, Math.floor(nearLoc.x), Math.floor(nearLoc.y), Math.floor(nearLoc.z));
  if (!spot) { stats.refused++; return c || null; }
  if (!placeVerified(dim, spot, want)) { stats.refused++; return c || null; }
  const replacing = !!(c && c.x !== undefined);
  a.camps[kind] = { x: spot.x, y: spot.y, z: spot.z, block: want, placedAt: tick, movedAt: c ? (c.movedAt || 0) : 0 };
  presence.delete(pKey(v, "camp", kind));
  save(v);
  if (replacing) stats.replaced++; else stats.placed++;
  LOG.info(`[CV] ${kind} kampı ${replacing ? "YENİDEN " : ""}kuruldu: ${want} @ ${spot.x},${spot.y},${spot.z} — işsiz bir köylü sahiplenip iş saatlerinde YÜRÜYEREK gelecek (vanilla)`);
  if (!silent) {
    try {
      world.sendMessage(`§a[CV]§7 ${kind === "forest" ? "Orman" : "Taş ocağı"} kampı kuruldu (§f${want.replace("minecraft:", "")}§7 @ ${spot.x},${spot.y},${spot.z}). Köyde §fişsiz§7 bir köylü varsa istasyonu sahiplenir ve iş saatlerinde (06–08 / 16–17) kendi yürüyerek gider.`);
    } catch (e) { /* ignore */ }
  }
  return a.camps[kind];
}
// move the camp to fresh work (break + place, both addon-owned)
export function moveCamp(dim, v, kind, nearLoc, tick) {
  const c = campOf(v, kind);
  if (!c) return ensureCamp(dim, v, kind, nearLoc, tick, true);
  if (tick - Math.max(c.placedAt || 0, c.movedAt || 0) < MOVE_CD) return c;
  try { if (!dim.isChunkLoaded({ x: c.x, y: c.y, z: c.z })) return c; } catch (e) { return c; } // never act on unloaded ground
  const want = CAMP_BLOCK[kind];
  const t = U.typeId(U.getBlock(dim, U.vec(c.x, c.y, c.z)));
  if (t === want) { try { U.clearBlock(dim, U.vec(c.x, c.y, c.z)); } catch (e) { /* ignore */ } } // ours: no drops
  const rec = ensureCamp(dim, v, kind, nearLoc, tick, true);
  if (rec) { rec.movedAt = tick; save(v); stats.moves++; LOG.info(`[CV] ${kind} kampı yeni iş kümesine taşındı → ${rec.x},${rec.y},${rec.z}`); }
  return rec;
}
export function removeCamp(dim, v, kind) {
  const a = load(v);
  const c = a.camps[kind];
  if (c && c.x !== undefined) {
    const want = CAMP_BLOCK[kind];
    const t = U.typeId(U.getBlock(dim, U.vec(c.x, c.y, c.z)));
    if (t === want) { try { U.clearBlock(dim, U.vec(c.x, c.y, c.z)); } catch (e) { /* ignore */ } }
  }
  delete a.camps[kind];
  presence.delete(pKey(v, "camp", kind));
  save(v);
}

// ---------- workshop anchors (station itself is not a POI) ----------
export function workshopAnchor(v, wid) {
  const r = load(v).workshops[wid];
  return (r && r.x !== undefined) ? r : null;
}
export function ensureWorkshopAnchor(dim, v, w, tick) {
  const stationId = U.typeId(U.getBlock(dim, U.vec(w.jobBlock.x, w.jobBlock.y, w.jobBlock.z)));
  const want = anchorBlockFor(w.type, stationId);
  if (!want) return null; // station is claimable by itself (composter, grindstone…)
  const a = load(v);
  const r = a.workshops[w.id];
  if (r && r.x !== undefined) {
    try { if (!dim.isChunkLoaded({ x: r.x, y: r.y, z: r.z })) return r; } catch (e) { return r; }
    const t = U.typeId(U.getBlock(dim, U.vec(r.x, r.y, r.z)));
    if (t === want || (want === "minecraft:blast_furnace" && t === "minecraft:lit_blast_furnace") ||
        (want === "minecraft:smoker" && t === "minecraft:lit_smoker")) return r; // intact
    if (tick - (r.placedAt || 0) < MOVE_CD) return r; // broken: cooldown before re-place
  }
  if (!refuseOk(pKey(v, "ws", w.id), tick)) return r || null;
  const spot = findSpot(dim, w.jobBlock.x, w.jobBlock.y, w.jobBlock.z);
  if (!spot) { stats.refused++; return r || null; }
  if (!placeVerified(dim, spot, want)) { stats.refused++; return r || null; }
  const replacing = !!(r && r.x !== undefined);
  a.workshops[w.id] = { x: spot.x, y: spot.y, z: spot.z, block: want, placedAt: tick };
  presence.delete(pKey(v, "ws", w.id));
  save(v);
  if (replacing) stats.replaced++; else stats.placed++;
  LOG.info(`[CV] ${w.id} için sahiplenilebilir çapa kondu: ${want} @ ${spot.x},${spot.y},${spot.z} (istasyonun kendisi POI değil)`);
  return a.workshops[w.id];
}

// ---------- presence binding (the "claim detector") ----------
// Called from the dispatcher each pass. During a WORK SLOT the villager
// standing at an anchor IS its claimer — bind it; lose the binding when
// nobody shows up for two work slots.
export function notePresence(dim, v, tick, tod) {
  const a = load(v);
  const recs = [];
  for (const kind of ["forest", "quarry"]) if (a.camps[kind] && a.camps[kind].x !== undefined) recs.push(["camp", kind, a.camps[kind]]);
  for (const wid of Object.keys(a.workshops)) if (a.workshops[wid] && a.workshops[wid].x !== undefined) recs.push(["ws", wid, a.workshops[wid]]);
  if (!recs.length) return;
  const working = isWorkSlot(tod);
  for (const [slot, id, rec] of recs) {
    const key = pKey(v, slot, id);
    let pres = presence.get(key);
    let found = null;
    if (working) {
      let ents = [];
      try {
        for (const t of ["minecraft:villager_v2", "minecraft:villager"]) {
          ents = ents.concat(dim.getEntities({ type: t, location: U.vec(rec.x, rec.y, rec.z), maxDistance: CLAIM_R }));
        }
      } catch (e) { ents = []; }
      let bd = 999;
      for (const e of ents) {
        if (!U.isValidEntity(e) || U.isBaby(e)) continue;
        let el; try { el = e.location; } catch (err) { continue; }
        const d = Math.max(Math.abs(el.x - rec.x), Math.abs(el.z - rec.z));
        if (d < bd) { bd = d; found = e; }
      }
    }
    if (found) {
      if (!pres || pres.workerId !== found.id) {
        presence.set(key, { workerId: found.id, seenTick: tick });
        stats.claims++;
        LOG.info(`[CV] çapa sahibi işbaşında: ${slot}/${id} ← …${String(found.id).slice(-6)} (vanilla yürüyüşü ✓)`);
      } else pres.seenTick = tick;
    } else if (pres && tick - (pres.seenTick || 0) > 4800) {
      presence.delete(key); // two work slots with nobody at the post
      stats.lost++;
    }
  }
}
export function campWorker(v, kind) { const p = presence.get(pKey(v, "camp", kind)); return p ? p.workerId : null; }
export function workshopWorker(v, wid) { const p = presence.get(pKey(v, "ws", wid)); return p ? p.workerId : null; }
export function presenceInfo(v) {
  const a = load(v);
  const out = {};
  for (const kind of ["forest", "quarry"]) {
    const c = a.camps[kind];
    out[kind] = c && c.x !== undefined ? { at: `${c.x},${c.z}`, worker: campWorker(v, kind) } : null;
  }
  const ws = {};
  for (const wid of Object.keys(a.workshops)) {
    const r = a.workshops[wid];
    if (r && r.x !== undefined) ws[wid] = { at: `${r.x},${r.z}`, worker: workshopWorker(v, wid) };
  }
  out.workshops = ws;
  return out;
}
