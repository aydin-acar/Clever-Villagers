// ============================================================
// cv2/commands.js — /cv:* custom commands (cheats kapalı uyumlu,
// restricted-execution kuralı: tüm mutasyonlar system.run içinde)
// ============================================================
import { world, system, CustomCommandParamType, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import * as V from "./core/village.js";
import * as D from "./core/depot.js";
import * as L from "./core/ledger.js";
import * as wallsModule from "../walls.js";
import * as J from "../jobs.js";
import * as W from "./core/workshop.js";
import * as O from "./core/order.js";
import * as R from "./core/recipe.js";
import * as PR from "./core/production.js";
import { ItemStack } from "@minecraft/server";
import * as LOG from "../log.js";

const OP = CommandPermissionLevel.Admin;
const ANY = CommandPermissionLevel.Any;
const P = CustomCommandParamType;

function ok(m) { return { status: CustomCommandStatus.Success, message: m }; }
function fail(m) { return { status: CustomCommandStatus.Failure, message: m }; }
function normArgs(p) {
  if (!p || p.length === 0) return [];
  if (p.length === 1 && Array.isArray(p[0])) return p[0];
  return p;
}
function playerOf(origin) {
  try {
    if (origin) {
      for (const c of [origin.initiator, origin.sourceEntity]) {
        if (c && c.typeId === "minecraft:player") return c;
      }
    }
  } catch (e) { /* ignore */ }
  try {
    const ps = world.getAllPlayers();
    return ps.length === 1 ? ps[0] : undefined;
  } catch (e) { return undefined; }
}
function say(t) { try { world.sendMessage(t); } catch (e) { /* ignore */ } }
function reply(origin, t) {
  const p = playerOf(origin);
  if (p) { try { p.sendMessage(t); return; } catch (e) { /* ignore */ } }
  say(t);
}
function lookedBlock(player, maxDistance) {
  try {
    const hit = player.getBlockFromViewDirection({ maxDistance: maxDistance || 8 });
    return hit && hit.block ? hit.block : undefined;
  } catch (e) { return undefined; }
}
function needsFuel(type) { return ["smelter", "cook", "butcher", "armorer"].includes(type); }
function countWorkersNear(dim, w) {
  try {
    return dim.getEntities({ location: w.jobBlock, maxDistance: 24 }).filter(e => e.typeId === "minecraft:villager_v2" || e.typeId === "minecraft:villager").length;
  } catch (e) { return 0; }
}
function nextSteps(v, dim, ws) {
  const steps = [];
  D.loadDepots(v);
  if (!(v.depots.get("warehouse") || { blocks: [] }).blocks.length) steps.push("ana depo yok: bir sandığa bak → /cv:warehouse add");
  if (!(v.depots.get("construction") || { blocks: [] }).blocks.length) steps.push("inşaat deposu yok (duvar/meşale malzemesi): /cv:construction add");
  if (ws.some(w => needsFuel(w.type)) && !(v.depots.get("fuel") || { blocks: [] }).blocks.length) steps.push("yakıt deposu yok (smelter/cook/butcher için): /cv:food add + /cv:fuel add");
  if (ws.some(w => w.type === "cook" || w.type === "butcher" || w.type === "farmer") && !(v.depots.get("food") || { blocks: [] }).blocks.length) steps.push("yiyecek deposu yok: /cv:food add");
  for (const w of ws) {
    if (!W.isValid(dim, v, w)) steps.push(`${w.id}: iş bloğu kırık/yerinde değil — yeniden kur: /cv:workshop add ${w.type}`);
  }
  if (ws.length && (v.orders || []).length === 0) steps.push("sipariş ver: /cv:order give <atölye> <item> <miktar> → kağıdı bir depo sandığına koy");
  const js = wallsModule.getJobsites(v.bell);
  const registered = new Set(ws.map(w => w.type));
  for (const j of js) {
    const hint = (wallsModule.jobSiteHint(j.id) || "").split("/")[0];
    if (hint && !registered.has(hint) && ["toolsmith", "mason", "smelter", "butcher", "armorer", "weaponsmith"].includes(hint)) {
      steps.push(`${j.id.replace("minecraft:", "")} bulundu @ ${j.x},${j.y},${j.z} → bak + /cv:workshop add ${hint}`);
      registered.add(hint);
    }
  }
  if (!steps.length) steps.push("her şey kurulu: /cv:order give <atölye> <item> <miktar> ile sipariş ver");
  return steps;
}
function nearestVillage(player, maxD = 128) {
  const loc = player.location;
  let best, bd = maxD;
  for (const v of V.all()) {
    const d = Math.hypot(v.bell.x - loc.x, v.bell.z - loc.z);
    if (d < bd) { bd = d; best = v; }
  }
  if (best) return best;
  // v2.6.0: read-only convenience — a single mapped village is always
  // addressable, even from far away (status/stock/diag from the forest)
  const all = V.all();
  return all.length === 1 ? all[0] : undefined;
}

export function registerCv2Commands(registry) {
  // ---------- setup ----------
  registry.registerCommand({
    name: "cv:setup",
    description: "Çana bakarak köy ekonomisini kur",
    permissionLevel: OP, cheatsRequired: false
  }, (origin) => {
    const player = playerOf(origin);
    if (!player) return fail("Oyuncu olarak çalıştır.");
    system.run(() => {
      const b = lookedBlock(player, 10);
      if (!b || b.typeId !== "minecraft:bell") {
        reply(origin, "§c[CV]§7 Önce köy çanına bak ve tekrar dene.");
        return;
      }
      const v = V.ensureVillage(b.location, player.dimension.id);
      D.loadDepots(v);
      // v2.8.0 (user: "kayıtlı oyunda setup 'kuruldu' diyor, 'zaten aktif'
      // demeli"): idempotency check — a persisted setup flag OR any
      // registered depot/workshop means the economy already exists. The
      // command then only REFRESHES (map sync + runtime poke) instead of
      // pretending to build a new village.
      let already = false;
      try { already = world.getDynamicProperty(`cv:v:${v.id}:setupDone`) === "1"; } catch (e) { /* ignore */ }
      let depotCount = 0;
      for (const [, d] of v.depots) depotCount += (d.blocks || []).length;
      let wsCount = 0;
      try { wsCount = W.list(v).length; } catch (e) { /* ignore */ }
      const existed = already || depotCount > 0 || wsCount > 0;
      // v2.5.3: job sites found by the map scan become workshops right away,
      // even if the map finished BEFORE /cv:setup was run
      let wsAdded = 0;
      try { wsAdded = wallsModule.syncWorkshopsFromMap(player.dimension, b.location); } catch (e) { /* ignore */ }
      try { world.setDynamicProperty(`cv:v:${v.id}:setupDone`, "1"); } catch (e) { /* ignore */ }
      if (existed) {
        reply(origin, `§e[CV]§7 Köy ekonomisi §fzaten aktif§7 (§f${v.id}§7 · ${depotCount} depo bloğu, ${wsCount} atölye). Kurulum tekrarı yerine §fbakım tazelemesi§7 yapıldı${wsAdded > 0 ? ` (+${wsAdded} atölye senkron)` : ""}.`);
      } else {
        reply(origin, `§a[CV]§7 Köy ekonomisi kuruldu (§f${v.id}§7). Sıradaki adım: bir sandığa bakıp §e/cv:warehouse add§7 (ayrıca §efood add§7, §efuel add§7, §econstruction add§7).`);
      }
      if (wsAdded > 0) reply(origin, `§a[CV]§7 Haritadaki iş istasyonlarından §f${wsAdded}§7 atölye otomatik kaydedildi (§e/cv:workshop list§7).`);
      LOG.info(`[CV] setup: village ${v.id} (zatenAktif=${existed}, +${wsAdded} atölye)`);
    });
    return ok("setup...");
  });

  // ---------- depot registration ----------
  const depotCmd = (name, type) => {
    registry.registerCommand({
      name: `cv:${name}`,
      description: `Baktığın sandık/varili ${type} deposu olarak kaydet`,
      permissionLevel: OP, cheatsRequired: false,
      mandatoryParameters: [{ name: "action", type: P.String }]
    }, (origin, ...pp) => {
      const args = normArgs(pp);
      if (String(args[0]).toLowerCase() !== "add") return fail("Kullanım: /cv:" + name + " add");
      const player = playerOf(origin);
      if (!player) return fail("Oyuncu olarak çalıştır.");
      system.run(() => {
        const v = nearestVillage(player);
        if (!v) { reply(origin, "§c[CV]§7 Önce §e/cv:setup§7 çalıştır (çan yakınında)."); return; }
        const b = lookedBlock(player, 8);
        if (!b || !D.isContainerId(b.typeId)) {
          reply(origin, "§c[CV]§7 Bir sandık/varil/trapped_chest'e bak ve tekrar dene.");
          return;
        }
        if (D.registerDepot(v, type, b.location)) {
          reply(origin, `§a[CV]§7 ${type} deposu kaydedildi: §f${b.x}, ${b.y}, ${b.z}`);
        } else {
          reply(origin, "§e[CV]§7 Bu blok zaten kayıtlı.");
        }
      });
      return ok("...");
    });
  };
  depotCmd("warehouse", "warehouse");
  depotCmd("food", "food");
  depotCmd("fuel", "fuel");
  depotCmd("construction", "construction");

  // ---------- stock ----------
  registry.registerCommand({
    name: "cv:stock",
    description: "Depo stoğunu listele (opsiyonel: warehouse|food|fuel|construction)",
    permissionLevel: ANY, cheatsRequired: false,
    optionalParameters: [{ name: "type", type: P.String }]
  }, (origin, ...pp) => {
    const args = normArgs(pp);
    const player = playerOf(origin);
    if (!player) return fail("Oyuncu olarak çalıştır.");
    const v = nearestVillage(player);
    if (!v) return fail("Kayıtlı köy yok: /cv:setup");
    const dim = player.dimension;
    const types = args[0] ? [String(args[0]).toLowerCase()] : D.DEPOT_TYPES;
    for (const t of types) {
      if (!D.DEPOT_TYPES.includes(t)) return fail("Tür: warehouse|food|fuel|construction");
      try { D.refreshDepot(dim, v, t); } catch (e) { /* ignore */ }
      for (const line of D.stockLines(v, t)) reply(origin, line);
    }
    return ok("stock sent");
  });

  // ---------- status (durum tablosu + next steps) ----------
  registry.registerCommand({
    name: "cv:status",
    description: "Köy ekonomisi durum tablosu + sonraki adımlar rehberi",
    permissionLevel: ANY, cheatsRequired: false
  }, (origin) => {
    const player = playerOf(origin);
    const vs = V.all();
    if (!vs.length) { reply(origin, "§c[CV]§7 Köy yok. Çana bakıp §e/cv:setup§7 yaz."); return ok("no village"); }
    const v = nearestVillage(player) || vs[0];
    const dim = player ? player.dimension : world.getDimension("overworld");
    D.loadDepots(v);
    reply(origin, `§6[CV] Köy §f${v.id}§6 — durum tablosu`);
    // depots
    for (const t of D.DEPOT_TYPES) {
      const d = v.depots.get(t);
      const n = d ? d.blocks.length : 0;
      reply(origin, `  ${n ? "§a" : "§c"}depo ${t}: ${n} blok${n ? "" : "  →  sandığa bak + /cv:" + t + " add"}`);
    }
    // workshops
    const ws = W.list(v);
    if (!ws.length) reply(origin, "  §eatölye yok:§7 bir iş bloğuna bak + §e/cv:workshop add <tip>");
    for (const w of ws) {
      const okJob = W.isValid(dim, v, w);
      const workers = countWorkersNear(dim, w);
      reply(origin, `  §f${w.id}§7 ${w.type} · job:${okJob ? "§a✓" : "§ckırık"} · işçi(yakın):${workers} · malzeme: 4 ana depo`);
    }
    // jobsites found in map
    const js = wallsModule.getJobsites(v.bell);
    if (js.length) {
      reply(origin, `  §7haritada ${js.length} meslek bloğu bulundu:`);
      for (const j of js.slice(0, 10)) {
        const hint = wallsModule.jobSiteHint(j.id) || "?";
        reply(origin, `     §f${j.id.replace("minecraft:", "")}§7 @ ${j.x},${j.y},${j.z} §8(${hint})`);
      }
    }
    // orders summary
    const os = O.listOrders(v);
    const byStatus = {};
    for (const o of os) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    reply(origin, `  §7siparişler: ${os.length ? Object.entries(byStatus).map(([k, n]) => `${k}x${n}`).join(", ") : "yok"}`);
    // next steps
    reply(origin, `§6[CV] sıradaki adımlar:`);
    for (const step of nextSteps(v, dim, ws).slice(0, 8)) reply(origin, "  §e→ §7" + step);
    return ok("status table sent");
  });

  // ---------- diag (remote debugging snapshot) ----------
  registry.registerCommand({
    name: "cv:diag",
    description: "Ekonomi teşhis anlık görüntüsü (işçi atamaları, döngüler, rezervler)",
    permissionLevel: OP, cheatsRequired: false
  }, (origin) => {
    const player = playerOf(origin);
    if (!player) return fail("Oyuncu olarak çalıştır.");
    const v = nearestVillage(player);
    if (!v) return fail("Köy yok.");
    const dim = player.dimension;
    const tod = world.getTimeOfDay();
    reply(origin, `§6[CV] diag§7 tod=${tod} villagers=${(() => { try { return dim.getEntities({ type: "minecraft:villager_v2", location: v.bell, maxDistance: 100 }).length; } catch (e) { return "?"; } })()}`);
    for (const o of O.listOrders(v)) {
      reply(origin, `  order §f${o.id}§7 ${o.status} ${o.producedCount || 0}/${o.quantity} res=${JSON.stringify(o.reserved || [])}`);
    }
    const tk = system.currentTick;
    // v2.5.3: every section guarded — one bad section must never kill the report
    try {
      for (const cy of PR.cycleDump(v, tk)) {
        reply(origin, `  cycle §f${cy.wid}§7 leg=§e${cy.leg}§7 order=${cy.order} işçi=${cy.bound} workerIdle=${cy.idleFor}t execs=${cy.execs}${cy.expectedOut ? " hedef=" + cy.expectedOut : ""}${cy.toProduce ? " üretilecek=" + cy.toProduce : ""} carry=[${cy.carry.join(",")}]`);
      }
    } catch (e) { reply(origin, `  §ccycle bölümü hata: ${e && e.message ? e.message : e}`); }
    try {
      for (const w of W.list(v)) {
        reply(origin, `  workshop §f${w.id}§7 ${w.type} @ ${w.jobBlock.x},${w.jobBlock.y},${w.jobBlock.z} ${W.isValid(dim, v, w) ? "§a✓" : "§c✗ (iş bloğu yok/kırık)"}`);
      }
    } catch (e) { reply(origin, `  §catölye bölümü hata: ${e && e.message ? e.message : e}`); }
    try {
      const zs = J.zoneStats(v);
      for (const k of ["forest", "quarry"]) {
        const z = zs[k];
        const corners = ` (p1${z.p1 ? "§a✓" : "§c✗"} p2${z.p2 ? "§a✓" : "§c✗"} kalıcı${z.persisted ? "§a✓" : "§e~"})`;
        reply(origin, `  zone §f${k}§7 ${z.set ? "§a" + z.rect : "§8kurulu değil"} iş=${z.jobs}${corners}${z.unloaded ? " §eyüksüz kolon=" + z.unloaded : ""}${z.camp ? ` kamp=§f${z.camp}§7 sahip=${z.campWorker === "✓" ? "§a✓" : "§c✗"}` : ""}`);
      }
    } catch (e) { reply(origin, `  §cbölge bölümü hata: ${e && e.message ? e.message : e}`); }
    try {
      const js = J.jobsStats;
      const ws = J.walkStats ? J.walkStats() : {};
      reply(origin, `  dispatch: last=${js.lastTick} (now=${tk}) assigned=${js.assigned} arrivals=${js.arrivals} errors=${js.errors} dönüşen=${js.converted || 0} işsizleşen=${js.unemployed || 0} vazgeçme=${js.giveups || 0} depo=${js.deposits || 0} yemek=${js.meals || 0} yerden=${js.pickups || 0}`);
      reply(origin, `  çapa: yerleşim=${ws.placed || 0} yenileme=${ws.replaced || 0} taşıma=${ws.moves || 0} red=${ws.refused || 0} işbaşı=${ws.claims || 0} kayıp=${ws.lost || 0} gömülü=${ws.buried || 0} (hareket %100 vanilla: script köylü TAŞIMAZ)`);
      for (const a of J.dumpAssigns().slice(0, 8)) {
        reply(origin, `  assign §f…${a.vid}§7 → ${a.type} @ ${a.x},${a.z} (since ${a.age})`);
      }
    } catch (e) { reply(origin, `  §cdispatch bölümü hata: ${e && e.message ? e.message : e}`); }
    try {
      D.loadDepots(v);
      for (const t of D.DEPOT_TYPES) {
        const d = v.depots.get(t);
        if (!d || !d.blocks.length) continue;
        try { D.refreshDepot(dim, v, t); } catch (e) { /* ignore */ }
        const ent = Object.entries(d.cache).filter(([, c]) => c.physical || c.reserved).slice(0, 8);
        reply(origin, `  depot §f${t}§7 (${d.blocks.length} blk): ${ent.map(([id, c]) => `${id.replace("minecraft:", "")}:${c.physical}${c.reserved ? "(r" + c.reserved + ")" : ""}`).join(" ") || "boş"}`);
      }
    } catch (e) { reply(origin, `  §cdepo bölümü hata: ${e && e.message ? e.message : e}`); }
    return ok("diag sent");
  });

  // ---------- zones ----------
  const zoneCmd = (name, kind) => {
    registry.registerCommand({
      name: `cv:${name}`,
      description: `${kind} bölgesi: pos1 | pos2 | show | clear`,
      permissionLevel: OP, cheatsRequired: false,
      mandatoryParameters: [{ name: "which", type: P.String }]
    }, (origin, ...pp) => {
      const args = normArgs(pp);
      const which = String(args[0] ?? "").toLowerCase();
      if (["pos1", "pos2", "show", "clear"].indexOf(which) < 0) return fail("Kullanım: /cv:" + name + " pos1|pos2|show|clear");
      const player = playerOf(origin);
      if (!player) return fail("Oyuncu olarak çalıştır.");
      const v = nearestVillage(player, 512); // zones may sit far from the bell
      if (!v) return fail("Köy yok: /cv:setup");
      // v2.6.0: memory write happens synchronously (safe in restricted
      // mode); the dynamic-property mirror + verify run inside setZoneCorner
      if (which === "show") {
        const c = J.zoneCorners(v, kind);
        if (!c.p1 && !c.p2) return ok(`${kind}: işaretli köşe yok`);
        const f = (p) => (p ? `${p.x},${p.y},${p.z}` : "-");
        return ok(`${kind} p1=${f(c.p1)} p2=${f(c.p2)} kalıcı=${c.persisted ? "evet" : "bellek"}`);
      }
      if (which === "clear") {
        J.clearZone(v, kind);
        return ok(`${kind} bölgesi temizlendi`);
      }
      const z = J.setZoneCorner(v, kind, which, player.location);
      const p = z.corner;
      const active = z.zone.p1 && z.zone.p2;
      reply(origin, `§a[CV]§7 ${kind} ${which} = §f${p.x}, ${p.y}, ${p.z}${active ? " §a— bölge AKTİF" : " §e(diğer köşeyi de işaretle)"} §8kalıcı=${z.persisted ? "evet" : "bellek"}`);
      return ok("zone set");
    });
  };
  zoneCmd("quarry", "quarry");
  zoneCmd("forest", "forest");

  // ---------- validate ----------
  registry.registerCommand({
    name: "cv:validate",
    description: "Stok/rezervasyon mutabakatı (ledger QA)",
    permissionLevel: OP, cheatsRequired: false
  }, (origin) => {
    const player = playerOf(origin);
    if (!player) return fail("Oyuncu olarak çalıştır.");
    const v = nearestVillage(player);
    if (!v) return fail("Köy yok.");
    for (const line of L.validate(player.dimension, v)) reply(origin, line);
    return ok("validate done");
  });

  // ---------- workshops ----------
  registry.registerCommand({
    name: "cv:workshop",
    description: "Atölye yönetimi: add <type> | link <id> <input|output|order|fuel> | list | remove <id>",
    permissionLevel: OP, cheatsRequired: false,
    mandatoryParameters: [{ name: "action", type: P.String }],
    optionalParameters: [{ name: "a1", type: P.String }, { name: "a2", type: P.String }]
  }, (origin, ...pp) => {
    const args = normArgs(pp);
    const act = String(args[0] ?? "").toLowerCase();
    const player = playerOf(origin);
    if (!player) return fail("Oyuncu olarak çalıştır.");
    const v = nearestVillage(player);
    if (!v) return fail("Köy yok: /cv:setup");
    if (act === "list") {
      const ws = W.list(v);
      if (!ws.length) return ok("Kayıtlı atölye yok.");
      for (const w of ws) reply(origin, `§f${w.id}§7 ${w.type} @ ${w.jobBlock.x},${w.jobBlock.y},${w.jobBlock.z} ${W.isValid(player.dimension, v, w) ? "§a✓" : "§c✗ iş bloğu yok/kırık → /cv:workshop remove " + w.id} · in:${w.inputChest ? "✓" : "—"} out:${w.outputChest ? "✓" : "—"} order:${w.orderChest ? "✓" : "—"} fuel:${w.fuelChest ? "✓" : "—"}`);
      return ok("workshops listed");
    }
    system.run(() => {
      if (act === "add") {
        const type = String(args[1] ?? "").toLowerCase();
        const b = lookedBlock(player, 8);
        if (!b) { reply(origin, "§c[CV]§7 İş bloğuna bak."); return; }
        const res = W.register(v, type, b);
        if (!res.ok) { reply(origin, `§c[CV]§7 Kayıt yok: ${res.reason} (tip örnek: toolsmith, mason, smelter, cook...)`); return; }
        reply(origin, `§a[CV]§7 Atölye §f${res.id}§7 ${res.existing ? "zaten kayıtlıymış (çift kayıt engellendi)" : "kayıtlı"} (iş bloğu yeterli). Malzemeler 4 ana depodan çekilir; sipariş kağıdını herhangi bir depo sandığına koy.`);
        return;
      }
      if (act === "link") {
        reply(origin, "§e[CV]§7 v2.2'de link kalktı: TÜM malzeme/ürün/sipariş kağıdı işlemleri 4 ana depo üzerinden yürür (warehouse/construction/food/fuel). Atölye = sadece iş bloğu.");
        return;
      }
      if (act === "remove") {
        const wid = String(args[1] ?? "");
        reply(origin, W.removeWorkshop(v, wid) ? `§a[CV]§7 ${wid} silindi.` : "§c[CV]§7 bulunamadı.");
        return;
      }
      reply(origin, "§c[CV]§7 Kullanım: workshop add|link|list|remove");
    });
    return ok("...");
  });

  // ---------- orders ----------
  registry.registerCommand({
    name: "cv:order",
    description: "Sipariş: give <workshop> <item> <qty> | list | status <id> | cancel <id>",
    permissionLevel: ANY, cheatsRequired: false,
    mandatoryParameters: [{ name: "action", type: P.String }],
    optionalParameters: [{ name: "a1", type: P.String }, { name: "a2", type: P.String }, { name: "a3", type: P.Integer }]
  }, (origin, ...pp) => {
    const args = normArgs(pp);
    const act = String(args[0] ?? "").toLowerCase();
    const player = playerOf(origin);
    if (!player) return fail("Oyuncu olarak çalıştır.");
    const v = nearestVillage(player);
    if (!v) return fail("Köy yok: /cv:setup");
    if (act === "list") {
      const os = O.listOrders(v);
      if (!os.length) return ok("Sipariş yok.");
      for (const o of os.slice(-8)) reply(origin, `§f#${o.num}§7 ${o.requester === "village" ? "§8[köy]§7 " : ""}${o.quantity}x ${o.itemId.replace("minecraft:", "")} [${o.workshopType}] → §e${o.status}§7 (${o.producedCount || 0}/${o.quantity})${o.missing.length ? " §c" + o.missing.join(",") : ""}`);
      return ok("orders listed");
    }
    if (act === "status") {
      const os = O.listOrders(v);
      const target = String(args[1] ?? "").trim();
      // v2.6.0: bare "/cv:order status" => newest live order; "#2"/"2"/id all work
      const live = os.filter(o => !["completed", "cancelled", "failed"].includes(o.status));
      const o = target ? O.findOrder(v, target) : (live[live.length - 1] || os[os.length - 1]);
      if (!o) {
        return fail(`Sipariş bulunamadı: "${target}". Mevcut: ${os.slice(-6).map(x => "#" + x.num).join(", ") || "-"}`);
      }
      reply(origin, `§f#${o.num}§7 (${o.id}): ${o.quantity}x ${o.itemId} → §e${o.status}§7 ${o.producedCount || 0}/${o.quantity}${o.missing.length ? " eksik: " + o.missing.join(", ") : ""}${o.failureReason ? " sebep: " + o.failureReason : ""}`);
      return ok("status sent");
    }
    if (act === "cancel") {
      const player2 = playerOf(origin);
      const target = String(args[1] ?? "");
      system.run(() => {
        if (target === "all") {
          let n = 0;
          for (const o of O.listOrders(v).slice()) {
            if (["completed", "cancelled", "failed"].includes(o.status)) continue;
            PR.cancelOrderCycle(player2 ? player2.dimension : world.getDimension("overworld"), v, o.id);
            if (O.cancelOrder(v, o.id)) n++;
          }
          reply(origin, `§e[CV]§7 ${n} sipariş iptal edildi (malzemeler iade).`);
        } else {
          PR.cancelOrderCycle(player2 ? player2.dimension : world.getDimension("overworld"), v, target);
          if (O.cancelOrder(v, target)) reply(origin, `§e[CV]§7 Sipariş ${target} iptal edildi (uçuştaki malzeme depoya iade edildi).`);
          else reply(origin, "§c[CV]§7 Sipariş bulunamadı.");
        }
      });
      return ok("cancelling...");
    }
    if (act === "give") {
      const type = String(args[1] ?? "").toLowerCase();
      let item = String(args[2] ?? "").toLowerCase();
      if (!item.includes(":")) item = "minecraft:" + item;
      const qty = typeof args[3] === "number" ? args[3] : 1;
      const res = O.createOrder(v, type, item, qty);
      if (!res.ok) return fail("Sipariş kurulamadı: " + res.reason);
      system.run(() => {
        try {
          const paper = O.makePaper(v, res.order);
          const inv = player.getComponent("minecraft:inventory");
          let left = paper;
          if (inv && inv.container) left = inv.container.addItem(paper);
          if (left) player.dimension.spawnItem(left, player.location);
          reply(origin, `§a[CV]§7 Sipariş §f#${res.order.num}§7 kağıdı verildi → herhangi bir §eDEPO§7 sandığına koy.`);
          for (const ln of O.needLines(v, res.order).slice(0, 5)) reply(origin, "   " + ln);
        } catch (e) {
          reply(origin, "§c[CV]§7 Kağıt verilemedi: " + e);
        }
      });
      return ok("order " + res.id);
    }
    return fail("Kullanım: order give|list|status|cancel");
  });

  // ---------- debug / log ----------
  registry.registerCommand({
    name: "cv:verbose",
    description: "Köy ayrıntılı log/chat: on|off",
    permissionLevel: OP, cheatsRequired: false,
    mandatoryParameters: [{ name: "mode", type: P.String }]
  }, (origin, ...pp) => {
    const args = normArgs(pp);
    const mode = String(args[0] ?? "").toLowerCase();
    if (mode !== "on" && mode !== "off") return fail("on|off");
    const player = playerOf(origin);
    if (!player) return fail("Oyuncu olarak çalıştır.");
    const v = nearestVillage(player);
    if (!v) return fail("Köy yok.");
    v.flags.verboseChat = mode === "on";
    v.flags.verboseLog = mode === "on";
    V.saveCore(v);
    return ok("cv2 debug " + mode);
  });


}
