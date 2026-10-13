// ============================================================
// cv2/core/container_utils.js — battle-tested container ops
// (migrated from v1 chest.js, extended for the economy)
// All-or-nothing everywhere: no item may ever vanish or dupe.
// ============================================================
import { ItemStack } from "@minecraft/server";

export function countItems(container, typeId) {
  let n = 0;
  if (!container) return 0;
  for (let i = 0; i < container.size; i++) {
    try {
      const it = container.getItem(i);
      if (it && it.typeId === typeId) n += it.amount;
    } catch (e) { /* skip slot */ }
  }
  return n;
}

// some Bedrock builds silently ignore slot.setItem(undefined) when a
// stack reaches 0 => infinite-item clone bug (v2.0.1). clear with
// fallbacks and ALWAYS verify.
import { ItemStack as _IS } from "@minecraft/server";
export function clearSlot(container, i) {
  try { container.getSlot(i).setItem(undefined); } catch (e) { /* ignore */ }
  try { if (container.getItem(i)) container.setItem(i, undefined); } catch (e) { /* ignore */ }
  try { if (container.getItem(i)) container.setItem(i, new _IS("minecraft:air", 1)); } catch (e) { /* ignore */ }
  try { return !container.getItem(i); } catch (e) { return false; }
}

export function canRemoveItems(container, requests) {
  for (const r of requests) {
    if (countItems(container, r.typeId) < r.count) return false;
  }
  return true;
}

// removes exactly; rolls back on any mid-way failure
export function removeItemsExact(container, requests) {
  if (!canRemoveItems(container, requests)) return false;
  const before = new Map();
  for (const r of requests) before.set(r.typeId, countItems(container, r.typeId));
  const undo = [];
  try {
    for (const r of requests) {
      let left = r.count;
      for (let i = 0; i < container.size && left > 0; i++) {
        const it = container.getItem(i);
        if (!it || it.typeId !== r.typeId) continue;
        const take = Math.min(left, it.amount);
        undo.push([i, it]);
        if (take >= it.amount) {
        if (!clearSlot(container, i)) throw new Error("slot-clear-failed");
      } else { it.amount -= take; container.setItem(i, it); }
        left -= take;
      }
      if (left > 0) throw new Error("short-remove");
    }
  } catch (e) {
    for (const [i, it] of undo) { try { container.setItem(i, it); } catch (e2) { /* ignore */ } }
    return false;
  }
  // post-verify: exact amount must be gone (clone-guard)
  for (const r of requests) {
    if (countItems(container, r.typeId) !== before.get(r.typeId) - r.count) {
      for (const [i, it] of undo) { try { container.setItem(i, it); } catch (e2) { /* ignore */ } }
      return false;
    }
  }
  return true;
}

export function canAddItems(container, typeId, count) {
  if (!container) return false;
  const maxA = Math.max(1, maxStackOf(typeId)); // v2.9.0: an empty slot holds ONE tool, not 64
  let room = 0;
  for (let i = 0; i < container.size; i++) {
    try {
      const it = container.getItem(i);
      if (!it) { room += maxA; continue; }
      if (it.typeId === typeId) room += Math.max(0, maxA - it.amount);
    } catch (e) { /* skip */ }
    if (room >= count) return true;
  }
  return room >= count;
}

// v2.9.0 KILLER BUG (user: "2 kazma siparişi → 1 kazma üretildi, sipariş
// tamamlandı"): the old loop built `new ItemStack(id, 64-capped chunks)` —
// for UNSTACKABLE items (tools/armor, maxAmount=1) a 2-count stack is
// illegal: the constructor throws or addItem rejects it, the "leftover"
// was silently dropped later and the order was still credited. Now the
// chunk size respects the real max stack size (pattern + API), so tools
// move one by one and every add is legal.
const UNSTACKABLE_RE = /(pickaxe|_axe$|^minecraft:axe|sword|shovel|hoe|helmet|chestplate|leggings|boots|bucket$|shears|flint_and_steel|fishing_rod|carrot_on_a_stick|warped_fungus_on_a_stick|clock|compass|recovery_compass|spyglass|brush|elytra|shield|totem_of_undying|trident|crossbow|^minecraft:bow|enchanted_book|written_book|saddle|minecart|^minecraft:.*_boat$|horse_armor|bundle|shulker_box|_bed$|^minecraft:bed|name_tag|lead|goat_horn|cake|music_disc|disc_fragment|echo_shard|netherite_upgrade_smithing_template|armor_trim_smithing_template|smithing_template|wolf_armor|mace|wind_charge|debug_stick|trial_key|ominous_trial_key|ender_eye|potion|splash_potion|lingering_potion|experience_bottle|filled_map|enchanted_golden_apple|totem)/;
export function maxStackOf(typeId) {
  let m = UNSTACKABLE_RE.test(String(typeId)) ? 1 : 64;
  try {
    const probe = new ItemStack(typeId, 1);
    if (typeof probe.maxAmount === "number" && probe.maxAmount >= 1) m = Math.min(m, probe.maxAmount);
  } catch (e) { /* pattern verdict stands */ }
  return m;
}

// adds as much as fits; returns leftover count (legal stacks only)
export function addItemsSafe(container, typeId, count) {
  if (!container) return count;
  let left = count;
  const maxA = Math.max(1, maxStackOf(typeId));
  while (left > 0) {
    const chunk = Math.min(maxA, left);
    let leftover;
    try {
      leftover = container.addItem(new ItemStack(typeId, chunk));
    } catch (e) { return left; }
    if (!leftover) { left -= chunk; continue; }
    const added = chunk - leftover.amount;
    if (added <= 0) break;       // container full
    left -= added;
    break;
  }
  return left;
}

// v2.9.0: numeric room for an item (canAddItems answers yes/no only)
export function roomFor(container, typeId, cap = 1 << 30) {
  if (!container) return 0;
  const maxA = Math.max(1, maxStackOf(typeId));
  let room = 0;
  for (let i = 0; i < container.size && room < cap; i++) {
    let it;
    try { it = container.getItem(i); } catch (e) { continue; }
    if (!it) { room += maxA; continue; }
    if (it.typeId === typeId) room += Math.max(0, maxA - it.amount);
  }
  return Math.min(room, cap);
}

// depot -> depot/workshop transfer, all-or-nothing
export function moveItems(src, dst, requests) {
  if (!canRemoveItems(src, requests)) return false;
  for (const r of requests) {
    if (!canAddItems(dst, r.typeId, r.count)) return false;
  }
  if (!removeItemsExact(src, requests)) return false;
  for (const r of requests) addItemsSafe(dst, r.typeId, r.count);
  return true;
}
