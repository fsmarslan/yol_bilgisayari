import {
  BleClient,
  type BleDevice,
  ConnectionPriority,
  numbersToDataView,
  dataViewToNumbers,
} from "@capacitor-community/bluetooth-le";

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

const STORAGE_KEY_LAST_DEVICE_ID = "auradrive_last_ble_device_id";
const STORAGE_KEY_LAST_DEVICE_NAME = "auradrive_last_ble_device_name";

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
  private canWriteWithoutResponse = false;
  private consecutiveErrors = 0;
  private lastSuccessTimestamp = 0;
  private directConnectAttempts = 0;

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

  private constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          const now = Date.now();
          if (
            this.isRunning &&
            (!this.state.connected || (this.lastSuccessTimestamp > 0 && now - this.lastSuccessTimestamp > 4000))
          ) {
            console.log("[MobileObdBleService] Uygulama ön plana geldi, veri akışı kontrol ediliyor...");
            if (this.connectedDeviceId) {
              BleClient.disconnect(this.connectedDeviceId).catch(() => {});
            }
            this.state.connected = false;
            this.notifyListeners();
          }
        }
      });
    }
  }

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

  private getSavedDeviceId(): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_DEVICE_ID);
    } catch {
      return null;
    }
  }

  private getSavedDeviceName(): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_DEVICE_NAME);
    } catch {
      return null;
    }
  }

  private saveDevice(deviceId: string, name?: string) {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY_LAST_DEVICE_ID, deviceId);
      if (name) localStorage.setItem(STORAGE_KEY_LAST_DEVICE_NAME, name);
    } catch {
      // Ignore
    }
  }

  private async initBle(): Promise<boolean> {
    if (this.isInitialized) return true;
    try {
      await BleClient.initialize({ androidNeverForLocation: true });
      this.isInitialized = true;
      return true;
    } catch (err: any) {
      this.state.last_error = `Bluetooth başlatılamadı: ${err?.message || err}`;
      this.notifyListeners();
      return false;
    }
  }

  private async runLoop() {
    let reconnectDelay = 1200;

    while (this.isRunning) {
      try {
        const ok = await this.initBle();
        if (!ok) {
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }

        this.state.connecting = true;
        this.state.last_error = null;
        this.notifyListeners();

        let device: BleDevice | null = null;
        const savedId = this.getSavedDeviceId();

        // 1. Önce kayıtlı cihaza doğrudan bağlanmayı dene (BLE Scan yapmadan -> Araç multimedya/müzik akışını bozmaz)
        if (savedId && this.directConnectAttempts < 2) {
          device = {
            deviceId: savedId,
            name: this.getSavedDeviceName() || "OBD-II (Kayıtlı)",
          };
          this.directConnectAttempts++;
        } else {
          // 2. Kayıtlı cihaz yoksa veya doğrudan bağlantı başarısız olduysa tarama yap
          device = await this.scanForObd();
          this.directConnectAttempts = 0;
        }

        if (!device) {
          throw new Error("OBD-II Bluetooth adaptörü bulunamadı");
        }

        await this.connectAndStream(device);
        this.directConnectAttempts = 0;
        reconnectDelay = 1200;
      } catch (err: any) {
        this.state.connected = false;
        this.state.connecting = false;
        this.state.last_error = err?.message || String(err);
        this.notifyListeners();

        if (!this.isRunning) break;
        await new Promise((r) => setTimeout(r, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 1.4, 4000);
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

      await new Promise((r) => setTimeout(r, 3000));
      await BleClient.stopLEScan().catch(() => {});
    } catch {
      // Scan error
    }

    return targetDevice;
  }

  private async connectAndStream(device: BleDevice) {
    this.connectedDeviceId = device.deviceId;
    this.consecutiveErrors = 0;
    this.lastSuccessTimestamp = 0;

    await BleClient.connect(
      device.deviceId,
      (deviceId) => {
        if (deviceId === this.connectedDeviceId) {
          console.warn("[MobileObdBleService] BLE bağlantısı koptu (onDisconnect)");
          this.state.connected = false;
          this.state.connecting = false;
          this.notifyListeners();
        }
      },
      { timeout: 7000 },
    );

    // Başarılı bağlanan cihazı kaydet
    this.saveDevice(device.deviceId, device.name);

    // Android Bluetooth A2DP Müzik & BLE Birlikte Çalışma Optimizasyonu
    try {
      await BleClient.requestConnectionPriority(
        device.deviceId,
        ConnectionPriority.CONNECTION_PRIORITY_BALANCED,
      );
    } catch {
      // Platform desteklemiyorsa geç
    }

    // Servis ve Karakteristikleri Keşfet
    const services = await BleClient.getServices(device.deviceId);
    this.detectUuids(services);

    // Bildirimleri Dinlemeye Başla
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

    // ELM327 Adaptörü Bluetooth Müzik / A2DP Eşzamanlılığına Dayanıklı Parametrelerle Başlat
    await this.initializeElm327(device.deviceId);

    this.state.connected = true;
    this.state.connecting = false;
    this.state.last_error = null;
    this.lastSuccessTimestamp = Date.now();
    this.notifyListeners();

    // Süper Akıcı, Zaman Bölüşümlü Telemetri Döngüsü (~10-15 Hz)
    let subTick = 0;
    while (this.isRunning && this.state.connected) {
      await this.streamFastStep(device.deviceId, subTick);
      subTick = (subTick + 1) % 6;

      // Bluetooth bandını rahatlatma payı (A2DP müzik akışının tıkanmasını engeller)
      await new Promise((r) => setTimeout(r, 20));

      // Sağlık ve Kilitlenme Kontrolü (Watchdog)
      const now = Date.now();
      if (
        this.consecutiveErrors >= 7 ||
        (this.lastSuccessTimestamp > 0 && now - this.lastSuccessTimestamp > 4500)
      ) {
        console.warn("[MobileObdBleService] Veri akışı kesildi veya Bluetooth yanıt vermiyor, yeniden bağlanılıyor...");
        this.state.connected = false;
        this.state.connecting = false;
        this.notifyListeners();
        try {
          await BleClient.disconnect(device.deviceId);
        } catch {
          // Ignore
        }
        break;
      }
    }
  }

  private detectUuids(services: any[]) {
    for (const s of services) {
      const sUuid = s.uuid.toLowerCase();
      if (
        sUuid.includes("fff0") ||
        sUuid.includes("ffe0") ||
        sUuid.includes("18f0") ||
        sUuid.includes("ae00") ||
        sUuid.includes("e7810a70")
      ) {
        this.serviceUuid = s.uuid;
        for (const c of s.characteristics) {
          const cUuid = c.uuid.toLowerCase();
          if (
            cUuid.includes("fff1") ||
            cUuid.includes("ffe1") ||
            cUuid.includes("ae02") ||
            cUuid.includes("e7810a71")
          ) {
            this.notifyUuid = c.uuid;
          }
          if (
            cUuid.includes("fff2") ||
            cUuid.includes("ffe1") ||
            cUuid.includes("ae01") ||
            cUuid.includes("e7810a72")
          ) {
            this.writeUuid = c.uuid;
            this.canWriteWithoutResponse = !!c.properties?.writeWithoutResponse;
          }
        }
      }
    }
  }

  private sendCommand(deviceId: string, command: string, timeoutMs = 400): Promise<string> {
    return new Promise(async (resolve) => {
      this.notifyBuffer = "";
      let isDone = false;

      const finish = (resultText: string) => {
        if (isDone) return;
        isDone = true;
        if (this.responseTimeoutTimer) {
          clearTimeout(this.responseTimeoutTimer);
          this.responseTimeoutTimer = null;
        }
        this.responseResolver = null;
        resolve(resultText);
      };

      this.responseResolver = finish;

      this.responseTimeoutTimer = setTimeout(() => {
        finish(this.notifyBuffer);
      }, timeoutMs);

      try {
        const payload = Array.from(`${command}\r`).map((c) => c.charCodeAt(0));
        const data = numbersToDataView(payload);
        if (this.canWriteWithoutResponse) {
          await BleClient.writeWithoutResponse(deviceId, this.serviceUuid, this.writeUuid, data);
        } else {
          await BleClient.write(deviceId, this.serviceUuid, this.writeUuid, data);
        }
      } catch {
        finish("");
      }
    });
  }

  private async initializeElm327(deviceId: string) {
    // ATZ: Tam sıfırlama
    // ATE0: Eko kapat
    // ATL0: Linefeed kapat
    // ATS0: Boşlukları kapat (paket boyutu küçülür, BLE aktarımı hızlanır)
    // ATH0: Başlıkları kapat
    // ATAT1: Standart adaptif zamanlama (ATAT2 gibi aşırı agresif değildir; müzik akışında geciken paketleri yakalar)
    // ATST64: Güvenli zaman aşımı (~400ms)
    // ATAL: Uzun mesajlara izin ver
    // ATSP5: Toyota Corolla 1.4 D-4D için ISO 14230-4 KWP Fast Init
    const initCommands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATST64", "ATAL", "ATSP5"];
    for (const cmd of initCommands) {
      await this.sendCommand(deviceId, cmd, 700);
      if (cmd === "ATZ") {
        await new Promise((r) => setTimeout(r, 800));
      } else {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  }

  /**
   * Süper Akıcı & Çakışmasız Çoklu Öncelikli Sorgulama (Paced Priority Multiplexing)
   */
  private async streamFastStep(deviceId: string, tick: number) {
    const now = Date.now();

    // 1. Yüksek Öncelik: RPM
    const rpm = await this.queryPid(deviceId, "010C", "0C", this.parseRpm);
    if (rpm !== null) {
      this.state.rpm = rpm;
      this.updateCalculations();
      this.notifyListeners();
    }

    // Bluetooth paket kuyruğunu rahatlatmak için mikro aralık
    await new Promise((r) => setTimeout(r, 15));

    // 2. Yüksek Öncelik: Hız
    const speed = await this.queryPid(deviceId, "010D", "0D", this.parseSpeed);
    if (speed !== null) {
      this.state.speed_kmh = speed;
      this.updateCalculations();
      this.notifyListeners();
    }

    await new Promise((r) => setTimeout(r, 15));

    // 3. Dönen İkincil PID'ler
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
        await new Promise((r) => setTimeout(r, 12));
        const throttle = await this.queryPid(deviceId, "0111", "11", this.parseThrottle);
        if (throttle !== null) this.state.throttle_percent = throttle;
        break;
      }
      case 5: {
        if (now - this.lastSlowPollTime >= 4000 || this.state.coolant_temp_c === null) {
          const coolant = await this.queryPid(deviceId, "0105", "05", this.parseCoolant);
          if (coolant !== null) this.state.coolant_temp_c = coolant;

          await new Promise((r) => setTimeout(r, 12));
          const intake = await this.queryPid(deviceId, "010F", "0F", this.parseIntakeTemp);
          if (intake !== null) this.state.intake_temp_c = intake;

          await new Promise((r) => setTimeout(r, 12));
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
    if (!payload) {
      this.consecutiveErrors++;
      return null;
    }
    this.consecutiveErrors = 0;
    this.lastSuccessTimestamp = Date.now();
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
    return ((data[0] * 256) + data[1]);
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
