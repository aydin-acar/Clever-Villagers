// ============================================================
// Clever Villagers (Regrowth for Bedrock) — log.js
// In-game ring-buffer log (Bedrock scripts cannot write files).
//  * /cv:log [n]  → last n entries in chat
//  * mirrored to console.warn  → Windows content.log file
//    (%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe
//     \LocalState\content.log — Settings > Creator > Content Log)
//  * toggle: /cv:config logEnabled true|false
// ============================================================
import { system } from "@minecraft/server";
import { getConfig } from "./config.js";

const buffer = [];
const MAX = 512;

function stamp() {
  try { return system.currentTick; } catch (e) { return 0; }
}

export function info(msg) {
  const cfg = getConfig();
  if (!cfg.logEnabled) return;
  buffer.push(`[T${stamp()}] INF ${msg}`);
  if (buffer.length > MAX) buffer.shift();
  try { console.warn("[CV] " + msg); } catch (e) { /* ignore */ }
}

export function dbg(msg) {
  const cfg = getConfig();
  if (!cfg.logEnabled) return;
  buffer.push(`[T${stamp()}] DBG ${msg}`);
  if (buffer.length > MAX) buffer.shift();
  if (cfg.debugLevel >= 1) {
    try { console.warn("[CV] " + msg); } catch (e) { /* ignore */ }
  }
}

export function warn(msg) {
  const cfg = getConfig();
  if (!cfg.logEnabled) return;
  buffer.push(`[T${stamp()}] WRN ${msg}`);
  if (buffer.length > MAX) buffer.shift();
  try { console.warn("[CV] WARN " + msg); } catch (e) { /* ignore */ }
}

export function getLog(n) {
  return buffer.slice(-Math.max(1, n || 20));
}
