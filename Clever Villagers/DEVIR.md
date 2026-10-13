# 🔄 DEVİR BELGESİ — Clever Villagers (Regrowth Bedrock Portu)

> Bu belge, yeni bir sohbet/oturumda projeyi **sıfırdan anlayıp devam ettirmek** için yazıldı.
> Son sürüm: **v1.4.3** · Hedef: Minecraft Bedrock **26.50+** · API: `@minecraft/server 2.10.0`, `@minecraft/server-ui 2.2.0` (stable, **deneysel özellik GEREKMEZ**)
> Orijinal: mactso/Regrowth (Java/Forge, MIT) — rapor: `rapor.md` (kullanıcıda), kaynak analizleri bu portun temelidir.

---

## 1) Kimlik & kullanıcı tercihleri
- Kullanıcı Türkçe yazar; yanıtlar Türkçe olmalı.
- TODO odaklı çalışır: bildirimler `TODO.md`'ye madde madde işlenir, durumlar ✅/⏭️ işaretlenir.
- **Tasarı felsefesi:** "köylü gerçekten yapıyor" görünümü şart — eylemler köylünün kendi konumunda/bakışında olur, uzaktan "hayali" inşa YASAK.
- Varsayılanlar: `wallsOn=false`, `roadsOn=false` (komutla açılır); çan **yalnız** `/cv:bell add` ile kaydedilir (otomatik keşif YOK).
- Hata ayıklama: `/cv:log [n]` (ring buffer 240) + console.warn → Windows content.log.

## 2) Paket yapısı
```
Clever Villagers/
├── CleverVillagers_BP/
│   ├── manifest.json            (script module, deps: server 2.10.0, server-ui 2.2.0, RP uuid)
│   ├── pack_icon.png
│   ├── items/cv_toolkit.json   (format 1.26.30, icon object-form)
│   ├── recipes/cv_toolkit.json (clock+torch shapeless)
│   └── scripts/
│       ├── main.js       giriş: startup→komutlar, ensureRuntime, scriptError trap
│       ├── engine.js     bootstrap(ensureRuntime), 20t mainLoop, 12t crew/boost pass,
│       │                 scanSlice x3, boundsTick, lightingPass, doorFront task(40t), patrol(60s)
│       ├── config.js     DEFAULTS+META (dynamic property "cv:config"), bells, stats
│       ├── util.js       güvenli blok/varlık erişimi, perm önbelleği+firstPerm(legacy fallback),
│       │                 ışık (skyLight/blockLight=total-sky), jumpAway, workerAct(H2 anim),
│       │                 blok kümeleri (GRASS_PLANTS/FOUNDATION/ROAD_IDS/PROTECTED/CROPS...),
│       │                 biomeCategory, sapling/wall materyal tabloları, changeBudget
│       ├── log.js        ring buffer + info/dbg/warn + getLog
│       ├── walls.js      HARİTA+SUR: scan1(±houseSeedRadius, kot±20) → küme(6 zincir, kapı>yatak>cam)
│       │                 → yön dalgaları(N/E/S/W, tam genişlik şerit, houseWaveRadius) → finishMap
│       │                 → outline(): ev kutuları+wallOffset BİRLEŞİMİ + delik doldurma → basamaklı çevre
│       │                 → buildColumn(): TEK sıra duvar; suda 5 toprak bedava dolgu; tek kapı/yol-grubu
│       │                 (cardinal=enine); köşe=fener; spacing meşale; sandık ekonomisi(önce stok→koy→tüket)
│       │                 → crewPass(impulse YOK, doğal yürüme ±2 kolon), repairPatrol(60s, işçi≤16)
│       │                 → bounds on/off = partikül(villager_happy) çizgisi, BLOK KOYMAZ
│       ├── roads.js      YOL STANDARDI(v2): en=3 kesit çoğunluk kotu; kapı önü 3x3 @doorY-1 KİLİTLİ
│       │                 (locks dynamic prop); boyuna ≥2 fark → pas başına 1 basamak yumuşatma(rampa);
│       │                 gap-bridge(≥2 komşu medyan); 10 blok alt dolgu; roadsOn+flag r gating
│       ├── lighting.js   IZGARA aydınlatma: coreRect(houses+pad) içinde torchGrid; GECE=doğrudan ölçüm,
│       │                 GÜNDÜZ=6 blokta ışık kaynağı var mı; işçi ≤2.5 blok+lookAt; pay-after-place
│       ├── chest.js      inşaat sandığı: ensureChest(zemin ara→üstüne), hasItems/consume(çok-yığın,
│       │                 rollback), updateNote(H3 lore yerinde), warnMissing(5dk rate-limit)
│       ├── villagers.js  flag motoru: farm→h→v→c→r→w→p sırası, HEPSİ denenir; pozisyon-tabanlı
│       │                 (foot/ground/view); profesyon=job-site containsBlock; uyuyan köylü dış iş yapmaz
│       ├── mobs.js       Regrowth mob tablosu (cow both300, pig reforest450, zombie stumble30...)
│       ├── commands.js   /cv:* (help info debug pause resume flags config stats bell bounds
│       │                 roads walls toolkit log rescan) — normArgs() İLE argüman normalizasyonu
│       └── gui.js        Toolkit → ActionForm/ModalForm (OP olmayan salt-okunur)
├── CleverVillagers_RP/   pack_icon, item_texture.json, texts(en_US,tr_TR), textures/items/...
├── README_KURULUM.md · TODO.md · PLAN_v1.2.md · DEVIR.md
```

## 3) Komutlar
`help info stats log[N] toolkit bounds<on|off|dist 2-30> rescan bell<add|clear|list> walls<on|off> roads<on|off> debug<0-2> pause resume flags<chars> config[k v]`
Yetki: config/değişim komutları Admin(OP); bilgi komutları Any; `cheatsRequired:false`.

## 4) Config anahtarları (dynamic property)
enabled, wallsOn(F), roadsOn(F), debugLevel, villagerFlags("chrwvt"), workIntervalTicks40, torchLightLevel3, torchBlock, eatingHeals.99, cutFlowers F, leafDrops T, mushroomDensity6, mushroomLightLevel7, wallControlBlock(legacy), wallsAlwaysOn(legacy), wallHeight1, wallTorchEvery0(auto6), villageWallMargin10(legacy→wallOffset), wallGates T, centerGates F(legacy), houseSeedRadius50, houseClusterRadius6, houseGrowRadius60, houseWallPad2, **wallOffset10(2-30, bounds dist)**, minVillageLight1, torchGrid16, earlyBoostMinutes60, workerRadius100, constructionChest T, mobIntervalScale1, maxBlockChangesPerCycle32, onlyOverworld T, logEnabled T.

## 5) Bedrock API TUZAKLARI (bu projede kanla öğrenildi — TEKRAR DÜŞME)
1. **Custom command callback = RESTRICTED execution:** envanter/blok değişimi YAASAK → `system.run()` içine ertele.
2. **Early-execution'da yapılan subscribe/runInterval bazı derlemelerde ÇÖPE atılıyor** → tüm runtime `ensureRuntime()` ile normal modda kurulur; her komut `ok()/fail()` içinde poke eder.
3. **Argüman biçimi derlemeye göre değişir** (dizi veya spread) → `normArgs(params)`.
4. **Partikül adları:** Bedrock `villager_happy`, `basic_flame_particle`... Java `happy_villager` SESSİZCE çöker (try/catch yutar).
5. **Block-light katmanı YOK:** `blockLight ≈ max(0, total - sky)` gündüz dışarıda 0 görünür → gece ölçüm / gündüz meşale-yakınlık kuralı.
6. **Yüklü olmayan chunk:** getBlock throw → `U.getBlock` undefined; taramalar `isChunkLoaded` ile atlar; çan devriyesi chunk yüklüyken siler.
7. **26.x FLATTENED IDs:** short_grass/tall_grass(upper_block_bit)/fern/oak_sapling/oak_fence/cobblestone_wall(ayrı duvar blokları)/fence_gate(oak hâlâ `fence_gate`)... legacy için `firstPerm([[yeni],[eski state]])`.
8. **setPermutation placement kurallarını BYPASS eder** (torch havaya konabilir!) → kendi geçerlilik kontrollerin şart.
9. **Container:** getSlot(i).hasItem()/typeId/amount; setItem(undefined) slot temizler; consume tüm slotları tarar + rollback.
10. **isSolid pre-release** → kullanma; kendi solid kümen olsun.
11. **watchdog:** 12t paslarda ~20k getBlock gibi yüklerden kaçın (önbellek: unbuilt 600t, outline cache, O(1) idxOf).
12. **manifest:** BP→RP bağımlılık sürümü her bump'ta SENKRON kalmalı (yoksa "bağımlılık eksik" uyarısı).

## 6) Sürüm geçmişi (kullanıcı-doğrulamalı davranışlar)
v1.0 ilk port · v1.0.1 arg norm + bootstrap · v1.0.3 engine kendi kendini onarır · v1.1 dörtgen sur+crew · v1.2 Java mantık portu (pozisyon-tabanlı, sandık ekonomisi) · v1.3 dalga harita+log · v1.3.5 crew/ışık çıkmazı · v1.3.6 çan-silme+yüksüz-chunk+basamaklı outline · v1.3.7 tek-pas tarama+su köprü · v1.3.8 bounds off yeniden-hesap · v1.3.9 walls on/off+impulse kaldırıldı · v1.4 parıltı bounds+mühür+tek kapı · v1.4.2 yol standardı v2+kilitler · **v1.4.3 tek sıra duvar+suda 5 toprak+gerçek fener hesabı+note update+bounds dist**.
Doğrulanan çalışanlar: cleric heal, grass cut, road basic, saplings/mushrooms, zombie torch-stomple, harita+dalgalar, bounds parıltı, sandık ekonomisi, tek sıra duvar inşası (crew doğal yürümeyle).

## 7) BİLİNEN AÇIK KONULAR (yeni paket için adaylar)
- Yol motoru v2 saha testinde (kesit tesviye + rampa yakınsaması izlenmeli).
- Crew hızı = köylü doğal yürüyüşü; boost penceresi 60dk.
- Lighting işçi yarıçapı 2.5 → kırsal ızgara noktaları yavaş aydınlanır.
- performns: outline cache key zayıf (houses length+offset+join len).
- H1(çatı taraması) kullanıcı isteğiyle RAFA kaldırıldı.

## 8) Yeni oturumda devam protokolü
1. Ekleri aç: handover.zip VEYA KAYNAK_BUNDLE.txt (+ mcaddon ikililer için).
2. `TODO.md` + kullanıcının YENİ PLAN dosyasını oku; plan maddelerini TODO'ya bağla.
3. Değişiklik sonrası: node --check (ESM) + json doğrula + manifest sürüm bump + BP→RP dep senkron + mcaddon/mcpack yeniden derle (python zipfile).
4. Kullanıcıya Türkçe özet + test adımları ver; her turda `TODO.md` güncelle.

## v2.8.0 — SABİT TICK-OFFSET MODULO TUZAĞI (en sinsi bug)
`system.runInterval(fn, 20)` ile koşan bir döngüde `system.currentTick % 20 === 0`
kapısı KULLANILAMAZ: interval bir oturumda hangi tick ofsetinde kurulduysa o ofset
SABİT kalır (tick ≡ k mod 20). k ≠ 0 ise kapı ASLA ateşlemez.
Belirti: kaydet+çık+yeniden gir sonrası "motor çalışıyor, loop tick artıyor" ama
`dispatch: last=-1`, siparişler ready, nameTag'ler yok.
Kural: periyodik işler için modulo DEĞİL akümülatör kullan:
`if (tick - lastRun >= PERIOD) { lastRun = tick; ... }`.
Aynı hata lighting.js (`tick % 60 !== 0`) ve production.js (`tick % 30 === 0`
partikül) kapılarında da vardı; hepsi akümülatör/sayaç oldu.
Ek ders: villager'ın kendi envanteri (`minecraft:inventory` component'i) taşıma
modeli için kullanılabilir; slot temizlemede CU.clearSlot + read-back doğrulama
şart (setItem(undefined) bazı build'lerde sessizce yok sayılır).

## v2.9.0 — İMPULS vs VANILLA AI: "İKİ KAPTAN" YASASI (12.10 saha testi #4)
Köylünün kendi wander/pathfinding AI'ı varken ona periyodik `applyImpulse`
basmak İKİ KAPTANLI GEMİDİR: AI bir yöne yürür, impuls öbür yöne çeker →
kullanıcının gözlemi "her 2 sn'de bir ters istikamette itilme". İki sinsi
detay: (1) lighting.js'teki ÖLÜ sanılan `nudgeNearestVillager` `tick % 40`
kapısıyla koşuyordu = TAM 2 SANİYE — kullanıcı raporundaki periyodun birebir
kaynağı; "ölü kod" sanılan interval gerçekten ateşliyordu. (2) Impulse→duvara
sıkışma→rescueIfStuck→ışın zinciri "kurtarma" sayacını 4→70+'a tırmandırdı;
düz alanda bile kurtarma görülmesinin nedeni buydu.
YASA: **Hiçbir modül köylüleri impulsla YÖNLENDİREMEZ.** Hedef ver, vanilla
yürüsün; gözlemci döngü yalnızca İLERLEME ÖLÇER (400t pencere, Chebyshev).
Tek istisna: uzak hedef + 20+20+20 sn ilerlemesizlikte EN FAZLA 2 güvenli
servis hopu (teleport, hedefin ~5 blok GERİSİNE, safeStand doğrulamalı, son
yaklaşma yürüyüş) → sonra işi bırak + noGo karantinası (5 dk). Kurtarma
yalnızca GERÇEK boğulmada (ayak VE baş dolu blokta) — düz alanda imkânsız.
Tek meşru impuls: util.jumpAway (blok koyan işçinin 1 kez kenara sekmesi).

## v2.9.0 — FİZİKSEL ÜRETİMİN 5 ÖLÜMCÜL TUZAĞI
1. **BATCH ≠ ITEM:** producedCount batch, quantity item sayarsa x4 tarifler
   (tahta/çubuk/meşale) ASLA bitmez → monitor mükerrer sipariş açar. Kredi
   daima fiziken depoya giren ADET ile (ITEM birimi).
2. **Stacklenemez iteme büyük yığın İLLEGAL:** `new ItemStack("iron_pickaxe",2)`
   throw/reddedilir; addItem sessizce düşürür → eşya buharlaşır ama sipariş
   "tamamlandı" görünür. Her yığın `maxStackOf` (desen + `maxAmount` probu)
   ile bölünmeli; teslim kredisinde DOĞRULANMIŞ container→container taşıma.
3. **Konum doğrulaması olmadan "work":** depo+tezgâh bitişikse tüm bacaklar
   sandık başında koşar = SANAL üretim. Work yalnızca `atStation`
   (Chebyshev ≤3); fırın çıktısı yalnızca işçi ≤8 blokta iken çekilir.
4. **Ledger'ı başarıdan ÖNCE yazma:** consumeFromAny kısmi başarısızlıkta
   rollback yapıyordu ama consume satırları çoktan basılmıştı → hayalet
   kayıt. Kural: pendLedger listesi, tam başarıdan sonra push.
5. **Rezervasyon körlüğü:** doFetch, siparişin KENDİ rezervasyonunu
   availableSmart'tan düşülmüş görünce dar stokta ready↔waiting deadlock.
   `availForOrder` = stok + kendi rezervasyonun.
Ek: iptal/iade asimetrisi — YAŞAYAN işçinin çantası asla "iade" edilmez
(duplikasyon); yalnız ölen/kaybolan işçinin manifesti depoya döner; yaşayan
artıkları boşta-depozit angaryası taşır. abortCycle'da `workerValid` şartı.

## v2.9.0 — TEMBEL `v.orders` + ÇOCUK İŞÇİ
* `v.orders || []` HAM okumak reload sonrası YANILTIR (dizi tembel yüklenir;
  ilk geçişte boş) → monitor "hiç sipariş yok" sanır, mükerrer açar. Kural:
  ekonomi kodu listeyi DAİMA `O.listOrders(v)` üzerinden okur; item başına
  `openItem` bekçisi + createOrder(internal) mükerrer reddi + eski
  mükerrerleri iptal eden temizlik geçişi (en eski kazanır).
* Çocuk köylülere iş atamak YASAK (kullanıcı kuralı): `U.isBaby` =
  `minecraft:is_baby` component'i, yedek `type_family` içinde "baby".
  Hata durumunda ADULT say (component sekmesi tüm kadroyu pasifleştirmesin).
  Gate noktaları: jobs.awakeVillagers, engine villagerWork taraması,
  walls.crewPass, order.validateOrder işçi sayımı.
* Meslek yaşam döngüsü (kullanıcı kuralı, "çok önemli"): tarla işi yalnız
  çiftçiye; çiftçi yoksa BİR mesleksiz `cvprof:farmer` etiketiyle dönüşür;
  mesleksiz de yoksa oyuncuya "istasyon kır/kaldır" uyarısı; istasyonu
  kalkan etiketli köylü profWatchdog ile İŞSİZ havuzuna düşer (yalnız: köyde
  geçerli atölye YOK + 24 blokta marker YOK + köylü boşta; markersız etiket
  meslekleri asla silinmez; doğrulanamıyorsa ASLA düşürme) → yeni
  istasyonlara atanabilir. Döngü kendi kendini besler.

---

## v2.10.0 TUZAKLARI (S15 — "YOLADAM", ışınlanmanın kökü kazındı)

* **YUKARI TARAYAN "güvenli zemin" = çatı ışınlayıcı.** `safeStand()`
  hedeften +2/-3 dy tarıyordu; bir evin İÇİ hedeflendiğinde ayak geçerli +
  zemin sağlam bulunan İLK sütun ÇATI idi. "Güvenli" yardımcı funcionlar
  asla yukarı taramamalı: hedef sütunda zemin-öncelikli (0,-1,-2,-3, sonra
  +1..) aranmalı, o da yoksa ışınlanmamalı. path.js `standY` böyle.
* **Gerçek yürütücüsü olmayan "vanilla yol bulma" modeli çalışmaz.** Bedrock
  stable API'de moveTo/navigation YOK; "hedef ver, kendi gitsin" demek
  hedefe hiçbir zaman varamamak demek. Monitor hop/rescue ile "yardım"
  edince iki doktorlu hasta doğuyor (hops=334, kurtarma=373). Çözüm: kendi
  A* zemin yolumuz + yol boyunca adım yürütme (0.42 blk / 4t); yol yoksa
  ışınlamak yerine İŞİ BIRAK + karantina (noGo 5 dk).
* **Hayalet çanta yükü = "malzeme yok oluyor".** İptal edilen üretim
  döngüsü malzemeyi yaşayan işçinin çantasında bırakırsa: (a) depodaki
  stok bir sonraki fetch'te TEKRAR çekilir (çift tüketim), (b) çantadaki
  yük hiçbir envanter dökümünde görünmez. Kural: abort + yaşayan işçi ⇒
  manifest ANINDA doğrulanmış çanta→sandık iadesi (depositItem read-back).
* **Meslek okuması "var mı?" değil "EN YAKIN hangisi?" olmalı.** 12 blok
  yarıçaplı containsBlock + JOB_SITES sırası: dokuma tezgâhındaki çobanı
  ÇİFTÇİ yapıp tarlaya sürükledi. professionOf artık 5 blokta en yakın
  istasyona bakıyor (getBlocks, fallback containsBlock).
* **Bayat nameTag = hayalet görev.** Atama/üretim döngüsü bittiğinde etiket
  silinmezse oyuncu "depoya boşaltıyor ama hiçbir şey yapmıyor" görür ve
  (eski builds) bu etiketler eski hedeflere steer edilirmiş gibi davranırdı.
  LABEL WATCHDOG: atamasız + taşıyıcı olmayan köylünün JOB_TAGS etiketi
  her geçişte temizlenir.
* **Üreme bir ekonomi kapısıdır, rastgele değil.** Boşaltma angaryası
  çantalardaki yiyeceği süpürdüğü için vanilla isteklilik ölüyordu.
  breedingTick: günde 1 kez, akşam penceresi, food deposunda ekmek fazlası
  (≥breedMinBread), yetişkin < popCap ⇒ 2 boşta yetişkine fiziken 3 ekmek.
  Config: breedingOn / breedMinBread / popCap.
* Bölge iş=0 sessizliği: zoneGapGuide 2 dk boş bölgeden sonra rehber mesaj
  verir (ormancı/madenci için istasyon GEREKMEZ; bölge işyeridir).

## v2.11.0 "KAMPYOLU" — devir notları (tuzaklar)
* **İKİ HAREKET SİSTEMİ = ÇAKIŞMA (bu turun kök dersi).** Script, vanilla
  AI'ı da yürüyen bir köylünün konumunu yazarsa (teleport mikro-adımı bile
  olsa) iki sistem savaşır: "iki adım ileri (vanilla), iki adım geriye
  (kod)". KURAL: script köylüyü ASLA taşımaz; hareket yalnız vanilla'nın
  kendi hedef sistemiyle olur (POI claim + program). Tek istisna: gömülü
  köylünün aynı yükseklikte yana adımı (path.js unstuckBuried).
* **Bedrock köylü programı (tod):** İŞ 0–2000 & 10000–11000 (köylü claimli
  istasyonunun yanında durur), ÇAN 8000–10000, EVE 11000→, UYKU 12000→.
  İŞSİZ köylü gün boyu gezinir; gezinirken sahipsiz iş istasyonunu GÖRÜNCE
  sahiplenir (claim pathfinding-doğrulamalı; erişilemezse vanilla birkaç
  denemeden sonra KENDİ bırakır). Claim'i yalnız işsiz köylü yapar; claim
  köy hiyerarşisine göredir, yakınlığa göre değil — hangi köylünün
  sahipleneceğini script SEÇEMEZ, ancak presence ile GÖZLEMLER (iş
  saatinde çapada duran = sahip). Anchor-claim alignment: vanilla kimi
  seçtiyse etiket onu takip eder.
* **Köy sınırı:** POI'ler sınır +32 blok ötesinden claimlenemez; claim
  sınırı genişletir (organik büyüme). Uzak kamplar birkaç gün "keşif"
  ister ya da yatak/çanla köyü büyütmek gerekir (v2.12.0 relay planı).
* **Baldaken tuzakları:** kolon taraması yaprağı duvar sayarsa tacın
  altındaki gövdeyi ASLA görmez (akasya ormanı iş=0'ın gerçek nedeni —
  kullanıcı "sadece meşe arıyor" sandı; regex akasyayı da kapsıyordu).
  Tarama yaprak/asma/cocoa/propagule içinden GÖRMELİ; gövde dipten tepeye
  tek iş kaydedilmeli (tek ziyarette bütün ağaç).
* **Odun aileleri her tabloda:** Minecraft'ta tek kütük yok — yakıt,
  vanilla-smelt, tarif (aile bazlı tahta!), sipariş fallback, fidan eşleme
  (mangrov→propagule, bambu→bambu, crimson/warped→fungus ve YAKIT DEĞİL)
  tablolarının hepsi U.LOG_IDS/BURNABLE_LOGS/PLANK_IDS üzerinden yürür.
  Legacy id'ler (minecraft:log/log2/wood) eski dünyalarda hâlâ karşına
  çıkar; wood_type'i permutation'dan oku.
* **Watchdog uykuyu hesaba katmalı:** taşıyıcı gece ~12000t uyur; 1200t'lik
  worker_left her döngüyü akşam abort ediyordu. Eşik bir geceyi
  kapsamalı (14400t); hızlı abort yalnız işçi ÖLÜ/kayıpken (600t).
* **Aç kamp işçisi çantasından yer:** yemek angaryası vanilla yürüyüşüne
  bağımlı olamaz (mesai ortasında köye gitmez); eatFromPack önce, depo
  angaryası yedek. Tohum cebi (≤8) yenmez — working stock.
* **Çapa/çoğaltma tuzakları:** (a) eski kayıt YÜKSÜZ chunk'taysa "kırılmış"
  sayıp yeniden yerleştirme → ÇİFT kamp; önce isChunkLoaded. (b) yer
  bulamayan yerleştirme her pass denemesin → 2 dk red cooldown'u.
  (c) kamp bloğu addon sahipliğinde: kaldırma setBlock(air) ile (drop yok,
  dup yok); oyuncunun bloklarına asla dokunulmaz (yalnız air/bitki üstüne
  konur, read-back doğrulanır).
* **Bacak hedefleri köy-içi olmalı:** üretim bacakları atölyenin BAĞLI
  sandıklarını (inputChest/outputChest) hedefler — işçi zaten istasyonun
  dibinde durur; uzak depo sandığı hedefi vanilla mesaiyle asla varılamayan
  bacak üretir.
