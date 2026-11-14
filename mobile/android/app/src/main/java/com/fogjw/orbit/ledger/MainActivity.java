package com.fogjw.orbit.ledger;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    private static final int REQ_PICK_BACKUP = 7401;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 真机/模拟器 E2E 通过 WebView DevTools 协议读取 DOM；只在 debug 包开启。
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            // 导出：交给 Android 分享面板（可存到文件/网盘）；导入：系统文件选择器。
            webView.addJavascriptInterface(new BackupBridge(), "OrbitAndroid");
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

    public class BackupBridge {
        @JavascriptInterface
        public void shareBackup(String name, String json) {
            runOnUiThread(() -> {
                try {
                    File dir = new File(getCacheDir(), "orbit-backup");
                    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法创建备份缓存目录");
                    String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                    File file = new File(dir, safe);
                    try (FileOutputStream out = new FileOutputStream(file)) {
                        out.write(json.getBytes(StandardCharsets.UTF_8));
                    }
                    Uri uri = FileProvider.getUriForFile(
                        MainActivity.this,
                        getPackageName() + ".fileprovider",
                        file
                    );
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("application/json");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.putExtra(Intent.EXTRA_SUBJECT, name);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "导出备份"));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "导出失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void pickBackup() {
            runOnUiThread(() -> {
                Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                open.addCategory(Intent.CATEGORY_OPENABLE);
                open.setType("*/*");
                open.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/json", "text/plain", "application/octet-stream"
                });
                startActivityForResult(open, REQ_PICK_BACKUP);
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK_BACKUP || resultCode != RESULT_OK || data == null || data.getData() == null) {
            return;
        }
        try (InputStream in = getContentResolver().openInputStream(data.getData());
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalStateException("无法读取文件");
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            String text = out.toString(StandardCharsets.UTF_8.name());
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) throw new IllegalStateException("WebView 不可用");
            String script = "window.__orbitImportBackup && window.__orbitImportBackup("
                + JSONObject.quote(text) + ")";
            webView.evaluateJavascript(script, null);
        } catch (Exception e) {
            Toast.makeText(this, "读取备份失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
