import time

import serial


PORT_PRIMARY = "/dev/cu.OBDII"
PORT_FALLBACK = "/dev/tty.OBDII"
BAUDRATE = 38400
TIMEOUT_SECONDS = 5
WAIT_AFTER_COMMAND_SECONDS = 2
COMMANDS = [b"ATZ\r", b"ATE0\r", b"ATRV\r"]


def run_raw_test(port: str) -> bool:
    print("\n" + "=" * 72)
    print(f"PORT TESTI: {port} | baudrate={BAUDRATE} timeout={TIMEOUT_SECONDS}")
    print("=" * 72)

    try:
        ser = serial.Serial(port=port, baudrate=BAUDRATE, timeout=TIMEOUT_SECONDS)
    except Exception as exc:
        print(f"PORT ACMA HATASI ({port}): {exc}")
        return False

    print(f"PORT ACILDI: {port}")

    try:
        ser.reset_input_buffer()
        ser.reset_output_buffer()

        for cmd in COMMANDS:
            print(f"SEND: {cmd!r}")
            try:
                ser.write(cmd)
                ser.flush()
            except Exception as exc:
                print(f"YAZMA HATASI ({cmd!r}): {exc}")
                print("RAW RESPONSE: b''")
                continue

            time.sleep(WAIT_AFTER_COMMAND_SECONDS)

            try:
                response = ser.read_all()
            except Exception as exc:
                print(f"OKUMA HATASI ({cmd!r}): {exc}")
                response = b""

            print(f"RAW RESPONSE: {response!r}")

    finally:
        try:
            ser.close()
        except Exception:
            pass
        print(f"PORT KAPATILDI: {port}")

    return True


def main() -> None:
    primary_ok = run_raw_test(PORT_PRIMARY)

    if not primary_ok:
        print("\n[INFO] /dev/cu.OBDII acilamadi, /dev/tty.OBDII ile tekrar deneniyor...")
        run_raw_test(PORT_FALLBACK)


if __name__ == "__main__":
    main()
