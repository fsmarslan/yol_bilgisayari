import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from bleak import BleakClient, BleakScanner

from .config import (
    MOCK_MODE,
    BLE_DEVICE_ADDRESS,
    BLE_NAME_HINTS,
    WRITE_CHAR_UUID,
    NOTIFY_CHAR_UUID,
    SCAN_TIMEOUT_SECONDS,
    RECONNECT_DELAY_SECONDS,
    MAX_RECONNECT_DELAY_SECONDS,
    COMMAND_TIMEOUT_SECONDS,
    POLL_INTERVAL_SECONDS,
    IDLE_POLL_INTERVAL_SECONDS,
    MOVING_POLL_INTERVAL_SECONDS,
    SLOW_PID_INTERVAL_SECONDS,
    DIESEL_DENSITY_G_PER_L,
    MIN_DIESEL_AFR,
    MAX_DIESEL_AFR,
    CRUISE_DEFAULT_AFR,
)

logger = logging.getLogger("ble_service")


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
            "fuel_unit": "--",
            "fuel_rate_lph": None,
            "last_error": None,
            "updated_at": None,
        }
        self._latest_lock = asyncio.Lock()

        self._runner_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

        self._notify_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._command_lock = asyncio.Lock()

        # Dinamik atmosferik basınç kalibrasyonu (kPa)
        self._ambient_pressure_kpa: float = 101.3
        self._ambient_calibrated: bool = False

        # Yavaş PID sorgulama zamanlayıcısı
        self._last_slow_poll_time: float = 0.0

        # BLE yazma yanıt modu tercihi
        self._write_with_response: bool = False

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
        if MOCK_MODE:
            await self._run_mock_session()
            return

        reconnect_delay = RECONNECT_DELAY_SECONDS

        while not self._stop_event.is_set():
            try:
                await self._run_session()
                reconnect_delay = RECONNECT_DELAY_SECONDS
            except Exception as exc:
                logger.warning("BLE session hata: %s", exc)
                await self._set_state(connected=False, last_error=str(exc))

                if self._stop_event.is_set():
                    break

                logger.info("BLE yeniden baglanma beklemesi: %.1fs", reconnect_delay)
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2.0, MAX_RECONNECT_DELAY_SECONDS)

    async def _run_mock_session(self) -> None:
        logger.info("==================================================")
        logger.info("[DEMO / SIMULASYON MODU AKTIF]")
        logger.info("2006 Toyota Corolla 1.4 D-4D surus simulasyonu calisiyor...")
        logger.info("==================================================")

        sim_time = 0.0
        coolant = 78.0

        while not self._stop_event.is_set():
            # 60 saniyelik gercekci surus dongusu
            cycle_pos = sim_time % 60.0

            # Motor suyu 90 dereceye kadar kademeli isinsin
            if coolant < 89.5:
                coolant += 0.04

            if cycle_pos < 6.0:
                # 1. Vites Kalkış (0 - 28 km/h)
                p = cycle_pos / 6.0
                speed = 28.0 * p
                rpm = 850.0 + (2250.0 * p)
                load = 65.0 + (18.0 * p)
                throttle = 35.0 + (25.0 * p)
                boost = 0.15 + (0.85 * p)
                maf = 10.0 + (32.0 * p)
            elif cycle_pos < 14.0:
                # 2. ve 3. Vites Hızlanma (28 - 72 km/h)
                p = (cycle_pos - 6.0) / 8.0
                speed = 28.0 + (44.0 * p)
                sub_p = (cycle_pos % 4.0) / 4.0
                rpm = 1750.0 + (1350.0 * sub_p)
                load = 55.0 + (15.0 * (1.0 - p))
                throttle = 40.0
                boost = 0.85 + (0.35 * (1.0 - p))
                maf = 22.0 + (25.0 * (1.0 - p))
            elif cycle_pos < 34.0:
                # 4. / 5. Vites Sabit Seyir (Cruise) (72 - 92 km/h)
                p = (cycle_pos - 14.0) / 20.0
                osc = (cycle_pos % 3.0) / 3.0
                speed = 88.0 + (4.0 * osc)
                rpm = 2050.0 + (60.0 * osc)
                load = 32.0 + (6.0 * osc)
                throttle = 18.0
                boost = 0.32 + (0.08 * osc)
                maf = 26.0 + (3.0 * osc)
            elif cycle_pos < 46.0:
                # Gaz Kesme / Kompresyon / Frenleme (Deceleration Fuel Cut-Off)
                p = (cycle_pos - 34.0) / 12.0
                speed = max(0.0, 90.0 * (1.0 - p))
                rpm = max(820.0, 2050.0 * (1.0 - p))
                load = 0.0
                throttle = 0.0
                boost = 0.0
                maf = 3.8
            else:
                # Rölantide Bekleme (Kırmızı ışık / park)
                speed = 0.0
                osc = (cycle_pos % 2.0) / 2.0
                rpm = 820.0 + (15.0 * osc)
                load = 18.0
                throttle = 0.0
                boost = 0.0
                maf = 4.2

            map_kpa = 100.0 + (boost * 100.0)
            intake_temp = 25.0
            distance = 0.0

            fuel_display, fuel_unit, fuel_rate_lph = self._calculate_diesel_fuel(
                maf_gps=maf,
                speed_kmh=speed,
                load_percent=load,
                rpm=rpm,
                throttle_percent=throttle,
            )

            now_iso = datetime.now(timezone.utc).isoformat()

            await self._set_state(
                connected=True,
                rpm=round(rpm),
                speed_kmh=round(speed),
                coolant_temp_c=round(coolant),
                maf_gps=round(maf, 2),
                load_percent=round(load, 1),
                intake_temp_c=round(intake_temp),
                throttle_percent=round(throttle, 1),
                map_kpa=round(map_kpa),
                distance_mil_on=distance,
                turbo_boost_bar=round(boost, 2),
                fuel_display=fuel_display,
                fuel_unit=fuel_unit,
                fuel_rate_lph=fuel_rate_lph,
                updated_at=now_iso,
                last_error=None,
            )

            sim_time += 0.2
            await asyncio.sleep(0.2)

    async def _resolve_device(self):
        # 1. Eğer adresi ortam değişkeninden verilmişse önce doğrudan adresi dene
        if BLE_DEVICE_ADDRESS:
            logger.info("Kayitli BLE adresi araniyor: %s", BLE_DEVICE_ADDRESS)
            try:
                device = await BleakScanner.find_device_by_address(BLE_DEVICE_ADDRESS, timeout=SCAN_TIMEOUT_SECONDS)
                if device:
                    return device
                logger.warning("Belirtilen BLE adresinde cihaz bulunamadi. Isimle taramaya geciliyor...")
            except Exception as exc:
                logger.warning("Adresle arama basarisiz (%s). Isimle taraniyor...", exc)

        # 2. Otomatik Keşif (Discover ile isim eşleştirme)
        logger.info("BLE cihazlari taraniyor (Sure: %.1fs)...", SCAN_TIMEOUT_SECONDS)
        devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT_SECONDS)
        for device in devices:
            name = (device.name or "").upper()
            if any(hint.upper() in name for hint in BLE_NAME_HINTS):
                logger.info("OBD BLE cihazi kesfedildi: %s (%s)", device.name, device.address)
                return device

        return None

    def _determine_write_mode(self, client: BleakClient) -> bool:
        if not client.services:
            return False
        for service in client.services:
            for char in service.characteristics:
                if char.uuid.lower() == WRITE_CHAR_UUID.lower():
                    props = set(char.properties)
                    if "write-without-response" in props:
                        return False
                    if "write" in props:
                        return True
        return False

    async def _run_session(self) -> None:
        device = await self._resolve_device()
        if device is None:
            msg = "OBD BLE cihazi bulunamadi. Bluetooth'un acik ve cihazin eslesmeye hazir oldugundan emin olun."
            logger.warning(msg)
            await self._set_state(connected=False, last_error=msg)
            raise RuntimeError(msg)

        logger.info("BLE baglaniyor: %s (%s)", device.name or "Unknown", device.address)

        async with BleakClient(device, timeout=20.0) as client:
            if not client.is_connected:
                raise RuntimeError("BLE baglantisi kurulamadi")

            self._write_with_response = self._determine_write_mode(client)
            await client.start_notify(NOTIFY_CHAR_UUID, self._on_notify)

            try:
                await self._initialize_adapter(client)
                await self._set_state(connected=True, last_error=None)
                logger.info("BLE baglanti hazir, telemetri akisi basladi")

                while client.is_connected and not self._stop_event.is_set():
                    started = asyncio.get_running_loop().time()
                    speed = await self._poll_once(client)
                    elapsed = asyncio.get_running_loop().time() - started
                    target_interval = self._poll_interval_for_speed(speed)
                    await asyncio.sleep(max(0.01, target_interval - elapsed))

                if not self._stop_event.is_set() and not client.is_connected:
                    raise ConnectionError("BLE baglantisi koptu")
            finally:
                await self._set_state(connected=False)
                try:
                    await client.stop_notify(NOTIFY_CHAR_UUID)
                except Exception:
                    pass
                logger.info("BLE baglanti kapandi")

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
            await client.write_gatt_char(WRITE_CHAR_UUID, payload, response=self._write_with_response)
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
                logger.debug("AT komutunda beklenmeyen yanit: %s -> %s", cmd, response)
            if cmd == "ATZ":
                await asyncio.sleep(0.8)
            else:
                await asyncio.sleep(0.05)

    async def _poll_once(self, client: BleakClient) -> Optional[float]:
        now_time = asyncio.get_running_loop().time()
        should_poll_slow = (now_time - self._last_slow_poll_time) >= SLOW_PID_INTERVAL_SECONDS

        # 1. YUKSEK FREKANSLI PID'LER (Her döngüde okunur - Hız, Devir, MAP, MAF, Yük, Gaz)
        rpm = await self._query_pid(client, "010C", "0C", self._parse_rpm)
        speed = await self._query_pid(client, "010D", "0D", self._parse_speed)
        map_kpa = await self._query_pid(client, "010B", "0B", self._parse_map)
        maf = await self._query_pid(client, "0110", "10", self._parse_maf)
        load = await self._query_pid(client, "0104", "04", self._parse_load)
        throttle = await self._query_pid(client, "0111", "11", self._parse_throttle)

        # 2. DUSUK FREKANSLI PID'LER (Periyodik olarak okunur - Sıcaklıklar, Mesafe)
        current_state = await self.snapshot()
        coolant = current_state.get("coolant_temp_c")
        intake_temp = current_state.get("intake_temp_c")
        distance = current_state.get("distance_mil_on")

        if should_poll_slow or coolant is None:
            poll_coolant = await self._query_pid(client, "0105", "05", self._parse_coolant)
            if poll_coolant is not None:
                coolant = poll_coolant

            poll_intake = await self._query_pid(client, "010F", "0F", self._parse_intake_temp)
            if poll_intake is not None:
                intake_temp = poll_intake

            poll_dist = await self._query_pid(client, "0121", "21", self._parse_distance)
            if poll_dist is not None:
                distance = poll_dist

            self._last_slow_poll_time = now_time

        # Dinamik Atmosferik Basınç ve Turbo Boost Hesabı
        turbo_boost = self._calculate_turbo_boost(map_kpa, rpm)

        # Toyota 1.4 D-4D Dizel Akıllı Anlık Tüketim Hesabı
        fuel_display, fuel_unit, fuel_rate_lph = self._calculate_diesel_fuel(
            maf_gps=maf,
            speed_kmh=speed,
            load_percent=load,
            rpm=rpm,
            throttle_percent=throttle,
        )

        now_iso = datetime.now(timezone.utc).isoformat()

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
            fuel_rate_lph=fuel_rate_lph,
            updated_at=now_iso,
            last_error=None,
        )

        return speed

    async def _query_pid(self, client: BleakClient, command: str, pid_hex: str, parser) -> Optional[float]:
        raw = await self._send_command(client, command)
        payload = self._extract_payload(raw, pid_hex)
        if payload is None:
            return None
        return parser(payload)

    @staticmethod
    def _poll_interval_for_speed(speed_kmh: Optional[float]) -> float:
        if speed_kmh is None or speed_kmh <= 0.5:
            return IDLE_POLL_INTERVAL_SECONDS
        if speed_kmh < 20.0:
            return MOVING_POLL_INTERVAL_SECONDS
        return POLL_INTERVAL_SECONDS

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

    def _calculate_turbo_boost(self, map_kpa: Optional[float], rpm: Optional[float]) -> Optional[float]:
        if map_kpa is None:
            return None

        # Motor çalışmıyorken (RPM == 0 veya çok düşük) okunan MAP, ortamın atmosferik basıncıdır
        if rpm is not None and rpm < 300:
            if 80.0 <= map_kpa <= 110.0:
                self._ambient_pressure_kpa = map_kpa
                self._ambient_calibrated = True

        # Gauge boost (bar) = (Manifold Basıncı - Atmosferik Basınç) / 100
        boost_bar = (map_kpa - self._ambient_pressure_kpa) / 100.0
        # Dizel motorda emme manifoldunda negatif vakum olmadığı için 0 altını sıfırla
        return max(0.0, round(boost_bar, 2))

    @staticmethod
    def _calculate_diesel_fuel(
        maf_gps: Optional[float],
        speed_kmh: Optional[float],
        load_percent: Optional[float],
        rpm: Optional[float],
        throttle_percent: Optional[float],
    ) -> tuple[Optional[float], str, Optional[float]]:
        """
        Toyota 1.4 D-4D (1ND-TV) dizel motor karakteristiklerine gore anlik yakit tuketimi hesabi.
        - Dizel yakit yogunlugu: ~840 g/L
        - Efektif AFR motor yukune gore degisken (18:1 ile 65:1 arasi)
        - Deceleration Fuel Cut-off (kompresyonda gaz kesme) destegi
        """
        if maf_gps is None or speed_kmh is None:
            return None, "--", None

        # 1. Kompresyonda Gaz Kesme (Deceleration Fuel Cut-off)
        # Devir rölanti üstündeyken gaz pedalı bırakılmışsa enjektörler tamamen kapatılır.
        is_coasting = False
        if rpm is not None and rpm > 1150:
            if throttle_percent is not None and throttle_percent < 2.0:
                is_coasting = True
            elif load_percent is not None and load_percent < 8.0:
                is_coasting = True

        if is_coasting and speed_kmh > 15.0:
            return 0.0, "L/100km", 0.0

        # 2. Dizel Non-Lineer Efektif AFR Modellemesi (1ND-TV 1.4 D-4D Karakteristigi)
        # Dizelde yuk arttikca AFR lineer degil, hizla stoikiometriye dogru inen bir egri izler.
        if load_percent is not None:
            clamped_load = max(0.0, min(100.0, load_percent))
            # Yuk %0 (rolanti/cok hafif yuk) -> AFR ~55:1 (fakir)
            # Yuk %30 (90 km/h cruise) -> AFR ~32-33:1 (3.8-4.1 L/100km)
            # Yuk %50 (orta hizlanma) -> AFR ~24:1
            # Yuk %100 (tam gaz dip gaz) -> AFR ~17.5:1 (tam guc)
            load_factor = (1.0 - (clamped_load / 100.0)) ** 3.0
            effective_afr = MIN_DIESEL_AFR + ((MAX_DIESEL_AFR - MIN_DIESEL_AFR) * load_factor)
        else:
            effective_afr = CRUISE_DEFAULT_AFR

        # Yakit debisi (Gram/saniye -> Litre/saat)
        fuel_mass_gps = maf_gps / effective_afr
        liters_per_hour = (fuel_mass_gps * 3600.0) / DIESEL_DENSITY_G_PER_L

        # Hiz durumuna gore birim ve deger secimi
        if speed_kmh > 5.0:
            l_per_100km = (liters_per_hour / speed_kmh) * 100.0
            # Asiri yuksek mantiksiz degerleri filtrele (ornek: kalkista max 35 L/100km)
            return min(35.0, round(l_per_100km, 2)), "L/100km", round(liters_per_hour, 3)
        else:
            return round(liters_per_hour, 2), "L/h", round(liters_per_hour, 3)


telemetry_manager = BleTelemetryManager()
