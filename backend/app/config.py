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
DIESEL_DENSITY_G_PER_L = float(os.getenv("DIESEL_DENSITY", "840.0"))  # Euro Diesel yoğunluğu ~840 g/L
MIN_DIESEL_AFR = float(os.getenv("MIN_DIESEL_AFR", "17.5"))          # Tam gaz / yüksek yük (1ND-TV tam güç duman sınırı)
MAX_DIESEL_AFR = float(os.getenv("MAX_DIESEL_AFR", "65.0"))          # Rölanti / düşük yük
CRUISE_DEFAULT_AFR = float(os.getenv("CRUISE_DEFAULT_AFR", "32.0"))  # Yük bilgisi yoksa varsayılan
