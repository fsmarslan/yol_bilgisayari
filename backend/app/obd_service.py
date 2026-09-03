import os
from dataclasses import dataclass
from typing import Optional

import obd


@dataclass
class TelemetryData:
    rpm: Optional[float]
    speed_kmh: Optional[float]
    maf_gps: Optional[float]
    coolant_temp_c: Optional[float]
    fuel_l_per_100km: Optional[float]


class OBDService:
    def __init__(self) -> None:
        self._connection: Optional[obd.OBD] = None

    def _connect_if_needed(self) -> None:
        if self._connection and self._connection.is_connected():
            return

        port = os.getenv("OBD_PORT")
        baudrate_env = os.getenv("OBD_BAUDRATE")
        baudrate = int(baudrate_env) if baudrate_env else None

        self._connection = obd.OBD(
            portstr=port,
            baudrate=baudrate,
            fast=False,
            timeout=1,
        )

    def _query_value(self, command, unit: Optional[str] = None) -> Optional[float]:
        if not self._connection or not self._connection.is_connected():
            return None

        response = self._connection.query(command)
        if response.is_null() or response.value is None:
            return None

        value = response.value
        if unit:
            value = value.to(unit)
        return float(value.magnitude)

    @staticmethod
    def _calculate_fuel_l100km(maf_gps: Optional[float], speed_kmh: Optional[float]) -> Optional[float]:
        if maf_gps is None or speed_kmh is None or speed_kmh <= 0:
            return None
        # Toyota 1.4 D-4D Euro Diesel: Yogunluk ~840 g/L, Ortalama efektif AFR ~31.0
        return ((maf_gps * 3600.0) / (31.0 * 840.0)) / speed_kmh * 100.0

    def get_telemetry(self) -> TelemetryData:
        try:
            self._connect_if_needed()
        except Exception:
            return TelemetryData(
                rpm=None,
                speed_kmh=None,
                maf_gps=None,
                coolant_temp_c=None,
                fuel_l_per_100km=None,
            )

        rpm = self._query_value(obd.commands.RPM)
        speed_kmh = self._query_value(obd.commands.SPEED, "km/h")
        maf_gps = self._query_value(obd.commands.MAF, "g/s")
        coolant_temp_c = self._query_value(obd.commands.COOLANT_TEMP, "degC")

        fuel_l_per_100km = self._calculate_fuel_l100km(maf_gps, speed_kmh)

        return TelemetryData(
            rpm=rpm,
            speed_kmh=speed_kmh,
            maf_gps=maf_gps,
            coolant_temp_c=coolant_temp_c,
            fuel_l_per_100km=fuel_l_per_100km,
        )


obd_service = OBDService()
