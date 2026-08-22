package com.auradrive.pro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

public class AuraForegroundService extends Service {
    public static final String CHANNEL_ID = "auradrive_foreground_channel";
    public static final String CHANNEL_NAME = "AuraDrive Pro Sürüş & Telemetri Servisi";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "com.auradrive.pro.ACTION_START";
    public static final String ACTION_UPDATE = "com.auradrive.pro.ACTION_UPDATE";
    public static final String ACTION_STOP = "com.auradrive.pro.ACTION_STOP";

    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_BODY = "extra_body";

    public static boolean isRunning = false;

    private PowerManager.WakeLock wakeLock = null;
    private NotificationManager notificationManager = null;
    private String currentTitle = "AuraDrive Pro — Sürüş Aktif ⚡";
    private String currentBody = "Telemetri ve yol bilgisayarı arka planda çalışıyor...";

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();
        acquireWakeLock();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("AuraDrive Pro arka planda Bluetooth ve GPS telemetrisini kaydeder.");
            channel.setShowBadge(false);
            channel.enableVibration(false);
            channel.enableLights(false);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(
                            PowerManager.PARTIAL_WAKE_LOCK,
                            "AuraDrivePro:BackgroundTelemetryWakeLock"
                    );
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(12 * 60 * 60 * 1000L); // Max 12 hours safety timeout
            }
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {}
    }

    private Notification buildNotification(String title, String body) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                pendingFlags
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            if (intent.hasExtra(EXTRA_TITLE)) currentTitle = intent.getStringExtra(EXTRA_TITLE);
            if (intent.hasExtra(EXTRA_BODY)) currentBody = intent.getStringExtra(EXTRA_BODY);

            acquireWakeLock();
            Notification notification = buildNotification(currentTitle, currentBody);

            int serviceType = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE | ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, serviceType);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isRunning = true;

        } else if (ACTION_UPDATE.equals(action)) {
            if (intent.hasExtra(EXTRA_TITLE)) currentTitle = intent.getStringExtra(EXTRA_TITLE);
            if (intent.hasExtra(EXTRA_BODY)) currentBody = intent.getStringExtra(EXTRA_BODY);

            if (isRunning && notificationManager != null) {
                Notification notification = buildNotification(currentTitle, currentBody);
                notificationManager.notify(NOTIFICATION_ID, notification);
            }

        } else if (ACTION_STOP.equals(action)) {
            stopForeground(true);
            releaseWakeLock();
            isRunning = false;
            stopSelf();
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        isRunning = false;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
