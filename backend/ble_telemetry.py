"""
Geriye dönük uyumluluk köprüsü.
Ana telemetri servisi, yakıt hesaplama modelleri ve FastAPI uygulaması app/ paketi altına taşınmıştır.
"""
import uvicorn
from app.ble_service import (
    BleTelemetryManager,
    telemetry_manager,
    calculate_diesel_afr,
    calculate_fuel_rate_from_injection,
    calculate_fuel_rate_from_maf,
    is_dfco_active,
    calculate_diesel_fuel,
)
from app.config import (
    NOTIFY_CHAR_UUID,
    WRITE_CHAR_UUID,
    DIESEL_DENSITY_G_PER_L,
    DIESEL_AFR_IDLE,
    DIESEL_AFR_CRUISE,
    DIESEL_AFR_MID,
    DIESEL_AFR_HIGH,
    ENGINE_CYLINDERS,
)
from app.main import app

__all__ = [
    "app",
    "BleTelemetryManager",
    "telemetry_manager",
    "calculate_diesel_afr",
    "calculate_fuel_rate_from_injection",
    "calculate_fuel_rate_from_maf",
    "is_dfco_active",
    "calculate_diesel_fuel",
    "DIESEL_DENSITY_G_PER_L",
    "DIESEL_AFR_IDLE",
    "DIESEL_AFR_CRUISE",
    "DIESEL_AFR_MID",
    "DIESEL_AFR_HIGH",
    "ENGINE_CYLINDERS",
    "NOTIFY_CHAR_UUID",
    "WRITE_CHAR_UUID",
]

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=False)

