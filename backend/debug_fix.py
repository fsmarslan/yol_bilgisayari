import time
from typing import Optional

import obd


PORT = "/dev/cu.OBDII"
BAUD_RATES = [38400, 115200]
FORCED_PROTOCOLS = [
    ("6", "ISO 15765-4 CAN 11/500"),
    ("4", "ISO 14230-4 KWP 5baud"),
    ("5", "ISO 14230-4 KWP Fast"),
]


def classify_exception(exc: Exception) -> str:
    msg = str(exc).lower()
    if "resource busy" in msg or "device or resource busy" in msg or "permission denied" in msg:
        return "FIZIKSEL/PORT: Port mesgul veya izin sorunu"
    if "timeout" in msg or "no response" in msg:
        return "YAZILIMSAL/NO RESPONSE: ECU yanit vermiyor"
    if "protocol" in msg or "unable to load protocol" in msg:
        return "PROTOKOL: Uyumsuz protokol"
    return "GENEL HATA"


def print_header(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def safe_close(connection: Optional[obd.OBD]) -> None:
    if connection is None:
        return
    try:
        connection.close()
    except Exception as exc:
        print(f"[WARN] Baglanti kapanirken hata: {exc}")


def raw_send(connection: obd.OBD, command: bytes, delay: Optional[float] = None):
    if connection.interface is None:
        raise RuntimeError("Arayuz (ELM327) hazir degil")
    # python-obd raw AT gonderimi icin low-level metoda bu sekilde erisiliyor.
    return connection.interface._ELM327__send(command, delay=delay)


def test_raw_commands(connection: obd.OBD) -> None:
    print("[STEP] Ham komut testi basliyor: ATZ ve ATRV")

    try:
        atz_lines = raw_send(connection, b"ATZ", delay=1)
        print(f"[RAW] ATZ cevap satirlari: {atz_lines}")
    except Exception as exc:
        print(f"[ERR] ATZ gonderimi basarisiz: {exc} | {classify_exception(exc)}")

    try:
        atrv_lines = raw_send(connection, b"ATRV")
        print(f"[RAW] ATRV cevap satirlari: {atrv_lines}")
    except Exception as exc:
        print(f"[ERR] ATRV gonderimi basarisiz: {exc} | {classify_exception(exc)}")

    try:
        voltage = connection.query(obd.commands.ELM_VOLTAGE, force=True)
        if voltage.is_null():
            print("[RAW] ELM_VOLTAGE query null dondu")
        else:
            print(f"[RAW] ELM_VOLTAGE query sonucu: {voltage.value}")
    except Exception as exc:
        print(f"[ERR] ELM_VOLTAGE query hatasi: {exc} | {classify_exception(exc)}")


def attempt_connection(baudrate: int, protocol_id: Optional[str], protocol_name: str) -> None:
    print_header(
        f"DENEME -> port={PORT} | baud={baudrate} | fast=False | protocol={protocol_id} ({protocol_name})"
    )

    conn = None
    try:
        print("[STEP] OBD baglantisi kuruluyor...")
        conn = obd.OBD(
            portstr=PORT,
            baudrate=baudrate,
            protocol=protocol_id,
            fast=False,
            timeout=2,
        )

        status = conn.status()
        print(f"[INFO] status={status}")
        print(f"[INFO] is_connected()={conn.is_connected()}")
        print(f"[INFO] port_name={conn.port_name()}")

        protocol_id_runtime = conn.protocol_id() or ""
        protocol_name_runtime = conn.protocol_name() or ""
        print(f"[INFO] protocol_id={protocol_id_runtime}")
        print(f"[INFO] protocol_name={protocol_name_runtime}")

        if conn.interface is not None and status == obd.OBDStatus.ELM_CONNECTED:
            print("[WARN] ELM bagli, fakat araca baglanamadi. Muhtemel protokol/ECU yanit problemi.")

        if not conn.is_connected():
            print("[FAIL] connection.is_connected() False. Bir sonraki konfigurasyona geciliyor.")
            return

        print("[OK] Arac baglantisi kuruldu, veri ve ham komut testlerine geciliyor...")

        try:
            rpm = conn.query(obd.commands.RPM, force=True)
            if rpm.is_null():
                print("[DATA] RPM cevabi null (PID cevap vermemis olabilir)")
            else:
                print(f"[DATA] RPM: {rpm.value}")
        except Exception as exc:
            print(f"[ERR] RPM sorgu hatasi: {exc} | {classify_exception(exc)}")

        test_raw_commands(conn)

    except Exception as exc:
        print(f"[ERR] Baglanti kurulurken hata: {exc}")
        print(f"[CLASS] {classify_exception(exc)}")
    finally:
        safe_close(conn)
        print("[STEP] Deneme sonlandirildi, baglanti kapatildi.")
        time.sleep(0.5)


def main() -> None:
    print_header("OBD DEBUG FIX CALISTIRILIYOR")

    # Tum python-obd alt-seviye loglarini terminale bas.
    obd.logger.setLevel(obd.logging.DEBUG)

    print(f"[INFO] Sabit port: {PORT}")
    print(f"[INFO] Denenecek baudrate degerleri: {BAUD_RATES}")
    print("[INFO] Denenecek protokoller: 6, 4, 5 (Toyota fix)")

    for baud in BAUD_RATES:
        for protocol_id, protocol_name in FORCED_PROTOCOLS:
            attempt_connection(baudrate=baud, protocol_id=protocol_id, protocol_name=protocol_name)

    print_header("TUM DENEMELER TAMAMLANDI")
    print("Loglari inceleyerek calisan kombinasyonu secin.")


if __name__ == "__main__":
    main()
