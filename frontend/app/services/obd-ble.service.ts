import {
  BleClient,
  type BleDevice,
  ConnectionPriority,
  numbersToDataView,
  dataViewToNumbers,
} from "@capacitor-community/bluetooth-le";

export type DtcItem = {
  code: string;
  description: string;
  system: "Motor" | "Şanzıman" | "Gövde" | "Şasi" | "Ağ";
  severity: "Kritik" | "Orta" | "Düşük";
};

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
  battery_voltage: number | null;
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

// Yaygın OBD-II & Toyota Arıza Kodları Sözlüğü
export const DTC_DATABASE: Record<string, { description: string; system: DtcItem["system"]; severity: DtcItem["severity"] }> = {
  P0100: { description: "Kütle Hava Akış (MAF) Sensör Devresi Arızası", system: "Motor", severity: "Orta" },
  P0101: { description: "Kütle Hava Akış Sensörü Aralık / Performans Sorunu", system: "Motor", severity: "Orta" },
  P0102: { description: "Kütle Hava Akış Sensörü Düşük Sinyal Girişi", system: "Motor", severity: "Orta" },
  P0103: { description: "Kütle Hava Akış Sensörü Yüksek Sinyal Girişi", system: "Motor", severity: "Orta" },
  P0105: { description: "Manifold Mutlak Basınç (MAP) Sensör Devresi Arızası", system: "Motor", severity: "Kritik" },
  P0106: { description: "Manifold Basınç Sensörü Performans Hatası", system: "Motor", severity: "Orta" },
  P0110: { description: "Emme Havası Sıcaklık (IAT) Sensör Devresi", system: "Motor", severity: "Düşük" },
  P0115: { description: "Motor Soğutma Suyu Sıcaklık (ECT) Devresi", system: "Motor", severity: "Kritik" },
  P0116: { description: "Soğutma Suyu Sıcaklık Sensörü Aralık / Performans", system: "Motor", severity: "Orta" },
  P0120: { description: "Gaz Pedalı / Kelebek Pozisyon Sensörü 'A' Devresi", system: "Motor", severity: "Kritik" },
  P0121: { description: "Gaz Pedalı Pozisyon Sensörü Aralık Sorunu", system: "Motor", severity: "Orta" },
  P0200: { description: "Enjektör Devresi Genel Arıza", system: "Motor", severity: "Kritik" },
  P0201: { description: "Silindir 1 Enjektör Devresi Açık / Arıza", system: "Motor", severity: "Kritik" },
  P0202: { description: "Silindir 2 Enjektör Devresi Açık / Arıza", system: "Motor", severity: "Kritik" },
  P0203: { description: "Silindir 3 Enjektör Devresi Açık / Arıza", system: "Motor", severity: "Kritik" },
  P0204: { description: "Silindir 4 Enjektör Devresi Açık / Arıza", system: "Motor", severity: "Kritik" },
  P0234: { description: "Turboşarj Aşırı Basınç (Overboost) Durumu", system: "Motor", severity: "Kritik" },
  P0238: { description: "Turbo Basınç Sensörü 'A' Devresi Yüksek Giriş", system: "Motor", severity: "Kritik" },
  P0299: { description: "Turboşarj Düşük Basınç (Underboost) Durumu", system: "Motor", severity: "Orta" },
  P0300: { description: "Rastgele Silindir Ateşleme / Yanma Hatası", system: "Motor", severity: "Kritik" },
  P0380: { description: "Kızdırma Bujisi Devresi 'A' Arızası (Isıtma Bujileri)", system: "Motor", severity: "Orta" },
  P0400: { description: "Egzoz Gazı Devridaimi (EGR) Akış Arızası (Tıkanıklık/Kurum)", system: "Motor", severity: "Orta" },
  P0401: { description: "EGR Sistemi Yetersiz Akış Algılandı (EGR Valfi Temizlenmeli)", system: "Motor", severity: "Orta" },
  P0402: { description: "EGR Sistemi Aşırı Akış Algılandı", system: "Motor", severity: "Orta" },
  P0500: { description: "Araç Hız Sensörü (VSS) Devresi Arızası", system: "Motor", severity: "Kritik" },
  P0560: { description: "Sistem Voltajı Kararsız / Düşük", system: "Motor", severity: "Orta" },
  P0627: { description: "Yakıt Pompası Kontrol Devresi Açık", system: "Motor", severity: "Kritik" },
  P0700: { description: "Şanzıman Kontrol Sistemi Hatası", system: "Şanzıman", severity: "Kritik" },
  P2002: { description: "Dizel Partikül Filtresi (DPF) Verimlilik Sınırı Altında", system: "Motor", severity: "Orta" },
  C1201: { description: "Toyota Motor Kontrol Sistemi Arızası (ABS/VSC Devre Dışı)", system: "Şasi", severity: "Orta" },
  C1241: { description: "ABS Düşük Akü Voltajı Hatası", system: "Şasi", severity: "Düşük" },
  U0100: { description: "ECM/PCM (Motor Beyni) İletişim Kaybı", system: "Ağ", severity: "Kritik" },
};

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
    battery_voltage: null,
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
    void this.runLoop();
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

  public getSavedDeviceId(): string | null {
    if (typeof window === "undefined" || !window.localStorage) return null;
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_DEVICE_ID);
    } catch {
      return null;
    }
  }

  public getSavedDeviceName(): string | null {
    if (typeof window === "undefined" || !window.localStorage) return null;
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_DEVICE_NAME);
    } catch {
      return null;
    }
  }

  private saveDevice(deviceId: string, name?: string) {
    if (typeof window === "undefined" || !window.localStorage) return;
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
          throw new Error("OBD-II Bluetooth adaptörü bulunamadı. Lütfen kontağı açın.");
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

    // ELM327 Adaptörü Başlat
    await this.initializeElm327(device.deviceId);

    this.state.connected = true;
    this.state.connecting = false;
    this.state.last_error = null;
    this.lastSuccessTimestamp = Date.now();
    this.notifyListeners();

    // Süper Akıcı, Zaman Bölüşümlü Telemetri Döngüsü
    let subTick = 0;
    while (this.isRunning && this.state.connected) {
      await this.streamFastStep(device.deviceId, subTick);
      subTick = (subTick + 1) % 6;

      // Bluetooth bandını rahatlatma payı (A2DP müzik akışının ve navigasyonun tıkanmasını engeller)
      await new Promise((r) => setTimeout(r, 24));

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
        finish("");
      }, timeoutMs);

      try {
        const payload = Array.from(`${command}\r`).map((c) => c.charCodeAt(0));
        const data = numbersToDataView(payload);
        if (this.canWriteWithoutResponse) {
          await BleClient.writeWithoutResponse(
            deviceId,
            this.serviceUuid,
            this.writeUuid,
            data,
          );
        } else {
          await BleClient.write(deviceId, this.serviceUuid, this.writeUuid, data);
        }
      } catch {
        finish("");
      }
    });
  }

  private async initializeElm327(deviceId: string) {
    const initCommands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATAL"];
    for (const cmd of initCommands) {
      await this.sendCommand(deviceId, cmd, 600);
      if (cmd === "ATZ") {
        await new Promise((r) => setTimeout(r, 600));
      } else {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    // Toyota 1ND-TV için Protokol 5 (KWP Fast Init) dene, yanıt vermezse Otomatik (ATSP0)
    await this.sendCommand(deviceId, "ATSP5", 600);
    const check0100 = await this.sendCommand(deviceId, "0100", 2500);
    if (!check0100 || check0100.includes("ERROR") || check0100.includes("UNABLE") || check0100.includes("NO DATA")) {
      console.warn("[MobileObdBleService] ATSP5 yanıt vermedi, ATSP0 (Otomatik) deneniyor...");
      await this.sendCommand(deviceId, "ATSP0", 600);
      await this.sendCommand(deviceId, "0100", 2500);
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

          const volt = await this.queryBatteryVoltage(deviceId);
          if (volt !== null) this.state.battery_voltage = volt;

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

    // 2. Non-Lineer Dizel Efektif AFR (Toyota 1.4 D-4D Karakteristigi)
    let effectiveAfr = CRUISE_DEFAULT_AFR;
    if (loadPercent !== null) {
      const clampedLoad = Math.max(0, Math.min(100, loadPercent));
      const loadFactor = Math.pow(1.0 - clampedLoad / 100.0, 3.0);
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

  public async queryBatteryVoltage(deviceId?: string): Promise<number | null> {
    const targetId = deviceId || this.connectedDeviceId;
    if (!targetId || !this.state.connected) return null;
    try {
      const raw = await this.sendCommand(targetId, "ATRV", 400);
      const match = raw.match(/(\d+\.?\d*)\s*V?/i);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        if (!isNaN(val) && val >= 5.0 && val <= 18.0) {
          return Math.round(val * 10) / 10;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * OBD-II Mode 03 ile Aktif Arıza Kodlarını (DTC) Oku
   */
  public async readDtcCodes(): Promise<DtcItem[]> {
    if (!this.connectedDeviceId || !this.state.connected) {
      throw new Error("OBD-II adaptörü bağlı değil");
    }

    try {
      const raw = await this.sendCommand(this.connectedDeviceId, "03", 1200);
      const normalized = raw.toUpperCase().replace(/[^0-9A-F]/g, "");

      const pos = normalized.indexOf("43");
      if (pos === -1) {
        return [];
      }

      const tail = normalized.slice(pos + 2);
      const codes: DtcItem[] = [];

      for (let i = 0; i + 4 <= tail.length; i += 4) {
        const chunk = tail.slice(i, i + 4);
        if (chunk === "0000") continue;

        const firstByte = parseInt(chunk[0], 16);
        const systemBits = (firstByte >> 2) & 0x03;
        const codeTypeBit = firstByte & 0x03;

        let prefix = "P";
        let systemType: DtcItem["system"] = "Motor";
        if (systemBits === 1) {
          prefix = "C";
          systemType = "Şasi";
        } else if (systemBits === 2) {
          prefix = "B";
          systemType = "Gövde";
        } else if (systemBits === 3) {
          prefix = "U";
          systemType = "Ağ";
        }

        const codeStr = `${prefix}${codeTypeBit}${chunk.slice(1)}`;
        const dbInfo = DTC_DATABASE[codeStr] || {
          description: "Genel OBD-II Teşhis Arıza Kodu",
          system: systemType,
          severity: "Orta" as const,
        };

        codes.push({
          code: codeStr,
          description: dbInfo.description,
          system: dbInfo.system,
          severity: dbInfo.severity,
        });
      }

      return codes;
    } catch (err: any) {
      throw new Error("Arıza kodları okunamadı: " + (err?.message || err));
    }
  }

  /**
   * OBD-II Mode 04 ile Arıza Kodlarını ve Motor Lambasını Söndür (Clear DTC)
   */
  public async clearDtcCodes(): Promise<boolean> {
    if (!this.connectedDeviceId || !this.state.connected) {
      throw new Error("OBD-II adaptörü bağlı değil");
    }

    try {
      const raw = await this.sendCommand(this.connectedDeviceId, "04", 1500);
      const normalized = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
      const isSuccess = normalized.includes("44") || normalized.includes("OK");
      if (isSuccess) {
        this.state.distance_mil_on = 0;
        this.notifyListeners();
      }
      return isSuccess;
    } catch (err: any) {
      throw new Error("Arıza kodları silinemedi: " + (err?.message || err));
    }
  }
}

export const obdBleService = MobileObdBleService.getInstance();
