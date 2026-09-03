import React from "react";

export type AuraLogoSize = "sm" | "md" | "lg" | number;
export type AuraLogoVariant = "icon-only" | "full-with-text";

interface AuraLogoProps {
  size?: AuraLogoSize;
  variant?: AuraLogoVariant;
  className?: string;
}

const SIZE_MAP: Record<string, number> = {
  sm: 32,
  md: 44,
  lg: 64,
};

export const AuraLogo: React.FC<AuraLogoProps> = ({
  size = "md",
  variant = "icon-only",
  className = "",
}) => {
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size] || 44;

  const iconSvg = (
    <svg
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 transition-transform duration-300 hover:scale-105"
      aria-label="AuraDrive Pro 2006 Toyota Corolla E120 Logosu"
    >
      <defs>
        {/* Arka Plan Koyu Karbon Gradyanı */}
        <radialGradient id="auraBgGrad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="60%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#020617" />
        </radialGradient>

        {/* 2006 Gece Mavisi Kaporta Metalik Gradyanı */}
        <linearGradient id="corollaNavyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
          <stop offset="25%" stopColor="#1e40af" />
          <stop offset="70%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>

        {/* Telemetri Kadran Arkı Gradyanı (Cyan'dan Fütüristik Amber'a) */}
        <linearGradient id="gaugeArcGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="55%" stopColor="#0ea5e9" />
          <stop offset="80%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>

        {/* Far & DRL Işıltı Gradyanı */}
        <linearGradient id="headlightCyan" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>

        {/* Amber Sinyal & Vurgu Gradyanı */}
        <linearGradient id="amberAccent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>

        {/* Neon Glow Filtresi */}
        <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* 1. Dairesel Karbon Kalkan Tabanı */}
      <circle cx="60" cy="60" r="56" fill="url(#auraBgGrad)" stroke="#334155" strokeWidth="1.5" />

      {/* 2. Dış Telemetri Kadran Halkası (Tachometer Gauge Ticks) */}
      <circle
        cx="60"
        cy="60"
        r="51"
        stroke="#1e293b"
        strokeWidth="2.5"
        strokeDasharray="2 3"
      />
      {/* Aktif RPM & Boost Arkı (240 Derecelik Dinamik İbre Hattı) */}
      <path
        d="M 24 88 A 48 48 0 1 1 96 88"
        stroke="url(#gaugeArcGrad)"
        strokeWidth="3.5"
        strokeLinecap="round"
        filter="url(#neonGlow)"
      />

      {/* Kadran Zirve Noktası (Amber Redline Göstergesi) */}
      <circle cx="96" cy="88" r="3" fill="#f59e0b" filter="url(#neonGlow)" />

      {/* 3. 2006 TOYOTA COROLLA E120 SEDAN SİLÜETİ */}
      <g id="corolla-silhouette">
        {/* Tavan & Ön Cam Çizgileri */}
        <path
          d="M 42 43 C 48 38, 72 38, 78 43 L 83 55 C 80 54, 40 54, 37 55 Z"
          fill="#0f172a"
          stroke="#38bdf8"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* A-Sütunları ve Ön Cam Yansıması */}
        <path
          d="M 46 45 L 43 53 M 74 45 L 77 53"
          stroke="#06b6d4"
          strokeWidth="0.8"
          strokeOpacity="0.6"
        />

        {/* Yan Aynalar (E120 Sedan Karakteristiği) */}
        <path
          d="M 36 53 C 32 53, 31 55, 33 57 C 36 58, 38 56, 37 54 Z"
          fill="url(#corollaNavyGrad)"
          stroke="#06b6d4"
          strokeWidth="0.8"
        />
        <path
          d="M 84 53 C 88 53, 89 55, 87 57 C 84 58, 82 56, 83 54 Z"
          fill="url(#corollaNavyGrad)"
          stroke="#06b6d4"
          strokeWidth="0.8"
        />

        {/* Gece Mavisi Kaput ve Ön Gövde Bloğu */}
        <path
          d="M 35 56 C 36 56, 84 56, 85 56 C 89 60, 91 66, 89 74 C 88 77, 85 79, 78 80 C 68 81, 52 81, 42 80 C 35 79, 32 77, 31 74 C 29 66, 31 60, 35 56 Z"
          fill="url(#corollaNavyGrad)"
          stroke="#1e40af"
          strokeWidth="1"
        />

        {/* Karakteristik E120 Kaput Çift V-Kıvrımları (Hood Power Bulges) */}
        <path
          d="M 48 56 L 50 67 M 72 56 L 70 67"
          stroke="#60a5fa"
          strokeWidth="1"
          strokeOpacity="0.7"
          strokeLinecap="round"
        />

        {/* 2006 E120 Karakteristik Damla / Badem Projektör Farları */}
        {/* Sol Far */}
        <path
          d="M 33 62 C 37 61, 44 63, 46 66 C 44 68, 36 68, 33 65 C 32 64, 32 63, 33 62 Z"
          fill="#083344"
          stroke="url(#headlightCyan)"
          strokeWidth="1.2"
          filter="url(#neonGlow)"
        />
        {/* Sol Far İç Mercek / Led */}
        <circle cx="39" cy="65" r="1.5" fill="#a5f3fc" />
        <path d="M 33 62 L 35 64" stroke="url(#amberAccent)" strokeWidth="1" strokeLinecap="round" />

        {/* Sağ Far */}
        <path
          d="M 87 62 C 83 61, 76 63, 74 66 C 76 68, 84 68, 87 65 C 88 64, 88 63, 87 62 Z"
          fill="#083344"
          stroke="url(#headlightCyan)"
          strokeWidth="1.2"
          filter="url(#neonGlow)"
        />
        {/* Sağ Far İç Mercek / Led */}
        <circle cx="81" cy="65" r="1.5" fill="#a5f3fc" />
        <path d="M 87 62 L 85 64" stroke="url(#amberAccent)" strokeWidth="1" strokeLinecap="round" />

        {/* Ön Izgara & Panjur Çizgileri (E120 Trapezoid Grille) */}
        <path
          d="M 50 66 L 70 66 L 68 72 L 52 72 Z"
          fill="#030712"
          stroke="#475569"
          strokeWidth="0.8"
        />
        <line x1="53" y1="69" x2="67" y2="69" stroke="#64748b" strokeWidth="0.6" />

        {/* Stilize Ön Amblem (Toyota Oval Vurgusu) */}
        <ellipse cx="60" cy="69" rx="3.5" ry="2.2" stroke="#38bdf8" strokeWidth="0.9" fill="none" />
        <ellipse cx="60" cy="69" rx="1.8" ry="1.2" stroke="#38bdf8" strokeWidth="0.6" fill="none" />

        {/* Alt Tampon Hava Girişi & Intercooler / Sis Farları Izgarası */}
        <path
          d="M 43 75 L 77 75 L 75 79 L 45 79 Z"
          fill="#020617"
          stroke="#1e293b"
          strokeWidth="0.8"
        />
        {/* Sis Yuvaları / Fütüristik Amber Detay */}
        <circle cx="37" cy="74" r="1.2" fill="#f59e0b" filter="url(#neonGlow)" />
        <circle cx="83" cy="74" r="1.2" fill="#f59e0b" filter="url(#neonGlow)" />

        {/* Aerodinamik Alt Ön Lip (Splitter) */}
        <path
          d="M 37 80 C 50 82, 70 82, 83 80"
          stroke="#0ea5e9"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>

      {/* 4. Alt Telemetri Dijital Nabız Çizgisi */}
      <path
        d="M 44 98 L 52 98 L 56 94 L 60 102 L 64 98 L 76 98"
        stroke="#06b6d4"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  );

  if (variant === "icon-only") {
    return <div className={`inline-flex items-center justify-center ${className}`}>{iconSvg}</div>;
  }

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {iconSvg}
      <div className="flex flex-col leading-none">
        <div className="flex items-center gap-1">
          <span className="font-display text-base font-extrabold tracking-wider text-white">
            AURA<span className="text-primary">DRIVE</span>
          </span>
          <span className="rounded bg-gradient-to-r from-cyan-500 to-amber-500 px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-black">
            PRO
          </span>
        </div>
        <span className="mt-0.5 font-display text-[9px] font-semibold tracking-widest text-slate-400">
          COROLLA 1.4 D-4D • E120
        </span>
      </div>
    </div>
  );
};

export default AuraLogo;
