# 🏎️ AuraDrive Pro — Akıllı Yol Bilgisayarı & Telemetri Sistemi

<div align="center">

![Toyota Corolla 1.4 D-4D](https://img.shields.io/badge/Vehicle-Toyota%20Corolla%201.4%20D--4D%20(1ND--TV)-crimson?style=for-the-badge&logo=toyota)
![Platform](https://img.shields.io/badge/Platform-Android%20APK%20(PiP%20%2B%20Foreground)%20%7C%20Web%20PWA-teal?style=for-the-badge&logo=android)
![Frontend](https://img.shields.io/badge/Frontend-Next.js%2014%20%7C%20Capacitor%206-black?style=for-the-badge&logo=next.js)
![Protocol](https://img.shields.io/badge/OBD--II-ISO%2014230--4%20KWP%20Fast%20(ATSP5)-orange?style=for-the-badge&logo=bluetooth)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

<p align="center">
  <b>2006 Toyota Corolla 1.4 D-4D (1ND-TV Turbo Dizel)</b> için özel olarak geliştirilmiş; harici bilgisayar veya sunucuya ihtiyaç duymadan doğrudan Android telefonda çalışan, sistem seviyesinde <b>Picture-in-Picture (PiP)</b> destekli, lüks kokpit tasarımlı, düşük gecikmeli Bluetooth LE / OBD-II yol bilgisayarı ve teşhis platformu.
</p>

</div>

---

## 🌟 Öne Çıkan Başlıca Yetenekler

### 1. 🫧 Android Sistem Seviyesi Picture-in-Picture (Yüzen Mini PiP HUD)
- **Google Haritalar / Yandex / Spotify Üzerinde Canlı Gösterge:** Üst bardaki **`🫧 MİNİ PİP`** butonuna dokunulduğunda veya uygulamadan çıkıldığında, Android işletim sistemi uygulamayı diğer tüm uygulamaların üzerinde yüzen **bağımsız bir Picture-in-Picture (PiP)** penceresine dönüştürür.
- **Ultra Okunabilir Kokpit Görünümü:** Küçük PiP penceresinde karmaşık menüler gizlenir; uzaktan bile rahatça okunabilen **büyük neon Hız (KM/H)**, **Tahmini Vites (1-5 / N)**, **Anlık Tüketim (L/100km)**, **Akü Voltajı (V)** ve **Devir** gösterilir.
- **Sürüklenebilir & Boyutlandırılabilir:** Tek parmakla ekranın istenen köşesine taşınabilir, çift dokunarak büyütülebilir veya tam ekrana dönülebilir.

---

### 2. 🎵 3'lü Görev Dengesi: Yol Bilgisayarı + Müzik (A2DP) + Navigasyon (GPS)
Aracı kullanırken aynı anda hem Bluetooth ile müzik dinleyip hem harita navigasyonu kullanıp hem de arka planda yol bilgisayarı çalıştırmak için özel bir **Paced Priority Balancing** mimarisi geliştirilmiştir:
1. **1. Öncelik — Kesintisiz Yol Bilgisayarı:** Arka planda (`AuraForegroundService` + `PARTIAL_WAKE_LOCK`) 12 saniyelik zaman aşımı toleransı ile navigasyona geçildiğinde bile **yapılan kilometre ve harcanan yakıt sıfır kayıpla** tam entegre edilir. Durum çubuğunda anlık hız ve yakıt 1.2 saniyede bir canlı akar.
2. **2. Öncelik — Kesintisiz Müzik (Bluetooth A2DP):** Android `CONNECTION_PRIORITY_BALANCED` modu ve komutlar arası $16\text{ms} - 24\text{ms}$ mikro nefes alma pencereleri sayesinde Spotify / YouTube Music'te **en ufak bir çıtırtı, donma veya atlama yaşanmaz**.
3. **3. Öncelik — Navigasyon & GPS Uyumu:** Arka plandayken gereksiz React render'ları durdurulur (`isForeground` kontrolü). GPS dinleyicisi `maximumAge: 3000ms` ile Android'in konum önbelleğini Google Haritalar ile paylaşımlı kullanır; telefon ısınmaz, batarya korunur.

---

### 3. 🩺 OBD-II DTC Arıza Teşhis & Kod Silme Merkezi (Mode 03 & Mode 04)
- **Hata Kodlarını Okuma (Mode 03):** Motor beynindeki (ECU) kayıtlı ve bekleyen arıza kodlarını okur.
- **Geniş Türkçe Arıza Veritabanı:** Kodun ne anlama geldiğini açıklar (Örn: `P0400 - EGR Akış Arızası (Kurum birikmesi)`, `P0380 - Kızdırma Bujisi Devresi Arızası`, `P0100 - MAF Sensör Devresi`). Sistem türünü (`Motor`, `Şasi`, `Ağ`) ve ciddiyetini (`Kritik`, `Orta`, `Düşük`) etiketler.
- **Check Engine Söndürme (Mode 04 - Clear DTC):** Tek tuşla ECU arıza hafızasını sıfırlar ve gösterge panelindeki sarı motor arıza lambasını söndürür.

---

### 4. ⚡ Akü & Şarj Dinamosu Voltaj Sağlığı (ELM327 `ATRV`)
- Donanımsal `ATRV` komutu ile aracın OBD-II portundaki elektrik gerilimini ölçer.
- **Üst Bar Rozeti:** Anlık voltaj sürekli göz önündedir (`🔋 14.1V`).
- **Dinamik Teşhis:**
  - **Motor Çalışırken:** $\ge 13.6\text{ V}$ ise `✓ Alternatör şarj ediyor (Normal: 13.8V - 14.4V)` 🟢
  - **Kontak Açık / Motor Kapalı:** $12.4\text{ V} - 12.8\text{ V}$ ise `Akü Seviyesi Normal` 🟡
  - $< 12.0\text{ V}$ ise `⚠️ Düşük Voltaj! Akü veya şarj dinamosunu kontrol edin.` 🔴 uyarısı verir.

---

### 5. 🛢️ 1.4 D-4D (1ND-TV) Termodinamik Dizel Tüketim Modeli
Benzinli motorlardan farklı olarak dizel motorlar geniş hava fazlalığı katsayısı (AFR) ile çalışır:
- **Yakıt Yoğunluğu:** Euro Dizel `840 g/L`.
- **Non-Lineer Efektif AFR Modeli:** Rölantide $55:1 - 65:1$, 90 km/h sabit seyirde $35:1 - 38:1$, dip gazda $17.5:1$ tam güç karışımı (`load_factor = (1.0 - load / 100) ** 3.0`).
- **Fabrika Verileriyle Tam Uyum:** 90 km/h sabit hızda Corolla 1.4 D-4D fabrika normuna uygun **`4.1 L/100km`**, sıcak rölantide **`0.47 L/h`**.
- **Kompresyonda Kesme (Deceleration Cut-off):** Vites vitesteyken gaz bırakıldığında (`Hız > 15 km/h` ve `Gaz < %2`) tüketim **`0.00 L/100km`** olarak yansıtılır.
- **Birimler:** Araç dururken **`L/saat`**, hareket halindeyken **`L/100km`**.

---

### 6. 📈 Riemann Sayısal İntegrali & Sürüş Geçmişi (Trip Engine)
- Basit aritmetik ortalama yerine her milisaniyede tekerlek hızı ve enjektör debisini entegre eder:
  $$\text{Toplam Yakıt (L)} = \sum \left(\frac{\text{Debi (L/h)} \times \Delta t}{3600}\right), \quad \text{Mesafe (km)} = \sum \left(\frac{\text{Hız (km/h)} \times \Delta t}{3600}\right)$$
- **Mükerrer Kayıt Önleme:** Çift kayıt oluşmasını engelleyen koruma mekanizması.
- **İnteraktif Koyu Harita:** Leaflet tabanlı neon rota çizgisi, başlangıç/bitiş pinleri ve JSON seyahat dışa aktarma (Export).

---

### 7. ⏱️ 0-100 & 0-50 km/h Drag Performans Sayacı
- **Otomatik Hazır Modu:** Araç durduğu anda ($\le 0.8\text{ km/h}$) sistem otomatik olarak **`HAZIR (READY)`** durumuna geçer; gaza basıldığı ilk milisaniyede ölçüm başlar.
- 50 km/h ve 100 km/h sürelerini ayrı ayrı kaydeder; en iyi dereceyi (Personal Best - PB) hafızada tutar.
- **Sanal Dinamometre:** 1ND-TV motorun fabrika eğrileriyle anlık **Beygir Gücü (HP)** ve **Tork (Nm)** tahmini.

---

### 8. 🎨 4 Farklı Lüks Kokpit Teması & F1 Shift Lights
- **Temalar:** `Cyber Cyan` (Modern Neon), `GR Red` (Toyota Gazoo Racing Spor), `Amber` (Gece Sürüşü / Göz Yormayan), `Emerald Track` (Klasik Yarış Yeşili).
- **Sequential Shift Lights:** Üst barda F1 tarzı çok renkli devir ledleri.
- **Vites Tahmini:** Hız ve devir oranından anlık vites göstergesi (1 - 5 / N).

---

## 🎛️ Dashboard Sekmeleri

| Sekme | Açıklama & Göstergeler |
|---|---|
| **SÜRÜŞ** | Devir çubuğu, Turbo Bar, Dijital Hız, Anlık Tüketim, Anlık Maliyet (₺/km), Hararet, Trip Mesafesi ve Ortalama Tüketim. |
| **TRİP** | Yapılan km, harcanan toplam litre, toplam yakıt tutarı (₺), ortalama hız, maksimum hız, sürüş ve hareket süreleri, rota haritası ve geçmiş sürüşler. |
| **PERFORMANS** | Otomatik 0-100 km/h, 0-50 km/h süreleri, Personal Best (PB) rekoru, Peak Boost (Bar), Anlık Beygir (HP) ve Tork (Nm). |
| **MOTOR** | MAP manifold basıncı, MAF hava akışı (g/s), Motor Yükü (%), Gaz Kelebeği (%), Emme Havası Sıcaklığı (°C). |
| **SAĞLIK** | OBD-II DTC Arıza Teşhis & Kod Silme Merkezi, Akü / Alternatör Voltaj Çubuğu, Bağlantı Protokolü (ATSP5), WakeLock ve Arka Plan Servis Durumu. |

---

## 🏗️ Proje Mimarisi

```text
yol_bilgisayari/
├── AuraDrivePro.apk                  # Doğrudan telefona yüklenebilir güncel Android APK
├── build_apk.sh                      # Tek tıkla APK derleme ve telefona yükleme betiği
├── backend/                          # Python / FastAPI Geliştirme & Simülasyon Sunucusu
│   ├── app/
│   │   ├── config.py                 # BLE, PID ve Dizel motor parametreleri
│   │   ├── ble_service.py            # Bleak tabanlı BLE yöneticisi, ATRV ve simülasyon
│   │   └── main.py                   # FastAPI REST API (/live-data, /data)
│   └── requirements.txt              # Python bağımlılıkları
├── frontend/                         # Next.js 14 + Capacitor 6 Android Projesi
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
│   │   │   ├── obd-ble.service.ts    # Saf TypeScript Mobil BLE, DTC Teşhis & Yakıt Motoru
│   │   │   └── background.service.ts # PiP & Foreground servis yöneticisi
│   │   ├── globals.css               # Kokpit temaları ve animasyonlar
│   │   └── page.tsx                  # Ana Kokpit, PiP HUD, Trip ve Teşhis Arayüzü
│   ├── capacitor.config.ts           # Capacitor Android yapılandırması
│   └── package.json
└── README.md
```

---

## 🚀 Kurulum ve Çalıştırma

### 📱 1. Android Telefonda Doğrudan Kullanım (Tavsiye Edilen)
1. Ana dizindeki [`AuraDrivePro.apk`](AuraDrivePro.apk) dosyasını telefonunuza yükleyin.
2. Telefonunuzun **Bluetooth** ve **Konum (GPS)** servislerini açın.
3. ELM327 adaptörünü aracınızın OBD portuna takıp kontağı açın; uygulama otomatik bağlanacaktır.
4. Google Haritalar veya başka bir uygulamaya geçerken **`🫧 MİNİ PİP`** butonuna basarak haritanın köşesinde yüzen hız göstergesini kullanabilirsiniz.

#### APK'yı Yeniden Derlemek İçin:
```bash
./build_apk.sh
```

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
| `0104` | Hesaplanan Motor Yükü | `(A * 100) / 255` | % |
| `0105` | Soğutma Suyu Sıcaklığı (Coolant) | `A - 40` | °C |
| `010B` | Emme Manifoldu Basıncı (MAP) | `A` | kPa |
| `010F` | Emme Havası Sıcaklığı (IAT) | `A - 40` | °C |
| `0110` | Hava Akış Hızı (MAF) | `((A * 256) + B) / 100` | g/s |
| `0111` | Gaz Kelebeği / Pedal Konumu | `(A * 100) / 255` | % |
| `0121` | Arıza Lambası (MIL) ile Yapılan Yol | `(A * 256) + B` | km |
| `ATRV` | Akü / Alternatör Voltajı | `ELM327 Dahili ADC Gerilimi` | Volt (V) |
| `Mode 03`| Aktif Arıza Kodları (DTC) | `SAE J1979 Standart Çözümleme` | P/C/B/U Kodları |
| `Mode 04`| Arıza Lambası Söndürme & Sıfırlama | `ECU Hafıza Temizleme` | Onay |

---

## 📜 Lisans

Bu proje [MIT Lisansı](LICENSE) altında geliştirilmiştir.

