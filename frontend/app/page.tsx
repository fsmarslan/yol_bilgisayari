"use client";

import { animate, motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { obdBleService, type TelemetryState } from "./services/obd-ble.service";
import { backgroundService } from "./services/background.service";
import TripRouteMap, { type GpsPoint } from "./components/TripRouteMap";

type DashboardTab = "surus" | "trip" | "performans" | "motor" | "saglik";
type CockpitTheme = "cyber-cyan" | "gr-red" | "amber" | "emerald";

export type CompletedTrip = {
  id: string;
  startTime: number;
  endTime: number;
  distanceKm: number;
  fuelLiters: number;
  fuelCostTL: number;
  fuelPrice: number;
  avgFuelL100km: number | null;
  avgSpeedKmh: number | null;
  maxSpeed: number;
  durationMs: number;
  movingDurationMs: number;
  routePoints: GpsPoint[];
};

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
const STORAGE_KEY_THEME = "auradrive_cockpit_theme";
const STORAGE_KEY_TRIP_HISTORY = "auradrive_trip_history_v1";
const DEFAULT_FUEL_PRICE = 44.5; // TL / Litre (Euro Diesel)
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";

const dashboardTabs: Array<{ id: DashboardTab; label: string; icon: string }> = [
  { id: "surus", label: "SÜRÜŞ", icon: "⚡" },
  { id: "trip", label: "TRİP", icon: "📊" },
  { id: "performans", label: "DRAG", icon: "⏱️" },
  { id: "motor", label: "MOTOR", icon: "⚙️" },
  { id: "saglik", label: "SAĞLIK", icon: "🩺" },
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
    return <span className="tabular-nums">{fallback}</span>;
  }

  return <span className="tabular-nums">{display.toFixed(digits)}</span>;
}

function formatTrip(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "--";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "--";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function estimateGear(speedKmh: number | null, rpm: number | null): string {
  if (!speedKmh || !rpm || speedKmh < 3 || rpm < 600) return "N";
  const ratio = speedKmh / rpm;
  if (ratio < 0.0112) return "1";
  if (ratio < 0.0185) return "2";
  if (ratio < 0.0270) return "3";
  if (ratio < 0.0360) return "4";
  return "5";
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function useLandscape() {
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(orientation: landscape)");
    const updateOrientation = () => setIsLandscape(mediaQuery.matches);
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

// ----------------------------------------------------
// RADIAL ARC GAUGE COMPONENT (SVG Cockpit Gauge)
// ----------------------------------------------------
function RadialGauge({
  value,
  min = 0,
  max = 200,
  title,
  unit,
  size = 220,
  strokeWidth = 10,
  redlineStart = null,
  highlightColor = "var(--theme-primary)",
  subValue,
}: {
  value: number | null;
  min?: number;
  max?: number;
  title: string;
  unit: string;
  size?: number;
  strokeWidth?: number;
  redlineStart?: number | null;
  highlightColor?: string;
  subValue?: React.ReactNode;
}) {
  const clampedVal = Math.max(min, Math.min(max, value ?? 0));
  const percent = (clampedVal - min) / (max - min);

  // 240 degree gauge arc (from 150deg to 390deg)
  const radius = (size - strokeWidth * 2) / 2;
  const center = size / 2;
  const totalAngle = 240;
  const startAngle = 150;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (totalAngle / 360) * circumference;
  const strokeOffset = arcLength * (1 - percent);

  const redlinePercent = redlineStart !== null ? (redlineStart - min) / (max - min) : null;
  const redlineOffset = redlinePercent !== null ? arcLength * (1 - redlinePercent) : null;

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="overflow-visible">
        {/* Gauge Background Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${center} ${center})`}
        />

        {/* Redline Background Zone */}
        {redlineOffset !== null && redlinePercent !== null && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(239, 68, 68, 0.4)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength * (1 - redlinePercent)} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${startAngle + totalAngle * redlinePercent} ${center} ${center})`}
          />
        )}

        {/* Active Filled Gauge Track */}
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={clampedVal >= (redlineStart ?? Infinity) ? "var(--rpm-redline)" : highlightColor}
          strokeWidth={strokeWidth + 2}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={strokeOffset}
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${center} ${center})`}
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
          style={{
            filter: `drop-shadow(0 0 8px ${clampedVal >= (redlineStart ?? Infinity) ? "rgba(239, 68, 68, 0.7)" : "var(--theme-glow)"
              })`,
          }}
        />

        {/* Scale Ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const angle = (startAngle + totalAngle * step) * (Math.PI / 180);
          const tickR1 = radius - strokeWidth / 2 - 4;
          const tickR2 = radius - strokeWidth / 2 - 12;
          const x1 = center + tickR1 * Math.cos(angle);
          const y1 = center + tickR1 * Math.sin(angle);
          const x2 = center + tickR2 * Math.cos(angle);
          const y2 = center + tickR2 * Math.sin(angle);
          const tickVal = Math.round(min + (max - min) * step);

          return (
            <g key={step}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeWidth="1.5"
              />
            </g>
          );
        })}
      </svg>

      {/* Center Readout Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted">
          {title}
        </span>
        <div className="my-0.5 text-4xl font-light tracking-tight text-main font-display cluster-glow sm:text-5xl">
          <SmoothNumber value={value} digits={0} fast={true} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
          {unit}
        </span>
        {subValue && <div className="mt-1">{subValue}</div>}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// F1 SEQUENTIAL SHIFT LIGHTS
// ----------------------------------------------------
function SequentialShiftLights({ rpm, activeAlert }: { rpm: number | null; activeAlert: boolean }) {
  const currentRpm = rpm ?? 0;
  // Toyota 1.4 D-4D diesel rev range: 1200 - 4500 RPM
  const steps = [
    { threshold: 1400, color: "bg-emerald-500", glow: "shadow-[0_0_10px_#10b981]" },
    { threshold: 1800, color: "bg-emerald-400", glow: "shadow-[0_0_10px_#34d399]" },
    { threshold: 2200, color: "bg-emerald-300", glow: "shadow-[0_0_12px_#6ee7b7]" },
    { threshold: 2600, color: "bg-cyan-400", glow: "shadow-[0_0_12px_#22d3ee]" },
    { threshold: 3000, color: "bg-amber-400", glow: "shadow-[0_0_12px_#fbbf24]" },
    { threshold: 3400, color: "bg-amber-500", glow: "shadow-[0_0_14px_#f59e0b]" },
    { threshold: 3800, color: "bg-orange-500", glow: "shadow-[0_0_14px_#f97316]" },
    { threshold: 4100, color: "bg-red-500", glow: "shadow-[0_0_16px_#ef4444]" },
    { threshold: 4300, color: "bg-red-600", glow: "shadow-[0_0_18px_#dc2626]" },
    { threshold: 4500, color: "bg-red-600 animate-ping", glow: "shadow-[0_0_22px_#ef4444]" },
  ];

  const isFlashing = currentRpm >= 4200 || activeAlert;

  return (
    <div className="flex w-full items-center justify-between gap-1 rounded-xl border border-white/10 bg-black/60 px-2 py-1.5 backdrop-blur-md">
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[9px] font-bold tracking-widest text-muted">RPM</span>
      </div>

      <div className="flex flex-1 items-center justify-center gap-1 px-1 sm:gap-1.5">
        {steps.map((step, idx) => {
          const isActive = currentRpm >= step.threshold;
          return (
            <div
              key={idx}
              className={`h-2.5 flex-1 rounded-sm transition-all duration-75 sm:h-3 ${isActive
                  ? `${step.color} ${step.glow} opacity-100 scale-105`
                  : "bg-white/10 opacity-30"
                } ${isFlashing && isActive ? "animate-pulse" : ""}`}
            />
          );
        })}
      </div>

      <div className="text-right">
        <span className="text-[10px] font-semibold tabular-nums text-main">
          {currentRpm > 0 ? `${currentRpm.toFixed(0)}` : "--"} <span className="text-[8px] text-muted">RPM</span>
        </span>
      </div>
    </div>
  );
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

  // Masaüstü Testi İçin Dinamik Sürüş Simülasyonu
  const [demoMode, setDemoMode] = useState<boolean>(!isNative);
  const [demoState, setDemoState] = useState<LiveData>({
    connected: true,
    rpm: 850,
    speed_kmh: 0,
    maf_gps: 5.2,
    coolant_temp_c: 88,
    load_percent: 18,
    intake_temp_c: 24,
    throttle_percent: 0,
    map_kpa: 101,
    distance_mil_on: 0,
    turbo_boost_bar: 0.0,
    fuel_display: 0.6,
    fuel_unit: "L/h",
    fuel_rate_lph: 0.6,
    last_error: null,
    updated_at: new Date().toISOString(),
  });

  useEffect(() => {
    if (!demoMode) return;

    let simTick = 0;
    const interval = setInterval(() => {
      simTick += 1;
      const cycle = (simTick % 240) / 8; // 30 sn dongu

      let speed = 0;
      let rpm = 800;
      let load = 15;
      let boost = 0.0;
      let throttle = 0;
      let fuel = 0.6;
      let unit = "L/h";

      if (cycle < 3) {
        // Duruyor / Rolanti
        speed = 0;
        rpm = 820 + Math.sin(simTick * 0.4) * 25;
        load = 18;
        boost = 0.0;
        throttle = 0;
        fuel = 0.6;
        unit = "L/h";
      } else if (cycle < 8) {
        // 1. & 2. Vites Hizlanma
        const p = (cycle - 3) / 5;
        speed = p * 45;
        rpm = 1200 + p * 2600;
        load = 65 + p * 20;
        boost = 0.4 + p * 0.7;
        throttle = 40 + p * 30;
        fuel = 7.2 - p * 1.5;
        unit = "L/100km";
      } else if (cycle < 16) {
        // 3. & 4. Vites Yuksek Hizlanma & Turbo Boost
        const p = (cycle - 8) / 8;
        speed = 45 + p * 55;
        rpm = 1800 + p * 1800;
        load = 75 + p * 20;
        boost = 0.8 + Math.sin(simTick * 0.5) * 0.4;
        throttle = 60 + p * 25;
        fuel = 5.8 + p * 1.2;
        unit = "L/100km";
      } else if (cycle < 24) {
        // 5. Vites Otoban Seyir (Cruise)
        speed = 100 + Math.sin(simTick * 0.2) * 8;
        rpm = 2050 + Math.sin(simTick * 0.2) * 150;
        load = 38;
        boost = 0.35 + Math.sin(simTick * 0.3) * 0.15;
        throttle = 25;
        fuel = 4.2 + Math.sin(simTick * 0.4) * 0.4;
        unit = "L/100km";
      } else {
        // Yavaslama & Fren
        const p = (cycle - 24) / 6;
        speed = Math.max(0, 100 * (1 - p));
        rpm = Math.max(820, 2000 * (1 - p));
        load = 10;
        boost = 0.0;
        throttle = 0;
        fuel = speed > 15 ? 0.0 : 0.6;
        unit = speed > 15 ? "L/100km" : "L/h";
      }

      setDemoState({
        connected: true,
        rpm: Math.round(rpm),
        speed_kmh: Math.round(speed * 10) / 10,
        maf_gps: Math.max(4, Math.round((rpm / 40) * 10) / 10),
        coolant_temp_c: 88,
        load_percent: Math.round(load),
        intake_temp_c: 24,
        throttle_percent: Math.round(throttle),
        map_kpa: Math.round(101 + boost * 100),
        distance_mil_on: 0,
        turbo_boost_bar: Math.max(0, Math.round(boost * 100) / 100),
        fuel_display: Math.max(0, Math.round(fuel * 100) / 100),
        fuel_unit: unit,
        fuel_rate_lph: unit === "L/h" ? fuel : (fuel * speed) / 100,
        last_error: null,
        updated_at: new Date().toISOString(),
      });
    }, 150);

    return () => clearInterval(interval);
  }, [demoMode]);

  const rawData = isNative ? nativeData : apiData;
  const data = demoMode ? demoState : rawData;
  const error = isNative ? (nativeData?.last_error ? new Error(nativeData.last_error) : null) : (demoMode ? null : apiError);

  const [activeTab, setActiveTab] = useState<DashboardTab>("surus");
  const [theme, setTheme] = useState<CockpitTheme>("cyber-cyan");
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);
  const [wakeLockSupported, setWakeLockSupported] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<ScreenWakeLock | null>(null);

  // Arka Plan Servisi & Pil Koruması State'leri
  const [bgServiceEnabled, setBgServiceEnabled] = useState(true);
  const [bgServiceActive, setBgServiceActive] = useState(false);
  const [isIgnoringBattery, setIsIgnoringBattery] = useState<boolean | null>(null);

  const isLandscape = useLandscape();
  const isPortrait = !isLandscape;

  // Tema Yükleme & Kaydetme
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) as CockpitTheme | null;
      if (savedTheme && ["cyber-cyan", "gr-red", "amber", "emerald"].includes(savedTheme)) {
        setTheme(savedTheme);
      }
    } catch {
      // Ignore
    }
  }, []);

  const changeTheme = (newTheme: CockpitTheme) => {
    setTheme(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY_THEME, newTheme);
    } catch {
      // Ignore
    }
  };

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

  const [trip, setTrip] = useState<TripData>(DEFAULT_TRIP);
  const [tripHistory, setTripHistory] = useState<CompletedTrip[]>([]);
  const [tripSubView, setTripSubView] = useState<"current" | "history">("current");
  const [selectedMapTrip, setSelectedMapTrip] = useState<CompletedTrip | null>(null);
  const lastUpdateRef = useRef<number | null>(null);

  // GPS Geolocation Takibi
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [routePoints, setRoutePoints] = useState<GpsPoint[]>([]);
  const lastRecordedGpsRef = useRef<GpsPoint | null>(null);

  // Geçmiş Sürüşleri Yükle
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem(STORAGE_KEY_TRIP_HISTORY);
      if (savedHistory) {
        setTripHistory(JSON.parse(savedHistory));
      }
    } catch {
      // Ignore
    }
  }, []);

  // Canlı GPS Dinleyicisi
  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setGpsActive(true);
        setGpsAccuracy(Math.round(position.coords.accuracy));
        const newPoint: GpsPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed: position.coords.speed !== null ? position.coords.speed * 3.6 : (data?.speed_kmh ?? 0),
          altitude: position.coords.altitude,
          timestamp: position.timestamp || Date.now(),
        };

        const last = lastRecordedGpsRef.current;
        let shouldRecord = false;

        if (!last) {
          shouldRecord = true;
        } else {
          const dist = calculateDistanceMeters(last.lat, last.lng, newPoint.lat, newPoint.lng);
          const timeDiff = newPoint.timestamp - last.timestamp;
          if (dist >= 8 || (dist >= 3 && timeDiff >= 5000)) {
            shouldRecord = true;
          }
        }

        if (shouldRecord) {
          lastRecordedGpsRef.current = newPoint;
          setRoutePoints((prev) => [...prev, newPoint]);
        }
      },
      (err) => {
        console.warn("GPS konum uyarısı:", err.message);
        setGpsActive(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [data?.speed_kmh]);

  // Demo Modunda Gerçekçi GPS Rotası Üret
  useEffect(() => {
    if (!demoMode) return;
    setGpsActive(true);
    setGpsAccuracy(5);
    // İstanbul Sahil Yolu (Sarayburnu - Beşiktaş güzergahı)
    const baseLat = 41.0082;
    const baseLng = 28.9784;
    const simPoints: GpsPoint[] = [
      { lat: baseLat, lng: baseLng, speed: 0, timestamp: Date.now() - 600000 },
      { lat: baseLat + 0.004, lng: baseLng + 0.006, speed: 35, timestamp: Date.now() - 480000 },
      { lat: baseLat + 0.009, lng: baseLng + 0.012, speed: 65, timestamp: Date.now() - 360000 },
      { lat: baseLat + 0.016, lng: baseLng + 0.021, speed: 85, timestamp: Date.now() - 240000 },
      { lat: baseLat + 0.024, lng: baseLng + 0.031, speed: 90, timestamp: Date.now() - 120000 },
      { lat: baseLat + 0.032, lng: baseLng + 0.042, speed: 0, timestamp: Date.now() },
    ];
    setRoutePoints(simPoints);

    // Eğer geçmişte hiç kayıt yoksa demo bir sürüş ekle
    try {
      const savedHistory = localStorage.getItem(STORAGE_KEY_TRIP_HISTORY);
      if (!savedHistory || JSON.parse(savedHistory).length === 0) {
        const demoTrip: CompletedTrip = {
          id: "demo_trip_1",
          startTime: Date.now() - 3600000,
          endTime: Date.now() - 1800000,
          distanceKm: 18.4,
          fuelLiters: 0.88,
          fuelCostTL: 39.16,
          fuelPrice: 44.5,
          avgFuelL100km: 4.78,
          avgSpeedKmh: 61,
          maxSpeed: 104,
          durationMs: 1800000,
          movingDurationMs: 1650000,
          routePoints: simPoints,
        };
        setTripHistory([demoTrip]);
        localStorage.setItem(STORAGE_KEY_TRIP_HISTORY, JSON.stringify([demoTrip]));
      }
    } catch {
      // Ignore
    }
  }, [demoMode]);

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

  const archiveCurrentTrip = () => {
    if (trip.distanceKm < 0.05 && routePoints.length < 2) return;
    const completed: CompletedTrip = {
      id: "trip_" + Date.now(),
      startTime: trip.startTime || Date.now() - trip.durationMs,
      endTime: Date.now(),
      distanceKm: Math.round(trip.distanceKm * 100) / 100,
      fuelLiters: Math.round(trip.fuelLiters * 100) / 100,
      fuelCostTL: Math.round(tripTotalCostTL * 100) / 100,
      fuelPrice: fuelPrice,
      avgFuelL100km: avgFuelL100km ? Math.round(avgFuelL100km * 100) / 100 : null,
      avgSpeedKmh: avgSpeedKmh ? Math.round(avgSpeedKmh) : null,
      maxSpeed: Math.round(trip.maxSpeed),
      durationMs: trip.durationMs,
      movingDurationMs: trip.movingDurationMs,
      routePoints: [...routePoints],
    };

    const updatedHistory = [completed, ...tripHistory];
    setTripHistory(updatedHistory);
    try {
      localStorage.setItem(STORAGE_KEY_TRIP_HISTORY, JSON.stringify(updatedHistory));
    } catch {
      // Ignore
    }
  };

  const resetTrip = () => {
    if (trip.distanceKm >= 0.05 || routePoints.length >= 2) {
      archiveCurrentTrip();
    }

    const fresh: TripData = {
      distanceKm: 0,
      fuelLiters: 0,
      durationMs: 0,
      movingDurationMs: 0,
      maxSpeed: 0,
      startTime: Date.now(),
    };
    setTrip(fresh);
    setRoutePoints([]);
    lastRecordedGpsRef.current = null;
    lastUpdateRef.current = null;
    try {
      localStorage.setItem(STORAGE_KEY_TRIP, JSON.stringify(fresh));
    } catch {
      // Clear error
    }
  };

  const deleteTrip = (id: string) => {
    const updated = tripHistory.filter((t) => t.id !== id);
    setTripHistory(updated);
    try {
      localStorage.setItem(STORAGE_KEY_TRIP_HISTORY, JSON.stringify(updated));
    } catch {
      // Ignore
    }
    if (selectedMapTrip?.id === id) {
      setSelectedMapTrip(null);
    }
  };

  const clearAllTripHistory = () => {
    if (typeof window !== "undefined" && window.confirm("Tüm geçmiş sürüş kayıtları silinsin mi?")) {
      setTripHistory([]);
      try {
        localStorage.removeItem(STORAGE_KEY_TRIP_HISTORY);
      } catch {
        // Ignore
      }
    }
  };

  const exportTripHistoryJson = () => {
    if (typeof window === "undefined" || tripHistory.length === 0) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tripHistory, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `auradrive_trips_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
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
  const rpm = data?.rpm ?? null;
  const maf = data?.maf_gps ?? null;
  const coolant = data?.coolant_temp_c ?? null;
  const load = data?.load_percent ?? null;
  const intakeTemp = data?.intake_temp_c ?? null;
  const throttle = data?.throttle_percent ?? null;
  const map = data?.map_kpa ?? null;
  const fuel = data?.fuel_display ?? null;
  const fuelUnit = data?.fuel_unit ?? "--";

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
  // TÜRETİLMİŞ HESAPLAMALAR (Dizel Tork, Güç, Vites, Maliyet)
  // ----------------------------------------------------
  const currentGear = useMemo(() => estimateGear(speed, rpm), [speed, rpm]);

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

  const tripTotalCostTL = useMemo(() => {
    return trip.fuelLiters * fuelPrice;
  }, [trip.fuelLiters, fuelPrice]);

  const instantCostTLPerKm = useMemo(() => {
    if (fuelUnit === "L/100km" && fuel !== null && fuel > 0) {
      return (fuel * fuelPrice) / 100;
    }
    return null;
  }, [fuel, fuelUnit, fuelPrice]);

  // 2006 Toyota 1.4 D-4D (90 HP / 190 Nm) Tahmini Anlık Güç ve Tork
  const estimatedTorqueNm = useMemo(() => {
    if (load === null || rpm === null || rpm < 500) return 0;
    const rpmFactor =
      rpm >= 1700 && rpm <= 3200
        ? 1.0
        : rpm < 1700
          ? 0.75 + 0.25 * ((rpm - 750) / 950)
          : Math.max(0.65, 1.0 - (rpm - 3200) / 2000);
    return Math.round((load / 100) * 190 * Math.max(0.1, rpmFactor));
  }, [load, rpm]);

  const estimatedHorsepower = useMemo(() => {
    if (estimatedTorqueNm === 0 || rpm === null) return 0;
    const hp = (estimatedTorqueNm * rpm) / 7023.5;
    return Math.min(95, Math.round(hp));
  }, [estimatedTorqueNm, rpm]);

  // ----------------------------------------------------
  // AKILLI MOTOR & TURBO KORUMA ASİSTANI
  // ----------------------------------------------------
  const smartAlert = useMemo(() => {
    if (!data?.connected) return null;

    if (coolant !== null && coolant >= 98) {
      return {
        type: "danger",
        title: "YÜKSEK MOTOR HARARETİ",
        text: `Soğutma suyu ${coolant}°C! Yükü hafifletin ve rölantide soğumasını bekleyin.`,
      };
    }

    if (coolant !== null && coolant < 70) {
      return {
        type: "warning",
        title: "MOTOR SOĞUK • TURBO KORUMA",
        text: `Su sıcaklığı ${coolant}°C. Sert gaz ve yüksek devirden kaçının.`,
      };
    }

    if (rpm !== null && rpm >= 2200 && (load ?? 0) > 25 && (speed ?? 0) > 20) {
      return {
        type: "info",
        title: "VİTES YÜKSELT (SHIFT UP)",
        text: "Maksimum yakıt tasarrufu ve tork için bir üst vitese geçin.",
      };
    }

    return null;
  }, [data?.connected, coolant, rpm, load, speed]);

  // ----------------------------------------------------
  // WAKE LOCK
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

  // ----------------------------------------------------
  // ARKA PLAN FOREGROUND SERVICE & PİL KORUMASI
  // ----------------------------------------------------
  useEffect(() => {
    if (isNative) {
      void backgroundService.checkBatteryOptimization().then(setIsIgnoringBattery);
      void backgroundService.isServiceActive().then(setBgServiceActive);
    }
  }, [isNative]);

  // Bağlantı kurulduğunda veya demo modunda Arka Plan Servisini otomatik başlat
  useEffect(() => {
    if (bgServiceEnabled && (data?.connected || demoMode)) {
      void backgroundService
        .start(
          "AuraDrive Pro — Sürüş Aktif ⚡",
          "Telemetri ve yol bilgisayarı arka planda çalışıyor..."
        )
        .then((active) => {
          setBgServiceActive(active);
        });
    } else if (!bgServiceEnabled && bgServiceActive) {
      void backgroundService.stop().then(() => {
        setBgServiceActive(false);
      });
    }
  }, [data?.connected, demoMode, bgServiceEnabled, bgServiceActive]);

  // Arka Plan Bildirimini Canlı Sürüş Verileriyle Güncelle
  useEffect(() => {
    if (!bgServiceActive || (!data?.connected && !demoMode)) return;

    const speed = Math.round(data?.speed_kmh ?? 0);
    const fuelStr =
      data?.fuel_display !== null && data?.fuel_display !== undefined
        ? `${data.fuel_display.toFixed(1)} ${data.fuel_unit}`
        : "--";
    const distStr = `${trip.distanceKm.toFixed(1)} km`;
    const durationStr = formatTrip(trip.durationMs);
    const costStr =
      trip.fuelLiters > 0 ? ` • ${(trip.fuelLiters * fuelPrice).toFixed(1)} ₺` : "";

    const title = `AuraDrive Pro — ${speed} km/h ${speed > 0 ? "🚗" : "🅿️"}`;
    const body = `⛽ ${fuelStr} • 📍 ${distStr} • ⏱️ ${durationStr}${costStr}`;

    void backgroundService.updateNotification(title, body);
  }, [
    bgServiceActive,
    data?.speed_kmh,
    data?.fuel_display,
    data?.fuel_unit,
    trip.distanceKm,
    trip.durationMs,
    trip.fuelLiters,
    fuelPrice,
    data?.connected,
    demoMode,
  ]);

  const toggleBackgroundService = async () => {
    const next = !bgServiceEnabled;
    setBgServiceEnabled(next);
    if (!next) {
      await backgroundService.stop();
      setBgServiceActive(false);
    } else {
      const ok = await backgroundService.start();
      setBgServiceActive(ok);
    }
  };


  const boostPercent = Math.max(0, Math.min(100, (((turboBoost ?? 0) + 0.2) / 1.7) * 100));
  const torquePercent = Math.max(0, Math.min(100, (estimatedTorqueNm / 190) * 100));
  const hpPercent = Math.max(0, Math.min(100, (estimatedHorsepower / 90) * 100));
  const loadPercent = Math.max(0, Math.min(100, load ?? 0));
  const coolantPercent = Math.max(0, Math.min(100, (((coolant ?? 0) - 40) / 80) * 100));

  return (
    <main
      data-theme={theme}
      className="relative min-h-[100svh] overflow-x-hidden bg-cockpit-grid px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.6rem,env(safe-area-inset-top))] text-main transition-colors duration-300 sm:px-6 sm:pb-6 font-body"
    >
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-3">
        {/* ========================================================================= */}
        {/* TOP CLUSTER HEADER (VEHICLE BADGE + TELL-TALE ICONS + SHIFT LIGHTS)     */}
        {/* ========================================================================= */}
        <header className="flex flex-col gap-2 rounded-2xl border border-card-border bg-card p-3 shadow-xl backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Araç Modeli ve Durum Rozeti */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 items-center rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-xs font-bold tracking-widest text-primary font-display">
                TOYOTA
              </div>
              <div>
                <div className="text-xs font-bold tracking-wider text-main font-display">
                  COROLLA 1.4 D-4D
                </div>
                <div className="text-[9px] tracking-widest text-muted">
                  1ND-TV • TURBO DIESEL
                </div>
              </div>
            </div>

            {/* Orta Tell-Tale Göstergeleri (Uyarı Lambaları) */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* BLE Bağlantı Işığı */}
              <div
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-semibold tracking-wider ${data?.connected
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : error
                      ? "border-red-500/40 bg-red-500/15 text-red-300"
                      : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  }`}
                title={data?.connected ? "OBD-II Canlı Akış" : "Bağlantı Bekleniyor"}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${data?.connected
                      ? "bg-emerald-400 animate-pulse"
                      : error
                        ? "bg-red-400"
                        : "bg-amber-400 animate-ping"
                    }`}
                />
                <span>{data?.connected ? "OBD-II CANLI" : error ? "KOPUK" : "BAĞLANIYOR"}</span>
              </div>

              {/* Hararet Uyarısı İkonu */}
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs ${coolant !== null && coolant >= 98
                    ? "border-red-500 bg-red-500/20 text-red-400 animate-bounce"
                    : coolant !== null && coolant < 70
                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                      : "border-white/10 bg-white/5 text-muted"
                  }`}
                title={`Motor Sıcaklığı: ${coolant ?? "--"}°C`}
              >
                🌡️
              </div>

              {/* MIL / Arıza Lambası İkonu */}
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs ${(data?.distance_mil_on ?? 0) > 0
                    ? "border-amber-500 bg-amber-500/20 text-amber-300 animate-pulse"
                    : "border-white/10 bg-white/5 text-muted opacity-40"
                  }`}
                title="Motor Arıza Lambası (MIL)"
              >
                ⚠️
              </div>

              {/* Ekran Kilidi (WakeLock) Butonu */}
              <button
                type="button"
                onClick={() => void toggleWakeLock()}
                className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[9px] font-bold tracking-wider transition active:scale-95 ${wakeLockActive
                    ? "border-primary bg-primary/20 text-primary shadow-[0_0_12px_var(--theme-glow)]"
                    : "border-white/10 bg-white/5 text-muted"
                  }`}
                title="Ekranı sürekli açık tutma kilidi"
              >
                <span>📱</span>
                <span>{wakeLockActive ? "AÇIK" : "KİLİT"}</span>
              </button>

              {/* Arka Plan Servisi (Foreground Service) Butonu */}
              <button
                type="button"
                onClick={() => void toggleBackgroundService()}
                className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[9px] font-bold tracking-wider transition active:scale-95 ${
                  bgServiceActive
                    ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                    : "border-white/10 bg-white/5 text-muted"
                }`}
                title="Arka planda kesintisiz telemetri ve trip kaydı (Foreground Service)"
              >
                <span>🔄</span>
                <span>{bgServiceActive ? "ARKAPLAN: AÇIK" : "ARKAPLAN"}</span>
              </button>

              {/* Mazot Fiyatı Düzenleme Rozeti */}
              <button
                type="button"
                onClick={() => setIsFuelModalOpen(true)}
                className="flex h-7 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500/20 active:scale-95"
                title="Mazot litre fiyatı ayarla"
              >
                <span>⛽</span>
                <span>{fuelPrice.toFixed(2)} ₺</span>
              </button>

              {/* GPS Durumu Rozeti */}
              <div
                className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[9px] font-bold tracking-wider ${
                  gpsActive
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                    : "border-white/10 bg-white/5 text-muted opacity-50"
                }`}
                title={gpsActive ? `GPS Aktif (Hassasiyet: ±${gpsAccuracy ?? 5}m, ${routePoints.length} rota noktası)` : "GPS Aranıyor / Kapalı"}
              >
                <span>🛰️</span>
                <span>{gpsActive ? `GPS ${routePoints.length > 0 ? `(${routePoints.length})` : "AKTİF"}` : "GPS"}</span>
              </div>

              {/* Masaüstü Simülasyon Butonu */}
              {!isNative && (
                <button
                  type="button"
                  onClick={() => setDemoMode((prev) => !prev)}
                  className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[9px] font-bold tracking-wider transition active:scale-95 ${demoMode
                      ? "border-emerald-400 bg-emerald-400/20 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.3)]"
                      : "border-white/10 bg-white/5 text-muted"
                    }`}
                  title="Masaüstü test simülasyonunu aç/kapat"
                >
                  <span>🎮</span>
                  <span>{demoMode ? "SİMÜLASYON" : "CANLI OBD"}</span>
                </button>
              )}
            </div>

            {/* Tema Değiştirici Butonları */}
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
              <button
                type="button"
                onClick={() => changeTheme("cyber-cyan")}
                className={`h-6 w-6 rounded-lg border transition ${theme === "cyber-cyan"
                    ? "border-cyan-400 bg-cyan-400/30 shadow-[0_0_8px_#00f0ff]"
                    : "border-transparent bg-cyan-950/40 opacity-50"
                  }`}
                title="Cyber Cyan Teması"
              />
              <button
                type="button"
                onClick={() => changeTheme("gr-red")}
                className={`h-6 w-6 rounded-lg border transition ${theme === "gr-red"
                    ? "border-red-500 bg-red-500/30 shadow-[0_0_8px_#ff2a3b]"
                    : "border-transparent bg-red-950/40 opacity-50"
                  }`}
                title="GR Sport Red Teması"
              />
              <button
                type="button"
                onClick={() => changeTheme("amber")}
                className={`h-6 w-6 rounded-lg border transition ${theme === "amber"
                    ? "border-amber-500 bg-amber-500/30 shadow-[0_0_8px_#ff9900]"
                    : "border-transparent bg-amber-950/40 opacity-50"
                  }`}
                title="Amber Gece Teması"
              />
              <button
                type="button"
                onClick={() => changeTheme("emerald")}
                className={`h-6 w-6 rounded-lg border transition ${theme === "emerald"
                    ? "border-emerald-400 bg-emerald-400/30 shadow-[0_0_8px_#00e676]"
                    : "border-transparent bg-emerald-950/40 opacity-50"
                  }`}
                title="Emerald Track Teması"
              />
            </div>
          </div>

          {/* F1 SEQUENTIAL SHIFT LIGHTS */}
          <SequentialShiftLights rpm={rpm} activeAlert={smartAlert?.type === "info"} />
        </header>

        {/* AKILLI MOTOR KORUMA & VİTES UYARI BİLDİRİMİ */}
        <AnimatePresence>
          {smartAlert ? (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              className={`rounded-2xl border px-4 py-2.5 backdrop-blur-md ${smartAlert.type === "danger"
                  ? "border-red-500/50 bg-red-500/15 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.25)]"
                  : smartAlert.type === "warning"
                    ? "border-amber-400/50 bg-amber-400/15 text-amber-200 shadow-[0_0_20px_rgba(251,191,36,0.2)]"
                    : "border-emerald-400/50 bg-emerald-400/15 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                }`}
            >
              <div className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider">
                <span>{smartAlert.type === "danger" ? "🚨" : smartAlert.type === "warning" ? "⚠️" : "💡"}</span>
                <span>{smartAlert.title}</span>
              </div>
              <div className="mt-0.5 text-xs opacity-90">{smartAlert.text}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ========================================================================= */}
        {/* MAIN COCKPIT SECTION: LANDSCAPE DUAL GAUGE OR PORTRAIT HUD               */}
        {/* ========================================================================= */}
        {isLandscape ? (
          /* ---------------- LANDSCAPE MODE (DUAL GAUGE COCKPIT) ---------------- */
          <div className="grid grid-cols-[1.1fr_1.3fr_1.1fr] gap-3">
            {/* SOL KADRAN: HIZ VE VİTES */}
            <div className="flex flex-col items-center justify-between rounded-3xl border border-card-border bg-card p-4 shadow-2xl backdrop-blur-md">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
                HIZ GÖSTERGESİ
              </div>
              <RadialGauge
                value={speed}
                min={0}
                max={220}
                title="HIZ"
                unit="KM/H"
                size={230}
                subValue={
                  <div className="flex items-center gap-2">
                    <span className="rounded-md border border-primary/40 bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary font-display">
                      VİTES {currentGear}
                    </span>
                  </div>
                }
              />
              <div className="flex w-full items-center justify-between border-t border-white/10 pt-2 text-xs">
                <span className="text-muted">Anlık Tüketim:</span>
                <span className="font-bold text-primary tabular-nums">
                  <SmoothNumber value={fuel} digits={1} /> {fuelUnit}
                </span>
              </div>
            </div>

            {/* ORTA PANEL: TURBO BOOST + DYNO + MFD TABLAR */}
            <div className="flex flex-col justify-between gap-3 rounded-3xl border border-card-border bg-card p-4 shadow-2xl backdrop-blur-md">
              {/* Turbo Basıncı Barı */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted">
                  <span className="flex items-center gap-1">
                    <span>🌀</span> TURBO BASINCI
                  </span>
                  <span className="text-primary tabular-nums font-display text-sm">
                    <SmoothNumber value={turboBoost} digits={2} fast={true} /> <span className="text-[10px] text-muted">BAR</span>
                  </span>
                </div>
                <div className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-amber-400 to-red-500"
                    animate={{ width: `${boostPercent}%` }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[9px] text-muted">
                  <span>-0.2 Bar</span>
                  <span className="text-amber-300 font-bold">PEAK: {perf.peakBoost.toFixed(2)} Bar</span>
                  <span>1.5 Bar</span>
                </div>
              </div>

              {/* Canlı Dyno (Tork & Güç) */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/10 bg-black/40 p-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted">
                    TAHMİNİ TORK
                  </div>
                  <div className="my-0.5 text-xl font-bold text-main font-display tabular-nums">
                    <SmoothNumber value={estimatedTorqueNm} digits={0} /> <span className="text-xs font-normal text-muted">Nm</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-primary" style={{ width: `${torquePercent}%` }} />
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/40 p-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted">
                    TAHMİNİ GÜÇ
                  </div>
                  <div className="my-0.5 text-xl font-bold text-main font-display tabular-nums">
                    <SmoothNumber value={estimatedHorsepower} digits={0} /> <span className="text-xs font-normal text-muted">HP</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-amber-400" style={{ width: `${hpPercent}%` }} />
                  </div>
                </div>
              </div>

              {/* Sekme Seçici */}
              <div className="grid grid-cols-5 gap-1 border-t border-white/10 pt-2">
                {dashboardTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-xl border py-1.5 text-center text-[10px] font-bold uppercase tracking-wider transition ${activeTab === tab.id
                        ? "border-primary bg-primary/20 text-primary shadow-[0_0_12px_var(--theme-glow)]"
                        : "border-white/10 bg-white/5 text-muted hover:bg-white/10"
                      }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* SAĞ KADRAN: DEVİR (RPM) VE SICAKLIK */}
            <div className="flex flex-col items-center justify-between rounded-3xl border border-card-border bg-card p-4 shadow-2xl backdrop-blur-md">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
                MOTOR DEVRİ
              </div>
              <RadialGauge
                value={rpm}
                min={0}
                max={5000}
                title="RPM"
                unit="D/D"
                size={230}
                redlineStart={4200}
                highlightColor="var(--theme-secondary)"
                subValue={
                  <span className="text-xs font-semibold text-muted tabular-nums">
                    Yük: {load !== null ? `${load.toFixed(0)}%` : "--"}
                  </span>
                }
              />
              <div className="flex w-full items-center justify-between border-t border-white/10 pt-2 text-xs">
                <span className="text-muted">Motor Sıcaklığı:</span>
                <span className={`font-bold tabular-nums ${coolant && coolant >= 98 ? "text-red-400" : "text-emerald-400"}`}>
                  <SmoothNumber value={coolant} digits={0} /> °C
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* ---------------- PORTRAIT MODE (VERTICAL VEHICLE CLUSTER) ---------------- */
          <div className="flex flex-col gap-3">
            {/* ANA HIZ VE KOKPİT TELEMETRİ KARTI */}
            <section className="relative overflow-hidden rounded-[2.5rem] border border-card-border bg-card p-5 shadow-2xl backdrop-blur-md">
              {/* Arka Plan Hız İvme Efekti */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,var(--theme-glow),transparent_70%)] opacity-30"
              />

              {/* Üst Bilgi Satırı */}
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
                  <span className="h-2 w-2 rounded-full bg-primary" /> ANLIK TELEMETRİ
                </span>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary font-display">
                    VİTES: {currentGear}
                  </span>
                </div>
              </div>

              {/* ANA HIZ SAYACI */}
              <div className="py-4 text-center">
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="inline-block"
                >
                  <div className="cluster-glow text-[clamp(5.5rem,24vw,9rem)] font-light leading-none tracking-tight text-main font-display tabular-nums">
                    <SmoothNumber value={speed} digits={0} fast={true} />
                  </div>
                  <div className="mt-1 text-sm font-bold uppercase tracking-[0.4em] text-primary font-display">
                    KM / SAAT
                  </div>
                </motion.div>
              </div>

              {/* GAUGE BARS: TURBO BOOST & DYNO GÜÇ */}
              <div className="space-y-3 pt-2">
                {/* Turbo Boost Barı */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
                    <span className="flex items-center gap-1 text-muted">
                      <span>🌀</span> TURBO BASINCI
                    </span>
                    <span className="text-primary font-display tabular-nums">
                      <SmoothNumber value={turboBoost} digits={2} fast={true} /> <span className="text-[9px] text-muted">BAR</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-amber-400 to-red-500"
                      animate={{ width: `${boostPercent}%` }}
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] text-muted">
                    <span>0.0 Bar</span>
                    <span className="text-amber-300 font-semibold">PEAK: {perf.peakBoost.toFixed(2)} Bar</span>
                    <span>1.5 Bar</span>
                  </div>
                </div>

                {/* Dyno Tork & Beygir Barı */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-2.5">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted">
                      <span>TORK</span>
                      <span className="text-primary font-display tabular-nums">
                        <SmoothNumber value={estimatedTorqueNm} digits={0} /> <span className="text-[8px] text-muted">Nm</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-primary" style={{ width: `${torquePercent}%` }} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/40 p-2.5">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted">
                      <span>GÜÇ</span>
                      <span className="text-amber-300 font-display tabular-nums">
                        <SmoothNumber value={estimatedHorsepower} digits={0} /> <span className="text-[8px] text-muted">HP</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-amber-400" style={{ width: `${hpPercent}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* HIZLI KONTROL KARTLARI */}
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Anlık Tüketim
                  </div>
                  <div className="mt-1 text-2xl font-light text-main font-display tabular-nums">
                    <SmoothNumber value={fuel} digits={2} />
                    <span className="ml-1 text-xs text-primary">{fuelUnit}</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/8 bg-black/30 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Motor Sıcaklığı
                  </div>
                  <div className="mt-1 text-2xl font-light text-main font-display tabular-nums">
                    <SmoothNumber value={coolant} digits={0} />
                    <span className="ml-1 text-xs text-primary">°C</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MULTI-FUNCTION DISPLAY (MFD) TABS & CONTENT                              */}
        {/* ========================================================================= */}
        <section className="flex flex-col gap-3 rounded-[2.5rem] border border-card-border bg-card p-4 shadow-2xl backdrop-blur-md">
          {/* MFD Sekme Başlıkları */}
          <div className="grid grid-cols-5 gap-1.5">
            {dashboardTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-[46px] rounded-2xl border px-1 py-1.5 text-center transition active:scale-95 ${isActive
                      ? "border-primary bg-primary/20 text-primary shadow-[0_0_16px_var(--theme-glow)] font-bold"
                      : "border-white/10 bg-black/30 text-muted hover:bg-white/5"
                    }`}
                >
                  <div className="text-xs">{tab.icon}</div>
                  <div className="mt-0.5 text-[9px] uppercase tracking-wider font-display sm:text-[10px]">
                    {tab.label}
                  </div>
                </button>
              );
            })}
          </div>

          {/* SEKME 1: SÜRÜŞ (DRIVE HUD) */}
          {activeTab === "surus" && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Trip Mesafesi
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={trip.distanceKm} digits={2} /> <span className="text-xs text-primary">KM</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Trip Yakıt Tutarı
                </div>
                <div className="mt-1 text-2xl font-bold text-emerald-400 font-display tabular-nums">
                  <SmoothNumber value={tripTotalCostTL} digits={2} /> <span className="text-xs text-emerald-500">₺</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Ortalama Tüketim
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={avgFuelL100km} digits={2} /> <span className="text-xs text-primary">L/100km</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Ortalama Hız
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={avgSpeedKmh} digits={0} /> <span className="text-xs text-primary">KM/H</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Anlık Maliyet
                </div>
                <div className="mt-1 text-2xl font-bold text-amber-300 font-display tabular-nums">
                  <SmoothNumber value={instantCostTLPerKm} digits={2} /> <span className="text-xs text-amber-400">₺/km</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Motor Yükü
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={load} digits={0} /> <span className="text-xs text-primary">%</span>
                </div>
              </div>
            </div>
          )}

          {/* SEKME 2: TRİP (YOL BİLGİSAYARI & GEÇMİŞ SÜRÜŞLER) */}
          {activeTab === "trip" && (
            <div className="flex flex-col gap-3">
              {/* Alt Sekme Seçici: Güncel Sürüş vs Geçmiş Sürüşler */}
              <div className="flex items-center gap-1 rounded-2xl border border-card-border bg-card p-1">
                <button
                  type="button"
                  onClick={() => setTripSubView("current")}
                  className={`flex-1 rounded-xl py-2 text-xs font-bold uppercase tracking-wider transition ${
                    tripSubView === "current"
                      ? "border border-primary/50 bg-primary/20 text-primary shadow-[0_0_12px_var(--theme-glow)]"
                      : "text-muted hover:text-main"
                  }`}
                >
                  📊 Güncel Sürüş
                </button>
                <button
                  type="button"
                  onClick={() => setTripSubView("history")}
                  className={`flex-1 rounded-xl py-2 text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 ${
                    tripSubView === "history"
                      ? "border border-primary/50 bg-primary/20 text-primary shadow-[0_0_12px_var(--theme-glow)]"
                      : "text-muted hover:text-main"
                  }`}
                >
                  <span>🗂️ Geçmiş Sürüşler</span>
                  {tripHistory.length > 0 && (
                    <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-extrabold text-primary">
                      {tripHistory.length}
                    </span>
                  )}
                </button>
              </div>

              {/* 1. GÜNCEL SÜRÜŞ GÖRÜNÜMÜ */}
              {tripSubView === "current" && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Kat Edilen Yol
                      </div>
                      <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                        <SmoothNumber value={trip.distanceKm} digits={2} /> <span className="text-xs text-primary">KM</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Harcanan Mazot
                      </div>
                      <div className="mt-1 text-2xl font-bold text-amber-300 font-display tabular-nums">
                        <SmoothNumber value={trip.fuelLiters} digits={2} /> <span className="text-xs text-amber-400">L</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Toplam Yakıt Masrafı
                      </div>
                      <div className="mt-1 text-2xl font-bold text-emerald-400 font-display tabular-nums">
                        <SmoothNumber value={tripTotalCostTL} digits={2} /> <span className="text-xs text-emerald-500">₺</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Ortalama Tüketim
                      </div>
                      <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                        <SmoothNumber value={avgFuelL100km} digits={2} /> <span className="text-xs text-primary">L/100km</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Ortalama Hız
                      </div>
                      <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                        <SmoothNumber value={avgSpeedKmh} digits={0} /> <span className="text-xs text-primary">KM/H</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Maksimum Hız
                      </div>
                      <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                        <SmoothNumber value={trip.maxSpeed} digits={0} /> <span className="text-xs text-primary">KM/H</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Sürüş Süresi
                      </div>
                      <div className="mt-1 text-xl font-bold text-main font-display tabular-nums">
                        {formatTrip(trip.durationMs)}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        Hareket Süresi
                      </div>
                      <div className="mt-1 text-xl font-bold text-main font-display tabular-nums">
                        {formatTrip(trip.movingDurationMs)}
                      </div>
                    </div>
                  </div>

                  {/* Canlı GPS Güzergahı Kartı */}
                  <div className="flex flex-col justify-between gap-3 rounded-2xl border border-card-border bg-card p-3.5 shadow-md sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🗺️</span>
                      <div>
                        <div className="text-xs font-bold text-main font-display">
                          Canlı GPS Güzergah Takibi
                        </div>
                        <div className="text-[10px] text-muted">
                          {gpsActive
                            ? `${routePoints.length} GPS noktası kaydedildi (Hassasiyet: ±${gpsAccuracy ?? 5}m)`
                            : "GPS sinyali aranıyor..."}
                        </div>
                      </div>
                    </div>

                    {routePoints.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedMapTrip({
                            id: "live_trip_temp",
                            startTime: trip.startTime,
                            endTime: Date.now(),
                            distanceKm: trip.distanceKm,
                            fuelLiters: trip.fuelLiters,
                            fuelCostTL: tripTotalCostTL,
                            fuelPrice: fuelPrice,
                            avgFuelL100km: avgFuelL100km,
                            avgSpeedKmh: avgSpeedKmh,
                            maxSpeed: trip.maxSpeed,
                            durationMs: trip.durationMs,
                            movingDurationMs: trip.movingDurationMs,
                            routePoints: routePoints,
                          })
                        }
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary/25 active:scale-95 shadow-[0_0_10px_var(--theme-glow)]"
                      >
                        <span>🗺️</span>
                        <span>Haritada Canlı Gör</span>
                      </button>
                    )}
                  </div>

                  {/* Trip İşlem Butonları */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={archiveCurrentTrip}
                      disabled={trip.distanceKm < 0.05 && routePoints.length < 2}
                      className="flex-1 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 py-3 text-xs font-bold uppercase tracking-widest text-emerald-200 transition hover:bg-emerald-500/25 active:scale-98 disabled:opacity-40"
                    >
                      💾 Sürüşü Geçmişe Kaydet
                    </button>
                    <button
                      type="button"
                      onClick={resetTrip}
                      className="flex-1 rounded-2xl border border-red-500/40 bg-red-500/15 py-3 text-xs font-bold uppercase tracking-widest text-red-200 transition hover:bg-red-500/25 active:scale-98"
                    >
                      🔄 Yeni Sürüş Başlat / Sıfırla
                    </button>
                  </div>
                </div>
              )}

              {/* 2. GEÇMİŞ SÜRÜŞLER LİSTESİ */}
              {tripSubView === "history" && (
                <div className="flex flex-col gap-3">
                  {tripHistory.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {/* Toplam Özet Kartı */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-2xl border border-primary/20 bg-primary/5 p-3">
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-muted">Toplam Sürüş</div>
                          <div className="text-xl font-bold text-main font-display">{tripHistory.length} Adet</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-muted">Toplam Mesafe</div>
                          <div className="text-xl font-bold text-primary font-display">
                            {tripHistory.reduce((acc, t) => acc + t.distanceKm, 0).toFixed(1)} KM
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-muted">Toplam Yakıt</div>
                          <div className="text-xl font-bold text-amber-300 font-display">
                            {tripHistory.reduce((acc, t) => acc + t.fuelLiters, 0).toFixed(1)} L
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-muted">Toplam Tutar</div>
                          <div className="text-xl font-bold text-emerald-400 font-display">
                            {tripHistory.reduce((acc, t) => acc + t.fuelCostTL, 0).toFixed(2)} ₺
                          </div>
                        </div>
                      </div>

                      {/* Üst İşlem Butonları */}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={exportTripHistoryJson}
                          className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold text-muted transition hover:bg-white/10 active:scale-95"
                        >
                          <span>📥</span>
                          <span>JSON İndir</span>
                        </button>
                        <button
                          type="button"
                          onClick={clearAllTripHistory}
                          className="flex items-center gap-1 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold text-red-300 transition hover:bg-red-500/20 active:scale-95"
                        >
                          <span>🗑️</span>
                          <span>Tüm Geçmişi Sil</span>
                        </button>
                      </div>

                      {/* Sürüş Kartları */}
                      <div className="flex flex-col gap-2.5">
                        {tripHistory.map((hTrip) => (
                          <div
                            key={hTrip.id}
                            className="flex flex-col gap-2.5 rounded-2xl border border-card-border bg-card p-3.5 shadow-lg backdrop-blur-md"
                          >
                            <div className="flex items-center justify-between border-b border-white/5 pb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-base">📅</span>
                                <div>
                                  <div className="text-xs font-bold text-main font-display">
                                    {new Date(hTrip.startTime).toLocaleDateString("tr-TR", {
                                      day: "numeric",
                                      month: "long",
                                      year: "numeric",
                                    })}
                                  </div>
                                  <div className="text-[10px] text-muted">
                                    Saat: {new Date(hTrip.startTime).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                                    {" - "}
                                    {new Date(hTrip.endTime).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => deleteTrip(hTrip.id)}
                                className="rounded-lg p-1.5 text-muted hover:bg-red-500/20 hover:text-red-300 active:scale-90 transition"
                                title="Bu sürüşü sil"
                              >
                                🗑️
                              </button>
                            </div>

                            {/* Sürüş Veri Izgarası */}
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 text-center">
                              <div className="rounded-xl border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] text-muted uppercase">Mesafe</div>
                                <div className="text-sm font-bold text-primary font-display">{hTrip.distanceKm.toFixed(1)} KM</div>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] text-muted uppercase">Harcanan</div>
                                <div className="text-sm font-bold text-amber-300 font-display">{hTrip.fuelLiters.toFixed(2)} L</div>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] text-muted uppercase">Tutar</div>
                                <div className="text-sm font-bold text-emerald-400 font-display">{hTrip.fuelCostTL.toFixed(2)} ₺</div>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] text-muted uppercase">Ort. Tüketim</div>
                                <div className="text-sm font-bold text-main font-display">
                                  {hTrip.avgFuelL100km ? `${hTrip.avgFuelL100km.toFixed(1)} L` : "--"}
                                </div>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] text-muted uppercase">Maks Hız</div>
                                <div className="text-sm font-bold text-main font-display">{hTrip.maxSpeed} KM/H</div>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] text-muted uppercase">Sürüş Süresi</div>
                                <div className="text-xs font-bold text-main font-display">{formatTrip(hTrip.durationMs)}</div>
                              </div>
                            </div>

                            {/* Harita Butonu */}
                            <button
                              type="button"
                              onClick={() => setSelectedMapTrip(hTrip)}
                              className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/15 py-2 text-xs font-bold text-primary transition hover:bg-primary/25 active:scale-98 shadow-[0_0_10px_var(--theme-glow)]"
                            >
                              <span>🗺️</span>
                              <span>
                                {hTrip.routePoints && hTrip.routePoints.length > 0
                                  ? `Güzergahı Haritada Gör (${hTrip.routePoints.length} GPS Noktası)`
                                  : "Güzergah Haritasını İncele"}
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-muted">
                      <span className="text-4xl">🗂️</span>
                      <div className="mt-2 text-sm font-bold text-main font-display">Henüz Kayıtlı Geçmiş Sürüş Yok</div>
                      <p className="mt-1 text-xs max-w-xs">
                        Sürüşünüz bittiğinde &quot;Sürüşü Geçmişe Kaydet&quot; veya &quot;Trip Sıfırla&quot; butonuna basarak tüm telemetriyi ve GPS güzergahınızı buraya kaydedebilirsiniz.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SEKME 3: PERFORMANS (0-100 DRAG & DYNO) */}
          {activeTab === "performans" && (
            <div className="flex flex-col gap-3">
              {/* Dragy / RaceChrono Tarzı Başlatma Kutusu */}
              <div className="rounded-2xl border border-white/10 bg-black/50 p-4 text-center">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xl">⏱️</span>
                  <span className="text-xs font-bold uppercase tracking-widest text-muted">
                    0-100 KM/H HIZLANMA TESTİ
                  </span>
                </div>

                <div className="my-4 flex items-center justify-center gap-4">
                  <div className="text-center">
                    <div className="text-4xl font-extrabold text-main font-display tabular-nums">
                      {perf.t100 ? `${perf.t100.toFixed(2)}s` : perf.status === "timing" ? "Ölçülüyor..." : "--"}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">
                      Son Ölçüm
                    </div>
                  </div>

                  <div className="h-10 w-[1px] bg-white/10" />

                  <div className="text-center">
                    <div className="text-4xl font-extrabold text-amber-300 font-display tabular-nums">
                      {perf.best0_100 ? `${perf.best0_100.toFixed(2)}s` : "--"}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-amber-400">
                      En İyi Süre (PB)
                    </div>
                  </div>
                </div>

                {/* Drag Durum Rozeti */}
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary font-display">
                  <span className="h-2 w-2 rounded-full bg-primary animate-ping" />
                  <span>
                    {perf.status === "ready"
                      ? "HAZIR • GAZA BASIN"
                      : perf.status === "timing"
                        ? "HIZLANMA ÖLÇÜLÜYOR..."
                        : perf.status === "finished"
                          ? "TEST TAMAMLANDI"
                          : "DURUN (0 KM/H)"}
                  </span>
                </div>
              </div>

              {/* Detaylı Performans Metrikleri */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    0-50 km/h
                  </div>
                  <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                    {perf.t50 ? `${perf.t50.toFixed(2)}s` : "--"}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Peak Turbo Boost
                  </div>
                  <div className="mt-1 text-2xl font-bold text-cyan-300 font-display tabular-nums">
                    {perf.peakBoost.toFixed(2)} <span className="text-xs text-muted">Bar</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Anlık Tork
                  </div>
                  <div className="mt-1 text-2xl font-bold text-primary font-display tabular-nums">
                    <SmoothNumber value={estimatedTorqueNm} digits={0} /> <span className="text-xs text-muted">Nm</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Anlık Güç
                  </div>
                  <div className="mt-1 text-2xl font-bold text-amber-300 font-display tabular-nums">
                    <SmoothNumber value={estimatedHorsepower} digits={0} /> <span className="text-xs text-muted">HP</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={resetPerformance}
                className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-xs font-bold uppercase tracking-widest text-muted transition hover:bg-white/10 active:scale-98"
              >
                0-100 ve Peak Basıncı Sıfırla
              </button>
            </div>
          )}

          {/* SEKME 4: MOTOR (SENSÖR MATRİSİ) */}
          {activeTab === "motor" && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Motor Devri (RPM)
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={rpm} digits={0} /> <span className="text-xs text-primary">D/D</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, ((rpm ?? 0) / 5000) * 100)}%` }} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Soğutma Suyu Sıcaklığı
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={coolant} digits={0} /> <span className="text-xs text-primary">°C</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full ${coolant && coolant >= 98 ? "bg-red-500" : "bg-emerald-400"}`} style={{ width: `${coolantPercent}%` }} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Hava Akışı (MAF)
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={maf} digits={2} /> <span className="text-xs text-primary">G/S</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-cyan-400" style={{ width: `${Math.min(100, ((maf ?? 0) / 120) * 100)}%` }} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Motor Yükü
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={load} digits={1} /> <span className="text-xs text-primary">%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-amber-400" style={{ width: `${loadPercent}%` }} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Manifold Basıncı (MAP)
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={map} digits={0} /> <span className="text-xs text-primary">KPA</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Turbo Boost Basıncı
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={turboBoost} digits={2} /> <span className="text-xs text-primary">BAR</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Emme Sıcaklığı (IAT)
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={intakeTemp} digits={0} /> <span className="text-xs text-primary">°C</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Gaz Pedalı Açısı
                </div>
                <div className="mt-1 text-2xl font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={throttle} digits={1} /> <span className="text-xs text-primary">%</span>
                </div>
              </div>
            </div>
          )}

          {/* SEKME 5: SAĞLIK (SİSTEM & TEŞHİS) */}
          {activeTab === "saglik" && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  OBD-II Bağlantı Protokolü
                </div>
                <div className="mt-1 text-lg font-bold text-primary font-display">
                  ISO 14230-4 KWP Fast (ATSP5)
                </div>
                <div className="mt-1 text-xs text-muted">
                  Toyota 2006 K-Line hızlı protokol başlatma
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Arıza Lambası (MIL) Mesafesi
                </div>
                <div className="mt-1 text-lg font-bold text-main font-display tabular-nums">
                  <SmoothNumber value={data?.distance_mil_on ?? 0} digits={0} /> <span className="text-xs text-muted">KM</span>
                </div>
                <div className="mt-1 text-xs text-emerald-400">
                  {(data?.distance_mil_on ?? 0) === 0 ? "✓ Aktif arıza kodu yok" : "⚠️ Arıza kodu mevcut"}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Son Telemetri Paketi
                </div>
                <div className="mt-1 text-lg font-bold text-main font-display tabular-nums">
                  {formatTimestamp(data?.updated_at ?? null)}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Ekran Kilidi (WakeLock)
                </div>
                <div className="mt-1 text-lg font-bold text-main font-display">
                  {wakeLockActive ? "🟢 Aktif (Ekran Kapanmaz)" : "⚪ Pasif"}
                </div>
                <div className="mt-1 text-xs text-muted">
                  Ön plandayken ekranın kararıp kapanmasını önler
                </div>
              </div>

              {/* Arka Plan Foreground Service Durumu */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Arka Plan Servisi (Foreground)
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleBackgroundService()}
                    className={`rounded-lg px-2 py-0.5 text-[9px] font-bold tracking-wider transition ${
                      bgServiceActive
                        ? "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                        : "border border-white/10 bg-white/5 text-muted"
                    }`}
                  >
                    {bgServiceActive ? "KAPAT" : "BAŞLAT"}
                  </button>
                </div>
                <div className="mt-1 text-lg font-bold font-display">
                  {bgServiceActive ? (
                    <span className="text-emerald-400">🟢 Çalışıyor (Kalıcı Bildirim)</span>
                  ) : (
                    <span className="text-muted">⚪ Pasif</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted">
                  Ekran kilitliyken veya harita açıkken Bluetooth, yakıt ve GPS kaydına devam eder
                </div>
              </div>

              {/* Android Pil Optimizasyonu (Doze Koruması) */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Android Pil Koruması (Doze)
                  </div>
                  {isNative && isIgnoringBattery === false && (
                    <button
                      type="button"
                      onClick={() => void backgroundService.requestBatteryOptimizationExemption()}
                      className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold tracking-wider text-amber-300 transition hover:bg-amber-500/30 active:scale-95"
                    >
                      İSTİSNA TANIMLA ⚙️
                    </button>
                  )}
                </div>
                <div className="mt-1 text-lg font-bold font-display">
                  {isIgnoringBattery === true ? (
                    <span className="text-emerald-400">✅ Muaf (Kısıtlamasız Sürüş)</span>
                  ) : isIgnoringBattery === false ? (
                    <span className="text-amber-400">⚠️ Pil Optimizasyonu Aktif</span>
                  ) : (
                    <span className="text-muted">📱 Android Servis Kontrolü</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {isIgnoringBattery === true
                    ? "Android telefonunuz uygulamayı arka planda asla uyutmayacak veya kapatmayacak."
                    : "Samsung / Xiaomi / Huawei gibi cihazlarda arka planda kapanmayı önlemek için muafiyet tanımlayınız."}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ========================================================================= */}
      {/* YAKIT FİYATI DÜZENLEME MODALI                                            */}
      {/* ========================================================================= */}
      {isFuelModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-sm rounded-[2rem] border border-amber-500/40 bg-[#0c0e14] p-6 shadow-2xl text-main"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⛽</span>
                <h3 className="text-sm font-bold uppercase tracking-widest text-amber-300 font-display">
                  Mazot Litre Fiyatı
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFuelModalOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-muted hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            <div className="py-5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Pompa Litre Fiyatı (TL)
              </div>

              <div className="mt-3 flex items-center justify-center gap-2">
                <input
                  type="number"
                  step="0.05"
                  autoFocus
                  value={fuelPriceInput}
                  onChange={(e) => setFuelPriceInput(e.target.value)}
                  className="w-36 rounded-2xl border border-amber-500/50 bg-black/80 px-3 py-2 text-center text-3xl font-bold text-amber-300 shadow-inner outline-none focus:border-amber-400 font-display tabular-nums"
                />
                <span className="text-xl font-bold text-muted">₺ / L</span>
              </div>

              {/* Hızlı Ayar Butonları */}
              <div className="mt-4 flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(-1.0)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-muted hover:bg-white/10 active:scale-95"
                >
                  -1.00 ₺
                </button>
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(-0.1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-muted hover:bg-white/10 active:scale-95"
                >
                  -0.10 ₺
                </button>
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(0.1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-muted hover:bg-white/10 active:scale-95"
                >
                  +0.10 ₺
                </button>
                <button
                  type="button"
                  onClick={() => adjustFuelPrice(1.0)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-muted hover:bg-white/10 active:scale-95"
                >
                  +1.00 ₺
                </button>
              </div>

              {/* Örnek Hesap Tablosu */}
              <div className="mt-5 rounded-2xl border border-white/8 bg-black/40 p-3 text-left text-xs text-muted">
                <div className="flex justify-between py-0.5">
                  <span>100 km (Ort. 5.0 L):</span>
                  <span className="font-bold text-main tabular-nums">
                    {((parseFloat(fuelPriceInput) || fuelPrice) * 5).toFixed(2)} ₺
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>Tam Depo (55 L):</span>
                  <span className="font-bold text-main tabular-nums">
                    {((parseFloat(fuelPriceInput) || fuelPrice) * 55).toFixed(2)} ₺
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsFuelModalOpen(false)}
                className="w-1/3 rounded-2xl border border-white/10 bg-white/5 py-3 text-xs font-bold uppercase tracking-wider text-muted hover:bg-white/10 active:scale-98"
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
                className="w-2/3 rounded-2xl border border-amber-500/50 bg-amber-500/25 py-3 text-xs font-bold uppercase tracking-widest text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.2)] transition hover:bg-amber-500/35 active:scale-98"
              >
                Fiyatı Kaydet
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* GPS GÜZERGAH VE HARİTA DETAY MODALI                                      */}
      {/* ========================================================================= */}
      {selectedMapTrip ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-3xl border border-primary/40 bg-card p-4 shadow-2xl backdrop-blur-xl"
          >
            {/* Modal Başlığı */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xl">🗺️</span>
                <div>
                  <div className="text-sm font-bold text-main font-display">
                    {new Date(selectedMapTrip.startTime).toLocaleDateString("tr-TR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}{" "}
                    - Sürüş Güzergahı
                  </div>
                  <div className="text-[10px] text-muted">
                    {new Date(selectedMapTrip.startTime).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                    {" - "}
                    {new Date(selectedMapTrip.endTime).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedMapTrip(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm text-muted hover:bg-white/15 hover:text-main"
              >
                ✕
              </button>
            </div>

            {/* Hızlı İstatistik Rozetleri */}
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-xl border border-white/5 bg-black/40 p-2">
                <div className="text-[9px] text-muted uppercase">Mesafe</div>
                <div className="font-bold text-primary font-display">{selectedMapTrip.distanceKm.toFixed(1)} KM</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/40 p-2">
                <div className="text-[9px] text-muted uppercase">Tutar</div>
                <div className="font-bold text-emerald-400 font-display">{selectedMapTrip.fuelCostTL.toFixed(2)} ₺</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/40 p-2">
                <div className="text-[9px] text-muted uppercase">Ort. Tüketim</div>
                <div className="font-bold text-amber-300 font-display">
                  {selectedMapTrip.avgFuelL100km ? `${selectedMapTrip.avgFuelL100km.toFixed(1)} L` : "--"}
                </div>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/40 p-2">
                <div className="text-[9px] text-muted uppercase">Süre</div>
                <div className="font-bold text-main font-display">{formatTrip(selectedMapTrip.durationMs)}</div>
              </div>
            </div>

            {/* İnteraktif Koyu Harita */}
            <div className="flex-1 overflow-hidden">
              <TripRouteMap
                points={selectedMapTrip.routePoints || []}
                themeColor="var(--theme-primary)"
                height="340px"
                startLabel="Sürüş Başlangıcı"
                endLabel="Sürüş Bitişi"
              />
            </div>

            {/* Kapat Butonu */}
            <button
              type="button"
              onClick={() => setSelectedMapTrip(null)}
              className="w-full rounded-2xl border border-white/10 bg-white/10 py-2.5 text-xs font-bold uppercase tracking-wider text-main transition hover:bg-white/15 active:scale-98"
            >
              Kapat
            </button>
          </motion.div>
        </div>
      ) : null}
    </main>
  );
}
