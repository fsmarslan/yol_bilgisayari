import os
from pathlib import Path
from dotenv import load_dotenv

# .env dosyasını backend dizininden yükle
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

# Simülasyon / Demo Modu (Araca bağlı değilken test için)
MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() in ("true", "1", "yes", "demo")

# BLE Bağlantı Ayarları
BLE_DEVICE_ADDRESS = os.getenv("BLE_OBD_ADDRESS", "")  # Boşsa isimle otomatik keşfeder
BLE_NAME_HINTS = [h.strip() for h in os.getenv("BLE_OBD_NAME_HINTS", "OBD,OBDII,ELM,VLINK,VGATE,CAN").split(",") if h.strip()]
WRITE_CHAR_UUID = os.getenv("BLE_WRITE_UUID", "0000fff2-0000-1000-8000-00805f9b34fb")
NOTIFY_CHAR_UUID = os.getenv("BLE_NOTIFY_UUID", "0000fff1-0000-1000-8000-00805f9b34fb")

# Zamanlama ve Zaman Aşımı Ayarları
SCAN_TIMEOUT_SECONDS = float(os.getenv("BLE_SCAN_TIMEOUT", "6.0"))
RECONNECT_DELAY_SECONDS = float(os.getenv("BLE_RECONNECT_DELAY", "2.0"))
MAX_RECONNECT_DELAY_SECONDS = float(os.getenv("BLE_MAX_RECONNECT_DELAY", "4.0"))
COMMAND_TIMEOUT_SECONDS = float(os.getenv("BLE_COMMAND_TIMEOUT", "0.6"))
POLL_INTERVAL_SECONDS = float(os.getenv("BLE_POLL_INTERVAL", "0.15"))
IDLE_POLL_INTERVAL_SECONDS = float(os.getenv("BLE_IDLE_POLL_INTERVAL", "1.0"))
MOVING_POLL_INTERVAL_SECONDS = float(os.getenv("BLE_MOVING_POLL_INTERVAL", "0.15"))
SLOW_PID_INTERVAL_SECONDS = float(os.getenv("BLE_SLOW_PID_INTERVAL", "5.0"))

# Toyota 1.4 D-4D (1ND-TV) Dizel Motor ve Yakıt Parametreleri
# 1. Dizel Yakıt Yoğunluğu: Euro Diesel için 840 g/L (0.840 g/cm³)
DIESEL_DENSITY_G_PER_L = float(os.getenv("DIESEL_DENSITY", "840.0"))

# 2. Dinamik AFR (Hava/Yakıt Oranı) Kalibrasyon Katsayıları:
DIESEL_AFR_IDLE = float(os.getenv("DIESEL_AFR_IDLE", "40.0"))          # Rölanti / Çok Düşük Yük (Load <= 15%)
DIESEL_AFR_CRUISE = float(os.getenv("DIESEL_AFR_CRUISE", "32.0"))      # Düşük / Sabit Seyir (15% < Load <= 35%)
DIESEL_AFR_MID = float(os.getenv("DIESEL_AFR_MID", "26.0"))            # Orta Yük / Şehir İçi (35% < Load <= 65%)
DIESEL_AFR_HIGH = float(os.getenv("DIESEL_AFR_HIGH", "20.5"))          # Yüksek Yük / Rampa / Hızlanma (Load > 65%): 20.5

# 3. Motor Mekanik Parametreleri
ENGINE_CYLINDERS = int(os.getenv("ENGINE_CYLINDERS", "4"))             # 1ND-TV 4 silindir
ENGINE_DISPLACEMENT_L = float(os.getenv("ENGINE_DISPLACEMENT_L", "1.364"))
