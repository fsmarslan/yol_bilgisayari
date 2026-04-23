from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .obd_service import obd_service

app = FastAPI(title="AuraDrive API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/data")
def get_data() -> dict:
    telemetry = obd_service.get_telemetry()
    return {
        "rpm": telemetry.rpm,
        "speed_kmh": telemetry.speed_kmh,
        "maf_gps": telemetry.maf_gps,
        "coolant_temp_c": telemetry.coolant_temp_c,
        "fuel_l_per_100km": telemetry.fuel_l_per_100km,
    }
