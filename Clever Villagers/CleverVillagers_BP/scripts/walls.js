// ============================================================
// Clever Villagers (Regrowth for Bedrock) — walls.js (v1.3.6)
//
// MAPPING (directional waves, chunk-load aware):
//  * seed frame bell ± houseSeedRadius; houses = door>bed>glass
//    marker clusters (12 block chain)
//  * waves N/E/S/W: full-width strips houseWaveRadius beyond the
//    current core border; new houses grow the border; a wave that
//    saw UNLOADED chunks does NOT close its direction — it retries
//    later, so the map completes as the player explores
//  * /cv:rescan restarts mapping anytime (village growth)
//
// BORDER SHAPE (user drawing #5): NOT one big rectangle.
//  * each house box + wallOffset forms a padded rectangle
//  * the wall line = outer outline of the UNION of those rects
//    (stepped, natural looking, follows the village layout)
//  * corners of the outline get +1 post & lantern
//  * gates where roads cross the line
//
// BELLS: never deleted while their chunk is unloaded (v1.3.5 bug
//  that emptied the registry and stopped everything).
//
// BOUNDS: /cv:bounds on|off — persistent yellow wool outline
//  (placed incrementally as chunks load) until turned off.
// ============================================================
import { world, system, BlockVolume } from "@minecraft/server";
import { getConfig, loadBells, saveBells, stats } from "./config.js";
import * as U from "./util.js";
import * as B from "./cv/integration_construction_bridge.js";
import * as V from "./cv/core/village.js";
import * as WS from "./cv/core/workshop.js";
import * as LOG from "./log.js";

let bells = null;
let vstate = null;
let patrolIdx = 0;
let boundsOn = false;
let boundsWool = [];   // placed wool positions (for off)
let boundsPending = []; // waiting for chunks

const VSTATE_KEY = "cv:vstate5";
const SCAN_SLICE = 6000;
const WALLISH = /(wall|fence|gate)/;
const DIRS = ["N", "E", "S", "W"];

function bellKey(b) { return `${b.x},${b.y},${b.z}`; }

export function getBells() { if (bells === null) bells = loadBells(); return bells; }
export function addBell(x, y, z) {
  const list = getBells();
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  for (const b of list) if (Math.abs(b.x - x) <= 4 && Math.abs(b.y - y) <= 4 && Math.abs(b.z - z) <= 4) return false;
  list.push({ x, y, z, tick: Date.now() });
  if (list.length > 64) list.shift();
  saveBells(list);
  return true;
}
export function clearBells() { bells = []; saveBells(bells); vstate = {}; saveVState(); }
export function nearestBell(dim, loc, maxR = 128) {
  if (dim.id !== "minecraft:overworld") return undefined;
  let best, bestD = maxR;
  for (const b of getBells()) {
    if (Math.abs(b.y - loc.y) > 32) continue;
    const d = U.dist2d(b, loc);
    if (d <= bestD) { bestD = d; best = b; }
  }
  return best;
}
export function wallEnabledAt(dim, bell) {
  const cfg = getConfig();
  // v1.3.9: construction starts/stops via /cv:walls on|off
  return !!cfg.enabled && !!cfg.wallsOn;
}

export function findBellNearby(dim, loc, radius = 16) {
  const cx = Math.floor(loc.x), cy = Math.floor(loc.y), cz = Math.floor(loc.z);
  try {
    const vol = new BlockVolume(U.vec(cx - radius, cy - 4, cz - radius), U.vec(cx + radius, cy + 10, cz + radius));
    if (!dim.containsBlock(vol, { includeTypes: ["minecraft:bell"] }, true)) return undefined;
  } catch (e) { return undefined; }
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dy = -3; dy <= 8; dy++) {
        const b = U.getBlock(dim, U.vec(cx + dx, cy + dy, cz + dz));
        if (U.typeId(b) === "minecraft:bell") return { x: b.x, y: b.y, z: b.z };
      }
  return undefined;
}

// ---------------- state ----------------
function getVState() {
  if (vstate === null) {
    try {
      const raw = world.getDynamicProperty(VSTATE_KEY);
      vstate = (typeof raw === "string" && JSON.parse(raw)) || {};
    } catch (e) { vstate = {}; }
    for (const k of Object.keys(vstate)) {
      const s = vstate[k];
      if (s && s.done && !s.phase) s.phase = "done";
    }
  }
  return vstate;
}
function saveVState() {
  try {
    const slim = {};
    for (const k of Object.keys(getVState())) {
      const s = getVState()[k];
      slim[k] = {
        done: s.phase === "done", phase: s.phase, houses: s.houses || [], houseCount: (s.houses || []).length,
        doors: s.doors || [], jobsites: s.jobsites || []
      };
    }
    world.setDynamicProperty(VSTATE_KEY, JSON.stringify(slim));
  } catch (e) { /* ignore */ }
}
export function rescan(bell) {
  const st = getVState()[bellKey(bell)];
  if (!st) return false;
  st.phase = "scan1";
  st.scan = { cx: bell.x - getConfig().houseSeedRadius, cz: bell.z - getConfig().houseSeedRadius };
  st.markers = []; st.houses = []; st.rect = undefined;
  st.dirs = { N: false, E: false, S: false, W: false };
  st.wave = null; st.waves = 0; st.cache = null;
  saveVState();
  LOG.info("rescan başlatıldı");
  return true;
}

const JOB_SITES = {
  "minecraft:composter": "farmer", "minecraft:smithing_table": "toolsmith",
  "minecraft:grindstone": "weaponsmith", "minecraft:blast_furnace": "armorer/smelter",
  "minecraft:furnace": "smelter/cook", "minecraft:smoker": "butcher/cook",
  "minecraft:stonecutter": "mason", "minecraft:stonecutter_block": "mason",
  "minecraft:crafting_table": "forester/cook", "minecraft:lectern": "librarian",
  "minecraft:loom": "shepherd", "minecraft:cauldron": "leatherworker",
  "minecraft:fletching_table": "fletcher", "minecraft:cartography_table": "cartographer",
  "minecraft:barrel": "fisherman"
};
export function jobSiteHint(id) { return JOB_SITES[id]; }

function markerKind(id) {
  if (!id) return 0;
  if (id.endsWith("_door") || id === "minecraft:wooden_door" || id === "minecraft:iron_door" || id === "minecraft:copper_door") return 1;
  if (id === "minecraft:bed" || id.endsWith("_bed")) return 2;
  if (id.includes("glass") || id.includes("pane")) return 3; // cam BLOK + cam LEVHA (v2.1.2)
  return 0;
}

// lighting pole: stripped oak log with >=3 torches around = settlement marker
function isLampPost(dim, x, y, z) {
  let t = 0;
  for (let dx = -2; dx <= 2 && t < 3; dx++)
    for (let dz = -2; dz <= 2 && t < 3; dz++)
      for (let dy = -1; dy <= 2; dy++) {
        const id = U.typeId(U.getBlock(dim, U.vec(x + dx, y + dy, z + dz)));
        if (id && id.includes("torch")) { t++; break; }
      }
  return t >= 3;
}

function newState(bell) {
  const cfg = getConfig();
  return {
    bell: { x: bell.x, z: bell.z },
    phase: "scan1",
    scan: { cx: bell.x - cfg.houseSeedRadius, cz: bell.z - cfg.houseSeedRadius },
    markers: [], houses: [], rect: undefined,
    dirs: { N: false, E: false, S: false, W: false },
    wave: null, waves: 0, unloadedSeen: 0,
    cache: null, outlineCache: null
  };
}

function clusterHouses(markers, chainR) {
  const used = new Array(markers.length).fill(false);
  const out = [];
  for (let i = 0; i < markers.length; i++) {
    if (used[i]) continue;
    const stack = [i]; used[i] = true;
    const group = [markers[i]];
    while (stack.length) {
      const m = markers[stack.pop()];
      for (let j = 0; j < markers.length; j++) {
        if (used[j]) continue;
        const q = markers[j];
        if (Math.max(Math.abs(m[0] - q[0]), Math.abs(m[1] - q[1])) <= chainR) { used[j] = true; stack.push(j); group.push(q); }
      }
    }
    const b = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, door: false, bed: false, glass: false };
    for (const g of group) {
      b.minX = Math.min(b.minX, g[0]); b.maxX = Math.max(b.maxX, g[0]);
      b.minZ = Math.min(b.minZ, g[1]); b.maxZ = Math.max(b.maxZ, g[1]);
      if (g[3] === 1) b.door = true; else if (g[3] === 2) b.bed = true; else if (g[3] === 3) b.glass = true; else if (g[3] === 4) b.lamp = true;
    }
    if (b.door || b.bed || b.glass || b.lamp) out.push(b);
  }
  return out;
}

function mergeTouching(houses, gap) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < houses.length && !changed; i++) {
      for (let j = i + 1; j < houses.length && !changed; j++) {
        const a = houses[i], b = houses[j];
        if (a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minZ - gap <= b.maxZ && b.minZ - gap <= a.maxZ) {
          a.minX = Math.min(a.minX, b.minX); a.maxX = Math.max(a.maxX, b.maxX);
          a.minZ = Math.min(a.minZ, b.minZ); a.maxZ = Math.max(a.maxZ, b.maxZ);
          a.door = a.door || b.door; a.bed = a.bed || b.bed; a.glass = a.glass || b.glass; a.lamp = a.lamp || b.lamp;
          houses.splice(j, 1);
          changed = true;
        }
      }
    }
  }
  return houses;
}

function mergeHouses(st, found, chainR) {
  const leftover = [];
  for (const m of found) {
    let merged = false;
    for (const b of st.houses) {
      if (m[0] >= b.minX - chainR && m[0] <= b.maxX + chainR && m[1] >= b.minZ - chainR && m[1] <= b.maxZ + chainR) {
        b.minX = Math.min(b.minX, m[0]); b.maxX = Math.max(b.maxX, m[0]);
        b.minZ = Math.min(b.minZ, m[1]); b.maxZ = Math.max(b.maxZ, m[1]);
        if (m[3] === 1) b.door = true; else if (m[3] === 2) b.bed = true; else if (m[3] === 3) b.glass = true; else if (m[3] === 4) b.lamp = true;
        merged = true; break;
      }
    }
    if (!merged) leftover.push(m);
  }
  if (leftover.length) for (const b of clusterHouses(leftover, chainR)) st.houses.push(b);
  mergeTouching(st.houses, 2);
}

function extendRect(st, pad, bell) {
  if (!st.rect) st.rect = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
  if (bell) { // the bell is ALWAYS inside the village bounds (v2.1.2)
    st.rect.minX = Math.min(st.rect.minX, bell.x - 2); st.rect.maxX = Math.max(st.rect.maxX, bell.x + 2);
    st.rect.minZ = Math.min(st.rect.minZ, bell.z - 2); st.rect.maxZ = Math.max(st.rect.maxZ, bell.z + 2);
  }
  if (!st.houses.length) return;
  for (const b of st.houses) {
    st.rect.minX = Math.min(st.rect.minX, b.minX - pad); st.rect.maxX = Math.max(st.rect.maxX, b.maxX + pad);
    st.rect.minZ = Math.min(st.rect.minZ, b.minZ - pad); st.rect.maxZ = Math.max(st.rect.maxZ, b.maxZ + pad);
  }
}

function frontierHouse(st, dir) {
  let best = null, bv = -1e9;
  for (const b of st.houses) {
    const v = dir === "N" ? -b.minZ : dir === "S" ? b.maxZ : dir === "W" ? -b.minX : b.maxX;
    if (v > bv) { bv = v; best = b; }
  }
  return best;
}
function waveStrip(st, dir, R) {
  const r = st.rect;
  if (dir === "N") return { x0: r.minX - R, x1: r.maxX + R, z0: r.minZ - R, z1: r.minZ - 1 };
  if (dir === "S") return { x0: r.minX - R, x1: r.maxX + R, z0: r.maxZ + 1, z1: r.maxZ + R };
  if (dir === "W") return { x0: r.minX - R, x1: r.minX - 1, z0: r.minZ - R, z1: r.maxZ + R };
  return { x0: r.maxX + 1, x1: r.maxX + R, z0: r.minZ - R, z1: r.maxZ + R };
}

function chunkLoaded(dim, x, z) {
  try { return dim.isChunkLoaded(U.vec(x, 64, z)); } catch (e) { return true; }
}

// ---------------- chunked mapping ----------------
export function scanSlice(dim) {
  const cfg = getConfig();
  for (const bell of getBells()) {
    const k = bellKey(bell);
    let st = getVState()[k];
    if (!st) { st = newState(bell); getVState()[k] = st; }
    if (st.phase === "done") continue;

    if (st.phase === "scan1") {
      let budget = SCAN_SLICE;
      const R = cfg.houseSeedRadius;
      for (let x = st.scan.cx; x <= bell.x + R; x++) {
        const z0 = (x === st.scan.cx) ? st.scan.cz : bell.z - R;
        for (let z = z0; z <= bell.z + R; z++) {
          if (budget-- <= 0) { st.scan.cx = x; st.scan.cz = z; return; }
          if (!chunkLoaded(dim, x, z)) { st.unloadedSeen++; continue; } // say empty; rescan later manually
          for (let y = bell.y - 20; y <= bell.y + 20; y++) {
            const id = U.typeId(U.getBlock(dim, U.vec(x, y, z)));
            let kind = markerKind(id);
            if (!kind && (id === "minecraft:stripped_oak_wood" || id === "minecraft:stripped_oak_log") && isLampPost(dim, x, y, z)) kind = 4;
            if (kind) { if (st.markers.length < 8000) st.markers.push([x, z, y, kind]); }
            if (id && JOB_SITES[id] && (st.jobsites || []).length < 200) {
              st.jobsites = st.jobsites || [];
              if (!st.jobsites.some(j => j.x === x && j.z === z && j.id === id)) st.jobsites.push({ x, y, z, id });
            }
            if (kind) break;
          }
        }
      }
      if (st.unloadedSeen > 0 && !st.hinted) {
        st.hinted = true;
        LOG.info(`scan1: ${st.unloadedSeen} kolon yüksüzdü (boş sayıldı)`);
        try { world.sendMessage(`§e[CV]§7 Taramanın bir kısmı yüklü değildi (§f${st.unloadedSeen}§7 kolon). Çevreyi gezip §e/cv:rescan§7 çağırırsan harita genişler.`); } catch (e) { /* ignore */ }
      }
      st.houses = mergeTouching(clusterHouses(st.markers, cfg.houseClusterRadius), 2);
      st.doors = st.markers.filter(m => m[3] === 1).map(m => ({ x: m[0], y: m[2], z: m[1] }));
      st.rect = undefined;
      extendRect(st, cfg.houseWallPad, bell);
      if (!st.rect) st.rect = { minX: bell.x - cfg.wallRadius, maxX: bell.x + cfg.wallRadius, minZ: bell.z - cfg.wallRadius, maxZ: bell.z + cfg.wallRadius };
      st.phase = "waves";
      LOG.info(`scan1 bitti: ${st.houses.length} ev, çekirdek ${st.rect.minX}..${st.rect.maxX} / ${st.rect.minZ}..${st.rect.maxZ}`);
      return;
    }

    if (st.phase === "refine") {
      // dilate each house bbox once towards real structure blocks so the
      // wall offset is symmetric around the BUILDING, not the markers
      const STRUCT = /(planks|_log$|_wood$|stairs|_slab|_door$|glass|pane|_wool$|terracotta|bricks$|_wall$|fence|cobblestone|deepslate|blackstone|basalt|quartz|copper|_ore$|iron_block|gold_block|mud_bricks|prismarine)/;
      if (!st.refine) st.refine = { hi: 0, cx: 0, cz: 0, started: false };
      const rf = st.refine;
      while (rf.hi < st.houses.length) {
        const h = st.houses[rf.hi];
        if (!rf.started) { rf.started = true; rf.cx = h.minX - 4; rf.cz = h.minZ - 4; rf.x1 = h.maxX + 4; rf.z1 = h.maxZ + 4; rf.y0 = bell.y - 12; rf.y1 = bell.y + 15; }
        let budget = 4000;
        for (let x = rf.cx; x <= rf.x1; x++) {
          const z0 = (x === rf.cx) ? rf.cz : h.minZ - 4;
          for (let z = z0; z <= rf.z1; z++) {
            if (budget-- <= 0) { rf.cx = x; rf.cz = z; return; }
            if (x >= h.minX && x <= h.maxX && z >= h.minZ && z <= h.maxZ) continue;
            for (let y = rf.y0; y <= rf.y1; y++) {
              const id = U.typeId(U.getBlock(dim, U.vec(x, y, z)));
              if (id && STRUCT.test(id)) {
                h.minX = Math.min(h.minX, x); h.maxX = Math.max(h.maxX, x);
                h.minZ = Math.min(h.minZ, z); h.maxZ = Math.max(h.maxZ, z);
                break;
              }
            }
          }
        }
        rf.hi++; rf.started = false;
      }
      st.rect = undefined;
      extendRect(st, cfg.houseWallPad, bell);
      st.phase = "waves";
      LOG.info(`refine bitti: ${st.houses.length} ev gerçek ayak izine genişletildi`);
      return;
    }

    if (st.phase === "waves") {
      let dir = null;
      for (const d of DIRS) if (!st.dirs[d]) { dir = d; break; }
      if (!dir) { finishMap(dim, bell, st); return; }
      const frontier = frontierHouse(st, dir);
      if (!frontier) { st.dirs[dir] = true; LOG.info(`dalga ${dir}: ev yok, yön kapatıldı`); return; }
      if (!st.wave || st.wave.dir !== dir) {
        const strip = waveStrip(st, dir, cfg.houseWaveRadius);
        st.wave = { dir, strip, cx: strip.x0, cz: strip.z0, found: [], unloaded: 0 };
      }
      const w = st.wave, sp = w.strip;
      if (sp.z1 < sp.z0 || sp.x1 < sp.x0) { st.dirs[dir] = true; st.wave = null; return; }
      let budget = SCAN_SLICE;
      for (let x = w.cx; x <= sp.x1; x++) {
        const z0 = (x === w.cx) ? w.cz : sp.z0;
        for (let z = z0; z <= sp.z1; z++) {
          if (budget-- <= 0) { w.cx = x; w.cz = z; return; }
          if (!chunkLoaded(dim, x, z)) { w.unloaded++; continue; }
          for (let y = bell.y - 24; y <= bell.y + 24; y++) {
            const id = U.typeId(U.getBlock(dim, U.vec(x, y, z)));
            let kind = markerKind(id);
            if (!kind && (id === "minecraft:stripped_oak_wood" || id === "minecraft:stripped_oak_log") && isLampPost(dim, x, y, z)) kind = 4;
            if (kind) { if (st.markers.length < 12000) st.markers.push([x, z, y, kind]); w.found.push([x, z, y, kind]); }
            if (id && JOB_SITES[id] && (st.jobsites || []).length < 200) {
              st.jobsites = st.jobsites || [];
              if (!st.jobsites.some(j => j.x === x && j.z === z && j.id === id)) st.jobsites.push({ x, y, z, id });
            }
            if (kind) break;
          }
        }
      }
      const before = st.houses.length;
      if (w.found.length) mergeHouses(st, w.found, cfg.houseClusterRadius);
      const rectBefore = JSON.stringify(st.rect);
      extendRect(st, cfg.houseWallPad, bell);
      const grew = JSON.stringify(st.rect) !== rectBefore;
      st.waves++;
      if (w.unloaded > 0 && !(st.hintDirs || {})[dir]) {
        st.hintDirs = st.hintDirs || {};
        st.hintDirs[dir] = true;
        LOG.info(`dalga ${dir}: ${w.unloaded} yüksüz kolon boş sayıldı`);
        try { world.sendMessage(`§e[CV]§7 Dalga §f${dir}§7: bazı alanlar yüklü değildi (boş sayıldı). Keşif sonrası: §e/cv:rescan`); } catch (e) { /* ignore */ }
      }
      LOG.info(`dalga ${dir} bitti: +${st.houses.length - before} ev, büyüdü=${grew}`);
      try {
        world.sendMessage(`§e[CV]§7 Dalga §f${dir}§7: +§f${st.houses.length - before}§7 ev (toplam §f${st.houses.length}§7)${grew ? " — sınır genişledi" : " — yön tamam"}`);
      } catch (e) { /* ignore */ }
      if (!grew) st.dirs[dir] = true;
      st.wave = null;
      return;
    }
  }
}

function finishMap(dim, bell, st) {
  st.phase = "done";
  st.cache = null; st.outlineCache = null;
  autoRegisterWorkshops(dim, bell, st);
  saveVState();
  const ol = outline(st);
  LOG.info(`harita tamam: ${st.houses.length} ev, ${ol.cols.length} sınır kolonu`);
  try {
    world.sendMessage(`§e[CV]§7 Köy haritası tamam: §f${st.houses.length}§7 ev, §f${ol.cols.length}§7 kolonluk basamaklı sınır. Çiz: §e/cv:bounds on`);
  } catch (e) { /* ignore */ }
  if (getConfig().constructionChest) {
    // v2.6.0 fix: this used to call C.needsSummary/C.dropNote — C was
    // never imported and neither function existed => ReferenceError on
    // every map completion. Now: real estimate + the bridge's writeNote.
    try {
      const mat = matFor(dim, bell);
      const wallId = (mat.wall && mat.wall[0] && mat.wall[0][0]) || "minecraft:cobblestone";
      const lines = [
        `§e[CV]§7 sınır için tahmini ihtiyaç:`,
        `§f${ol.cols.length * 3}x ${String(wallId).replace("minecraft:", "")}`,
        `§f${Math.max(1, Math.floor(ol.cols.length / 8))}x torch`,
        `§8çizim: /cv:walls · durum: /cv:diag`
      ];
      B.writeNote(dim, bell, lines);
    } catch (e) { /* ignore */ }
  }
}

// v2.5.2: scanned job-site blocks become workshops automatically
// (user: manual single-by-single registration is tedious; rescan picks up new builds)
// v2.5.3: exported + idempotent — bell add, /cv:setup and the periodic
// sync all funnel here so the FIRST scan always introduces job sites,
// no matter which command the player runs first.
const JS_TO_WS = {
  "minecraft:composter": "farmer",
  "minecraft:smithing_table": "toolsmith",
  "minecraft:grindstone": "weaponsmith",
  "minecraft:blast_furnace": "smelter",
  "minecraft:furnace": "smelter",
  "minecraft:smoker": "cook",
  "minecraft:stonecutter": "mason",
  "minecraft:stonecutter_block": "mason",
  "minecraft:crafting_table": "forester"
};
export function syncWorkshopsFromMap(dim, bell) {
  try {
    const st = getVState()[bellKey(bell)];
    if (!st || st.phase !== "done") return 0;   // mapping still running
    const v = V.get(bellKey(bell));
    if (!v) return 0; // economy not set up yet (/cv:setup) — next sync catches up
    const counts = {};
    for (const w of WS.list(v)) counts[w.type] = (counts[w.type] || 0) + 1;
    let added = 0;
    for (const j of (st.jobsites || [])) {
      const type = JS_TO_WS[j.id];
      if (!type) continue;
      if ((counts[type] || 0) >= 2) continue; // cap duplicates
      const res = WS.register(v, type, { typeId: j.id, location: { x: j.x, y: j.y, z: j.z } });
      if (res.ok && !res.existing) { counts[type] = (counts[type] || 0) + 1; added++; }
    }
    if (added > 0) {
      LOG.info(`[CV] atölye senkronu: ${added} atölye haritadan otomatik kaydedildi`);
      try { world.sendMessage(`§a[CV]§7 Harita taraması §f${added}§7 atölyeyi otomatik kaydetti (§e/cv:workshop list§7).`); } catch (e) { /* ignore */ }
    }
    return added;
  } catch (e) { return 0; }
}
function autoRegisterWorkshops(dim, bell, st) { syncWorkshopsFromMap(dim, bell); }

// ---------------- outline of the union of padded house boxes ----------------
function outline(st) {
  const cfg = getConfig();
  const key = (st.houses.length) + ":" + cfg.wallOffset + ":" + (st.houses.map(h => `${h.minX},${h.maxX},${h.minZ},${h.maxZ}`).join(";").length);
  if (st.outlineCache && st.outlineCache.key === key) return st.outlineCache;
  const off = cfg.wallOffset;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  const rects = st.houses.map(h => {
    const r = { minX: h.minX - off, maxX: h.maxX + off, minZ: h.minZ - off, maxZ: h.maxZ + off };
    minX = Math.min(minX, r.minX); maxX = Math.max(maxX, r.maxX);
    minZ = Math.min(minZ, r.minZ); maxZ = Math.max(maxZ, r.maxZ);
    return r;
  });
  if (st.bell) { // bell plaza always inside the wall line (user 27.09)
    const b = { minX: st.bell.x - off, maxX: st.bell.x + off, minZ: st.bell.z - off, maxZ: st.bell.z + off };
    rects.push(b);
  }
  if (!rects.length) {
    const r = { minX: -cfg.wallRadius, maxX: cfg.wallRadius, minZ: -cfg.wallRadius, maxZ: cfg.wallRadius };
    rects.push(r);
  }
  for (const r of rects) {
    minX = Math.min(minX, r.minX); maxX = Math.max(maxX, r.maxX);
    minZ = Math.min(minZ, r.minZ); maxZ = Math.max(maxZ, r.maxZ);
  }
  const inside = (x, z) => {
    for (const r of rects) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true;
    return false;
  };
  // hole filling: cells unreachable from outside are village interior
  const GW = maxX - minX + 3, GH = maxZ - minZ + 3;
  const grid = new Uint8Array(GW * GH);
  const outside = new Uint8Array(GW * GH);
  const gi = (x, z) => (z - minZ + 1) * GW + (x - minX + 1);
  for (let x = minX; x <= maxX; x++)
    for (let z = minZ; z <= maxZ; z++)
      if (inside(x, z)) grid[gi(x, z)] = 1;
  const stack = [];
  for (let i = 0; i < GW; i++) { stack.push(i); stack.push((GH - 1) * GW + i); }
  for (let j = 0; j < GH; j++) { stack.push(j * GW); stack.push(j * GW + GW - 1); }
  while (stack.length) {
    const c = stack.pop();
    if (outside[c] || grid[c]) continue;
    outside[c] = 1;
    const cx = c % GW, cz = (c - cx) / GW;
    if (cx > 0) stack.push(c - 1);
    if (cx < GW - 1) stack.push(c + 1);
    if (cz > 0) stack.push(c - GW);
    if (cz < GH - 1) stack.push(c + GW);
  }
  const insideF = (x, z) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
    return !outside[gi(x, z)];
  };

  const cols = [];
  const corner = new Set();
  const idxOf = new Map();
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      if (!insideF(x, z)) continue;
      const n = !insideF(x, z - 1), s2 = !insideF(x, z + 1), w = !insideF(x - 1, z), e = !insideF(x + 1, z);
      if (!(n || s2 || w || e)) continue; // interior
      const i = cols.length;
      cols.push({ x, z });
      idxOf.set(x + "," + z, i);
      const nb = (n ? 1 : 0) + (s2 ? 1 : 0) + (w ? 1 : 0) + (e ? 1 : 0);
      if (nb === 2 && ((n && e) || (n && w) || (s2 && e) || (s2 && w))) corner.add(i);
    }
  }
  st.outlineCache = { key, cols, corner, idxOf, minX, maxX, minZ, maxZ };
  return st.outlineCache;
}
export function outlineCols(st) { return outline(st).cols; }
export function getJobsites(bell) {
  const st = getVState()[bellKey(bell)];
  return (st && st.jobsites) || [];
}
export function getDoors(bell) {
  const st = getVState()[bellKey(bell)];
  return st && st.doors ? st.doors : [];
}

// wall-line rect (union of padded house boxes + wallOffset) — fields live
// INSIDE the walls (v2.5.3: jobs.js refreshFarmJobs needs this export)
export function rectOf(bell) {
  const st = getVState()[bellKey(bell)];
  if (!st || st.phase !== "done" || !st.houses || !st.houses.length) return undefined;
  const ol = outline(st);
  return { minX: ol.minX, maxX: ol.maxX, minZ: ol.minZ, maxZ: ol.maxZ };
}

// living-area rect (house boxes + pad, WITHOUT wallOffset) for lighting
export function coreRectOf(bell) {
  const st = getVState()[bellKey(bell)];
  if (!st || !st.houses || !st.houses.length) return undefined;
  const pad = getConfig().houseWallPad;
  let r = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
  for (const h of st.houses) {
    r.minX = Math.min(r.minX, h.minX - pad); r.maxX = Math.max(r.maxX, h.maxX + pad);
    r.minZ = Math.min(r.minZ, h.minZ - pad); r.maxZ = Math.max(r.maxZ, h.maxZ + pad);
  }
  return r;
}

// ---------------- columns & building ----------------
function matFor(dim, bell) { return U.wallMaterialFor(U.biomeCategory(dim, bell)); }
function gateIdFor(mat) {
  if (!mat.fence) return "minecraft:fence_gate";
  const derived = mat.fence[0][0].replace(/_fence$/, "_fence_gate");
  return U.perm(derived) ? derived : "minecraft:fence_gate";
}

// water-aware ground: returns seabed base + water surface line
// (v1.3.6 bug: water columns returned null => silent gaps in wall/wool line)
function columnGround(dim, yRef, x, z) {
  let waterTop = null;
  for (let y = yRef + 40; y >= yRef - 40; y--) {
    const b = U.getBlock(dim, U.vec(x, y, z));
    if (!b) continue;
    const t = U.typeId(b);
    if (t === undefined) return null;
    if (t === "minecraft:air") continue;
    if (t === "minecraft:yellow_wool") continue; // bounds marker is NOT ground (v1.3.8 bug)
    if (t.includes("torch") || t.includes("lantern")) continue;
    if (U.GRASS_PLANTS.has(t) || U.DOUBLE_PLANTS.has(t) || U.FLOWERS.has(t) || t === "minecraft:snow_layer" || t === "minecraft:vine" || t === "minecraft:cactus") continue;
    if (U.isLeaves(t)) continue;
    if (U.isLiquidId(t)) { if (waterTop === null) waterTop = y; continue; }
    const waterDepth = waterTop === null ? 0 : (waterTop - y);
    return { baseY: y, id: t, lineY: waterTop === null ? y : waterTop, water: waterTop !== null, waterDepth };
  }
  if (waterTop !== null) {
    // deep water: no seabed in range — line still drawn at the surface
    return { baseY: waterTop - 99, id: "minecraft:water", lineY: waterTop, water: true, waterDepth: 99 };
  }
  return null;
}

export function surfaceY(dim, yRef, x, z) {
  for (let y = yRef + 24; y >= yRef - 24; y--) {
    const b = U.getBlock(dim, U.vec(x, y, z));
    if (!b) return null;
    const t = U.typeId(b);
    if (t === undefined) return null;
    if (U.isLiquidId(t)) return null;
    if (U.isLeaves(t)) return null;
    if (t === "minecraft:air") continue;
    if (t.includes("torch") || t.includes("lantern")) continue;
    if (U.GRASS_PLANTS.has(t) || U.DOUBLE_PLANTS.has(t) || U.FLOWERS.has(t) || t === "minecraft:snow_layer" || t === "minecraft:vine" || t === "minecraft:cactus") continue;
    return y;
  }
  return null;
}
function columnState(dim, bell, col) {
  if (!chunkLoaded(dim, col.x, col.z)) return { built: true, unloaded: true };
  const g = columnGround(dim, bell.y, col.x, col.z);
  if (!g) return { built: true };
  if (g.water && g.waterDepth > 4) return { built: true, deep: true }; // too deep to bridge
  const at = U.typeId(U.getBlock(dim, U.vec(col.x, g.lineY + 1, col.z)));
  return { built: !!(at && WALLISH.test(at)), g };
}

function findWorker(dim, loc, radius) {
  try {
    let best, bd = radius;
    for (const e of dim.getEntities({ location: loc, maxDistance: radius })) {
      if (!U.isValidEntity(e)) continue;
      if (e.typeId !== "minecraft:villager_v2" && e.typeId !== "minecraft:villager") continue;
      const d = U.dist2d(e.location, loc);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  } catch (e) { return undefined; }
}

function roadAt(dim, bell, col) {
  const g = columnGround(dim, bell.y, col.x, col.z);
  if (!g || g.water) return false;
  return U.ROAD_IDS.has(g.id) || g.id === "minecraft:gravel";
}

function buildColumn(dim, bell, st, col, idx, worker) {
  const cfg = getConfig();
  const cst = columnState(dim, bell, col);
  if (cst.built || !cst.g) { LOG.dbg(`kolon atlandı (${col.x},${col.z}): built/unloaded/unsuitable`); return false; }
  const g = cst.g;
  if (Math.abs(g.lineY - bell.y) > 12) { LOG.dbg(`kolon atlandı (${col.x},${col.z}): kot ${Math.abs(g.lineY - bell.y)}`); return false; }
  const topY = g.lineY + 1; // SINGLE-ROW wall (user: revert to 1 block)
  if (U.skyLight(U.getBlock(dim, U.vec(col.x, topY, col.z))) < 13) { LOG.dbg(`kolon atlandı (${col.x},${col.z}): gece/kapalı`); return false; }

  const mat = matFor(dim, bell);
  if (!mat) return false;
  const ol = outline(st);
  const cols = ol.cols;
  const corner = ol.corner.has(idx);
  const prev = cols[(idx - 1 + cols.length) % cols.length];
  const next = cols[(idx + 1) % cols.length];

  // ---- single gate per road crossing (middle column) ----
  let isGate = false;
  if (cfg.wallGates && roadAt(dim, bell, col)) {
    let start = idx, guard = 0;
    while (guard++ < cols.length && roadAt(dim, bell, cols[(start - 1 + cols.length) % cols.length])) start = (start - 1 + cols.length) % cols.length;
    let len = 0, c = start;
    while (len < cols.length && roadAt(dim, bell, cols[c])) { len++; c = (c + 1) % cols.length; }
    isGate = (idx === (start + Math.floor((len - 1) / 2)) % cols.length);
  }

  if (isGate) {
    const at = U.typeId(U.getBlock(dim, U.vec(col.x, topY, col.z)));
    if (at && WALLISH.test(at)) return false;
    if (!at || !U.isBuildableSpace(at)) return false;
    const lineNS = prev.z !== next.z;
    const cardinal = lineNS ? "east" : "north";
    const gid = gateIdFor(mat);
    if (!B.hasMat(dim, bell, gid, 1)) { B.warnMissing(dim, bell, [gid.replace("minecraft:", "")], system.currentTick); return false; }
    const gp = U.firstPerm([
      [gid, { "minecraft:cardinal_direction": cardinal, open_bit: false, in_wall_bit: false }],
      [gid, { "minecraft:cardinal_direction": cardinal }],
      [gid], ["minecraft:fence_gate"]
    ]);
    if (!gp) return false;
    if (U.setBlock(dim, U.vec(col.x, topY, col.z), gp)) {
      B.consumeMat(dim, bell, gid, 1);
      stats.wallsBuilt++;
      if (worker) { U.workerAct(worker, U.vec(col.x, topY, col.z)); U.jumpAway(worker, dim); }
      U.sound(dim, U.vec(col.x, topY, col.z), "dig.wood", 0.4);
      LOG.info(`kapı (${col.x},${topY},${col.z}) yön=${cardinal}`);
      return true;
    }
    return false;
  }

  // ---- wall column ----
  const groundOk = U.FOUNDATION.has(g.id) || U.ROAD_IDS.has(g.id) || g.id === "minecraft:gravel" || g.water;
  if (!groundOk) { LOG.dbg(`kolon atlandı (${col.x},${col.z}): zemin ${g.id}`); return false; }
  const atT = U.typeId(U.getBlock(dim, U.vec(col.x, topY, col.z)));
  if (atT && (WALLISH.test(atT) || atT.includes("torch"))) return false;
  if (!atT || !(U.isBuildableSpace(atT) || U.isLiquidId(atT) || atT === "minecraft:yellow_wool")) return false;

  const wallId = mat.wall[0][0];
  const wallP = U.firstPerm(mat.wall);
  if (!wallP) return false;
  if (!B.hasMat(dim, bell, wallId, 1)) { B.warnMissing(dim, bell, [wallId.replace("minecraft:", "")], system.currentTick); return false; }

  // water: FREE dirt fill (5 rows) under the wall, chest not touched
  if (g.water) {
    for (let k = 0; k < 5; k++) {
      const loc = U.vec(col.x, g.lineY - k, col.z);
      const t = U.typeId(U.getBlock(dim, loc));
      if (t && !U.isLiquidId(t) && t !== "minecraft:air") break; // seabed reached
      U.setBlock(dim, loc, U.perm("minecraft:dirt"));
    }
  }

  if (!U.setBlock(dim, U.vec(col.x, topY, col.z), wallP)) { LOG.dbg(`kolon başarısız (${col.x},${col.z})`); return false; }
  B.consumeMat(dim, bell, wallId, 1);

  const spacing = cfg.wallTorchEvery > 0 ? cfg.wallTorchEvery : 6;
  if (corner) {
    if (B.hasMat(dim, bell, "minecraft:lantern", 1)) {
      const lp = U.PERMS.lantern();
      if (lp && U.setBlock(dim, U.vec(col.x, topY + 1, col.z), lp)) B.consumeMat(dim, bell, "minecraft:lantern", 1);
    }
  } else if (idx % spacing === 0) {
    if (B.hasMat(dim, bell, cfg.torchBlock, 1)) {
      const tp = U.PERMS.torch(cfg.torchBlock);
      if (tp && U.setBlock(dim, U.vec(col.x, topY + 1, col.z), tp)) B.consumeMat(dim, bell, cfg.torchBlock, 1);
    }
  }

  stats.wallsBuilt++;
  if (worker) { U.workerAct(worker, U.vec(col.x, topY, col.z)); U.jumpAway(worker, dim); }
  U.sound(dim, U.vec(col.x, topY, col.z), "dig.stone", 0.35);
  LOG.info(`duvar (${col.x},${topY},${col.z})${g.water ? " su+5 toprak dolgu" : ""}${corner ? " köşe" : ""}${wantTorch ? " +meşale" : ""}`);
  return true;
}

// ---------------- crew ----------------
const assignments = new Map();
function unbuiltCache(dim, bell, st, tick) {
  if (!st.cache || tick - st.cache.tick > 600) {
    const cols = outline(st).cols;
    const unbuilt = [];
    for (let i = 0; i < cols.length; i++) {
      const c = columnState(dim, bell, cols[i]);
      if (!c.built && !c.unloaded) unbuilt.push(i);
    }
    st.cache = { tick, unbuilt };
  }
  return st.cache.unbuilt;
}
export function crewPass(dim, bell, tick) {
  // NO impulses (v1.3.9): villagers work only where they naturally
  // walk; steady progress is carried by the 60s repair patrol.
  const st = getVState()[bellKey(bell)];
  if (!st || st.phase !== "done") return false;
  const ol = outline(st);
  const cols = ol.cols;
  let villagers = [];
  try {
    for (const t of ["minecraft:villager_v2", "minecraft:villager"]) {
      villagers = villagers.concat(dim.getEntities({ type: t, location: bell, maxDistance: getConfig().workerRadius }));
    }
  } catch (e) { return false; }
  let did = false;
  for (const v of villagers) {
    if (!U.isValidEntity(v) || U.isBaby(v)) continue; // v2.9.0: no child labor
    const vl = v.location;
    const fx = Math.floor(vl.x), fz = Math.floor(vl.z);
    for (let dx = -2; dx <= 2 && !did; dx++) {
      for (let dz = -2; dz <= 2 && !did; dz++) {
        const idx = ol.idxOf.get((fx + dx) + "," + (fz + dz));
        if (idx === undefined) continue;
        if (columnState(dim, bell, cols[idx]).built) continue;
        if (buildColumn(dim, bell, st, cols[idx], idx, v)) { did = true; st.cache = null; }
      }
    }
  }
  return did;
}

export function unbuiltNear(dim, bell, loc, maxD) {
  const st = getVState()[bellKey(bell)];
  if (!st || st.phase !== "done") return undefined;
  const unb = unbuiltCache(dim, bell, st, 0);
  const cols = outline(st).cols;
  let best, bd = maxD;
  for (const i of unb) {
    const d = Math.max(Math.abs(cols[i].x - loc.x), Math.abs(cols[i].z - loc.z));
    if (d <= bd) { bd = d; best = cols[i]; }
  }
  return best;
}

export function tryBuildAtVillager(dim, bell, villager) {
  const st = getVState()[bellKey(bell)];
  if (!st || st.phase !== "done") return false;
  const ol = outline(st);
  const vl = villager.location;
  const fx = Math.floor(vl.x), fz = Math.floor(vl.z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const i = ol.idxOf.get((fx + dx) + "," + (fz + dz));
      if (i === undefined) continue;
      if (columnState(dim, bell, ol.cols[i]).built) continue;
      return buildColumn(dim, bell, st, ol.cols[i], i, villager);
    }
  }
  return false;
}

// ---------------- patrol (chunk-safe bell handling) ----------------
export function repairPatrol(dim) {
  const list = getBells();
  if (!list.length) return;
  patrolIdx = (patrolIdx + 1) % list.length;
  const bell = list[patrolIdx];
  if (chunkLoaded(dim, bell.x, bell.z)) {
    if (U.typeId(U.getBlock(dim, bell)) !== "minecraft:bell") {
      list.splice(patrolIdx, 1); saveBells(list); patrolIdx = 0;
      LOG.warn("çan kırılmış → kayıttan silindi");
      return;
    }
  } else {
    return; // chunk unloaded: NEVER delete the bell (v1.3.5 bug)
  }
  if (!wallEnabledAt(dim, bell)) return;
  const st = getVState()[bellKey(bell)];
  if (!st || st.phase !== "done") return;
  const ol = outline(st);
  const cols = ol.cols;
  let repairs = 0;
  for (let i = 0; i < cols.length && repairs < 6; i++) {
    const cst = columnState(dim, bell, cols[i]);
    if (cst.built || !cst.s || cst.unloaded) continue;
    const prev = cols[(i - 1 + cols.length) % cols.length], next = cols[(i + 1) % cols.length];
    const pState = columnState(dim, bell, prev), nState = columnState(dim, bell, next);
    const frontier = (pState.built && !pState.unloaded) || (nState.built && !nState.unloaded);
    if (!frontier && !(ol.corner.has(i))) continue; // grow from the built front (corners always eligible)
    const worker = findWorker(dim, U.vec(cols[i].x, cst.s.y + 1, cols[i].z), 16);
    if (!worker) continue;
    if (buildColumn(dim, bell, st, cols[i], i, worker)) { repairs++; stats.wallsRepaired++; }
    if (U.changeBudget <= 0) break;
  }
  if (repairs > 0) LOG.info(`devriye: ${repairs} kolon onarıldı`);
}

export function hasBoostActive() {
  const cfg = getConfig();
  if (cfg.earlyBoostMinutes <= 0) return false;
  const now = Date.now();
  for (const b of getBells()) if (b.tick && (now - b.tick) < cfg.earlyBoostMinutes * 60000) return true;
  return false;
}

// ---------------- bounds on/off (particle shimmer, zero blocks) ----------------
let boundsCursor = 0;
export function boundsSet(dim, bell, on) {
  if (on) {
    const st = getVState()[bellKey(bell)];
    if (!st || st.phase !== "done") return { ok: false };
    boundsOn = true;
    LOG.info(`bounds on: partikül çerçeve aktif (${outline(st).cols.length} kolon)`);
    return { ok: true, pending: outline(st).cols.length };
  }
  boundsOn = false;
  // best-effort cleanup of legacy wool blocks (v1.3.x)
  let removed = 0, missed = 0;
  const kill = (loc) => {
    try {
      const bb = dim.getBlock(loc);
      if (bb && bb.typeId === "minecraft:yellow_wool") { bb.setPermutation(U.perm("minecraft:air")); removed++; }
    } catch (e) { /* ignore */ }
  };
  for (const loc of boundsWool) kill(loc);
  boundsWool = [];
  const st = getVState()[bellKey(bell)];
  if (st && st.phase === "done") {
    for (const col of outline(st).cols) {
      if (!chunkLoaded(dim, col.x, col.z)) { missed++; continue; }
      const g = columnGround(dim, bell.y, col.x, col.z);
      if (!g) continue;
      kill(U.vec(col.x, g.lineY + 1, col.z));
      kill(U.vec(col.x, g.lineY + 2, col.z));
      kill(U.vec(col.x, g.lineY + 3, col.z));
    }
  }
  boundsPending = [];
  LOG.info(`bounds off: parıltı kapatıldı (${removed} bellek listesi, ${missed} yüksüz)`);
  return { ok: true, removed, missed };
}

// continuous sparkle line while on (like the bell stars); places NOTHING
export function boundsTick(dim) {
  if (!boundsOn) return;
  const bell = getBells()[0];
  if (!bell) return;
  const st = getVState()[bellKey(bell)];
  if (!st || st.phase !== "done") return;
  const cols = outline(st).cols;
  if (!cols.length) return;
  const step = Math.max(1, Math.floor(cols.length / 140));
  for (let n = 0; n < 140; n++) {
    const idx = (boundsCursor + n * step) % cols.length;
    const col = cols[idx];
    if (!chunkLoaded(dim, col.x, col.z)) continue;
    const g = columnGround(dim, bell.y, col.x, col.z);
    if (!g) continue;
    try {
      dim.spawnParticle("minecraft:villager_happy", U.vec(col.x + 0.5, g.lineY + 1.5, col.z + 0.5));
    } catch (e) { /* ignore */ }
  }
  boundsCursor = (boundsCursor + 7) % cols.length;
}

// ---------------- summary ----------------
export function wallSummary(dim, loc) {
  const cfg = getConfig();
  const list = getBells();
  const near = nearestBell(dim, loc, 128);
  const cat = U.biomeCategory(dim, loc);
  const mat = U.wallMaterialFor(cat);
  const lines = [
    `§6Köy surları§r — çan: §f${list.length}§r · malzeme: §f${mat ? mat.wall[0][0].replace("minecraft:", "") : "none"}§r · biyom: ${cat}`,
    `§7Sınır: ev kutuları + §f${cfg.wallOffset}§7 blok payın BİRLEŞİM çevresi (basamaklı)`
  ];
  if (near) {
    lines.push(`Çan §f${near.x},${near.y},${near.z}§r — inşaat: ${wallEnabledAt(dim, near) ? "§aAKTİF" : "§cKAPALI (/cv:walls on)"}`);
    const st = getVState()[bellKey(near)];
    if (st && st.phase === "done") {
      const cols = outline(st).cols;
      let built = 0;
      for (const c of cols) if (columnState(dim, near, c).built) built++;
      lines.push(`İlerleme: §f${built}/${cols.length}§7 · ev: §f${st.houses.length}§7 · bounds: ${boundsOn ? "§aaçık" : "§ckapalı"}`);
      for (const sl of B.stockLinesForBell(dim, near)) lines.push(sl);
    } else {
      const wv = st && st.wave ? st.wave.dir : "-";
      lines.push(`§7Harita: faz §f${st ? st.phase : "yok"}§7 · yön §f${wv}§7 · ev §f${st ? st.houses.length : 0}§7 · §e/cv:log 30`);
    }
  } else {
    lines.push("§7128 blok içinde çan yok: §e/cv:bell add§7.");
  }
  return lines;
}
