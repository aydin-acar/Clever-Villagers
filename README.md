# 🧑‍🌾 Clever Villagers — Minecraft Bedrock PC

**Java modunun farklı bir Bedrock uyarlaması.** Orijinal: [mactso/Regrowth](https://github.com/mactso/Regrowth) (Forge, MIT lisansı).
Bu paket, Java modunun tüm ana mekaniklerini **yalnızca kararlı (stable) Script API** kullanarak Bedrock'a taşır — **deneysel özellik (experimental toggle) GEREKTİRMEZ**.

> Hedef sürüm: **Minecraft Bedrock 26.50+** (Eylül 2026 güncel sürüm; `@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0).

---

## 📦 Paket İçeriği

| Paket | Dosya | Görev |
|---|---|---|
| **CleverVillagers_BP** | Davranış Paketi | Tüm mantık (Script API), komutlar, Toolkit eşyası + tarifi |
| **CleverVillagers_RP** | Kaynak Paketi | Paket simgesi + Toolkit eşya dokusu + TR/EN dil dosyaları |

Kurulum için tek dosya yeterlidir: **`Clever Villagers.mcaddon`** (iki paketi birlikte içerir).

---

## 🚀 Kurulum (Windows)

1. `Clever Villagers.mcaddon` dosyasını indirin (ör. `C:\Users\aydin\mc mods\` klasörüne kaydedin).
2. Dosyaya **çift tıklayın** → Minecraft Bedrock açılır ve paketi içe aktarır ("İçe aktarma başarılı").
3. Minecraft'ta dünyanızı **düzenleyin** (veya yeni dünya oluşturun):
   - **Davranış Paketleri** → *Clever Villagers (Regrowth BP)* → **Etkinleştir**
   - **Kaynak Paketleri** → *Clever Villagers (Regrowth RP)* → **Etkinleştir**
     (mcaddon içe aktarımında ikisi de otomatik seçilir.)
4. Dünyaya girin — sohbette `§aClever Villagers aktif` mesajını görürsünüz. ✅
   - Alternatif manuel kurulum: `.mcpack` dosyalarını çift tıklayıp aynı adımları izleyin.
   - **Hile (cheats) açmanız GEREKMEZ** — komutlar cheats kapalıyken de çalışır.

> Not: Script'ler yalnızca **dünyada** çalışır (Realm'da da çalışır; Realm sahibinin paketi eklemesi gerekir).

---

## 🎮 Oynanış — Ne Değişiyor?

### Köylüler (Java'daki flag sistemi birebir)

| Flag | Eylem | Açıklama |
|---|---|---|
| `c` | **Çim biçme** | Köy yakınındaki uzun ot/eğrelti/ölü çalıları biçer |
| `h` | **Şifa** | **Rahip** (brewing stand yakınında): yaralı köylü/oyuncuya Regeneration. **Demirci** (smithing table/blast furnace/grindstone): hasarlı **demir & bakır golemleri** onarır |
| `r` | **Yol onarımı** | Köy yollarındaki çukurları doldurur, tümsekleri düzler, yol üzerindeki otu ve **karı** temizler |
| `w` | **Köy duvarı** | Köy çanının çevresine **biyoma uygun** duvar örer (çöl=kumtaşı, mesa=kırmızı kumtaşı, tayga=ladin çiti+taş, orman=yosunlu taş…) — yolların geçtiği yerlerde **kapı boşluğu** bırakır |
| `v` | **Yaprak budama** | Köylünün baktığı yöndeki yaprak/kaktüsleri budar — **bonus:** budanan yapraklar fide/elma düşürebilir |
| `t` | **Meşale dikme** | Işık seviyesi ≤ 3 olan karanlık noktalara meşale diker (**zombi spawn önleme**, Java'daki gibi) |
| `p` | **Ev çiti** | Köylünün evinin (yatak) çevresine çit örer — Java'daki gibi **varsayılan KAPALI** |

> Meslek tespiti: Bedrock'ta meslekler **iş istasyonu bloğundan** atandığı için mod, köylünün yakınındaki iş istasyonunu tarar (composter→çiftçi, brewing stand→rahip, smithing table→demirci).

### Hayvanlar & canavarlar (Java `defaultRegrowthMobs` birebir)

| Varlık | Eylem | Süre |
|---|---|---|
|  İnek | hem yer hem büyütür (%15 büyüme) | 300 sn |
| 🐑 Koyun / 🐴 At / 🫏 Eşek* | çim yer (yiyince %99 can dolar) | 120/180/240 sn |
| 🐷 Domuz | **biyoma uygun fidan eker** (mantar adasında mantar!) | 450 sn |
| 💥 Creeper | uzun ot/eğrelti **büyütür** | 90 sn |
| 🧟 Zombi / Husk* | **meşaleleri devirir!** (eşya olarak düşer*) | 30/45 sn |
| 💀 İskelet / Stray* | karanlıkta **mantar tarlası** yetiştirir | 120/150 sn |
| 🦑 Mürekkep / Glow* | mercan **büyütür ve ÖLÜ MERCANLARI CANLANDIRIR*** | 120/150 sn |

`*` = Bedrock'a eklediğim bonuslar.

###  Bedrock bonusları & geliştirmeler

1. **Çiftçi tarla onarımı:** Ezilen (tarlaya→toprağa dönen) ekili alanları çiftçiler otomatik yeniden çapalar — Java'daki `TrampleEventHandler`'in Bedrock karşılığı (Bedrock'ta ezilme olayı API'de yok).
2. **Village Toolkit eşyası:** Saat + meşale ile craftlanır (`/cv:toolkit` ile de alınır). Kullanınca **ayar menüsü (GUI)** açılır — komut yazmadan her şey ayarlanabilir (mobil/konsol dostu). OP olmayanlar menüyü salt-okunur görür.
3. **Budama ödülleri:** Yaprak budayınca fide/elma düşebilir.
4. **Ölü mercan canlandırma:** Mürekkep balıkları ölü mercanları diriltir.
5. **Meşale düşüşü:** Zombilerin devirdiği meşaleler eşya olarak düşer (ayarla kapatılabilir).
6. **Gerçek `/cv:*` komutları** (Java'daki gibi, OP seviyesi 2 ister).
7. **Duvar tamir devriyesi:** Her 5 dakikada bir duvar halkası taranır, kırılan parçalar onarılır.
8. **Kalıcı ayarlar & istatistikler:** Tüm ayarlar ve sayaçlar dünyada saklanır (kapanıp açılsa da kaybolmaz).
9. **Performans koruması:** Java'daki gibi varlıkların **yarısı** her döngüde işlenir + saniyelik blok-değişiklik bütçesi (varsayılan 32).

---

## 🧱 Köy Surları Nasıl Çalışır? (v1.1 tasarımı)

1. **Köy taraması:** Çan kaydedildikten sonra mod, çanın 40 blok çevresindeki TÜM ev işaretlerini (yatak, kapı, iş istasyonu, çan) arka planda parça parça tarar ve köyün gerçek sınır kutusunu bulur.
2. **Dörtgen halka:** Sur hattı, en dıştaki evden `villageWallMargin` (varsayılan **10**) blok dışta, köyü **kesintisiz bir dörtgen** olarak çevreler; arazi yüksekliğini takip eder ve basamakları kapatır (zombi sızamaz).
3. **Kapılar:** Sur hattı bir yolu kestiğinde yolun genişliği (1-6 blok) ölçülür ve açıklığa yol genişliğince **çit kapısı (fence gate)** konur. Başka boşluk yoktur.
4. **Gerçek işçilik:** Hiçbir blok "kendi kendine" konmaz — bir kolon yalnızca **12 blok içinde bir köylü varsa** örülür; köylü işe bakar (lookAt) ve çalışma partikülü çıkarır. İnşaat, iş gücünün olduğu yerden ilerler.
5. **Başlatma:** Çanın üzerine/yanına `cobblestone_wall` koy (veya `/cv:config wallsAlwaysOn true`). İlerleme: `/cv:info` → `İlerleme: X/Y kolon`.
6. **Malzeme:** Biyoma göre tek tip duvar (ovalar=taş duvar, çöl=kumtaşı duvar, tayga=taş+ladin çiti kapılar...) + her `wallTorchEvery` kolonda tepe meşalesi.
7. **Onarım:** 5 dakikada bir devriye kırılan kolonları tarar — yine yalnızca yakında köylü varsa onarır.

> Not: v1.0'ın dairesel halkası dünyada kaldıysa blokları elle sökmen yeterli; v1.1 yalnızca yeni dörtgen hattı örer.

## ⌨️ Komutlar

| Komut | Yetki | İşlev |
|---|---|---|
| `/cv:help` | herkes | Komut listesi |
| `/cv:info` | herkes | Baktığınız varlık/blok + mod durumu (Java `info` karşılığı) |
| `/cv:stats` | herkes | Eylem sayaçları |
| `/cv:toolkit` | herkes | Toolkit eşyası verir |
| `/cv:debug <0\|1\|2>` | OP | Debug seviyesi (2 = log + action bar) |
| `/cv:pause` / `/cv:resume` | OP | Her şeyi durdur/başlat |
| `/cv:flags <karakterler>` | OP | Köylü flagleri, ör. `chrwvt` / `chrwvtp` |
| `/cv:config` | OP | Tüm ayarları listele |
| `/cv:config <anahtar> <değer>` | OP | Tek ayar değiştir |
| `/cv:bell <add\|clear\|list>` | OP | Çan kaydı yönetimi |

### Önemli ayarlar (`/cv:config`)

| Anahtar | Varsayılan | Açıklama |
|---|---|---|
| `villagerFlags` | `chrwvt` | Köylü işleri (p kapalı) |
| `torchLightLevel` | `3` | Işık ≤ bu değerse meşale dikilir |
| `eatingHeals` | `0.99` | Ot yiyince can dolma olasılığı |
| `workIntervalTicks` | `40` | Köylü çalışma periyodu (2 sn) |
| `wallControlBlock` | `minecraft:cobblestone_wall` | Duvarı başlatan kontrol bloğu |
| `wallsAlwaysOn` | `false` | Kontrol bloğu olmadan duvar |
| `cutFlowers` | `false` | Çim biçerken çiçekler de kesilsin |
| `mushroomDensity` | `6` | Mantar tarlası yoğunluğu |
| `mushroomLightLevel` | `7` | Mantar için max ışık |
| `farmRepair` | `true` | Çiftçi ezik tarla onarımı |
| `mobIntervalScale` | `1.0` | Hayvan eylem sıklığı çarpanı |
| `maxBlockChangesPerCycle` | `32` | Performans tavanı |

---

##  Java Modundan Farklar (teknik notlar)

| Java (Regrowth) | Bedrock (bu paket) | Sebep |
|---|---|---|
| `LivingTickEvent` her tick | 1 sn heartbeat + 2 sn köylü döngüsü | Script performans modeli |
| POI API (ev/iş istasyonu) | İş istasyonu blok taraması | Bedrock POI API'si deneysel |
| `FarmlandTrampleEvent` engelleme | Çiftçi onarımı (re-till) | Bedrock'ta ezilme olayı yok |
| `LightLayer.BLOCK` | `Block.getLightLevel()` (toplam ışık) | Bedrock API eşdeğeri |
| Config dosyası (TOML) | Dünya dynamic property'leri + GUI | Bedrock'ta dosya yazma yok |
| `regrowth debugLevel` | `/cv:debug` + Toolkit GUI | Bedrock komut şeması |

---

## 🛠️ Sorun Giderme

- **Komutlar görünmüyor:** Paketi dünyaya eklediniz mi? Script'ler yalnızca BP etkin dünyada çalışır. Dünyayı yeniden açın.
- **Hiçbir şey olmuyor:** `/cv:info` ile `RUNNING` mi kontrol edin; `/cv:resume`.
- **Duvar örülmüyor:** Çan kayıtlı mı (`/cv:bell list`)? Çanın üzerinde kontrol bloğu var mı? Biyom `water/end/nether` değil mi?
- **Meşale dikilmiyor:** Gece mi? Işık seviyesi ≤ `torchLightLevel` olmalı (gündüz açık havada ışık 15'tir — Java'daki gibi gündüz meşale dikilmez).
- **Sürüm:** Bedrock 26.50 altındaysa Script API 2.10.0 bulunamaz ve paket yüklenmez — oyunu güncelleyin.
- **Log:** Hatalar content log'da `[CV]` önekiyle görünür (`/cv:debug 1` ile ayrıntılı).

---

## ⚖️ Lisans & Teşekkür

- Orijinal mod: **Regrowth** © mactso — MIT License. Bu paket bağımsız bir Bedrock yeniden uygulamasıdır; mekanik tasarımı orijinalinden uyarlanmıştır.
- Bedrock portu: Qwen tarafından, Minecraft Creator docs (stable API 2.10.0) referans alınarak üretildi.
- Bu klasördeki tüm dosyalar MIT lisansıyla paylaşılabilir.

**İyi eğlenceler! Köylüleriniz artık gerçekten çalışıyor. 🧑‍🔥**
