// ============================================================
// Clever Villagers (Regrowth for Bedrock) — commands.js
// Custom commands (stable CustomCommandRegistry API), mirroring
// the Java mod's RegrowthCommands.java:
//   /cv:help, /cv:info, /cv:debug <0-2>,
//   /cv:pause, /cv:resume, /cv:flags <chars>,
//   /cv:config [key] [value], /cv:stats,
//   /cv:bell <add|clear|list>, /cv:toolkit
// ============================================================
import { world, system, ItemStack, CustomCommandParamType, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { getConfig, setConfig, listConfigLines, statsLines, sanitizeFlags, saveConfig } from "./config.js";
import * as U from "./util.js";
import * as W from "./walls.js";
import { professionOf } from "./villagers.js";
import { MOB_ACTIONS } from "./mobs.js";
import { ensureRuntime, isBootstrapped } from "./engine.js";
import * as C from "./chest.js";
import * as LOG from "./log.js";

const OP = CommandPermissionLevel.Admin;   // mirrors Java hasPermission(2)
const ANY = CommandPermissionLevel.Any;
const P = CustomCommandParamType;

// Every command callback pokes the runtime bootstrap: on Bedrock builds
// where early-phase subscriptions/schedules are dropped, the first
// /cv:* command of a session revives the simulation engine.
function ok(message) { try { ensureRuntime(); } catch (e) { /* ignore */ } return { status: CustomCommandStatus.Success, message }; }

// Bedrock custom-command callbacks differ across versions:
// some runtimes pass (origin, argsArray), others (origin, ...params).
// Normalize so handlers always see a plain array.
function normArgs(params) {
  if (!params || params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}
function fail(message) { try { ensureRuntime(); } catch (e) { /* ignore */ } return { status: CustomCommandStatus.Failure, message }; }

function say(text) {
  try { world.sendMessage(text); } catch (e) { /* ignore */ }
}

// reply to the command sender only (falls back to world chat)
function reply(origin, text) {
  const p = playerOf(origin);
  if (p) {
    try { p.sendMessage(text); return; } catch (e) { /* fall through */ }
  }
  say(text);
}

function singlePlayerFallback() {
  try {
    const ps = world.getAllPlayers();
    return ps.length === 1 ? ps[0] : undefined;
  } catch (e) { return undefined; }
}

function playerOf(origin) {
  // Some Bedrock builds leave origin.initiator empty for chat-executed
  // commands; walk every plausible field, then fall back to the only
  // online player (single-player worlds).
  try {
    if (origin) {
      const cands = [origin.initiator, origin.sourceEntity];
      for (const c of cands) {
        if (c && c.typeId === "minecraft:player") return c;
      }
    }
  } catch (e) { /* ignore */ }
  return singlePlayerFallback();
}

export function registerCommands(registry) {
  // ---------- help ----------
  registry.registerCommand({
    name: "cv:help",
    description: "Clever Villagers (Regrowth) — command list / komut listesi",
    permissionLevel: ANY,
    cheatsRequired: false
  }, (origin) => {
    const lines = [
      "§2§lClever Villagers §r§7— Regrowth for Bedrock (port of mactso/Regrowth, MIT)",
      "§e/cv:info§7 — inspect what you're looking at + mod status",
      "§e/cv:stats§7 — action counters",
      "§e/cv:toolkit§7 — get the Village Toolkit (settings GUI item)",
      "§e/cv:debug <0|1|2>§7 — debug level (OP)",
      "§e/cv:pause§7 / §e/cv:resume§7 — stop/start all actions (OP)",
      "§e/cv:flags <chars>§7 — villager flags (OP): c=cut grass, h=heal, r=roads, w=walls, v=trim leaves, t=torches, p=home fences",
      "§e/cv:config [key] [value]§7 — list/change settings (OP)",
      "§e/cv:bell <add|clear|list>§7 — manage village bells for wall building (OP)",
      "§7Walls: §e/cv:walls on|off§7 · border: §e/cv:bounds on|off§7 · remap: §e/cv:rescan"
    ];
    for (const l of lines) reply(origin, l);
    return ok("Clever Villagers help sent.");
  });

  // ---------- info ----------
  registry.registerCommand({
    name: "cv:info",
    description: "Inspect the entity/block you are looking at (Java: regrowth info)",
    permissionLevel: ANY,
    cheatsRequired: false
  }, (origin) => {
    const cfg = getConfig();
    const player = playerOf(origin);
    reply(origin, `§2§lClever Villagers§r §7status: ${cfg.enabled ? "§aRUNNING" : "§cPAUSED"}§7, flags: §f${cfg.villagerFlags || "none"}§7, debug: §f${cfg.debugLevel}§7, torchLight≤§f${cfg.torchLightLevel}`);
    reply(origin, `§7mobs: ${cfg.mobsEnabled ? "§aon" : "§coff"} §8(${MOB_ACTIONS.length} species)§7, farm repair: ${cfg.farmRepair ? "§aon" : "§coff"}§7, leaf drops: ${cfg.leafDrops ? "§aon" : "§coff"}`);
    reply(origin, `§7engine: §f${U.loopTicks}§7 loop ticks (son: §f${U.lastLoopTick}§7) ${U.loopTicks > 0 ? "§a— motor çalışıyor" : "§c— MOTOR DURMUŞ!"}§7 · boot: ${isBootstrapped() ? "§aok" : "§eşimdi başlatıldı"}§7 · çan: §f${W.getBells().length}`);
    if (U.loopTicks === 0) reply(origin, "§cMotor bu komutla başlatıldı — birkaç saniye bekleyip tekrar /cv:info yazın. Hâlâ 0 ise dünyayı tamamen kapatıp açın (deneysel özellikler KAPALI kalsın).");
    if (!player) return ok("Status shown (no player view available).");

    try {
      const hits = player.getEntitiesFromViewDirection({ maxDistance: 16 });
      if (hits && hits.length > 0) {
        const e = hits[0].entity;
        const hp = U.healthOf(e);
        reply(origin, `§6Looking at:§r ${e.typeId}${e.nameTag ? ` §7("${e.nameTag}")` : ""}${hp ? ` §c♥ ${Math.round(hp.cur * 10) / 10}/${hp.max}` : ""}`);
        if (e.typeId === "minecraft:villager_v2" || e.typeId === "minecraft:villager") {
          const prof = professionOf(e, e.dimension ?? player.dimension, system.currentTick);
          const bell = W.nearestBell(player.dimension, e.location, 64);
          reply(origin, `§7profession (job-site scan): §f${prof || "unemployed/unknown"}§7; flags it can perform: §f${cfg.villagerFlags}§7; bell: ${bell ? `§f${bell.x},${bell.y},${bell.z}` : "§cnone known"}`);
        }
        return ok("Entity info sent.");
      }
      const bhit = player.getBlockFromViewDirection({ maxDistance: 16 });
      if (bhit && bhit.block) {
        const b = bhit.block;
        const cat = U.biomeCategory(player.dimension, b.location);
        const mat = U.wallMaterialFor(cat);
        reply(origin, `§6Looking at:§r ${b.typeId} §7at ${b.x},${b.y},${b.z}`);
        reply(origin, `§7light: §f${U.lightLevel(b)}§7, biome: §f${cat}§7, wall material: §f${mat ? (mat.wall[0][0] + (mat.fence ? " + " + mat.fence[0][0] : "")) : "none"}§7, buildable space: ${U.isBuildableSpace(b.typeId) ? "§ayes" : "§cno"}`);
        return ok("Block info sent.");
      }
    } catch (e) {
      U.debug(1, "info error: " + e);
    }
    return ok("Status sent.");
  });

  // ---------- debug ----------
  registry.registerCommand({
    name: "cv:debug",
    description: "Set debug level 0-2 (Java: regrowth debugLevel)",
    permissionLevel: OP,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "level", type: P.Integer }]
  }, (origin, ...p) => {
    const args = normArgs(p);
    const res = setConfig("debugLevel", args[0]);
    if (!res.ok) return fail(res.message);
    say(`§7[CV] ${res.message}`);
    return ok(res.message.replace(/§./g, ""));
  });

  // ---------- walls on/off ----------
  registry.registerCommand({
    name: "cv:walls",
    description: "Start/stop wall construction: on | off",
    permissionLevel: OP,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "mode", type: P.String }]
  }, (origin, ...p2) => {
    const args = normArgs(p2);
    const mode = String(args[0] ?? "").toLowerCase();
    if (mode !== "on" && mode !== "off") return fail("Kullanım: /cv:walls on|off");
    const res = setConfig("wallsOn", mode === "on" ? "true" : "false");
    if (!res.ok) return fail(res.message);
    say(mode === "on"
      ? "§a[CV]§7 Duvar inşaatı §aBAŞLADI§7 (köylüler gündüz örer)."
      : "§c[CV]§7 Duvar inşaatı §cDURDURULDU§7.");
    return ok(mode === "on" ? "Walls ON" : "Walls OFF");
  });

  // ---------- roads on/off ----------
  registry.registerCommand({
    name: "cv:roads",
    description: "Enable/disable the 3-wide road standard engine: on | off",
    permissionLevel: OP,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "mode", type: P.String }]
  }, (origin, ...p2) => {
    const args = normArgs(p2);
    const mode = String(args[0] ?? "").toLowerCase();
    if (mode !== "on" && mode !== "off") return fail("Kullanım: /cv:roads on|off");
    const res = setConfig("roadsOn", mode === "on" ? "true" : "false");
    if (!res.ok) return fail(res.message);
    say(mode === "on"
      ? "§a[CV]§7 Yol standardı motoru §aAÇIK§7 (3 genişlik kesit tesviye + 1 basamak rampa; evler/yapılar dokunulmaz)."
      : "§c[CV]§7 Yol motoru §cKAPALI§7.");
    return ok(mode === "on" ? "Roads ON" : "Roads OFF");
  });

  // ---------- pause / resume ----------
  registry.registerCommand({
    name: "cv:pause",
    description: "Pause all Clever Villagers actions",
    permissionLevel: OP,
    cheatsRequired: false
  }, () => {
    setConfig("enabled", "false");
    say("§c[CV] Paused. §7Use /cv:resume to continue.");
    return ok("Paused");
  });
  registry.registerCommand({
    name: "cv:resume",
    description: "Resume Clever Villagers actions",
    permissionLevel: OP,
    cheatsRequired: false
  }, () => {
    setConfig("enabled", "true");
    say("§a[CV] Resumed. Villagers are back to work!");
    return ok("Resumed");
  });

  // ---------- flags ----------
  registry.registerCommand({
    name: "cv:flags",
    description: "Set villager action flags, e.g. 'chrwvt' (Java: villager flag string)",
    permissionLevel: OP,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "flags", type: P.String }]
  }, (origin, ...p) => {
    const args = normArgs(p);
    const flags = sanitizeFlags(args[0]);
    const cfg = getConfig();
    cfg.villagerFlags = flags;
    saveConfig();
    say(`§a[CV]§7 villager flags set to §f"${flags || "(none — villagers idle)"}"§7. c=cut h=heal r=road w=wall v=trim t=torch p=fence`);
    return ok("Flags: " + flags);
  });

  // ---------- config ----------
  registry.registerCommand({
    name: "cv:config",
    description: "List all settings, or set one: /cv:config <key> <value>",
    permissionLevel: OP,
    cheatsRequired: false,
    optionalParameters: [
      { name: "key", type: P.String },
      { name: "value", type: P.String }
    ]
  }, (origin, ...p) => {
    const args = normArgs(p);
    const key = args && args[0];
    const value = args ? args[1] : undefined;
    if (!key) {
      reply(origin, "§2§lClever Villagers config§r §7(also editable via the Toolkit GUI)");
      for (const l of listConfigLines()) reply(origin, l);
      return ok("Config listed in chat.");
    }
    if (value === undefined) {
      const cfg = getConfig();
      if (!(key in cfg)) return fail(`Unknown key: ${key}`);
      return ok(`${key} = ${cfg[key]}`);
    }
    const res = setConfig(key, value);
    if (!res.ok) return fail(res.message);
    say(`§7[CV] ${res.message}`);
    return ok(`${key} set`);
  });

  // ---------- stats ----------
  registry.registerCommand({
    name: "cv:stats",
    description: "Show action counters",
    permissionLevel: ANY,
    cheatsRequired: false
  }, (origin) => {
    reply(origin, "§2§lClever Villagers stats§r");
    for (const l of statsLines()) reply(origin, l);
    return ok("Stats sent.");
  });

  // ---------- bell ----------
  registry.registerCommand({
    name: "cv:bell",
    description: "Manage village bells: add (scan near you), clear, list",
    permissionLevel: OP,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "mode", type: P.String }]
  }, (origin, ...p) => {
    const args = normArgs(p);
    const mode = String(args[0] ?? "").toLowerCase();
    if (mode === "clear") {
      W.clearBells();
      say("§e[CV]§7 Bell registry cleared.");
      return ok("Bells cleared");
    }
    if (mode === "list") {
      const list = W.getBells();
      say(`§7[CV] Known bells: §f${list.length}`);
      for (const b of list.slice(0, 10)) say(`§8 • ${b.x}, ${b.y}, ${b.z}`);
      if (list.length > 10) say(`§8 ... and ${list.length - 10} more`);
      return ok(`${list.length} bells`);
    }
    if (mode === "add") {
      const player = playerOf(origin);
      if (!player) return fail("Run this as a player, standing near the village bell.");
      const dim = player.dimension;
      const b = W.findBellNearby(dim, player.location, 16);
      if (!b) return fail("No bell found within 16 blocks. Stand next to the village bell and try again.");
      if (W.addBell(b.x, b.y, b.z)) {
        say(`§a[CV]§7 Çan kaydedildi (§f${b.x}, ${b.y}, ${b.z}§7). Malzemeler için: bir sandığa bakıp §e/cv:construction add§7 → sonra §e/cv:walls on§7.`);
        // v2.5.3: if a map is already done for this bell (re-add / reload),
        // introduce the scanned job sites immediately; otherwise the map
        // finish + periodic sync will do it
        system.run(() => { try { W.syncWorkshopsFromMap(dim, b); } catch (e) { /* ignore */ } });
        return ok("Bell added");
      }
      say(`§7[CV] Bell at ${b.x},${b.y},${b.z} was already registered.`);
      system.run(() => { try { W.syncWorkshopsFromMap(dim, b); } catch (e) { /* ignore */ } });
      return ok("Bell already known");
    }
    return fail("mode must be add | clear | list");
  });

  // ---------- log ----------
  registry.registerCommand({
    name: "cv:log",
    description: "Show the in-game ring log (last N entries)",
    permissionLevel: ANY,
    cheatsRequired: false,
    optionalParameters: [{ name: "count", type: P.Integer }]
  }, (origin, ...p2) => {
    const args = normArgs(p2);
    const n = typeof args[0] === "number" ? args[0] : 15;
    const lines = LOG.getLog(n);
    if (!lines.length) return ok("Log boş. (config logEnabled true olmalı)");
    let chunk = 0;
    for (const l of lines) { reply(origin, `§8${l}`); if (++chunk > 24) break; }
    return ok(`${Math.min(n, lines.length)} log satırı gönderildi.`);
  });

  // ---------- bounds on/off ----------
  registry.registerCommand({
    name: "cv:bounds",
    description: "Draw/remove the village border wool line: on | off",
    permissionLevel: ANY,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "mode", type: P.String }],
    optionalParameters: [{ name: "value", type: P.Integer }]
  }, (origin, ...p2) => {
    const args = normArgs(p2);
    const mode = String(args[0] ?? "").toLowerCase();
    if (mode === "dist") {
      const v = Math.round(Number(args[1]));
      if (!Number.isFinite(v) || v < 2 || v > 30) return fail("dist 2..30 arasında olmalı");
      const res = setConfig("wallOffset", String(v));
      if (!res.ok) return fail(res.message);
      say(`§a[CV]§7 Duvar uzaklığı §f${v}§7 blok oldu. Yeni sınır için: §e/cv:rescan`);
      return ok("wallOffset = " + v);
    }
    if (mode !== "on" && mode !== "off") return fail("Kullanım: /cv:bounds on|off|dist <2-30>");
    const player = playerOf(origin);
    if (!player) return fail("Run as a player.");
    const bell = W.nearestBell(player.dimension, player.location, 128);
    if (!bell) return fail("128 blok içinde çan yok.");
    if (mode === "on") {
      if (W.boundsSet(player.dimension, bell, true)) {
        return ok("Sınır çizgisi AÇIK: yeşil parıltı (chunklar yüklendikçe tamamlanır). Kapat: /cv:bounds off");
      }
      return fail("Harita henüz tamamlanmadı — /cv:info faz durumuna bak.");
    }
    W.boundsSet(player.dimension, bell, false);
    return ok("Sınır çizgisi KAPATILDI, yünler kaldırıldı.");
  });

  // ---------- rescan ----------
  registry.registerCommand({
    name: "cv:rescan",
    description: "Restart village mapping (village grew / boundary wrong)",
    permissionLevel: OP,
    cheatsRequired: false
  }, (origin) => {
    const player = playerOf(origin);
    if (!player) return fail("Run as a player.");
    const bell = W.nearestBell(player.dimension, player.location, 128);
    if (!bell) return fail("128 blok içinde çan yok.");
    if (W.rescan(bell)) {
      say("§e[CV]§7 Harita taraması yeniden başlatıldı (çevreyi yükledikçe dalgalar tamamlanır).");
      return ok("Rescan started");
    }
    return fail("Bu çan için kayıt yok.");
  });

  // ---------- toolkit ----------
  registry.registerCommand({
    name: "cv:toolkit",
    description: "Give yourself the Village Toolkit (settings GUI item)",
    permissionLevel: ANY,
    cheatsRequired: false
  }, (origin) => {
    const player = playerOf(origin);
    if (!player) return fail("Only players can receive the toolkit.");
    // Command callbacks run in RESTRICTED execution mode: inventory
    // mutations must be deferred into a normal-mode task.
    try {
      system.run(() => {
        try {
          const stack = new ItemStack("cv:toolkit", 1);
          let given = false;
          const inv = player.getComponent("minecraft:inventory");
          if (inv && inv.container) {
            const leftover = inv.container.addItem(stack);
            given = !leftover; // addItem returns what did NOT fit
          }
          if (!given) player.dimension.spawnItem(new ItemStack("cv:toolkit", 1), player.location);
          world.sendMessage("§a[CV]§7 Village Toolkit verildi — kullanınca (sağ tık / basılı tut) ayar menüsü açılır.");
        } catch (e) {
          world.sendMessage("§c[CV]§7 Toolkit verilemedi: " + e);
        }
      });
      return ok("Toolkit veriliyor...");
    } catch (e) {
      return fail("Could not queue toolkit: " + e);
    }
  });
}
