# 🏎️ AuraDrive Pro — Akıllı Yol Bilgisayarı & Telemetri Sistemi

<div align="center">

![Toyota Corolla 1.4 D-4D](https://img.shields.io/badge/Vehicle-Toyota%20Corolla%201.4%20D--4D%20(1ND--TV)-crimson?style=for-the-badge&logo=toyota)
![Platform](https://img.shields.io/badge/Platform-Android%20APK%20%7C%20Web%20PWA-teal?style=for-the-badge&logo=android)
![Frontend](https://img.shields.io/badge/Frontend-Next.js%2014%20%7C%20Capacitor-black?style=for-the-badge&logo=next.js)
![Protocol](https://img.shields.io/badge/OBD--II-ISO%2014230--4%20KWP%20Fast%20(ATSP5)-orange?style=for-the-badge&logo=bluetooth)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

<p align="center">
  <b>2006 Toyota Corolla 1.4 D-4D (1ND-TV Turbo Dizel)</b> için sıfırdan geliştirilmiş; harici sunucu veya bilgisayara ihtiyaç duymadan doğrudan Android telefonda çalışan, lüks kokpit tasarımlı, düşük gecikmeli Bluetooth LE / OBD-II yol bilgisayarı ve telemetri dashboard'u.
</p>

</div>

---

## 🌟 Öne Çıkan Özellikler

### 1. 📱 %100 Bağımsız Android Uygulaması (Tek Parça APK & Arka Plan Desteği)
- **Harici Sunucu / Python Gerekmez:** Python backend'deki tüm Bluetooth ELM327 haberleşme ve hesaplama mantığı saf **TypeScript** servisine ([`obd-ble.service.ts`](frontend/app/services/obd-ble.service.ts)) taşınmıştır.
- **Kesintisiz Arka Plan Modu (Foreground Service):** Telefon kilitliyken veya başka navigasyon / müzik uygulamaları (Google Haritalar, Yandex, Spotify) açıkken Bluetooth OBD-II okumaya, Trip tüketimini toplamaya ve GPS rotasını kaydetmeye devam eder.
- **Canlı Durum Çubuğu Bildirimi:** Android bildirim merkezinde ve kilit ekranında anlık hız, anlık yakıt, trip mesafesi ve toplam masrafı canlı gösterir.
- **Doze Modu & Pil Koruması:** Android'in derin uykuya alıp uygulamayı kapatmasını önleyen pil optimizasyonu muafiyet yönetimi.
- **Ekran Uyanık Tutma (Screen WakeLock):** Kokpit modunda sürüş boyunca ekranın kapanmasını engeller.

### 2. 🛢️ Dizel Motor Termodinamik Yakıt Hesaplama Motoru
Dizel motorlar benzinli araçlar gibi sabit 14.7:1 AFR ile çalışmaz; daima aşırı hava (fakir karışım) ile çalışır. Sistemimiz 1ND-TV motor karakteristiğine göre kalibre edilmiştir:
- **Euro Dizel Yoğunluğu:** `840 g/L` baz alınır.
- **Non-Lineer Efektif AFR Modeli:** Rölantide $55:1 - 65:1$, 90 km/h sabit seyirde $35:1 - 38:1$, dip gazda $17.5:1$ tam güç karışımı.
- **Kompresyonda Gaz Kesme (Deceleration Fuel Cut-off):** Vites vitesteyken gaz pedalı bırakıldığında (Devir > 1150 d/d ve Gaz < %2) enjektörler tamamen kapatılır ve anlık tüketim **`0.00 L/100km`** olarak yansıtılır.
- **Otomatik Birim Geçişi:** Araç dururken **`L/saat`**, hareket halindeyken **`L/100km`** birimine otomatik geçer.

### 3. 📈 Riemann Sayısal İntegrali ile Gerçek Yol Bilgisayarı (Trip Engine)
Basit aritmetik ortalama yerine modern araç üreticilerinin kullandığı **Riemann İntegrali** ile milisaniye bazlı toplanır:
$$\text{Toplam Yakıt (L)} = \sum \left(\frac{\text{Debi (L/h)} \times \Delta t\text{ (sn)}}{3600}\right), \quad \text{Mesafe (km)} = \sum \left(\frac{\text{Hız (km/h)} \times \Delta t\text{ (sn)}}{3600}\right)$$
- Trafikte veya kırmızı ışıkta durduğunuzda harcanan yakıtı tam olarak toplayarak gerçek ortalama tüketimi üretir.

### 4. 💵 Dinamik Mazot Fiyatı & Anlık Maliyet Motoru
- **Anlık Maliyet (₺/km & ₺/saat):** Seyir halindeyken kilometre başına kaç TL yaktığınızı, rölantide saatte kaç TL harcadığınızı gösterir.
- **Trip Toplam Masrafı (₺):** Kontak açılışından itibaren kaç TL'lik mazot yaktığınızı hesaplar.
- **Canlı Fiyat Düzenleyici:** Üst bardaki `⛽ 44.50 ₺/L` rozetine tıklayarak açılan modal üzerinden akaryakıt fiyatını hızlıca güncelleyebilirsiniz (LocalStorage'da kalıcı olarak saklanır).

### 5. 💨 Gerçek Turbo Boost Basıncı & Otomatik Rakım Kalibrasyonu
- Orijinal manifold basınç sensöründen (MAP) okunur: $\text{Boost (Bar)} = (\text{MAP} - \text{Atmosfer}) / 100$.
- Kontak ilk açıldığında bulunulan şehrin rakımına göre atmosferik basınç otomatik hafızaya alınır (Deniz kenarında 101 kPa, Ankara'da ~92 kPa). Rakım kaynaklı turbo sapması yaşanmaz.
- Canlı amber ışıltılı turbo boost bar göstergesi.

### 6. ⏱️ Otomatik 0-100 & 0-50 km/h Drag Performans Sayacı
- **Otomatik Tetikleme:** Araç dururken (0 km/h) gazlandığı milisaniyede sayaç başlar.
- **Hassas Ölçüm:** 50 km/h ve 100 km/h sürelerini ayrı ayrı kaydeder.
- **Personal Best (PB):** Aracın en iyi 0-100 süresini ve sürüşteki tepe turbo basıncını (Peak Boost) hafızada tutar.
- **Dinamometre Tahmini:** 1ND-TV motorun fabrika eğrileriyle anlık **Beygir Gücü (HP)** ve **Tork (Nm)** kestirimi.

### 7. 🛡️ Akıllı Motor & Turbo Koruma Asistanı
- **Soğuk Motor Alarmı:** Su sıcaklığı $<70^\circ\text{C}$ iken turbo ve motoru korumak için yüksek devirden kaçınma uyarısı verir.
- **Yüksek Hararet Alarmı:** Su sıcaklığı $\ge 98^\circ\text{C}$ olduğunda kırmızı uyarı paneli açar.
- **Shift Light (Vites Tavsiyesi):** Devir > 2200 d/d ve yük > %25 iken optimum yakıt tasarrufu için bir üst vitese geçiş tavsiyesi verir.

### 8. ⚡ Sıfır Gecikmeli Interleaved BLE İletişim Motoru
- **0 ms Event Resolver:** Bluetooth paketleri geldiği anda beklemesiz çözümlenir.
- **Çoklu Öncelikli Sorgulama:** Devir (RPM) ve Hız her döngüde 1. öncelikle sorgulanır; ekrandaki ibreler **25–35 ms içinde (30+ FPS)** yenilenir.
- `ATAT2` agresif adaptif zamanlama ve `ATS0` boşluksuz sıkıştırma ile ELM327 baudrate performansı maksimize edilmiştir.

---

## 🎛️ Dashboard Sekmeleri

| Sekme | Açıklama & Göstergeler |
|---|---|
| **SÜRÜŞ** | Devir çubuğu, Turbo Bar, Dijital Hız, Anlık Tüketim, Anlık Maliyet (₺/km), Hararet, Trip Mesafesi ve Ortalama Tüketim. |
| **TRİP** | Kat edilen mesafe, harcanan toplam litre, toplam yakıt tutarı (₺), ortalama hız, maksimum hız, sürüş ve hareket süreleri. |
| **PERFORMANS** | 0-100 km/h süresi, 0-50 km/h süresi, En İyi PB rekoru, Peak Boost (Bar), Anlık Beygir (HP) ve Tork (Nm). |
| **MOTOR** | MAP manifold basıncı, MAF hava akışı (g/s), Motor Yükü (%), Gaz Kelebeği (%), Emme Havası Sıcaklığı (°C). |
| **SAĞLIK** | Bağlantı durumu, KWP Fast protokolü, Arıza Lambası (MIL) mesafesi, Ekran WakeLock durumu. |

---

## 🏗️ Proje Mimarisi

```text
yol_bilgisayari/
├── AuraDrivePro.apk                  # Doğrudan telefona yüklenebilir bağımsız Android APK
├── build_apk.sh                      # Tek tıkla otomatik APK derleme ve telefona yükleme betiği
├── backend/                          # Python / FastAPI Geliştirme & Simülasyon Sunucusu
│   ├── app/
│   │   ├── config.py                 # BLE, PID ve Dizel motor parametreleri
│   │   ├── ble_service.py            # Bleak tabanlı BLE yöneticisi ve simülasyon motoru
│   │   └── main.py                   # FastAPI REST API (/live-data, /data, /health)
│   ├── requirements.txt              # Python bağımlılıkları
│   └── desteklenen_veriler_raporu.md # Araçtan okunan ham PID analiz raporu
├── frontend/                         # Next.js 14 + Capacitor Android Projesi
│   ├── android/                      # Yerel Android Studio / Gradle projesi
│   │   └── app/src/main/AndroidManifest.xml # BLE, Location ve WakeLock izinleri
│   ├── app/
│   │   ├── services/
│   │   │   └── obd-ble.service.ts    # Saf TypeScript Mobil BLE & OBD Motoru (~30 FPS)
│   │   ├── globals.css               # Lüks Old Money & Spor Kokpit teması
│   │   ├── layout.tsx                # PWA ve Viewport yapılandırması
│   │   └── page.tsx                  # Canlı Dashboard, Trip Motoru ve Göstergeler
│   ├── capacitor.config.ts           # Capacitor Android yapılandırması
│   ├── next.config.js                # Static Export yapılandırması
│   └── package.json
└── README.md
```

---

## 🚀 Kurulum ve Çalıştırma

### 📱 1. Bağımsız Android APK Olarak Kullanım (Araçta)

1. Proje ana dizinindeki [`AuraDrivePro.apk`](AuraDrivePro.apk) dosyasını telefonunuza atıp **Yükle** deyin.
2. Telefonun **Bluetooth** ve **Konum (GPS)** servislerini açın.
3. Aracın kontağını açıp uygulamayı başlatın; adaptöre otomatik bağlanacaktır.

#### APK'yı Yeniden Derlemek İçin:
```bash
./build_apk.sh
```
*(Telefonunuz USB ile Mac'e bağlıysa `adb` üzerinden otomatik olarak telefona yüklenir).*

---

### 💻 2. Bilgisayar / Tarayıcı Geliştirme Modu

#### Backend (FastAPI + Bleak):
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Canlı OBD veya Simülasyon Modu (.env içinde MOCK_MODE=true/false)
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

#### Frontend (Next.js):
```bash
cd frontend
npm install
npm run dev
```
Tarayıcınızda `http://localhost:3000` adresini açarak canlı telemetriyi inceleyebilirsiniz.

---

## 📊 Desteklenen OBD-II PID Listesi (Toyota 1ND-TV)

| PID (Hex) | Sensör Adı | Dönüşüm Formülü | Birim |
|---|---|---|---|
| `010C` | Motor Devri (RPM) | `((A * 256) + B) / 4` | d/d (RPM) |
| `010D` | Araç Hızı (Speed) | `A` | km/h |
| `0104` | Hesaplanan Motor Yükü | `(A * 100) / 255` | % |
| `0105` | Soğutma Suyu Sıcaklığı (Coolant) | `A - 40` | °C |
| `010B` | Emme Manifoldu Basıncı (MAP) | `A` | kPa |
| `010F` | Emme Havası Sıcaklığı (IAT) | `A - 40` | °C |
| `0110` | Hava Akış Hızı (MAF) | `((A * 256) + B) / 100` | g/s |
| `0111` | Gaz Kelebeği / Pedal Konumu | `(A * 100) / 255` | % |
| `0121` | Arıza Lambası (MIL) ile Kat Edilen Mesafe | `(A * 256) + B` | km |

---

## 📜 Lisans

Bu proje [MIT Lisansı](LICENSE) altında geliştirilmiştir.
