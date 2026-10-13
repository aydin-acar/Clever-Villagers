// ============================================================
// cv2/core/ledger.js — append-only transaction ring + validate
// (QA anchor: physical stock must equal ledger balance)
// ============================================================
import { world } from "@minecraft/server";
import * as V from "./village.js";
import * as D from "./depot.js";
import * as LOG from "../../log.js";

const MAX = 512;

export function push(v, entry) {
  entry.tick = Date.now();
  v.ledger.push(entry);
  if (v.ledger.length > MAX) v.ledger.shift();
  try {
    world.setDynamicProperty(`cv:v:${v.id}:ledger`, JSON.stringify(v.ledger.slice(-64)));
  } catch (e) { /* ignore */ }
}

export function loadLedger(v) {
  if (v.ledger && v.ledger.length) return;
  try {
    const raw = world.getDynamicProperty(`cv:v:${v.id}:ledger`);
    v.ledger = (typeof raw === "string" && JSON.parse(raw)) || [];
  } catch (e) { v.ledger = []; }
}

// reconciliation: depot physical cache vs fresh container counts
export function validate(dim, v) {
  const lines = [];
  let bad = 0;
  for (const type of D.DEPOT_TYPES) {
    D.loadDepots(v);
    const d = v.depots.get(type);
    if (!d) continue;
    const before = JSON.stringify(d.cache);
    D.refreshDepot(dim, v, type);
    const after = JSON.stringify(d.cache);
    if (before !== after) {
      bad++;
      lines.push(`§c${type}: cache bayattı, tazelendi§7`);
    }
    for (const [id, c] of Object.entries(d.cache)) {
      if (c.reserved > c.physical) {
        bad++;
        lines.push(`§c${type}/${id.replace("minecraft:", "")}: reserved(${c.reserved}) > physical(${c.physical})§7`);
      }
    }
  }
  lines.unshift(bad === 0 ? "§a[CV] mutabakat TEMİZ§r" : `§c[CV] mutabakat sorunu: ${bad}§r`);
  LOG.info(`[CV] validate: ${bad} sorun`);
  return lines;
}
