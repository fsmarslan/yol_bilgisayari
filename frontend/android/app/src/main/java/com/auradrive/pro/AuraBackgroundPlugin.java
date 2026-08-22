package com.auradrive.pro;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "AuraBackground",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class AuraBackgroundPlugin extends Plugin {

    @PluginMethod
    public void startForegroundService(PluginCall call) {
        try {
            String title = call.getString("title", "AuraDrive Pro — Sürüş Aktif ⚡");
            String body = call.getString("body", "Telemetri ve yol bilgisayarı arka planda çalışıyor...");

            Context context = getContext();
            Intent serviceIntent = new Intent(context, AuraForegroundService.class);
            serviceIntent.setAction(AuraForegroundService.ACTION_START);
            serviceIntent.putExtra(AuraForegroundService.EXTRA_TITLE, title);
            serviceIntent.putExtra(AuraForegroundService.EXTRA_BODY, body);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, serviceIntent);
            } else {
                context.startService(serviceIntent);
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("running", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Foreground service başlatılamadı: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        try {
            String title = call.getString("title", "AuraDrive Pro — Sürüş Aktif ⚡");
            String body = call.getString("body", "");

            Context context = getContext();
            Intent serviceIntent = new Intent(context, AuraForegroundService.class);
            serviceIntent.setAction(AuraForegroundService.ACTION_UPDATE);
            serviceIntent.putExtra(AuraForegroundService.EXTRA_TITLE, title);
            serviceIntent.putExtra(AuraForegroundService.EXTRA_BODY, body);

            context.startService(serviceIntent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Bildirim güncellenemedi: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopForegroundService(PluginCall call) {
        try {
            Context context = getContext();
            Intent serviceIntent = new Intent(context, AuraForegroundService.class);
            serviceIntent.setAction(AuraForegroundService.ACTION_STOP);
            context.startService(serviceIntent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("running", false);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Foreground service durdurulamadı: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void isServiceRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", AuraForegroundService.isRunning);
        call.resolve(ret);
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        boolean isIgnoring = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                isIgnoring = pm.isIgnoringBatteryOptimizations(context.getPackageName());
            }
        } else {
            isIgnoring = true;
        }

        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                } catch (Exception e) {
                    try {
                        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                    } catch (Exception ignored) {}
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }
}
