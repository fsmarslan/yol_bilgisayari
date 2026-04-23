import argparse
import asyncio
import logging
from typing import List, Optional, Tuple

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError


NAME_HINTS = ["OBD", "OBDII", "ELM", "VLINK", "VGATE", "CAN"]
ATZ_COMMAND = b"ATZ\r"


def setup_logging(debug: bool) -> None:
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(level=level, format="[%(levelname)s] %(message)s")


def print_header(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def device_matches(name: str) -> bool:
    upper_name = name.upper()
    return any(hint in upper_name for hint in NAME_HINTS)


async def scan_obd_device(timeout: float) -> Tuple[Optional[object], List[object]]:
    print_header("BLE DEVICE SCAN")
    print(f"[scan] Tarama suresi: {timeout} saniye")

    devices = await BleakScanner.discover(timeout=timeout)

    if not devices:
        print("[scan][warn] Hic BLE cihaz bulunamadi.")
        return None, []

    print(f"[scan] Toplam cihaz sayisi: {len(devices)}")
    for idx, device in enumerate(devices, start=1):
        name = device.name or "Unknown"
        print(f"[{idx}] name={name} | address={device.address}")

    for device in devices:
        name = device.name or ""
        if device_matches(name):
            print(f"[scan][ok] OBD adayi bulundu: {name} ({device.address})")
            return device, devices

    print("[scan][warn] Isminde OBD/ELM gecen cihaz bulunamadi.")
    return None, devices


def dump_services(services) -> Tuple[List[object], List[object], List[object]]:
    print_header("SERVICES / CHARACTERISTICS")

    write_chars = []
    notify_chars = []
    read_chars = []

    for service in services:
        print(f"[service] {service.uuid}")
        for char in service.characteristics:
            props = sorted(list(char.properties))
            print(f"  [char] {char.uuid} | props={props}")

            prop_set = set(props)
            if "write" in prop_set or "write-without-response" in prop_set:
                write_chars.append(char)
            if "notify" in prop_set or "indicate" in prop_set:
                notify_chars.append(char)
            if "read" in prop_set:
                read_chars.append(char)

    print(f"[summary] write={len(write_chars)} notify/indicate={len(notify_chars)} read={len(read_chars)}")
    return write_chars, notify_chars, read_chars


async def run_atz_probe(client: BleakClient, write_chars: List[object], notify_chars: List[object], read_chars: List[object]) -> None:
    print_header("HAM ATZ TESTI")

    notifications = []

    def on_notify(char_uuid: str, data: bytearray) -> None:
        payload = bytes(data)
        notifications.append((char_uuid, payload))
        print(f"[notify] {char_uuid} -> {payload!r}")

    started_notify = []
    for char in notify_chars:
        try:
            await client.start_notify(char.uuid, on_notify)
            started_notify.append(char.uuid)
            print(f"[notify] Dinleme basladi: {char.uuid}")
        except Exception as exc:
            print(f"[notify][warn] Baslatilamadi {char.uuid}: {exc}")

    if not write_chars:
        print("[write][warn] Yazilabilir characteristic yok. ATZ gonderilemedi.")
    else:
        for char in write_chars:
            supports_write = "write" in set(char.properties)
            response_modes = [True, False] if supports_write else [False]

            for use_response in response_modes:
                mode_text = "write_with_response" if use_response else "write_without_response"
                try:
                    print(f"[write] {char.uuid} uzerinden {mode_text} ile ATZ gonderiliyor")
                    await client.write_gatt_char(char.uuid, ATZ_COMMAND, response=use_response)
                    await asyncio.sleep(2.0)
                except Exception as exc:
                    print(f"[write][warn] Basarisiz {char.uuid} ({mode_text}): {exc}")

                for read_char in read_chars:
                    try:
                        read_data = await client.read_gatt_char(read_char.uuid)
                        print(f"[read] {read_char.uuid} -> {bytes(read_data)!r}")
                    except Exception as exc:
                        print(f"[read][warn] Okuma basarisiz {read_char.uuid}: {exc}")

    await asyncio.sleep(2.0)

    for char_uuid in started_notify:
        try:
            await client.stop_notify(char_uuid)
            print(f"[notify] Dinleme durduruldu: {char_uuid}")
        except Exception as exc:
            print(f"[notify][warn] Durdurulamadi {char_uuid}: {exc}")

    if not notifications:
        print("[result] Notify uzerinden veri yakalanamadi.")


def print_permission_help(exc: Exception) -> None:
    print_header("HATA VE IZIN REHBERI")
    print(f"[error] {type(exc).__name__}: {exc}")
    print("[macOS] Bluetooth izinlerini kontrol edin:")
    print("  1) System Settings > Privacy & Security > Bluetooth")
    print("  2) VS Code/Terminal uygulamasina Bluetooth izni verin")
    print("  3) Bluetooth'u kapat/ac yapip tekrar deneyin")
    print("  4) Cihaz baska telefona/app'e bagliysa baglantiyi kesin")


async def get_services_compat(client: BleakClient):
    if hasattr(client, "get_services"):
        return await client.get_services()

    services = getattr(client, "services", None)
    if services is None:
        raise RuntimeError("Bleak services bilgisi alinamadi")
    return services


async def main_async(scan_timeout: float) -> None:
    device, _all_devices = await scan_obd_device(timeout=scan_timeout)
    if device is None:
        print("[exit] OBD adayi bulunamadigi icin cikiliyor.")
        return

    print_header("BLE BAGLANTI")
    print(f"[connect] name={device.name or 'Unknown'} | address={device.address}")

    try:
        async with BleakClient(device, timeout=20.0) as client:
            is_connected = client.is_connected
            print(f"[connect] is_connected={is_connected}")

            if not is_connected:
                print("[connect][fail] Cihaza baglanilamadi.")
                return

            services = await get_services_compat(client)
            write_chars, notify_chars, read_chars = dump_services(services)

            print_header("OBD CIHAZ KIMLIK KARTI")
            print(f"[device] name={device.name or 'Unknown'}")
            print(f"[device] address={device.address}")
            print(f"[device] service_count={len(list(services))}")

            await run_atz_probe(client, write_chars, notify_chars, read_chars)

    except (BleakError, TimeoutError, PermissionError, OSError) as exc:
        print_permission_help(exc)
    except Exception as exc:
        print_permission_help(exc)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="BLE OBD scanner and raw probe")
    parser.add_argument("--scan-timeout", type=float, default=10.0, help="BLE scan timeout in seconds")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    setup_logging(args.debug)
    asyncio.run(main_async(scan_timeout=args.scan_timeout))


if __name__ == "__main__":
    main()
