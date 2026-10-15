package com.primetrader.signals;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final String HOME_URL = "file:///android_asset/www/index.html";

    private WebView webView;
    private DownloadManager downloadManager;
    private long pendingDownloadId = -1;

    private static final String UPDATE_APK_NAME = "PrimeTrader-update.apk";

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != pendingDownloadId) {
                return;
            }
            pendingDownloadId = -1;
            if (isDownloadSuccessful(id)) {
                installApkFromProvider();
            } else {
                Toast.makeText(MainActivity.this, "Update download failed", Toast.LENGTH_LONG).show();
            }
        }
    };

    /** Check DownloadManager status for the completed download id. */
    private boolean isDownloadSuccessful(long id) {
        DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
        android.database.Cursor c = null;
        try {
            c = downloadManager.query(q);
            if (c != null && c.moveToFirst()) {
                int status = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
                return status == DownloadManager.STATUS_SUCCESSFUL;
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return false;
    }

    /** File object for the update APK inside our app-private external files dir. */
    private java.io.File updateApkFile() {
        java.io.File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) {
            return null;
        }
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return new java.io.File(dir, UPDATE_APK_NAME);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setAllowFileAccess(true);
        // allow the bundled page (file://) to fetch the update check URL (https://)
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // JS -> native bridge for the in-app updater: window.PrimeTrader.downloadAndInstall(url)
        webView.addJavascriptInterface(new UpdateBridge(), "PrimeTrader");
        // JS -> native bridge for the real Quotex connection: window.QuotexNative.connect(ssid)
        webView.addJavascriptInterface(new QuotexBridge(), "QuotexNative");

        webView.setWebViewClient(new WebViewClient());

        downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }

        if (savedInstanceState == null) {
            webView.loadUrl(HOME_URL);
        }
    }

    /** JS bridge exposed as window.PrimeTrader */
    public class UpdateBridge {
        @JavascriptInterface
        public void downloadAndInstall(final String apkUrl) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    // Android 8+: the app needs the "install unknown apps" grant
                    if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                        Toast.makeText(MainActivity.this,
                                "Please allow \"Install unknown apps\" for Prime Trader, then try again",
                                Toast.LENGTH_LONG).show();
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    }
                    try {
                        java.io.File dest = updateApkFile();
                        if (dest == null) {
                            Toast.makeText(MainActivity.this,
                                    "Storage unavailable for update", Toast.LENGTH_LONG).show();
                            return;
                        }
                        // Remove any stale partial download so the receiver's file is fresh.
                        if (dest.exists()) {
                            dest.delete();
                        }
                        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(apkUrl));
                        req.setTitle("Prime Trader Update");
                        req.setDescription("Downloading new version...");
                        req.setNotificationVisibility(
                                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        req.setMimeType("application/vnd.android.package-archive");
                        // App-private dir: no storage permission needed, and our
                        // ApkProvider can grant the installer one-time read access.
                        req.setDestinationUri(Uri.fromFile(dest));
                        pendingDownloadId = downloadManager.enqueue(req);
                        Toast.makeText(MainActivity.this,
                                "Downloading update...", Toast.LENGTH_SHORT).show();
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this,
                                "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public String getNativeVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        /** Returns true if a downloaded update APK is present in our app-private dir. */
        @JavascriptInterface
        public boolean isUpdateDownloaded() {
            java.io.File apk = updateApkFile();
            return apk != null && apk.isFile() && apk.length() > 0;
        }

        /** Manual fallback: fire the installer for the already-downloaded update APK. */
        @JavascriptInterface
        public void installDownloadedUpdate() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    // Android 8+: the app needs the "install unknown apps" grant
                    if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                        Toast.makeText(MainActivity.this,
                                "Please allow \"Install unknown apps\" for Prime Trader, then try again",
                                Toast.LENGTH_LONG).show();
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    }
                    installApkFromProvider();
                }
            });
        }
    }

    /**
     * JS bridge exposed as window.QuotexNative - REAL Quotex connection (Phase 2).
     * Uses QuotexWsClient: wss:// socket.io EIO=3 + SSID auth, price streams,
     * balance, instruments. Callbacks push data back into the WebView via JS.
     */
    public class QuotexBridge {
        private volatile QuotexWsClient qxClient;
        private final Object qxLock = new Object();

        private QuotexWsClient.Listener qxListener() {
            return new QuotexWsClient.Listener() {
                @Override
                public void onConnected(final String host) {
                    evalJs("if(window.onQxConnected)window.onQxConnected("
                            + org.json.JSONObject.quote(host) + ");");
                    toastOnUi("Quotex connected (" + host + ")");
                }

                @Override
                public void onAuthFailed(final String reason) {
                    evalJs("if(window.onSsidExpired)window.onSsidExpired();");
                    toastOnUi("SSID expired - please update your SSID");
                }

                @Override
                public void onDisconnected(final String reason) {
                    evalJs("if(window.onQxDisconnected)window.onQxDisconnected("
                            + org.json.JSONObject.quote(reason) + ");");
                }

                @Override
                public void onBalance(final double demo, final double live, final String cur) {
                    evalJs("if(window.onQxBalance)window.onQxBalance("
                            + demo + "," + live + ","
                            + org.json.JSONObject.quote(cur) + ");");
                }

                @Override
                public void onInstruments(final org.json.JSONArray instruments) {
                    // Large payload - pass through; JS parses it.
                    final String json = instruments.toString();
                    webView.post(new Runnable() {
                        @Override
                        public void run() {
                            // Use a direct string arg to avoid URL length limits.
                            webView.evaluateJavascript(
                                    "if(window.onQxInstruments)window.onQxInstruments("
                                            + org.json.JSONObject.quote(json) + ");",
                                    null);
                        }
                    });
                }

                @Override
                public void onPriceTick(final String asset, final long ts, final double price) {
                    evalJs("if(window.onPriceTick)window.onPriceTick("
                            + org.json.JSONObject.quote(asset) + ","
                            + ts + "," + price + ");");
                }
            };
        }

        private void evalJs(final String js) {
            if (webView == null) return;
            webView.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        webView.evaluateJavascript(js, null);
                    } catch (Exception ignored) {}
                }
            });
        }

        private void toastOnUi(final String msg) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            });
        }

        private QuotexWsClient client() {
            synchronized (qxLock) {
                if (qxClient == null) {
                    qxClient = new QuotexWsClient(qxListener());
                }
                return qxClient;
            }
        }

        /** REAL: open wss:// + authenticate with SSID (runs off the UI thread). */
        @JavascriptInterface
        public void connect(final String ssid) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        client().connect(ssid);
                    } catch (Exception e) {
                        toastOnUi("Quotex connect error: " + e.getMessage());
                    }
                }
            }, "quotex-connect").start();
        }

        /** REAL: close the WebSocket. */
        @JavascriptInterface
        public void disconnect() {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        synchronized (qxLock) {
                            if (qxClient != null) qxClient.disconnect();
                        }
                    } catch (Exception ignored) {}
                    toastOnUi("Quotex disconnected");
                }
            }, "quotex-disconnect").start();
        }

        /** REAL: true once the socket has authenticated. */
        @JavascriptInterface
        public boolean isConnected() {
            synchronized (qxLock) {
                return qxClient != null && qxClient.isAuthenticated();
            }
        }

        /** REAL: last known balances as JSON. */
        @JavascriptInterface
        public String getBalance() {
            synchronized (qxLock) {
                boolean c = qxClient != null && qxClient.isAuthenticated();
                double d = (qxClient != null) ? qxClient.getDemoBalance() : 0;
                double l = (qxClient != null) ? qxClient.getLiveBalance() : 0;
                String cur = (qxClient != null) ? qxClient.getCurrency() : "USD";
                return "{\"demo\":" + d + ",\"live\":" + l
                        + ",\"balance\":" + d
                        + ",\"currency\":" + org.json.JSONObject.quote(cur)
                        + ",\"connected\":" + c + "}";
            }
        }

        /** REAL: instruments/pairs list JSON (empty array until received). */
        @JavascriptInterface
        public String getAssets() {
            synchronized (qxLock) {
                return (qxClient != null) ? qxClient.getInstrumentsJson() : "[]";
            }
        }

        /** Subscribe to real-time prices for an asset (e.g. "EURUSD"). */
        @JavascriptInterface
        public void subscribe(final String asset) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try { client().followAsset(asset); } catch (Exception ignored) {}
                }
            }, "quotex-sub").start();
        }

        /** Re-request the instruments list. */
        @JavascriptInterface
        public void refreshAssets() {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try { client().requestInstruments(); } catch (Exception ignored) {}
                }
            }, "quotex-assets").start();
        }
    }

    /** Fire the system installer with a content URI served by our ApkProvider. */
    private void installApkFromProvider() {
        java.io.File apk = updateApkFile();
        if (apk == null || !apk.isFile()) {
            Toast.makeText(this, "Update file missing - please retry", Toast.LENGTH_LONG).show();
            return;
        }
        Uri uri = Uri.parse("content://" + ApkProvider.AUTHORITY + "/updates/" + UPDATE_APK_NAME);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        // Belt-and-braces: also grant read permission explicitly to the resolved installer.
        try {
            for (android.content.pm.ResolveInfo ri : getPackageManager()
                    .queryIntentActivities(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)) {
                grantUriPermission(ri.activityInfo.packageName, uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } catch (Exception ignored) {
        }
        try {
            startActivity(intent);
        } catch (Exception e) {
            // Last resort: open the system Downloads UI so the user can tap the APK manually.
            Toast.makeText(this,
                    "Opening installer failed - opening Downloads so you can install manually",
                    Toast.LENGTH_LONG).show();
            try {
                startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        }
    }

    private void installApk(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Could not open installer: " + e.getMessage(),
                    Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
