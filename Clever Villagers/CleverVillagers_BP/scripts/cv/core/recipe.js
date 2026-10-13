// ============================================================
// cv/core/recipe.js — data-driven recipe registry (PLAN §6.3)
// All item ids validated against vanilla-data 1.26.51 (Sprint 0).
// ============================================================

export const RECIPES = [
  { id: "planks", output: "minecraft:oak_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:oak_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_spruce", output: "minecraft:spruce_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:spruce_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_birch", output: "minecraft:birch_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:birch_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_jungle", output: "minecraft:jungle_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:jungle_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_acacia", output: "minecraft:acacia_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:acacia_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_dark_oak", output: "minecraft:dark_oak_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:dark_oak_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_mangrove", output: "minecraft:mangrove_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:mangrove_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_cherry", output: "minecraft:cherry_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:cherry_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_pale_oak", output: "minecraft:pale_oak_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:pale_oak_log", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_bamboo", output: "minecraft:bamboo_planks", outputCount: 2, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:bamboo_block", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_crimson", output: "minecraft:crimson_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:crimson_stem", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "planks_warped", output: "minecraft:warped_planks", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:warped_stem", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "stick", output: "minecraft:stick", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:oak_planks", count: 2, alternatives: ["minecraft:spruce_planks", "minecraft:birch_planks", "minecraft:jungle_planks", "minecraft:acacia_planks", "minecraft:dark_oak_planks", "minecraft:mangrove_planks", "minecraft:cherry_planks", "minecraft:pale_oak_planks", "minecraft:bamboo_planks", "minecraft:crimson_planks", "minecraft:warped_planks"] }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "torch", output: "minecraft:torch", outputCount: 4, workshop: "forester", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:stick", count: 1 }, { itemId: "minecraft:coal", count: 1, alternatives: ["minecraft:charcoal"] }], fuelRequired: 0, foodRequired: 0, workTicks: 60 },
  { id: "charcoal", output: "minecraft:charcoal", outputCount: 1, workshop: "smelter", station: ["minecraft:furnace"], machine: "minecraft:furnace", inputs: [{ itemId: "minecraft:oak_log", count: 1, alternatives: ["minecraft:spruce_log", "minecraft:birch_log", "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log", "minecraft:mangrove_log", "minecraft:cherry_log", "minecraft:pale_oak_log", "minecraft:oak_wood", "minecraft:spruce_wood", "minecraft:birch_wood", "minecraft:jungle_wood", "minecraft:acacia_wood", "minecraft:dark_oak_wood", "minecraft:mangrove_wood", "minecraft:cherry_wood", "minecraft:pale_oak_wood"] }], fuelRequired: 1, foodRequired: 0, workTicks: 200 },
  { id: "stone_pickaxe", output: "minecraft:stone_pickaxe", outputCount: 1, workshop: "toolsmith", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:cobblestone", count: 3 }, { itemId: "minecraft:stick", count: 2 }], fuelRequired: 0, foodRequired: 0, workTicks: 100 },
  { id: "iron_pickaxe", output: "minecraft:iron_pickaxe", outputCount: 1, workshop: "toolsmith", station: ["minecraft:crafting_table", "minecraft:smithing_table"], machine: null, inputs: [{ itemId: "minecraft:iron_ingot", count: 3 }, { itemId: "minecraft:stick", count: 2 }], fuelRequired: 0, foodRequired: 0, workTicks: 160 },
  { id: "iron_sword", output: "minecraft:iron_sword", outputCount: 1, workshop: "weaponsmith", station: ["minecraft:crafting_table", "minecraft:grindstone"], machine: null, inputs: [{ itemId: "minecraft:iron_ingot", count: 2 }, { itemId: "minecraft:stick", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 140 },
  { id: "iron_chestplate", output: "minecraft:iron_chestplate", outputCount: 1, workshop: "armorer", station: ["minecraft:blast_furnace", "minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:iron_ingot", count: 8 }], fuelRequired: 0, foodRequired: 0, workTicks: 240 },
  { id: "iron_ingot", output: "minecraft:iron_ingot", outputCount: 1, workshop: "smelter", station: ["minecraft:furnace", "minecraft:blast_furnace"], machine: "minecraft:blast_furnace", inputs: [{ itemId: "minecraft:raw_iron", count: 1 }], fuelRequired: 1, foodRequired: 0, workTicks: 200 },
  { id: "copper_ingot", output: "minecraft:copper_ingot", outputCount: 1, workshop: "smelter", station: ["minecraft:furnace", "minecraft:blast_furnace"], machine: "minecraft:blast_furnace", inputs: [{ itemId: "minecraft:raw_copper", count: 1 }], fuelRequired: 1, foodRequired: 0, workTicks: 200 },
  { id: "gold_ingot", output: "minecraft:gold_ingot", outputCount: 1, workshop: "smelter", station: ["minecraft:furnace", "minecraft:blast_furnace"], machine: "minecraft:blast_furnace", inputs: [{ itemId: "minecraft:raw_gold", count: 1 }], fuelRequired: 1, foodRequired: 0, workTicks: 200 },
  { id: "iron_nugget", output: "minecraft:iron_nugget", outputCount: 9, workshop: "toolsmith", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:iron_ingot", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 40 },
  { id: "lantern", output: "minecraft:lantern", outputCount: 1, workshop: "toolsmith", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:iron_nugget", count: 8 }, { itemId: "minecraft:torch", count: 1 }], fuelRequired: 0, foodRequired: 0, workTicks: 120 },
  { id: "bread", output: "minecraft:bread", outputCount: 1, workshop: "cook", station: ["minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:wheat", count: 3 }], fuelRequired: 0, foodRequired: 0, workTicks: 80 },
  { id: "baked_potato", output: "minecraft:baked_potato", outputCount: 1, workshop: "cook", station: ["minecraft:furnace", "minecraft:smoker", "minecraft:campfire"], machine: "minecraft:smoker", inputs: [{ itemId: "minecraft:potato", count: 1 }], fuelRequired: 1, foodRequired: 0, workTicks: 120 },
  { id: "cooked_beef", output: "minecraft:cooked_beef", outputCount: 1, workshop: "butcher", station: ["minecraft:smoker"], machine: "minecraft:smoker", inputs: [{ itemId: "minecraft:beef", count: 1 }], fuelRequired: 1, foodRequired: 0, workTicks: 120 },
  { id: "cobblestone_wall", output: "minecraft:cobblestone_wall", outputCount: 6, workshop: "mason", station: ["minecraft:stonecutter", "minecraft:stonecutter_block"], machine: null, inputs: [{ itemId: "minecraft:cobblestone", count: 6 }], fuelRequired: 0, foodRequired: 0, workTicks: 120 },
  { id: "stone_bricks", output: "minecraft:stone_bricks", outputCount: 4, workshop: "mason", station: ["minecraft:stonecutter", "minecraft:stonecutter_block", "minecraft:crafting_table"], machine: null, inputs: [{ itemId: "minecraft:stone", count: 4 }], fuelRequired: 0, foodRequired: 0, workTicks: 100 }
];

export function findByOutput(itemId) {
  return RECIPES.find(r => r.output === itemId);
}
export function get(id) {
  return RECIPES.find(r => r.id === id);
}

// material need for an order of `qty` outputs (batch = outputCount)
export function materialNeed(recipe, qty) {
  const cycles = Math.max(1, Math.ceil(qty / recipe.outputCount));
  return {
    cycles,
    produced: cycles * recipe.outputCount, // may exceed qty => surplus to depot
    items: recipe.inputs.map(inp => ({ itemId: inp.itemId, count: inp.count * cycles, alternatives: inp.alternatives }))
  };
}
