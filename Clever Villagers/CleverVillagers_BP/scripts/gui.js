// ============================================================
// Clever Villagers (Regrowth for Bedrock) — gui.js
// Bedrock-exclusive improvement: the "Village Toolkit" item
// opens an in-game settings GUI (ActionForm/ModalForm), so
// everything is reachable without typing commands — handy on
// console/mobile. Non-OP players get a read-only menu.
// ============================================================
import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { getConfig, setConfig, statsLines, sanitizeFlags, saveConfig } from "./config.js";
import * as U from "./util.js";
import * as W from "./walls.js";

let guiInit = false;
export function initGui() {
  if (guiInit) return;
  guiInit = true;
  world.afterEvents.itemUse.subscribe((ev) => {
    try {
      const item = ev.itemStack;
      const src = ev.source;
      if (item && item.typeId === "cv:toolkit" && src && src.typeId === "minecraft:player") {
        system.run(() => { openMenu(src).catch(() => { }); });
      }
    } catch (e) { /* ignore */ }
  });
}

function hasOp(player) {
  try {
    const l = player.commandPermissionLevel;
    return typeof l === "number" ? l >= 2 : false; // Admin/Host/Owner (like Java permission level 2)
  } catch (e) { return false; }
}

function statusBody() {
  const cfg = getConfig();
  const bells = W.getBells().length;
  return [
    `Status: ${cfg.enabled ? "§aRUNNING" : "§cPAUSED"}`,
    `Villager flags: §f${cfg.villagerFlags || "none"}§r  (c·h·r·w·v·t·p)`,
    `Debug level: §f${cfg.debugLevel}§r, torch light ≤ §f${cfg.torchLightLevel}`,
    `Mobs: ${cfg.mobsEnabled ? "§aon" : "§coff"}§r, farm repair: ${cfg.farmRepair ? "§aon" : "§coff"}§r, leaf drops: ${cfg.leafDrops ? "§aon" : "§coff"}`,
    `Registered bells: §f${bells}§r — walls need a control block on the bell`
  ].join("\n");
}

async function openMenu(player) {
  if (!U.isValidEntity(player)) return;
  const isOp = hasOp(player);
  while (U.isValidEntity(player)) {
    const cfg = getConfig();
    const form = new ActionFormData()
      .title("§2Clever Villagers §r— Living Village Economy")
      .body(statusBody() + (isOp ? "" : "\n\n§7(read-only — operator required to change settings)"))
      .button("§bStatistics\n§8action counters")
      .button(isOp ? (cfg.enabled ? "§cPause mod\n§8stop all actions" : "§aResume mod\n§8start all actions") : "§7Pause mod\n§8(OP only)")
      .button(isOp ? "§eVillager flags\n§8chrwvtp" : "§7Villager flags\n§8(OP only)")
      .button(isOp ? "§eTorch light level\n§8currently ≤ " + cfg.torchLightLevel : "§7Torch light level\n§8(OP only)")
      .button(isOp ? "§eDebug level\n§8currently " + cfg.debugLevel : "§7Debug level\n§8(OP only)")
      .button("§6Village walls\n§8bell & material info")
      .button("§cClose");
    const res = await form.show(player);
    if (res.canceled) return;

    switch (res.selection) {
      case 0: { // stats
        const f = new ActionFormData().title("§bRegrowth Statistics").body(statsLines().join("\n")).button("§7Back");
        await f.show(player);
        break;
      }
      case 1: { // pause/resume
        if (!isOp) { await needOp(player); break; }
        setConfig("enabled", cfg.enabled ? "false" : "true");
        world.sendMessage(getConfig().enabled ? "§a[CV] Resumed." : "§c[CV] Paused.");
        break;
      }
      case 2: { // flags
        if (!isOp) { await needOp(player); break; }
        const f = new ModalFormData()
          .title("§eVillager Flags")
          .textField(
            "Which jobs should villagers do?\n c = cut grass   h = heal (cleric/smith)\n r = road repair   w = village walls\n v = trim leaves   t = place torches\n p = personal home fences",
            "e.g. chrwvt",
            cfg.villagerFlags
          );
        const r = await f.show(player);
        if (!r.canceled && r.formValues && typeof r.formValues[0] === "string") {
          cfg.villagerFlags = sanitizeFlags(r.formValues[0]);
          saveConfig();
          world.sendMessage(`§a[CV]§7 flags → §f${cfg.villagerFlags || "(idle)"}§7`);
        }
        break;
      }
      case 3: { // torch light level
        if (!isOp) { await needOp(player); break; }
        const f = new ModalFormData()
          .title("§eTorch Light Level")
          .slider("Place torches where light level is at most:", 0, 10, 1, cfg.torchLightLevel);
        const r = await f.show(player);
        if (!r.canceled && r.formValues && typeof r.formValues[0] === "number") {
          setConfig("torchLightLevel", String(r.formValues[0]));
        }
        break;
      }
      case 4: { // debug level
        if (!isOp) { await needOp(player); break; }
        const f = new ModalFormData()
          .title("§eDebug Level")
          .dropdown("Debug messages:", ["0 — off", "1 — log only", "2 — log + action bar"], cfg.debugLevel);
        const r = await f.show(player);
        if (!r.canceled && r.formValues && typeof r.formValues[0] === "number") {
          setConfig("debugLevel", String(r.formValues[0]));
        }
        break;
      }
      case 5: { // walls
        const lines = W.wallSummary(player.dimension, player.location);
        const f = new ActionFormData().title("§6Village Walls").body(lines.join("\n")).button("§7Back");
        await f.show(player);
        break;
      }
      case 6:
      default:
        return;
    }
  }
}

async function needOp(player) {
  const f = new ActionFormData()
    .title("§cOperator required")
    .body("Only world operators (OP) can change Clever Villagers settings — same as the Java mod requiring permission level 2.")
    .button("§7Back");
  await f.show(player);
}
