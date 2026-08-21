"use client";

import { animate, motion } from "framer-motion";
import useSWR from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { obdBleService, type TelemetryState } from "./services/obd-ble.service";

type DashboardTab = "surus" | "trip" | "performans" | "motor" | "saglik";

type ScreenWakeLock = {
  release: () => Promise<void>;
  addEventListener: (
    type: "release",
    listener: () => void,
    options?: boolean | { once?: boolean },
  ) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<ScreenWakeLock>;
  };
};

type LiveData = {
  connected: boolean;
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
  fuel_rate_lph?: number | null;
  last_error: string | null;
  updated_at: string | null;
};

type TripData = {
  distanceKm: number;
  fuelLiters: number;
  durationMs: number;
  movingDurationMs: number;
  maxSpeed: number;
  startTime: number;
};

type PerformanceData = {
  status: "idle" | "ready" | "timing" | "finished";
  startTime: number | null;
  t50: number | null;
  t100: number | null;
  best0_100: number | null;
  peakBoost: number;
};

const DEFAULT_TRIP: TripData = {
  distanceKm: 0,
  fuelLiters: 0,
  durationMs: 0,
  movingDurationMs: 0,
  maxSpeed: 0,
  startTime: Date.now(),
};

const DEFAULT_PERF: PerformanceData = {
  status: "idle",
  startTime: null,
  t50: null,
  t100: null,
  best0_100: null,
  peakBoost: 0,
};

const STORAGE_KEY_TRIP = "auradrive_trip_v3";
const STORAGE_KEY_PERF = "auradrive_perf_v3";
const STORAGE_KEY_FUEL_PRICE = "auradrive_fuel_price_v3";
const DEFAULT_FUEL_PRICE = 44.5; // TL / Litre (Euro Diesel)
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";

const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
  { id: "surus", label: "SÜRÜŞ" },
  { id: "trip", label: "TRİP" },
  { id: "performans", label: "PERFORMANS" },
  { id: "motor", label: "MOTOR" },
  { id: "saglik", label: "SAĞLIK" },
];

const fetcher = async (url: string): Promise<LiveData> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("live-data fetch failed");
  }
  return response.json();
};

function SmoothNumber({
  value,
  digits,
  fallback = "--",
  fast = false,
}: {
  value: number | null | undefined;
  digits: number;
  fallback?: string;
  fast?: boolean;
}) {
  const [display, setDisplay] = useState<number>(value ?? 0);
  const previousRef = useRef<number>(value ?? 0);

  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return;
    }
    if (fast) {
      setDisplay(value);
      previousRef.current = value;
      return;
    }
    const controls = animate(previousRef.current, value, {
      duration: 0.1,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(latest),
    });
    previousRef.current = value;
    return () => controls.stop();
  }, [value, fast]);

  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span>{fallback}</span>;
  }

  return <span>{display.toFixed(digits)}</span>;
}

function formatTrip(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "--";
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function useLandscape() {
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(orientation: landscape)");

    const updateOrientation = () => {
      setIsLandscape(mediaQuery.matches);
    };

    updateOrientation();
    mediaQuery.addEventListener("change", updateOrientation);
    window.addEventListener("resize", updateOrientation);

    return () => {
      mediaQuery.removeEventListener("change", updateOrientation);
      window.removeEventListener("resize", updateOrientation);
    };
  }, []);

  return isLandscape;
}

export default function Home() {
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform();

  // Web / Dev ortamı için SWR
  const { data: apiData, error: apiError } = useSWR(
    !isNative ? `${API_BASE}/live-data` : null,
    fetcher,
    {
      refreshInterval: 250,
      dedupingInterval: 80,
      revalidateOnFocus: false,
    },
  );

  // Native Mobil için BLE State
  const [nativeData, setNativeData] = useState<TelemetryState | null>(null);

  useEffect(() => {
    if (!isNative) return;
    const unsubscribe = obdBleService.subscribe((newState) => {
      setNativeData({ ...newState });
    });
    void obdBleService.start();
    return () => {
      unsubscribe();
    };
  }, [isNative]);

  const data = isNative ? nativeData : apiData;
  const error = isNative ? (nativeData?.last_error ? new Error(nativeData.last_error) : null) : apiError;

  const [activeTab, setActiveTab] = useState<DashboardTab>("surus");
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);
  const [wakeLockSupported, setWakeLockSupported] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<ScreenWakeLock | null>(null);
  const isLandscape = useLandscape();
  const isPortrait = !isLandscape;

  // ----------------------------------------------------
  // YAKIT FİYATI (TL / Litre)
  // ----------------------------------------------------
  const [fuelPrice, setFuelPrice] = useState<number>(DEFAULT_FUEL_PRICE);
  const [isFuelModalOpen, setIsFuelModalOpen] = useState(false);
  const [fuelPriceInput, setFuelPriceInput] = useState<string>(String(DEFAULT_FUEL_PRICE));

  useEffect(() => {
    try {
      const savedPrice = localStorage.getItem(STORAGE_KEY_FUEL_PRICE);
      if (savedPrice) {
        const val = parseFloat(savedPrice);
        if (!Number.isNaN(val) && val > 0) {
          setFuelPrice(val);
          setFuelPriceInput(String(val));
        }
      }
    } catch {
      // LocalStorage ignore
    }
  }, []);

  const saveFuelPrice = (price: number) => {
    const validPrice = Math.max(1, Math.round(price * 100) / 100);
    setFuelPrice(validPrice);
    setFuelPriceInput(String(validPrice));
    setIsFuelModalOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY_FUEL_PRICE, String(validPrice));
    } catch {
      // Ignore
    }
  };

  const adjustFuelPrice = (delta: number) => {
    const current = parseFloat(fuelPriceInput) || fuelPrice;
    const nextVal = Math.max(1, Math.round((current + delta) * 100) / 100);
    setFuelPriceInput(String(nextVal));
  };

  // ----------------------------------------------------
  // TRIP COMPUTER MOTORU
  // ----------------------------------------------------
  const [trip, setTrip] = useState<TripData>(DEFAULT_TRIP);
  const lastUpdateRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TRIP);
      if (saved) {
        setTrip(JSON.parse(saved));
      }
    } catch {
      // LocalStorage ignore
    }
  }, []);

  useEffect(() => {
    if (!data?.connected) {
      lastUpdateRef.current = null;
      return;
    }

    const now = Date.now();
    if (lastUpdateRef.current === null) {
      lastUpdateRef.current = now;
      return;
    }

    const deltaSeconds = (now - lastUpdateRef.current) / 1000;
    lastUpdateRef.current = now;

    if (deltaSeconds <= 0 || deltaSeconds > 3.0) {
      return;
    }

    const speed = data.speed_kmh ?? 0;
    const deltaDistanceKm = (speed * deltaSeconds) / 3600;

    let fuelRateLph = data.fuel_rate_lph;
    if (fuelRateLph === undefined || fuelRateLph === null) {
      if (data.fuel_unit === "L/h" && data.fuel_display !== null) {
        fuelRateLph = data.fuel_display;
      } else if (data.fuel_unit === "L/100km" && data.fuel_display !== null && speed > 0) {
        fuelRateLph = (data.fuel_display * speed) / 100;
      } else {
        fuelRateLph = 0;
      }
    }

    const deltaFuelLiters = (fuelRateLph * deltaSeconds) / 3600;
    const deltaDurationMs = deltaSeconds * 1000;
    const deltaMovingMs = speed > 1.5 ? deltaDurationMs : 0;

    setTrip((prev) => {
      const updated: TripData = {
        distanceKm: prev.distanceKm + deltaDistanceKm,
        fuelLiters: prev.fuelLiters + deltaFuelLiters,
        durationMs: prev.durationMs + deltaDurationMs,
        movingDurationMs: prev.movingDurationMs + deltaMovingMs,
        maxSpeed: Math.max(prev.maxSpeed, speed),
        startTime: prev.startTime || now,
      };

      try {
        localStorage.setItem(STORAGE_KEY_TRIP, JSON.stringify(updated));
      } catch {
        // Save error
      }

      return updated;
    });
  }, [data]);

  const resetTrip = () => {
    const fresh: TripData = {
      distanceKm: 0,
      fuelLiters: 0,
      durationMs: 0,
      movingDurationMs: 0,
      maxSpeed: 0,
      startTime: Date.now(),
    };
    setTrip(fresh);
    lastUpdateRef.current = null;
    try {
      localStorage.setItem(STORAGE_KEY_TRIP, JSON.stringify(fresh));
    } catch {
      // Clear error
    }
  };

  // ----------------------------------------------------
  // PERFORMANS & 0-100 DRAG MOTORU
  // ----------------------------------------------------
  const [perf, setPerf] = useState<PerformanceData>(DEFAULT_PERF);
  const dragStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PERF);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPerf((prev) => ({
          ...prev,
          best0_100: parsed.best0_100 ?? null,
          peakBoost: parsed.peakBoost ?? 0,
        }));
      }
    } catch {
      // Ignore
    }
  }, []);

  const speed = data?.speed_kmh ?? null;
  const turboBoost = data?.turbo_boost_bar ?? null;

  // Peak Boost Takibi
  useEffect(() => {
    if (turboBoost !== null && turboBoost > perf.peakBoost) {
      setPerf((prev) => {
        const updated = { ...prev, peakBoost: turboBoost };
        try {
          localStorage.setItem(
            STORAGE_KEY_PERF,
            JSON.stringify({ best0_100: updated.best0_100, peakBoost: updated.peakBoost }),
          );
        } catch {
          // Ignore
        }
        return updated;
      });
    }
  }, [turboBoost, perf.peakBoost]);

  // 0-100 Hızlanma Algoritması
  useEffect(() => {
    if (speed === null) return;

    if (speed <= 0.8) {
      if (perf.status !== "ready" && perf.status !== "finished") {
        setPerf((prev) => ({ ...prev, status: "ready", startTime: null }));
        dragStartTimeRef.current = null;
      }
    } else if (speed > 1.5 && (perf.status === "ready" || perf.status === "idle")) {
      const now = Date.now();
      dragStartTimeRef.current = now;
      setPerf((prev) => ({
        ...prev,
        status: "timing",
        startTime: now,
        t50: null,
        t100: null,
      }));
    } else if (perf.status === "timing" && dragStartTimeRef.current !== null) {
      const elapsed = (Date.now() - dragStartTimeRef.current) / 1000;

      if (speed >= 50 && perf.t50 === null) {
        setPerf((prev) => ({ ...prev, t50: elapsed }));
      }

      if (speed >= 100 && perf.t100 === null) {
        const best = perf.best0_100 ? Math.min(perf.best0_100, elapsed) : elapsed;
        setPerf((prev) => {
          const updated = {
            ...prev,
            status: "finished" as const,
            t100: elapsed,
            best0_100: best,
          };
          try {
            localStorage.setItem(
              STORAGE_KEY_PERF,
              JSON.stringify({ best0_100: updated.best0_100, peakBoost: updated.peakBoost }),
            );
          } catch {
            // Ignore
          }
          return updated;
        });
      }
    }
  }, [speed, perf.status, perf.t50, perf.t100, perf.best0_100]);

  const resetPerformance = () => {
    dragStartTimeRef.current = null;
    setPerf((prev) => ({
      ...prev,
      status: "idle",
      startTime: null,
      t50: null,
      t100: null,
      peakBoost: 0,
    }));
    try {
      localStorage.setItem(
        STORAGE_KEY_PERF,
        JSON.stringify({ best0_100: perf.best0_100, peakBoost: 0 }),
      );
    } catch {
      // Ignore
    }
  };

  // ----------------------------------------------------
  // TÜRETİLMİŞ HESAPLAMALAR (Dizel Tork, Güç, Maliyet)
  // ----------------------------------------------------
  const rpm = data?.rpm ?? null;
  const maf = data?.maf_gps ?? null;
  const coolant = data?.coolant_temp_c ?? null;
  const load = data?.load_percent ?? null;
  const intakeTemp = data?.intake_temp_c ?? null;
  const throttle = data?.throttle_percent ?? null;
  const map = data?.map_kpa ?? null;
  const fuel = data?.fuel_display ?? null;
  const fuelUnit = data?.fuel_unit ?? "--";

  // Ortalama Değerler
  const avgFuelL100km = useMemo(() => {
    if (trip.distanceKm >= 0.05 && trip.fuelLiters > 0) {
      return (trip.fuelLiters * 100) / trip.distanceKm;
    }
    return null;
  }, [trip.distanceKm, trip.fuelLiters]);

  const avgSpeedKmh = useMemo(() => {
    if (trip.durationMs > 2000 && trip.distanceKm > 0) {
      const hours = trip.durationMs / 3600000;
      return trip.distanceKm / hours;
    }
    return null;
  }, [trip.distanceKm, trip.durationMs]);

  // Maliyet Hesapları (TL)
  const tripTotalCostTL = useMemo(() => {
    return trip.fuelLiters * fuelPrice;
  }, [trip.fuelLiters, fuelPrice]);

  const instantCostTLPerKm = useMemo(() => {
    if (fuelUnit === "L/100km" && fuel !== null && fuel > 0) {
      return (fuel * fuelPrice) / 100;
    }
    return null;
  }, [fuel, fuelUnit, fuelPrice]);

  const instantCostTLPerHour = useMemo(() => {
    if (fuelUnit === "L/h" && fuel !== null && fuel > 0) {
      return fuel * fuelPrice;
    }
    return null;
  }, [fuel, fuelUnit, fuelPrice]);

  // 2006 Toyota 1.4 D-4D (90 HP / 190 Nm) Tahmini Anlık Güç ve Tork
  const estimatedTorqueNm = useMemo(() => {
    if (load === null || rpm === null || rpm < 500) return 0;
    // 1ND-TV motoru 1800-3000 RPM arası pik 190 Nm verir
    const rpmFactor = rpm >= 1700 && rpm <= 3200 ? 1.0 : rpm < 1700 ? 0.75 + (0.25 * ((rpm - 750) / 950)) : Math.max(0.65, 1.0 - ((rpm - 3200) / 2000));
    return Math.round((load / 100) * 190 * Math.max(0.1, rpmFactor));
  }, [load, rpm]);

  const estimatedHorsepower = useMemo(() => {
    if (estimatedTorqueNm === 0 || rpm === null) return 0;
    // HP = (Torque(Nm) * RPM) / 7127
    const hp = (estimatedTorqueNm * rpm) / 7127;
    return Math.min(95, Math.round(hp));
  }, [estimatedTorqueNm, rpm]);

  // ----------------------------------------------------
  // AKILLI MOTOR & TURBO KORUMA ASİSTANI
  // ----------------------------------------------------
  const smartAlert = useMemo(() => {
    if (!data?.connected) return null;

    // 1. Hararet Uyarısı
    if (coolant !== null && coolant >= 98) {
      return {
        type: "danger",
        title: "YÜKSEK MOTOR SICAKLIĞI",
        text: `Soğutma suyu ${coolant}°C! Yükü hafifletin ve rölantide soğumasını bekleyin.`,
      };
    }

    // 2. Soğuk Motor & Turbo Koruma Uyarısı
    if (coolant !== null && coolant < 70) {
      return {
        type: "warning",
        title: "MOTOR ISINIYOR (SOĞUK)",
        text: `Su sıcaklığı ${coolant}°C. Yüksek devir ve sert boost yapmaktan kaçının.`,
      };
    }

    // 3. Optimum Vites Yükseltme Tavsiyesi (Shift Light)
    if (rpm !== null && rpm >= 2200 && (load ?? 0) > 25 && (speed ?? 0) > 20) {
      return {
        type: "info",
        title: "VİTES YÜKSELT (SHIFT UP)",
        text: "Optimum tork ve yakıt tasarrufu için bir üst vitese geçebilirsiniz.",
      };
    }

    return null;
  }, [data?.connected, coolant, rpm, load, speed]);

  // ----------------------------------------------------
  // WAKE LOCK (Ekranı Açık Tutma)
  // ----------------------------------------------------
  useEffect(() => {
    setWakeLockSupported(Boolean((navigator as NavigatorWithWakeLock).wakeLock));
  }, []);

  useEffect(() => {
    const releaseWakeLock = async () => {
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      setWakeLockActive(false);

      if (!lock) return;
      try {
        await lock.release();
      } catch {
        // Ignore
      }
    };

    const requestWakeLock = async () => {
      const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!wakeLock) {
        setWakeLockEnabled(false);
        setWakeLockActive(false);
        return;
      }

      if (document.visibilityState !== "visible") return;

      try {
        const lock = await wakeLock.request("screen");
        wakeLockRef.current = lock;
        setWakeLockActive(true);
        lock.addEventListener(
          "release",
          () => {
            if (wakeLockRef.current === lock) {
              wakeLockRef.current = null;
              setWakeLockActive(false);
            }
          },
          { once: true },
        );
      } catch {
        setWakeLockActive(false);
      }
    };

    if (!wakeLockEnabled || !data?.connected || !wakeLockSupported) {
      void releaseWakeLock();
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      } else {
        void releaseWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void requestWakeLock();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [data?.connected, wakeLockEnabled, wakeLockSupported]);

  const toggleWakeLock = async () => {
    if (!wakeLockSupported) return;
    setWakeLockEnabled((prev) => !prev);
  };

  const rpmPercent = Math.max(0, Math.min(100, ((rpm ?? 0) / 5000) * 100));
  const boostPercent = Math.max(0, Math.min(100, ((turboBoost ?? 0) / 1.5) * 100));

  const statusLabel = error
    ? "Bağlantı Yok"
    : data?.connected
      ? "Canlı Telemetri"
      : "Bağlanıyor...";

  const activeMetrics = useMemo(() => {
    switch (activeTab) {
      case "surus":
        return [
          {
            label: "Anlık Tüketim",
            value: <SmoothNumber value={fuel} digits={2} />,
            unit: fuelUnit,
          },
          {
            label: "Anlık Maliyet",
            value: (
              <SmoothNumber
                value={instantCostTLPerKm ?? instantCostTLPerHour}
                digits={2}
              />
            ),
            unit: instantCostTLPerKm ? "₺/km" : "₺/saat",
          },
          {
            label: "Trip Mesafesi",
            value: <SmoothNumber value={trip.distanceKm} digits={2} />,
            unit: "km",
          },
          {
            label: "Toplam Yakıt Tutarı",
            value: <SmoothNumber value={tripTotalCostTL} digits={2} />,
            unit: "₺",
          },
          {
            label: "Ortalama Tüketim",
            value: <SmoothNumber value={avgFuelL100km} digits={2} />,
            unit: "L/100km",
          },
          {
            label: "Ortalama Hız",
            value: <SmoothNumber value={avgSpeedKmh} digits={0} />,
            unit: "km/h",
          },
        ];

      case "trip":
        return [
          {
            label: "Kat Edilen Yol",
            value: <SmoothNumber value={trip.distanceKm} digits={2} />,
            unit: "km",
          },
          {
            label: "Harcanan Yakıt",
            value: <SmoothNumber value={trip.fuelLiters} digits={2} />,
            unit: "Litre",
          },
          {
            label: "Toplam Masraf",
            value: <SmoothNumber value={tripTotalCostTL} digits={2} />,
            unit: "₺",
          },
          {
            label: "Ortalama Tüketim",
            value: <SmoothNumber value={avgFuelL100km} digits={2} />,
            unit: "L/100km",
          },
          {
            label: "Ortalama Hız",
            value: <SmoothNumber value={avgSpeedKmh} digits={0} />,
            unit: "km/h",
          },
          {
            label: "Maksimum Hız",
            value: <SmoothNumber value={trip.maxSpeed} digits={0} />,
            unit: "km/h",
          },
          {
            label: "Sürüş Süresi",
            value: formatTrip(trip.durationMs),
            unit: "",
          },
          {
            label: "Hareket Süresi",
            value: formatTrip(trip.movingDurationMs),
            unit: "",
          },
        ];

      case "performans":
        return [
          {
            label: "0-100 km/h Süresi",
            value: perf.t100 ? `${perf.t100.toFixed(2)}s` : perf.status === "timing" ? "Ölçülüyor..." : perf.status === "ready" ? "Hazır" : "--",
            unit: "",
          },
          {
            label: "En İyi 0-100 (PB)",
            value: perf.best0_100 ? `${perf.best0_100.toFixed(2)}s` : "--",
            unit: "",
          },
          {
            label: "0-50 km/h Süresi",
            value: perf.t50 ? `${perf.t50.toFixed(2)}s` : "--",
            unit: "",
          },
          {
            label: "Peak Turbo Boost",
            value: <SmoothNumber value={perf.peakBoost} digits={2} />,
            unit: "Bar",
          },
          {
            label: "Tahmini Tork",
            value: <SmoothNumber value={estimatedTorqueNm} digits={0} />,
            unit: "Nm",
          },
          {
            label: "Tahmini Güç",
            value: <SmoothNumber value={estimatedHorsepower} digits={0} />,
            unit: "HP",
          },
        ];

      case "motor":
        return [
          {
            label: "Motor Devri (RPM)",
            value: <SmoothNumber value={rpm} digits={0} />,
            unit: "d/d",
          },
          {
            label: "Soğutma Suyu",
            value: <SmoothNumber value={coolant} digits={0} />,
            unit: "°C",
          },
          {
            label: "Hava Akışı (MAF)",
            value: <SmoothNumber value={maf} digits={2} />,
            unit: "g/s",
          },
          {
            label: "Motor Yükü",
            value: <SmoothNumber value={load} digits={1} />,
            unit: "%",
          },
          {
            label: "Emme Sıcaklığı (IAT)",
            value: <SmoothNumber value={intakeTemp} digits={0} />,
            unit: "°C",
          },
          {
            label: "Gaz Pedalı Pozisyonu",
            value: <SmoothNumber value={throttle} digits={1} />,
            unit: "%",
          },
          {
            label: "Manifold Basıncı (MAP)",
            value: <SmoothNumber value={map} digits={0} />,
            unit: "kPa",
          },
          {
            label: "Turbo Boost",
            value: <SmoothNumber value={turboBoost} digits={2} />,
            unit: "Bar",
          },
        ];

      case "saglik":
        return [
          {
            label: "Bağlantı Protokolü",
            value: "ISO 14230-4 KWP Fast (ATSP5)",
            unit: "",
          },
          {
            label: "Arıza Lambası Mesafesi",
            value: <SmoothNumber value={data?.distance_mil_on ?? 0} digits={0} />,
            unit: "km",
          },
          {
            label: "Son Güncelleme",
            value: formatTimestamp(data?.updated_at ?? null),
            unit: "",
          },
          {
            label: "Ekran Kilidi (WakeLock)",
            value: wakeLockActive ? "Açık (Uyanık)" : "Kapalı",
            unit: "",
          },
        ];
    }
  }, [
    activeTab,
    fuel,
    fuelUnit,
    trip.distanceKm,
    trip.fuelLiters,
    trip.maxSpeed,
    trip.durationMs,
    trip.movingDurationMs,
    tripTotalCostTL,
    instantCostTLPerKm,
    instantCostTLPerHour,
    avgFuelL100km,
    avgSpeedKmh,
    perf.t100,
    perf.t50,
    perf.status,
    perf.best0_100,
    perf.peakBoost,
    estimatedTorqueNm,
    estimatedHorsepower,
    rpm,
    coolant,
    maf,
    load,
    intakeTemp,
    throttle,
    map,
    turboBoost,
    data?.distance_mil_on,
    data?.updated_at,
    wakeLockActive,
  ]);

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-black px-3 pb-[max(5.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-[var(--ivory)] sm:px-6 sm:pb-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(241,235,220,0.1),transparent_32%),radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.04),transparent_28%),radial-gradient(circle_at_bottom,rgba(241,235,220,0.05),transparent_40%)]"
      />

      <div
        className={`relative mx-auto grid w-full max-w-6xl gap-4 ${
          isLandscape ? "lg:grid-cols-[1.08fr_0.92fr]" : "grid-cols-1"
        }`}
      >
        {/* SOL KADRAN VE ANA TELEMETRİ KARTI */}
        <section className="flex flex-col justify-between rounded-[2rem] border border-white/8 bg-white/[0.03] p-5 shadow-[0_0_50px_rgba(241,235,220,0.04)] backdrop-blur-[1px]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.26em] text-[var(--ivory-muted)] sm:text-[11px]">
              <span className="truncate">AuraDrive Pro • 1.4 D-4D</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFuelModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] tracking-wider text-amber-200 transition hover:bg-amber-400/20 active:scale-95 sm:px-3 sm:py-1.5"
                  title="Mazot litre fiyatını değiştirmek için tıklayın"
                >
                  <span>⛽ {fuelPrice.toFixed(2)} ₺/L</span>
                  <span className="text-[9px] opacity-70">✎</span>
                </button>

                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] tracking-[0.2em] text-[var(--ivory)] sm:px-3 sm:py-1.5">
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* AKILLI MOTOR KORUMA & VİTES UYARI BİLDİRİMİ */}
            {smartAlert ? (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mb-3 rounded-2xl border px-3 py-2 text-xs backdrop-blur-md ${
                  smartAlert.type === "danger"
                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                    : smartAlert.type === "warning"
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                }`}
              >
                <div className="font-semibold uppercase tracking-wider text-[11px]">
                  {smartAlert.title}
                </div>
                <div className="text-[10px] opacity-90">{smartAlert.text}</div>
              </motion.div>
            ) : null}

            {/* RPM KADRAN ÇUBUĞU */}
            <div className="h-[6px] w-full overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-[var(--ivory)]"
                animate={{ width: `${rpmPercent}%` }}
                transition={{ type: "spring", stiffness: 350, damping: 25 }}
              />
            </div>

            <div className="mt-2.5 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-[var(--ivory-muted)] sm:text-[11px]">
              <span>RPM</span>
              <span>
                <SmoothNumber value={rpm} digits={0} fast={true} /> / 5000 d/d
              </span>
            </div>

            {/* TURBO BOOST ÇUBUĞU */}
            <div className="mt-3">
              <div className="h-[4px] w-full overflow-hidden rounded-full bg-white/5">
                <motion.div
                  className="h-full rounded-full bg-amber-200/80 shadow-[0_0_10px_rgba(251,191,36,0.5)]"
                  animate={{ width: `${boostPercent}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 22 }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-[var(--ivory-muted)]">
                <span>Turbo Boost</span>
                <span>
                  <SmoothNumber value={turboBoost} digits={2} fast={true} /> Bar
                </span>
              </div>
            </div>
          </div>

          {/* ANA HIZ GÖSTERGESİ */}
          <div className="py-6 text-center leading-none sm:py-8">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.1, ease: "easeOut" }}
              className="leading-none"
            >
              <div className="ivory-glow text-[clamp(5rem,18vw,11rem)] font-light tracking-[-0.06em] text-[var(--ivory)]">
                <SmoothNumber value={speed} digits={0} fast={true} />
              </div>
              <div className="mt-1 text-[0.8rem] uppercase tracking-[0.35em] text-[var(--ivory-muted)]">
                KM/H
              </div>
            </motion.div>

            {/* ANLIK TÜKETİM VE MALİYET */}
            <div className="mt-6 text-xs uppercase tracking-[0.24em] text-[var(--ivory-muted)]">
              Anlık Yakıt Tüketimi
            </div>
            <div className="mt-1 flex items-end justify-center gap-2">
              <div className="ivory-glow text-3xl font-light tracking-[-0.02em] text-[var(--ivory)]">
                <SmoothNumber value={fuel} digits={2} />
              </div>
              <span className="pb-[0.3rem] text-sm uppercase tracking-[0.18em] text-[var(--ivory-muted)]">
                {fuelUnit}
              </span>
            </div>

            {instantCostTLPerKm || instantCostTLPerHour ? (
              <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ivory-muted)] opacity-80">
                ≈{" "}
                <SmoothNumber
                  value={instantCostTLPerKm ?? instantCostTLPerHour}
                  digits={2}
                />{" "}
                {instantCostTLPerKm ? "₺/km" : "₺/saat"}
              </div>
            ) : null}
          </div>

          {/* ALT BİLGİ KARTLARI */}
          <div className="grid gap-3 text-center sm:grid-cols-2">
            <div className="rounded-3xl border border-white/8 bg-white/[0.02] px-4 py-3.5 shadow-[0_0_24px_rgba(241,235,220,0.04)]">
              <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--ivory-muted)] sm:text-[11px]">
                Motor Sıcaklığı
              </p>
              <p className="ivory-glow mt-1.5 text-2xl font-light text-[var(--ivory)]">
                <SmoothNumber value={coolant} digits={0} />
                <span className="ml-1 text-base">°C</span>
              </p>
            </div>

            <div className="rounded-3xl border border-white/8 bg-white/[0.02] px-4 py-3.5 shadow-[0_0_24px_rgba(241,235,220,0.04)]">
              <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--ivory-muted)] sm:text-[11px]">
                Trip Mesafesi
              </p>
              <p className="ivory-glow mt-1.5 text-2xl font-light text-[var(--ivory)]">
                <SmoothNumber value={trip.distanceKm} digits={2} />
                <span className="ml-1 text-base">km</span>
              </p>
            </div>
          </div>
        </section>

        {/* SAĞ PANEL / DETAYLI SEKMELER */}
        <section className="flex flex-col justify-between gap-4 rounded-[2rem] border border-white/8 bg-white/[0.03] p-4 shadow-[0_0_50px_rgba(241,235,220,0.03)] backdrop-blur-[1px]">
          {!isPortrait ? (
            <div className="grid grid-cols-5 gap-1.5">
              {dashboardTabs.map((tab) => {
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`min-h-[50px] rounded-2xl border px-1 text-[9px] uppercase tracking-[0.18em] transition active:scale-[0.98] sm:text-[10px] ${
                      isActive
                        ? "border-[rgba(241,235,220,0.32)] bg-[rgba(241,235,220,0.12)] text-[var(--ivory)] shadow-[0_0_28px_rgba(241,235,220,0.08)]"
                        : "border-white/10 bg-white/[0.03] text-[var(--ivory-muted)]"
                    }`}
                    aria-pressed={isActive}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* METRİK KARTLARI */}
          <div
            className={`grid gap-2.5 ${
              isLandscape ? "lg:grid-cols-2" : "grid-cols-1 sm:grid-cols-2"
            }`}
          >
            {activeMetrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-[1.4rem] border border-white/8 bg-white/[0.02] px-4 py-3.5 shadow-[0_0_26px_rgba(241,235,220,0.04)]"
              >
                <p className="text-[9px] uppercase tracking-[0.24em] text-[var(--ivory-muted)] sm:text-[10px]">
                  {metric.label}
                </p>
                <p className="ivory-glow mt-1.5 flex flex-wrap items-end gap-x-2 gap-y-1 text-2xl font-light text-[var(--ivory)]">
                  <span>{metric.value}</span>
                  {metric.unit ? (
                    <span className="pb-[0.15rem] text-xs uppercase tracking-[0.16em] text-[var(--ivory-muted)]">
                      {metric.unit}
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>

          {/* SEKME ÖZEL BUTONLARI & AYARLARI */}
          {activeTab === "trip" ? (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-xs">
                <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--ivory-muted)]">
                  Mazot Litre Fiyatı:
                </span>
                <button
                  type="button"
                  onClick={() => setIsFuelModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs text-amber-200 transition hover:bg-amber-400/20 active:scale-95"
                >
                  <span>{fuelPrice.toFixed(2)} ₺ / Litre</span>
                  <span className="text-[10px] opacity-70">✎ Değiştir</span>
                </button>
              </div>

              <button
                type="button"
                onClick={resetTrip}
                className="w-full rounded-2xl border border-[rgba(241,235,220,0.25)] bg-[rgba(241,235,220,0.08)] py-3 text-xs uppercase tracking-[0.24em] text-[var(--ivory)] transition hover:bg-[rgba(241,235,220,0.15)] active:scale-[0.98]"
              >
                Yeni Sürüş Başlat / Trip Sıfırla
              </button>
            </div>
          ) : null}

          {activeTab === "performans" ? (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={resetPerformance}
                className="w-full rounded-2xl border border-[rgba(241,235,220,0.25)] bg-[rgba(241,235,220,0.08)] py-3 text-xs uppercase tracking-[0.24em] text-[var(--ivory)] transition hover:bg-[rgba(241,235,220,0.15)] active:scale-[0.98]"
              >
                0-100 & Peak Basıncı Sıfırla
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {/* YAKIT FİYATI GÜNCELLEME MODALI */}
      {isFuelModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-sm rounded-[2rem] border border-amber-400/30 bg-[#0c0c0c] p-6 shadow-[0_0_60px_rgba(251,191,36,0.12)] text-[var(--ivory)]"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⛽</span>
                <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-[var(--ivory)]">
                  Mazot Litre Fiyatı
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFuelModalOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-[var(--ivory-muted)] hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            <div className="py-5 text-center">
              <div className="text-[11px] uppercase tracking-wider text-[var(--ivory-muted)]">
                Güncel Akaryakıt Pompa Fiyatı
              </div>

              <div className="mt-3 flex items-center justify-center gap-2">
                <input
                  type="number"
                  step="0.05"
                  autoFocus
                  value={fuelPriceInput}
                  onChange={(e) => setFuelPriceInput(e.target.value)}
                  className="w-36 rounded-2xl border border-amber-400/40 bg-black/70 px-3 py-2 text-center text-3xl font-light text-amber-200 shadow-inner outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                />
                <span className="text-xl font-light text-[var(--ivory-muted)]">₺ / L</span>
              </div>

              {/* HIZLI AYAR BUTONLARI (+/-) */}
              <div className="mt-4 flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(-1.0)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] tracking-wider text-[var(--ivory-muted)] hover:bg-white/10 active:scale-95"
                >
                  -1.00 ₺
                </button>
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(-0.1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] tracking-wider text-[var(--ivory-muted)] hover:bg-white/10 active:scale-95"
                >
                  -0.10 ₺
                </button>
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(0.1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] tracking-wider text-[var(--ivory-muted)] hover:bg-white/10 active:scale-95"
                >
                  +0.10 ₺
                </button>
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(1.0)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] tracking-wider text-[var(--ivory-muted)] hover:bg-white/10 active:scale-95"
                >
                  +1.00 ₺
                </button>
              </div>

              {/* TAHMİNİ ÖRNEK MALİYET BİLGİSİ */}
              <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.02] p-3 text-left text-[11px] text-[var(--ivory-muted)]">
                <div className="flex justify-between py-0.5">
                  <span>100 km Tüketim (Ort. 5.0 L):</span>
                  <span className="font-medium text-[var(--ivory)]">
                    {((parseFloat(fuelPriceInput) || fuelPrice) * 5).toFixed(2)} ₺
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>Tam Depo Dolumu (45 L):</span>
                  <span className="font-medium text-[var(--ivory)]">
                    {((parseFloat(fuelPriceInput) || fuelPrice) * 45).toFixed(2)} ₺
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsFuelModalOpen(false)}
                className="w-1/3 rounded-2xl border border-white/10 bg-white/5 py-3 text-xs uppercase tracking-wider text-[var(--ivory-muted)] hover:bg-white/10 active:scale-98"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = parseFloat(fuelPriceInput);
                  if (!Number.isNaN(val) && val > 0) {
                    saveFuelPrice(val);
                  }
                }}
                className="w-2/3 rounded-2xl border border-amber-400/40 bg-amber-400/20 py-3 text-xs uppercase tracking-[0.2em] text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.15)] transition hover:bg-amber-400/30 active:scale-98"
              >
                Fiyatı Kaydet
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {/* MOBİL ALT MENÜ BAR (PORTRAIT) */}
      <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <div className="mx-auto grid max-w-md grid-cols-6 gap-1 rounded-[1.75rem] border border-white/10 bg-black/85 p-1.5 shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          {dashboardTabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[48px] rounded-[1.2rem] border px-0.5 text-[8px] uppercase tracking-[0.12em] transition active:scale-[0.98] ${
                  isActive
                    ? "border-[rgba(241,235,220,0.32)] bg-[rgba(241,235,220,0.14)] text-[var(--ivory)]"
                    : "border-white/10 bg-white/[0.03] text-[var(--ivory-muted)]"
                }`}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => void toggleWakeLock()}
            className="min-h-[48px] rounded-[1.2rem] border border-white/10 bg-white/[0.03] px-0.5 text-[8px] uppercase tracking-[0.12em] text-[var(--ivory)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            aria-pressed={wakeLockEnabled}
            disabled={!wakeLockSupported}
          >
            {wakeLockSupported ? (wakeLockActive ? "AÇIK" : "EKRAN") : "YOK"}
          </button>
        </div>
      </div>
    </main>
  );
}
