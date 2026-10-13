// ============================================================
// cv2/core/scheduler.js — round-robin economy heartbeat (20t)
// Sprint 1: depot cache freshness only. Later sprints plug in
// reservations / orders / couriers / workers / bridge here.
// ============================================================
import { world } from "@minecraft/server";
import * as V from "./village.js";
import * as D from "./depot.js";
import * as O from "./order.js";
import * as P from "./production.js";
import * as OD from "./order.js";
import * as RC from "./recipe.js";
import * as CU from "./container_utils.js";
import { getConfig } from "../../config.js";
import * as LOG from "../../log.js";
import * as U from "../../util.js";

// v2.11.0 (user: "minecraft'ta sadece meşe kütüğü yok — bir sürü biyom ve
// ağaç çeşidi var, diğerlerini de eklemelisin"): village demand thinks in
// WOOD FAMILIES — an acacia savanna village orders acacia planks, a cherry
// grove orders cherry planks; charcoal accepts any burnable log.
const PLANK_FAMS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak"]
  .map(f => ({ log: `minecraft:${f}_log`, planks: `minecraft:${f}_planks` }))
  .concat([
    { log: "minecraft:bamboo_block", planks: "minecraft:bamboo_planks" },
    { log: "minecraft:crimson_stem", planks: "minecraft:crimson_planks" },
    { log: "minecraft:warped_stem", planks: "minecraft:warped_planks" }
  ]);
import { world as _w, system as _s } from "@minecraft/server";

let villageIdx = 0;
let depotIdx = 0;
let tickNo = 0;
let lastTick = -1;
// v2.6.0: engine mainLoop watches this to re-arm a discarded interval
export function economyLastTick() { return lastTick; }

// village self-supply: production always comes first (user model)
// v2.8.0 (user: "sipariş tamamlandı ama köy siparişleri +4 +4 +4 hiç
// durmuyor"): THREE new brakes on village self-orders —
//   1) BACKLOG CAP: at most 2 open village orders at any time;
//   2) PER-ITEM COOLDOWN: after a village order of item X completes,
//      no new X order for 10 minutes (unless stock crashes hard);
//   3) HYSTERESIS: smelt orders need a real ore pile (>=8) AND an
//      almost-empty ingot buffer (<8), so a finished 20-ingot order
//      does not immediately respawn as +4 +4 +4.
const VILLAGE_ORDER_CAP = 2;
const VILLAGE_CD = 12000; // 10 min
function demandMonitor(dim, v, tick) {
  if ((v.lastDemand || 0) + 600 > tick) return;
  v.lastDemand = tick;
  try {
    D.loadDepots(v);
    const avail = (types, id) => types.reduce((n, t) => n + D.available(v, t, id), 0);
    const WC = ["warehouse", "construction"];
    // v2.9.0 (user: "köy siparişlerinde iki tane aktif oak_plank siparişi
    // var — üst üste 2 tane sipariş açmaları garip"): this monitor used to
    // read the RAW `v.orders || []`. After a reload that array is lazily
    // loaded — live() saw ZERO orders and re-opened items that were
    // already open. Now the list always comes through O.listOrders (which
    // loads it), one item can never have two open orders, and a cleanup
    // pass cancels legacy duplicates (oldest wins).
    const ords = O.listOrders(v);
    const CLOSED = ["completed", "cancelled", "failed"];
    const live = (ws) => ords.some(o => !CLOSED.includes(o.status) && o.workshopType === ws);
    const openItem = (id) => ords.some(o => !CLOSED.includes(o.status) && o.itemId === id);
    const openVillage = ords.filter(o => o.requester !== "player" && !CLOSED.includes(o.status));
    {
      const seen = new Set();
      let cancelledDup = 0;
      for (const o of openVillage) {
        if (!seen.has(o.itemId)) { seen.add(o.itemId); continue; }
        o.status = "cancelled";
        o.missing = [];
        o.failureReason = "duplicate_village_order";
        o.updatedAtTick = tick;
        try { OD.releaseAll(v, o); } catch (e) { /* ignore */ }
        cancelledDup++;
      }
      if (cancelledDup > 0) {
        OD.saveOrders(v);
        LOG.info(`[CV] ${cancelledDup} mükerrer köy siparişi iptal edildi (v2.9.0 temizlik)`);
      }
    }
    const cd = v.__vCd || (v.__vCd = {});
    const cooled = (id) => (cd[id] || 0) <= tick;
    const vOrder = (ws, id, qty) => {
      if (openVillage.length >= VILLAGE_ORDER_CAP) return false;
      if (!cooled(id)) return false;
      if (openItem(id)) return false; // v2.9.0: never two open orders of the same item
      const r = OD.createOrder(v, ws, id, qty, true);
      if (r && r.ok) { openVillage.push(r.order); cd[id] = tick + VILLAGE_CD; }
      else cd[id] = tick + 1200; // creation failed: retry in a minute
      return true;
    };
    // remember completion times: an order that just finished blocks its
    // own item for the cooldown window (checked via updatedAtTick)
    for (const o of ords) {
      if (o.requester !== "player" && o.status === "completed" && o.updatedAtTick && tick - o.updatedAtTick < VILLAGE_CD) {
        cd[o.itemId] = Math.max(cd[o.itemId] || 0, o.updatedAtTick + VILLAGE_CD);
      }
    }
    const foodTotal = ["minecraft:bread", "minecraft:cooked_beef", "minecraft:cooked_porkchop", "minecraft:cooked_chicken", "minecraft:baked_potato", "minecraft:carrot", "minecraft:potato"]
      .reduce((n, id) => n + D.available(v, "food", id), 0);
    // v2.8.0: meals are stamina-based now => the food buffer can be small
    if (foodTotal < 12 && !live("cook")) {
      if (avail(WC.concat(["food"]), "minecraft:wheat") >= 3) vOrder("cook", "minecraft:bread", 8);
      else if (avail(WC.concat(["food"]), "minecraft:potato") >= 1) vOrder("cook", "minecraft:baked_potato", 8);
      else if (avail(WC.concat(["food"]), "minecraft:beef") >= 1) vOrder("cook", "minecraft:cooked_beef", 8);
    }
    const fuelTotal = D.available(v, "fuel", "minecraft:coal") + D.available(v, "fuel", "minecraft:charcoal");
    // v2.6.0: charcoal is a SMELTER job (there is no "fueler" job block;
    // the old type could never match a workshop => order stuck forever)
    const anyLog = U.BURNABLE_LOGS.reduce((n, id) => n + avail(WC, id), 0); // v2.11.0: her türden kütük
    if (fuelTotal < 16 && anyLog >= 4 && !live("smelter")) vOrder("smelter", "minecraft:charcoal", 4);
    const torchTotal = avail(WC, "minecraft:torch");
    const anyPlanks = U.PLANK_IDS.reduce((n, id) => n + avail(WC, id), 0);
    if (torchTotal < 16 && avail(WC, "minecraft:stick") >= 1 && (avail(WC, "minecraft:coal") + avail(WC, "minecraft:charcoal")) >= 1 && !live("forester")) vOrder("forester", "minecraft:torch", 8);
    else if (avail(WC, "minecraft:stick") < 16 && anyPlanks >= 2 && !live("forester")) vOrder("forester", "minecraft:stick", 8);
    else if (!live("forester")) {
      // v2.11.0: planks per family — order from the logs the zone actually yields
      for (const fam of PLANK_FAMS) {
        if (avail(WC, fam.planks) < 16 && avail(WC, fam.log) >= 1) { vOrder("forester", fam.planks, 8); break; }
      }
    }
    if (avail(WC, "minecraft:raw_iron") >= 8 && fuelTotal >= 1 && !live("smelter") &&
        avail(WC, "minecraft:iron_ingot") < 8) vOrder("smelter", "minecraft:iron_ingot", 4);
    // v2.7.0 (user): "depoda 1056 külçe varken neden sipariş giriyor?" —
    // smelting demand must respect the OUTPUT buffer too, not only the
    // raw-ore pile. Full ingot stock => no new ingot order, ever.
    else if (avail(WC, "minecraft:raw_copper") >= 8 && fuelTotal >= 1 && !live("smelter") &&
        avail(WC, "minecraft:copper_ingot") < 8) vOrder("smelter", "minecraft:copper_ingot", 4);
    // v2.6.0 (user): village keeps a standing buffer stock — food, fuel,
    // torches AND tools; a broken/missing pickaxe re-orders itself.
    if (avail(WC, "minecraft:stone_pickaxe") < 1 && avail(WC, "minecraft:cobblestone") >= 3 &&
        avail(WC, "minecraft:stick") >= 2 && !live("toolsmith")) {
      vOrder("toolsmith", "minecraft:stone_pickaxe", 1);
    }
  } catch (e) { /* ignore */ }
}

// ---------- v2.10.0 BREEDING ROUTINE ----------
// User: "yerdeki itemleri alıp depolara götürdükleri için artık
// çoğalmıyorlar... sandıkta yiyecek varsa çoğalma tetiklenebilir... ya da
// sen daha profesyonel bir kontrol mantığı tasarlayabilirsin".
// Root cause: deposit errands strip EVERY edible out of villager packs,
// and vanilla willingness needs food IN their inventory. Professional
// gate instead of a hack:
//   * once per game day, at the evening gathering (tod 11000..12000);
//   * only if the FOOD depot holds a real surplus (>= breedMinBread);
//   * only while adults < popCap (no overpopulation);
//   * two IDLE adults physically receive 3 bread each (verified
//     chest->pack move, leftovers returned); vanilla beds+food do the
//     rest. Switch: /cv:config set breedingOn false.
function breedingTick(dim, v, tick) {
  try {
    const cfg = getConfig();
    if (cfg.breedingOn === false) return;
    let tod = 12000;
    try { tod = world.getTimeOfDay(); } catch (e) { /* ignore */ }
    if (tod < 11000 || tod > 12000) return;
    const day = Math.floor(tick / 24000);
    if ((v.breedDay || -1) === day) return; // once per day, ever
    v.breedDay = day;
    D.loadDepots(v);
    const bread = D.available(v, "food", "minecraft:bread");
    if (bread < (cfg.breedMinBread || 24)) return;
    let adults = [];
    for (const t of ["minecraft:villager_v2", "minecraft:villager"]) {
      try { adults = adults.concat(dim.getEntities({ type: t, location: v.bell, maxDistance: 60 })); } catch (e) { /* ignore */ }
    }
    adults = adults.filter(e => {
      try { return e.isValid() && !e.getComponent("minecraft:is_baby"); } catch (err) { return false; }
    });
    if (adults.length >= (cfg.popCap || 24)) return;
    const idle = adults.filter(e => {
      try { return !(e.nameTag || ""); } catch (err) { return false; }
    });
    if (idle.length < 2) return;
    let fed = 0;
    for (const e of idle.slice(0, 2)) {
      if (!P.consumeFromAny(dim, v, ["food"], [{ typeId: "minecraft:bread", count: 3 }])) break;
      let cont;
      try { cont = e.getComponent("minecraft:inventory").container; } catch (err) { cont = undefined; }
      const left = cont ? CU.addItemsSafe(cont, "minecraft:bread", 3) : 3;
      if (left > 0) D.addToDepot(dim, v, "food", "minecraft:bread", left);
      if (3 - left > 0) fed++;
    }
    if (fed >= 2) {
      LOG.info("[CV] üreme desteği: 2 köylüye 3'er ekmek (depo fazlası) — vanilla üreme devrede");
      try { world.sendMessage("§a[CV]§7 Depoda yiyecek bolluğu var: iki köylüye düğün payı (3'er ekmek) verildi — üreme vanilla kurallarıyla (yatak+yiyecek) devam eder."); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

export function economyTick() {
  tickNo++;
  lastTick = _s.currentTick;
  const villages = V.all();
  if (!villages.length) return;
  const v = villages[villageIdx % villages.length];
  villageIdx++;
  let dim;
  try { dim = world.getDimension(v.dimension || "minecraft:overworld"); } catch (e) { return; }
  try {
    if (!dim.isChunkLoaded({ x: v.bell.x, y: v.bell.y, z: v.bell.z })) return;
  } catch (e) { return; }

  D.loadDepots(v);
  const types = D.DEPOT_TYPES;
  // light pass: one depot per 20t round-robin
  const tLight = types[depotIdx % types.length];
  depotIdx++;
  try { D.refreshDepot(dim, v, tLight); } catch (e) { /* ignore */ }
  // full pass: every depot each 200t
  if (tickNo % 10 === 0) {
    for (const t of types) {
      try { D.refreshDepot(dim, v, t); } catch (e) { /* ignore */ }
    }
  }

  try {
    if (!v.__carryRecovered) { v.__carryRecovered = true; P.recoverCarries(dim, v); }
    P.tickProduction(dim, v, _s.currentTick);
    P.watchdog(dim, v, _s.currentTick);
  } catch (e) { /* ignore */ }
  demandMonitor(dim, v, _s.currentTick);
  breedingTick(dim, v, _s.currentTick); // v2.10.0 population gate
  // Sprint 2: order paper scan & validation (40t cadence)
  if (tickNo % 2 === 0) {
    try { O.tickOrders(dim, v, _s.currentTick); } catch (e) { /* ignore */ }
  }
  // --- Sprint 3+: reservations / couriers / workers / bridge plug in here ---
}
