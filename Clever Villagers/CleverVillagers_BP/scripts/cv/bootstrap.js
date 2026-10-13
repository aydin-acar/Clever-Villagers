// ============================================================
// cv2/bootstrap.js — economy runtime startup (normal-mode safe,
// v1 ensureRuntime pattern). Called once from engine bootstrap.
// ============================================================
import { world, system } from "@minecraft/server";
import { economyTick } from "./core/scheduler.js";
import * as D from "./core/depot.js";

let started = false;

export function initCv2(force) {
  if (started && !force) return;
  started = true;
  try {
    system.runInterval(() => {
      try { economyTick(); } catch (e) { console.error("[CV] economy tick: " + e); }
    }, 20);
  } catch (e) { console.error("[CV] interval failed: " + e); }
  try {
    world.afterEvents.playerBreakBlock.subscribe((ev) => {
      try {
        // ev.block is the AFTER state (air); the broken id lives in brokenBlockPermutation
        let id = undefined;
        try { id = ev.brokenBlockPermutation && ev.brokenBlockPermutation.type && ev.brokenBlockPermutation.type.id; } catch (e) { /* ignore */ }
        if (!id && ev.block) id = ev.block.typeId;
        const loc = ev.block ? ev.block.location : undefined;
        if (id && loc && D.isContainerId(id)) D.onBlockBroken(loc);
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
  console.warn("[CV] economy runtime started (Sprint 1: depots+stock+ledger).");
}
