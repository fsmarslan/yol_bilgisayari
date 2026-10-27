# AuraDrive Pro

Toyota Corolla 1.4 D-4D (1ND-TV) odaklı geliştirilen OBD-II yol bilgisayarı ve telemetri projesi. Android uygulamasında canlı araç verileri, sürüş özeti ve tahmini yakıt tüketimi sunar. Tarayıcıdaki simülasyon modu, araca bağlanmadan arayüzü incelemek için kullanılabilir.

## Temel özellikler

- Bluetooth LE üzerinden OBD-II verilerini okuma.
- Hız, motor devri, soğutma suyu sıcaklığı, MAP, MAF ve voltaj göstergeleri.
- Mesafe, yakıt ve maliyet hesabı ile sürüş geçmişi.
- Android Picture-in-Picture penceresi ve arka plan servisi.
- DTC arıza kodlarını okuma ve kod temizleme isteği gönderme.
- Motor yüküne bağlı AFR modeli ve Mode 21 enjektör verisiyle tüketim tahmini.

## Hızlı başlangıç

### Android

1. Depodaki [AuraDrivePro.apk](AuraDrivePro.apk) dosyasını telefonunuza indirin ve yükleyin.
2. Bluetooth ve konum izinlerini verin.
3. Uyumlu BLE OBD-II adaptörünü araca bağlayın ve kontağı açın.
4. Uygulamadaki bağlantı ve telemetri durumunu kontrol edin.

Bağlantı, okunabilen PID'ler ve arka plan davranışı; adaptöre, ECU'ya, Android sürümüne ve cihazın güç yönetimine göre değişebilir.

### Tarayıcı ve simülasyon

```bash
cd frontend
npm ci
npm run dev
```

[http://localhost:3000](http://localhost:3000) adresini açın ve **SİMÜLASYON** modunu seçin.

### Python geliştirme sunucusu

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### Android APK derleme

Java / Android SDK ve Android derleme araçlarının kurulu olduğu ortamda:

```bash
./build_apk.sh
```

Betik, USB üzerinden bağlı bir cihaz varsa APK'yı yüklemeyi de dener.

## Ekranlar

| Sekme | İçerik |
| --- | --- |
| Sürüş | Hız, devir, turbo basıncı, sıcaklık ve tahmini anlık tüketim |
| Trip | Mesafe, toplam yakıt, maliyet, süre ve rota |
| Performans | Hızlanma süreleri, tepe basıncı, tahmini güç ve tork |
| Motor | MAP, MAF, motor yükü ve desteklenirse enjektör hacmi |
| Sağlık | DTC kodları, voltaj ve bağlantı durumu |

## Tüketim modeli ve doğrulama sınırları

MAF tabanlı hesaplamada aşağıdaki model kullanılır:

```text
Yakıt (L/h) = MAF (g/s) / (AFR × yoğunluk (g/L)) × 3600
```

Varsayılan yoğunluk **840 g/L**; AFR katsayıları motor yüküne göre **40.0 / 32.0 / 26.0 / 20.5** olarak yapılandırılmıştır. Bunlar uygulamanın model parametreleridir. Mode 21 enjektör hacmi okunabildiğinde alternatif hesaplama kullanılır; veri bulunamazsa MAF modeline dönülür.

Gösterilen tüketim, güç, tork ve vites değerleri tahmin içerir. Birim testleri hesaplama kurallarını kontrol eder; gerçek araçtaki ölçüm doğruluğunu, tüm adaptörlerle uyumu veya arka planda kesintisiz veri toplamayı kanıtlamaz.

Gerçek kullanım doğruluğunu değerlendirmek için aynı sürüşlerde referans ölçüm, hesaplanan tüketim, mesafe, adaptör modeli ve bağlantı kesintileri birlikte kaydedilmeli; karşılaştırmanın hata payı paylaşılmalıdır.

## Testler

`backend/test_fuel_calculation.py` sekiz test metodu içerir. AFR sınırları, MAF ve enjektör hesaplamaları, DFCO kuralları ve örnek sürüş senaryolarını kontrol eder.

Backend bağımlılıkları kurulduktan sonra:

```bash
cd backend
python3 -m unittest test_fuel_calculation.py -v
```

Bu testler Python hesaplama katmanını kapsar. Android'de kullanılan TypeScript BLE servisi ve gerçek donanım akışı ayrıca doğrulanmalıdır.

## Proje yapısı

```text
backend/
  app/config.py              Model ve bağlantı ayarları
  app/ble_service.py         BLE telemetri ve yakıt hesaplamaları
  app/main.py                FastAPI geliştirme sunucusu
  test_fuel_calculation.py   Python hesaplama testleri
frontend/
  app/page.tsx               Ana arayüz
  app/components/            Arayüz bileşenleri
  app/services/              BLE ve arka plan servisleri
  android/                   Android / Capacitor projesi
build_apk.sh                 APK derleme ve yükleme betiği
```

## Geliştirme planı

- Gerçek cihazdan ekran görüntüleri ve kısa kullanım videosu ekleme.
- Referans tüketim ölçümleriyle karşılaştırma raporu yayımlama.
- Ana arayüzü sekme bileşenlerine ve ortak durum yönetimine ayırma.
- TypeScript tüketim hesaplamaları ve bağlantı kesintileri için testler ekleme.
