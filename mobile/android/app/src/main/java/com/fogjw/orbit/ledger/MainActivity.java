package com.fogjw.orbit.ledger;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.content.FileProvider;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    private static final int REQ_PICK_BACKUP = 7401;
    private static final int REQ_PICK_STORAGE = 7402;
    private static final String PREFS = "orbit_storage";
    private static final String KEY_TREE = "tree_uri";
    private static final String DB_NAME = "orbit.db";

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
            // 账本真实文件：SAF 目录树 + 持久授权，不申请全盘存储权限。
            webView.addJavascriptInterface(new StorageBridge(), "OrbitAndroidStorage");
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

    public class StorageBridge {
        private SharedPreferences prefs() {
            return getSharedPreferences(PREFS, MODE_PRIVATE);
        }

        private Uri treeUri() {
            String value = prefs().getString(KEY_TREE, null);
            if (value == null || value.isEmpty()) return null;
            return Uri.parse(value);
        }

        @JavascriptInterface
        public boolean hasDirectory() {
            Uri uri = treeUri();
            if (uri == null) return false;
            try {
                DocumentFile dir = DocumentFile.fromTreeUri(MainActivity.this, uri);
                return dir != null && dir.canRead();
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String readDatabase() {
            Uri uri = treeUri();
            if (uri == null) return "";
            try {
                DocumentFile dir = DocumentFile.fromTreeUri(MainActivity.this, uri);
                if (dir == null) return "";
                DocumentFile file = dir.findFile(DB_NAME);
                if (file == null || !file.exists()) return "";
                try (InputStream in = getContentResolver().openInputStream(file.getUri());
                     ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    if (in == null) return "";
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                }
            } catch (Exception e) {
                android.util.Log.e("OrbitStorage", "读取 orbit.db 失败", e);
                return "";
            }
        }

        @JavascriptInterface
        public boolean writeDatabase(String base64) {
            Uri uri = treeUri();
            if (uri == null) return false;
            try {
                DocumentFile dir = DocumentFile.fromTreeUri(MainActivity.this, uri);
                if (dir == null) return false;
                DocumentFile file = dir.findFile(DB_NAME);
                if (file == null) {
                    file = dir.createFile("application/octet-stream", DB_NAME);
                }
                if (file == null) return false;
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                try (OutputStream out = getContentResolver().openOutputStream(file.getUri(), "wt")) {
                    if (out == null) return false;
                    out.write(bytes);
                    out.flush();
                }
                return true;
            } catch (Exception e) {
                android.util.Log.e("OrbitStorage", "写入 orbit.db 失败", e);
                return false;
            }
        }

        @JavascriptInterface
        public void writeDatabaseAsync(String base64, String token) {
            // 全库 Base64/文件写在后台线程；JS 等回调，不阻塞 WebView 主线程。
            new Thread(() -> {
                boolean ok = writeDatabase(base64);
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) return;
                String script = "window.__orbitNativeWriteDone && window.__orbitNativeWriteDone("
                    + JSONObject.quote(token) + "," + ok + ")";
                runOnUiThread(() -> webView.evaluateJavascript(script, null));
            }, "orbit-db-write").start();
        }

        @JavascriptInterface
        public String describe() {
            try {
                DocumentFile dir = DocumentFile.fromTreeUri(MainActivity.this, treeUri());
                if (dir == null) return "真实文件：所选目录里的 orbit.db";
                return "真实文件：" + dir.getName() + "/" + DB_NAME;
            } catch (Exception e) {
                return "真实文件：所选目录里的 orbit.db";
            }
        }

        @JavascriptInterface
        public void pickDirectory() {
            runOnUiThread(() -> {
                Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                startActivityForResult(open, REQ_PICK_STORAGE);
            });
        }
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
                    android.util.Log.e("OrbitBackup", "导出失败", e);
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
        if (requestCode == REQ_PICK_STORAGE) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                try {
                    Uri tree = data.getData();
                    int flags = data.getFlags()
                        & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    getContentResolver().takePersistableUriPermission(tree, flags);
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_TREE, tree.toString()).apply();
                    ok = true;
                } catch (Exception e) {
                    android.util.Log.e("OrbitStorage", "保存目录授权失败", e);
                }
            }
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.evaluateJavascript(
                    "window.__orbitNativeDirPicked && window.__orbitNativeDirPicked(" + ok + ")",
                    null
                );
            }
            return;
        }
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
            android.util.Log.e("OrbitBackup", "读取备份失败", e);
        }
    }
}
