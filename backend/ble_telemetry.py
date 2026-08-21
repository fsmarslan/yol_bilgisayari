"""
Geriye dönük uyumluluk köprüsü.
Ana telemetri servisi ve FastAPI uygulaması app/ paketi altına taşınmıştır.
"""
import uvicorn
from app.ble_service import BleTelemetryManager, telemetry_manager
from app.config import NOTIFY_CHAR_UUID, WRITE_CHAR_UUID
from app.main import app

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=False)
