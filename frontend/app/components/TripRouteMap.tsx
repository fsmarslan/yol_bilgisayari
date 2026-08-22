"use client";

import { useEffect, useRef } from "react";

export type GpsPoint = {
  lat: number;
  lng: number;
  speed?: number | null;
  altitude?: number | null;
  timestamp: number;
};

export default function TripRouteMap({
  points,
  themeColor = "#00f0ff",
  height = "340px",
  startLabel = "Başlangıç",
  endLabel = "Varış",
}: {
  points: GpsPoint[];
  themeColor?: string;
  height?: string;
  startLabel?: string;
  endLabel?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current || points.length === 0) {
      return;
    }

    let isMounted = true;

    const initMap = async () => {
      const L = (await import("leaflet")).default;

      if (!isMounted || !mapContainerRef.current) return;

      // Temizlik
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const validPoints = points.filter(
        (p) => typeof p.lat === "number" && typeof p.lng === "number" && !isNaN(p.lat) && !isNaN(p.lng)
      );

      if (validPoints.length === 0) return;

      const latLngs = validPoints.map((p) => [p.lat, p.lng] as [number, number]);
      const startPoint = validPoints[0];
      const endPoint = validPoints[validPoints.length - 1];

      // Haritayı oluştur
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([startPoint.lat, startPoint.lng], 14);

      mapInstanceRef.current = map;

      // Koyu Kokpit Harita Katmanı (CartoDB Dark Matter)
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);

      // Rota Çizgisi (Glowing Neon Polyline)
      const polyline = L.polyline(latLngs, {
        color: themeColor,
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      // Başlangıç İkonu (Yeşil Rozet)
      const startIcon = L.divIcon({
        className: "custom-map-marker",
        html: `
          <div style="
            background-color: #10b981;
            color: #ffffff;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 0 14px rgba(16, 185, 129, 0.8), 0 2px 6px rgba(0,0,0,0.6);
            border: 2px solid #ffffff;
          ">🟢</div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      L.marker([startPoint.lat, startPoint.lng], { icon: startIcon })
        .addTo(map)
        .bindPopup(`<b style="color:#000">${startLabel}</b><br/>Saat: ${new Date(startPoint.timestamp).toLocaleTimeString("tr-TR")}`);

      // Varış İkonu (Dama Bayrağı)
      if (validPoints.length > 1) {
        const endIcon = L.divIcon({
          className: "custom-map-marker",
          html: `
            <div style="
              background-color: #ef4444;
              color: #ffffff;
              width: 28px;
              height: 28px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 14px;
              font-weight: bold;
              box-shadow: 0 0 14px rgba(239, 68, 68, 0.8), 0 2px 6px rgba(0,0,0,0.6);
              border: 2px solid #ffffff;
            ">🏁</div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        L.marker([endPoint.lat, endPoint.lng], { icon: endIcon })
          .addTo(map)
          .bindPopup(`<b style="color:#000">${endLabel}</b><br/>Saat: ${new Date(endPoint.timestamp).toLocaleTimeString("tr-TR")}`);
      }

      // Tüm rotayı ekrana sığdır
      map.fitBounds(polyline.getBounds(), {
        padding: [30, 30],
        maxZoom: 16,
      });

      // Harita boyutunun düzgün render olması için invalidateSize tetikle
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 200);
    };

    void initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [points, themeColor, startLabel, endLabel]);

  if (points.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/50 p-6 text-center text-muted"
      >
        <span className="text-3xl">📍</span>
        <p className="mt-2 text-xs font-semibold">Bu sürüş için kayıtlı GPS konum noktası bulunamadı.</p>
        <p className="text-[10px] opacity-70">GPS izni verildiğinde gidilen güzergah otomatik kaydedilir.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-card-border shadow-inner">
      <div ref={mapContainerRef} style={{ height, width: "100%", zIndex: 10 }} />
    </div>
  );
}
