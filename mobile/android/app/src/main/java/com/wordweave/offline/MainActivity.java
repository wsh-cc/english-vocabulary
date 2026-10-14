package com.wordweave.offline;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WordweaveNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
