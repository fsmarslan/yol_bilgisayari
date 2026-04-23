import subprocess
import time
from typing import Iterable, Optional

import obd
import serial


PORT = "/dev/cu.OBDII"
BAUDRATES = [38400, 115200]
PROTOCOLS = ["5", "4"]
FAST_MODE = False
TIMEOUT_SECONDS = 30
ATZ_DELAY_SECONDS = 2.5
INTERVAL_SECONDS = 1


def print_header(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def status_name(status_code: object) -> str:
    text = str(status_code)
    return text.upper().replace(" ", "_")


def classify_status(status_code: object) -> str:
    status_text = status_name(status_code)

    if "NOT_CONNECTED" in status_text:
        return "Port Busy / izin sorunu / BLE adapter bagli degil"
    if "ELM_CONNECTED" in status_text:
        return "ELM bagli ama ECU cevap vermiyor (No Response / protocol uyumsuzlugu)"
    if "CAR_CONNECTED" in status_text:
        return "Arac baglantisi kuruldu"
    return "Durum kodu belirsiz"


def ensure_pyserial_ok() -> None:
    version = getattr(serial, "__version__", "unknown")
    module_file = getattr(serial, "__file__", "unknown")

    print(f"[serial] pyserial version: {version}")
    print(f"[serial] module path: {module_file}")

    if "site-packages/serial" not in str(module_file):
        print("[serial][warn] serial modulu beklenen pyserial konumunda degil.")


def check_port_lock(port: str) -> None:
    print_header("PORT KILIT KONTROLU")
    try:
        result = subprocess.run(
            ["lsof", port],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        print("[port][warn] lsof bulunamadi, kilit kontrolu atlandi")
        return
    except Exception as exc:
        print(f"[port][err] lsof calistirilamadi: {exc}")
        return

    output = (result.stdout or "").strip()
    if output:
        print("[port][warn] Portu kullanan surecler bulundu:")
        print(output)
    else:
        print("[port] Portu tutan aktif surec gorunmuyor.")


def close_connection(connection: Optional[obd.OBD]) -> None:
    if connection is None:
        return
    try:
        connection.close()
    except Exception:
        pass


def raw_atz_via_obd(connection: obd.OBD) -> Optional[object]:
    if connection.interface is None:
        print("[raw-obd] interface yok, ATZ gonderilemedi")
        return None

    try:
        if hasattr(connection.interface, "send"):
            response = connection.interface.send(b"ATZ\r")
            print(f"[raw-obd] ATZ response (send): {response}")
            return response

        response = connection.interface._ELM327__send(b"ATZ", delay=ATZ_DELAY_SECONDS)
        print(f"[raw-obd] ATZ response (__send, delay={ATZ_DELAY_SECONDS}s): {response}")
        if response == [b""] or response == b"" or response == []:
            print("[raw-obd][warn] Cihazdan bos cevap dondu (b'').")
        return response
    except Exception as exc:
        print(f"[raw-obd][err] ATZ gonderimi hatali: {exc}")
        return None


def raw_atz_via_serial(port: str, baudrate: int, timeout_seconds: int) -> None:
    print_header(f"FALLBACK SERIAL DENEMESI (baud={baudrate})")
    serial_conn = None
    try:
        serial_conn = serial.Serial(port=port, baudrate=baudrate, timeout=timeout_seconds)
        serial_conn.reset_input_buffer()
        serial_conn.reset_output_buffer()
        serial_conn.write(b"ATZ\r")
        serial_conn.flush()
        time.sleep(ATZ_DELAY_SECONDS)

        raw_bytes = serial_conn.read(256)
        print(f"[raw-serial] Gelen ham byte: {raw_bytes!r}")
        if not raw_bytes:
            print("[raw-serial][warn] Bos cevap alindi.")
    except Exception as exc:
        print(f"[raw-serial][err] Ham serial denemesi basarisiz: {exc}")
    finally:
        if serial_conn is not None:
            try:
                serial_conn.close()
            except Exception:
                pass


def telemetry_loop(connection: obd.OBD) -> None:
    print_header("CANLI TELEMETRI")
    print("[loop] RPM ve Volt (ELM_VOLTAGE) saniyede bir okunuyor. Cikis: Ctrl+C")
    try:
        while True:
            rpm_resp = connection.query(obd.commands.RPM)
            volt_resp = connection.query(obd.commands.ELM_VOLTAGE, force=True)

            rpm = "-"
            if rpm_resp is not None and not rpm_resp.is_null() and rpm_resp.value is not None:
                rpm = str(rpm_resp.value)

            volt = "-"
            if volt_resp is not None and not volt_resp.is_null() and volt_resp.value is not None:
                volt = str(volt_resp.value)

            print(f"RPM: {rpm} | Volt: {volt}")
            time.sleep(INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\n[loop] Kullanici tarafindan durduruldu.")
    except Exception as exc:
        print(f"[loop][err] Veri okuma hatasi: {exc}")


def scan_and_connect(
    port: str,
    baudrates: Iterable[int],
    protocols: Iterable[str],
) -> Optional[obd.OBD]:
    for baudrate in baudrates:
        for protocol in protocols:
            print_header(
                f"DENEME -> port={port} baud={baudrate} protocol={protocol} fast={FAST_MODE} timeout={TIMEOUT_SECONDS}"
            )

            connection = None
            try:
                connection = obd.OBD(
                    portstr=port,
                    baudrate=baudrate,
                    protocol=protocol,
                    fast=FAST_MODE,
                    timeout=TIMEOUT_SECONDS,
                )
            except Exception as exc:
                print(f"[connect][err] Baglanti olusturulamadi: {exc}")
                raw_atz_via_serial(port, baudrate, TIMEOUT_SECONDS)
                continue

            connected = connection.is_connected()
            status_code = connection.status()

            print(f"[connect] is_connected={connected}")
            print(f"[connect] status={status_code} ({status_name(status_code)})")
            print(f"[connect] tespit={classify_status(status_code)}")

            raw_atz_via_obd(connection)

            if connected:
                print("[connect][ok] Araca baglanti basarili.")
                return connection

            close_connection(connection)
            raw_atz_via_serial(port, baudrate, TIMEOUT_SECONDS)

    return None


def main() -> None:
    obd.logger.setLevel(obd.logging.DEBUG)

    print_header("PYTHON-OBD BLE DEBUG CONNECTOR")
    print(f"[config] port={PORT}")
    print(f"[config] baudrates={BAUDRATES}")
    print(f"[config] protocols={PROTOCOLS}")
    print(f"[config] fast={FAST_MODE} timeout={TIMEOUT_SECONDS}")

    ensure_pyserial_ok()
    check_port_lock(PORT)

    connection = scan_and_connect(PORT, BAUDRATES, PROTOCOLS)
    if connection is None:
        print_header("SONUC")
        print("[fail] Tum baud/protokol denemeleri basarisiz.")
        print("[tip] BLE OBD cihazini baska uygulamalarin kullanmadigindan emin olun.")
        return

    try:
        telemetry_loop(connection)
    finally:
        close_connection(connection)
        print("[exit] Baglanti kapatildi.")


if __name__ == "__main__":
    main()
