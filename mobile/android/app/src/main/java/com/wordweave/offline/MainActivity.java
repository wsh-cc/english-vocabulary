package com.wordweave.offline;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.os.Build;
import android.view.View;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WordweaveNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM && getBridge() != null) {
            // A category lets Android respect the display, battery and thermal policies.
            // It only votes while this WebView draws; there is no fixed 60 Hz animation loop.
            getBridge().getWebView().setRequestedFrameRate(hasFocus
                ? View.REQUESTED_FRAME_RATE_CATEGORY_HIGH
                : View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT);
        }
    }
}
