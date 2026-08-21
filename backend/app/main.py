import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ble_service import telemetry_manager

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await telemetry_manager.start()
    try:
        yield
    finally:
        await telemetry_manager.stop()


app = FastAPI(
    title="AuraDrive Pro Telemetry API",
    version="1.0.0",
    description="2006 Toyota Corolla 1.4 D-4D OBD-II BLE Telemetry Backend",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    data = await telemetry_manager.snapshot()
    return {
        "status": "ok",
        "connected": data.get("connected", False),
        "updated_at": data.get("updated_at"),
    }


@app.get("/live-data")
async def get_live_data() -> dict[str, Any]:
    """
    Frontend tarafindan saniyede birden fazla kez cagirilan tam telemetri verisi.
    """
    return await telemetry_manager.snapshot()


@app.get("/data")
async def get_data() -> dict[str, Any]:
    """
    Geriye donuk uyumluluk icin temel telemetri endpoint'i.
    """
    data = await telemetry_manager.snapshot()
    return {
        "rpm": data.get("rpm"),
        "speed_kmh": data.get("speed_kmh"),
        "maf_gps": data.get("maf_gps"),
        "coolant_temp_c": data.get("coolant_temp_c"),
        "fuel_l_per_100km": data.get("fuel_display") if data.get("fuel_unit") == "L/100km" else None,
        "fuel_display": data.get("fuel_display"),
        "fuel_unit": data.get("fuel_unit"),
        "connected": data.get("connected"),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=False)
