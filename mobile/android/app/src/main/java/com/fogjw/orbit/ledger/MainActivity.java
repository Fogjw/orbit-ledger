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

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            systemBack();
            return;
        }
        // 先让网页关掉最上层浮层/账笺；只有根视图才退出 Activity。
        webView.evaluateJavascript("(window.__orbitBack && window.__orbitBack()) === true", value -> {
            if (!"true".equals(value)) runOnUiThread(this::systemBack);
        });
    }

    private void systemBack() {
        super.onBackPressed();
    }
}
