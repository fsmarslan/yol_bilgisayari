"""
2006 Toyota Corolla 1.4 D-4D (1ND-TV) Yakıt Tüketim Modeli Doğrulama ve Birim Testleri.
Test Kapsamı:
1. Dizel Yakıt Yoğunluğu (840 g/L)
2. Dinamik AFR (Hava/Yakıt Oranı) Kalibrasyonu (38.0 / 28.0 / 22.0 / 17.5)
3. Deceleration Fuel Cut-Off (DFCO) Kontrolü
4. Mode 21 Toyota Enjektör Hacmi Öncelikli Hesaplama
5. Rölanti Tüketimi (0.5 - 0.7 L/h) ve Rampa/3000 Devir Tırmanış Doğrulaması
"""
import unittest
import sys
from pathlib import Path

# Backend yolunu sys.path'e ekle
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ble_telemetry import (
    DIESEL_DENSITY_G_PER_L,
    DIESEL_AFR_IDLE,
    DIESEL_AFR_CRUISE,
    DIESEL_AFR_MID,
    DIESEL_AFR_HIGH,
    ENGINE_CYLINDERS,
    calculate_diesel_afr,
    calculate_fuel_rate_from_injection,
    calculate_fuel_rate_from_maf,
    is_dfco_active,
    calculate_diesel_fuel,
)


class TestDieselFuelCalibration(unittest.TestCase):
    def test_01_diesel_density(self):
        """1. Madde: Mazot yoğunluğu 840 g/L (0.840 g/cm3) olmalı, 740 kullanılmamalı."""
        self.assertEqual(DIESEL_DENSITY_G_PER_L, 840.0)
        self.assertNotEqual(DIESEL_DENSITY_G_PER_L, 740.0)
        self.assertNotEqual(DIESEL_DENSITY_G_PER_L, 737.0)

    def test_02_dynamic_afr_curve(self):
        """
        2. Madde: Motor yüküne bağlı dinamik AFR eğrisi:
        - Rölanti / Çok Düşük Yük (Load <= 15%): AFR = 40.0
        - Düşük / Sabit Hızda Akma (15% < Load <= 35%): AFR = 32.0
        - Orta Yük / Şehir İçi (35% < Load <= 65%): AFR = 26.0
        - Yüksek Yük / Rampa / Hızlanma (Load > 65%): AFR = 20.5
        """
        # Rölanti / çok düşük yük (<= 15%)
        self.assertEqual(calculate_diesel_afr(0.0), 40.0)
        self.assertEqual(calculate_diesel_afr(10.0), 40.0)
        self.assertEqual(calculate_diesel_afr(14.0), 40.0)
        self.assertEqual(calculate_diesel_afr(15.0), 40.0)

        # Düşük / Sabit Hızda Akma (15% < Load <= 35%)
        self.assertEqual(calculate_diesel_afr(15.1), 32.0)
        self.assertEqual(calculate_diesel_afr(25.0), 32.0)
        self.assertEqual(calculate_diesel_afr(35.0), 32.0)

        # Orta Yük / Şehir İçi (35% < Load <= 65%)
        self.assertEqual(calculate_diesel_afr(35.1), 26.0)
        self.assertEqual(calculate_diesel_afr(50.0), 26.0)
        self.assertEqual(calculate_diesel_afr(65.0), 26.0)

        # Yüksek Yük / Rampa / Hızlanma (Load > 65%)
        high_afr_70 = calculate_diesel_afr(70.0)
        high_afr_85 = calculate_diesel_afr(85.0)
        high_afr_100 = calculate_diesel_afr(100.0)
        self.assertEqual(high_afr_70, 20.5)
        self.assertEqual(high_afr_85, 20.5)
        self.assertEqual(high_afr_100, 20.5)

        # None yük durumunda güvenli varsayılan seyir AFR (32.0)
        self.assertEqual(calculate_diesel_afr(None), 32.0)

    def test_03_maf_fuel_rate_formula(self):
        """Anlık yakıt akışı (L/h) = (MAF / (AFR * 840)) * 3600 doğrulaması."""
        maf = 32.0  # g/s
        afr = 32.0  # 15-35% cruise
        expected_lph = (maf / (afr * 840.0)) * 3600.0
        calculated_lph = calculate_fuel_rate_from_maf(maf, afr, 840.0)
        self.assertAlmostEqual(calculated_lph, expected_lph, places=4)
        self.assertAlmostEqual(calculated_lph, 4.2857, places=3)

    def test_04_dfco_logic(self):
        """
        3. Madde: Deceleration Fuel Cut-Off (DFCO):
        Speed > 20 km/h, RPM > 1200 ve (Throttle < 2% veya Load < 8%) -> 0.0 L/h
        """
        # Aktif senaryo 1: Gaz pedalı %0, Hız 60 km/h, Devir 2000
        self.assertTrue(is_dfco_active(speed_kmh=60.0, rpm=2000.0, throttle_percent=0.0, load_percent=5.0))
        fuel_display, unit, rate = calculate_diesel_fuel(
            maf_gps=5.0, speed_kmh=60.0, load_percent=5.0, rpm=2000.0, throttle_percent=0.0
        )
        self.assertEqual(rate, 0.0)
        self.assertEqual(fuel_display, 0.0)
        self.assertEqual(unit, "L/100km")

        # Aktif senaryo 2: Gaz pedalı sensörü yok ama yük %4 (< %8), Hız 70, RPM 2200
        self.assertTrue(is_dfco_active(speed_kmh=70.0, rpm=2200.0, throttle_percent=None, load_percent=4.0))
        fuel_display, unit, rate = calculate_diesel_fuel(
            maf_gps=6.0, speed_kmh=70.0, load_percent=4.0, rpm=2200.0, throttle_percent=None
        )
        self.assertEqual(rate, 0.0)
        self.assertEqual(fuel_display, 0.0)

        # Pasif senaryo 1: Hız <= 20 km/h (Örn: Şehir içi yavaşlama / durma)
        self.assertFalse(is_dfco_active(speed_kmh=18.0, rpm=1800.0, throttle_percent=0.0, load_percent=3.0))

        # Pasif senaryo 2: RPM <= 1200 (Debriyaja basılmış veya rölanti toparlama)
        self.assertFalse(is_dfco_active(speed_kmh=50.0, rpm=1000.0, throttle_percent=0.0, load_percent=5.0))

        # Pasif senaryo 3: Gaza basılıyor (Throttle >= 2% ve Load >= 8%)
        self.assertFalse(is_dfco_active(speed_kmh=80.0, rpm=2200.0, throttle_percent=15.0, load_percent=35.0))

    def test_05_mode21_injection_volume_priority(self):
        """
        4. Madde: Mode 21 Enjektör hacmi okunabiliyorsa:
        Yakıt (L/h) = (Enjektör_Hacmi_mm3 * RPM * 4 * 60) / (2 * 1_000_000)
        öncelikli kullanılmalı.
        """
        rpm = 2000.0
        cylinders = 4
        injection_vol = 16.0  # mm3/strok

        expected_lph = (injection_vol * rpm * cylinders * 60.0) / (2.0 * 1_000_000.0)
        calculated_lph = calculate_fuel_rate_from_injection(injection_vol, rpm, cylinders)
        self.assertAlmostEqual(calculated_lph, expected_lph, places=4)
        self.assertAlmostEqual(calculated_lph, 3.84, places=2)

        # calculate_diesel_fuel fonksiyonunda Mode 21'in MAF'a göre önceliği
        # MAF çok farklı bir değer verse bile enjektör hacmi esas alınmalı
        display, unit, rate = calculate_diesel_fuel(
            maf_gps=100.0,  # yanıltıcı/farklı MAF
            speed_kmh=90.0,
            load_percent=30.0,
            rpm=2000.0,
            throttle_percent=15.0,
            injection_volume_mm3=16.0,
        )
        self.assertAlmostEqual(rate, 3.84, places=2)
        # 90 km/h hızda: (3.84 / 90) * 100 = 4.26 -> 4.3 L/100km
        self.assertAlmostEqual(display, 4.3, places=1)
        self.assertEqual(unit, "L/100km")

    def test_06_warm_idle_consumption_band(self):
        """
        5. Madde: Rölantide motor sıcakken anlık tüketim 0.5 - 0.7 L/h bandına oturmalı.
        Toyota 1.4 D-4D rölanti parametreleri:
        - Hız: 0 km/h
        - Devir: 800 - 850 RPM
        - Yük: <= 15% (Nominal ~12-14%)
        - MAF: 4.5 - 6.0 g/s
        """
        test_maf_values = [4.8, 5.0, 5.5, 6.0, 6.5]
        for maf in test_maf_values:
            display, unit, rate = calculate_diesel_fuel(
                maf_gps=maf,
                speed_kmh=0.0,
                load_percent=13.5,
                rpm=820.0,
                throttle_percent=0.0,
            )
            self.assertEqual(unit, "L/h")
            self.assertIsNotNone(display)
            self.assertIsNotNone(rate)
            self.assertGreaterEqual(display, 0.50, f"MAF={maf} icin tuketim 0.5 L/h altinda kaldi: {display}")
            self.assertLessEqual(display, 0.70, f"MAF={maf} icin tuketim 0.7 L/h ustune cikti: {display}")

        # Mode 21 Enjektör Hacmi ile Rölanti (Sıcak motorda ~5.2 - 6.5 mm3/strok @ 820 d/d)
        test_inj_volumes = [5.2, 5.5, 6.0, 6.5]
        for inj_vol in test_inj_volumes:
            display, unit, rate = calculate_diesel_fuel(
                maf_gps=None,
                speed_kmh=0.0,
                load_percent=13.0,
                rpm=820.0,
                throttle_percent=0.0,
                injection_volume_mm3=inj_vol,
            )
            self.assertEqual(unit, "L/h")
            self.assertGreaterEqual(display, 0.50)
            self.assertLessEqual(display, 0.70)

    def test_07_denso_stationary_load_filter(self):
        """
        Denso ECU dururken 41 04 FF (%100) yük hatası verse bile
        rölantide tüketim 0.5 - 0.7 L/h bandında kalmalı.
        """
        display, unit, rate = calculate_diesel_fuel(
            maf_gps=5.0,
            speed_kmh=0.0,
            load_percent=100.0,  # Hatalı Denso 0xFF cevabı
            rpm=820.0,
            throttle_percent=0.0,
        )
        self.assertEqual(unit, "L/h")
        self.assertGreaterEqual(display, 0.50)
        self.assertLessEqual(display, 0.70)

    def test_08_ramp_climb_3000rpm_calibration(self):
        """
        Rampa tırmanışı ve 3000 devir bandı kalibrasyon doğrulaması:
        Kalibrasyonda 3000 devir yüksek yükte tüketim fiziksel gerçekçi değerlere
        (Load > 65% -> AFR = 20.5, anlık ~15.8 L/100km tırmanış debisi) oturmalıdır.
        """
        # 3000 Devir, Rampa Tırmanışı (%75 Yük, 90 km/h, MAF ~68 g/s):
        display, unit, rate = calculate_diesel_fuel(
            maf_gps=68.0,
            speed_kmh=90.0,
            load_percent=75.0,  # Load > 65% -> AFR = 20.5
            rpm=3000.0,
            throttle_percent=60.0,
        )
        self.assertEqual(unit, "L/100km")
        # Anlık rampa tırmanış debisi:
        # L/h = (68 / (20.5 * 840)) * 3600 = 14.22 L/h
        # L/100km = (14.22 / 90) * 100 = 15.8 L/100km
        self.assertGreaterEqual(rate, 13.5)
        self.assertGreaterEqual(display, 14.0)

        # Sabit seyir (90 km/h, 2000 RPM, %28 Yük, MAF ~26 g/s):
        cruise_display, cruise_unit, cruise_rate = calculate_diesel_fuel(
            maf_gps=26.0,
            speed_kmh=90.0,
            load_percent=28.0,  # 15% < Load <= 35% -> AFR = 32.0
            rpm=2000.0,
            throttle_percent=18.0,
        )
        self.assertEqual(cruise_unit, "L/100km")
        # L/h = (26 / (32 * 840)) * 3600 = 3.48 L/h -> 3.9 L/100km
        self.assertAlmostEqual(cruise_display, 3.9, delta=0.2)


if __name__ == "__main__":
    unittest.main()
