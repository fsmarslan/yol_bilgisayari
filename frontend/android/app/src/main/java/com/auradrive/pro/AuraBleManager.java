package com.auradrive.pro;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AuraBleManager:
 * Doğrudan Android Native BLE katmanında çalışan, ELM327 komut/yanıt kuyruğunu yöneten,
 * 120-150ms dinamik timeout ve exponential backoff ile 30+ FPS telemetri üreten motor.
 */
@SuppressLint("MissingPermission")
public class AuraBleManager {
    private static final String TAG = "AuraBleManager";
    private static AuraBleManager instance;

    // Standart BLE OBD-II Karakteristik ve Servis İpuçları
    private static final UUID CLIENT_CHARACTERISTIC_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    public interface TelemetryListener {
        void onTelemetryUpdate(JSONObject data);
        void onConnectionStateChange(boolean connected, String message);
    }

    private final Context context;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothGatt bluetoothGatt;
    private BluetoothGattCharacteristic writeCharacteristic;
    private BluetoothGattCharacteristic notifyCharacteristic;

    private TelemetryListener listener;
    private final ExecutorService workerExecutor = Executors.newSingleThreadExecutor();
    private volatile boolean isRunning = false;
    private volatile boolean isConnected = false;

    // Buffer ve Senkronizasyon
    private final StringBuilder notifyBuffer = new StringBuilder();
    private CountDownLatch responseLatch;
    private String lastCommandResponse = "";

    // Telemetri Değerleri (Native State)
    private final Map<String, Object> telemetryState = new HashMap<>();
    private final Map<String, Integer> pidTimeoutCounts = new HashMap<>();
    private final Map<String, Long> pidBackoffUntil = new HashMap<>();

    // Toyota 1ND-TV Dizel Sabitleri
    private static final double DIESEL_DENSITY = 840.0;
    private static final double MIN_AFR = 17.5;
    private static final double MAX_AFR = 65.0;

    private final Pattern voltPattern = Pattern.compile("(\\d+\\.?\\d*)\\s*V?", Pattern.CASE_INSENSITIVE);

    public static synchronized AuraBleManager getInstance(Context context) {
        if (instance == null) {
            instance = new AuraBleManager(context.getApplicationContext());
        }
        return instance;
    }

    private AuraBleManager(Context context) {
        this.context = context;
        BluetoothManager bm = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) {
            this.bluetoothAdapter = bm.getAdapter();
        }
        resetTelemetryState();
    }

    private void resetTelemetryState() {
        synchronized (telemetryState) {
            telemetryState.put("connected", false);
            telemetryState.put("rpm", null);
            telemetryState.put("speed_kmh", null);
            telemetryState.put("map_kpa", null);
            telemetryState.put("throttle_percent", null);
            telemetryState.put("maf_gps", null);
            telemetryState.put("coolant_temp_c", null);
            telemetryState.put("intake_temp_c", null);
            telemetryState.put("load_percent", null);
            telemetryState.put("distance_mil_on", null);
            telemetryState.put("battery_voltage", null);
            telemetryState.put("turbo_boost_bar", null);
            telemetryState.put("fuel_display", null);
            telemetryState.put("fuel_unit", "--");
            telemetryState.put("fuel_rate_lph", null);
            telemetryState.put("last_error", null);
            telemetryState.put("updated_at", null);
        }
    }

    public void setListener(TelemetryListener listener) {
        this.listener = listener;
    }

    public boolean isConnected() {
        return isConnected;
    }

    public synchronized void connect(String macAddress) {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            if (listener != null) listener.onConnectionStateChange(false, "Bluetooth kapalı");
            return;
        }

        disconnect();
        BluetoothDevice device = bluetoothAdapter.getRemoteDevice(macAddress);
        if (device == null) {
            if (listener != null) listener.onConnectionStateChange(false, "Cihaz bulunamadı");
            return;
        }

        Log.i(TAG, "Cihaza bağlanılıyor: " + macAddress);
        if (listener != null) listener.onConnectionStateChange(false, "GATT bağlantısı kuruluyor...");

        BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    Log.i(TAG, "GATT bağlandı, MTU ve servisler keşfediliyor...");
                    bluetoothGatt = gatt;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_BALANCED);
                        gatt.requestMtu(256);
                    }
                    gatt.discoverServices();
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    Log.w(TAG, "GATT bağlantısı koptu, kaynaklar temizleniyor (gatt.close)...");
                    isConnected = false;
                    isRunning = false;
                    try {
                        gatt.close();
                    } catch (Exception ignored) {}
                    if (bluetoothGatt == gatt) {
                        bluetoothGatt = null;
                    }
                    resetTelemetryState();
                    if (listener != null) listener.onConnectionStateChange(false, "Bağlantı koptu");
                }
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    setupCharacteristics(gatt);
                } else {
                    Log.e(TAG, "Servis keşfi başarısız: " + status);
                    if (listener != null) listener.onConnectionStateChange(false, "Servisler keşfedilemedi");
                }
            }

            @Override
            public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                handleNotificationData(characteristic.getValue());
            }

            public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
                handleNotificationData(value);
            }
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } else {
            bluetoothGatt = device.connectGatt(context, false, gattCallback);
        }
    }

    private void setupCharacteristics(BluetoothGatt gatt) {
        writeCharacteristic = null;
        notifyCharacteristic = null;

        for (BluetoothGattService s : gatt.getServices()) {
            String suuid = s.getUuid().toString().toLowerCase(Locale.ROOT);
            if (suuid.contains("fff0") || suuid.contains("ffe0") || suuid.contains("18f0") || suuid.contains("ae00") || suuid.contains("e7810a70")) {
                for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                    String cuuid = c.getUuid().toString().toLowerCase(Locale.ROOT);
                    if (cuuid.contains("fff1") || cuuid.contains("ffe1") || cuuid.contains("ae02") || cuuid.contains("e7810a71")) {
                        notifyCharacteristic = c;
                    }
                    if (cuuid.contains("fff2") || cuuid.contains("ffe1") || cuuid.contains("ae01") || cuuid.contains("e7810a72")) {
                        writeCharacteristic = c;
                    }
                }
            }
        }

        if (writeCharacteristic == null || notifyCharacteristic == null) {
            for (BluetoothGattService s : gatt.getServices()) {
                for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                    int props = c.getProperties();
                    if ((props & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0 && notifyCharacteristic == null) {
                        notifyCharacteristic = c;
                    }
                    if ((props & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0 && writeCharacteristic == null) {
                        writeCharacteristic = c;
                    }
                }
            }
        }

        if (writeCharacteristic != null && notifyCharacteristic != null) {
            gatt.setCharacteristicNotification(notifyCharacteristic, true);
            BluetoothGattDescriptor desc = notifyCharacteristic.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG);
            if (desc != null) {
                desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                gatt.writeDescriptor(desc);
            }

            Log.i(TAG, "Karakteristikler hazır. ELM327 başlatma dizisi tetikleniyor...");
            workerExecutor.execute(this::startElm327Loop);
        } else {
            Log.e(TAG, "Gereken BLE karakteristikleri bulunamadı");
            if (listener != null) listener.onConnectionStateChange(false, "OBD karakteristikleri bulunamadı");
        }
    }

    private void handleNotificationData(byte[] value) {
        if (value == null) return;
        String text = new String(value, StandardCharsets.US_ASCII);
        synchronized (notifyBuffer) {
            notifyBuffer.append(text);
            if (notifyBuffer.indexOf(">") != -1) {
                lastCommandResponse = notifyBuffer.toString();
                notifyBuffer.setLength(0);
                if (responseLatch != null) {
                    responseLatch.countDown();
                }
            }
        }
    }

    private String sendCommand(String command, int timeoutMs) {
        if (bluetoothGatt == null || writeCharacteristic == null) return "";

        synchronized (notifyBuffer) {
            notifyBuffer.setLength(0);
            lastCommandResponse = "";
            responseLatch = new CountDownLatch(1);
        }

        try {
            byte[] bytes = (command + "\r").getBytes(StandardCharsets.US_ASCII);
            writeCharacteristic.setValue(bytes);
            int writeType = (writeCharacteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
            writeCharacteristic.setWriteType(writeType);
            bluetoothGatt.writeCharacteristic(writeCharacteristic);

            boolean received = responseLatch.await(timeoutMs, TimeUnit.MILLISECONDS);
            if (!received) {
                return "";
            }
            return lastCommandResponse;
        } catch (Exception e) {
            return "";
        }
    }

    private void startElm327Loop() {
        List<String> initCommands = Arrays.asList("ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATST64", "ATAL", "ATSP5");
        for (String cmd : initCommands) {
            sendCommand(cmd, 600);
            try {
                Thread.sleep(cmd.equals("ATZ") ? 700 : 20);
            } catch (InterruptedException ignored) {}
        }

        isConnected = true;
        isRunning = true;
        if (listener != null) listener.onConnectionStateChange(true, "Bağlandı (OBD-II Canlı)");

        runPriorityPollingLoop();
    }

    private void runPriorityPollingLoop() {
        int slowCycleIndex = 0;
        long lastSlowPollTime = 0;

        while (isRunning && isConnected) {
            // 1. FAST LOOP (Yüksek Öncelik - Her Döngüde)
            pollPidWithBackoff("010C", "0C", 2, 130, this::parseRpm);
            pollPidWithBackoff("010D", "0D", 1, 130, this::parseSpeed);
            pollPidWithBackoff("010B", "0B", 1, 130, this::parseMap);
            pollPidWithBackoff("0111", "11", 1, 130, this::parseThrottle);
            pollPidWithBackoff("0110", "10", 2, 130, this::parseMaf);

            // 2. SLOW LOOP (Düşük Öncelik - 6-8 Saniyede Bir Teker Teker Araya Serpiştirilir)
            long now = System.currentTimeMillis();
            if (now - lastSlowPollTime >= 1500) {
                switch (slowCycleIndex % 5) {
                    case 0:
                        pollPidWithBackoff("0105", "05", 1, 140, this::parseCoolant);
                        break;
                    case 1:
                        pollPidWithBackoff("010F", "0F", 1, 140, this::parseIntakeTemp);
                        break;
                    case 2:
                        pollPidWithBackoff("0104", "04", 1, 140, this::parseLoad);
                        break;
                    case 3:
                        pollPidWithBackoff("0121", "21", 2, 150, this::parseDistance);
                        break;
                    case 4:
                        pollBatteryVoltage();
                        break;
                }
                slowCycleIndex++;
                lastSlowPollTime = now;
            }

            // Hesaplamaları Güncelle ve State'i Dışarı Aktar (30+ FPS)
            updateCalculationsAndEmit();

            try {
                Thread.sleep(12);
            } catch (InterruptedException ignored) {}
        }
    }

    private interface PidParser {
        void parse(int[] bytes);
    }

    private void pollPidWithBackoff(String pidCmd, String pidHex, int expectedBytes, int timeoutMs, PidParser parser) {
        long now = System.currentTimeMillis();
        Long backoffUntil = pidBackoffUntil.get(pidCmd);
        if (backoffUntil != null && now < backoffUntil) {
            return;
        }

        String raw = sendCommand(pidCmd, timeoutMs);
        int[] payload = extractPayload(raw, pidHex, expectedBytes);

        if (payload != null) {
            pidTimeoutCounts.put(pidCmd, 0);
            pidBackoffUntil.remove(pidCmd);
            parser.parse(payload);
        } else {
            int timeouts = pidTimeoutCounts.containsKey(pidCmd) ? pidTimeoutCounts.get(pidCmd) + 1 : 1;
            pidTimeoutCounts.put(pidCmd, timeouts);

            if (timeouts >= 3) {
                long delay = timeouts == 3 ? 600 : (timeouts == 4 ? 1500 : 4000);
                pidBackoffUntil.put(pidCmd, now + delay);
            }
        }
    }

    private void pollBatteryVoltage() {
        String raw = sendCommand("ATRV", 200);
        Matcher m = voltPattern.matcher(raw);
        if (m.find()) {
            try {
                double val = Double.parseDouble(m.group(1));
                if (val >= 5.0 && val <= 18.0) {
                    synchronized (telemetryState) {
                        telemetryState.put("battery_voltage", Math.round(val * 10.0) / 10.0);
                    }
                }
            } catch (Exception ignored) {}
        }
    }

    private int[] extractPayload(String rawText, String pidHex, int expectedBytes) {
        if (rawText == null || rawText.isEmpty()) return null;
        String norm = rawText.toUpperCase(Locale.ROOT).replaceAll("[^0-9A-F]", "");
        String marker = "41" + pidHex;
        int pos = norm.indexOf(marker);
        if (pos == -1) return null;

        String tail = norm.substring(pos + marker.length());
        if (tail.length() < expectedBytes * 2) return null;

        int[] bytes = new int[expectedBytes];
        for (int i = 0; i < expectedBytes; i++) {
            try {
                bytes[i] = Integer.parseInt(tail.substring(i * 2, i * 2 + 2), 16);
            } catch (Exception e) {
                return null;
            }
        }
        return bytes;
    }

    private void parseRpm(int[] b) {
        double rpm = ((b[0] * 256.0) + b[1]) / 4.0;
        synchronized (telemetryState) {
            telemetryState.put("rpm", (int) Math.round(rpm));
        }
    }

    private void parseSpeed(int[] b) {
        synchronized (telemetryState) {
            telemetryState.put("speed_kmh", b[0]);
        }
    }

    private void parseMap(int[] b) {
        synchronized (telemetryState) {
            telemetryState.put("map_kpa", b[0]);
        }
    }

    private void parseThrottle(int[] b) {
        double t = (b[0] * 100.0) / 255.0;
        synchronized (telemetryState) {
            telemetryState.put("throttle_percent", Math.round(t * 10.0) / 10.0);
        }
    }

    private void parseMaf(int[] b) {
        double maf = ((b[0] * 256.0) + b[1]) / 100.0;
        synchronized (telemetryState) {
            telemetryState.put("maf_gps", Math.round(maf * 100.0) / 100.0);
        }
    }

    private void parseCoolant(int[] b) {
        synchronized (telemetryState) {
            telemetryState.put("coolant_temp_c", b[0] - 40);
        }
    }

    private void parseIntakeTemp(int[] b) {
        synchronized (telemetryState) {
            telemetryState.put("intake_temp_c", b[0] - 40);
        }
    }

    private void parseLoad(int[] b) {
        double l = (b[0] * 100.0) / 255.0;
        synchronized (telemetryState) {
            telemetryState.put("load_percent", Math.round(l * 10.0) / 10.0);
        }
    }

    private void parseDistance(int[] b) {
        int dist = (b[0] * 256) + b[1];
        synchronized (telemetryState) {
            telemetryState.put("distance_mil_on", dist);
        }
    }

    private void updateCalculationsAndEmit() {
        Integer rpm;
        Integer speed;
        Integer mapKpa;
        Double mafGps;
        Double loadPercent;
        Double throttlePercent;

        synchronized (telemetryState) {
            rpm = (Integer) telemetryState.get("rpm");
            speed = (Integer) telemetryState.get("speed_kmh");
            mapKpa = (Integer) telemetryState.get("map_kpa");
            mafGps = (Double) telemetryState.get("maf_gps");
            loadPercent = (Double) telemetryState.get("load_percent");
            throttlePercent = (Double) telemetryState.get("throttle_percent");
        }

        if (mapKpa != null) {
            double boost = (mapKpa - 101.3) / 100.0;
            if (rpm != null && rpm <= 850 && boost < 0.0) boost = 0.0;
            synchronized (telemetryState) {
                telemetryState.put("turbo_boost_bar", Math.max(0.0, Math.round(boost * 100.0) / 100.0));
            }
        }

        if (mafGps != null) {
            double spd = speed != null ? speed : 0.0;
            double thr = throttlePercent != null ? throttlePercent : 0.0;
            int r = rpm != null ? rpm : 850;

            if (spd > 15.0 && thr < 2.0 && r > 1150) {
                synchronized (telemetryState) {
                    telemetryState.put("fuel_display", 0.0);
                    telemetryState.put("fuel_unit", "L/100km");
                    telemetryState.put("fuel_rate_lph", 0.0);
                }
            } else {
                double load = loadPercent != null ? Math.max(0, Math.min(100, loadPercent)) : 20.0;
                double loadFactor = Math.pow(1.0 - load / 100.0, 3.0);
                double effectiveAfr = MIN_AFR + (MAX_AFR - MIN_AFR) * loadFactor;

                double fuelMassGps = mafGps / effectiveAfr;
                double litersPerHour = (fuelMassGps * 3600.0) / DIESEL_DENSITY;

                synchronized (telemetryState) {
                    if (spd > 5.0) {
                        double lPer100 = (litersPerHour / spd) * 100.0;
                        telemetryState.put("fuel_display", Math.min(35.0, Math.round(lPer100 * 100.0) / 100.0));
                        telemetryState.put("fuel_unit", "L/100km");
                    } else {
                        telemetryState.put("fuel_display", Math.round(litersPerHour * 100.0) / 100.0);
                        telemetryState.put("fuel_unit", "L/h");
                    }
                    telemetryState.put("fuel_rate_lph", Math.round(litersPerHour * 1000.0) / 1000.0);
                }
            }
        }

        synchronized (telemetryState) {
            telemetryState.put("connected", true);
            telemetryState.put("updated_at", String.valueOf(System.currentTimeMillis()));
        }

        if (listener != null) {
            try {
                JSONObject json = new JSONObject();
                synchronized (telemetryState) {
                    for (Map.Entry<String, Object> entry : telemetryState.entrySet()) {
                        json.put(entry.getKey(), entry.getValue() != null ? entry.getValue() : JSONObject.NULL);
                    }
                }
                listener.onTelemetryUpdate(json);
            } catch (Exception e) {
                Log.e(TAG, "Telemetry JSON hatası", e);
            }
        }
    }

    public String sendCustomCommand(String command, int timeoutMs) {
        return sendCommand(command, timeoutMs);
    }

    public synchronized void disconnect() {
        isRunning = false;
        isConnected = false;
        if (bluetoothGatt != null) {
            try {
                bluetoothGatt.disconnect();
                bluetoothGatt.close();
            } catch (Exception ignored) {}
            bluetoothGatt = null;
        }
        resetTelemetryState();
    }
}
