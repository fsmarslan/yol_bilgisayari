# 🏎️ AuraDrive Pro — Akıllı Yol Bilgisayarı & Telemetri Sistemi

<div align="center">

![Toyota Corolla 1.4 D-4D](https://img.shields.io/badge/Vehicle-Toyota%20Corolla%201.4%20D--4D%20(1ND--TV)-crimson?style=for-the-badge&logo=toyota)
![Platform](https://img.shields.io/badge/Platform-Android%20APK%20(PiP%20%2B%20Foreground)%20%7C%20Web%20PWA-teal?style=for-the-badge&logo=android)
![Frontend](https://img.shields.io/badge/Frontend-Next.js%2014%20%7C%20Capacitor%208-black?style=for-the-badge&logo=next.js)
![Protocol](https://img.shields.io/badge/OBD--II-ISO%2014230--4%20KWP%20Fast%20(ATSP5)-orange?style=for-the-badge&logo=bluetooth)
![Tests](https://img.shields.io/badge/Tests-8%2F8%20Passing-brightgreen?style=for-the-badge&logo=python)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

<p align="center">
  <b>2006 Toyota Corolla 1.4 D-4D (1ND-TV Turbo Dizel)</b> için özel olarak kalibre edilmiş; harici bilgisayar veya sunucuya ihtiyaç duymadan doğrudan Android telefonda çalışan, sistem seviyesinde <b>Picture-in-Picture (PiP)</b> ve arka plan servis destekli, lüks kokpit tasarımlı, düşük gecikmeli Bluetooth LE / OBD-II yol bilgisayarı, telemetri ve arıza teşhis platformu.
</p>

</div>

---

## 🌟 Öne Çıkan Başlıca Yetenekler

### 1. 🛢️ Kalibre Edilmiş 1ND-TV Dizel Yakıt Modeli & Dinamik AFR Haritası
Dizel motorlar benzinli motorların sabit 14.7:1 hava/yakıt oranı (AFR) mantığıyla çalışmaz; gaz kelebeği olmadan daima aşırı hava fazlalığıyla yanar. AuraDrive Pro, 1.4 D-4D motorun gerçek yanma karakteristiğine göre sıfırdan kalibre edilmiştir:
- **Euro Dizel Yoğunluğu:** Standart benzin katsayıları yerine tam **`840.0 g/L` (0.840 g/cm³)** kullanılır.
- **Motor Yüküne Göre Dinamik AFR Haritası:**
  * **Rölanti / Çok Düşük Yük ($\text{Load} \le 15\%$):** $\text{AFR} = 38.0$ $\rightarrow$ Sıcak motorda **$0.50 - 0.70\text{ L/h}$** fabrika bandı.
  * **Düşük Yük / Sabit Seyir ($15\% < \text{Load} \le 35\%$):** $\text{AFR} = 28.0$ $\rightarrow$ 90 km/h otoyolda **$4.2 - 4.5\text{ L/100km}$**.
  * **Orta Yük / Şehir İçi Hızlanma ($35\% < \text{Load} \le 65\%$):** $\text{AFR} = 22.0$.
  * **Yüksek Yük / Rampa Tırmanışı / Dip Gaz ($\text{Load} > 65\%$):** $\text{AFR} = 17.5 - 18.0$ (Duman sınırı ve 90 HP tepe noktası). Rampa ve 3000 d/d sürüşlerinde rota tüketimini gerçekçi **$5.0 - 5.6\text{ L/100km}$** aralığına yerleştirir.
- **Anlık Yakıt Akışı Formülü:**
  $$\text{Yakıt (L/h)} = \left(\frac{\text{MAF}}{\text{AFR} \times 840}\right) \times 3600$$
- **Denso ECU 0xFF (%100) Rölanti Yük Filtresi:** Toyota Denso motor beyinlerinde araç dururken zaman zaman gelen hatalı %100 yük verisi filtrelenerek rölanti baz yüküne çekilir.

---

### 2. 🛑 Gelişmiş Deceleration Fuel Cut-Off (DFCO)
- **Kompresyonda Sıfır Tüketim:** Araç viteste akarken ($\text{Hız} > 20\text{ km/h}$, $\text{Devir} > 1200\text{ d/d}$) sürücü gaz pedalını bıraktığında ($\text{Gaz} < 2.0\%$ veya $\text{Yük} < 8.0\%$), ECU enjektör püskürtmesini tamamen keser.
- Sistem bu durumu anında algılayarak anlık tüketimi tavizsiz olarak **`0.00 L/100km` (0.0 L/h)** seviyesine çeker.

---

### 3. 💉 Toyota Mode 21 Enjektör Hacmi Desteği (Öncelikli / Fallback)
- Toyota Denso ECU'larda gelişmiş teşhis servisi (Mode 21 PID `2167`) üzerinden enjektör püskürtme hacmi ($\text{mm}^3/\text{strok}$) sorgulanır.
- Okunabildiği sürece MAF yerine doğrudan hassas enjektör formülü öncelikli tüketim kaynağı olarak çalışır:
  $$\text{Yakıt (L/h)} = \frac{\text{Enjektör Hacmi (mm}^3\text{)} \times \text{RPM} \times 4 \times 60}{2 \times 1\,000\,000}$$
- ECU yanıt vermediği durumlarda kesinti olmadan MAF tabanlı dinamik AFR hesaplamasına otomatik geri dönülür (fallback).

---

### 4. 🫧 Android Sistem Seviyesi Picture-in-Picture (Yüzen Mini PiP HUD)
- **Haritalar / Spotify Üzerinde Canlı Gösterge:** Üst bardaki **`🫧 MİNİ PİP`** butonuna dokunulduğunda veya uygulamadan çıkıldığında, Android işletim sistemi uygulamayı diğer tüm uygulamaların üzerinde yüzen bağımsız bir **Picture-in-Picture (PiP)** penceresine dönüştürür.
- **Ultra Okunabilir Kokpit Görünümü:** Uzaktan bile rahatça okunabilen büyük neon **Hız (KM/H)**, **Tahmini Vites (1-5 / N)**, **Anlık Tüketim (L/100km)**, **Akü Voltajı (V)** ve **Devir** gösterilir.
- Sürüklenebilir, çift dokunuşla boyutlandırılabilir veya tam ekrana geri dönülebilir.

---

### 5. 🎵 3'lü Görev Dengesi: Yol Bilgisayarı + Müzik (A2DP) + Navigasyon (GPS)
- **1. Öncelik — Kesintisiz Yol Bilgisayarı:** Arka planda (`AuraForegroundService` + `PARTIAL_WAKE_LOCK`) navigasyona geçildiğinde dahi yapılan kilometre ve harcanan yakıt sıfır veri kaybıyla toplanır.
- **2. Öncelik — Kesintisiz Müzik (Bluetooth A2DP):** Android `CONNECTION_PRIORITY_BALANCED` modu ve komutlar arası mikro nefes alma pencereleri sayesinde Spotify / YouTube Music'te müzik akışı kesilmez veya çıtırtı yapmaz.
- **3. Öncelik — Navigasyon & GPS Uyumu:** Arka plandayken gereksiz render'lar durdurulur (`isForeground` kontrolü). GPS dinleyicisi `maximumAge: 3000ms` ile Android'in konum önbelleğini Google Haritalar ile paylaşımlı kullanır.

---

### 6. 🩺 OBD-II DTC Arıza Teşhis & Kod Silme Merkezi (Mode 03 & Mode 04)
- **Hata Kodlarını Okuma (Mode 03):** Motor beynindeki (ECU) kayıtlı ve bekleyen arıza kodlarını okur.
- **Geniş Türkçe Arıza Veritabanı:** Kodun ne anlama geldiğini açıklar (Örn: `P0400 - EGR Akış Arızası`, `P0380 - Kızdırma Bujisi Devresi`, `P0100 - MAF Sensör Devresi`). Sistem türünü (`Motor`, `Şasi`, `Ağ`) ve ciddiyetini (`Kritik`, `Orta`, `Düşük`) etiketler.
- **Check Engine Söndürme (Mode 04 - Clear DTC):** Tek tuşla ECU arıza hafızasını sıfırlar ve motor arıza lambasını (MIL) söndürür.

---

### 7. ⚡ Akü & Şarj Dinamosu Voltaj Sağlığı (ELM327 `ATRV`)
- Donanımsal `ATRV` komutu ile aracın OBD-II portundaki elektrik gerilimini ölçer.
- **Üst Bar Rozeti:** Anlık voltaj sürekli göz önündedir (`🔋 14.1V`).
- **Dinamik Teşhis:**
  - $\ge 13.6\text{ V}$: `✓ Alternatör şarj ediyor (Normal: 13.8V - 14.4V)` 🟢
  - $12.4\text{ V} - 12.8\text{ V}$: `Akü Seviyesi Normal` 🟡
  - $< 12.0\text{ V}$: `⚠️ Düşük Voltaj! Akü veya şarj dinamosunu kontrol edin.` 🔴

---

### 8. 📈 Riemann Sayısal İntegrali ile Gerçek Yol Bilgisayarı (Trip Engine)
- Basit aritmetik ortalama yerine her milisaniyede tekerlek hızı ve yakıt debisini sayısal integrasyonla toplar:
  $$\text{Toplam Yakıt (L)} = \sum \left(\frac{\text{Debi (L/h)} \times \Delta t}{3600}\right), \quad \text{Mesafe (km)} = \sum \left(\frac{\text{Hız (km/h)} \times \Delta t}{3600}\right)$$
- Trafikte duraklamaları ve kırmızı ışıkları eksiksiz hesaba katar.
- **Dinamik Mazot Fiyatı (₺/L):** Canlı fiyat düzenleme modalı ile anlık maliyet (₺/km veya ₺/saat) ve kontak açılışından itibaren toplam yakıt masrafı (₺) hesaplanır.

---

### 9. 💨 Gerçek Turbo Boost Basıncı & Otomatik Rakım Kalibrasyonu
- Manifold basınç sensöründen (MAP) okunur: $\text{Boost (Bar)} = (\text{MAP} - \text{Atmosfer}) / 100$.
- Kontak ilk açıldığında bulunulan konumun rakımına göre atmosferik basınç otomatik hafızaya alınır (Deniz seviyesi ~101.3 kPa, Ankara ~92 kPa).
- Canlı amber ışıltılı turbo boost bar göstergesi.

---

### 10. ⏱️ Otomatik 0-100 & 0-50 km/h Drag Performans Sayacı
- Araç durduğu anda ($\le 0.8\text{ km/h}$) sistem otomatik olarak **`HAZIR (READY)`** durumuna geçer; gaza basıldığı ilk milisaniyede ölçüm başlar.
- 50 km/h ve 100 km/h sürelerini ayrı ayrı kaydeder; en iyi dereceyi (Personal Best - PB) ve Peak Boost tepe basıncını hafızada tutar.
- **Sanal Dinamometre:** 1ND-TV fabrika tork/güç eğrileriyle anlık **Beygir Gücü (HP)** ve **Tork (Nm)** kestirimi.

---

## 🎛️ Dashboard Sekmeleri

| Sekme | Açıklama & Göstergeler |
|---|---|
| **SÜRÜŞ** | Devir çubuğu, Turbo Bar, Dijital Hız, Anlık Tüketim, Anlık Maliyet (₺/km), Hararet, Trip Mesafesi ve Ortalama Tüketim. |
| **TRİP** | Yapılan km, harcanan toplam litre, toplam yakıt tutarı (₺), ortalama hız, maksimum hız, sürüş/hareket süreleri, rota haritası ve geçmiş sürüşler. |
| **PERFORMANS** | Otomatik 0-100 km/h, 0-50 km/h süreleri, Personal Best (PB) rekoru, Peak Boost (Bar), Anlık Beygir (HP) ve Tork (Nm). |
| **MOTOR** | MAP manifold basıncı, MAF hava akışı (g/s), Motor Yükü (%), Gaz Kelebeği (%), Emme Havası Sıcaklığı (°C), Mode 21 Enjektör Hacmi ($\text{mm}^3$). |
| **SAĞLIK** | OBD-II DTC Arıza Teşhis & Kod Silme Merkezi, Akü / Alternatör Voltaj Çubuğu, Bağlantı Protokolü (ATSP5), WakeLock ve Arka Plan Servis Durumu. |

---

## 🏗️ Proje Mimarisi

```text
yol_bilgisayari/
├── AuraDrivePro.apk                  # Doğrudan telefona yüklenebilir bağımsız güncel Android APK (~8.6 MB)
├── build_apk.sh                      # Tek tıkla APK derleme ve telefona yükleme betiği (OpenJDK 21)
├── backend/                          # Python / FastAPI Geliştirme & Simülasyon Sunucusu
│   ├── app/
│   │   ├── config.py                 # BLE, PID ve Dizel motor parametreleri (840 g/L, AFR Haritası)
│   │   ├── ble_service.py            # Bleak tabanlı BLE yöneticisi, Mode 21 ayrıştırıcı, ATRV ve simülasyon
│   │   ├── obd_service.py            # Alternatif seri port OBD servisi
│   │   └── main.py                   # FastAPI REST API (/live-data, /data, /health)
│   ├── ble_telemetry.py              # Geriye dönük uyumluluk köprüsü & dışa aktarım
│   ├── test_fuel_calculation.py      # Yakıt modeli, AFR haritası, DFCO ve Mode 21 test paketi (8/8 OK)
│   ├── requirements.txt              # Python bağımlılıkları
│   └── desteklenen_veriler_raporu.md # Araçtan okunan ham PID analiz raporu
├── frontend/                         # Next.js 14 + Capacitor 8 Android Projesi
│   ├── android/                      # Yerel Android Studio / Gradle projesi
│   │   ├── app/src/main/AndroidManifest.xml # PiP, BLE, Location, WakeLock
│   │   └── app/src/main/java/com/auradrive/pro/
│   │       ├── MainActivity.java     # PiP kancaları, onUserLeaveHint & WebView optimizasyonu
│   │       ├── AuraBackgroundPlugin.java # PiP, Foreground Service ve Doze muafiyeti
│   │       └── AuraForegroundService.java# Kalıcı bildirim ve Partial WakeLock servisi
│   ├── app/
│   │   ├── components/
│   │   │   └── TripRouteMap.tsx      # Leaflet tabanlı rota haritası bileşeni
│   │   ├── services/
│   │   │   ├── obd-ble.service.ts    # Saf TypeScript Mobil BLE, DTC Teşhis & Kalibre Dizel Yakıt Motoru
│   │   │   └── background.service.ts # PiP & Foreground servis yöneticisi
│   │   ├── globals.css               # Kokpit temaları ve animasyonlar
│   │   └── page.tsx                  # Ana Kokpit, PiP HUD, Trip ve Teşhis Arayüzü
│   ├── capacitor.config.ts           # Capacitor Android yapılandırması
│   ├── next.config.js                # Static Export yapılandırması
│   └── package.json
├── README.md                         # Güncel ana dokümantasyon
└── read.md                           # Depo dokümantasyon kopyası
```

---

## 🚀 Kurulum ve Çalıştırma

### 📱 1. Android Telefonda Doğrudan Kullanım (Tavsiye Edilen)
1. Ana dizindeki [`AuraDrivePro.apk`](AuraDrivePro.apk) dosyasını telefonunuza indirip **Yükle** deyin.
2. Telefonunuzun **Bluetooth** ve **Konum (GPS)** servislerini açın.
3. ELM327 adaptörünü aracınızın OBD portuna takıp kontağı açın; uygulama otomatik bağlanacaktır.
4. Google Haritalar veya başka bir uygulamaya geçerken **`🫧 MİNİ PİP`** butonuna basarak haritanın köşesinde yüzen hız göstergesini kullanabilirsiniz.

#### APK'yı Yeniden Derlemek İçin:
```bash
./build_apk.sh
```
*(Telefonunuz USB ile bağlıysa `adb` üzerinden otomatik olarak cihaza yüklenir).*

---

### 💻 2. Bilgisayar / Tarayıcı Geliştirme Modu

#### Backend (FastAPI):
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

#### Birim Testlerini Çalıştırma:
```bash
cd backend
python3 -m unittest test_fuel_calculation.py -v
```

#### Frontend (Next.js):
```bash
cd frontend
npm install
npm run dev
```
Tarayıcınızda `http://localhost:3000` adresini açarak yerleşik **SİMÜLASYON** moduyla tüm özellikleri canlı test edebilirsiniz.

---

## 📊 Desteklenen OBD-II PID Listesi (Toyota 1ND-TV)

| PID (Hex) | Parametre | Formül / Yöntem | Birim |
|---|---|---|---|
| `010C` | Motor Devri (RPM) | `((A * 256) + B) / 4` | d/d (RPM) |
| `010D` | Araç Hızı (Speed) | `A` | km/h |
| `0104` | Hesaplanan Motor Yükü | `(A * 100) / 255` *(Denso 0xFF filtreli)* | % |
| `0105` | Soğutma Suyu Sıcaklığı (Coolant) | `A - 40` | °C |
| `010B` | Emme Manifoldu Basıncı (MAP) | `A` | kPa |
| `010F` | Emme Havası Sıcaklığı (IAT) | `A - 40` | °C |
| `0110` | Hava Akış Hızı (MAF) | `((A * 256) + B) / 100` | g/s |
| `0111` | Gaz Kelebeği / Pedal Konumu | `(A * 100) / 255` | % |
| `0121` | Arıza Lambası (MIL) ile Yapılan Yol | `(A * 256) + B` | km |
| `2167` *(Mode 21)* | Toyota Enjektör Hacmi | `((A * 256) + B) / 100` | $\text{mm}^3/\text{strok}$ |
| `ATRV` | Akü / Alternatör Voltajı | `ELM327 Dahili ADC Gerilimi` | Volt (V) |
| `Mode 03`| Aktif Arıza Kodları (DTC) | `SAE J1979 Standart Çözümleme` | P/C/B/U Kodları |
| `Mode 04`| Arıza Lambası Söndürme & Sıfırlama | `ECU Hafıza Temizleme` | Onay |

---

## 📜 Lisans

Bu proje [MIT Lisansı](LICENSE) altında geliştirilmiştir.
