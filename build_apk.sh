#!/bin/bash
set -e

echo "=========================================="
echo "🏎️  AuraDrive Pro — Otomatik APK Derleyici"
echo "=========================================="

export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export PATH="$JAVA_HOME/bin:/opt/homebrew/share/android-commandlinetools/platform-tools:$PATH"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT/frontend"

echo "📦 1/3 Frontend statik paketleniyor..."
npm run build

echo "🔄 2/3 Android platformuna senkronize ediliyor..."
npx cap sync android

echo "🔨 3/3 Gradle ile bağımsız APK derleniyor..."
cd android
./gradlew assembleDebug

cp app/build/outputs/apk/debug/app-debug.apk "$PROJECT_ROOT/AuraDrivePro.apk"

echo "=========================================="
echo "🎉 TEBRİKLER! Yeni APK hazır:"
echo "📁 $PROJECT_ROOT/AuraDrivePro.apk"
echo "=========================================="

# USB / Wi-Fi ile bağlı Android cihaz var mı kontrol et
if command -v adb >/dev/null 2>&1; then
  DEVICES=$(adb devices | grep -v "List of devices" | grep "device$" || true)
  if [ -n "$DEVICES" ]; then
    echo "📲 Bağlı Android cihaz bulundu! Otomatik yükleniyor..."
    adb install -r "$PROJECT_ROOT/AuraDrivePro.apk"
    echo "✅ Telefona güncelleme başarıyla yüklendi!"
  fi
fi
