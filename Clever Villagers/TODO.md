# 🔧 CLEVER VILLAGERS — TODO / HATA GÜNLÜĞÜ (kullanıcı bildirimleri birebir)

> Bu dosya kullanıcının 22.09.2026 bildirimlerinin **eksiksiz** kaydığı ve çözüm durumlarının izlendiği ana listedir.
> Durumlar: ✅ yapıldı · 🟡 kısmi · ⏳ bekliyor · 💬 tartışma/açıklama gereken

---

## A) DUVAR İNŞASI HATALARI

- [ ] **A1.** Duvarlar çandan ~25 blok uzakta, TEK sıra, **rastgele boşluklu** örülüyor
      (1 blok duvar + 3 boşluk, 2 blok duvar + 5 boşluk gibi düzensiz).
      → ✅ v1.3: boşlukların sebebi meşale-ödemesi başarısızlığıydı (G1); duvar artık meşaleden bağımsız örülür; kolonlar kesintisizdir.
- [ ] **A2.** Sadece kuzey yönünde ~25 blok düz hat örülmüş, **diğer yönlerde hiç duvar yok**;
      hiçbir köy evi dikkate alınmamış.
      → ✅ v1.3: köy sınırı ev-kümesi+büyüme algoritmasıyla (B maddeleri) yeniden hesaplanır;
        işçi kuralı 16 blok yarıçapa genişletildi + köylüye işe "yürüme dürtüsü" (impulse) eklendi → tüm kenarlar zamanla örülür.
- [ ] **A3.** Duvar offset'i "duruma göre değişken sayıda, kodla değiştirilebilir" olmalı (10..30).
      → ✅ v1.3: `wallOffset` config (10-30, varsayılan 10).

## B) EV TESPİTİ MANTIĞI (kullanıcı tasarımı)

- [ ] **B1.** Her kapı/yatak/cam ayrı ev sayılıyor → YANLIŞ.
      Doğrusu: **yapı bazında** tespit:
      1. kapı varsa yapı = ev
      2. kapı yok/kırık ama yatak varsa = ev
      3. kapı+yatak yok ama cam ve/veya cam levha varsa = ev
      → ✅ v1.3: işaretçi bloklar 12 blok zincirle **bina kümelerine** gruplanır; küme içinde
        kapı>yatak>cam önceliğiyle sınıflandırılır (üçünden biri varsa ev).
      → 💬 Daha gelişmiş önerim: küme + "çatı/dvar kalınlığı" sezgisi (bkz. D2 açıklaması). Tartışmaya açık.
- [ ] **B2.** Sınır algoritması: çandan **100 blok** yarıçaptaki evler bulunur;
      çana **en uzak** ev(ler) baz alınır → **kare** geçici köy sınırı.
      → ✅ v1.3: half = en uzak evin dış köşesinin Chebyshev uzaklığı.
- [ ] **B3.** Geçici sınırdaki **her** en-dış evin çevresinde **40 blok çapında** yeniden tarama;
      yeni ev bulunursa sınır onu içine alacak şekilde genişletilir;
      bu işlem sınırdaki en uzak evlerin TAMAMINDA, yeni ev kalmayana kadar tekrarlanır
      (evden eve yayılarak gerçek sınır).
      → ✅ v1.3: growQueue = sınırdaki evler; her ev için r=20 tarama (chunked); yeni ev → rect büyür → döngü.
- [ ] **B4.** Tespit edilen sınır oyunda **geçici/hayali bir çizgiyle** görünsün (hata tespiti için).
      → ✅ v1.3: harita tamamlanınca (debug≥1) partikül çerçeve; her zaman `/cv:bounds` komutuyla partikül çerçeve.
- [ ] **B5.** En dış çerçevedeki evlerin **dış duvarlarından** 10..30 blok uzakta sınır çizilmeli;
      köy genişledikçe bu alan da büyümeli (yeni tarama tetiklemeli).
      → ✅ v1.3: rect = (ev dış sınırı + houseWallPad) + wallOffset; büyüme taraması rect'i canlı büyütür.
      → 💬 "Dış duvar" çıkarım mantığım (D2): kapı+pencere işaretçileri ZATEN duvar hattındadır,
        yataklar iç mekândadır; bu yüzden bina bbox'ı +2 blok (houseWallPad) = dış duvar payı.
        Alternatif önerim: log/duvar bloğu taraması (pahalı) — tartışalım.

## C) MEŞALE / AYDINLATMA HATALARI

- [ ] **C1.** Köylüler yürürken **rastgele meşale düşürüyor** → köy zamanla meşale doluyor,
      saçma + kaynak israfı + **sonsuz meşale isteği**.
      → ✅ v1.3: yürüme-bazlı meşale TAMAMEN kaldırıldı; yerine deterministik **ızgara planlayıcı** (C3).
- [ ] **C2.** Meşale eklenmezse **diğer malzemeler olsa bile inşaat duruyor**.
      → ✅ v1.3: meşale ödemesi duvar inşasından ayrıldı (G1); meşale yoksa sadece uyarı.
- [ ] **C3.** Aydınlatma kuralı: "oyundaki canavar doğma ışık sınırı neyse, köydeki gece ışık sınırı
      **o sınırın altında olmayacak** şekilde" aydınlatma bırakılmalı, random değil.
      → ✅ v1.3: köy rect'i içinde `torchGrid` (varsayılan 16) aralıklı ızgara noktaları;
        noktanın block-light'u < `minVillageLight` ise meşale konur (block-light = gece ışığı).
        Bedrock 1.18.30+ canavar eşiği 0 → varsayılan hedef 1 (config ile 7'ye kadar çıkarılabilir).
        Meşaleyi hâlâ bir köylü "diker" (16 blok içinde işçi + lookAt + partikül).

## D) SANDIK / ENVANTER HATALARI

- [ ] **D1.** Slotlarda dağınık meşale varken (slot3=1 meşale, slot5=meşale) kod slot3'e takılıp
      **tüm inşaatı durduruyor**; diğer yığını görmüyor.
      → ✅ v1.3: count/consume tüm slotları slot-bazlı try ile tarar, dağılmış yığınları toplar;
        setItem(undefined) hatasında hava-yığını fall-back; consume slotlar-arası eksiltme yapar.
- [ ] **D2.** (B5 açıklaması) dış duvar mantığı tartışması — bkz. B5 💬.

## E) FLAG DAVRANIŞ HATALARI

- [ ] **E1.** `p` (fence) kapatılınca inşaat duruyor; açılınca "devam" diyor ama sadece rastgele meşale bırakıyor.
      → ✅ v1.3: gözlemlenen etki C1/C2 kaynaklıydı (meşale kıtlığı kolonları kitliyordu);
        p flag'i artık yalnız ev çitini kontrol eder, w'yi etkilemez (kodda zaten ayrıydı, kitlenmenin kökü giderildi).
- [ ] **E2.** `t` kapatılınca inşaat duruyor; açılınca sadece meşale bırakıyor.
      → ✅ v1.3: aynı kök neden; t artık yalnız ızgara aydınlatmasının anahtarı, duvar ekonomisinden bağımsız.

## F) ÇALIŞAN ŞEYLER (korunacak)

- [x] **F1.** Büyücü (cleric) heal'i çalışıyor — kullanıcıyı birkaç kez iyileştirdi. ✅ korunacak.
- [x] **F2.** Çan kaydı, sandık oluşturma, not kağıdı, motor/boost, yol onarımları temel düzeyde çalışıyor.

## G) KOD DAYANIKLILIĞI

- [ ] **G1.** Meşale ödemesi başarısızsa kolon inşası IPTAL olmamalı → duvarlar örülmeye devam etmeli,
      sadece tepe meşalesi atlanmalı. ✅ v1.3.
- [ ] **G2.** consume() kısmi başarısızlıkta yarım eksiltme bırakmamalı (all-or-nothing + rollback). ✅ v1.3.
- [ ] **G3.** BP manifest RP bağımlılık sürümü eşleşmesi (1.2.0 düzeltmesi yapıldı, korunacak). ✅

## G+) v1.3.1 DÜZELTMELERİ (22.09 gece turu)

- [x] **I1.** Otomatik çan taraması KALDIRILDI — çan yalnız `/cv:bell add` ile eklenir
      (kullanıcı isteği). playerPlaceBlock otomatik kaydı da kaldırıldı.
- [x] **I2.** Tarama sonsuz döngüsü düzeltildi: `expanded` bayrağı bina NESNESİNDE duruyordu ve
      her birleşmede yeniden kümelemeyle sıfırlanıyordu → artık bbox-ANAHTARI ile izleniyor.
- [x] **I3.** Grow-fazı birleşmeleri artık artımlı (full recluster yok) → performans + stabilite.
- [x] **I4.** İşaretçi sınırı 6000 (patolojik köyler için emniyet).
- [x] **I5.** `/cv:bell add` artık sandığı ANINDA oluşturur (tarama bitmesini beklemez).
- [x] **I6.** info: tarama fazı + işaretçi/bina/kuyruk sayaçları görünür (takılma teşhisi).

## G++) v1.3.2 DÜZELTMELERİ (22.09 gece-2 turu)

- [x] **J1.** "60 blok" yanlış anlaması: mesajdaki sayı SINIR yarıçapıydı (en uzak ev 50 + offset 10);
      tarama yarıçapı zaten 100'dü. Mesaj artık "tarama yarıçapı 100, kot ±20" diye açık yazıyor.
- [x] **J2.** Kot penceresi dardı (±4/+8) → tepedeki/çukurdaki evler kaçıyor, 2. dalga boşa dönüyordu.
      Yeni: **±20 kot** taraması.
- [x] **J3.** bounds ışığı görünmüyordu: partikül seyrek+sönüktü → artık **end_rod** (parlak beyaz),
      2x yoğunluk. Ayrıca bazı yollarda Java partikül adı ("happy_villager") kullanılıyordu →
      Bedrock doğrusu "villager_happy" ile değiştirildi (işçi partikülleri de artık görünür).
- [x] **J4.** Meşale aynı bloğa 8 kez deneniyordu + saçılıyordu: ızgara TÜM sur karesini (tarlalar
      dahil) kaplıyordu ve başarısız denemeler tekrarlanıyordu. Yeni: ızgara yalnız **yaşam alanı**
      (evler+pay) karesinde, **çatı altı noktalar atlanır**, başarısız nokta 30-60 sn skip'lenir.
- [x] **J5.** Malzeme modeli kökten değişti: **önce stok kontrolü → yerleştir → BAŞARILIYSA tüket**.
      (Eski "önce tüket" modeli setItem hatasında malzeme yutuyor ve "meşale bitti" yalanı üretiyordu.)
- [x] **J6.** Duvar örülmüyordu: işçi 17 blok dışındaki kolona hiç gidemiyordu. Yeni **crew sistemi**:
      çana ≤`workerRadius`(100) bloktaki köylüler işe alınır, hedefe yürütülür (impulse), varınca
      (≤3 blok) örer; 90 sn'de varamazsa hedef köylünün yanındaki en yakın kolona atanır →
      inşaat her koşulda ilerler.
- [x] **J7.** Kalıcılık: faz/core bilgisi reload'da normalize ediliyor (done ama phase yok sorunu).

## G+++) v1.3.3 DÜZELTMELERİ (23.00 turu)

- [x] **K1.** `surfaceY` kot penceresi ±7 idi → eğimli arazide sınır kolonları/partikülleri sessizce
      iptaldi (bounds görünmüyor + duvar başlamıyor kökü). Yeni: **±24** + meşale/fener "zemin" sayılmaz.
- [x] **K2.** Duvar kot toleransı ±5 → **±12** (tepelerdeki kolonlar da örülür).
- [x] **K3.** Sonsuz meşale döngüsü: block-light tahmini gündüz her yeri 0 görüyordu.
      Yeni kural: **ölçüm+yERLEŞTİRME sadece GECE (13000-23000)** — gece toplam ışık = gerçek block-light.
- [x] **K4.** Meşale için işçi kuralı sıkılaştırıldı: **≤2.5 blokta duracak, bakacak (lookAt), sonra konacak**;
      uzaktaki köylüye nazik yürüme çağrısı (40 tick'te bir, 0.18 impuls).
- [x] **K5.** Çift meşale engeli: aynı kotta ±2 blokta meşale varsa nokta 2 dk skip.
- [x] **K6.** Crew dürtüsü seyreltildi (40 tick, 0.18) → geri-ileri yürüme titremesi biter;
      hedef süresi 90 sn → sonra köylünün yanındaki kolon atanır.
- [x] **K7.** Tarama hızı 3x (6000/slice, 3 slice/döngü); her dalga bitiminde sohbete
      "Dalga tamam: bina N, sınır Y · yeni dalga: K ev" mesajı (2. dalga görünürlüğü).

## G++++ ) v1.3.4 (dalga + log + yol kot turu)

- [x] **L1.** Yön-bazlı dalga taraması (kullanıcı tasarımı birebir): çekirdek çerçeve
      (`houseSeedRadius` 50 → 100 genişlik) → 4 yön (N,E,S,W) için o yönün **en uzak evinden**
      `houseWaveRadius`(60) blok öteye şerit tarama → yeni ev=sınır büyür+aynı yönden yeni dalga →
      bulamazsa yön kapanır → 4 yön bitince harita tamam. Her dalga sohbete raporlanır.
- [x] **L2.** LOG sistemi: ring-buffer (240 satır) + `/cv:log [n]` + console.warn aynası
      (Windows content.log dosyasına düşer) + `logEnabled` config. Duvar/kolon atlama
      SEBEPLERİ artık log'da (zemin, kot, gece, malzeme...).
- [x] **L3.** bounds: deterministik imleçle çevre boyunca **basic_flame_particle** (96/cycle) —
      gündüz/gece görünür; end_rod/villager_happy riskli adlar bırakıldı.
- [x] **L4.** Yol kot tasfiyesi: yanal farklar TEK kota (komşuyu yükselt), boyuna 2+ farkta
      MERDİVEN basamağı (kendi tarafından aşağı basamak), 6 blok kopuklukta gap-bridge
      (≥2 yol komşusu olan doğal zemin → yol).
- [x] **L5.** Çekirdek tarama varsayılanı 50 yarıçap (100 genişlik çerçeve, kullanıcı sözleri).

## G+++++) v1.3.5 (kök-neden turu)

- [x] **M1.** Dalga şeridi darlığı: şerit yalnız uç evin ±60'ıydı → çapraz evler hiç taranmadan
      yön kapanıyordu (5/10 ev kökü). Yeni: şerit = **o yönün tüm sınır genişliği + 60**.
- [x] **M2.** Aydınlatma çıkmazı: "gece ölçüm" + "uyuyan köylü yapmaz" birbirini kilitliyordu
      (gece herkes uyuyor → ışık hiç konmuyor); gündüz ise gökyüzü ışığı meşaleyi gizleyip
      sonsuz yeniden deneme üretiyordu. Yeni kural: **gece=doğrudan ölçüm, gündüz=6 blokta
      ışık kaynağı var mı** → Java-sadık (gündüz de dikim) + döngüsüz.
- [x] **M3.** Crew performans/kilit: her 12 tick'te ~400 kolon surfaceAt (~20k blok okuma) +
      zayıf dürtü → köylü varamıyor, tek kolon kalıyordu. Yeni: O(1) halka indeksi,
      600 tick'lik unbuilt önbelleği, 20 tick'te 0.3 dürtü, **6 blokta inşa**, bekleme halinde lookAt.
- [x] **M4.** bounds görünürlüğü: partikül kanalına güven bırakıldı → **geçici sarı yün çizgisi**
      (blok bütçesinden bağımsız doğrudan setPermutation) + alev partikülleri; 25 sn'de oto-silim.
- [x] **M5.** "Sessiz sonlanma" yanıtı: kod sessiz değil — LOG her atlama sebebini yazıyor
      (gece/kapalı, zemin, kot, malzeme); asıl kayıp performans kilitleriydi (M3).

## G++++++) v1.3.6 (çan-silme + yüksüz-chunk + basamaklı sınır turu)

- [x] **N1.** KRİTİK: devriye, chunk yüksüzken çanı "kırılmış" sanıp kayıttan siliyordu
      (`çan: 0` kanıtı) → çana bağlı TÜM sistemler (duvar, ışık, devriye) duruyordu.
      Artık çan yalnız chunk YÜKLÜYKEN ve gerçekten kırılmışsa silinir.
- [x] **N2.** Tarama yüksüz chunk gördüğünde yönü KAPATMIYOR: "yüksüz alan" mesajı +
      otomatik yeniden deneme (40 denemeye kadar) → oyuncu keşfettikçe harita tamamlanır.
      Ek: `/cv:rescan` (köy büyüyünce manuel yeniden tarama, kullanıcı isteği).
- [x] **N3.** Sınır şekli (çizim #5 birebir): ev kutuları + `wallOffset` paylarının
      BİRLEŞİMİNİN dış çevresi = basamaklı doğal hat (tek büyük dikdörtgen DEĞİL).
      Köşeler (hat dönüşleri) +1 direk + fener; kapılar yalnız yol geçitlerinde
      (kare kenar-orta kapıları bu şekille anlamsızlaştı → kaldırıldı).
- [x] **N4.** `/cv:bounds on|off`: on = kalıcı sarı yün çizgisi (chunklar
      yüklendikçe KADEMELİ tamamlanır), off = yünleri kaldırır.
- [x] **N5.** Işık: gündüz de çalışır (6 blok ışık kaynağı komşuluk kuralı) →
      "gece uyuyan köylü" çıkmazı bitti; sonsuz yeniden deneme imkânsız.
- [x] **N6.** needsSummary gerçek kolon sayısıyla hesaplanır (birleşim çevresi).

## G+++++++) v1.3.7 (sandık dürüstlüğü + tek-pas tarama + su köprüsü)

- [x] **O1.** "Sandık hazır" yalanı: ensureChest çanın aynı kotunda 4 yön deniyordu; çan direk
      tepesindeyse hiç yer bulamıyor ama mesaj başarı diyordu. Yeni: 8 komşu kolonda **zemin ara,
      üstüne koy**; mesaj artık gerçek sonucu yazıyor (kondu / yer yok).
- [x] **O2.** Kullanıcı isteği: otomatik 60-sn yeniden deneme KALDIRILDI. Tarama TEK pas koşar;
      yüksüz kolonlar "boş" sayılır + tek seferlik ipucu mesajı; genişletme = `/cv:rescan`.
      (v1.3.6'daki otomatik yeniden deneme yönleri hiç kapatmıyor → faz done olmuyor →
      crew başlamıyordu; bu turdaki "tarama tamamlanmıyor" kökü.)
- [x] **O3.** Su = sessiz iptal (kullanıcı teşhisi): sınır/yün hattı suda null dönüp kopuyordu.
      Yeni `columnGround`: suyu **köprüler** (deniz tabanı→yüzey duvar dolgusu, ≤4 derinlik),
      yün çizgisi su üstünde sürer; >4 derinlikte log'lu atlama.
- [x] **O4.** Malzeme uyarısı artık gereken ADETİ yazar (su köprüsü ekstra blok tüketir).

## G++++++++ ) v1.3.8 (bounds off güvenilirliği)

- [x] **P1.** `bounds off` yalnız bellek listesine güveniyordu (reload'da boşalıyordu) →
      artık sınır kolonlarını YENİDEN HESAPLAYIP yünleri buluyor-siliyor; yüksüz kolonları
      sayıyor ve komut sonucu "N silindi, M yüksüz (tekrar off çek)" diye raporluyor.
- [x] **P2.** Kalıcı yün inşaatı kilitleyemez: duvar döngüsü sarı yünü **değiştirilebilir**
      sayar (kullanıcının "yün duvarı engelliyor" teşhisi).

## R) v1.4.0 (parıltı bounds + sızdırmaz duvar + tek kapı)

- [x] **R1.** bounds ARTIK BLOK KOYMUYOR: `on` = sınır hattında sürekli yeşil yıldız parıltısı
      (çan yıldızları gibi), `off` = anında durur. Eski yünler için `off` tetikli
      arka-plan taraması (chunk'lu, ~140 yarıçap, sayaç raporlu) hepsini siler.
- [x] **R2.** Basamak mühürleme: her kolon KOMŞU kolonların en yüksek kotuna kadar örülür
      → kot farkı boşlukları kapanır (zombi sızması biter); ekstra blok sandıktan tüketilir.
- [x] **R3.** Kapılar: yol geçidi grubunda ORTADAKİ tek kolon kapı olur (kalanlar taş duvar);
      kapı yönü yolun ENİNE (hat K-G işlerse doğu, D-B işlerse kuzey) — dik durma hatası bitti.
- [x] **R4.** Derin su (taban >4 derin): duvar örmez ama parıltı çizgisi kesintisiz geçer.
- [x] **R5.** Derleme: v1.4.0 mcaddon/mcpack paketlendi (kullanıcı hatırlatması).

## S) v1.4.2 (kule-duvar limiti + 3-blok yol standardı + varsayılanlar)

- [x] **S1.** Kule duvarlar (10-20 blok): basamak mühürleme uçurum komşusunu da mühürliyordu.
      Yeni kural: mühürleme yalnız **<=2 kot farkı** olan komşuya; uçurumlar doğal engel.
- [x] **S2.** Yol standardı (kullanıcı şartnamesi birebir): en=3 blok; kesit **çoğunluk kotuna**
      tesviye (yukarı/aşağı); kapı önü 3x3 bölge **kapı-1 kotuna** tesviye + **kalıcı kilit**
      (dynamic property, reload'da sürer); boyuna fark >=2 ise geçişte **1 basamak/pas yumuşatma**
      (max 1'lik rampa oluşur); kopuklukta komşu medyanına köprü; yol üstü hava boşlukları
      **10 bloka kadar** doldurulur (toprak/taş).
- [x] **S3.** `wallsOn` varsayılan **OFF** + `roadsOn` varsayılan **OFF**;
      komutlar: `/cv:walls on|off`, `/cv:roads on|off`.
- [x] **S4.** `bounds off` içindeki yün süpürgesi KALDIRILDI (kullanıcı isteği; yeni dünya).
- [x] **S5.** Yol motoru yalnız 'r' flag'i + roadsOn birlikte açıkken çalışır; tüm düzenlemeler
      köylünün bastığı yerde (işçi görünür).

## H) GELİŞTİRME LİSTESİ — DURUM (25.09 kapandı)

- [x] **H1.** Çatı/log taraması: KULLANICI İSTEĞİYLE VAZGEÇİLDİ (gereksiz yük; evler sorunsuz işaretleniyor).
- [x] **H2.** Tek ortak çalışma animasyonu: `U.workerAct` = bakış + swing/celebration animasyonu
      (best-effort) + yeşil yıldız → TÜM mod eylemleri aynı imzayı kullanıyor.
- [x] **H3.** Sandık notu otomatik güncelleme: her rescan/finishMap'te KALAN ihtiyaç
      (örülen duvarlar düşülmüş, gerçek köşe/fener sayısı, yol kapısı grup sayısı)
      hesaplanıp nottur kağıdının lore'u YERİNDE yenileniyor (`C.updateNote`).
- [x] **H4.** Kalıcı/hayali sınır gösterimi = `bounds on/off` yeşil parıltı döngüsü
      (kullanıcı onayı: "yeşil ışıklar sorunsuz çalışıyor") → H4 bu idi, tamam.

## T) v1.4.3 (tek sıra duvar + su dolgusu + hesap düzeltmeleri)

- [x] **T1.** Duvar yüksekliği 1-2-3-2-1 hatası: komşu-mühürleme kaldırıldı →
      TÜM kolonlar TEK sıra (1 blok) taş duvar.
- [x] **T2.** Su kolonları: duvar altı **5 sıra TOPRAK bedava otomatik dolgu**
      (sandıktan düşmez), üzerine tek sıra taş duvar.
- [x] **T3.** Fener hesabı: eski "4 köşe" sabiti yerine outline'ın GERÇEK köşe
      (dönüş) sayısı; meşale = kalan/spacing; kapı = yol grubu sayısı.
- [x] **T4.** `/cv:bounds dist <2-30>` → wallOffset (ev-duvar uzaklığı), rescan ile uygulanır.

- [ ] **H1.** Ev tespitinde "çatı bloğu / duvar kalınlığı" taraması eklenmeli mi? (performans maliyeti)
- [ ] **H2.** Izgara meşale görselliği: her meşaleye küçük bir dikme animasyonu (sandık→el→blok)?
- [ ] **H3.** Köy genişledikçe sandık notunun otomatik güncellenmesi (yeniden lore yazımı).
- [ ] **H4.** Sınır çizgisini kalıcı "hayali" gösterim (scoreboard/particle loop) opsiyonu.

# ============================================================
# V2 — YAŞAYAN KÖY EKONOMİSİ (PLAN_v2.1 sprintleri)
# Kaynak: Clever Villagers/PLAN_v2.md (revize plan, karar logu §25)
# ============================================================

## SPRINT 0 — Spike & doğrulama
- [x] **V0.1** Tarif item id'leri vanilla-data 1.26.51 ile doğrulandı (32/32 OK)
- [x] **V0.2** lit_furnace / lit_blast_furnace / lit_smoker permutation mevcut (görsel smelt OK)
- [x] **V0.3** Komut kararı: custom commands (scriptevent değil, cheats-kapalı uyumlu) — A1
- [x] **V0.4** Order paper: registry+lore birincil, ItemStack dynProp opsiyonel — C1
- [ ] **V0.5** Courier impulse eşiği prototipi (Sprint 3'te)

## SPRINT 1 — Depo + stok çekirdeği
- [x] **V1.1** cv2/core/container_utils.js (count/canRemove/removeExact/canAdd/addSafe/move, all-or-nothing+rollback)
- [x] **V1.2** cv2/core/village.js (VillageCore id=bellKey, shard persistence, reload restore)
- [x] **V1.3** cv2/core/depot.js (4 depo türü, physical/reserved cache, event-invalidate, 20t/200t scan)
- [x] **V1.4** cv2/core/ledger.js (append-only halka + /cv:validate mutabakatı)
- [x] **V1.5** cv2/core/scheduler.js (round-robin 20t, chunk-loaded köyler)
- [x] **V1.6** cv2/commands.js (setup, depo ekleme, stock, status, validate, debug, log; restricted-defer)
- [x] **V1.7** v1 engine/main entegrasyonu
- [ ] **V1.8** SAHA TESTİ (kullanıcı): 64 cobblestone koy → /cv:stock → 64; eksik consume → hiçbir şey eksilmesin

## SPRINT 1.5 — Saha düzeltmeleri (v2.0.1)
- [x] **V1.9** NamespaceNameError: Bedrock add-on başına TEK komut namespace'i izin veriyor →
      tüm ekonomi komutları `cv:*` altına taşındı (setup/warehouse/food/fuel/construction/
      stock/status/validate/verbose); cv:log silindi (cv:log ortak havuzu kullanıyor).
- [x] **V1.10** Recipe uyarısı: toolkit tarifine `unlock` (clock|torch) eklendi (1.20+ şema).

## SPRINT 1.6 — v2.0.2 saha düzeltmeleri
- [x] **V1.11** Kırılma olayı: `ev.block` kırılmdan SONRAKI hava bloğuymuş → `brokenBlockPermutation.type.id`
      kullanıldı; "depo bloğu kırıldı" artık gerçekten yazıyor.
- [x] **V1.12** FREE-CLONE BUG (kritik): slot 1'e inince setItem(undefined) bu derlemede slotu
      boşaltmıyordu → tüketim başarılı sanılıp sonsuz bedava duvar üretiyordu. Çözüm:
      clearSlot() fallback zinciri (undefined→container.setItem→air stack) + işlem sonrası
      ADET DOĞRULAMA + başarısızsa rollback (container_utils + bridge).
- [x] **V1.13** Çan yanına otomatik sandık KALDIRILDI; tüm inşaat/meşale malzemesi
      **construction depot**'tan (/cv:construction add); not kağıdı da oraya yazılır
      (cv/integration_construction_bridge.js). Depo yoksa uyarı yol gösterir.
- [x] **V1.14** Köşe sorunu: devriye yalnız "iki yanı örülü" kolonları onardığı için hat köşeye
      varamıyordu → devriye artık İNŞAAT CEPHESİNDEN büyütür (≥1 örülü komşu) + köşeler her zaman aday.
- [x] **V1.15** Fener iptal (kullanıcı kararı): köşe tepeleri dahil YALNIZ meşale.
- [x] **V1.16** Marka/namespace: tüm komutlar `cv:*`, item `cv:toolkit`, anahtarlar `cv:*`,
      log `[CV]`, pack adları "Clever Villagers BP/RP"; Regrowth yalnız kredi satırında.
      Recipe unlock (clock|torch) eklendi. NamespaceNameError kökü: add-on başına TEK namespace.

## SPRINT 2 — Recipe + Order (v2.1.0) ✅
- [x] **V2.1** cv/core/recipe.js: 18 tariflik registry (PLAN §6.3), alternatives (coal/charcoal),
      batch hesabı materialNeed(qty) → cycles/produced/needs.
- [x] **V2.2** cv/core/workshop.js: atölye kaydı (job-block doğrulamalı), link input/output/order/fuel
      (sistem ASLA sandık koymaz — hardcore kural), shard kalıcılığı, isValid.
- [x] **V2.3** cv/core/order.js: sipariş kaydı + shard; order paper (cv:order_paper, lore+nameTag=#id),
      order chest taraması 40t, doğrulama zinciri (recipe→workshop→jobblock→worker(yakın değilse
      waiting_worker, B2)→food→malzeme→output yer), kağıt lore'u yerinde güncellenir,
      kağıt sandıktan çıkarsa suspended_no_paper, cancel.
- [x] **V2.4** Komutlar: /cv:workshop add|link|list|remove · /cv:order give|list|status|cancel.
- [x] **V2.5** Scheduler: economyTick içine order taraması (40t) bağlandı.
- [x] **V2.6** RP: cv_order_paper dokusu (16x16 pixel art) + atlas + TR/EN lang.
- [ ] **V2.7** SAHA TESTİ: order give toolsmith stone_pickaxe 2 → kağıdı order sandığına koy →
      status: waiting_materials (eksik listesi lore'da) → depoya 6 cobble+4 stick koy → ready.

## SPRINT 2.5 — v2.1.2 saha düzeltmeleri (27.09)
- [x] **W1.** `wrong_job_block: undefined`: komut register'a konum veriyordu → artık blok nesnesi.
- [x] **W2.** YOL MOTORU v3 (güvenlik baştan): kolon sınıfları road/natural/**structure**;
      structure'a ASLA dokunulmaz (ev traşlama felaketi bitti), natural yalnız YÜKSELTİLİR
      (kazınmaz), kesitte structure varsa tüm kesit pas geçilir, kapı-önü tesviye+kilit
      ÖZELLİĞİ KALDIRILDI (kullanıcı kararı), boyuna eğim 1 basamak/pas, 10 blok alt dolgu korundu.
- [x] **W3.** Cam LEVHA (pane) artık ev işaretçisi; çan her zaman sınıra dahil;
      "≥3 meşaleli soyulmuş meşe kütüğü" = aydınlatma direği işareti (kind 4);
      küme zinciri 6→10 + birbirine ≤2 değen ev kutuları birleştirilir (iki odalı ev tek ev).
- [x] **W4.** Statik denetim protokolü: import-hedef varlığı + **export-import eşleşme**
      kontrolcüleri her derlemede çalışır (ikisi de 0 hatayla geçti).
- [ ] **W5.** DETAYLI SAHA TESTİ (aşağıdaki liste)

### v2.1.2 test listesi (kullanıcı)
1. Giriş: script hatası yok; `/cv:status` köyü gösterir.
2. Harita: evler cam levhalı odalarıyla DAHİL (duvar ev ortasından geçmez), çan sınır içinde,
   aydınlatma direkleri sınırı genişletir; `/cv:bounds on` ile gözle doğrula.
3. `/cv:roads on`: evlerin yanında yol düzeltmesi DENEMESİ bile ev bloklarına dokunmaz;
   yoldaki çukurlar/otlar/kot farkları köylü gezdikçe onarılır; 3'lü kesit tek kotta kalır.
4. `/cv:workshop add toolsmith` (smithing_table'a bakınca) → kayıt OK mesajı; `link` adımları OK.
5. `/cv:order give toolsmith stone_pickaxe 2` → kağıt envantere; order sandığına koy →
   `waiting_materials` + lore'da eksikler → malzemeyi koy → `ready`.
6. `/cv:validate` → mutabakat TEMİZ; depo sandığı kır → log/chat uyarısı.

## SPRINT 2.6 — v2.1.3 (27.09 saha turu, eksiksiz)
- [x] **X1.** Çan sınır dışında kalıyordu → çan artık birleşime **wallOffset (2-30) payıyla** dahil
      (`/cv:bounds dist N` ile ayarlı).
- [x] **X2.** Asimetrik sınır (bir yüzde 10, diğer yüzde 30): ev kutusu marker bbox'ıydı →
      yeni **refine fazı**: her ev kutusu gerçek yapı bloklarına (tahta/kütük/cam/merdiven...)
      doğru bir kez genişletilir → offset bina duvarından itibaren simetrik.
- [x] **X3.** Aydınlatma direği: kullanıcı düzeltmesi — blok **soyulmuş meşe ODUNU**
      (`stripped_oak_wood`); hem odun hem kütük kabul edilir + ≥3 meşale koşulu.
- [x] **X4.** İş gücü organizasyonu: **jobs.js dispatch** — tek impulse sahibi; öncelik
      duvar > yol > ışık (sipariş üretimi Sprint 6'da en üste eklenir); köylü atandığı işe
      yürür, varınca çalışır, bitince **en yakın sonraki işe** geçer; akşam (12500+) atamalar
      temizlenir, köylüler evine gider. Yol işleri köy çekirdeğinde artımlı taranır (240t).
- [x] **X5.** Yol motoru v4 (terras-kaosu bitti): YALNIZ yol kolonları yükseltilir/alçaltılır;
      natural yalnız KARŞI-ÇİFT yol komşulu kopuklukta dönüştürülür (yana genişleme YOK);
      kesit = 3'lü sıradaki yol hücrelerinin medyanı (resim 2 sol→sağ); boyuna ≥2 farkta
      pas başına 1 basamak (resim 1 rampa); structure ASLA.
- [x] **X6.** workshop register log'undaki `jobBlock` tanımızsız değişken hatası düzeltildi.
- [x] **X7.** Statik denetimler: import yolu + export-import eşleşmesi = 0 hata; 24 modül syntax OK.
- [ ] **X8.** DETAYLI SAHA TESTİ (aşağıda)

### v2.1.3 test listesi
1. Giriş temiz; `/cv:status`, `/cv:info` çalışır.
2. Harita: çan sınır İÇİNDE (offset payıyla); evler simetrik payla; levhalı odalar dahil;
   soyulmuş odun+3 meşale direkleri sınırı genişletir; `/cv:bounds on` görsel doğrulama.
3. `/cv:workshop add toolsmith` → "atölye kaydedildi @ x,y,z" (hata YOK).
4. `/cv:roads on`: köylüler yol işlerine ATANIR (yürüyen köylü + yol başında çalışma);
   evler/çitler/sandıklar ASLA değişmez; kot farkları zamanla 1'er basamak rampaya oturur;
   yana yeni yol şeridi çıkmaz.
5. `/cv:walls on`: crew duvar kolonlarına atanır, tek sıra örülür, köşeler kapanır.
6. Sipariş zinciri (Sprint 2 testi): give→kağıt→order sandığı→waiting_materials→ready.
7. `/cv:validate` TEMİZ; depo kırma uyarısı; akşam köylüler işi bırakır.

## SPRINT 2.7 — v2.1.4 (yönlendirme & durum tablosu turu, 28.09)
- [x] **Y1.** Draft kağıdı "eksik yok" diyordu → kağıt artık ÜRETİM anında gerekenleri ve
      DEPODAKİ CANLI SAYIYI yazar ("6x cobblestone (depoda 0)"), her taramada tazelenir.
- [x] **Y2.** `/cv:status` = DURUM TABLOSU: depolar (blok sayısı + eksik uyarısı), atölyeler
      (job✓/kırık, linkler ✓/—, yakındaki işçi sayısı), haritada bulunan MESLEK BLOKLARI
      (konum + hangi atölyeye denk), sipariş özeti + **NEXT-STEPS rehberi** (eksik link/kayıt
      başına tam komut satırı).
- [x] **Y3.** Harita taraması meslek bloklarını da saklar (composter/smithing/blast/furnace/
      smoker/stonecutter/crafting/lectern/loom/cauldron/fletching/cartography/barrel, ≤200).
- [x] **Y4.** Bayat mesajlar temizlendi: "sarı yün"→yeşil parıltı, "kapı önleri kilitli"→
      "yapılar dokunulmaz / 3 genişlik kesit + rampa" (grep doğruladı: 0 kalıntı).
- [x] **Y5.** makePaper(v, order) imza uyumu (commands çağrısı düzeltildi).
- [ ] **Y6.** SAHA TESTİ: status tablosu yönlendirmesiyle toolsmith zincirini baştan kur.

## SPRINT 2.8 / 6-ÖNE-ÇEKİLDİ — v2.2.0 (depo-odaklı sadeleştirme + ÜRETİM MOTORU)
- [x] **Z1.** KÖK NEDEN (ready'de kalma): üretim motoru Sprint 6'daydı, Sprint 2 sadece doğrulamaydı.
      Meslek hipotezi kısmen yanlış: doğrulama yakınlık bakıyordu; ayrıca Bedrock'ta crafting_table
      job-site DEĞİL → toolsmith mesleği hiç oluşmazdı. Çözüm: üretim motoru ÖNE ÇEKİLDİ,
      işçi ataması dispatcher'dan (sipariş en yüksek öncelik).
- [x] **Z2.** KARMAŞIKLIK KALKTI (kullanıcı tasarımı): atölye = SADECE iş bloğu.
      input/output/order/fuel linkleri KALDIRILDI (`link` komutu açıklama mesajı verir).
      Malzeme warehouse+construction'dan, yakıt fuel'dan, yiyecek food'dan; ürün türüne göre
      otomatik depoya (food/fuel/construction/warehouse yönlendirme tablosu).
- [x] **Z3.** Sipariş kağıdı ARTIK HERHANGİ BİR depo sandığında geçerli (hepsi taranır).
- [x] **Z4.** Üretim döngüsü: işçi ≤2 blokta → stok re-check → all-or-nothing tüketim (ledger) →
      workTicks (lookAt + partikül) → ürün depoya → sipariş ilerlemesi → kağıt lore güncel.
      İşçi 10 sn ayrılırsa TAM İADE (kayıp yok, watchdog).
- [x] **Z5.** Öncelik zinciri: sipariş > duvar > yol > ışık (jobs.js).
- [x] **Z6.** /cv:status sadeleşti (link sütunları yok), next-steps depo/kağıt odaklı.
- [ ] **Z7.** SAHA TESTİ: tek sandıkla tam zincir (aşağıda).

### v2.2 test listesi
1. `/cv:setup` → `/cv:warehouse add` (tek sandık yeter) → `/cv:workshop add toolsmith` (crafting table'a bak).
2. Malzemeyi (6 cobblestone + 4 stick) warehouse'a koy → `/cv:order give toolsmith stone_pickaxe 2`
   → kağıdı AYNI warehouse sandığına koy → `/cv:order list`: waiting→ready→**in_progress**→completed.
3. Üretim anında köylü crafting table başında durup bakmalı; bitince 2 stone_pickaxe warehouse'ta.
4. Köylüyü üretimdeyken uzaklaştır (örn. gece) → iade logu + order ready'ye döner.
5. `/cv:stock` ve `/cv:validate` tutarlı; `/cv:status` next-steps temiz.

## SPRINT 3 — v2.3.0 (rezervasyon + fiziksel taşıma + gerçek fırın + çiftçi + iptal)
- [x] **S3.1** `save is not defined` (createOrder) → saveOrders düzeltmesi; denetçiye
      "yerel tanımsız değişken" taraması eklenmeli (ders).
- [x] **S3.2** KISMİ SİPARİŞ: doğrulama artık TEK batch (outputCount) ister → "20 ekmek ama
      9 buğday var" durumunda 3 ekmek yapılır, buğday geldikçe sipariş kendiliğinden devam eder.
      Kağıt lore'unda "Üretim: X/N" ilerlemesi.
- [x] **S3.3** REZERVASYON: ready olan sipariş batch malzemesini depoda rezerve eder
      (available = physical − reserved) → iki sipariş aynı stoğu çakıştıramaz; consume/iptal/
      tamamlama/askıya almada serbest bırakılır.
- [x] **S3.4** FİZİKSEL ÜRETİM BACAKLARI: fetch (depoya yürü → malzemeyi orada tüket →
      "Taşıyıcı" nameTag) → work (istasyona yürü) → deliver (depoya yürü → ürünü bırak).
      Carry manifest dynamic property'de: reload/işçi kaybı/iptal = TAM İADE.
- [x] **S3.5** GERÇEK ERİTME: furnace/blast/smoker iş bloğunda input slot 0 + yakıt slot 1'e
      FİZİKSEL yükleme → vanilla motor eritir → output slot 2 poll edilir → külçeler taşınır.
      (Crafting masası tarifleri Bedrock limiti gereği script dönüşümü + gerçek tüketim kalır.)
- [x] **S3.6** ÇİFTÇİ İŞİ: olgun mahsul (wheat/carrots/potatoes/beetroot) taranır, köylü
      yürür, hasat → food deposuna koyar, depoda TOHUM varsa gerçekten tüketip yeniden eker.
      Öncelik: sipariş > çiftçi > duvar > yol > ışık.
- [x] **S3.7** İPTAL TASARIMI: `/cv:order cancel <id|all>` → uçuştaki malzeme/fırın yükü
      depoya iade + rezervasyon serbest; kağıdı sandıktan çekmek = askıya al (iptal değil,
      geri koyunca devam).
- [ ] **S3.8** SAHA TESTİ: 20 ekmek/9 buğday kısmi akış; 10 bakır külçe gerçek fırın akışı
      (köylü: sandık→ocak→sandık); çiftçi hasadı; cancel-all iadesi; validate TEMİZ.

## SPRINT 3.5 — v2.4.0 (öncelik modeli + hareket kök nedeni + körük ekmeği)
- [x] **S4.1** KÖK NEDEN "ready'de kalıyor": cycle başlıyor ama işçi depoya varamıyordu
      (0.2/30t impulse, gündüz vanilla AI'ya yenik) + watchdog 12sn'de öldürüp yeniden
      başlatıyordu → sonsuz başla-iptal devri; rezervasyon duruyor, kimse gelmiyordu.
      Çözüm: 0.45/10t direksiyon + 60sn'de yol bulamazsa işe TEK seferlik ışınlama (loglu)
      + watchdog 60sn.
- [x] **S4.2** ÖNCELİK MODELİ (kullanıcı doğrusu): tehdit(yuva) > KENDİ mesleğinin siparişi >
      kendi asli üretimi (çiftçi→tarla) > başka siparişler > duvar > yol > ışık.
      Meslek eşlemesi: job-site bloğu taraması (13 meslek) ↔ atölye tipi.
- [x] **S4.3** "Üretim her şeyden önce": köy TALEP MONİTÖRÜ (600t): food<24→cook bread/potato/beef,
      fuel<16→fueler charcoal, torch<16→forester torch, stick<16→forester stick,
      raw_iron/copper≥4→smelter ingot → kağıtsız iç sipariş (requester=village), askıya-alma muaf.
- [x] **S4.4** Ekmek KÖRÜKTE: cook job blokları = smoker/furnace/campfire (crafting table kalktı);
      bread tarifi smoker istasyonunda (script modu); vanilla çiftleri (potato→baked, et→cooked,
      log→charcoal, raw→ingot) GERÇEK fırın modunda kalır.
- [x] **S4.5** waiting_* durumları artık döngü tarafından yeniden denenir (malzeme gelince kendiliğinden devam).
- [ ] **S4.6** SAHA TESTİ: smoker'a bak→add cook→9 buğday→order bread 20→kısmi üretim→devam;
      smelter gerçek eritme; çiftçi hasat; cancel-all iadesi; validate.

## SPRINT 3.6 — v2.4.1 (lit-blok + rezervasyon kilidi + makine süpürme)
- [x] **S5.1** KÖK NEDEN: yanan smoker/furnace = `lit_*` blok; JOB_BLOCKS'ta yoktu → atölye
      "kırık" (station_invalid), cycle kurulamadı ("ready'de kaldı"), işçi hiç yola çıkmadı.
      Lit varyantlar tüm makine mesleklerine eklendi.
- [x] **S5.2** Rezervasyon kilidi: status geçişlerinde (station_invalid/waiting/failed/suspend)
      release yoktu → "reserved 3 > physical 0" ve "9 buğday var 6 görünüyor"
      (available = physical − reserved). Çift emniyet: geçişte release + refresh'te
      reserved ≤ physical clamp'i (kilit kendini onarır).
- [x] **S5.3** Makine çıkışı süpürme işi: oyuncunun/vanilla'nın pişirdiği ürün ocak çıkış
      slotunda kalıyordu → artık köylü ATANIR, yürür, çıkışı alıp doğru depoya koyar
      (ledger "collect" kaydı). Öncelik zincirinde (2.5) sırada.
- [x] **S5.4** Kağıt lore'undaki bayat "order sandığına koy" satırı → "herhangi bir DEPO sandığına koy".
- [ ] **S5.5** SAHA TESTİ: körükte ekmek zinciri uçtan uca; oyuncu pirzola pişirir → köylü toplar;
      /cv:validate TEMİZ; /cv:stock reserved sütunu tutarlı.

## SPRINT 3.7 — v2.4.2 (rezervasyon görünürlüğü + depo önceliği + çiftlik alanı)
- [x] **S6.1** "9 buğday → depoda 6" gizemi: kağıt available(=physical−reserved) gösteriyordu,
      yani sipariş KENDİ rezervesini kendinden düşüyordu. Artık lore/stok FİZİKSEL sayıyı +
      "rezerven N" ayrımını yazar; yeterlilik hesabı kendi rezervesini dahil eder.
- [x] **S6.2** Depo önceliği (kullanıcı tasarısı): yiyecek önce FOOD, yakıt önce FUEL,
      inşaatlık önce CONSTRUCTION, gerçi warehouse → sonra yedekler (depotPriority/availableSmart).
- [x] **S6.3** Çiftlik taraması çekirdek(ev) alanından SUR içi alana genişletildi (tarlalar
      ev kutuları dışında kalıyordu); hasat deposu food→warehouse fallback (ürün asla yok olmaz).
- [x] **S6.4** Hareket: hop fallback 30sn'ye çekildi + doğru Y ile ışınlama; watchdog 60sn.
- [x] **S6.5** /cv:diag: atama/döngü/rezerv/depo cache anlık görüntüsü (uzaktan teşhis).
- [x] **S6.6** İç siparişler listede §8[köy]§7 etiketiyle (kullanıcının gördüğü "8x bread"
      köyün kendi talebiydi — tasarım gereği, artık etiketli).
- [ ] **S6.7** NOT: vanilla çiftçi köylüler Bedrock'ta KENDİLİĞİNDEN hasat/ekim yapar ve ürünü
      ceplerinde tutar — bu mod hatası değil, vanilla AI. İstenirse sonraki turda villager
      davranış JSON override'ı ile kapatılır (tartışmaya açık).
- [ ] **S6.8** SAHA TESTİ: ekmek zinciri + diag çıktısı.

## SPRINT 3.8 — v2.4.3 (sessiz katil + rezervasyon depo körlüğü)
- [x] **S7.1** SESSİZ KATİL: refreshFarmJobs, harita done değilken rect=null → dispatch HER tick
      çöküyordu (engine try/catch yutuyordu) → hiçbir atama çalışmıyordu. Guard + pickJob try/catch.
- [x] **S7.2** reserveBatch yalnız warehouse+construction'a bakıyordu; buğday food'daydı → res=[].
      Artık depotPriority sırasıyla rezerve eder.
- [x] **S7.3** Oyuncu aynı iş+item'e sipariş verince köy talebi otomatik iptal (çift sipariş kafa karışıklığı).
- [x] **S7.4** Üretimde oyuncu siparişi köy talebinden ÖNCE işlenir.
- [x] **S7.5** Lore: "3x wheat (depoda 9)" = batch ihtiyacı + fiziksel stok; artık "kalan toplam" satırı da var.
- [x] **S7.6** /cv:diag genişletildi: aktif cycle'lar (leg/idle/carry), dispatch sayaçları, atamalar.

## SPRINT 4+5 — v2.5.0 (OTONOM KÖY DÖNGÜSÜ + bölgeler)
- [x] **S8.1** Otonomi halkası kapandı: çiftçi olgun ekinleri hasat edip food'a koyar,
      buğdaydan TOHUM da depolar, boş farmland'a depodan GERÇEK tohum tüketerek eker
      (ek→büyü→hasat→tohum+ürün→cook→food→işçiler yer).
- [x] **S8.2** Bölge sistemi: /cv:quarry pos1|pos2 ve /cv:forest pos1|pos2 (shard'da saklı).
      Ormancı işaretli ormanda kütük keser (depodan fidan varsa diker), madenci işaretli ocakta
      taş/cevher kırar (loot tablosu: stone→cobble, ore→raw_X...) → doğru depoya.
- [x] **S8.3** Talep monitörü genişledi: plank<16 & log≥1 → forester plank siparişi.
- [x] **S8.4** Regresyon protokolü: setItem(undefined)/lit_*/save()/rect-null/alias desenleri grep ile
      her derlemede taranır (bu turda L/LG alias hatası böyle yakalandı).
- [ ] **S8.5** BİRLEŞİK SAHA TESTİ (aşağıda).

### v2.5.0 birleşik test listesi
1. Giriş temiz; /cv:diag → dispatch last=artıyor, errors=0.
2. Ekmek zinciri: smoker+cook, 9 buğday (warehouse VEYA food), kağıt → köylü depoya yürür →
   3 buğday düşer → körükte çalışma → ekmek food'a → lore Üretim 3/20 + kalan toplam satırı.
3. Otonomi: food<24 & wheat≥3 iken köy kendi [köy] siparişini açar; oyuncu aynı siparişi verince
   köy talebi iptal olur (listeden kaybolur).
4. Çiftçi: olgun buğdayı hasat→food; buğday tohumu warehouse'a düşer; boş tarlaya tohum eker
   (tohum deposundan eksilir).
5. Bölge: /cv:forest pos1/pos2 işaretle → ormancı kütük keser→warehouse; /cv:quarry ile
   madenci cobble/ore getirir.
6. /cv:validate TEMİZ; /cv:stock tutarlı; reserved hiçbir zaman physical'i aşmaz.

## SPRINT 5.5 — v2.5.2 (sipariş UX + oto-atölye + scope hatası)
- [x] **S9.1** KÖK NEDEN draft kilidi: "kalan toplam" lore satırı YANLIŞLIKLA validateOrder içine
      girmişti (`order` parametresi orada `o`) → her doğrulama ReferenceError fırlatıp yutuluyordu.
      Satır doğru yere (needLines) alındı; validateOrder temiz.
- [x] **S9.2** /cv:diag: cycleDump production'da hiç yokmuş + PR alias → artık tam döküm.
- [x] **S9.3** Sıralı sipariş numarası: #1, #2, #3... (kağıt nameTag #N, liste #N,
      `/cv:order cancel 3`, `/cv:order status 3` kabul eder). Eski id'ler de geçerli.
- [x] **S9.4** Sipariş verilir verilmez sohbette STOK ÖZETİ (var/yok satırları) — kullanıcı
      tasarımı; ayrıca sert red yerine hibrit: sipariş oluşur + eksikler duyurulur +
      malzeme gelince OTOMATİK devam (kısmi üretim gereği).
- [x] **S9.5** Atölye yoksa `failed` yerine `waiting_workshop` → atölye eklenince kendiliğinden devam.
- [x] **S9.6** OTO-ATÖLYE: bell add/rescan taramasındaki meslek blokları köye otomatik kaydedilir
      (tip başına maks 2; composter→farmer, smithing→toolsmith, grindstone→weaponsmith,
      blast/furnace→smelter, smoker→cook, stonecutter→mason, crafting→forester).
      Sonradan kurulan masalar: /cv:rescan ile otomatik veya /cv:workshop add ile manuel.
- [x] **S9.7** Log kapasitesi 512 + /cv:log 200 satıra kadar; DOSYA için: Ayarlar>Creator>
      "Content Log File" → content.log tüm [CV] satırlarını içerir (ekran görüntüsü yerine dosya at).
- [ ] **S9.8** SAHA TESTİ: #numara akışı, draft→ready→in_progress, oto-atölye mesajı, diag tam.
      → 29.09 testi: BAŞARISIZ (aşağıdaki kök nedenler v2.5.3'te kapatıldı).

## SPRINT 5.6 — v2.5.3 (dispatch'i felç eden alias hatası + kağıt/id uyuşmazlığı)
Kullanıcı raporu (29.09): diag "not a function"; sipariş ready→suspended_no_paper salınımı
(kağıt DEPODA olduğu hâlde); "station invalid"; ilk taramada atölyeler gelmiyor;
forest/quarry hiç çalışmıyor; validate TEMİZ.
- [x] **S10.1** KÖK NEDEN #1 (felç): jobs.js `orderTargetFor` içinde `W.isValid(...)` — ama
      jobs.js'te W = walls.js (isValid yok!), atölye modülü WS. Atölye kaydı olduğu anda
      pickJob ADIM 1'de TypeError → try/catch yutuyor → TÜM iş tipleri (order/farm/sweep/
      zone/wall/road/light) ölüyor. `WS.isValid` düzeltildi. (Forest/quarry'nin "hala"
      çalışmamasının asıl sebebi buydu.)
- [x] **S10.2** KÖK NEDEN #2: jobs.js `W.rectOf` walls.js'te hiç yokmuş → farm jobs da ölü.
      walls.js'e `rectOf` (sur hattı dikdörtgeni) export'u eklendi.
- [x] **S10.3** KÖK NEDEN #3 (kağıt salınımı): tickOrders kağıdı bulunca Set'e SIRALI NUMARAYI
      ("2") koyuyor, askıya alma kontrolü `o.id` ("o10581_tph") arıyordu → kağıt depoda olsa
      bile her döngü ready→suspended. Set'e artık ÇÖZÜMLENMİŞ sipariş id'si giriyor.
- [x] **S10.4** KÖK NEDEN #4 (diag): `PR.cycleDump` production.js'te hiç yokmuş → diag
      order listesinden sonra "not a function". cycleDump eklendi + diag'ın HER bölümü
      ayrı try/catch (tek bölüm raporu öldüremez) + atölye ✓/✗ ve zone satırları eklendi.
- [x] **S10.5** "station invalid" kilitlenmesi: validateOrder ilk kayıtlı atölyeyi alıyordu
      (kırık/çift kayıt üretimi blokluyordu). `W.findValid` eklendi: önce GEÇERLİ istasyon
      seçilir; station_invalid artık kağıt taramasında yeniden doğrulanıp kendiliğinden
      iyileşir; `/cv:workshop list` ✓/✗ + remove önerisi gösterir; aynı blok çift kaydedilemez.
- [x] **S10.6** İLK TARAMA KURALI (kullanıcı emri): atölye senkronu artık bell add, /cv:setup
      VE 600 tick'lik periyodik senkrondan da çağrılıyor — harita setup'tan önce bitse bile
      iş istasyonları köye tanıtılır. (syncWorkshopsFromMap idempotent.)
- [x] **S10.7** Süpürme (sweep) işi: jobs.js `P.machineOutputs`/`P.collectMachine` ÇAĞIRIYORDU
      ama production.js'te yoktu (step 2.5 her köylüde patlıyordu). İkisi de gerçek
      implementasyonla eklendi: boşta fırının çıkış yuvası → köylü yürür → depoya bankalar
      (dolarsa kalan yuvaya iade, yok olma yok).
- [x] **S10.8** Bölge cilası: yüksüz chunk kolonları atlanıp sayılıyor (diag'da görünür),
      zone seçim yarıçapı 64→96 (uzak orman/ocak + hop-teleport), quarry artık üst örtüyü
      (grass/dirt/gravel/sand/andesite...) şerit hâlinde soyar → cevher gövdesine iner,
      /cv:diag'a zone satırı (rect/iş/yüksüz) eklendi.
- [x] **S10.9** Yeni statik bekçi: check_ns.py — TÜM `NS.üye` erişimleri + named import'lar
      hedef modülün export listesiyle eşleştirilir (W.isValid/WS.isValid sınıfı hatalar
      bir daha derlemede geçer). 26 dosya temiz + node --check temiz + regresyon grep temiz.
- [ ] **S10.10** SAHA TESTİ v2.5.3 (aşağıdaki liste).

### v2.5.3 test listesi (taze dünya)
1. `/cv:bell add` → harita bitince "Harita taraması N atölyeyi otomatik kaydetti" mesajı;
   `/cv:workshop list` → hepsi §a✓ (✗ görürsen o satırı bana gönder).
2. `/cv:setup` + 4 depo → `/cv:order give smelter copper_ingot 5` → kağıdı depo sandığına koy →
   40-80 tick içinde `/cv:order list` → `ready` DEĞİL `in_progress`; köylü depoya yürür,
   malzeme eksilir, fırın yanar (lit_furnace), çıkış → teslim → `#N ... completed` + sohbet mesajı.
3. Kağıdı depodan GERİ al → `suspended_no_paper`; geri koy → kendiliğinden `in_progress`.
4. `/cv:diag` → TAM rapor: order/cycle/workshop/zone/dispatch/depot satırları, "not a function" YOK.
   dispatch last= artıyor, errors=0; assign satırlarında order/farm/forest/quarry tipleri görünür.
5. `/cv:forest pos1|pos2` (ağaçlık yer) + `/cv:quarry pos1|pos2` → diag zone satırı `iş=N` (>0);
   köylüler bölgeye gider (gerekirse ışınlanır), `/cv:stock`'ta log/cobble/ore birikir.
6. Fırına manuel 1 kömür + 1 raw_iron koyup yak → çıkıştaki ingot'u bir köylü bankalar
   (sweep) → stock'ta iron_ingot.
7. `/cv:validate` TEMİZ; `/cv:log 60` içinde TypeError/"not a function" YOK.

## SPRINT 6-8 — Toolsmith kanıt cila · Mason bridge · GUI sipariş menüsü + polish
## SPRINT 4 — Farmer→Cook→Food ## SPRINT 5 — Forester + Smelter
## SPRINT 6 — Toolsmith kanıt   ## SPRINT 7 — Mason + Bridge
## SPRINT 8 — Polish


---

## v2.6.0 — "Sessiz ölüm" turu (29.09 saha testi bulguları)

- [x] **S10.10** SAHA TESTİ v2.5.3 yapıldı → 4 kök neden bulundu (aşağıda).
- [x] **S11.1 KATİL BUG #1 — dispatch hiç çalışmıyordu (`dispatch: last=-1`, sipariş `ready`'de donuk).**
      Kök neden: engine.js'teki 12t'lik "boost" interval'i `J.dispatch(...)` çağırıyordu ama
      jobs.js HİÇ import edilmemişti (`J` tanimsiz). ReferenceError her tick'te iç try/catch'te
      YUTULUYORDU → sipariş döngüsü (fetch/work/deliver), duvar/yol/ışık iş gücü, bölge işleri
      topyekûn ölüydü; ekonomi tick'i yaşadığı için siparişler sadece `ready`'ye kadar geliyordu.
      Çözüm: boost interval'i kaldırıldı; dispatch kendi kendini onaran mainLoop'a taşındı
      (20t'de bir, `W.getBells()` üstünden). engine.js'e `import * as J` eklendi.
- [x] **S11.2 KATİL BUG #2 — walls.js `C.needsSummary/C.dropNote` hayalet çağrı.**
      `C` modülde yok, fonksiyonlar hiç var olmamış → her harita tamamlanmasında ReferenceError.
      Çözüm: gerçek köprü API'si (`B.writeNote`) + satır hesabı walls.js içinde, try/catch'li.
- [x] **S11.3 Bölge (forest/quarry) "zone set" deyip kaydolmuyordu.**
      Kök neden: köşeler YALNIZCA world dynamic property'de tutuluyordu; yazma sessiz başarısız
      olursa bellekte hiçbir iz kalmıyordu (komut yine "zone set" dönüyordu).
      Çözüm: çift katman — bellek aynası (her zaman çalışır) + dynamic property (read-back
      doğrulamalı). `/cv:forest show|clear` eklendi; diag zone satırı artık `p1✓ p2✓ kalıcı✓`
      gösterir; bölge komutları köyden 512 blok uzakta da çalışır (orman köyün dışında kalabilir).
- [x] **S11.4 `/cv:order status 2` çalışmıyordu.**
      Çözüm: findOrder tolerate ("#2"/"2"/id), argümansız `status` = en son aktif sipariş,
      bulunamazsa mevcut numaraları listeler; tek köy haritalıyken uzakta da komutlar çalışır
      (nearestVillage fallback).
- [x] **S11.5 TAŞIYICI MODELİ v2 (kullanıcı: "1'er adet taşıması saçma").**
      Köylü artık TEK seferlik SEFER planlar: depo stoku + taşıma slotu (8: malzeme başına 1
      stack + 1 yakıt stack'i) + fırının mevcut dolgusu izin verdiği kadar batch (örn. 32x
      raw_copper + 4x coal tek seferde). Rezervasyon da tek batch değil tüm sefer kadar
      (validateOrder execs≤32) → `/cv:stock` gerçek taahhüdü gösterir.
- [x] **S11.6 Fırın yakıt sürekçi kontrolü (kullanıcı: "ocakta 64 kömür birikirse döngü kırılmasın").**
      Köylü fetch'te fırının yakıt slotunu OKUR: içeride yeterli varsa hiç kömür taşımaz;
      64 yığılıysa sadece sığanı alır; yakıt getiremese bile içerideki yakıtla batch sayısını
      yeniden hesaplar → döngü asla kırılmaz. Fırın slotları artık ÜSTÜNE YAZMAZ, merge eder
      (yabancı stack varsa all-or-nothing iade + sonra yeniden dener).
- [x] **S11.7 Kömür yoksa kesilen ağaç yakıt/kömür olur (kullanıcı talebi).**
      doFetch yakıt tercihine log tail'i eklendi (o anki odunu yakar); demandMonitor charcoal
      siparişi artık SMELTER atölyesine (eskiden "fueler" diye hayalet bir tip vardı → o köy
      siparişi asla başlayamazdı); validateOrder yakıt kapısı log'ları da kabul eder.
- [x] **S11.8 Köy öz-yeter tampon stoğu (yemek+yakacak+alet).**
      demandMonitor eşikleri duruyor (food<24→ekmek, fuel<16→charcoal, torch<16) + YENİ:
      stone_pickaxe yoksa ve cobble+stick varsa toolsmith'e 1 adet tampon kazma siparişi.
- [x] **S11.9 Kısmi çıktı güvenliği:** fırında giriş+yakıt biter ama hedef dolmazsa 120t
      bekle-yıgıtla → kısmi çıktı toplanır, sipariş kalan batch'le devam eder; 2400t timeout'ta
      her şey iade VE `batchesDone=0` (sipariş hayalet ilerleme kazanmaz).
- [x] **S11.10 Yeni statik bekçi #2: check_undef.py** — tanimsiz identifer önekleri (`J.`, `C.`
      sınıfı) derlemede yakalanır; sentetik testle doğrulandı. node --check 26/26 + check_ns OK
      + check_undef OK + regresyon grep'leri temiz + manifestler [2,6,0] senkron + paket testzip OK.

### v2.6.0 test listesi (taze dünya veya mevcut dünya — mevcut dünya da olur)
1. Kurulum sonrası ilk `/cv:diag`: `dispatch: last=` ARTIK -1 DEĞİL (now'a yakın), assign/cycle
   satırları görünür; hata satırı YOK.
2. `/cv:order status 2` (veya `#2`, veya argümansız) → satır döner; yanlış numara yazınca
   mevcut numaralar listelenir.
3. `/cv:forest pos1` + `pos2` → cevapta "bölge AKTİF · kalıcı=evet"; `/cv:diag` zone satırı
   `§arect iş=N (p1✓ p2✓ kalıcı✓)`. 60-120t içinde köylüler ormana gider, `/cv:stock`'ta log birikir.
4. Sipariş akışı: kağıt depoda → `in_progress` → `/cv:diag` cycle satırı `leg=fetch/work/deliver
   execs=N hedef=M`; `/cv:log 60`'ta "malzeme alındı: 32x raw_copper + yakıt 4x coal → N batch".
5. Taşıma kalitesi: fetch'ten sonra depo sandığında raw_copper 64→(64-N) TEK seferde düşer;
   fırın giriş slotunda N adet, yakıt slotunda kömür; çıkışta N ingot → teslim → stock.
6. Yakıt döngüsü: fırın yakıt slotuna manuel 64 kömür koy → köylü hiç kömür taşımaz (log'da
   yakıt yok), eritme devam eder; slot boş ve depoda kömür yoksa log taşır (odun yakıt).
7. `/cv:validate` TEMİZ; `/cv:log 120` içinde TypeError/ReferenceError/"not a function" YOK.
8. Gece olunca işçiler eve gider (assign temizlenir) — gündüz kaldıkları yerden devam.

---

## S12) v2.7.0 — 29.09 SAHA TESTİ #2 (kullanıcı bildirimleri birebir)

- [x] **S12.1 "Köylü neden kendi kendine copper ingot eritiyor?"** → 💬 Açıklama: `[köy]`
      etiketli siparişler köyün öz-yeter talebi (PLAN v2.1 onaylı özellik). AMA külçe
      fazlalığı şikâyeti ayrı bir BUG'dı (S12.2) ve köy talebi artık stok-aware (S12.4).
- [x] **S12.2 KÜLÇE FAZLALIĞI (4 bakır+2 kömür+14 ekmek → 611 külçe; sonra 5 ham → 445).**
      İki ayrı duplikasyon bug'ı:
      (a) `doDeliver`: başarılı teslimde carry kalemi SIFIRLANMIYORDU → döngü "blocked"
          sanıp canlı kaldı → işçi depoda durduğu HER 20t dispatch'te carry'nin TAMAMINI
          yeniden sandığa koydu (yüzlerce bedava külçe) + 1200t sonra bir de refund.
          → teslim edilen kalem carry'den düşülür; yalnızca gerçek fazla (depo dolu) kalır.
      (b) `abortCycle`: `refundItems(carry)` İKİ kez koşuyordu (unload öncesi+sonrası) →
          her iptal carry'yi katladı. → tek geçiş + array temizliği.
      Ek klon bekçileri: `collectOutput` slot-2'yi önce temizleyip DOĞRULUYOR (temizlenmediyse
      toplamaz — fırında kalır, sweep sonra bankalar); `unloadFurnace` yalnızca gerçekten
      söktüğü slotu sayar; `mergeSlot` read-back verify (yazan yalan söylediyse mal carry'de kalır).
- [x] **S12.3 "Benim siparişim yapılmadı, ready'de kaldı" + "kağıt hâlâ ready duruyordu".**
      (a) ready beklemesi: köyde uygun işçi yoktu (tek köylü = çiftçi). Yeni meslek modelinde
          (S12.6) mesleksiz köylü siparişi üstlenip mesleğe dönüşür → ready kilitlenmesi biter.
      (b) KAĞIT: lore yalnızca "validating" durumlarında tazeleniyordu → artık depo sandığındaki
          HER kağıt, Durum/Üretim satırı bayatlayınca yeniden yazılır (completed/cancelled dâhil).
          Kağıda yeni satır: `§cEksik: …` (neden bekliyor: atölye/işçi/malzeme/yakıt).
- [x] **S12.4 "Depoda 1056 külçe varken köylü sürekli bakır külçe siparişi giriyor".**
      demandMonitor ÇIKTI stoğuna da bakıyor: copper/iron ingot ≥16 → yeni külçe siparişi YOK.
      (Mevcut `[köy]` siparişi `/cv:order cancel <N>` ile düşürülebilir.)
- [x] **S12.5 "2 adım ileri 5 adım geri ışınlanma / takılmalar" + "blokların altına ışınlanıp
      sıkışıp ölüyorlardı".**
      (a) Kör hop (hedef+1, y+1) gitti → SAFE HOP: geçilebilir ayak+kafa, sağlam (sıvı olmayan)
          zemin, yüklü chunk; 11 aday nokta; güvenli nokta YOKSA ışınlanma yok (yürümeye devam).
      (b) Boğulma kurtarması: ayak+kafa katıysa güvenli kolona kaldır (diag `kurtarma=N`).
      (c) Direksiyon: 0.45/10t sert itme → her passta 0.35 süreklî impuls + hedefe `lookAt`
          + iş nameTag'i ("§6Sipariş taşıyor", "§2Tarla işi", "§8Madende"…) → köylü
          "itiliyor" değil "işe gidiyor" gibi görünür.
- [x] **S12.6 "Tüm köylüler siparişe koşturuluyor; çiftçi tarlasını hasat ederken demirciye
      malzeme taşımasın" (kullanıcı kuralı birebir):**
      * Meslek sahibi: SADECE kendi mesleğinin siparişi > kendi üretimi (çiftçi→tarla) >
        süpürme/bölge angaryası > altyapı (sur/yol/ışık). Yabancı siparişe ASLA.
      * Mesleksiz: yalnızca köyde PROFESYONELİ OLMAYAN mesleğin siparişini alır ve o an
        mesleğe DÖNÜŞÜR (kalıcı `cvprof:` etiketi + sohbet bildirimi; aynı passta çift dönüşüm yok).
      * Meslek kaynağı: 12 blok içindeki iş bloğu (furnace→smelter, smoker→cook,
        smithing_table→toolsmith, grindstone→weaponsmith, stonecutter→mason, composter→farmer…)
        VEYA mod etiketi. crafting_table/barrel meslek işareti DEĞİL (her evde/depo var).
      * Çiftçi yoksa tarlayı mesleksizler hasat eder (ürün çürümesin).
- [x] **S12.7 "/forest /quarry pos1+pos2 tanımladım, hâlâ 'kurulu değil iş=0'".** KILLER BUG:
      köşeler komut argüman adıyla ("pos1"/"pos2") kaydedilip "p1"/"p2" okunuyordu → bölge hiç
      aktifleşmedi. → `setZoneCorner` artık p1/p2 yazar, eski kayıtlar otomatik migrate edilir;
      diag "kalıcı✓" yalnızca köşeler GERÇEKTEN kalıcıysa verir.
- [x] **S12.8 "2 ekmek + 6 fırında patates ready kaldı".** Kök neden: köyde COOK atölyesi yok
      (smoker yok; furnace otomatik taramada smelter olur). Yeni görünürlük: kağıtta
      `Eksik: atölye: /cv:workshop add cook` + validate missing satırı. Çözüm: smoker koy
      (otomatik kaydolur) veya bir furnace'a `/cv:workshop add cook`.
- [x] **S12.9 diag kozmetik:** assign satırı "(since undefined)" → gerçek since tick'i;
      dispatch satırına `dönüşen=N` ve `kurtarma=N` eklendi.
- [x] **S12.10 Derleme protokolü:** node --check 26/26 · check_ns OK · check_undef OK ·
      regresyon grep'leri temiz · manifestler [2,7,0] senkron (BP→RP bağı 2.7.0;
      @minecraft/server 2.10.0 + server-ui 2.2.0 KORUNDU) · paket 39 dosya, testzip OK,
      kökler yalnız BP+RP.

### v2.7.0 test listesi
1. `/cv:forest pos1` + `pos2` → "bölge AKTİF"; `/cv:diag` zone satırı `p1✓ p2✓ kalıcı✓ iş=N`;
   mesleksiz/uygun köylü ormana gider, `/cv:stock`'ta log birikir.
2. Tek 5x copper_ingot siparişi → depoda net +5 külçe / -5 ham bakır (611'lik patlama YOK);
   `/cv:log 60`: "malzeme alındı … 5 batch", "eritme tamam: 5x".
3. Kağıt: teslim sonrası `Durum: completed` + "Teslim edildi" satırı; beklerken `Eksik:` satırı.
4. Meslek kuralı: `/cv:diag` assign satırında çiftçi yalnızca `farm`/farmer-siparişi görür;
   mesleksiz üstlenince sohbet: "Mesleksiz bir köylü <tip> mesleğine yönlendirildi."
5. Işınlanma: hop yalnızca güvenli noktaya (blokların altı YOK); sıkışan olursa `kurtarma=N`.
6. Depoda copper_ingot ≥16 iken yeni `[köy] copper_ingot` siparişi oluşmaz.
7. Cook atölyesi yoksa ekmek kağıdı `Eksik: atölye…` der; smoker konunca `in_progress`.
8. `/cv:validate` TEMİZ; `/cv:log 120` içinde TypeError/ReferenceError YOK.

---

## S13) v2.8.0 — 12.10 SAHA TESTİ #3 (kullanıcı bildirimleri birebir)

- [x] **S13.1 "Sandıkta meşale yokken birçok köylü 'fener dikiyor' yazıp sonsuz
      döngüye giriyor, diğer işleri aksatıyor."**
      Kök neden: dispatch ışık angaryasını MALZEME SORMADAN dağıtıyordu; lighting.js
      inşaat deposunda meşale bulamayınca meşale dikemiyor, ama atanan köylü etiketiyle
      karanlık noktada 2400t bekleyip aynı işi yeniden alıyordu (sonsuz döngü).
      Çözüm: pickJob ışık dalı her passta `B.hasMat` (inşaat deposu) kontrol eder —
      malzeme yoksa İŞ YOK, etiket yok; varışta malzeme biterse işçi ANINDA bırakılır
      (`lightStarved` 1200t soğuma + noktada bekleme üst sınırı 900t).
- [x] **S13.2 "Çiftçinin envanteri dolunca ürün yere düşüyor, sandığa boşaltmıyorlar;
      hâlâ sandıktan tohum almıyorlar."**
      Kök neden: hasat eskiden depoya IŞINLANIYORDU; yerdeki dropslar ezilen ekinlerden
      geliyordu ve köylünün çantası hiç boşaltılmıyordu.
      Çözüm = FİZİKSEL ÇANTA MODELİ: hasat/odun/maden çıktısı köylünün KENDİ
      envanterine girer (teleport yok). Çanta dolarsa ekin DALDA KALIR ve işçi
      "§6Depoya boşaltıyor" angaryasıyla depoya yürüyüp slot slot (read-back doğrulamalı)
      boşaltır; AKŞAM da çantalı herkes eve giderken depoya uğrar. Yerdeki item
      entity'leri 1.6 blok içinden geçen işçinin çantasına toplanır (artık çürümüyor).
      Tohum: önce çantadan (hasattan gelen), çantada yoksa kullanıcı kuralı gereği
      DEPODA tohum varsa fiziken 1 adet çekilip ekilir; depo ziyaretinde çiftçi cebe
      8 tohuma kadar yedekler → kurulumdan sonra ekim kendi kendine yürür.
- [x] **S13.3 "20 külçe tamamlandı ama köy siparişleri +4 +4 +4 hiç durmuyor."**
      Çözüm: demandMonitor'a ÜÇ fren: (1) aynı anda en fazla 2 AÇIK köy siparişi;
      (2) bir köy siparişi tamamlanınca o item için 10 dk cooldown (updatedAtTick);
      (3) histerezis: eritme siparişi yalnızca ham cevher ≥8 VE külçe stoğu <8 iken.
- [x] **S13.4 "2 adım ileri 2 adım geri, zorlanma hareketi, sıkışma/ışınlanma."**
      Kök neden: 20t'de bir tek sert impuls + arada vanilla wander AI = titreme;
      kurtarma ışınları sıkışmada ilk çareydi.
      Çözüm: 4t STEER döngüsü (tek hareket sahibi): 0.1 süreklî impuls, hız-farkındalık
      (doğru yönde yürüyorsa impuls yok), lookAt 20t throttle. Sıkışma merdiveni:
      yan jitter+zıplama (3 deneme) → safe hop → yalnızca GERÇEKTEN blok içindeyse
      kurtarma. Dispatch'ten tüm impuls kodu söküldü.
- [x] **S13.5 "Kayıtlı oyunda setup 'köy ekonomisi kuruldu' diyor, 'zaten aktif' demeli."**
      Çözüm: kalıcı `setupDone` bayrağı + depo/atölye sayısı kontrolü; mevcutsa sarı
      "zaten aktif — bakım tazelemesi yapıldı" mesajı (atölye senkronu yine koşar).
- [x] **S13.6 "Kaydet+çık+gir: siparişler ready kalıyor, mod yüklenmemiş gibi
      (loop tick artıyor, boot:ok)."** KILLER BUG: dispatch kapısı `tick % 20 === 0`
      idi; 20t heartbeat oturum başına SABİT bir tick ofsetine oturur — reload sonrası
      ofset ≠ 0 ise kapı HİÇ ateşlemez (dispatch last=-1). Çözüm: akümülatör kapı
      (`tick - lastDispatchRun >= 20`) + bellekte çan yoksa köy kaydından çan geri
      yükleme + steer döngüsü self-heal (`healSteer`). Aynı ofset hatası lighting
      (`tick % 60`) ve production partikülünde (`tick % 30`) de vardı → sayaç oldu.
      DEVIR.md'ye "sabit tick-offset modulo tuzağı" maddesi eklendi.
- [x] **S13.7 "20 külçe için 40 ekmek yendi — optimize et."**
      Çözüm = ENERJİ MODELİ: fetch/work/deliver artık yemek YEMEZ (recipe.foodRequired
      tümü 0). Her köylünün 100 puanlık stamina havuzu var; gerçek iş aksiyonu puan
      yer (hasat 6, ekim 3, odun/maden 6, üretim bacağı 8, blok işleri 4-6).
      Puan ≤25 olunca YEMEK ANGARYASI: food deposuna yürür, sandıktan FİZİKSEN 1 ekmek
      alır, yer (+70 puan). 1 ekmek ≈ 11 iş aksiyonu → 20 külçe ≈ 2-3 ekmek (eskiden 40).
      Köy yemek tampon eşiği 24→12 (demandMonitor).
- [x] **S13.8 (önceki rapordan devralındı) Aktif orman/maden bölgesi çerçevesi:**
      bölge kuruluysa 60t'de bir çevre çizgisi boyunca yeşil sparkle (villager_happy).
- [x] **S13.9 Derleme protokolü:** node --check 26/26 · check_ns OK · check_undef OK ·
      regresyon grep'leri temiz · manifestler [2,8,0] senkron (BP→RP bağı 2.8.0;
      @minecraft/server 2.10.0 + server-ui 2.2.0 KORUNDU) · paket 39 dosya, testzip OK.

### v2.8.0 test listesi
1. **Reload testi (en önemlisi):** kaydet → çık → gir. Komutsuz bekle: 1 dk içinde
   `/cv:diag` → `dispatch: last=` ŞİMDİ'ye yakın (−1 DEĞİL), assign satırları var;
   ready siparişler in_progress'e döner, köylülerin baş etiketleri geri gelir.
2. Çana bakıp `/cv:setup` → sarı mesaj: "Köy ekonomisi §fzaten aktif§7 … bakım
   tazelemesi" (eski gibi "kuruldu" DEMEMELİ).
3. İnşaat deposunda meşale YOKKEN kimse "fener dikiyor" yazmaz; depoya 10 meşale
   koy → 1-2 dk içinde etiketler gelir ve meşaleler dikilir.
4. Çiftçi: hasat çantaya gider; çanta dolunca "Depoya boşaltıyor" → food deposunda
   buğday artar; depo tohumu boşalsa bile hasattan gelen tohumla ekim sürer; yere
   düşen item'ler yakından geçen işçi tarafından toplanır.
5. 20x iron_ingot siparişi tamamlanınca 10 dk yeni `[köy] iron_ingot` siparişi YOK;
   `/cv:order list` aynı anda en fazla 2 köy siparişi gösterir.
6. `/cv:stock food`: 20 külçe sürecinde ~2-3 ekmek azalır (40 değil); acıkan köylü
   "Yemek yiyor" etiketiyle depodan 1 ekmek alıp yer ve işine döner.
7. Hareket: atamada "2 ileri 2 geri" yok; sıkışan köylü önce yan adım+zıplama dener,
   `kurtarma` sayacı neredeyse durur (`/cv:diag`).
8. Orman/maden bölgesi kuruluysa çevresinde yeşil sparkle çerçeve görünür.
9. `/cv:validate` TEMİZ; `/cv:log 120` içinde TypeError/ReferenceError YOK.

## S14) v2.9.0 — 12.10 SAHA TESTİ #4 (v2.8.0 test edildi; kullanıcı bildirimleri birebir)

- [x] **S14.1 "Hâlâ rota düzenlemesinde çakışma var — köylü tarlaya gitmeye
      çalışıyor ama her 2 sn'de 1 ters istikamette itiliyor. Puls vuruşlarıyla
      yönlendirmek yanlış; köylüye hedef verilmeli, vanilla yol bulma yürütmeli.
      Kanıt: depoda meşale varken boşta kalan TÜM köylüler 'fener dikiyor'a
      atanıyor + itilme başlıyor; meşaleleri kaldırınca yürüyüş normale dönüyor.
      Düz alanda bile 'sıkışan köylü kurtarıldı' (kurtarma 4 → 70+)."**
      Kök neden: v2.8'in 4t steerPass'i 0.1'lik SÜREKLİ impuls basıyordu — köylünün
      kendi wander AI'ı ile bizim impuls İKİ KAPTAN gibiydi: AI bir yöne, impuls
      öbür yöne; jitter merdiveni 0.3'lük yan tekmelerle duvara sürüyor, bu da
      rescueIfStuck'ı tırmandırıyordu. lighting.js'te ayrıca ÖLÜ ama kurulu bir
      `nudgeNearestVillager` impulsu duruyordu: `tick % 40` = TAM 2 SANİYE —
      kullanıcının "her 2 sn'de bir itilme" gözleminin birebir kaynağı.
      Çözüm (kullanıcı doktrini artık kod yasası): **HİÇBİR modül köylüleri
      impulsla yönlendiremez.** steerPass saf GÖZLEMCİ: 400t'lik ilerleme
      pencerelerinde hedefe yakınsamayı ÖLÇER; hareket %100 vanilla AI'a ait.
      Tek istisna, hedefe 20+20+20 sn yaklaşamayan UZAK (>8 blok) işçide en
      fazla 2 kez yapılan güvenli "servis hopu": teleport, hedefin ~5 blok
      GERİSİNE iner (son yaklaşma yine yürüyüş), safeStand doğrulamalı.
      O da olmazsa iş SERBEST bırakılır + nokta 5 dk karantinaya alınır
      (`noGo`, vazgeçme sayacı). `kurtarma` artık yalnızca GERÇEK boğulmada
      (ayak+baş ikisi de dolu blok) tetiklenir → düz alanda imkânsız.
      Meşale fırtınası: LIGHT_CAP=2 (aynı anda en 2 "fener dikiyor"), yalnızca
      depoda gerçekten meşale varken ve lightStarved üzerinden 1200t geçince.
      (util.jumpAway'daki tek impuls kaldı: duvar/çit bloğu koyan işçinin
      1 kez kenara sekmesi — wallsOn kapalıysa hiç koşmaz, yönlendirme değil.)
- [x] **S14.2 "2 demir kazma siparişi: 4 demir + 4 çubuk harcandı, 1 kazma
      üretildi, sipariş 'tamamlandı'; üretim SANAL — kimse sandıktan malzeme
      alıp tezgâha gidip kazmayı üretip geri bırakmadı."**
      Kök neden kümesi (5 ayrı hata): (a) tezgâh üretimi işçinin KONUMUNU
      hiç doğrulamıyordu — depo+tezgâh bitişikse tüm bacaklar sandık başında
      "sanal" koşuyordu; (b) producedCount BATCH, quantity ITEM sayıyordu
      (x4 tahta siparişi hiç bitmiyor → mükerrer siparişlerin de kökü);
      (c) addItemsSafe `new ItemStack(id, chunk≤64)` kuruyordu — kazma gibi
      STACKLENEMEZ item için 2'lik yığın İLLEGAL → 2. kazma sessizce reddedildi
      → "iade sığmadı (düştü)" → eşya YOK OLDU ama sipariş tamamlandı;
      (d) consumeFromAny, tam başarıdan ÖNCE ledger'a consume satırı basıyordu
      (hayalet kayıtlar); (e) doFetch, siparişin KENDİ rezervasyonunu stoktan
      düşülmüş görüp dar stokta ready↔waiting_deadlock'a giriyordu.
      Çözüm — TAM FİZİKSEL YENİDEN YAZIM: işçinin gerçek çantası
      (`minecraft:inventory`) TEK doğruluk kaynağı. FETCH: kapasite ön-kontrolü
      (maxStackOf'lu canAddItems; execs sığana kadar küçülür), depodan
      hepsi-ya-hiç tüketim DOĞRUDAN ÇANTAYA; manifest yalnızca reload kurtarma
      kaydı. WORK: yalnızca `atStation` (Chebyshev ≤3) ise; tezgâh üretimi
      TUR TUR çantadan tüketir → çantaya üretir (legal yığınlar; sığmayan
      çıktı tezgâhın önüne DÜŞER, asla buharlaşmaz); fırın: girdi+yakıt
      çantadan slota (yazma+geri-okuma doğrulamalı), GERÇEK vanilla eritme,
      çıktı yalnızca işçi ≤8 blokta iken slottan çantaya; eritme zaman aşımı
      600+çıktı*240t (makine depoya boşaltılır, sipariş yeniden dener).
      DELIVER: sipariş YALNIZCA fiziken depoya giren ADET kadar kredi alır
      (ITEM birimi); quantity dolmadıysa sipariş ready'ye döner — hayalet
      tamamlanma imkânsız. Ledger consume satırları yalnız tam başarıdan sonra.
      İptal kuralı: YAŞAYAN işçinin çantası asla "iade" edilmez (dupes önlemi;
      artıkları boşta-depozit angaryası eve taşır), yalnız ÖLEN/kaybolan
      işçinin manifesti iade edilir. Reload'da persistCarry→recoverCarries
      yaşayan işçiye yeniden bağlanır. Döngü başına TEK taşıyıcı (worker
      binding): seyirciler bacak ilerletemez.
- [x] **S14.3 "Köy siparişlerinde iki tane aktif oak_planks var, ikisi de
      ready — üst üste sipariş açmaları garip."**
      Kök neden: demandMonitor HAM `v.orders || []` okuyordu — reload sonrası
      dizi tembel yüklendiği için live() SIFIR sipariş görüp açık kalemleri
      yeniden açıyordu; item başına mükerrer koruması da yoktu.
      Çözüm: liste her zaman O.listOrders ile (yüklemeyi tetikler); `openItem`
      bekçisi — bir item'in ASLA iki açık siparişi olamaz; eski mükerrerler
      ilk geçişte iptal edilir (en eski kazanır, rezervasyonları salınır);
      createOrder(internal)'da ikinci bir mükerrer bekçisi (kemer + askı).
- [x] **S14.4 "Depoda 64 odun varken de odunları kaldırınca da ağaçlar
      kesilip toplanmadı; forest çerçevesi yeşil ışıltıyla çevrelendi (çalışıyor)."**
      Kök neden: bölge/iş keşfi sağlamdı; asıl neden S14.1 — tüm işsiz kadro
      meşale angaryasına kilitlenip impuls kavgasında titriyordu, orman
      işine kimse kalmıyordu. Çözüm: LIGHT_CAP + impuls yasağı + bölge
      angaryaları artık erişilebilir (bd=96, noGo rotasyonu, zincirleme
      gövde kesimi chopTrunkUp). Not: bölgedeki tüm gövdeler bitince iş=0
      NORMALDİR (v2.10'da rehber mesaj gelecek).
- [x] **S14.5 MESLEK YAŞAM DÖNGÜSÜ (kullanıcı: "bu kısım çok önemli"):**
      (1) Tarla işleri YALNIZ çiftçilerin; başka meslekler tarlaya asla
      sürüklenmez (eski hata: professionOf uzak köylüye null dönünce "işsiz"
      sanılıp tarlaya veriliyordu + çiftçiye dönüşüm hiç yapılmıyordu).
      (2) Çiftçi yoksa BİR mesleksiz köylü tarla işini alır ve KALICI
      `cvprof:farmer` etiketiyle çiftçiye DÖNÜŞTÜRÜLÜR (yeşil mesaj).
      (3) Mesleksiz de yoksa oyuncuya hız-sınırlı sarı uyarı: "bir köylünün iş
      istasyonunu kırın/kaldırın" (6000t'de bir, yalnız tarlada gerçekten iş
      beklerken).
      (4) İstasyonu kırılan/kaldırılan ETİKETLİ köylü → profWatchdog: köyde o
      tip geçerli atölye YOKSA ve 24 blok içinde marker blok YOKSA (ve köylü
      boştaysa, taşıyıcı değilse) etiket silinir → köylü İŞSİZ havuzuna düşer
      → yeni istasyonların/sahipsiz meslek siparişlerinin adayı olur
      ("güzel bir döngü"). Markersız etiket meslekleri (forester/fisherman)
      asla silinmez; doğrulanamayan durumlarda (yüksüz chunk vb.) meslek
      ASLA düşürülmez.
      (5) ÇOCUK KÖYLÜLER: `U.isBaby` (is_baby component + type_family "baby"
      yedeği) — jobs/engine/walls taramalarından ve order.validate işçi
      sayımından dışlandı; çocuklara HİÇBİR iş/angarya/dönüşüm atanmaz.
- [x] **S14.6 Kullanıcının DOĞRULADIĞI çalışanlar (korundu):** /cv:setup
      idempotent mesaj · reload sonrası dispatch canlı (last=84690) ·
      külçe histerezisi (30 külçede yeni sipariş YOK) · /cv:validate temiz ·
      orman bölgesi yeşil ışıltı çerçevesi · ready→in_progress→completed akışı.
- [x] **S14.7 Diag yükseltmesi:** cycle satırında artık `işçi=…XXXXXX` (bağlı
      taşıyıcı) + `üretilecek=N` (toProduce); dispatch satırında
      `dönüşen / işsizleşen / kurtarma / vazgeçme / depo / yemek / yerden`.
- [x] **S14.8 Derleme protokolü:** node --check 26/26 · check_ns OK ·
      check_undef OK · regresyon grep'leri: applyImpulse YALNIZ util.jumpAway
      (inşaat sekişi), nudge yok, batch-kredi yok, illegal ItemStack yok ·
      manifestler [2,9,0] senkron (BP→RP bağı 2.9.0; @minecraft/server 2.10.0
      + server-ui 2.2.0 KORUNDU) · paket 39 dosya, testzip OK.

### v2.9.0 test listesi
1. **Puls/çekişme (en önemlisi):** depoda meşale VARken köylüleri 1-2 dk izle:
   2 sn'de bir geriye itilme YOK; yürüyüşler doğal (vanilla wander). "fener
   dikiyor" etiketi en fazla 2 kişide. `kurtarma` sayacı düz alanda ~0 kalır;
   `vazgeçme` nadir artabilir (sağlıklı: iş el değiştirir).
2. Uzak hedef: işçi 20+ sn boyunca hiç yaklaşamazsa log'da EN FAZLA 2 kez
   "işçi işe götürüldü … hedefin 5 blok yakınına indi, gerisi yürüyüş";
   sonrasında yine yürüyemezse "İşçi hedefe varamadı, iş bırakıldı" ve iş
   başkasına döner (5 dk o noktaya gitmez).
3. **2x iron_pickaxe siparişi** (depoda ≥6 külçe + ≥4 çubuk, toolsmith atölyesi
   kayıtlı): log sırası: "malzeme çantaya alındı" → işçi tezgâha YÜRÜR →
   "taşıyıcı bağlandı" → "tezgâh üretimi: 2 batch → 2x iron_pickaxe çantada"
   → işçi depoya yürür → "Sipariş tamamlandı … depo fiziken 2 aldı".
   `/cv:diag` cycle satırı: `işçi=…XXXXXX üretilecek=2`. Kazma ASLA kaybolmaz;
   depo ağzına kadar doluysa ürün çantada kalır ve köylü sonra boşaltır
   (sipariş teslim edilmeden completed OLMAZ).
4. oak_planks: `/cv:order list`'te aynı anda EN FAZLA 1 `[köy] oak_planks`
   (eski mükerrer varsa ilk ekonomi geçişinde biri iptal: "mükerrer köy siparişi
   iptal edildi"); 8'lik tahta siparişi producedCount 4→8 şeklinde ARTAR ve
   biter (batch/item sayım düzeltmesi).
5. Orman: bölgede gövde varken zamanla kesilir (log: gather satırları);
   bölge tamamen biterse `iş=0` normaldir.
6. **Meslek döngüsü:** komposteri olmayan/etiketsiz köylü tarlada ÇALIŞMAZ.
   Köyde çiftçi yokken tarlada iş varsa BİR mesleksiz "çiftçi" olur (yeşil
   mesaj + etiket). Hepsi mesleklidir ve tarlada iş vardır → sarı uyarı:
   "bir köylünün iş istasyonunu kırın/kaldırın". Bir istasyonu kır → o köylü
   "işsiz sınıfına düştü" mesajı alır ve yeni istasyona/siparişe atanabilir.
7. Çocuk köylüler: hiçbir etiket almaz, `/cv:diag` assigned sayısını büyütmez,
   tarla/üretim/meşale işine girmez.
8. Reload: kaydet+çık+gir → çantalı taşıyıcı yeniden bağlanır (yarım sipariş
   kaldığı yerden sürer), `dispatch: last=` ilerler, mükerrer köy siparişi
   oluşmaz.
9. `/cv:validate` temiz; `/cv:log 120` içinde TypeError/ReferenceError yok.

### v2.10.0 planı (bu turdan devralındı)
- Maden ocağı basamaklı (teraslı) kazım: U/dönüşlü merdiven boşluğu + katman
  kazımı, merdivenlere dokunmadan; waypoint routing ile merdivenden iniş.
- Orman/maden bölgesi iş=0 iken rehber mesaj: bölgede kesilecek/kazılacak
  hedef yoksa iş çıkmaz (bölgeyi koruya kurun; fidan dikimi döngüyü besler).
- GUI sipariş menüsü (kâğıtla tıklanabilir sipariş formu).
- Mason → inşaat köprüsü (taş malzeme talebi).

---

## S15 — v2.10.0 "YOLADAM": ışınlanma TAMAMEN kaldırıldı (13.10 kullanıcı raporu)

Kullanıcı raporu (v2.9.0 saha testi): köylüler sürekli binaların çatılarına
ışınlanıyor; "fener dikiyor" yazıp fırın başında/çan çevresinde bekliyorlar;
iron_pickaxe siparişinde yanlış köylü + depo ışınlanma döngüsü + rezerveler
yok oluyor; çoban tarlaya atanıyor; orman 3 gündür kesilmiyor; 1 tohum bile
sandık turu yapıyor; etiketler ("depoya boşaltıyor") iş bitince kalmıyor;
yiyecek hep depoya gittiği için köylüler çoğalmıyor.

### Kök nedenler + çözümler
1. **Çatı ışınlanması:** v2.9.0'da gerçek bir yürütücü YOKTU (vanilla wander
   hedefe nadiren varır). Monitor "yardım" için escort hop + sıkışma kurtarması
   yapıyordu; `safeStand()` hedeften YUKARI taradığı için ev içi hedeflerin
   ilk geçerli zemini ÇATI idi (hops=334, kurtarma=373). → **YOLADAM
   (cv/core/path.js):** blok ızgarasında A* (ayak+kafa geçerli, sağlam zemin,
   çıkış ≤1 merdiven, iniş ≤3, duvar tırmanma YOK ⇒ çatıya yol YOKTUR);
   işçi yolu 2.1 blk/sn yürür; kapı/çit kapısı yolda AÇILIR (kırılmaz);
   yol yoksa iş BIRAKILIR + 5 dk karantina (iş başkasına döner) — ışınlanma
   YOK. Kalan TEK konum düzeltmesi `unstuckBuried`: ayak+kafa katı blok
   içindeyse AYNI y'de YANA adım (asla yukarı/çatıya değil).
2. **"fener dikiyor" tutarsızlığı:** yürütücü olmadığı için işçi karanlık
   noktaya varamıyor, etiket üstünde bekliyordu. → YOLADAM ile işçi noktaya
   yürür, lighting.js meşaleyi diker; yol yoksa iş bırakılır (etiket gider).
3. **iron_pickaxe kısır döngüsü + "rezerve malzeme yok oluyor":** iptal olan
   döngü malzemeyi yaşayan işçinin çantasında HAYALET YÜK bırakıyordu; sonraki
   döngü depodan YENİDEN çekiyor ⇒ depo azalıyor, malzeme "yok oluyordu".
   → `abortCycle`: yaşayan işçinin manifesti ANINDA doğrulanmış çanta→sandık
   iadesiyle depoya döner. Ayrıca bağlanamayan döngü (işçi=-) 2400t sonra
   "no_carrier" ile ready'ye düşer (sipariş sonsuza dek in_progress kalmaz).
   → `/cv:order list` iptal satırındaki bayat "eksik" listesi temizlenir.
4. **Çoban tarlada / yanlış meslek okuması:** `professionOf` 12 blokta
   "HERHANGİ bir istasyon var mı?" sorusunu JOB_SITES SIRASIYLA soruyordu:
   dokuma tezgâhına 3, kompostera 8 blok uzaktaki çoban → ÇİFTÇİ okunup
   tarlaya çekiliyordu. → meslek = EN YAKIN istasyon (vanilla mantığı).
   (Atanmamış çiftçinin tarlaya bakması VANILLA AI'dır; engellenmez, zararsız.)
5. **Orman kesilmiyor:** bölge iş=0 idi (bölgede kütük yok) ve sistem sessizdi.
   → 2 dk boş bölge sonrası rehber mesaj: "bölgede kesilecek kütük yok,
   bölgeyi ağaçlık alana yeniden işaretleyin; ormancı için iş istasyonu
   GEREKMEZ — bölge yeterlidir" (+ `/cv:diag` iş=0 satırı).
6. **1 tohum = sandık turu kısır döngüsü:** yerden alma eşiği YOKTU. →
   `PICK_MIN=4`: tek tük eşya yerde kalır; ayrıca ÖĞLEN (5500-6500) ve
   AKŞAM (11000-12500) pencerelerinde ≥8 eşyalık çanta depoya gider
   (tam doluluk her zamanki gibi anında). Çiftçi zinciri yeniden sıralandı:
   ÖNCE tüm olgun mahsul hasat → SONRA paketteki tohumla ekim → en son
   fazla tohum/mahsul depoya.
7. **Bayat etiketler:** ataması/üretim döngüsü olmayan köylünün üstündeki
   iş etiketi temizlenmiyordu → "depoya boşaltıyor" hayaletleri. →
   LABEL WATCHDOG: her dispatch geçişinde etiket=atama eşleşmesi doğrulanır.
8. **Çoğalma durdu:** boşaltma angaryası tüm yiyeceği çantalardan süpürüyor,
   vanilla isteklilik ise çantada yiyecek istiyordu. → PROFESYONEL ÜREME
   KAPISI (scheduler): günde bir, akşam buluşmasında (tod 11000-12000),
   food deposunda ≥24 ekmek FAZLA ve yetişkin < popCap(24) ise boştaki
   2 yetişkine fiziken 3'er ekmek (doğrulanmış sandık→çanta); gerisini
   vanilla yatak+yiyecek kuralı yapar. Anahtar: `/cv:config set breedingOn false`.

### v2.10.0 TEST LİSTESİ
1. **Işınlanma YOK:** 1 tam gün izle — çatıya/aniden konumlanan köylü YOK;
   köylüler işlerine YÜRÜYEREK gidiyor (kapılar kendiliğinden açılıyor).
   `/cv:diag` → `yoladam: yol=N yolYok=… düzeltme=… (ışınlanma YOK)`;
   `kurtarma` yalnız "gömülü köylü yana adımladı" loglarında artar.
2. Meşale: depoya meşale koy → "fener dikiyor" etiketli köylü karanlık
   noktaya YÜRÜYÜP meşaleyi diker (bekleyip kalmaz); depoda meşale yoksa
   kimse etiket almaz.
3. `2x iron_pickaxe`: toolsmith tezgâhında üretilir; fetch→work→deliver
   bacaklarında işçi yürür; iptal/abort olursa malzeme depoda belirir
   (çantada hayalet kalmaz), sipariş `ready`'ye döner ve yeniden dener.
4. Çoban tarla etiketi ALMAZ; tarla işi yalnız `cvprof:farmer`/dönüşen
   mesleksizde (yeşil mesaj).
5. Orman: ağaçlık bölge işaretle → 1-2 dk içinde "Odun kesiyor" etiketi +
   gövdeler düşer; boş bölge işaretle → 2 dk sonra rehber mesaj gelir.
6. Yerde 1 tohum: köylü üstüne yürümez/taşımaz; ≥4'lük yığınlar toplanır;
   öğlen/akşam çantalar depoya boşalır; çiftçi önce hasat sonra ekim yapar.
7. Etiketler iş bitince SİLİNİR (boşta gezen "depoya boşaltıyor" yok).
8. Food deposuna ≥24 ekmek koy + akşamı bekle → "düğün payı" mesajı;
   yataklar varsa zamanla bebek doğar (`/cv:config set breedingOn false`
   ile kapanır).
9. `/cv:validate` temiz; `/cv:log 120` içinde error yok; reload sonrası
   taşıyıcılar yeniden bağlanır, siparişler ready'de donmaz.

### v2.11.0 planı (devralındı)
- Maden ocağı basamaklı (teraslı) kazım (U/dönüşlü merdiven boşluğu + katman
  kazımı; waypoint routing) — YOLADAM artık rotayı taşıyabilir.
- GUI sipariş menüsü (kâğıtla tıklanabilir sipariş formu).
- Mason → inşaat köprüsü (taş malzeme talebi).

## S16 — v2.11.0 "KAMPYOLU": hareket %100 vanilla (14.10 kullanıcı raporu)

Kullanıcı raporu (v2.10.0 saha testi): "Vanilla'nın zaten köylüyü göreve
götüren sistemi var; üzerine ikinci bir yürüme sistemi yazınca ÇAKIŞIYOR —
köylü iki adım ileri gidiyor (vanilla), iki adım geriye ışınlanıyor (kod),
sürekli sıkışıp kalıyor. Köylüye vanilla'daki gibi bir HEDEF ver, doğal
yoldan ilerlesin." + "Ormancıda yanlışın var: bölgede 2 akasya ağacı var,
kod herhalde sadece meşe arıyor — Minecraft'ta bir sürü biyom/ağaç çeşidi
var, hepsini ekle."

### Kök nedenler + çözümler
1. **ÇAKIŞMA (asıl hareket bugı):** YOLADAM yürütücüsü köylüyü 4 tick'te bir
   `teleport` mikro-adımlarıyla iterken vanilla AI da köylüyü kendi
   hedeflerine yürütüyordu → iki hareket sistemi aynı varlıkta savaştı
   (2 ileri / 2 geri). → **Yürütücü TAMAMEN SİLİNDİ.** Hareket artık yalnız
   vanilla'nın kendi hedef sistemi: **POI claim + günlük program.** Bedrock
   programı (minecraft.wiki §Schedules): İŞ 0–2000 (06–08) & 10000–11000
   (16–17) → köylü claimlediği iş istasyonuna GERÇEK vanilla yol bulmayla
   yürür, yanında durur; 8000–10000 çanda toplanır; 11000→ eve, 12000→ uyku.
   Script köylünün konumunu ASLA yazmaz (tek istisna: gömülü köylünün aynı
   yükseklikte yana adımı, path.js unstuckBuried).
2. **Yeni modül cv/core/anchor.js — "ÇAPA" sistemi:** iş hedeflerine addon
   sahipliğinde iş istasyonu blokları konur; İŞSİZ bir köylü onu sahiplenir
   (claim'i vanilla pathfinding ile doğrular) ve her iş saatinde kendi
   yürüyerek gider. Orman bölgesi → **kompost kampı**; taş ocağı → **taş
   kesme kampı**; POI olmayan atölye istasyonları (fırın/crafting table/
   kamp ateşi) → yanlarına sahiplenilebilir **yan çapa** (blast furnace/
   smoker/smithing table). İş kümesi bitince kamp taşınır (kır+yerleştir,
   10 dk'da 1, gezinme saatlerinde — sahiplenen köylü yenisini sahiplenip
   yürür). Sahiplenme izlenimi: iş saatinde çapanın yanında DURAN köylü =
   sahibi (presence binding). Kamp 1 günden uzun sahipsizse rehber mesaj:
   "işsiz köylü kalmadı → yatak ekleyin / bir istasyon kırın".
3. **Akasya ormanı iş=0 (kullanıcının 2. maddesi):** İKİ kök neden:
   (a) kolon taraması **yaprak baldakenini duvar sayıp** gövdeye hiç
   inmiyordu — taçlı HİÇBİR ağaç görünmüyordu; (b) odun aileleri eksikti.
   → Tarama artık yaprak/asma/cocoa/propagule/sarkan köklerin ALTINDAN
   görür; gövde dipten tepeye TEK iş olarak kaydedilir (tek ziyarette bütün
   ağaç devrilir); TÜM türler sayılır: meşe, ladin, huş, jungle, **akasya**,
   koyu meşe, mangrov, kiraz, solgun meşe, bambu, crimson/warped + eski
   dünya id'leri (minecraft:log/log2). Aile bazlı tarifler: her kütük →
   KENDİ tahtası (acacia_planks…), odun kömürü herhangi kütükten, çubuk
   herhangi tahtadan; köy siparişleri (kömür/tahta) aile farkındalıklı;
   yakıt/vanilla-smelt tabloları tam; her ağaç KENDİ fidanını geri diker
   (mangrov → propagule, bambu → bambu).
4. **Zamanlama vanilla ritmine bağlandı:** depo boşaltma pencereleri Bedrock
   programına göre (sabah işe gidiş ≤2200, çan 7800–10200, eve dönüş
   10800–14200); üretim watchdog'u gece uykusunu artık abort etmiyor
   (worker_left 1200t → 14400t; ölü/kaybolan işçi 600t'de hızlı abort,
   malzeme iadesiyle); aç işçi ÖNCE çantasındaki yiyeceği yer (kamp
   işçisi yemek için köye yürümek zorunda değil).
5. **Görev politikası "yürünebilir iş":** kimseye vanilla'nın götüremeyeceği
   uzak hedef verilmez — tarla ≤10, yol/duvar/fener ≤14 (güzergâh üstü
   fırsat işi; Bedrock'ta köylüler zaten "kenarları keşfet" gezinmesi yapar),
   orman/maden YALNIZ kamp civarı (12) ve yalnız kamp sahibine; sipariş
   bacakları atölyenin BAĞLI sandıklarına bakar (istasyonun dibinde).
   Hiç varılmadan bayatlayan iş 5 dk kara listeye (rotasyon). Atölye
   çapasını sahiplenen köylü otomatik o mesleğin etiketini alır (vanilla'nın
   seçimine saygı; yeşil mesaj).

### v2.11.0 TEST LİSTESİ
1. **Çakışma YOK:** köylüler artık seğirtmiyor/geri çekilmiyor. Sabah 06–08
   ve öğleden sonra 16–17'de istasyonlarına/kamplarına SAKİNCE yürürler;
   öğlen çana, akşam yataklarına giderler. Script asla konum yazmaz
   (`/cv:diag` → `çapa: … (hareket %100 vanilla: script köylü TAŞIMAZ)`).
2. **Orman:** akasyalı bölgeyi işaretle (`/cv:forest pos1/pos2`) → bölge
   taraması akasya gövdelerini BULUR (diag `zone forest iş=N>0`), en yoğun
   kümeye kompost kampı kurulur (mesaj) → işsiz bir köylü sahiplenir, iş
   saatinde yürüyerek gider, "Odun kesiyor" etiketiyle keser; kütükler
   çantasına girer, akşam dönüşünde depoya boşalır; diplerine akasya
   fidanı dikilir (depoda fidan varsa).
3. Kamp etrafı bitince kamp 10 dk içinde yeni kümeye taşınır (log:
   "kampı yeni iş kümesine taşındı"); köylü ertesi iş saatinde yeni kampa yürür.
4. Köyde işsiz köylü yoksa kamp sahipsiz kalır → ~2 dk sonra rehber mesaj
   ("iş istasyonunu yalnızca işsiz bir köylü sahiplenir…"). Bir köylünün
   istasyonunu kır → işsiz düşer → kampı sahiplenir (güzel döngü).
5. **Fırın atölyesi:** smelter'ın yanına blast furnace çapası konur (log);
   sahiplenen köylü "smelter" etiketi alır; kömür/demir siparişleri onun
   mesaisinde fetch→work→deliver ilerler; gece uyudu diye döngü abort
   olmaz, sabah kaldığı yerden sürer.
6. **Tahta zinciri:** akasya kütükleri depoya girince köy kendine
   acacia_planks siparişi verir; tahtalar → çubuk → meşale zinciri çalışır;
   kömür herhangi kütükten yapılır.
7. Taş ocağı: stonecutter kampı + madenci aynı modelle çalışır (iş=0 ise
   rehber mesaj; cevher/taş varken kazım yapılır).
8. Etiketler iş bitince silinir; yerde ≥4'lü yığınlar toplanır, 1-2 tohum
   yerde kalır; çanta dolunca/eve dönüş penceresinde depoya boşaltılır.
9. `/cv:diag`: `zone forest/quarry` satırında `kamp=x,z sahip=✓/✗`;
   `çapa: yerleşim/işbaşı/taşıma` sayaçları artıyor; `/cv:validate` temiz;
   reload sonrası kamplar/çapalar DP'den geri gelir, çift kamp oluşmaz.

### v2.12.0 planı (devralındı)
- Basamaklı (teraslı) maden kazımı: U dönüşlü merdiven boşluğu + katman
  kazımı; kamp ocağın içine kat kat iner (hareket yine vanilla).
- UZAK bölgeler için "bayrak direği" zinciri: köy sınırı ~sınır+32 bloktan
  uzağa claim edilemez → bölgeye yatak+çan+kamp üçlüsü koyup köyü kademe
  kademe büyütme (relay anchors).
- GUI sipariş menüsü (kâğıtla tıklanabilir form).
- Mason → inşaat köprüsü (taş malzeme talebi).
