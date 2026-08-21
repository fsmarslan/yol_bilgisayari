import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.auradrive.pro",
  appName: "AuraDrive Pro",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "OBD-II Bluetooth adaptörü aranıyor...",
        cancel: "İptal",
        availableDevices: "Bulunan Cihazlar",
        noDeviceFound: "OBD cihazı bulunamadı",
      },
    },
  },
};

export default config;
