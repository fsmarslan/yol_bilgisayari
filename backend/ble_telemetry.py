import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


BLE_DEVICE_ADDRESS = os.getenv("BLE_OBD_ADDRESS", "8ADDE73C-9BBE-9B11-6290-2CDCA1D8853F")
BLE_NAME_HINT = os.getenv("BLE_OBD_NAME_HINT", "OBD")
WRITE_CHAR_UUID = os.getenv("BLE_WRITE_UUID", "0000fff2-0000-1000-8000-00805f9b34fb")
NOTIFY_CHAR_UUID = os.getenv("BLE_NOTIFY_UUID", "0000fff1-0000-1000-8000-00805f9b34fb")
SCAN_TIMEOUT_SECONDS = float(os.getenv("BLE_SCAN_TIMEOUT", "8"))
RECONNECT_DELAY_SECONDS = float(os.getenv("BLE_RECONNECT_DELAY", "2"))
COMMAND_TIMEOUT_SECONDS = float(os.getenv("BLE_COMMAND_TIMEOUT", "1.2"))
POLL_INTERVAL_SECONDS = float(os.getenv("BLE_POLL_INTERVAL", "0.25"))

AIR_FUEL_RATIO = 14.7
FUEL_DENSITY_G_PER_L = 740.0


logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("ble_telemetry")


class BleTelemetryManager:
    def __init__(self) -> None:
        self._latest: dict[str, Any] = {
            "connected": False,
            "rpm": None,
            "speed_kmh": None,
            "maf_gps": None,
            "coolant_temp_c": None,
            "load_percent": None,
            "intake_temp_c": None,
            "throttle_percent": None,
            "map_kpa": None,
            "distance_mil_on": None,
            "turbo_boost_bar": None,
            "fuel_display": None,
            "fuel_unit": None,
            "last_error": None,
            "updated_at": None,
        }
        self._latest_lock = asyncio.Lock()

        self._runner_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

        self._notify_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._command_lock = asyncio.Lock()

    async def start(self) -> None:
        if self._runner_task and not self._runner_task.done():
            return
        self._stop_event.clear()
        self._runner_task = asyncio.create_task(self._run_forever())

    async def stop(self) -> None:
        self._stop_event.set()
        if self._runner_task:
            await self._runner_task

    async def snapshot(self) -> dict[str, Any]:
        async with self._latest_lock:
            return dict(self._latest)

    async def _set_state(self, **kwargs: Any) -> None:
        async with self._latest_lock:
            self._latest.update(kwargs)

    async def _run_forever(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self._run_session()
            except Exception as exc:
                logger.warning("BLE session hata: %s", exc)
                await self._set_state(connected=False, last_error=str(exc))

            if self._stop_event.is_set():
                break
            await asyncio.sleep(RECONNECT_DELAY_SECONDS)

    async def _run_session(self) -> None:
        device = await self._resolve_device()
        if device is None:
            msg = "OBD BLE cihazi bulunamadi"
            logger.warning(msg)
            await self._set_state(connected=False, last_error=msg)
            return

        logger.info("BLE baglaniyor: %s (%s)", device.name or "Unknown", device.address)

        async with BleakClient(device, timeout=20.0) as client:
            if not client.is_connected:
                raise RuntimeError("BLE baglantisi kurulamadi")

            await client.start_notify(NOTIFY_CHAR_UUID, self._on_notify)

            try:
                await self._initialize_adapter(client)
                await self._set_state(connected=True, last_error=None)
                logger.info("BLE baglanti hazir, telemetri basladi")

                while client.is_connected and not self._stop_event.is_set():
                    started = asyncio.get_running_loop().time()
                    await self._poll_once(client)
                    elapsed = asyncio.get_running_loop().time() - started
                    await asyncio.sleep(max(0.0, POLL_INTERVAL_SECONDS - elapsed))
            finally:
                await self._set_state(connected=False)
                try:
                    await client.stop_notify(NOTIFY_CHAR_UUID)
                except Exception:
                    pass
                logger.info("BLE baglanti kapandi")

    async def _resolve_device(self):
        if BLE_DEVICE_ADDRESS:
            return await BleakScanner.find_device_by_address(BLE_DEVICE_ADDRESS, timeout=SCAN_TIMEOUT_SECONDS)

        devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT_SECONDS)
        for device in devices:
            name = (device.name or "").upper()
            if BLE_NAME_HINT.upper() in name:
                return device
        return None

    def _on_notify(self, _char: Any, data: bytearray) -> None:
        self._notify_queue.put_nowait(bytes(data))

    async def _drain_notify_queue(self) -> None:
        while True:
            try:
                self._notify_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def _send_command(self, client: BleakClient, command: str) -> str:
        async with self._command_lock:
            await self._drain_notify_queue()
            payload = f"{command}\r".encode("ascii")
            await client.write_gatt_char(WRITE_CHAR_UUID, payload, response=False)
            return await self._collect_until_prompt(COMMAND_TIMEOUT_SECONDS)

    async def _collect_until_prompt(self, timeout_seconds: float) -> str:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        chunks: list[str] = []

        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                data = await asyncio.wait_for(self._notify_queue.get(), timeout=remaining)
            except asyncio.TimeoutError:
                break

            text = data.decode("ascii", errors="ignore")
            chunks.append(text)
            if ">" in text:
                break

        return "".join(chunks)

    async def _initialize_adapter(self, client: BleakClient) -> None:
        init_commands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP5"]
        for cmd in init_commands:
            response = await self._send_command(client, cmd)
            if "?" in response:
                logger.debug("AT komutunda soru isareti dondu: %s -> %s", cmd, response)
            await asyncio.sleep(0.05)

    async def _poll_once(self, client: BleakClient) -> None:
        rpm = await self._query_pid(client, "010C", "0C", self._parse_rpm)
        speed = await self._query_pid(client, "010D", "0D", self._parse_speed)
        coolant = await self._query_pid(client, "0105", "05", self._parse_coolant)
        maf = await self._query_pid(client, "0110", "10", self._parse_maf)
        load = await self._query_pid(client, "0104", "04", self._parse_load)
        map_kpa = await self._query_pid(client, "010B", "0B", self._parse_map)
        intake_temp = await self._query_pid(client, "010F", "0F", self._parse_intake_temp)
        throttle = await self._query_pid(client, "0111", "11", self._parse_throttle)
        distance = await self._query_pid(client, "0121", "21", self._parse_distance)

        turbo_boost = self._calculate_turbo_boost(map_kpa)
        fuel_display, fuel_unit = self._calculate_smart_fuel(maf, speed)
        now = datetime.now(timezone.utc).isoformat()

        await self._set_state(
            connected=True,
            rpm=rpm,
            speed_kmh=speed,
            coolant_temp_c=coolant,
            maf_gps=maf,
            load_percent=load,
            intake_temp_c=intake_temp,
            throttle_percent=throttle,
            map_kpa=map_kpa,
            distance_mil_on=distance,
            turbo_boost_bar=turbo_boost,
            fuel_display=fuel_display,
            fuel_unit=fuel_unit,
            updated_at=now,
            last_error=None,
        )

    async def _query_pid(self, client: BleakClient, command: str, pid_hex: str, parser) -> Optional[float]:
        raw = await self._send_command(client, command)
        payload = self._extract_payload(raw, pid_hex)
        if payload is None:
            return None
        return parser(payload)

    @staticmethod
    def _extract_payload(raw_text: str, pid_hex: str) -> Optional[list[int]]:
        normalized = "".join(ch for ch in raw_text.upper() if ch in "0123456789ABCDEF")
        marker = f"41{pid_hex}"
        pos = normalized.find(marker)
        if pos == -1:
            return None

        tail = normalized[pos + len(marker):]
        bytes_needed = {
            "0C": 2,
            "0D": 1,
            "05": 1,
            "10": 2,
            "04": 1,
            "0B": 1,
            "0F": 1,
            "11": 1,
            "21": 2,
        }.get(pid_hex)

        if not bytes_needed:
            return None

        chunk = tail[: bytes_needed * 2]
        if len(chunk) < bytes_needed * 2:
            return None

        try:
            return [int(chunk[i : i + 2], 16) for i in range(0, len(chunk), 2)]
        except ValueError:
            return None

    @staticmethod
    def _parse_rpm(data: list[int]) -> Optional[float]:
        if len(data) < 2:
            return None
        return ((data[0] * 256) + data[1]) / 4.0

    @staticmethod
    def _parse_speed(data: list[int]) -> Optional[float]:
        if not data:
            return None
        return float(data[0])

    @staticmethod
    def _parse_coolant(data: list[int]) -> Optional[float]:
        if not data:
            return None
        return float(data[0] - 40)

    @staticmethod
    def _parse_maf(data: list[int]) -> Optional[float]:
        if len(data) < 2:
            return None
        return ((data[0] * 256) + data[1]) / 100.0

    @staticmethod
    def _parse_load(data: list[int]) -> Optional[float]:
        if not data:
            return None
        return (data[0] * 100.0) / 255.0

    @staticmethod
    def _parse_map(data: list[int]) -> Optional[float]:
        if not data:
            return None
        return float(data[0])

    @staticmethod
    def _parse_intake_temp(data: list[int]) -> Optional[float]:
        if not data:
            return None
        return float(data[0] - 40)

    @staticmethod
    def _parse_throttle(data: list[int]) -> Optional[float]:
        if not data:
            return None
        return (data[0] * 100.0) / 255.0

    @staticmethod
    def _parse_distance(data: list[int]) -> Optional[float]:
        if len(data) < 2:
            return None
        return float((data[0] * 256) + data[1])

    @staticmethod
    def _calculate_turbo_boost(map_kpa: Optional[float]) -> Optional[float]:
        if map_kpa is None:
            return None
        return (map_kpa - 99.0) / 100.0

    @staticmethod
    def _calculate_smart_fuel(maf_gps: Optional[float], speed_kmh: Optional[float]) -> tuple[Optional[float], str]:
        if maf_gps is None or speed_kmh is None:
            return None, "--"

        liters_per_hour = (maf_gps * 3600.0) / (AIR_FUEL_RATIO * FUEL_DENSITY_G_PER_L)

        if speed_kmh > 5.0:
            consumption = (liters_per_hour / speed_kmh) * 100.0
            return consumption, "L/100km"
        else:
            return liters_per_hour, "L/h"


telemetry_manager = BleTelemetryManager()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await telemetry_manager.start()
    try:
        yield
    finally:
        await telemetry_manager.stop()


app = FastAPI(title="AuraDrive BLE Telemetry", version="1.0.0", lifespan=lifespan)
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
    }


@app.get("/live-data")
async def live_data() -> dict[str, Any]:
    return await telemetry_manager.snapshot()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ble_telemetry:app", host="0.0.0.0", port=8001, reload=False)
