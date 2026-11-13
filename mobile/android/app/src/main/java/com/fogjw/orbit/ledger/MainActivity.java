package com.fogjw.orbit.ledger;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 真机/模拟器 E2E 通过 WebView DevTools 协议读取 DOM；只在 debug 包开启。
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }
}
