# Clever Villagers v1.2 — Java Regrowth Mantık Port Planı

**Kaynak:** `regrowth-src/` altındaki orijinal kod (mactso/Regrowth, MIT).
**Amaç:** Java modunun *davranış mantığını* Bedrock'a birebir taşımak + kullanıcının sandık/malzeme ekonomisi tasarımını eklemek.

---

## 1) Java'nın çekirdek modeli (taşınacak olan)

### 1.1 Tick kapısı (MoveEntityEvent L157-250)
- `LivingTickEvent` → varlık başına her tick; `id % 2 == gameTime % 2` ise atla (yarım varlık/döngü).
- Mob kayıt tablosundan (`RegrowthEntitiesManager`) eylem dizgesi + saniye alınır.
- Olasılık: `odds = 1 / (seconds * 10)`; her tick zar atılır → etkin eylem sıklığı = seconds.
- **Yeni chunk boost:** `chunkInhabited < 480000` ise köylülerde her 12 tick'te bir EKSTRA `vRoadImprove` + `vImproveVillageWall` (ilk ~günlerde hızlı inşaat).
- Bedrock karşılığı: `system` heartbeat + varlık başına cooldown yerine **olasılık kapısı** (aynı matematik); boost = çan kaydından sonra `earlyBoostMinutes` (varsayılan 60 dk) boyunca 12 tick'te bir ekstra pas.

### 1.2 Pozisyon modeli (L171-250, L447-503)
- `footBlock/footBlockPos`: varlığın içinde durduğu blok (floor(y)).
- `groundBlock/groundBlockPos`: foot'un altı.
- `adjustedPos`: foot konumu; tüm eylemler bu üçlü + `yHeadRot` (bakış) ile çalışır.
- Halı üstünde ise atla; ground hava ise atla (yarasa hariç).
- **Bedrock:** aynı üçlüyü her iş pasında hesapla (`Math.floor(loc.y)`), hiçbir eylem "uzaktan" çalışmaz.

### 1.3 Flag sırası — HEPSİ denenir (L326-431)
`vImproveFarm → h(cleric+toolmaster) → beekeeper → v → c → r → w → p → t`
Erken çıkış YOK (her flag kendi iç koşulunda başarılı/başarısız). Koruyucular: `onGround`, foot!=bed, ground!=torch.
- **Bedrock hatası (v1.1):** "ilk başarılıda dur" zinciri → t/r çoğu zaman hiç koşmuyordu. Düzeltilecek.

### 1.4 c — çim kesme (L431-446)
- Yalnızca `footBlock` kesilebilir ise (tall grass/double plant/dry grass/leaf litter) → `destroyBlock(foot, false)` (drop yok).
- Köylü çimenin İÇİNDEN geçerken keser → doğal görünüm.

### 1.5 h — şifa (L1589-1647)
- Cleric: yakınındaki yaralı köylü/oyuncuya regen; Toolsmith(+weaponsmith/armorer): demir golem onarımı.
- Bedrock: job-site taraması (brewing_stand / smithing_table+blast_furnace+grindstone) zaten var; korunacak.

### 1.6 v — yaprak budama (L1815-1871)
- Köylünün BAKTIĞI yönde kafa hizasında yaprak/kaktüs → kes (drop'lu).
- Bedrock: `getBlockFromViewDirection` zaten doğru; korunacak + drop.

### 1.7 r — yol (L1992-2290) — kullanıcının "merdiven" isteğinin orijinali
Hepsi köylü konumunda, sırayla:
1. **vRoadFixSnow:** ground=biyom-yolu && foot=snow_layer → karı kır.
2. **vRoadFixGrassPatch:** canSeeSky && ground=çim/toprak && **≥3 ortogonal komşu kolonda yol bloğu** → ground'u biyom-yoluna çevir (yol kopukluğu onarımı; yayılma imkânsız).
3. **vRoadFixBump:** ground=yol && `isRoadBump` (4 yönde: below1 hava && below2 solid → köylü tek sütun tepesinde) → sütunu 1 indir (below1=air, below2=ground).
4. **vRoadFixPotholes:** ground=yol && canSeeSky && `isRoadPotHole` (foot seviyesinde 4 yön de solid → köylü çukurda) → foot + foot.below = yol bloğu; `helpJumpAway`.
5. **vRoadSmoothHeight:** canSeeSky && onGround && !baby && POI'ya yakın değil (≥3/çölde 7) && 4 yönde **komşu kolonun yüzeyi (heightmap) daha yüksek ve tepesi yol bloğu** && kendi foot'u hava → foot'a yol bloğu koy (+0.4 zıplama) → **kot farkı zamanla 1'er basamaklı merdivene dönüşür**.
- Biyom yol bloğu: `helpBiomeRoadBlockType` (plains=grass_path? java: dirt_path; desert=smooth_sandstone vb.).
- **Bedrock:** 5 onarımın birebir portu; `canSeeSky` = `getSkyLightLevel(pos) >= 15`; heightmap yerine 4 yönlü mini yüzey taraması (≤6 blok).

### 1.8 w — köy duvarı (L669-730, L961-1100, L2320-2470)
- **Geometri:** çan (MEETING_POINT POI) merkezli **KARE halka**: `|dx|==r && |dz|<=r` veya `|dz|==r && |dx|<=r`; `r = wallDiameter/2 - 1` (biyom çapları 40 → r=19; min 24→r=11).
- **Koşullar:** onGround; foot inşa edilebilir (hava/kar/bitki); `skyLight >= 13` (**gündüz**); ground, `WallFoundationDataManager` listesinde; foot'un üstünde/altında mevcut duvar/meşale YOK (kuleleşme engeli); başka çan halkası çakışması yok.
- **Kontrol bloğu:** çanın üstünde `playerWallControlBlock` (yeni chunk'ta <199 tick OTOMATİK konur; oyuncu sökerek durdurur).
- **Yerleşim:** parça, köylünün foot konumuna: halka kenarının TAM ORTASINDA (`va==0`) → **açık meşe çit kapısı** (yön duvar boyunca); değilse biyom duvar bloğu (1 blok).
- **Köşeler:** mason (stonecutter) köylüler köşe direği + üstüne **FENER** (`tryBuildWallCorner`).
- **Tepe meşalesi:** `t` flag'i varsa `isValidTorchLocation`: (|vx|==r && |vz| % spacing==1) veya tersi veya köşe; spacing=(r+1)/4 → meşale foot.above.
- **helpJumpAway:** inşa sonrası köylüyü duvar/çit içinden zıplat (yön vektörlü impulse).
- **Bedrock port:** kare halka + 1 blok + köşe feneri (mason=stonecutter yakını) + spacing meşale + jumpaway(`applyImpulse`) + gündüz kuralı (`getSkyLightLevel>=13`) + üst/alt duvar-meşale koruması. Kapılar: yol kesişimi kapıları (kullanıcı) + kenar-orta kapıları (Java) — **karar: tartışma Q2**.

### 1.9 p — ev çiti (L1704-1815)
- Home POI (yatak) merkezli kare halka, `r = diameter/4/2-1` (≈4); biyom çit bloğu; aynı yerleşim + meşale spacing + jumpaway; başka yatak çok yakınsa iptal.
- **Bedrock:** yatak önbelleği (köylü başına) + kare halka r=4; kapı açıklığı yok (Java'da da yok) — yol/çakışma koruması korunur.

### 1.10 t — aydınlatma (L1902-1991)
- `isSleeping || isBaby` → atla.
- **tryPlaceGroundTorch:** foot hava (veya çakıl/çubuk) && `blockLight(foot) <= torchLightLevel + coalBonus` && alt blok destekliyor && foot!=bed → foot'a meşale.
- **tryPlaceWallTorch:** foot hava && `blockLight(head) <= eşik` && head'in BAKIŞ yönündeki komşusu solid → head'e duvar meşalesi (bakışın tersi yön).
- `coalBonus`: seviye≥3 toolsmith/weaponsmith/armorer/fisherman/butcher → +1 (Bedrock'ta seviye okunamaz → **atla** veya job-site varlığına bağla; basitlik: atla).
- **blockLight (Bedrock):** `max(0, getLightLevel() - getSkyLightLevel())`.
- Sonuç: gündüz köyde blockLight 0 olduğu için köylüler GEZDİKÇE köyü aydınlatır; gece uyurlar → durur. Kullanıcı şikâyetinin kökü: v1.1 toplam ışık kullanıyordu → hiç meşale yoktu.

### 1.11 Mob eylemleri (L251-325, L1100-1556)
- eat/grow/both/tall/stumble/reforest/mushroom/coral — v1.x portları büyük oranda doğru; `both` oranı %15 grow; stumble meşale kırar; reforest biyom fidanı + boşluk kontrolü; mushroom sıcaklık→**biyom+ışık** uyarlaması kabul edilebilir; coral duvar yelpazeleri dahil.
- Ek Java detayı: `mobCheckOverCrowding` (aşırı kalabalıkta bitki sökme) — **yeni eklenecek** (performans/doğallık).

---

## 2) Kullanıcı tasarımısı: İnşaat Sandığı & Malzeme Ekonomisi

1. **Sandık oluşturma:** çan kaydedildiğinde çanın bitişik 4 yönünde ilk uygun zemine `chest` konur (varsayılan isim "Köy İnşaat Sandığı"). Varsa bulunur.
2. **Maliyet tablosu:** halka kolonu başına: duvar bloğu 1 (yükseklik config 1 ise 1); köşe direği: duvar 1 + lantern 1; tepe meşalesi: torch 1; kapı: fence_gate 1; ev çiti: fence 1.
3. **Tüketim:** yerleşimden ÖNCE sandık envanterinden (`block.getComponent("minecraft:inventory").container`) `removeItems(typeId, 1)`; başarıysa inşa, değilse **inşa yok**.
4. **Bilgilendirme:**
   - Sandığa bir kez **lore'lu paper** ("Malzeme listesi: N× cobblestone_wall, M× torch, ...") — `ItemStack.setLore` stabil.
   - Sohbet: kayıt anında toplam tahmin + kalan; malzeme bittiğinde rate-limitli (5 dk) uyarı: "İnşaat durdu: sandıkta X yok".
5. **Kısmi malzeme = kısmi inşaat** (kullanıcı senaryosu birebir).
6. **Yol onarımları malzeme YEMEZ** (köylüler mevcut malzemeyi yeniden dizer) — **karar: tartışma Q4**.
7. Malzeme itemleri biyom materyaline göre: ör. çöl → `sandstone_wall` itemi; item id = blok id (gate hariç: `fence_gate`/`spruce_fence_gate`...).

---

## 3) Performans & gündüz/gece döngüsü

- Olasılık kapısı + `id%2` alternansı + blok bütçesi korunur.
- Duvar/yol/grass-patch: `skyLight >= 13/15` → **gece otomatik durur** (köylüler uyur) — kullanıcının gözlemiyle uyumlu.
- Meşale: block-light tabanlı → gündüz de çalışır (köy aydınlanır).
- Early-boost: çan kaydı sonrası `earlyBoostMinutes` (varsayılan 60) boyunca 12 tick'te bir ekstra w/r pası (hâlâ köylü pozisyonunda!).

---

## 4) Açık kararlar (tartışma)

- **Q1 Halka geometrisi:** (a) Java kare halka çan merkezli r=19 (config 11-32); (b) v1.1 ev-sınırı dörtgeni; (c) hibrit: `max(kare halka, ev sınırı+pay)` dörtgeni. **Öneri: (c)** — köy 40+ blok olsa da kaplanır, Java hissi korunur.
- **Q2 Kapılar:** (a) yalnız yol kesişimleri (kullanıcı); (b) Java kenar-orta kapıları + yol kesişimleri. **Öneri: (b)** ama kenar-orta kapı yalnız yol ORADAN geçiyorsa açık kalır, geçmiyorsa Java gibi açık gate konur (köylüler çan toplantısına geçebilsin).
- **Q3 Duvar yüksekliği:** Java 1 blok + köşe feneri; kullanıcı 2 blok isteyebilir. **Öneri: config `wallHeight` varsayılan 1**, köşe direkleri +1 fener.
- **Q4 Yol malzemesi:** yol onarımı sandıktan mı yesin? **Öneri: hayır** (Java'da da maliyetsiz).
- **Q5 Ev çiti (p):** Java gibi yatak merkezli kare r=4, kapısız. **Öneri: Java birebir** (v1.1 boşluklu halka iptal).
- **Q6 Not kağıdı:** lore'lu paper + sohbet özeti. **Öneri: ikisi birlikte**.

---

## 5) Uygulama sırası (v1.2)

1. `position.js`: foot/ground/facing + skyLight/blockLight yardımcıları.
2. `villagers.js`: flag sırası (hepsi), pozisyon-tabanlı c/r/w/p/t + jumpaway + lookAt.
3. `walls.js`: kare/hibrit halka, 1 blok, köşe feneri, spacing meşale, kapılar, üst/alt koruması, gündüz kuralı, başka-çan çakışma engeli.
4. `chest.js`: sandık + maliyet + lore notu + uyarılar.
5. `roads.js`: Java 5 onarım birebir (merdiven dahil).
6. `mobs.js`: over-crowding eklemi + mevcut davranışlar.
7. Test matrisi: gündüz inşa/gece durma; çukur/tümsek/kopuk yol; kuleleşme yok; sandık tüketimi; kapı genişlikleri.
