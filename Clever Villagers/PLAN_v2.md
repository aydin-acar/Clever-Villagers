# Clever Villagers v2.1 — Yaşayan Köy Ekonomisi, Meslek Zinciri ve Üretim Planı (REVİZE)

> Bu belge PLAN_v2.0'ın **revizesidir**: çelişkiler çözüldü (A1-A5), mantık hataları düzeltildi (B1-B6),
> Bedrock riskleri karara bağlandı (C1-C5), tekrarlar tek kaynakta birleştirildi (bilgi kaybı yok),
> ertelenen sistemler tüm spesifikasyonlarıyla Ek-A'ya taşındı. Sürüm geçmişi ve gerekçeler: §25 Karar Logu.
> Temel: Clever Villagers **v1.4.3** (duvar/yol/meşale/harita/sandık ekonomisi çalışır durumda).
> Hedef: Bedrock **26.50+**, `@minecraft/server 2.10.0` stable, deneysel özellik YOK, **cheats kapalı dünyalarda çalışır**.

---

## 0. Temel Tasarım İlkeleri

1. **Hayali üretim yok.** Ürün için tüm girdiler fiziksel olarak mevcut olmalı; eksikse üretim başlamaz; kısmi malzemeyle üretim yapılmaz.
2. **Her üretim bir iş emrine bağlıdır.** Köylüler rastgele üretmez; sipariş kağıdı, köy ihtiyacı (internal demand) veya atölye talebiyle başlar.
3. **Ortak depo ekonomisi.** Ham madde, yakıt, yiyecek ve ürünler kayıtlı depolarda tutulur; atölyeler depodan çeker, çıktıyı depoya/çıkış sandığına bırakır.
4. **Rezervasyon zorunludur.** Malzemeler önce rezerve edilir; aynı malzeme iki işe gitmez; rezervasyon başarısızsa iş başlamaz.
5. **Yiyecek ve yakıt üretimin parçasıdır.** Çalışan yiyecek, fırın yakıt tüketir; yoksa iş durur. **Tek tüketim kaynağı: tarif `foodRequired`** (v2.0'daki interval tabanlı çifte tüketim kaldırıldı, bkz. B3/A3 kararı §25).
6. **Her işin bir iş istasyonu vardır.** Meslek isim değil; gerçek iş bloğu/makine/sandık gerektirir.
7. **Geri bildirim şarttır.** Eksik malzeme/yiyecek/yakıt, dolu sandık, yol yok, istasyon kırık → hepsi log + rate-limitli chat.
8. **Bedrock sınırları kabul edilir.** Köylüler vanilla crafting masasını oyuncu gibi kullanamaz; üretim script tarafında **gerçek item tüketimiyle** simüle edilir.
9. **(v2.1 ek) Tek doğruluk kaynağı:** köy kimliği = v1.4 çan kaydı (`bellKey = x,y,z`). cv2 ayrı köy indeksi TUTMAZ; çan kırılırsa ekonomi de duraklar (v1 kuralı).
10. **(v2.1 ek) Savaş-testli kodu yeniden yazma:** v1.4'ün `chest.js` (rollback'li consume/hasItems), `log.js`, `config.js` desenleri cv2 çekirdeğine **taşınarak** kullanılır.
11. **(v2.1 ek) İşlem defteri (ledger):** her consume/produce/move köy shard'ına append-only yazılır; item kaybı/dup QA'sı bununla kanıtlanır.

---

## 1. Kapsam

### 1.1 Bu sürümde uygulanacak
- Köy ortak deposu · yiyecek deposu · yakıt deposu · inşaat deposu
- Atölye giriş/çıkış/sipariş sandıkları · sipariş kağıdı sistemi
- Rezervasyon + courier + ledger
- Meslek zincirleri: **farmer, cook, forester, fueler, miner, smelter, toolsmith, weaponsmith, armorer, mason, butcher**
- Ham madde toplama, madencilik (quarry zone), odun üretimi, eritme, alet/silah/zırh, inşaat malzemesi, yiyecek üretimi
- v1.4 duvar/yol/meşale sistemleriyle **construction bridge** entegrasyonu
- Geri bildirim: log, rate-limitli chat, actionbar, paper lore, partikül/ses

### 1.2 Ertelenen sistemler (spesifikasyonları korunur → Ek-A)
Shepherd · Leatherworker · Cartographer · Librarian/Order-Clerk · Fisherman · Warehouse-Keeper **rolü** (otomatik cache doğrulaması MVP'de yeter) · Report paper · Miner Mod-B (yerleştirilmiş blok madenciliği) · Potion/cleric ekonomisi · otomatik hayvan çiftliği · köyler arası ticaret · gelişmiş büyü/kitap · otomatik maden arama.

---

## 2. Veri Modeli (VillageCore)

```js
VillageCore {
  id: string,              // == v1 bellKey "x,y,z"  (v2.1: tek kaynak, A5)
  bellPos: Vector,
  bounds: VillageBounds,   // v1.4 outline rect'leri (wallRect/coreRect)
  depots: Map<DepotType, DepotData>,   // warehouse | food | fuel | construction
  workshops: Map<WorkshopId, WorkshopData>,
  workers: Map<EntityId, WorkerData>,
  orders: Map<OrderId, OrderData>,
  reservations: Map<ReservationId, ReservationData>,
  stockCache: Map<DepotType, Map<ItemId, {physical, reserved}>>,
  ledger: RingBuffer,      // v2.1: append-only işlem defteri (§18.4)
  flags: VillageFlags,
  log: RingBuffer
}
```

```js
VillageFlags {
  economyEnabled: true, warehouseEnabled: true, craftingEnabled: true,
  smeltingEnabled: true, miningEnabled: false,   // oyuncu açar (Karar-3)
  forestryEnabled: true, courierEnabled: true,
  constructionIntegration: true, verboseChat: false, verboseLog: true
}
```

```js
DepotData { id, type, blocks: BlockLocation[], cache: Map<ItemId,{physical,reserved}> }
// available = physical - reserved   (§19.3)
```

```js
WorkshopData {
  id, type: WorkshopType, profession: string,
  jobBlock: BlockLocation,
  machineBlocks: BlockLocation[],        // furnace/blast_furnace/crafting_table/smithing_table/stonecutter/smoker/grindstone...
  inputChest: BlockLocation|null, outputChest: BlockLocation|null,
  orderChest: BlockLocation|null, fuelChest: BlockLocation|null,
  assignedWorkers: EntityId[], activeOrders: OrderId[],   // aynı anda TEK aktif üretim (sıralı paylaşım)
  state: "idle"|"waiting_materials"|"waiting_food"|"waiting_fuel"|"waiting_worker"|"working"|"blocked_output_full"|"station_invalid"
}
```

```js
WorkerData {
  entityId, profession, role: WorkerRole,
  homeBed: BlockLocation|null, homeChest: BlockLocation|null,
  currentWorkshop: WorkshopId|null,
  carryManifest: { items:[{itemId,count}], reservationId, leg:"to_workshop"|"to_depot"|null },  // v2.1 B5: reload'da kayıp/dup önlemi
  foodLevel: number, state: WorkerState,
  actionCount: number      // food tüketimi TARİF bazlıdır; bu sayaç sadece istatistik
}
```

```js
OrderData {
  id, itemId, quantity, requester: "player"|"village"|"workshop",
  workshopType: WorkshopType|null, status: OrderStatus,
  materials: RecipeInput[], fuelRequired, foodRequired,
  reservedId: ReservationId|null, parentDemandId: OrderId|null,   // alt-demand zinciri (§10)
  createdAtTick, updatedAtTick, failureReason: string|null
}
type OrderStatus = "draft"|"validating"|"waiting_materials"|"waiting_food"|"waiting_fuel"
  |"waiting_worker"|"reserved"|"in_progress"|"completed"|"failed"|"cancelled"|"suspended_no_paper"
```

```js
ReservationData { id, orderId, items:[{itemId,count}], fuel, food,
  sourceDepot: DepotType, targetWorkshop: WorkshopId,
  state: "pending"|"transporting"|"delivered"|"failed"|"released", createdAtTick }
```

---

## 3. Depo Sistemi

### 3.1 Türler ve tipik içerik
- **Ana depo (warehouse):** cobblestone, stone, raw_iron/copper/gold, iron/copper/gold_ingot, coal, charcoal, stick, planks, log, leather, string, feather, flint, paper, torch, lantern, wall blokları.
- **Yiyecek deposu (food):** bread, carrot, potato, baked_potato, beetroot, cooked_beef/porkchop/chicken/mutton/cod/salmon.
- **Yakıt deposu (fuel):** coal, charcoal, coal_block, lava_bucket, dried_kelp_block, planks, stick.
- **İnşaat deposu (construction):** cobblestone_wall, torch, lantern, fence_gate, fence, gravel, dirt, stone_bricks. *(v1.4 inşaat sandığı bu deponun fiziksel bloğu olarak devam eder — bridge §14.)*

### 3.2 Kayıt komutları (custom command, cheats kapalı uyumlu — A1)
`/cv:warehouse add` · `/cv:food add` · `/cv:fuel add` · `/cv:construction add`
Oyuncu sandık/varile **bakarken** çalıştırır; blok depo listesine eklenir. Çan kayıtlıysa ve hiç depo yoksa çan yanına otomatik chest/barrel konur (v1 `ensureChest` deseni). Önerilen görsel isimler: "Köy Ortak Deposu", "Köy Yiyecek Deposu", "Köy Yakıt Deposu", "Köy İnşaat Deposu".

### 3.3 Tarama planı
- Hafif cache: 20 tick'te bir (dirty konteynerler).
- Tam tarama: 200 tick'te bir (round-robin depo).
- `containerOpen/Close`, `playerBreakBlock`, rezervasyon, üretim tamamı → anında invalidate.
- Rezervasyon varsa cache zorunlu taze.

### 3.4 Kurallar
1. Depo dışındaki sandıklar ekonomiye dahil değildir.
2. Stok sayımı yalnız kayıtlı fiziksel bloklardan.
3. Rezerve malzeme available stoktan düşer.
4. Oyuncu rezerve malzemeyi alırsa → rezervasyon `failed`, sipariş `waiting_materials`, log (reason: `reserved_items_missing`).
5. Depo/çıkış doluysa teslim yapılamaz → üretim `completed` sayılmaz (`blocked_output_full`).

---

## 4. Rezervasyon Sistemi

### 4.1 Akış
```
Sipariş oluştur → malzeme listesi → depo stoğu kontrol → yeterliyse rezervasyon
→ available düş → courier taşıdı → atölye giriş sandığı doğrula → üretim
→ ürün çıktı/depo → rezervasyon released
```

### 4.2 Kurallar
- Rezervasyonsuz üretim başlamaz.
- Rezervasyon kurulamazsa sipariş `waiting_materials` (+ failureReason "missing: Nx item").
- Courier taşıyamazsa rezervasyon `failed` (malzeme depoda kalır, dup yok).
- Atölye girişinde malzeme eksilirse üretim durur.
- İptalde taşınmış malzeme mümkünse depoya iade (carry manifest üzerinden, §12.3).

---

## 5. Sipariş Kağıdı (Order Paper)

### 5.1 Custom item (RP+BP json, toolkit precedansı)
```json
"cv:order_paper": { "minecraft:item": { "description": { "identifier": "cv:order_paper",
  "menu_category": { "category": "items" } },
  "components": { "minecraft:icon": { "textures": { "default": "paper" } },
    "minecraft:display_name": { "value": "Sipariş Kağıdı" }, "minecraft:max_stack_size": 1 } } }
```
Yalnızca komutla verilir; normal paper'dan sipariş doğmaz.

### 5.2 Taşıdığı veri (C1 kararı: registry birincil, lore insan-okunur)
- **Birincil kaynak:** köy shard'ındaki `orders` kaydı (orderId = `o_<tick>_<rand>`).
- Kağıt üzerinde: `nameTag = "Sipariş #<id>"` + lore satırları (ürün, miktar, atölye, durum, eksik).
- ItemStack dynamic property **opsiyonel zenginleştirme**: `try { stack.setDynamicProperty("cv:orderId", id) } catch {}` — yoksa lore parse fallback (spike C1 kapatıldı: tasarım registry-merkezli, risk yok).
- Lore örnek:
  ```
  Sipariş Kağıdı
  Atölye: Toolsmith · Ürün: stone_pickaxe · Miktar: 10
  Durum: Bekliyor · Eksik: 6x stick
  ```

### 5.3 Sipariş oluşturma
`/cv:order give <workshop> <item> <qty>` → kağıt oyuncuya verilir → oyuncu atölyenin **sipariş sandığına** koyar.
Örnekler: `toolsmith stone_pickaxe 10` · `weaponsmith iron_sword 3` · `armorer iron_chestplate 2` · `mason cobblestone_wall 64` · `cook bread 20`.

### 5.4 Sipariş sandığı taraması (40 tick)
1. Konteynerde `cv:order_paper` var mı? 2. orderId çözülebiliyor mu (property→lore)? 3. Sipariş kayıtlı mı? 4. Başka sandığa taşınmış mı (çift kayıt engeli)? 5. Kağıt çıkarılmış mı?
- Kağıt çıkarılırsa sipariş **iptal olmaz**, `suspended_no_paper`; geri konunca devam.
- Bir sandıkta birden fazla kağıt olabilir.

### 5.5 Doğrulama (sipariş okununca)
1 item id geçerli · 2 tarif var · 3 tarif-atölye eşleşmesi · 4 köyde atölye kayıtlı · 5 job/machine bloğu sağlam · 6 **çalışan var mı? → yoksa invalid DEĞİL, `waiting_worker` + uyarı (B2)** · 7 malzeme depoda · 8 yiyecek · 9 yakıt · 10 çıkışta yer.
Başarısız her madde `failureReason` + log + lore güncellemesi.

---

## 6. Tarif Registry (tek kaynak — v2.0 §6+§34+§57 birleşimi)

### 6.1 Şema
```js
Recipe { id, output: ItemId, outputCount, workshop: WorkshopType,
  station: BlockId[], machine: BlockId|null,
  inputs: RecipeInput[], fuelRequired: number, foodRequired: number, workTicks: number,
  allowedProfessions: string[] }
RecipeInput { itemId, count, alternatives?: ItemId[] }   // rezervasyonda stoktaki alternatif seçilir
```

### 6.2 Doğrulama (sipariş başına bir kez)
recipe id var · output/input id'leri **vanilla-data 1.26.51 MinecraftItemTypes** ile derleme-zamanı kontrol (C4) · workshop tipi · station köyde · machine var · fuel gerekiyorsa fuel depot · food gerekiyorsa food depot.

### 6.3 Tam tarif listesi (güncellenmiş: torch→forester (A2), iron_nugget→toolsmith/crafting (B-not), food tekilleşti)
```json
[
 { "id":"planks", "output":"minecraft:oak_planks", "outputCount":4, "workshop":"forester",
   "station":["minecraft:crafting_table"], "machine":null,
   "inputs":[{"itemId":"minecraft:oak_log","count":1}], "fuelRequired":0, "foodRequired":1, "workTicks":40 },
 { "id":"stick", "output":"minecraft:stick", "outputCount":4, "workshop":"forester",
   "station":["minecraft:crafting_table"], "inputs":[{"itemId":"minecraft:oak_planks","count":2}],
   "fuelRequired":0, "foodRequired":1, "workTicks":40 },
 { "id":"torch", "output":"minecraft:torch", "outputCount":4, "workshop":"forester",
   "station":["minecraft:crafting_table"],
   "inputs":[{"itemId":"minecraft:stick","count":1},
              {"itemId":"minecraft:coal","count":1,"alternatives":["minecraft:charcoal"]}],
   "fuelRequired":0, "foodRequired":1, "workTicks":60 },
 { "id":"charcoal", "output":"minecraft:charcoal", "outputCount":1, "workshop":"fueler",
   "station":["minecraft:furnace"], "machine":"minecraft:furnace",
   "inputs":[{"itemId":"minecraft:oak_log","count":1}], "fuelRequired":1, "foodRequired":1, "workTicks":200 },
 { "id":"stone_pickaxe", "output":"minecraft:stone_pickaxe", "outputCount":1, "workshop":"toolsmith",
   "station":["minecraft:crafting_table"],
   "inputs":[{"itemId":"minecraft:cobblestone","count":3},{"itemId":"minecraft:stick","count":2}],
   "fuelRequired":0, "foodRequired":1, "workTicks":100 },
 { "id":"iron_pickaxe", "output":"minecraft:iron_pickaxe", "outputCount":1, "workshop":"toolsmith",
   "station":["minecraft:crafting_table","minecraft:smithing_table"],
   "inputs":[{"itemId":"minecraft:iron_ingot","count":3},{"itemId":"minecraft:stick","count":2}],
   "fuelRequired":0, "foodRequired":1, "workTicks":160 },
 { "id":"iron_sword", "output":"minecraft:iron_sword", "outputCount":1, "workshop":"weaponsmith",
   "station":["minecraft:crafting_table","minecraft:grindstone"],
   "inputs":[{"itemId":"minecraft:iron_ingot","count":2},{"itemId":"minecraft:stick","count":1}],
   "fuelRequired":0, "foodRequired":1, "workTicks":140 },
 { "id":"iron_chestplate", "output":"minecraft:iron_chestplate", "outputCount":1, "workshop":"armorer",
   "station":["minecraft:blast_furnace","minecraft:crafting_table"],
   "inputs":[{"itemId":"minecraft:iron_ingot","count":8}], "fuelRequired":0, "foodRequired":1, "workTicks":240 },
 { "id":"iron_ingot", "output":"minecraft:iron_ingot", "outputCount":1, "workshop":"smelter",
   "station":["minecraft:furnace","minecraft:blast_furnace"], "machine":"minecraft:blast_furnace",
   "inputs":[{"itemId":"minecraft:raw_iron","count":1}], "fuelRequired":1, "foodRequired":1, "workTicks":200 },
 { "id":"copper_ingot", "output":"minecraft:copper_ingot", "outputCount":1, "workshop":"smelter",
   "station":["minecraft:furnace","minecraft:blast_furnace"], "machine":"minecraft:blast_furnace",
   "inputs":[{"itemId":"minecraft:raw_copper","count":1}], "fuelRequired":1, "foodRequired":1, "workTicks":200 },
 { "id":"gold_ingot", "output":"minecraft:gold_ingot", "outputCount":1, "workshop":"smelter",
   "station":["minecraft:furnace","minecraft:blast_furnace"], "machine":"minecraft:blast_furnace",
   "inputs":[{"itemId":"minecraft:raw_gold","count":1}], "fuelRequired":1, "foodRequired":1, "workTicks":200 },
 { "id":"iron_nugget", "output":"minecraft:iron_nugget", "outputCount":9, "workshop":"toolsmith",
   "station":["minecraft:crafting_table"], "inputs":[{"itemId":"minecraft:iron_ingot","count":1}],
   "fuelRequired":0, "foodRequired":1, "workTicks":40 },
 { "id":"lantern", "output":"minecraft:lantern", "outputCount":1, "workshop":"toolsmith",
   "station":["minecraft:crafting_table"],
   "inputs":[{"itemId":"minecraft:iron_nugget","count":8},{"itemId":"minecraft:torch","count":1}],
   "fuelRequired":0, "foodRequired":1, "workTicks":120 },
 { "id":"bread", "output":"minecraft:bread", "outputCount":1, "workshop":"cook",
   "station":["minecraft:crafting_table"], "inputs":[{"itemId":"minecraft:wheat","count":3}],
   "fuelRequired":0, "foodRequired":0, "workTicks":80 },
 { "id":"baked_potato", "output":"minecraft:baked_potato", "outputCount":1, "workshop":"cook",
   "station":["minecraft:furnace","minecraft:smoker","minecraft:campfire"], "machine":"minecraft:smoker",
   "inputs":[{"itemId":"minecraft:potato","count":1}], "fuelRequired":1, "foodRequired":0, "workTicks":120 },
 { "id":"cooked_beef", "output":"minecraft:cooked_beef", "outputCount":1, "workshop":"butcher",
   "station":["minecraft:smoker"], "machine":"minecraft:smoker",
   "inputs":[{"itemId":"minecraft:beef","count":1}], "fuelRequired":1, "foodRequired":1, "workTicks":120 },
 { "id":"cobblestone_wall", "output":"minecraft:cobblestone_wall", "outputCount":6, "workshop":"mason",
   "station":["minecraft:stonecutter","minecraft:stonecutter_block"],
   "inputs":[{"itemId":"minecraft:cobblestone","count":6}], "fuelRequired":0, "foodRequired":1, "workTicks":120 },
 { "id":"stone_bricks", "output":"minecraft:stone_bricks", "outputCount":4, "workshop":"mason",
   "station":["minecraft:stonecutter","minecraft:stonecutter_block","minecraft:crafting_table"],
   "inputs":[{"itemId":"minecraft:stone","count":4}], "fuelRequired":0, "foodRequired":1, "workTicks":100 }
]
```
*(Ok/yay, wool/halı, map, book, potion tarifleri Ek-A'da kendi meslekleriyle birlikte durur.)*
---

## 7. Meslekler, Roller ve Atölye Spesifikasyonları
*(v2.0 §7+§8+§9+§12+§18+§53 tek kaynakta birleştirildi; ertelenenler Ek-A'da)*

### 7.1 Rol modeli
- **Vanilla profession** (job-site bloğuyla): farmer, toolsmith, weaponsmith, armorer, mason, butcher, cleric, librarian, cartographer, fisherman, fletcher, leatherworker, shepherd, nitwit, unemployed.
- **Internal role** (dynamic property `cv2_role` + görsel: isim etiketi/head/partikül): miner, forester, fueler, courier, cook, builder, (smelter = toolsmith/armorer/weaponsmith üzerine bindirilebilir).
- Atama: `/cv:role assign <role>` / `/cv:role clear` (OP). Vanilla profession uygunsa önceliklidir; bir köylü aynı anda TEK işte; istasyon bozulursa `station_invalid`; aynı istasyonu birden çok köylü paylaşabilir ama üretim **sırayla** (workshop.activeOrders tekil).

### 7.2 Meslek kartları (girdi→işlem→çıktı→zorunluluk→geri bildirim)

**Farmer** — İstasyon: composter + farmland alanı (+yakında food depot). Girdi: seeds/wheat/carrot/potato/beetroot (bone_meal opsiyonel). İşlem: tarlaya gider, boş farmland'a eker, olgun ürünü toplar, carry limitine kadar alır, food depot/ana depoya bırakır. Çıktı: wheat, carrot, potato, beetroot, seeds, fazla ürün→food depot. Zorunluluk: geçerli farmland, tohum, erişim, yiyecek stoğu. FB: "Çiftçi 6 wheat hasat etti." / "Tohum yok, ekim durdu." / "Yiyecek deposu dolu."

**Forester** — İstasyon: crafting_table + chest/barrel + (ops.) forestry zone. Girdi: axe, sapling(op), food. İşlem: yalnız işaretli orman alanındaki/köyün diktiği ağaçları keser, yerine sapling diker (yoksa dikmez), log→plank→stick→(coal/charcoal ile) torch üretir, depoya bırakır. Çıktı: log, planks, stick, sapling, apple(op), torch. Zorunluluk: zone tanımlı, gerçek log, erişim. FB: "Forester 8 oak_log topladı." / "Sapling yok, yeniden dikim yapılamıyor." / "Torch üretimi tamamlandı."

**Fueler** — İstasyon: furnace/smoker/campfire(op) + fuel depot. Girdi: log, coal, kelp. İşlem: fuel depot hedefin altındaysa log→charcoal, kelp→dried_kelp_block üretir, yakıt deposuna koyar. Çıktı: charcoal, coal_block(op), dried_kelp_block(op), fuel stoğu. FB: "Fueler 16 charcoal üretti." / "Yakıt deposu dolu." / "Log yok."

**Miner** — İstasyon: quarry marker (chest/barrel) + quarry zone. Girdi: pickaxe, food, torch(op). **Hardcore:** asla hayali cevher yok; yalnız quarry zone'daki **gerçek** bloklar, chunk yüklüyse, config açıksa. Çıktı: cobblestone, stone, coal, raw_iron/copper/gold, redstone(op), lapis(op), diamond(op). **Loot eşleme (B6):** stone→cobblestone, deepslate→cobbled_deepslate, coal_ore→coal, iron_ore/deepslate_iron_ore→raw_iron, copper→raw_copper, gold/deepslate_gold→raw_gold, diamond_ore→diamond, kırılan blok `block.getItemStack()` varsa önce o. FB: "Miner 12 raw_iron çıkardı." / "Quarry alanında cevher kalmadı." / "Pickaxe yok."

**Smelter** (role; toolsmith/armorer/weaponsmith üzerine binebilir) — İstasyon: furnace/blast_furnace. Girdi: raw ore + fuel. İşlem: §11 deterministik simülasyon + lit permutation görseli. Çıktı: iron/copper/gold_ingot, iron_nugget(op tarif). FB: "Smelter 8 iron_ingot üretti." / "Fuel yok, smelting durdu." / "Furnace output dolu."

**Toolsmith** — İstasyon: smithing_table veya crafting_table (+grindstone op). Girdi: stick, cobblestone, ingot'lar. Çıktı: pickaxe/axe/shovel/hoe türleri, lantern. Akış: sipariş kağıdı→tarif→rezervasyon→courier→input doğrula→üret→output. FB: "Toolsmith 10 stone_pickaxe siparişini aldı." / "20 stick eksik." / "Üretim tamamlandı."

**Weaponsmith** — İstasyon: grindstone/crafting_table(+smithing op). Girdi: stick+ingot. Çıktı: sword türleri. FB: "Weaponsmith iron_sword üretiyor." / "Iron ingot eksik."

**Armorer** — İstasyon: blast_furnace(+crafting op). Girdi: iron_ingot/leather(op)/diamond(op)+fuel. Çıktı: iron zırh seti, leather armor(op), shield(op). FB: "Armorer iron_chestplate üretiyor." / "8 iron_ingot gerekli, sadece 5 var."

**Mason** — İstasyon: stonecutter(+crafting/furnace op). Girdi: cobblestone/stone/granite/diorite/andesite/sandstone/blackstone. Çıktı: cobblestone_wall, stone_bricks, wall/polished variantları. **v1 entegrasyonu:** duvar sistemi wall isteyince yoksa mason'a internal demand (§14). FB: "Mason 64 cobblestone_wall üretti." / "Cobblestone yok, duvar üretimi bekliyor."

**Butcher** — İstasyon: smoker(+campfire op, ağıl op). Girdi: raw meat + fuel. Çıktı: cooked meat türleri→food depot, leather(op). FB: "Butcher 8 beef pişirdi." / "Raw beef yok." / "Yakıt yok."

**Cook** (role) — İstasyon: smoker/furnace/campfire + crafting_table + food chest. Girdi: wheat, raw meat, potato, fuel. İşlem: food depot hedefin altındaysa bread/baked_potato/cooked üretir, food depot'a koyar. FB: "Cook 12 bread üretti." / "Wheat yok." / "Food depot dolu."

**Builder / Construction Crew** — v1.4 duvar/yol/meşale/fener sistemlerinin kendisi (§14 bridge). Girdi: construction depot malzemesi. FB: "Duvar için 32 cobblestone_wall gerekli." / "Mason wall üretimine başladı."

**Cleric** — v1.4 heal davranışı **aynen korunur**; potion ekonomisi Ek-A.
**Nitwit/Unemployed** — hauler/courier yardımcısı/composter işçisi/tarla taşıyıcısı (nitwit); courier/hauler/construction helper (unemployed).

### 7.3 Atölye yerleşim şablonları
- Toolsmith: `[smithing_table][input chest] / [output chest][workspace]`
- Smelter: `[blast_furnace][input chest] / [fuel chest][output chest]`
- Cook: `[smoker/furnace/campfire][crafting_table][food chest]`
- Mason: `[stonecutter][input chest][output chest]`(+crafting op)
- Kayıt: `/cv:workshop add <type>` — oyuncu iş bloğuna bakarken; sistem 8 blok yarıçapta crafting_table/furnace/chest arar, bulduklarını input/output **önerir**; **konteyner yoksa kendisi KOYMAZ, oyuncudan ister** (hardcore ilke).

---

## 8. Worker State Machine ve Yiyecek

```text
WorkerState = idle | sleeping | walking_to_job | waiting_materials | waiting_food |
 waiting_fuel | waiting_courier | working | delivering_output | returning_home |
 starving_idle | station_invalid | path_failed
```

### 8.1 İşçi döngüsü (her worker tick)
1. Uyuyor mu → sleeping. 2. İstasyon geçerli mi → değilse station_invalid. 3. Yiyecek var mı → yoksa starving_idle. 4. Atölyede aktif iş var mı → yoksa idle. 5. Malzeme input chest'ta mı → yoksa waiting_materials/waiting_courier. 6. Yakıt gerekiyorsa var mı → waiting_fuel. 7. Output uygun mu → blocked_output_full. 8. Çalışma animasyonu (§16.4). 9. workTicks bekle. 10. Malzemeyi tüket. 11. Output üret. 12. Teslim et.

### 8.2 Karar mekanizması (iş döngüsü başı, v2.0 §14 korunur)
chunk loaded → köylü hayatta → gece/uyku → istasyon geçerli → yol/erişim (mesafeseldir, pathfinding API yok — §12.4) → yiyecek → yakıt → sipariş → tarif doğrulandı → malzeme depoda → rezervasyon → courier teslim → input eksiksiz → output yer → başlat. **Her başarısız madde log + failureReason.**

### 8.3 Yiyecek (tek kaynak kuralı — A3/B1)
- Tüketim **yalnızca tarif `foodRequired`** üzerinden, üretim başına.
- Kaynak önceliği: 1) köylünün envanteri 2) ev sandığı (`homeChest`, yatağa yakın) 3) köy food depot.
- Üçü de yoksa `starving_idle` + sipariş `waiting_food` + FB "[CV] Toolsmith çalışamıyor: yiyecek yok."
- Food depot girdileri: farmer, cook, butcher (+Ek-A: fisherman, shepherd op, courier transferleri).

---

## 9. Üretim Akışları ve Kanonik Örnekler
*(v2.0 §10+§27+§28+§43+§60 tek anlatımda birleştirildi — içerik korunur)*

### 9.1 Bakır zinciri (kullanıcının örnek senaryosu)
Miner raw_copper → depo → smelter rezervasyonu → courier input+fuel taşıdı → furnace/blast'a konur → simülasyon timer → copper_ingot → courier/worker depoya geri → cache güncelle → log+chat.
**Hardcore kontrol:** raw_copper yoksa ingot yok; fuel yoksa smelt yok; furnace yoksa durur; output doluysa tamamlanmaz.
Kullanım alanları: copper block, copper bulb, copper door/trapdoor(op), ileride copper tools.

### 9.2 Demir zinciri
Miner raw_iron → Smelter (1 raw + 1 fuel unit) → iron_ingot → Toolsmith/Weaponsmith/Armorer rezervasyonları → ürünler.
1 iron_pickaxe BOM: 3 iron_ingot + 2 stick ⇒ 3 raw_iron + 3 fuel + (2 stick = 1 plank = ¼ log) + 1 food.

### 9.3 10x stone_pickaxe siparişi (kanonik test)
BOM: 30 cobblestone + 20 stick. Stick zinciri: 20 stick = 5×recipe(2 plank→4 stick) = 10 plank = **3 log** (3 log = 12 plank). Toplam ham: 30 cobblestone + 3 log + **10 food unit** (tarif başına 1 × 10 üretim — B1 düzeltmesi).
Akış: kağıt order chest'a → doğrulama → stok/yoksa alt-demand (log→forester) → rezervasyon → courier → 10 üretim döngüsü (her döngüde 3 cobble+2 stick tüketilir) → output → kağıt lore "Tamamlandı".

### 9.4 Yiyecek akışı
Farmer wheat → depo → Cook (3 wheat→1 bread) → food depot → workers tüketir (§8.3).

### 9.5 Duvar malzemesi akışı (v1 bridge)
Duvar ihtiyacı N cobblestone_wall → construction depot ≥ N? tüket : internal demand(mason) → mason cobblestone ister → yoksa miner demand / player demand notu → üretim → depoya → duvar devam.

### 9.6 Tam köy döngüsü (narrative özet)
`/cv:setup` (çana bak) → köy çekirdeği + inşaat sandığı + ilk rapor → depoları ekle (`warehouse/food/fuel/construction add`) → atölyeleri ekle (`workshop add ...`) → sipariş ver (`order give ...`) → kağıdı order chest'a koy → zincirler çalışır → `/cv:status` ile izleyip `/cv:stock` ile denetle.

---

## 10. Internal Demand (köyün kendi siparişleri)
Kaynaklar: construction bridge, workshop'lar, food sistemi, fuel sistemi, courier sistemi.
Örnek: `Construction needs 32 torch → depoda 12 → internal demand 20 torch → forester recipe validate → stick/coal eksikse alt-demand`.
Alt-demand zinciri: her alt demand ayrı takip, üst demand'a bağlı (`parentDemandId`); üst iptal olursa altlar `cancelled`.

---

## 11. Eritme (Smelting) — C4/B4 kararı: deterministik simülasyon + görsel lit-state
1. Input+fuel rezervasyonu → courier input/fuel chest'a taşır.
2. Worker input+fuel'u makine konteynerine koyar (fiziksel).
3. **Simülasyon timer** başlar (`smeltTicksPerItem=200`); görsel için blok `lit_furnace`/`lit_blast_furnace`/`lit_smoker` permutation'ına çevrilir, bitince geri.
4. Timer sonunda output konteynerde yer varsa üretilir (input+fuel bu anda tüketilmiş sayılır — başta tüketildi); yer yoksa `blocked_output_full`, malzeme kaybolmaz.
**Fuel unit tablosu:** coal 8 · charcoal 8 · coal_block 80 · lava_bucket 100 · dried_kelp_block 80 · planks 1 · stick 1. Her smelt 1 fuel unit.
**Kural:** input ve fuel gerçekten tüketilmeden output ASLA verilmez.

---

## 12. Courier (nakliye) — B3 hibrit hareket kararı
### 12.1 Görevler
Depo→atölye input · atölye output→ana depo · food depot→worker home chest(op) · fuel depot→smelter fuel chest.
### 12.2 Adaylar
unemployed · nitwit · istasyonu bozulmuş köylüler · `/cv:role assign courier`.
### 12.3 Taşıma
`carryLimit = 3 stack` (config); büyük rezervasyon çok turlu. **Carry manifest** worker shard'ında: reload'da ya hedefe teslim ya depoya iade (dup/kayıp yok, B5).
### 12.4 Hareket (v1 travmasından dersle)
- Impulse **yalnız** mesafe >4 blokken ve **40 tick'te bir, 0.15** büyüklüğünde (yürüme bozulmasın).
- Teslim/alım **yalnız varışta** (≤2 blok) — v1 "build-on-arrival" deseni.
- Bacak başına `courierPathTimeoutTicks=200` aşılırsa `path_failed` (log + rezervasyon failed + order waiting_materials).
- Uzun mesafede ara depo önerisi (config op).
### 12.5 Hata durumları
source_container_missing · target_container_missing · target_container_full · reservation_expired · path_failed · entity_died (manifest iade) · chunk_unloaded (görev dondur, chunk gelince devam).

---

## 13. Bölge İşaretleri (quarry / forest)
`/cv:quarry pos1|pos2|enable|disable` · `/cv:forest pos1|pos2|enable|disable` (OP).
Bölgeler köy shard'ında saklanır; miner/forester yalnız bölge içinde çalışır; bölge yoksa ilgili rol pasif + FB.

---

## 14. v1.4 Entegrasyonu (Construction Bridge) — §59 güncel gerçekle senkron (A4)
### 14.1 Korunan v1.4.3 davranışları
çan kaydı (yalnız bell add) · tek sıra duvar + suda 5 toprak dolgu · tek kapı/yol-grubu + enine cardinal · köşe fenerleri · spacing meşale · basamaklı outline + delik doldurma · yön dalgaları harita · bounds parıltı on/off · not kağıdı (updateNote) · **impulse'suz doğal crew** · early boost · chunk-yüklü çan koruması · consume all-or-nothing (rollback'li) · yol standardı v2 (3 genişlik, kapı önü kilit) · gece ölçüm/gündüz yakınlık meşale kuralı.
### 14.2 Değişen
- Malzeme kaynağı: İnşaat Sandığı = **construction depot'un fiziksel bloğu**; bridge `requestItem(id,n)` → depot available → consume → yoksa internal demand (mason/forester/...) → zincir.
- Not kağıdı: kalan ihtiyaç + ekonomi özeti + eksik ham madde zinciri.
- Yol: onarım ücretsiz kalır; özel yol bloğu (gravel/stone/plank boardwalk) isterse construction depot tüketir.
### 14.3 Bridge akışı
```
wall column needs 1 cobblestone_wall
→ construction depot available?  consume : internal demand(mason)
→ mason cobblestone?  produce : miner demand / player demand notu
→ malzeme gelince duvar devam
torch/lantern/gate ihtiyaçları aynı köprüden
```
---

## 15. Komutlar (tek kaynak — A1+A6 kararı: custom commands, cheats kapalı uyumlu)
Hepsi `@minecraft/server` CustomCommandRegistry (v1 deseni: startup'ta kayıt, `cheatsRequired:false`); OP gerektirenler `permissionLevel: Admin`.
**A6 (Bedrock kuralı):** add-on başına TEK komut namespace'i (`NamespaceNameError`) → ekonomi komutları da `cv:` altında.
```text
Kurulum:   /cv:setup (çana bak) · /cv:warehouse add · /cv:food add · /cv:fuel add · /cv:construction add
Atölye:    /cv:workshop add <type>|list|remove  (Sprint 2+)   (iş bloğuna bakarken)
Sipariş:   /cv:order give <workshop> <item> <qty> · list · status <id> · cancel <id>  (Sprint 2+)
Rol:       /cv:role assign <role> · clear  (Sprint 3+)          (OP)
Bölge:     /cv:quarry ... · /cv:forest ...  (Sprint 4-5+)   (OP)
Durum:     /cv:status · /cv:stock [food|fuel|construction] · /cv:workers · /cv:workshops · /cv:orders  (workers/workshops/orders Sprint 2+)
Debug:     /cv:verbose on|off · /cv:log [n] (ortak havuz) · /cv:validate   (validate: rezervasyon↔stok mutabakatı)
```
Handler iskeleti (v1 engine deseniyle — C5 düzeltmesi; `worldInitialize` satırı YOK):
```js
system.beforeEvents.startup.subscribe(ev => registerCv2Commands(ev.customCommandRegistry));
// komut callback'leri RESTRICTED moddadır: blok/envanter yazımı system.run() içine ertelenir (v1 dersi #1)
```

---

## 16. Geri Bildirim (tek kaynak — §20+§45+§55 birleşimi)
- **Log:** `[CV][INFO|WARN|ERROR] ...` — v1 `log.js` ring buffer'ına entegre; `/cv:log [n]`, `/cv:log` aynı havuzu okur.
- **Chat:** rate-limit `chatRateLimitMs=15000` (kritik hatalar hariç). Örnekler: "Toolsmith siparişi alındı: 10x stone_pickaxe" · "Eksik malzeme: 20x stick" · "Courier malzemeyi taşıdı" · "Üretim tamamlandı" · "Yiyecek deposu boş" · "Output sandığı dolu" · "Rezervasyon başarısız" · "İş istasyonu kırılmış: toolsmith_1" · "Chunk yüklü değil, ekonomi duraklatıldı" · "Tarif doğrulanamadı: unknown_item".
- **Actionbar:** "CV2: Toolsmith çalışıyor (3/10)".
- **Paper lore:** durum + eksik + son kontrol tick'i (§5.2).
- **Partikül/ses (H2 tek elden `workerAct`):** üretim başlarken villager_happy + iş bloğuna lookAt; tamamlanınca villager_happy + `random.orb`; eksik malzemede basic_smoke; smelting boyunca lit permutation (§11).

---

## 17. Performans (tek kaynak — §21+§31.3 birleşimi)
| İş | Periyot |
|---|---|
| Ana ekonomi döngüsü (round-robin köy) | 20 tick |
| Depo hafif cache | 20 tick |
| Derin depo taraması | 200 tick |
| Sipariş kontrolü | 40 tick |
| Courier kontrolü | 20 tick |
| Worker kontrolü | 20 tick |
| Construction bridge | 40 tick |
| Log budama | 1200 tick |
Kurallar: yalnız loaded chunk'lı köyler işlenir (`isChunkLoaded`); ağır işler chunked; recipe validation yalnız sipariş değişince; container cache event-invalid; köyler round-robin (tick 0: A, 10: B, 20: C); v1 `changeBudget` ile ortak blok-değişim tavanı.

---

## 18. Kalıcılık ve Recovery
### 18.1 Sharding (32KB riski yok)
`cv:villages` (index: id, bell, dimension) · `cv:v:<id>:core|depots|orders|reservations|workers|ledger`.
### 18.2 Reload recovery adımları
index oku → core shard → depo bloklarını doğrula (kırılan düşer, log) → istasyonları doğrula → siparişleri re-validate → fizik stok cache sıfırdan tara → rezervasyonları fizik stokla mutabakatla → uyumsuzsa `failed` → **carry manifest'leri iade/teslim et (B5)** → recovery raporu log.
### 18.3 Çan kırılması (v1 kuralı)
Yalnız chunk yüklüyken ve gerçekten kırılmışsa kayıttan sil; ekonomi duraklar, veri silinmez; aynı çan yeniden kaydedilirse restore.
### 18.4 Ledger
`{tick, kind: consume|produce|move|reserve|release|deliver, items, from, to, orderId?}` — halka 512/köy; `/cv:validate` mutabakatı: Σ(produce+in)−Σ(consume+out) == physical−reserved.

---

## 19. Konteyner İşlemleri (v1 chest.js'ten taşınır + genişletilir)
```js
countItems(container, typeId)                       // çok-yığın toplam (v1, slot-bazlı try)
canRemoveItems(container, requests)                 // all-or-nothing ön kontrol
removeItemsExact(container, requests)               // rollback'li (v1 deseni)
canAddItems(container, typeId, count)               // boş slot + stack dolgusu hesabı
addItemsSafe(container, itemType, count)            // taşanı iade eder
moveReservedItems(src, dst, requests)               // courier teslimi; partial = failed
```
Kural: **bir işlem ya tam başarılı ya hiç yapılmamış** — stick eksikse iron_ingot da alınmaz.
Depo cache'i: `physical`, `reserved`, `available = physical − reserved`.

---

## 20. Hata Kataloğu (tek kaynak — §22+§38.5+§43 failure'ları)
| Durum | Sistem tepkisi |
|---|---|
| Eksik malzeme | order `waiting_materials`, reason "missing: Nx item" |
| Eksik yiyecek | worker `starving_idle`, order `waiting_food` |
| Eksik yakıt | workshop `waiting_fuel`, order `waiting_fuel` |
| Output dolu | workshop `blocked_output_full`, üretim bekler |
| İstasyon kırık | `station_invalid`, orders paused |
| Courier yol yok | `path_failed` → reservation failed → waiting_materials |
| Oyuncu rezerve malı aldı | reservation failed → waiting_materials + log |
| Courier öldü | manifest iade (depoya), reservation released |
| Chunk unloaded | görev dondur; load olunca devam |
| Kağıt sandıktan çıktı | `suspended_no_paper` |
| Depo kırık | depot invalid, ekonomi degrade + log |

---

## 21. Mimari ve Kod İskeleti
```text
BP/scripts/cv2/
├── main.js               (startup→komutlar; ensureRuntime deseni; tek economy interval)
├── core/ village.js depot.js reservation.js recipe.js order.js worker.js courier.js
│        scheduler.js ledger.js persistence.js container_utils.js (v1 chest.js'ten)
├── jobs/ farmer.js cook.js forester.js miner.js fueler.js smelter.js toolsmith.js
│        weaponsmith.js armorer.js mason.js butcher.js courier_role.js
├── integration/ construction_bridge.js (wall/road/torch bridge)
├── ui/ order_paper.js chat_feedback.js toolkit_economy_page.js
└── commands/cv2.js
```
Scheduler (round-robin):
```js
EconomyScheduler.tick(): village = villages[i++ % n]; if(!village.isLoaded()) return;
 updateDepotCache(); processReservations(); processOrders(); processCouriers();
 processWorkers(); processConstructionBridge();
```
Manager iskeletleri (VillageManager.loadAll/getVillageByBell/createOrRestore, ReservationManager.reserve, OrderManager.processOrder, WorkerManager.tickWorker) v2.0 §56.2-56.7'deki gibi kalır; iki düzeltmeyle: (1) `worldInitialize` satırı yok, bootstrap = v1 `ensureRuntime()`; (2) OrderManager'da worker yoksa fail değil `waiting_worker`.

---

## 22. Test Matrisi (birleşik — §24+§48+§61 + v2.1 ekleri)
| Alan | Senaryo → Beklenen |
|---|---|
| Depo | ekle→cache; kır→invalid+log; oyuncu al→cache taze; çok sandık→tek depo |
| Rezervasyon | yeterli→ok; eksik→yok; oyuncu rezerve malı al→failed; iki sipariş aynı stok→ikincisi bekler |
| Üretim | tam malzeme→başlar; eksik→başlamaz+reason; yiyecek yok→çalışmaz; yakıt yok→smelt yok; output dolu→bekler; istasyon kırık→paused |
| Courier | yol açık→taşır; kapalı→path_failed; hedef dolu→delivery_failed; ölür→manifest iade |
| Reload | sipariş+rezervasyon+carry manifest korunur; cache yeniden kurulur; mutabakat temiz |
| İnşaat bridge | depoda wall var→örülür; yok cobble var→mason üretir; o da yok→miner/player beklenir; torch zinciri aynı |
| **Dup/kayıp (v2.1)** | 100 işlemden sonra `/cv:validate` mutabakatı 0 fark |
| **Yiyecek tekliği (v2.1)** | 10 üretim = tam 10 food unit tüketim |

---

## 23. Sürüm Kontrol Listesi (v2.0.0-alpha — §50+§62 birleşimi)
Core: village index property'de · reload restore · depot register · stock cache doğru · all-or-nothing utils · rezervasyon dup yaratmıyor · ledger mutabakatı temiz.
Jobs: farmer hasat+teslim · cook bread · forester log/plank/stick/torch · miner quarry-içi · smelter iron/copper · toolsmith sipariş · mason wall.
Orders: paper verilebilir · order chest okur · eksikte üretim yok · output doluda bekler · reload'da kalır.
Feedback: rate-limitli chat · log · report (polish fazı) · eksikler açık yazılı.
Integration: v1 duvarı construction depot'tan tüketir · wall yoksa mason demand · torch yoksa forester demand · mevcut not kağıdı bozulmaz · early boost korunur · **impulse'suz yürüyüş korunur**.
Başarı kriterleri (v2.0 §29 aynen): hayali üretim yok · net feedback · doğru stok · rezervasyon çakışması yok · oyuncu durma sebebini anlar · reload sağlam · v1 ile kavga yok · performans kabul edilebilir · her üretim gerçek item · köy yaşıyor hissi.

---

## 24. Sprint Planı (yeniden sıralanmış + Sprint 0 spike)
**Sprint 0 — Spike & karar doğrulama (C listesi kapatıldı; kalan doğrulamalar):** ItemStack dynProp var mı (opsiyonel kalır) · lit_furnace permutation görseli · `/scriptevent` yetki testi (A1'i teyit, custom command'da kalınacak) · tüm tarif id'lerinin vanilla-data 1.26.51 kontrolü · courier impulse prototipi (yürüme bozulması eşiği).
**Sprint 1** container_utils(v1'den)+depot+cache+`/cv:stock` · **Sprint 2** recipe registry+order state+order paper · **Sprint 3** reservation+courier+ledger · **Sprint 4** farmer→cook→food zinciri · **Sprint 5** forester zinciri+smelter · **Sprint 6** toolsmith ucu-uca (kanıt: 1 stone_pickaxe) · **Sprint 7** mason+construction bridge · **Sprint 8** polish: toolkit ekonomi sayfası, report paper, balans, sesler.
MVP tanımları (v2.0 §49) aynı kalır: M1 depo+stock · M2 farmer+food · M3 forester+stick+torch · M4 smelter · M5 order paper+toolsmith · M6 construction bridge.

---

## 25. Karar Logu (v2.0 → v2.1)
| Kod | Karar | Gerekçe |
|---|---|---|
| A1 | `/cv:*` custom command; scriptevent YOK | cheats kapalı dünyalar; permissionLevel; v1 kanıtlandı |
| A2 | torch üreticisi = forester | matris-tarif çelişkisi; stick zinciri forester'da |
| A3/B1 | food tek kaynak: tarif `foodRequired` | çifte tüketim + 10'luk sipariş math hatası |
| A4 | §entegrasyon v1.4.3 gerçeğine senkron (impulse yok, tek sıra duvar, su dolgusu...) | bayat "korunacaklar" listesi |
| A5 | village id = v1 bellKey | çift köy kaydı riski |
| B2 | worker yoksa invalid değil `waiting_worker` | atanabilirlik dinamik |
| B3 | courier hibrit hareket (seyrek impulse + varışta teslim + timeout) | v1 impulse travması |
| B4/C4 | deterministik smelt + lit permutation | stable API'de furnace progress yok |
| B5 | carry manifest persist + reload iade/teslim | dup/kayıp sıcak noktası |
| B6 | miner loot eşleme tablosu | stone→cobblestone vb. |
| C1 | order paper verisi registry+lore birincil, dynProp opsiyonel | ItemStack dynProp belirsizliği |
| C5 | cv2 main iskeleti ensureRuntime deseninde | early-execution tuzakları (v1 dersi) |
| A6 | Ekonomi komutları `cv:` namespace'inde | Bedrock: add-on başına tek namespace (NamespaceNameError, v2.0.0-alpha saha testi) |
| R1 | Toolkit tarifi `unlock` verisi aldı (clock/torch) | 1.20+ recipe şeması uyarısı |
| KES | shepherd/leatherworker/cartographer/librarian-clerk/fisherman/keeper-rolü/report-paper/miner-ModB/potion → Ek-A | kapsam disiplini; bilgi korunur |

---

## EK-A — Ertelenen Sistemler (tam spesifikasyon, uygulanınca buradan çekilir)
**Shepherd:** istasyon loom+sheep pen(op)+shears; girdi shears/wheat(op); işlem: koyun kırkma→wool→loom'da carpet/painting(op); çıktı white/renkli wool, carpet, painting; zorunluluk ≥1 koyun+shears+loom; FB "Çoban 2 wool topladı"/"Koyun yok".
**Leatherworker:** istasyon cauldron(+crafting op); girdi leather/rabbit_hide(op)/string(op); çıktı leather zırh seti, horse armor(op), item_frame(op); FB "Leatherworker leather_chestplate üretti"/"Leather yok".
**Cartographer:** istasyon cartography_table; girdi paper/compass/map; çıktı empty_map/locator_map/exploration(op); FB "Cartographer harita üretiyor"/"Compass yok".
**Librarian / Order Clerk:** istasyon lectern; girdi paper/leather/sugar_cane/ink(op); çıktı paper/book/bookshelf(op)/rapor; clerk görevleri: sipariş doğrulama, eksik lore yazımı, köy raporu, recipe validation; FB "Librarian siparişi doğruladı"/"Tarif bilinmiyor".
**Fisherman:** istasyon barrel+su kaynağı(+rod op); çıktı raw_cod/salmon/tropical/puffer; şans+süre simülasyonu; FB "Balıkçı 3 raw_cod yakaladı"/"Olta olmadan çalışamıyor".
**Warehouse Keeper rolü:** cache doğrulama, stok mutabakatı, kritik stok uyarısı, depolar arası transfer talebi, rapor kağıdı ("Köy Depo Raporu: Cobblestone 342 ..."). MVP'de aynı işler otomatik+`/cv:validate` ile yapılır.
**Report paper:** `/cv:report` → lore'lu paper (ekonomi özeti). Polish fazı.
**Miner Mod-B:** oyuncunun yerleştirdiği ore/stone bloklarını kırma modu. Quarry (Mod-A) yeterli.
**Potion/Cleric ekonomisi:** brewing_stand + blaze_powder yakıt + awkward/healing/regeneration/weakness/poison(op); aşamalı faz.
**Ek tarifler:** arrow(1 flint+1 stick+1 feather→4, fletcher), bow/crossbow(op), wool ürünleri, map/book zincirleri, potion'lar.
**Hayvan yönetimi / köyler arası ticaret / gelişmiş büyü:** roadmap dışı.

---
*PLAN v2.1 — v1.4.3 üzerine inşa edilir; ilk kod hedefi değişmez: "Depodaki cobblestone+stick ile 1 stone_pickaxe" kanıtı.*
