import { registerPlugin, Capacitor } from "@capacitor/core";

export interface AuraBackgroundPluginInterface {
  startForegroundService(options?: {
    title?: string;
    body?: string;
  }): Promise<{ success: boolean; running: boolean }>;
  updateNotification(options: {
    title: string;
    body: string;
  }): Promise<{ success: boolean }>;
  stopForegroundService(): Promise<{ success: boolean; running: boolean }>;
  isServiceRunning(): Promise<{ running: boolean }>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ success: boolean }>;
  enterPipMode(): Promise<{ success: boolean; error?: string }>;
  isPipSupported(): Promise<{ supported: boolean }>;
  setAutoPip(options: { enable: boolean }): Promise<{ autoPip: boolean }>;
}

const AuraBackground = registerPlugin<AuraBackgroundPluginInterface>("AuraBackground");

class BackgroundServiceManager {
  private static instance: BackgroundServiceManager;
  private isNative: boolean = false;
  private isRunning: boolean = false;
  private lastNotificationUpdate = 0;
  private pendingUpdateTimeout: any = null;
  private latestTitle: string = "";
  private latestBody: string = "";

  private audioCtx: any = null;
  private oscillator: any = null;
  private gainNode: any = null;

  private constructor() {
    this.isNative = typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  public static getInstance(): BackgroundServiceManager {
    if (!BackgroundServiceManager.instance) {
      BackgroundServiceManager.instance = new BackgroundServiceManager();
    }
    return BackgroundServiceManager.instance;
  }

  /**
   * Android Chromium WebView'in arka plandayken JavaScript zamanlayıcılarını (setTimeout/setInterval)
   * ve BLE/GPS döngülerini uyutmasını/kısıtlamasını engelleyen inaudible (duyulmaz) keep-alive mekanizması.
   * Kullanıcının Spotify / Navigasyon dinlemesini ASLA bozmaz (ses seviyesi 0.00001).
   */
  public startKeepAlive() {
    if (typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === "suspended") {
        void this.audioCtx.resume();
      }
      if (!this.oscillator && this.audioCtx) {
        this.oscillator = this.audioCtx.createOscillator();
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.setValueAtTime(0.00001, this.audioCtx.currentTime);
        this.oscillator.type = "sine";
        this.oscillator.frequency.setValueAtTime(220, this.audioCtx.currentTime);
        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.audioCtx.destination);
        this.oscillator.start();
        console.log("[BackgroundService] WebView arka plan zamanlayıcı koruması aktif 🛡️");
      }
    } catch (e) {
      console.warn("[BackgroundService] Keep-alive sesi başlatılamadı:", e);
    }
  }

  public stopKeepAlive() {
    try {
      if (this.oscillator) {
        this.oscillator.stop();
        this.oscillator.disconnect();
        this.oscillator = null;
      }
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
      if (this.audioCtx) {
        void this.audioCtx.close();
        this.audioCtx = null;
      }
    } catch {
      // Ignore
    }
  }

  public async start(title = "AuraDrive Pro — Sürüş Aktif ⚡", body = "Telemetri ve yol bilgisayarı arka planda çalışıyor..."): Promise<boolean> {
    this.startKeepAlive();

    if (!this.isNative) {
      console.log("[BackgroundService] Web ortamında arka plan simüle edildi");
      this.isRunning = true;
      return true;
    }

    try {
      const res = await AuraBackground.startForegroundService({ title, body });
      this.isRunning = res.running;
      return res.success;
    } catch (err) {
      console.warn("[BackgroundService] Başlatma hatası:", err);
      return false;
    }
  }

  public async updateNotification(title: string, body: string, throttleMs = 1200): Promise<void> {
    if (!this.isNative || !this.isRunning) return;

    this.latestTitle = title;
    this.latestBody = body;

    const now = Date.now();
    if (now - this.lastNotificationUpdate >= throttleMs) {
      this.lastNotificationUpdate = now;
      try {
        await AuraBackground.updateNotification({ title, body });
      } catch (err) {
        console.warn("[BackgroundService] Bildirim güncelleme hatası:", err);
      }
    } else {
      if (!this.pendingUpdateTimeout) {
        this.pendingUpdateTimeout = setTimeout(async () => {
          this.pendingUpdateTimeout = null;
          this.lastNotificationUpdate = Date.now();
          try {
            await AuraBackground.updateNotification({
              title: this.latestTitle,
              body: this.latestBody,
            });
          } catch {
            // Ignore
          }
        }, throttleMs - (now - this.lastNotificationUpdate));
      }
    }
  }

  public async stop(): Promise<boolean> {
    this.stopKeepAlive();

    if (this.pendingUpdateTimeout) {
      clearTimeout(this.pendingUpdateTimeout);
      this.pendingUpdateTimeout = null;
    }

    if (!this.isNative) {
      this.isRunning = false;
      return true;
    }

    try {
      const res = await AuraBackground.stopForegroundService();
      this.isRunning = res.running;
      return res.success;
    } catch (err) {
      console.warn("[BackgroundService] Durdurma hatası:", err);
      return false;
    }
  }

  public async isServiceActive(): Promise<boolean> {
    if (!this.isNative) return this.isRunning;
    try {
      const res = await AuraBackground.isServiceRunning();
      this.isRunning = res.running;
      return res.running;
    } catch {
      return false;
    }
  }

  public async checkBatteryOptimization(): Promise<boolean> {
    if (!this.isNative) return true;
    try {
      const res = await AuraBackground.isIgnoringBatteryOptimizations();
      return res.ignoring;
    } catch {
      return false;
    }
  }

  public async requestBatteryOptimizationExemption(): Promise<void> {
    if (!this.isNative) {
      alert("Pil optimizasyonu muafiyeti yalnızca Android cihazlarda gereklidir.");
      return;
    }
    try {
      await AuraBackground.requestIgnoreBatteryOptimizations();
    } catch (err) {
      console.warn("[BackgroundService] Pil optimizasyon isteği hatası:", err);
    }
  }

  public async enterPip(): Promise<boolean> {
    if (!this.isNative) return false;
    try {
      const res = await AuraBackground.enterPipMode();
      return res.success;
    } catch (err) {
      console.warn("[BackgroundService] enterPip hatası:", err);
      return false;
    }
  }

  public async setAutoPip(enable: boolean): Promise<void> {
    if (!this.isNative) return;
    try {
      await AuraBackground.setAutoPip({ enable });
    } catch {
      // Ignore
    }
  }

  public async isPipSupported(): Promise<boolean> {
    if (!this.isNative) return false;
    try {
      const res = await AuraBackground.isPipSupported();
      return res.supported;
    } catch {
      return false;
    }
  }
}

export const backgroundService = BackgroundServiceManager.getInstance();
