import {
  BleClient,
  type BleDevice,
  ConnectionPriority,
  numbersToDataView,
  dataViewToNumbers,
} from "@capacitor-community/bluetooth-le";
import { registerPlugin, Capacitor } from "@capacitor/core";

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

// Android Native BLE Köprü Arayüzü (AuraNativeBlePlugin)
export interface AuraNativeBlePluginInterface {
  connect(options: { deviceId: string }): Promise<{ success: boolean; connecting: boolean }>;
  disconnect(): Promise<{ success: boolean }>;
  isConnected(): Promise<{ connected: boolean }>;
  sendCustomCommand(options: { command: string; timeout?: number }): Promise<{ response: string }>;
  startScan(): Promise<{ devices: Array<{ deviceId: string; name: string }> }>;
  addListener(
    eventName: string,
    listenerFunc: (data: any) => void,
  ): Promise<any>;
}

const AuraNativeBle = registerPlugin<AuraNativeBlePluginInterface>("AuraNativeBle");

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
  private isRunning = false;
  private isNativeBridge = false;

  // UUID Tanımları (Fallback TS BLE Motoru İçin)
  private serviceUuid = DEFAULT_SERVICE_UUID;
  private notifyUuid = DEFAULT_NOTIFY_CHAR;
  private writeUuid = DEFAULT_WRITE_CHAR;
  private canWriteWithoutResponse = false;
  private consecutiveErrors = 0;
  private lastSuccessTimestamp = 0;

  // Dinamik Timeout & Exponential Backoff Haritası
  private pidTimeoutCounts = new Map<string, number>();
  private pidBackoffUntil = new Map<string, number>();

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
    this.isNativeBridge =
      typeof window !== "undefined" &&
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === "android";

    // 1. Android Native BLE Event Dinleyicileri
    if (typeof window !== "undefined") {
      window.addEventListener("nativeTelemetryUpdate", (e: any) => {
        if (e && e.detail) {
          this.handleNativeTelemetry(e.detail);
        }
      });

      window.addEventListener("nativeConnectionChange", (e: any) => {
        if (e && e.detail) {
          this.handleNativeConnectionChange(e.detail);
        }
      });

      // Uygulama ön plana geldiğinde bağlantı kontrolü
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          const now = Date.now();
          if (
            this.isRunning &&
            (!this.state.connected || (this.lastSuccessTimestamp > 0 && now - this.lastSuccessTimestamp > 5000))
          ) {
            console.log("[MobileObdBleService] Uygulama ön planda, bağlantı taranıyor...");
            if (this.isNativeBridge) {
              void this.start();
            } else if (this.connectedDeviceId) {
              BleClient.disconnect(this.connectedDeviceId).catch(() => {});
              this.state.connected = false;
              this.notifyListeners();
            }
          }
        }
      });
    }

    if (this.isNativeBridge) {
      try {
        AuraNativeBle.addListener("telemetryUpdate", (data: any) => {
          this.handleNativeTelemetry(data);
        });
        AuraNativeBle.addListener("connectionChange", (data: any) => {
          this.handleNativeConnectionChange(data);
        });
      } catch (err) {
        console.warn("[MobileObdBleService] Native BLE plugin listener hatası:", err);
      }
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

  /**
   * Android Native Katmanından Gelen 30+ FPS Normalize Edilmiş Telemetriyi İşle
   */
  private handleNativeTelemetry(data: any) {
    if (!data) return;

    this.state = {
      connected: data.connected ?? true,
      connecting: false,
      rpm: typeof data.rpm === "number" ? data.rpm : this.state.rpm,
      speed_kmh: typeof data.speed_kmh === "number" ? data.speed_kmh : this.state.speed_kmh,
      map_kpa: typeof data.map_kpa === "number" ? data.map_kpa : this.state.map_kpa,
      throttle_percent: typeof data.throttle_percent === "number" ? data.throttle_percent : this.state.throttle_percent,
      maf_gps: typeof data.maf_gps === "number" ? data.maf_gps : this.state.maf_gps,
      coolant_temp_c: typeof data.coolant_temp_c === "number" ? data.coolant_temp_c : this.state.coolant_temp_c,
      intake_temp_c: typeof data.intake_temp_c === "number" ? data.intake_temp_c : this.state.intake_temp_c,
      load_percent: typeof data.load_percent === "number" ? data.load_percent : this.state.load_percent,
      distance_mil_on: typeof data.distance_mil_on === "number" ? data.distance_mil_on : this.state.distance_mil_on,
      battery_voltage: typeof data.battery_voltage === "number" ? data.battery_voltage : this.state.battery_voltage,
      turbo_boost_bar: typeof data.turbo_boost_bar === "number" ? data.turbo_boost_bar : this.state.turbo_boost_bar,
      fuel_display: typeof data.fuel_display === "number" ? data.fuel_display : this.state.fuel_display,
      fuel_unit: data.fuel_unit || this.state.fuel_unit,
      fuel_rate_lph: typeof data.fuel_rate_lph === "number" ? data.fuel_rate_lph : this.state.fuel_rate_lph,
      last_error: null,
      updated_at: String(data.updated_at || Date.now()),
    };

    this.lastSuccessTimestamp = Date.now();
    this.notifyListeners();
  }

  private handleNativeConnectionChange(data: any) {
    this.state.connected = !!data.connected;
    this.state.connecting = false;
    if (data.message) {
      this.state.last_error = data.message;
    }
    this.notifyListeners();
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.isNativeBridge) {
      void this.runNativeBleLoop();
    } else {
      void this.runFallbackTsLoop();
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.isNativeBridge) {
      try {
        await AuraNativeBle.disconnect();
      } catch {}
    } else if (this.connectedDeviceId) {
      try {
        await BleClient.disconnect(this.connectedDeviceId);
      } catch {}
    }
    this.state.connected = false;
    this.state.connecting = false;
    this.notifyListeners();
  }

  // =========================================================================
  // 1. ANDROID NATIVE BLE ÇALIŞTIRMA MOTORU
  // =========================================================================
  private async runNativeBleLoop(): Promise<void> {
    const savedId = this.getSavedDeviceId();

    if (savedId) {
      console.log("[MobileObdBleService] Native BLE son cihaza bağlanıyor:", savedId);
      this.state.connecting = true;
      this.notifyListeners();
      try {
        await AuraNativeBle.connect({ deviceId: savedId });
        return;
      } catch (err) {
        console.warn("[MobileObdBleService] Native BLE son cihaz bağlantı hatası:", err);
      }
    }

    // Cihaz yoksa veya bağlantı başarısızsa BLE taraması yap
    this.state.connecting = true;
    this.notifyListeners();

    try {
      const scanRes = await AuraNativeBle.startScan();
      const devices = scanRes.devices || [];
      const obd = devices.find((d) =>
        OBD_NAME_HINTS.some((h) => d.name?.toUpperCase().includes(h)),
      ) || devices[0];

      if (obd && obd.deviceId) {
        this.saveDevice(obd.deviceId, obd.name);
        await AuraNativeBle.connect({ deviceId: obd.deviceId });
      } else {
        this.state.connecting = false;
        this.state.last_error = "OBD-II BLE cihazı bulunamadı. Lütfen kontağı açın.";
        this.notifyListeners();
      }
    } catch (err: any) {
      this.state.connecting = false;
      this.state.last_error = "BLE tarama hatası: " + (err?.message || err);
      this.notifyListeners();
    }
  }

  // =========================================================================
  // 2. TYPESCRIPT FALLBACK ENGINE (PRIORITY QUEUE & DİNAMİK BACKOFF)
  // Web, masaüstü veya native eklenti bulunmadığında devreye girer
  // =========================================================================
  private async runFallbackTsLoop(): Promise<void> {
    if (!this.isInitialized) {
      try {
        await BleClient.initialize();
        this.isInitialized = true;
      } catch (e: any) {
        this.state.last_error = "BLE başlatılamadı: " + (e?.message || e);
        this.state.connecting = false;
        this.notifyListeners();
        return;
      }
    }

    while (this.isRunning) {
      if (!this.state.connected) {
        this.state.connecting = true;
        this.notifyListeners();

        try {
          const device = await this.findOrSelectDevice();
          if (!device) {
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          }
          await this.connectAndStreamTsFallback(device);
        } catch (err: any) {
          this.state.connecting = false;
          this.state.last_error = err?.message || "Bağlantı hatası";
          this.notifyListeners();
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  private async findOrSelectDevice(): Promise<BleDevice | null> {
    const savedId = this.getSavedDeviceId();
    if (savedId) {
      return { deviceId: savedId, name: this.getSavedDeviceName() || "OBD-II Adaptör" };
    }

    return new Promise(async (resolve) => {
      let found: BleDevice | null = null;
      try {
        await BleClient.requestLEScan({}, (result) => {
          const name = result.localName || result.device.name || "";
          const isMatch = OBD_NAME_HINTS.some((hint) => name.toUpperCase().includes(hint));
          if (isMatch && !found) {
            found = result.device;
            BleClient.stopLEScan().catch(() => {});
            resolve(result.device);
          }
        });

        setTimeout(async () => {
          try {
            await BleClient.stopLEScan();
          } catch {}
          resolve(found);
        }, 3500);
      } catch {
        resolve(null);
      }
    });
  }

  private async connectAndStreamTsFallback(device: BleDevice) {
    this.connectedDeviceId = device.deviceId;
    await BleClient.connect(device.deviceId, (id) => {
      if (id === this.connectedDeviceId) {
        this.state.connected = false;
        this.state.connecting = false;
        this.notifyListeners();
      }
    }, { timeout: 6000 });

    this.saveDevice(device.deviceId, device.name);
    try {
      await BleClient.requestConnectionPriority(device.deviceId, ConnectionPriority.CONNECTION_PRIORITY_BALANCED);
    } catch {}

    const services = await BleClient.getServices(device.deviceId);
    this.detectUuids(services);

    this.notifyBuffer = "";
    await BleClient.startNotifications(device.deviceId, this.serviceUuid, this.notifyUuid, (value) => {
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
    });

    await this.initializeElm327Ts(device.deviceId);

    this.state.connected = true;
    this.state.connecting = false;
    this.state.last_error = null;
    this.lastSuccessTimestamp = Date.now();
    this.notifyListeners();

    // Priority Queue & Dinamik Timeout TS Döngüsü
    let slowCycle = 0;
    let lastSlowPoll = 0;

    while (this.isRunning && this.state.connected) {
      // 1. FAST LOOP (Yüksek Öncelik - Her Döngüde Kesintisiz 25-30+ FPS)
      await this.pollPidWithBackoff(device.deviceId, "010C", "0C", this.parseRpm, 130);
      await this.pollPidWithBackoff(device.deviceId, "010D", "0D", this.parseSpeed, 130);
      await this.pollPidWithBackoff(device.deviceId, "010B", "0B", this.parseMap, 130);
      await this.pollPidWithBackoff(device.deviceId, "0111", "11", this.parseThrottle, 130);
      await this.pollPidWithBackoff(device.deviceId, "0110", "10", this.parseMaf, 130);

      // 2. SLOW INTERLEAVED LOOP (Her 1.5 sn'de 1 yavaş PID, toplam tur ~7 sn)
      const now = Date.now();
      if (now - lastSlowPoll >= 1500) {
        switch (slowCycle % 5) {
          case 0:
            await this.pollPidWithBackoff(device.deviceId, "0105", "05", this.parseCoolant, 140);
            break;
          case 1:
            await this.pollPidWithBackoff(device.deviceId, "010F", "0F", this.parseIntakeTemp, 140);
            break;
          case 2:
            await this.pollPidWithBackoff(device.deviceId, "0104", "04", this.parseLoad, 140);
            break;
          case 3:
            await this.pollPidWithBackoff(device.deviceId, "0121", "21", this.parseDistance, 150);
            break;
          case 4:
            const volt = await this.queryBatteryVoltage(device.deviceId);
            if (volt !== null) this.state.battery_voltage = volt;
            break;
        }
        slowCycle++;
        lastSlowPoll = now;
      }

      this.updateCalculations();
      this.notifyListeners();

      // Müzik A2DP akışı için mikro aralık (12-16ms)
      await new Promise((r) => setTimeout(r, 14));

      if (this.consecutiveErrors >= 9 || (this.lastSuccessTimestamp > 0 && now - this.lastSuccessTimestamp > 5000)) {
        console.warn("[MobileObdBleService] TS veri akışı koptu, yeniden bağlanılıyor...");
        this.state.connected = false;
        this.notifyListeners();
        break;
      }
    }
  }

  private detectUuids(services: any[]) {
    for (const s of services) {
      const sUuid = s.uuid.toLowerCase();
      if (sUuid.includes("fff0") || sUuid.includes("ffe0") || sUuid.includes("18f0") || sUuid.includes("ae00") || sUuid.includes("e7810a70")) {
        this.serviceUuid = s.uuid;
        for (const c of s.characteristics) {
          const cUuid = c.uuid.toLowerCase();
          if (cUuid.includes("fff1") || cUuid.includes("ffe1") || cUuid.includes("ae02") || cUuid.includes("e7810a71")) {
            this.notifyUuid = c.uuid;
          }
          if (cUuid.includes("fff2") || cUuid.includes("ffe1") || cUuid.includes("ae01") || cUuid.includes("e7810a72")) {
            this.writeUuid = c.uuid;
            this.canWriteWithoutResponse = !!c.properties?.writeWithoutResponse;
          }
        }
      }
    }
  }

  private async initializeElm327Ts(deviceId: string) {
    const initCommands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATST64", "ATAL", "ATSP5"];
    for (const cmd of initCommands) {
      await this.sendCommand(deviceId, cmd, 600);
      await new Promise((r) => setTimeout(r, cmd === "ATZ" ? 700 : 20));
    }
  }

  private sendCommand(deviceId: string, command: string, timeoutMs = 135): Promise<string> {
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
        finish(""); // Dinamik Timeout: Beklemeden DROP et
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

  /**
   * Dinamik Timeout (120-150ms) ve Exponential Backoff ile PID Sorgulama
   */
  private async pollPidWithBackoff(
    deviceId: string,
    command: string,
    pidHex: string,
    parser: (bytes: number[]) => number | null,
    timeoutMs = 135,
  ): Promise<void> {
    const now = Date.now();
    const backoffUntil = this.pidBackoffUntil.get(command);
    if (backoffUntil && now < backoffUntil) {
      return; // Exponential backoff aktif: hattı tıkamadan anında geç
    }

    const raw = await this.sendCommand(deviceId, command, timeoutMs);
    const payload = this.extractPayload(raw, pidHex);

    if (payload) {
      this.pidTimeoutCounts.set(command, 0);
      this.pidBackoffUntil.delete(command);
      this.consecutiveErrors = 0;
      this.lastSuccessTimestamp = now;
      const val = parser(payload);

      // İlgili state'i güncelle
      switch (pidHex) {
        case "0C": if (val !== null) this.state.rpm = val; break;
        case "0D": if (val !== null) this.state.speed_kmh = val; break;
        case "0B": if (val !== null) this.state.map_kpa = val; break;
        case "11": if (val !== null) this.state.throttle_percent = val; break;
        case "10": if (val !== null) this.state.maf_gps = val; break;
        case "05": if (val !== null) this.state.coolant_temp_c = val; break;
        case "0F": if (val !== null) this.state.intake_temp_c = val; break;
        case "04": if (val !== null) this.state.load_percent = val; break;
        case "21": if (val !== null) this.state.distance_mil_on = val; break;
      }
    } else {
      // Timeout veya geçersiz yanıt
      const timeouts = (this.pidTimeoutCounts.get(command) || 0) + 1;
      this.pidTimeoutCounts.set(command, timeouts);
      this.consecutiveErrors++;

      if (timeouts >= 3) {
        const delay = timeouts === 3 ? 600 : timeouts === 4 ? 1500 : 4000;
        this.pidBackoffUntil.set(command, now + delay);
      }
    }
  }

  private extractPayload(rawText: string, pidHex: string): number[] | null {
    if (!rawText) return null;
    const normalized = rawText.toUpperCase().replace(/[^0-9A-F]/g, "");
    const marker = `41${pidHex}`;
    const pos = normalized.indexOf(marker);
    if (pos === -1) return null;

    const tail = normalized.slice(pos + marker.length);
    const bytesNeeded: Record<string, number> = {
      "0C": 2, "0D": 1, "05": 1, "10": 2, "04": 1, "0B": 1, "0F": 1, "11": 1, "21": 2,
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

  private parseRpm = (b: number[]) => Math.round(((b[0] * 256) + b[1]) / 4);
  private parseSpeed = (b: number[]) => b[0];
  private parseCoolant = (b: number[]) => b[0] - 40;
  private parseMaf = (b: number[]) => Math.round((((b[0] * 256) + b[1]) / 100) * 100) / 100;
  private parseLoad = (b: number[]) => Math.round(((b[0] * 100) / 255) * 10) / 10;
  private parseIntakeTemp = (b: number[]) => b[0] - 40;
  private parseThrottle = (b: number[]) => Math.round(((b[0] * 100) / 255) * 10) / 10;
  private parseMap = (b: number[]) => b[0];
  private parseDistance = (b: number[]) => (b[0] * 256) + b[1];

  private updateCalculations() {
    // Turbo Boost Hesabı
    if (this.state.map_kpa !== null) {
      const boost = (this.state.map_kpa - 101.3) / 100.0;
      this.state.turbo_boost_bar = Math.max(0, Math.round(boost * 100) / 100);
    }

    // Dizel Yakıt Modeli (1ND-TV)
    if (this.state.maf_gps !== null) {
      const spd = this.state.speed_kmh ?? 0;
      const thr = this.state.throttle_percent ?? 0;
      const rpm = this.state.rpm ?? 850;

      if (spd > 15 && thr < 2.0 && rpm > 1150) {
        this.state.fuel_display = 0.0;
        this.state.fuel_unit = "L/100km";
        this.state.fuel_rate_lph = 0.0;
      } else {
        const clampedLoad = Math.max(0, Math.min(100, this.state.load_percent ?? 20));
        const loadFactor = Math.pow(1.0 - clampedLoad / 100.0, 3.0);
        const effectiveAfr = MIN_DIESEL_AFR + (MAX_DIESEL_AFR - MIN_DIESEL_AFR) * loadFactor;

        const fuelMassGps = this.state.maf_gps / effectiveAfr;
        const litersPerHour = (fuelMassGps * 3600.0) / DIESEL_DENSITY_G_PER_L;

        if (spd > 5.0) {
          const lPer100 = (litersPerHour / spd) * 100.0;
          this.state.fuel_display = Math.min(35.0, Math.round(lPer100 * 100) / 100);
          this.state.fuel_unit = "L/100km";
        } else {
          this.state.fuel_display = Math.round(litersPerHour * 100) / 100;
          this.state.fuel_unit = "L/h";
        }
        this.state.fuel_rate_lph = Math.round(litersPerHour * 1000) / 1000;
      }
    }

    this.state.updated_at = String(Date.now());
  }

  public async queryBatteryVoltage(deviceId?: string): Promise<number | null> {
    if (this.isNativeBridge) {
      try {
        const res = await AuraNativeBle.sendCustomCommand({ command: "ATRV", timeout: 200 });
        const match = (res.response || "").match(/(\d+\.?\d*)\s*V?/i);
        if (match && match[1]) {
          const val = parseFloat(match[1]);
          if (!isNaN(val) && val >= 5.0 && val <= 18.0) return Math.round(val * 10) / 10;
        }
      } catch {}
      return null;
    }

    const targetId = deviceId || this.connectedDeviceId;
    if (!targetId || !this.state.connected) return null;
    try {
      const raw = await this.sendCommand(targetId, "ATRV", 250);
      const match = raw.match(/(\d+\.?\d*)\s*V?/i);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        if (!isNaN(val) && val >= 5.0 && val <= 18.0) return Math.round(val * 10) / 10;
      }
    } catch {}
    return null;
  }

  public async readDtcCodes(): Promise<DtcItem[]> {
    let raw = "";
    if (this.isNativeBridge) {
      const res = await AuraNativeBle.sendCustomCommand({ command: "03", timeout: 1200 });
      raw = res.response || "";
    } else {
      if (!this.connectedDeviceId || !this.state.connected) throw new Error("OBD-II adaptörü bağlı değil");
      raw = await this.sendCommand(this.connectedDeviceId, "03", 1200);
    }

    const normalized = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
    const pos = normalized.indexOf("43");
    if (pos === -1) return [];

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
      if (systemBits === 1) { prefix = "C"; systemType = "Şasi"; }
      else if (systemBits === 2) { prefix = "B"; systemType = "Gövde"; }
      else if (systemBits === 3) { prefix = "U"; systemType = "Ağ"; }

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
  }

  public async clearDtcCodes(): Promise<boolean> {
    let raw = "";
    if (this.isNativeBridge) {
      const res = await AuraNativeBle.sendCustomCommand({ command: "04", timeout: 1500 });
      raw = res.response || "";
    } else {
      if (!this.connectedDeviceId || !this.state.connected) throw new Error("OBD-II adaptörü bağlı değil");
      raw = await this.sendCommand(this.connectedDeviceId, "04", 1500);
    }

    const normalized = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
    const isSuccess = normalized.includes("44") || normalized.includes("OK");
    if (isSuccess) {
      this.state.distance_mil_on = 0;
      this.notifyListeners();
    }
    return isSuccess;
  }

  private saveDevice(deviceId: string, name?: string) {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_DEVICE_ID, deviceId);
      if (name) localStorage.setItem(STORAGE_KEY_LAST_DEVICE_NAME, name);
    } catch {}
  }

  public getSavedDeviceId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_DEVICE_ID);
    } catch {
      return null;
    }
  }

  public getSavedDeviceName(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_DEVICE_NAME);
    } catch {
      return null;
    }
  }
}

export const obdBleService = MobileObdBleService.getInstance();
