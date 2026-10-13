// ============================================================
// Clever Villagers (Regrowth for Bedrock) — main.js
// Thin entry point: registers /cv:* commands during the
// early startup phase and kicks the self-healing runtime
// bootstrap (see engine.js).
// ============================================================
import { system } from "@minecraft/server";
import { registerCommands } from "./commands.js";
import { registerCv2Commands } from "./cv/commands.js";
import { ensureRuntime } from "./engine.js";

// ---------- early startup: register /cv:* commands ----------
system.beforeEvents.startup.subscribe((ev) => {
  try {
    registerCommands(ev.customCommandRegistry);
    console.warn("[CV] Clever Villagers commands registered.");
  } catch (e) {
    console.error("[CV] Command registration failed: " + e);
  }
  try {
    registerCv2Commands(ev.customCommandRegistry);
    console.warn("[CV] economy commands registered.");
  } catch (e) {
    console.error("[CV] Command registration failed: " + e);
  }
});

// ---------- kick the runtime (idempotent; also poked by commands) ----------
try {
  ensureRuntime();
} catch (e) {
  console.error("[CV] early ensureRuntime failed: " + e);
}

// ---------- script error trap ----------
try {
  system.afterEvents.scriptError.subscribe((ev) => {
    try {
      const err = ev.error;
      console.error("[CV] Script error: " + (err && (err.stack || err.message) ? (err.stack || err.message) : err));
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }

console.warn("[CV] Clever Villagers script engine started (Bedrock port of mactso/Regrowth, MIT).");
