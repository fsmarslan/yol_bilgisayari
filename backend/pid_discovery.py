import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional

from bleak import BleakClient

from ble_telemetry import BleTelemetryManager, NOTIFY_CHAR_UUID


REPORT_PATH = Path(__file__).resolve().parent / "desteklenen_veriler_raporu.md"
PID_START = 0x01
PID_END = 0x64

PID_NAMES: dict[int, str] = {
    0x01: "Monitor status since DTCs cleared",
    0x02: "Freeze DTC",
    0x03: "Fuel system status",
    0x04: "Calculated engine load",
    0x05: "Engine coolant temperature",
    0x06: "Short term fuel trim bank 1",
    0x07: "Long term fuel trim bank 1",
    0x08: "Short term fuel trim bank 2",
    0x09: "Long term fuel trim bank 2",
    0x0A: "Fuel pressure",
    0x0B: "Intake manifold absolute pressure",
    0x0C: "Engine RPM",
    0x0D: "Vehicle speed",
    0x0E: "Timing advance",
    0x0F: "Intake air temperature",
    0x10: "MAF air flow rate",
    0x11: "Throttle position",
    0x1F: "Run time since engine start",
    0x21: "Distance traveled with MIL on",
    0x2F: "Fuel level input",
    0x31: "Distance since DTCs cleared",
    0x33: "Barometric pressure",
    0x42: "Control module voltage",
    0x43: "Absolute load value",
    0x44: "Commanded air-fuel equivalence ratio",
    0x45: "Relative throttle position",
    0x46: "Ambient air temperature",
    0x47: "Absolute throttle position B",
    0x48: "Absolute throttle position C",
    0x49: "Accelerator pedal position D",
    0x4A: "Accelerator pedal position E",
    0x4B: "Accelerator pedal position F",
    0x4C: "Commanded throttle actuator",
    0x4D: "Time run with MIL on",
    0x4E: "Time since DTCs cleared",
    0x5C: "Engine oil temperature",
    0x5E: "Engine fuel rate",
    0x61: "Driver demand engine percent torque",
    0x62: "Actual engine percent torque",
    0x63: "Engine reference torque",
    0x64: "Engine percent torque data",
}


def _hex_bytes(raw_text: str) -> list[int]:
    compact = "".join(ch for ch in raw_text.upper() if ch in "0123456789ABCDEF")
    if len(compact) < 2:
        return []

    if len(compact) % 2 == 1:
        compact = compact[:-1]

    values: list[int] = []
    for i in range(0, len(compact), 2):
        try:
            values.append(int(compact[i : i + 2], 16))
        except ValueError:
            continue
    return values


def _extract_payload(raw_text: str, pid: int) -> Optional[list[int]]:
    values = _hex_bytes(raw_text)
    for idx in range(len(values) - 1):
        if values[idx] == 0x41 and values[idx + 1] == pid:
            return values[idx + 2 :]
    return None


def _format_raw(raw_text: str) -> str:
    values = _hex_bytes(raw_text)
    if not values:
        return ""
    return " ".join(f"{value:02X}" for value in values)


def _format_value(pid: int, payload: list[int]) -> str:
    if not payload:
        return "no payload"

    a = payload[0]
    b = payload[1] if len(payload) > 1 else 0

    if pid == 0x04:
        return f"{(a * 100.0) / 255.0:.1f} %"
    if pid == 0x05:
        return f"{a - 40} C"
    if pid in {0x06, 0x07, 0x08, 0x09}:
        return f"{((a - 128) * 100.0) / 128.0:.1f} %"
    if pid == 0x0A:
        return f"{a * 3} kPa"
    if pid == 0x0B:
        return f"{a} kPa"
    if pid == 0x0C:
        return f"{((a * 256) + b) / 4.0:.0f} rpm"
    if pid == 0x0D:
        return f"{a} km/h"
    if pid == 0x0E:
        return f"{(a / 2.0) - 64.0:.1f} deg"
    if pid == 0x0F:
        return f"{a - 40} C"
    if pid == 0x10:
        return f"{((a * 256) + b) / 100.0:.2f} g/s"
    if pid == 0x11:
        return f"{(a * 100.0) / 255.0:.1f} %"
    if pid == 0x1F:
        return f"{(a * 256) + b} s"
    if pid == 0x21:
        return f"{(a * 256) + b} km"
    if pid == 0x2F:
        return f"{(a * 100.0) / 255.0:.1f} %"
    if pid == 0x31:
        return f"{(a * 256) + b} km"
    if pid == 0x33:
        return f"{a} kPa"
    if pid == 0x42:
        return f"{((a * 256) + b) / 1000.0:.2f} V"
    if pid == 0x43:
        return f"{((a * 256) + b) * 100.0 / 255.0:.1f} %"
    if pid == 0x44:
        return f"{((a * 256) + b) / 32768.0:.3f} lambda"
    if pid in {0x45, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C}:
        return f"{(a * 100.0) / 255.0:.1f} %"
    if pid == 0x46:
        return f"{a - 40} C"
    if pid in {0x4D, 0x4E}:
        return f"{(a * 256) + b} min"
    if pid == 0x5C:
        return f"{a - 40} C"
    if pid == 0x5E:
        return f"{((a * 256) + b) / 20.0:.2f} L/h"
    if pid in {0x61, 0x62}:
        return f"{a - 125} %"
    if pid == 0x63:
        return f"{(a * 256) + b} Nm"
    if pid == 0x64:
        values = [str(x - 125) for x in payload[:5]]
        return "torque points: " + ", ".join(values)

    short = payload[:8]
    return "raw payload: " + " ".join(f"{x:02X}" for x in short)


def _pid_name(pid: int) -> str:
    return PID_NAMES.get(pid, f"PID 0x{pid:02X}")


def save_report(lines: list[str]) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    content = [
        "# Desteklenen Veriler Raporu",
        "",
        f"- Tarih: {timestamp}",
        f"- Tarama araligi: 01{PID_START:02X} - 01{PID_END:02X}",
        f"- Desteklenen PID sayisi: {len(lines)}",
        "",
    ]

    if lines:
        content.append("## Desteklenen PID Listesi")
        content.append("")
        content.extend(lines)
    else:
        content.append("Desteklenen PID bulunamadi.")

    REPORT_PATH.write_text("\n".join(content) + "\n", encoding="utf-8")


async def run_discovery() -> None:
    manager = BleTelemetryManager()

    print("\n=== OBD-II PID Discovery basliyor ===")
    device = await manager._resolve_device()
    if device is None:
        print("[HATA] OBD BLE cihazi bulunamadi.")
        return

    print(f"[BLE] Baglaniliyor: {device.name or 'Unknown'} ({device.address})")

    supported_lines: list[str] = []

    async with BleakClient(device, timeout=20.0) as client:
        if not client.is_connected:
            print("[HATA] BLE baglantisi kurulamadi.")
            return

        await client.start_notify(NOTIFY_CHAR_UUID, manager._on_notify)
        try:
            await manager._initialize_adapter(client)
            print("[BLE] Adapter hazir. PID taramasi basliyor...\n")

            for pid in range(PID_START, PID_END + 1):
                command = f"01{pid:02X}"
                raw = await manager._send_command(client, command)
                payload = _extract_payload(raw, pid)

                if payload is None:
                    continue

                value = _format_value(pid, payload)
                raw_hex = _format_raw(raw)
                name = _pid_name(pid)
                line = f"- {command} | {name} | {value} | raw: {raw_hex}"
                supported_lines.append(line)
                print(line)

                await asyncio.sleep(0.03)
        finally:
            try:
                await client.stop_notify(NOTIFY_CHAR_UUID)
            except Exception:
                pass

    save_report(supported_lines)
    print("\n=== Discovery tamamlandi ===")
    print(f"Desteklenen PID sayisi: {len(supported_lines)}")
    print(f"Rapor kaydedildi: {REPORT_PATH}")


if __name__ == "__main__":
    asyncio.run(run_discovery())
