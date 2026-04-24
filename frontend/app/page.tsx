"use client";

import { animate, motion } from "framer-motion";
import useSWR from "swr";
import { useEffect, useMemo, useRef, useState } from "react";

type DashboardTab = "surus" | "motor" | "saglik";

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
  last_error: string | null;
  updated_at: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";
const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
  { id: "surus", label: "SÜRÜŞ" },
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
}: {
  value: number | null | undefined;
  digits: number;
  fallback?: string;
}) {
  const [display, setDisplay] = useState<number>(value ?? 0);
  const previousRef = useRef<number>(value ?? 0);

  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return;
    }
    const controls = animate(previousRef.current, value, {
      duration: 0.35,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(latest),
    });
    previousRef.current = value;
    return () => controls.stop();
  }, [value]);

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
  const { data, error } = useSWR(`${API_BASE}/live-data`, fetcher, {
    refreshInterval: 500,
    dedupingInterval: 200,
    revalidateOnFocus: false,
  });

  const [tripStart, setTripStart] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [activeTab, setActiveTab] = useState<DashboardTab>("surus");
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);
  const [wakeLockSupported, setWakeLockSupported] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<ScreenWakeLock | null>(null);
  const isLandscape = useLandscape();
  const isPortrait = !isLandscape;

  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setWakeLockSupported(Boolean((navigator as NavigatorWithWakeLock).wakeLock));
  }, []);

  useEffect(() => {
    if (data?.connected && tripStart === null) {
      setTripStart(Date.now());
    }
  }, [data?.connected, tripStart]);

  useEffect(() => {
    const releaseWakeLock = async () => {
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      setWakeLockActive(false);

      if (!lock) {
        return;
      }

      try {
        await lock.release();
      } catch {
        // Ignore release failures; the browser may already have revoked the lock.
      }
    };

    const requestWakeLock = async () => {
      const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!wakeLock) {
        setWakeLockEnabled(false);
        setWakeLockActive(false);
        return;
      }

      if (document.visibilityState !== "visible") {
        return;
      }

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
        return;
      }

      void releaseWakeLock();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void requestWakeLock();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [data?.connected, wakeLockEnabled, wakeLockSupported]);

  useEffect(() => {
    if (activeTab === "surus" || activeTab === "motor" || activeTab === "saglik") {
      return;
    }

    setActiveTab("surus");
  }, [activeTab]);

  const rpm = data?.rpm ?? null;
  const speed = data?.speed_kmh ?? null;
  const maf = data?.maf_gps ?? null;
  const coolant = data?.coolant_temp_c ?? null;
  const load = data?.load_percent ?? null;
  const intakeTemp = data?.intake_temp_c ?? null;
  const throttle = data?.throttle_percent ?? null;
  const map = data?.map_kpa ?? null;
  const distance = data?.distance_mil_on ?? null;
  const turboBoost = data?.turbo_boost_bar ?? null;
  const fuel = data?.fuel_display ?? null;
  const fuelUnit = data?.fuel_unit ?? "--";

  const rpmPercent = Math.max(0, Math.min(100, ((rpm ?? 0) / 5000) * 100));

  const tripLabel = useMemo(() => {
    if (tripStart === null) {
      return "00:00:00";
    }
    return formatTrip(Date.now() - tripStart);
  }, [tripStart, tick]);

  const statusLabel = error
    ? "Connection lost"
    : data?.connected
      ? "Live"
      : "Reconnecting";

  const activeMetrics =
    activeTab === "surus"
      ? [
          {
            label: "Anlık Tüketim",
            value: <SmoothNumber value={fuel} digits={2} />,
            unit: fuelUnit,
          },
          {
            label: "Trip Time",
            value: tripLabel,
            unit: "",
          },
          {
            label: "Distance MIL",
            value: <SmoothNumber value={distance} digits={0} />,
            unit: "km",
          },
          {
            label: "Hız",
            value: <SmoothNumber value={speed} digits={0} />,
            unit: "km/h",
          },
        ]
      : activeTab === "motor"
        ? [
            {
              label: "RPM",
              value: <SmoothNumber value={rpm} digits={0} />,
              unit: "",
            },
            {
              label: "Coolant Temp",
              value: <SmoothNumber value={coolant} digits={0} />,
              unit: "°C",
            },
            {
              label: "MAF",
              value: <SmoothNumber value={maf} digits={2} />,
              unit: "g/s",
            },
            {
              label: "Engine Load",
              value: <SmoothNumber value={load} digits={1} />,
              unit: "%",
            },
            {
              label: "Intake Temp",
              value: <SmoothNumber value={intakeTemp} digits={0} />,
              unit: "°C",
            },
            {
              label: "Throttle",
              value: <SmoothNumber value={throttle} digits={1} />,
              unit: "%",
            },
            {
              label: "MAP",
              value: <SmoothNumber value={map} digits={0} />,
              unit: "kPa",
            },
            {
              label: "Turbo Boost",
              value: <SmoothNumber value={turboBoost} digits={2} />,
              unit: "Bar",
            },
          ]
        : [
            {
              label: "Bağlantı",
              value: data?.connected ? "Bağlı" : "Bekleniyor",
              unit: "",
            },
            {
              label: "Son Hata",
              value: data?.last_error ?? "Yok",
              unit: "",
            },
            {
              label: "Güncelleme",
              value: formatTimestamp(data?.updated_at ?? null),
              unit: "",
            },
            {
              label: "Ekran Kilidi",
              value: wakeLockActive ? "Açık" : "Kapalı",
              unit: "",
            },
          ];

  const toggleWakeLock = async () => {
    if (!wakeLockSupported) {
      return;
    }

    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) {
      return;
    }

    if (wakeLockEnabled) {
      setWakeLockEnabled(false);
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      setWakeLockActive(false);

      if (lock) {
        try {
          await lock.release();
        } catch {
          // Ignore release failures.
        }
      }

      return;
    }

    setWakeLockEnabled(true);

    if (document.visibilityState !== "visible") {
      return;
    }

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
        <section className="flex flex-col justify-between rounded-[2rem] border border-white/8 bg-white/[0.03] p-5 shadow-[0_0_50px_rgba(241,235,220,0.04)] backdrop-blur-[1px]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.3em] text-[var(--ivory-muted)] sm:text-[11px]">
              <span>AuraDrive</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] tracking-[0.22em] text-[var(--ivory)] sm:text-[11px]">
                {statusLabel}
              </span>
            </div>

            <div className="h-[6px] w-full overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-[var(--ivory)]"
                animate={{ width: `${rpmPercent}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-[var(--ivory-muted)] sm:text-[11px]">
              <span>RPM</span>
              <span>
                <SmoothNumber value={rpm} digits={0} /> / 5000
              </span>
            </div>
          </div>

          <div className="py-8 text-center leading-none sm:py-10">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="leading-none"
            >
              <div className="ivory-glow text-[clamp(5rem,18vw,11rem)] font-light tracking-[-0.06em] text-[var(--ivory)]">
                <SmoothNumber value={speed} digits={0} />
              </div>
              <div className="mt-2 text-[0.8rem] uppercase tracking-[0.35em] text-[var(--ivory-muted)]">
                KM/H
              </div>
            </motion.div>

            <div className="mt-8 text-sm uppercase tracking-[0.24em] text-[var(--ivory-muted)]">
              Instant Consumption
            </div>
            <div className="mt-1 flex items-end justify-center gap-2">
              <div className="ivory-glow text-3xl font-light tracking-[-0.02em] text-[var(--ivory)]">
                <SmoothNumber value={fuel} digits={2} />
              </div>
              <span className="pb-[0.3rem] text-sm uppercase tracking-[0.18em] text-[var(--ivory-muted)]">
                {fuelUnit}
              </span>
            </div>
          </div>

          <div className="grid gap-3 text-center sm:grid-cols-2">
            <div className="rounded-3xl border border-white/8 bg-white/[0.02] px-4 py-4 shadow-[0_0_24px_rgba(241,235,220,0.04)]">
              <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--ivory-muted)] sm:text-[11px]">
                Coolant Temp
              </p>
              <p className="ivory-glow mt-2 text-3xl font-light text-[var(--ivory)]">
                <SmoothNumber value={coolant} digits={0} />
                <span className="ml-1 text-base">°C</span>
              </p>
            </div>

            <div className="rounded-3xl border border-white/8 bg-white/[0.02] px-4 py-4 shadow-[0_0_24px_rgba(241,235,220,0.04)]">
              <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--ivory-muted)] sm:text-[11px]">
                Trip Time
              </p>
              <p className="ivory-glow mt-2 text-3xl font-light text-[var(--ivory)]">{tripLabel}</p>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-[2rem] border border-white/8 bg-white/[0.03] p-4 shadow-[0_0_50px_rgba(241,235,220,0.03)] backdrop-blur-[1px]">
          {!isPortrait ? (
            <div className="grid grid-cols-3 gap-2">
              {dashboardTabs.map((tab) => {
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`min-h-[60px] rounded-2xl border px-3 text-[11px] uppercase tracking-[0.24em] transition active:scale-[0.98] sm:text-[12px] ${
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

          <div className={`grid gap-3 ${isLandscape ? "lg:grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
            {activeMetrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-[1.5rem] border border-white/8 bg-white/[0.02] px-4 py-4 shadow-[0_0_26px_rgba(241,235,220,0.04)]"
              >
                <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--ivory-muted)] sm:text-[11px]">
                  {metric.label}
                </p>
                <p className="ivory-glow mt-2 flex flex-wrap items-end gap-x-2 gap-y-1 text-3xl font-light text-[var(--ivory)]">
                  <span>{metric.value}</span>
                  {metric.unit ? (
                    <span className="pb-[0.2rem] text-sm uppercase tracking-[0.18em] text-[var(--ivory-muted)]">
                      {metric.unit}
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-2 rounded-[1.75rem] border border-white/10 bg-black/80 p-2 shadow-[0_0_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {dashboardTabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[56px] rounded-[1.25rem] border px-2 text-[10px] uppercase tracking-[0.22em] transition active:scale-[0.98] ${
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
            className="min-h-[56px] rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-2 text-[10px] uppercase tracking-[0.22em] text-[var(--ivory)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            aria-pressed={wakeLockEnabled}
            disabled={!wakeLockSupported}
          >
            {wakeLockSupported ? (wakeLockActive ? "EKRAN AÇIK" : "EKRAN") : "YOK"}
          </button>
        </div>
      </div>
    </main>
  );
}
