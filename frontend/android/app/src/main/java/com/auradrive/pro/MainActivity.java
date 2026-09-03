package com.auradrive.pro;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuraBackgroundPlugin.class);
        registerPlugin(AuraNativeBlePlugin.class);
        super.onCreate(savedInstanceState);

        try {
            if (bridge != null && bridge.getWebView() != null) {
                WebView webView = bridge.getWebView();
                WebSettings settings = webView.getSettings();
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        // Prevent WebView from freezing JavaScript execution and timers when app is in background
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onStop() {
        super.onStop();
        // Keep timers running in background when user switches to music or navigation apps
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onResume() {
        super.onResume();
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        try {
            if (bridge != null && bridge.getWebView() != null) {
                String script = "window.dispatchEvent(new CustomEvent('androidPipChange', { detail: { isInPip: " + isInPictureInPictureMode + " } }));";
                bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(script, null));
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        try {
            if (AuraBackgroundPlugin.autoPipOnLeave && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                if (getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
                    android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                    android.util.Rational aspectRatio = new android.util.Rational(1, 1);
                    builder.setAspectRatio(aspectRatio);
                    enterPictureInPictureMode(builder.build());
                }
            }
        } catch (Exception ignored) {}
    }
}


