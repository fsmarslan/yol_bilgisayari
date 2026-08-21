import { BleClient, type BleDevice, numbersToDataView, dataViewToNumbers } from "@capacitor-community/bluetooth-le";

export type TelemetryState = {
  connected: boolean;
  connecting: boolean;
  rpm: number | null;
  speed_kmh: number | null;
  maf_gps: number | null;
  coolant_temp_c: number | null;
  load_percent: number | null;
  intake_temp_c: number | null;
  throttle_percent: number | null;
  map_kpa: number | null;
  distance_mil_on: number | null;
  turbo_boost_bar: number | null;
  fuel_display: number | null;
  fuel_unit: string;
  fuel_rate_lph: number | null;
  last_error: string | null;
  updated_at: string | null;
};

const OBD_NAME_HINTS = ["OBD", "OBDII", "ELM", "VLINK", "VGATE", "CAN"];

// Standart BLE OBD-II Servis & Karakteristik UUID'leri
const DEFAULT_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
const DEFAULT_NOTIFY_CHAR = "0000fff1-0000-1000-8000-00805f9b34fb";
const DEFAULT_WRITE_CHAR = "0000fff2-0000-1000-8000-00805f9b34fb";

// 2006 Toyota Corolla 1.4 D-4D (1ND-TV) Parametreleri
const DIESEL_DENSITY_G_PER_L = 840.0;
const MIN_DIESEL_AFR = 17.5;
const MAX_DIESEL_AFR = 65.0;
const CRUISE_DEFAULT_AFR = 32.0;

export class MobileObdBleService {
  private static instance: MobileObdBleService;
  private isInitialized = false;
  private connectedDeviceId: string | null = null;
  private notifyBuffer: string = "";
  private responseResolver: ((response: string) => void) | null = null;
  private responseTimeoutTimer: any = null;
  private ambientPressureKpa = 101.3;
  private lastSlowPollTime = 0;
  private isRunning = false;
  private serviceUuid = DEFAULT_SERVICE_UUID;
  private notifyUuid = DEFAULT_NOTIFY_CHAR;
  private writeUuid = DEFAULT_WRITE_CHAR;

  private state: TelemetryState = {
    connected: false,
    connecting: false,
    rpm: null,
    speed_kmh: null,
    maf_gps: null,
    coolant_temp_c: null,
    load_percent: null,
    intake_temp_c: null,
    throttle_percent: null,
    map_kpa: null,
    distance_mil_on: null,
    turbo_boost_bar: null,
    fuel_display: null,
    fuel_unit: "--",
    fuel_rate_lph: null,
    last_error: null,
    updated_at: null,
  };

  private listeners: Array<(state: TelemetryState) => void> = [];

  private constructor() {}

  public static getInstance(): MobileObdBleService {
    if (!MobileObdBleService.instance) {
      MobileObdBleService.instance = new MobileObdBleService();
    }
    return MobileObdBleService.instance;
  }

  public subscribe(listener: (state: TelemetryState) => void): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runLoop();
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.connectedDeviceId) {
      try {
        await BleClient.disconnect(this.connectedDeviceId);
      } catch {
        // Ignore
      }
      this.connectedDeviceId = null;
    }
    this.state.connected = false;
    this.state.connecting = false;
    this.notifyListeners();
  }

  private async initBle(): Promise<boolean> {
    if (this.isInitialized) return true;
    try {
      await BleClient.initialize();
      this.isInitialized = true;
      return true;
    } catch (err: any) {
      this.state.last_error = `Bluetooth başlatılamadı: ${err?.message || err}`;
      this.notifyListeners();
      return false;
    }
  }

  private async runLoop() {
    let reconnectDelay = 1500;

    while (this.isRunning) {
      try {
        const ok = await this.initBle();
        if (!ok) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        this.state.connecting = true;
        this.state.last_error = null;
        this.notifyListeners();

        const device = await this.scanForObd();
        if (!device) {
          throw new Error("OBD-II Bluetooth adaptörü bulunamadı");
        }

        await this.connectAndStream(device);
        reconnectDelay = 1500;
      } catch (err: any) {
        this.state.connected = false;
        this.state.connecting = false;
        this.state.last_error = err?.message || String(err);
        this.notifyListeners();

        if (!this.isRunning) break;
        await new Promise((r) => setTimeout(r, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 1.5, 4000);
      }
    }
  }

  private async scanForObd(): Promise<BleDevice | null> {
    let targetDevice: BleDevice | null = null;

    try {
      await BleClient.requestLEScan({}, (result) => {
        const name = (result.device.name || result.localName || "").toUpperCase();
        if (OBD_NAME_HINTS.some((hint) => name.includes(hint))) {
          targetDevice = result.device;
          BleClient.stopLEScan().catch(() => {});
        }
      });

      await new Promise((r) => setTimeout(r, 3500));
      await BleClient.stopLEScan().catch(() => {});
    } catch {
      // Scan error
    }

    return targetDevice;
  }

  private async connectAndStream(device: BleDevice) {
    this.connectedDeviceId = device.deviceId;
    await BleClient.connect(device.deviceId, (deviceId) => {
      if (deviceId === this.connectedDeviceId) {
        this.state.connected = false;
        this.state.connecting = false;
        this.notifyListeners();
      }
    });

    // Servis ve Karakteristikleri Keşfet
    const services = await BleClient.getServices(device.deviceId);
    this.detectUuids(services);

    // Bildirimleri Dinlemeye Başla (Sıfır Gecikmeli Instant Event Resolver)
    this.notifyBuffer = "";
    await BleClient.startNotifications(
      device.deviceId,
      this.serviceUuid,
      this.notifyUuid,
      (value) => {
        const bytes = dataViewToNumbers(value);
        const text = String.fromCharCode(...bytes);
        this.notifyBuffer += text;

        if (this.notifyBuffer.includes(">")) {
          const finished = this.notifyBuffer;
          this.notifyBuffer = "";
          if (this.responseResolver) {
            if (this.responseTimeoutTimer) {
              clearTimeout(this.responseTimeoutTimer);
              this.responseTimeoutTimer = null;
            }
            const res = this.responseResolver;
            this.responseResolver = null;
            res(finished);
          }
        }
      },
    );

    // ELM327 Adaptörü Optimize Parametrelerle Başlat
    await this.initializeElm327(device.deviceId);

    this.state.connected = true;
    this.state.connecting = false;
    this.state.last_error = null;
    this.notifyListeners();

    // Süper Akıcı Yüksek Frekanslı Telemetri Döngüsü (~20 Hz Interleaved)
    let subTick = 0;
    while (this.isRunning && this.state.connected) {
      await this.streamFastStep(device.deviceId, subTick);
      subTick = (subTick + 1) % 6;
      // Sıfır bekleme (paketler geldikçe anında bir sonraki sorgulanır)
    }
  }

  private detectUuids(services: any[]) {
    for (const s of services) {
      const sUuid = s.uuid.toLowerCase();
      if (sUuid.includes("fff0") || sUuid.includes("ffe0") || sUuid.includes("18f0") || sUuid.includes("ae00")) {
        this.serviceUuid = s.uuid;
        for (const c of s.characteristics) {
          const cUuid = c.uuid.toLowerCase();
          if (cUuid.includes("fff1") || cUuid.includes("ffe1") || cUuid.includes("ae02")) {
            this.notifyUuid = c.uuid;
          }
          if (cUuid.includes("fff2") || cUuid.includes("ffe1") || cUuid.includes("ae01")) {
            this.writeUuid = c.uuid;
          }
        }
      }
    }
  }

  private sendCommand(deviceId: string, command: string, timeoutMs = 450): Promise<string> {
    return new Promise(async (resolve) => {
      this.notifyBuffer = "";
      this.responseResolver = resolve;

      this.responseTimeoutTimer = setTimeout(() => {
        this.responseResolver = null;
        resolve(this.notifyBuffer);
      }, timeoutMs);

      try {
        const payload = Array.from(`${command}\r`).map((c) => c.charCodeAt(0));
        await BleClient.write(deviceId, this.serviceUuid, this.writeUuid, numbersToDataView(payload));
      } catch {
        if (this.responseTimeoutTimer) {
          clearTimeout(this.responseTimeoutTimer);
          this.responseTimeoutTimer = null;
        }
        this.responseResolver = null;
        resolve("");
      }
    });
  }

  private async initializeElm327(deviceId: string) {
    // ATAT2: Agresif adaptif zamanlama (ECU cevap verir vermez ELM327 hemen doner)
    // ATS0: Bosluklari kapat (BLE paket boyutu %40 kuculur)
    const initCommands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT2", "ATAL", "ATSP5"];
    for (const cmd of initCommands) {
      await this.sendCommand(deviceId, cmd, 600);
      if (cmd === "ATZ") {
        await new Promise((r) => setTimeout(r, 600));
      } else {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  /**
   * Süper Akıcı Çoklu Öncelikli Sorgulama (Interleaved Priority Multiplexing)
   * Her adımda RPM ve Hız anında ekrana yansıtılır!
   */
  private async streamFastStep(deviceId: string, tick: number) {
    const now = Date.now();

    // 1. Yüksek Öncelik: Her döngüde RPM sorgulanır (Anlık Gaz Tepkisi)
    const rpm = await this.queryPid(deviceId, "010C", "0C", this.parseRpm);
    if (rpm !== null) {
      this.state.rpm = rpm;
      this.updateCalculations();
      this.notifyListeners();
    }

    // 2. Yüksek Öncelik: Hız sorgulanır
    const speed = await this.queryPid(deviceId, "010D", "0D", this.parseSpeed);
    if (speed !== null) {
      this.state.speed_kmh = speed;
      this.updateCalculations();
      this.notifyListeners();
    }

    // 3. Dönen İkincil PID'ler (Her alt adımda biri sorgulanır)
    switch (tick) {
      case 0:
      case 3: {
        const maf = await this.queryPid(deviceId, "0110", "10", this.parseMaf);
        if (maf !== null) this.state.maf_gps = maf;
        break;
      }
      case 1:
      case 4: {
        const map = await this.queryPid(deviceId, "010B", "0B", this.parseMap);
        if (map !== null) this.state.map_kpa = map;
        break;
      }
      case 2: {
        const load = await this.queryPid(deviceId, "0104", "04", this.parseLoad);
        if (load !== null) this.state.load_percent = load;
        const throttle = await this.queryPid(deviceId, "0111", "11", this.parseThrottle);
        if (throttle !== null) this.state.throttle_percent = throttle;
        break;
      }
      case 5: {
        if (now - this.lastSlowPollTime >= 4000 || this.state.coolant_temp_c === null) {
          const coolant = await this.queryPid(deviceId, "0105", "05", this.parseCoolant);
          if (coolant !== null) this.state.coolant_temp_c = coolant;

          const intake = await this.queryPid(deviceId, "010F", "0F", this.parseIntakeTemp);
          if (intake !== null) this.state.intake_temp_c = intake;

          const dist = await this.queryPid(deviceId, "0121", "21", this.parseDistance);
          if (dist !== null) this.state.distance_mil_on = dist;

          this.lastSlowPollTime = now;
        }
        break;
      }
    }

    this.updateCalculations();
    this.notifyListeners();
  }

  private updateCalculations() {
    this.state.turbo_boost_bar = this.calculateTurboBoost(this.state.map_kpa, this.state.rpm);

    const [fuelDisplay, fuelUnit, fuelRateLph] = this.calculateDieselFuel(
      this.state.maf_gps,
      this.state.speed_kmh,
      this.state.load_percent,
      this.state.rpm,
      this.state.throttle_percent,
    );

    this.state.fuel_display = fuelDisplay;
    this.state.fuel_unit = fuelUnit;
    this.state.fuel_rate_lph = fuelRateLph;
    this.state.updated_at = new Date().toISOString();
  }

  private async queryPid(
    deviceId: string,
    command: string,
    pidHex: string,
    parser: (bytes: number[]) => number | null,
  ): Promise<number | null> {
    const raw = await this.sendCommand(deviceId, command);
    const payload = this.extractPayload(raw, pidHex);
    if (!payload) return null;
    return parser(payload);
  }

  private extractPayload(rawText: string, pidHex: string): number[] | null {
    const normalized = rawText.toUpperCase().replace(/[^0-9A-F]/g, "");
    const marker = `41${pidHex}`;
    const pos = normalized.indexOf(marker);
    if (pos === -1) return null;

    const tail = normalized.slice(pos + marker.length);
    const bytesNeeded: Record<string, number> = {
      "0C": 2,
      "0D": 1,
      "05": 1,
      "10": 2,
      "04": 1,
      "0B": 1,
      "0F": 1,
      "11": 1,
      "21": 2,
    };

    const needed = bytesNeeded[pidHex];
    if (!needed || tail.length < needed * 2) return null;

    const chunk = tail.slice(0, needed * 2);
    const bytes: number[] = [];
    for (let i = 0; i < chunk.length; i += 2) {
      bytes.push(parseInt(chunk.slice(i, i + 2), 16));
    }
    return bytes;
  }

  private parseRpm(data: number[]): number | null {
    if (data.length < 2) return null;
    return ((data[0] * 256) + data[1]) / 4.0;
  }

  private parseSpeed(data: number[]): number | null {
    return data.length ? data[0] : null;
  }

  private parseCoolant(data: number[]): number | null {
    return data.length ? data[0] - 40 : null;
  }

  private parseMaf(data: number[]): number | null {
    if (data.length < 2) return null;
    return ((data[0] * 256) + data[1]) / 100.0;
  }

  private parseLoad(data: number[]): number | null {
    return data.length ? (data[0] * 100.0) / 255.0 : null;
  }

  private parseMap(data: number[]): number | null {
    return data.length ? data[0] : null;
  }

  private parseIntakeTemp(data: number[]): number | null {
    return data.length ? data[0] - 40 : null;
  }

  private parseThrottle(data: number[]): number | null {
    return data.length ? (data[0] * 100.0) / 255.0 : null;
  }

  private parseDistance(data: number[]): number | null {
    if (data.length < 2) return null;
    return (data[0] * 256) + data[1];
  }

  private calculateTurboBoost(mapKpa: number | null, rpm: number | null): number | null {
    if (mapKpa === null) return null;

    if (rpm !== null && rpm < 300) {
      if (mapKpa >= 80.0 && mapKpa <= 110.0) {
        this.ambientPressureKpa = mapKpa;
      }
    }

    const boostBar = (mapKpa - this.ambientPressureKpa) / 100.0;
    return Math.max(0, Math.round(boostBar * 100) / 100);
  }

  private calculateDieselFuel(
    mafGps: number | null,
    speedKmh: number | null,
    loadPercent: number | null,
    rpm: number | null,
    throttlePercent: number | null,
  ): [number | null, string, number | null] {
    if (mafGps === null || speedKmh === null) {
      return [null, "--", null];
    }

    // 1. Kompresyonda Gaz Kesme (Deceleration Fuel Cut-off)
    let isCoasting = false;
    if (rpm !== null && rpm > 1150) {
      if (throttlePercent !== null && throttlePercent < 2.0) {
        isCoasting = true;
      } else if (loadPercent !== null && loadPercent < 8.0) {
        isCoasting = true;
      }
    }

    if (isCoasting && speedKmh > 15.0) {
      return [0.0, "L/100km", 0.0];
    }

    // 2. Non-Lineer Dizel Efektif AFR
    let effectiveAfr = CRUISE_DEFAULT_AFR;
    if (loadPercent !== null) {
      const clampedLoad = Math.max(0, Math.min(100, loadPercent));
      const loadFactor = Math.pow(1.0 - clampedLoad / 100.0, 2.2);
      effectiveAfr = MIN_DIESEL_AFR + (MAX_DIESEL_AFR - MIN_DIESEL_AFR) * loadFactor;
    }

    const fuelMassGps = mafGps / effectiveAfr;
    const litersPerHour = (fuelMassGps * 3600.0) / DIESEL_DENSITY_G_PER_L;

    if (speedKmh > 5.0) {
      const lPer100km = (litersPerHour / speedKmh) * 100.0;
      return [
        Math.min(35.0, Math.round(lPer100km * 100) / 100),
        "L/100km",
        Math.round(litersPerHour * 1000) / 1000,
      ];
    } else {
      return [
        Math.round(litersPerHour * 100) / 100,
        "L/h",
        Math.round(litersPerHour * 1000) / 1000,
      ];
    }
  }
}

export const obdBleService = MobileObdBleService.getInstance();
