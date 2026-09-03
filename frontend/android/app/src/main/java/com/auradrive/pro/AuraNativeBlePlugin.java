package com.auradrive.pro;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

@CapacitorPlugin(name = "AuraNativeBle")
@SuppressLint("MissingPermission")
public class AuraNativeBlePlugin extends Plugin {
    private static final String TAG = "AuraNativeBlePlugin";
    private AuraBleManager bleManager;
    private BluetoothLeScanner bleScanner;
    private boolean isScanning = false;
    private final Map<String, BluetoothDevice> discoveredDevices = new HashMap<>();

    @Override
    public void load() {
        super.load();
        bleManager = AuraBleManager.getInstance(getContext());
        setupTelemetryBridge();
    }

    private void setupTelemetryBridge() {
        bleManager.setListener(new AuraBleManager.TelemetryListener() {
            @Override
            public void onTelemetryUpdate(JSONObject data) {
                // 1. Capacitor Plugin Listener Köprüsü
                JSObject js = new JSObject();
                Iterator<String> keys = data.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    try {
                        Object val = data.get(key);
                        if (val != JSONObject.NULL) {
                            js.put(key, val);
                        } else {
                            js.put(key, (Object) null);
                        }
                    } catch (Exception ignored) {}
                }
                notifyListeners("telemetryUpdate", js);

                // 2. Doğrudan WebView JavaScript Event Köprüsü (Garbage Collection & JSON Serialize takılmasını önler)
                try {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        String script = "window.dispatchEvent(new CustomEvent('nativeTelemetryUpdate', { detail: " + data.toString() + " }));";
                        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
                    }
                } catch (Exception ignored) {}
            }

            @Override
            public void onConnectionStateChange(boolean connected, String message) {
                JSObject ret = new JSObject();
                ret.put("connected", connected);
                ret.put("message", message);
                notifyListeners("connectionChange", ret);

                try {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        String script = "window.dispatchEvent(new CustomEvent('nativeConnectionChange', { detail: " + ret.toString() + " }));";
                        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String deviceId = call.getString("deviceId");
        if (deviceId == null || deviceId.isEmpty()) {
            call.reject("deviceId (MAC adresi) belirtilmedi");
            return;
        }

        Log.i(TAG, "Native BLE bağlanıyor: " + deviceId);
        bleManager.connect(deviceId);

        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("connecting", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        bleManager.disconnect();
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", bleManager.isConnected());
        call.resolve(ret);
    }

    @PluginMethod
    public void sendCustomCommand(PluginCall call) {
        String command = call.getString("command");
        int timeoutMs = call.getInt("timeout", 500);
        if (command == null || command.isEmpty()) {
            call.reject("Komut boş olamaz");
            return;
        }

        new Thread(() -> {
            String result = bleManager.sendCustomCommand(command, timeoutMs);
            JSObject ret = new JSObject();
            ret.put("response", result);
            call.resolve(ret);
        }).start();
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm == null || bm.getAdapter() == null || !bm.getAdapter().isEnabled()) {
            call.reject("Bluetooth kapalı");
            return;
        }

        discoveredDevices.clear();
        bleScanner = bm.getAdapter().getBluetoothLeScanner();
        if (bleScanner == null) {
            call.reject("BLE Scanner alınamadı");
            return;
        }

        isScanning = true;
        ScanCallback scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                if (device != null && device.getAddress() != null) {
                    discoveredDevices.put(device.getAddress(), device);
                }
            }
        };

        try {
            bleScanner.startScan(scanCallback);
            // 3 saniye tara sonra sonuçları dön
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (isScanning && bleScanner != null) {
                    try {
                        bleScanner.stopScan(scanCallback);
                    } catch (Exception ignored) {}
                    isScanning = false;
                }

                JSArray devicesArr = new JSArray();
                for (BluetoothDevice d : discoveredDevices.values()) {
                    JSObject obj = new JSObject();
                    obj.put("deviceId", d.getAddress());
                    obj.put("name", d.getName() != null ? d.getName() : "Bilinmeyen BLE Cihaz");
                    devicesArr.put(obj);
                }

                JSObject ret = new JSObject();
                ret.put("devices", devicesArr);
                call.resolve(ret);
            }, 3000);
        } catch (Exception e) {
            call.reject("BLE tarama başlatılamadı: " + e.getMessage(), e);
        }
    }
}
