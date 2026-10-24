package com.wordweave.offline;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.content.res.Configuration;
import android.graphics.Color;
import androidx.activity.EdgeToEdge;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WordweaveNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Use the same inset path on Android 10-14 as on Android 15+.
        // Capacitor SystemBars owns inset measurement and keyboard resizing.
        EdgeToEdge.enable(this);
        applyAppearance();
    }

    @Override
    protected void load() {
        // SystemBars reads windowBackground during bridge creation. Set the
        // persisted surface before it runs, including its old-WebView fallback.
        applyAppearance();
        super.load();
        applyAppearance();
    }

    void setAppearance(String theme) {
        getSharedPreferences("wordweave-appearance", MODE_PRIVATE).edit().putString("theme", theme).apply();
        applyAppearance();
    }

    private void applyAppearance() {
        String theme = getSharedPreferences("wordweave-appearance", MODE_PRIVATE).getString("theme", "system");
        boolean systemDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        boolean dark = "dark".equals(theme) || (!"light".equals(theme) && systemDark);
        int background = Color.parseColor(dark ? "#192820" : "#f6f7f4");
        getTheme().applyStyle(dark ? R.style.WordweaveDarkSurface : R.style.WordweaveLightSurface, true);
        // On older WebViews, the decor fills the safe area outside the padded
        // WebView. Matching both surfaces removes the gray status-bar strip.
        getWindow().getDecorView().setBackgroundColor(background);
        getWindow().setNavigationBarContrastEnforced(false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        if (getBridge() != null) getBridge().getWebView().setBackgroundColor(background);
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applyAppearance();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyAppearance();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM && getBridge() != null) {
            // A category lets Android respect the display, battery and thermal policies.
            // It only votes while this WebView draws; there is no fixed 60 Hz animation loop.
            getBridge().getWebView().setRequestedFrameRate(hasFocus
                ? View.REQUESTED_FRAME_RATE_CATEGORY_HIGH
                : View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT);
        }
    }
}
