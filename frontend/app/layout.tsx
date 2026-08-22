import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Rajdhani } from "next/font/google";
import "./globals.css";

const displayFont = Chakra_Petch({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["300", "400", "500", "600", "700"],
});

const bodyFont = Rajdhani({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AuraDrive Pro",
  description: "Live BLE telemetry dashboard for Toyota Corolla 1.4 D-4D",
  applicationName: "AuraDrive Pro",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AuraDrive Pro",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className={`${displayFont.variable} ${bodyFont.variable} bg-black text-[var(--ivory)]`}>
        {children}
      </body>
    </html>
  );
}
