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

    /** Live instance for the background service to push engine events into. */
    private static volatile MainActivity sInstance;
    /** Set false after the first post-create sync with an existing connection. */
    private boolean mNeedsSync = true;
    /** Listener that feeds BotEngine events into this Activity's WebView. */
    private QuotexWsClient.Listener mActivityListener;

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

    /** Push a background-engine signal into the visible WebView (no-op if none). */
    public static void pushRemoteSignal(final String json) {
        final MainActivity a = sInstance;
        if (a == null || a.webView == null || json == null) return;
        a.webView.post(new Runnable() {
            @Override public void run() {
                try {
                    a.webView.evaluateJavascript(
                            "if(window.onRemoteSignal)window.onRemoteSignal("
                                    + org.json.JSONObject.quote(json) + ");", null);
                } catch (Exception ignored) {}
            }
        });
    }

    /** Push a background-engine settle result into the visible WebView. */
    public static void pushRemoteSettle(final String id, final String result, final double exitPrice) {
        final MainActivity a = sInstance;
        if (a == null || a.webView == null || id == null) return;
        a.webView.post(new Runnable() {
            @Override public void run() {
                try {
                    a.webView.evaluateJavascript(
                            "if(window.onRemoteSettle)window.onRemoteSettle("
                                    + org.json.JSONObject.quote(id) + ","
                                    + org.json.JSONObject.quote(result == null ? "" : result) + ","
                                    + exitPrice + ");", null);
                } catch (Exception ignored) {}
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sInstance = this;
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

        // Phase 5: feed BotEngine events into this Activity's WebView.
        // The socket itself is owned by the BotEngine singleton so it survives
        // backgrounding; the foreground QuotexService keeps the process alive.
        mActivityListener = new QuotexWsClient.Listener() {
            @Override public void onConnected(final String host) {
                evalJs("if(window.onQxConnected)window.onQxConnected("
                        + org.json.JSONObject.quote(host) + ");");
                toastOnUi("Quotex connected (" + host + ")");
            }
            @Override public void onAuthFailed(final String reason) {
                evalJs("if(window.onSsidExpired)window.onSsidExpired();");
                toastOnUi("SSID expired - please update your SSID");
            }
            @Override public void onDisconnected(final String reason) {
                evalJs("if(window.onQxDisconnected)window.onQxDisconnected("
                        + org.json.JSONObject.quote(reason == null ? "" : reason) + ");");
            }
            @Override public void onBalance(final double demo, final double live, final String cur) {
                evalJs("if(window.onQxBalance)window.onQxBalance("
                        + demo + "," + live + "," + org.json.JSONObject.quote(cur) + ");");
            }
            @Override public void onInstruments(final org.json.JSONArray instruments) {
                final String json = instruments.toString();
                if (webView == null) return;
                webView.post(new Runnable() {
                    @Override public void run() {
                        try {
                            webView.evaluateJavascript(
                                    "if(window.onQxInstruments)window.onQxInstruments("
                                            + org.json.JSONObject.quote(json) + ");", null);
                        } catch (Exception ignored) {}
                    }
                });
            }
            @Override public void onPriceTick(final String asset, final long ts, final double price) {
                evalJs("if(window.onPriceTick)window.onPriceTick("
                        + org.json.JSONObject.quote(asset) + "," + ts + "," + price + ");");
            }
        };
        BotEngine.get().addListener(mActivityListener);

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

    /** Evaluate JS on this Activity's WebView (main-thread safe). */
    private void evalJs(final String js) {
        if (webView == null) return;
        webView.post(new Runnable() {
            @Override public void run() {
                try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
        });
    }

    private void toastOnUi(final String msg) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show(); }
                catch (Exception ignored) {}
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        QuotexService.sActivityVisible = true;
        // If the Activity was recreated (e.g. swiped away) while the background
        // service holds the connection, sync the fresh page once.
        if (mNeedsSync && webView != null && BotEngine.get().isConnected()) {
            mNeedsSync = false;
            evalJs("if(window.onQxConnected)window.onQxConnected("
                    + org.json.JSONObject.quote(BotEngine.get().getLastHost()) + ");");
        }
    }

    @Override
    protected void onPause() {
        QuotexService.sActivityVisible = false;
        super.onPause();
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
     * JS bridge exposed as window.QuotexNative - REAL Quotex connection.
     * Phase 5: thin delegate over the BotEngine singleton. The socket is owned
     * process-wide so it survives backgrounding; the foreground QuotexService
     * keeps the process (and the JS signal engine) alive.
     */
    public class QuotexBridge {

        /** v2.0.35: Send Telegram message via native Java HTTP (JS fetch is blocked in WebView).
         * Returns "ok" on success, "error: ..." on failure. Runs synchronously (call off UI thread). */
        @JavascriptInterface
        public String sendTelegramNative(final String token, final String chatId, final String text) {
            final String t = token == null ? "" : token.trim();
            final String c = chatId == null ? "" : chatId.trim();
            final String msg = text == null ? "" : text;
            if (t.isEmpty() || c.isEmpty() || msg.isEmpty()) return "error: empty token/chat/text";
            java.net.HttpURLConnection conn = null;
            try {
                java.net.URL url = new java.net.URL("https://api.telegram.org/bot" + t + "/sendMessage");
                conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("chat_id", c);
                body.put("text", msg);
                body.put("parse_mode", "HTML");
                byte[] bytes = body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                java.io.OutputStream os = conn.getOutputStream();
                os.write(bytes);
                os.flush();
                os.close();
                int code = conn.getResponseCode();
                if (code == 200) return "ok";
                // read error body for diagnostics
                String err = "";
                try {
                    java.io.InputStream es = conn.getErrorStream();
                    if (es != null) {
                        byte[] buf = new byte[500];
                        int n = es.read(buf);
                        if (n > 0) err = new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8);
                    }
                } catch (Exception ignored) {}
                return "error: HTTP " + code + " " + err;
            } catch (Exception e) {
                return "error: " + e.getMessage();
            } finally {
                if (conn != null) try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }

        /** REAL: authenticate with SSID, then start the foreground service so
         * the connection (and signal engine) survives backgrounding. */
        @JavascriptInterface
        public void connect(final String ssid) {
            final String s = (ssid == null) ? "" : ssid.trim();
            if (s.isEmpty()) {
                toastOnUi("Please paste your SSID first");
                return;
            }
            BotEngine.get().connect(s, MainActivity.this);
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    maybeAskBatteryExemption();
                    startBotService(s);
                }
            });
        }

        /** Start the foreground bot service (idempotent). */
        @JavascriptInterface
        public void startBotService(final String ssid) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        Intent i = new Intent(MainActivity.this, QuotexService.class)
                                .setAction(QuotexService.ACTION_START)
                                .putExtra(QuotexService.EXTRA_SSID, ssid);
                        if (Build.VERSION.SDK_INT >= 26) {
                            startForegroundService(i);
                        } else {
                            startService(i);
                        }
                    } catch (Exception e) {
                        toastOnUi("Could not start background bot: " + e.getMessage());
                    }
                }
            });
        }

        /** Stop the foreground bot service. */
        @JavascriptInterface
        public void stopBotService() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try { stopService(new Intent(MainActivity.this, QuotexService.class)); }
                    catch (Exception ignored) {}
                }
            });
        }

        /** REAL: drop the socket, stop the service, forget the saved SSID. */
        @JavascriptInterface
        public void disconnect() {
            BotEngine.get().clearSavedSsid(MainActivity.this);
            BotEngine.get().disconnect();
            stopBotService();
            toastOnUi("Quotex disconnected");
        }

        /** REAL: true once the socket has authenticated. */
        @JavascriptInterface
        public boolean isConnected() {
            return BotEngine.get().isConnected();
        }

        /** True while the foreground bot service is running. */
        @JavascriptInterface
        public boolean isServiceRunning() {
            return QuotexService.sRunning;
        }

        /** v2.0.11: Open Quotex login in a dialog WebView. User logs in manually;
         * we extract session cookies for the balance REST API. Password never
         * touches our code — user types directly on quotex.com. */
        @JavascriptInterface
        public void openQuotexLogin() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(MainActivity.this);
                        builder.setTitle("Login to Quotex (for Balance)");
                        final WebView loginWv = new WebView(MainActivity.this);
                        loginWv.getSettings().setJavaScriptEnabled(true);
                        loginWv.getSettings().setDomStorageEnabled(true);
                        android.webkit.CookieManager.getInstance().setAcceptCookie(true);
                        loginWv.setWebViewClient(new WebViewClient() {
                            @Override public void onPageFinished(WebView view, String url) {
                                super.onPageFinished(view, url);
                                if (url != null && url.contains("/trade")) {
                                    String cookies = android.webkit.CookieManager.getInstance().getCookie("https://quotex.com");
                                    if (cookies != null && !cookies.isEmpty()) {
                                        getSharedPreferences("quotex", MODE_PRIVATE).edit()
                                            .putString("web_cookies", cookies).apply();
                                        toastOnUi("Quotex login successful! Fetching balance...");
                                        evalJs("if(window.onQuotexLogin)window.onQuotexLogin(true);");
                                        BotEngine.get().fetchBalanceWithCookies(cookies);
                                    }
                                }
                            }
                        });
                        loginWv.loadUrl("https://quotex.com");
                        builder.setView(loginWv);
                        builder.setNegativeButton("Close", null);
                        builder.show();
                    } catch (Exception e) {
                        toastOnUi("Could not open login: " + e.getMessage());
                    }
                }
            });
        }

        /** v2.0.11: Get saved web cookies (if user logged in via WebView). */
        @JavascriptInterface
        public String getWebCookies() {
            try {
                return getSharedPreferences("quotex", MODE_PRIVATE).getString("web_cookies", "");
            } catch (Exception e) { return ""; }
        }

        /** v2.0.13: Get historical candles for an asset (fetched via history/load). */
        @JavascriptInterface
        public String getHistoryCandles(String asset) {
            try {
                return QuotexWsClient.getHistoryCandles(asset == null ? "" : asset);
            } catch (Exception e) { return ""; }
        }

        /** v2.0.13: Save Quotex email/password (like Termux .env). Stored in app-private prefs. */
        @JavascriptInterface
        public void saveQxCreds(final String email, final String pass) {
            try {
                getSharedPreferences("quotex", MODE_PRIVATE).edit()
                    .putString("qx_email", email == null ? "" : email)
                    .putString("qx_pass", pass == null ? "" : pass)
                    .apply();
            } catch (Exception ignored) {}
        }

        /** v2.0.24: Clear saved Quotex credentials (account removal). */
        @JavascriptInterface
        public void clearQxCreds() {
            try {
                getSharedPreferences("quotex", MODE_PRIVATE).edit()
                    .remove("qx_email")
                    .remove("qx_pass")
                    .remove("web_cookies")
                    .remove("ssid")
                    .apply();
            } catch (Exception ignored) {}
        }

        /** v2.0.13: Full email/password login (like old Termux bot). Gets session cookies for balance. */
        @JavascriptInterface
        public void qxEmailLogin(final String email, final String pass) {
            final String e = email == null ? "" : email.trim();
            final String p = pass == null ? "" : pass;
            if (e.isEmpty() || p.isEmpty()) return;
            // Save for auto-login on next connect
            saveQxCreds(e, p);
            // v2.0.18: Full auto-login via hidden WebView (reliable - real browser session)
            // HTTP login cookies don't work for balance API (401), WebView session does.
            // v2.0.19: Make WebView VISIBLE so user can see CAPTCHA/errors if auto-fill fails
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        // v2.0.19: Make WebView VISIBLE so user can see/intervene if needed
                        // v2.0.20: Fix keyboard + auto-click "Log in" button on homepage
                        final android.webkit.WebView wv = new android.webkit.WebView(MainActivity.this);
                        final android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(MainActivity.this)
                            .setTitle("Quotex Login (auto-fill)")
                            .setView(wv)
                            .setNegativeButton("Cancel", new android.content.DialogInterface.OnClickListener() {
                                @Override public void onClick(android.content.DialogInterface d, int w) {
                                    try { wv.destroy(); } catch (Exception ignored) {}
                                }
                            })
                            .create();
                        dlg.show();
                        // v2.0.20: Fix keyboard - make dialog focusable and request focus
                        try {
                            android.view.Window win = dlg.getWindow();
                            if (win != null) {
                                win.setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                                    android.view.ViewGroup.LayoutParams.MATCH_PARENT);
                                win.clearFlags(android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                                    android.view.WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
                                win.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
                            }
                        } catch (Exception ignored) {}
                        wv.requestFocus();
                        wv.requestFocusFromTouch();
                        wv.getSettings().setJavaScriptEnabled(true);
                        wv.getSettings().setDomStorageEnabled(true);
                        android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                        cm.setAcceptCookie(true);
                        cm.removeAllCookies(null);
                        cm.flush();
                        final String jsEmail = org.json.JSONObject.quote(e);
                        final String jsPass = org.json.JSONObject.quote(p);
                        final boolean[] submitted = {false};
                        final boolean[] done = {false};
                        wv.setWebViewClient(new android.webkit.WebViewClient() {
                            @Override public void onPageFinished(android.webkit.WebView view, String url) {
                                if (url == null || done[0]) return;
                                // v2.0.20: If homepage loaded (not sign-in), click "Log in" button
                                if (!url.contains("sign-in") && !submitted[0] && !url.contains("/trade") && !url.contains("/cabinet")) {
                                    // v2.0.21: Check if this is verification code page
                                    if (url.contains("verify") || url.contains("confirm") || url.contains("otp") || url.contains("code")) {
                                        toastOnUi("📧 Email se verification code dalo");
                                        return;
                                    }
                                    String clickLogin = "(function(){" +
                                        "var btns=document.querySelectorAll('button,a');" +
                                        "for(var i=0;i<btns.length;i++){" +
                                        "var t=(btns[i].textContent||'').trim().toLowerCase();" +
                                        "if(t==='log in'||t==='login'||t==='sign in'){" +
                                        "btns[i].click();return 'clicked';}}" +
                                        "return 'notfound';})();";
                                    view.evaluateJavascript(clickLogin, new android.webkit.ValueCallback<String>() {
                                        @Override public void onReceiveValue(String v) {
                                            // Wait for login form to appear, then fill it
                                            view.postDelayed(new Runnable() {
                                                @Override public void run() {
                                                    String fillJs = "(function(){" +
                                                        "var em=document.querySelector('input[type=email],input[name=email],input[name*=email i],input[placeholder*=email i]');" +
                                                        "var pw=document.querySelector('input[type=password]');" +
                                                        "if(em&&pw){em.focus();em.value=" + jsEmail + ";pw.focus();pw.value=" + jsPass + ";" +
                                                        "em.dispatchEvent(new Event('input',{bubbles:true}));" +
                                                        "em.dispatchEvent(new Event('change',{bubbles:true}));" +
                                                        "pw.dispatchEvent(new Event('input',{bubbles:true}));" +
                                                        "pw.dispatchEvent(new Event('change',{bubbles:true}));" +
                                                        "return 'filled';}return 'notfound';})();";
                                                    view.evaluateJavascript(fillJs, null);
                                                }
                                            }, 1500);
                                        }
                                    });
                                    return;
                                }
                                // If we're on the sign-in page, auto-fill (v2.0.21: don't auto-submit, let user tap Login for 2FA)
                                if (url.contains("sign-in") && !submitted[0]) {
                                    submitted[0] = true;
                                    String fillJs = "(function(){" +
                                        "var em=document.querySelector('input[type=email],input[name=email],input[name*=email i]');" +
                                        "var pw=document.querySelector('input[type=password]');" +
                                        "if(em&&pw){em.focus();em.value=" + jsEmail + ";pw.focus();pw.value=" + jsPass + ";" +
                                        "em.dispatchEvent(new Event('input',{bubbles:true}));" +
                                        "em.dispatchEvent(new Event('change',{bubbles:true}));" +
                                        "pw.dispatchEvent(new Event('input',{bubbles:true}));" +
                                        "pw.dispatchEvent(new Event('change',{bubbles:true}));" +
                                        "return 'filled';}return 'notfound';})();";
                                    view.evaluateJavascript(fillJs, new android.webkit.ValueCallback<String>() {
                                        @Override public void onReceiveValue(String v) {
                                            if (v != null && v.contains("filled")) {
                                                toastOnUi("✅ Email/password bhar diye. Login dabao.");
                                            } else {
                                                toastOnUi("⚠️ Form nahi mila. Khud bharo.");
                                            }
                                        }
                                    });
                                }
                                // If we're on trade/cabinet page, login succeeded - extract SSID and cookies
                                else if (url.contains("/trade") || url.contains("/cabinet") || url.contains("/profile")) {
                                    done[0] = true;
                                    view.evaluateJavascript(
                                        "(function(){try{return window.settings&&window.settings.token?window.settings.token:'';}catch(e){return '';}})();",
                                        new android.webkit.ValueCallback<String>() {
                                            @Override public void onReceiveValue(String value) {
                                                String ssid = "";
                                                if (value != null) {
                                                    ssid = value.replace("\"", "").trim();
                                                    if (ssid.equals("null")) ssid = "";
                                                }
                                                // Get all cookies from WebView
                                                android.webkit.CookieManager cm2 = android.webkit.CookieManager.getInstance();
                                                String ck = cm2.getCookie("https://quotex.com");
                                                if (ck == null) ck = "";
                                                if (!ck.isEmpty()) {
                                                    getSharedPreferences("quotex", MODE_PRIVATE).edit()
                                                        .putString("web_cookies", ck).apply();
                                                    BotEngine.get().fetchBalanceWithCookies(ck);
                                                }
                                                if (!ssid.isEmpty()) {
                                                    final String fSsid = ssid;
                                                    getSharedPreferences("quotex", MODE_PRIVATE).edit()
                                                        .putString("ssid", fSsid).apply();
                                                    toastOnUi("✅ Login! SSID mil gaya. Connecting…");
                                                    evalJs("if(window.onQuotexLogin)window.onQuotexLogin(true);");
                                                    BotEngine.get().connect(fSsid, MainActivity.this);
                                                    // v2.0.34: start foreground service so connection survives backgrounding
                                                    startBotService(fSsid);
                                                } else {
                                                    toastOnUi("✅ Quotex login! Fetching balance...");
                                                    evalJs("if(window.onQuotexLogin)window.onQuotexLogin(true);");
                                                }
                                                try { dlg.dismiss(); } catch (Exception ignored) {}
                                                try { wv.destroy(); } catch (Exception ignored) {}
                                            }
                                        });
                                }
                            }
                        });
                        wv.loadUrl("https://quotex.com/en/sign-in/");
                        toastOnUi("🔐 Logging in... (form auto-fill ho raha hai)");
                    } catch (Exception ex) {
                        toastOnUi("⚠️ Login error: " + ex.getMessage());
                    }
                }
            });
        }

        /**
         * v2.0.25: Termux/pyquotex login flow in Java (user approved).
         * 1. GET /en/sign-in/ → extract _token (CSRF)
         * 2. POST /sign-in/ (form: _token, email, password, remember=1)
         * 3. If 2FA (keep_code), ask user for code via dialog
         * 4. GET /en/trade → extract window.settings.token (SSID)
         * Tries multiple hosts like Termux bot.
         */
        @JavascriptInterface
        public void qxTermuxLogin(final String email, final String pass) {
            final String e = email == null ? "" : email.trim();
            final String p = pass == null ? "" : pass;
            if (e.isEmpty() || p.isEmpty()) {
                toastOnUi("⚠️ Email/password dalo");
                return;
            }
            saveQxCreds(e, p);
            new Thread(new Runnable() {
                @Override public void run() {
                    String[] hosts = {"quotex.com", "quotex.io", "qxbroker.com"};
                    for (String host : hosts) {
                        try {
                            toastOnUi("🔐 " + host + " se login...");
                            String ssid = termuxLoginFlow(host, e, p);
                            if (ssid != null && ssid.length() > 10) {
                                final String fSsid = ssid;
                                getSharedPreferences("quotex", MODE_PRIVATE).edit()
                                    .putString("ssid", fSsid).apply();
                                toastOnUi("✅ Login! Connecting...");
                                evalJs("if(window.onQuotexLogin)window.onQuotexLogin(true);");
                                BotEngine.get().connect(fSsid, MainActivity.this);
                                // v2.0.34: start foreground service so connection survives backgrounding
                                startBotService(fSsid);
                                return;
                            }
                        } catch (Exception ex) {
                            // Try next host
                        }
                    }
                    toastOnUi("⚠️ Login failed. Email/password check karo.");
                }
            }, "qx-termux-login").start();
        }

        private String termuxLoginFlow(String host, String email, String pass) throws Exception {
            String base = "https://" + host;
            String ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
            java.util.HashMap<String, String> jar = new java.util.HashMap<>();
            // Step 1: GET sign-in page for CSRF token
            String html1 = httpGet(base + "/en/sign-in/", ua, jar, base + "/");
            if (html1 == null || html1.length() < 100) {
                toastOnUi("⚠️ " + host + ": sign-in page nahi mili");
                return null;
            }
            if (html1.contains("cf-challenge") || html1.contains("challenge-platform")) {
                toastOnUi("⚠️ " + host + ": Cloudflare block");
                return null;
            }
            String token = extractCsrfToken(html1);
            if (token == null) token = "";
            // Step 2: POST login form
            String form = "_token=" + enc(token) + "&email=" + enc(email) +
                "&password=" + enc(pass) + "&remember=1";
            String html2 = httpPost(base + "/sign-in/", form, ua, jar, base + "/en/sign-in/", base);
            if (html2 == null || html2.length() < 100) {
                toastOnUi("⚠️ " + host + ": login POST fail");
                return null;
            }
            // Step 3: Check for 2FA
            if (html2 != null && html2.contains("keep_code")) {
                String otp = askOtpFromUser();
                if (otp == null || otp.isEmpty()) return null;
                String form2 = "_token=" + enc(token) + "&code=" + enc(otp) + "&keep_code=1";
                html2 = httpPost(base + "/sign-in/modal/", form2, ua, jar, base + "/sign-in/", base);
            }
            // Check if login actually succeeded (look for indicators)
            if (html2.contains("Invalid email") || html2.contains("invalid credentials") || 
                html2.contains("Wrong email") || html2.contains("error")) {
                toastOnUi("⚠️ " + host + ": galat email/password");
                return null;
            }
            // Save cookies
            String ck = cookieHeader(jar);
            if (!ck.isEmpty()) {
                getSharedPreferences("quotex", MODE_PRIVATE).edit()
                    .putString("web_cookies", ck).apply();
            }
            // Step 4: GET trade page → SSID
            String html3 = httpGet(base + "/en/trade", ua, jar, base + "/");
            if (html3 == null) {
                toastOnUi("⚠️ " + host + ": trade page nahi mili");
                return null;
            }
            String ssid = extractSsidToken(html3);
            if (ssid == null) {
                toastOnUi("⚠️ " + host + ": SSID nahi mila (login fail?)");
            }
            return ssid;
        }

        private String httpGet(String url, String ua, java.util.Map<String,String> jar, String ref) throws Exception {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setConnectTimeout(15000); c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", ua);
            c.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            c.setRequestProperty("Upgrade-Insecure-Requests", "1");
            c.setRequestProperty("Sec-Fetch-Site", "same-origin");
            c.setRequestProperty("Sec-Fetch-Mode", "navigate");
            c.setRequestProperty("Sec-Fetch-Dest", "document");
            c.setRequestProperty("Sec-Fetch-User", "?1");
            if (ref != null) c.setRequestProperty("Referer", ref);
            String ck = cookieHeader(jar);
            if (!ck.isEmpty()) c.setRequestProperty("Cookie", ck);
            c.setInstanceFollowRedirects(true);
            int code = c.getResponseCode();
            collectCookies(c, jar);
            String body = readAll(c, code);
            c.disconnect();
            return body;
        }

        private String httpPost(String url, String form, String ua, java.util.Map<String,String> jar, String ref, String origin) throws Exception {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setConnectTimeout(15000); c.setReadTimeout(15000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", ua);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            c.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            c.setRequestProperty("Upgrade-Insecure-Requests", "1");
            c.setRequestProperty("Sec-Fetch-Site", "same-origin");
            c.setRequestProperty("Sec-Fetch-Mode", "navigate");
            c.setRequestProperty("Sec-Fetch-Dest", "iframe");
            c.setRequestProperty("Sec-Fetch-User", "?1");
            c.setRequestProperty("Cache-Control", "max-age=0");
            if (origin != null) c.setRequestProperty("Origin", origin);
            if (ref != null) c.setRequestProperty("Referer", ref);
            String ck = cookieHeader(jar);
            if (!ck.isEmpty()) c.setRequestProperty("Cookie", ck);
            byte[] b = form.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            c.setRequestProperty("Content-Length", String.valueOf(b.length));
            c.getOutputStream().write(b);
            int code = c.getResponseCode();
            collectCookies(c, jar);
            String body = readAll(c, code);
            c.disconnect();
            return body;
        }

        private void collectCookies(java.net.HttpURLConnection c, java.util.Map<String,String> jar) {
            try {
                java.util.List<String> scs = c.getHeaderFields().get("Set-Cookie");
                if (scs == null) {
                    // Try case-insensitive
                    for (java.util.Map.Entry<String, java.util.List<String>> en : c.getHeaderFields().entrySet()) {
                        if (en.getKey() != null && en.getKey().equalsIgnoreCase("Set-Cookie")) {
                            scs = en.getValue();
                            break;
                        }
                    }
                }
                if (scs != null) {
                    for (String sc : scs) {
                        int semi = sc.indexOf(';');
                        String pair = semi > 0 ? sc.substring(0, semi) : sc;
                        int eq = pair.indexOf('=');
                        if (eq > 0) jar.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
                    }
                }
            } catch (Exception ignored) {}
        }

        private String cookieHeader(java.util.Map<String,String> jar) {
            StringBuilder sb = new StringBuilder();
            for (java.util.Map.Entry<String,String> en : jar.entrySet()) {
                if (sb.length() > 0) sb.append("; ");
                sb.append(en.getKey()).append("=").append(en.getValue());
            }
            return sb.toString();
        }

        private String readAll(java.net.HttpURLConnection c, int code) {
            try {
                java.io.InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
                if (is == null) return "";
                StringBuilder sb = new StringBuilder();
                byte[] buf = new byte[32768];
                int n, total = 0;
                while ((n = is.read(buf)) > 0 && total < 300000) {
                    sb.append(new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8));
                    total += n;
                }
                return sb.toString();
            } catch (Exception ignored) { return ""; }
        }

        private String enc(String s) {
            try { return java.net.URLEncoder.encode(s == null ? "" : s, "UTF-8"); }
            catch (Exception ignored) { return ""; }
        }

        private String extractCsrfToken(String html) {
            if (html == null) return null;
            // <input ... name="_token" ... value="...">
            java.util.regex.Pattern pat = java.util.regex.Pattern.compile(
                "name=[\"']_token[\"'][^>]*value=[\"']([^\"']+)[\"']",
                java.util.regex.Pattern.CASE_INSENSITIVE);
            java.util.regex.Matcher m = pat.matcher(html);
            if (m.find()) return m.group(1);
            // value before name variant
            pat = java.util.regex.Pattern.compile(
                "value=[\"']([^\"']+)[\"'][^>]*name=[\"']_token[\"']",
                java.util.regex.Pattern.CASE_INSENSITIVE);
            m = pat.matcher(html);
            if (m.find()) return m.group(1);
            return null;
        }

        private String extractSsidToken(String html) {
            if (html == null) return null;
            int idx = html.indexOf("window.settings");
            if (idx < 0) return null;
            int searchEnd = Math.min(html.length(), idx + 60000);
            String seg = html.substring(idx, searchEnd);
            java.util.regex.Pattern pat = java.util.regex.Pattern.compile(
                "[\"']token[\"']\\s*:\\s*[\"']([^\"']{10,})[\"']");
            java.util.regex.Matcher m = pat.matcher(seg);
            if (m.find()) return m.group(1);
            return null;
        }

        private String askOtpFromUser() {
            final String[] out = {null};
            final Object lock = new Object();
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    final android.widget.EditText inp = new android.widget.EditText(MainActivity.this);
                    inp.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
                    inp.setHint("123456");
                    new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle("📧 2FA Code")
                        .setMessage("Email par aaya verification code dalo:")
                        .setView(inp)
                        .setCancelable(false)
                        .setPositiveButton("OK", new android.content.DialogInterface.OnClickListener() {
                            @Override public void onClick(android.content.DialogInterface d, int w) {
                                synchronized (lock) {
                                    out[0] = inp.getText().toString().trim();
                                    lock.notify();
                                }
                            }
                        })
                        .setNegativeButton("Cancel", new android.content.DialogInterface.OnClickListener() {
                            @Override public void onClick(android.content.DialogInterface d, int w) {
                                synchronized (lock) { lock.notify(); }
                            }
                        })
                        .show();
                }
            });
            synchronized (lock) {
                try { lock.wait(180000); } catch (InterruptedException ignored) {}
            }
            return out[0];
        }

        /**
         * Engine leader election for the JS signal engine: while the service
         * runs, its hidden page owns the engine; otherwise this visible page
         * owns it. Guarantees signals are generated exactly once.
         */
        @JavascriptInterface
        public boolean amEngineOwner() {
            return !QuotexService.sRunning;
        }

        /** REAL: last known balances as JSON. */
        @JavascriptInterface
        public String getBalance() {
            return BotEngine.get().getBalanceJson();
        }

        /** REAL: instruments/pairs list JSON (empty array until received). */
        @JavascriptInterface
        public String getAssets() {
            return BotEngine.get().getAssetsJson();
        }

        /** Subscribe to real-time prices for an asset (e.g. "EURUSD"). */
        @JavascriptInterface
        public void subscribe(final String asset) {
            BotEngine.get().subscribe(asset);
        }

        /** Re-request the instruments list. */
        @JavascriptInterface
        public void refreshAssets() {
            BotEngine.get().refreshAssets();
        }

        /** v2.0.1: connection diagnostics JSON for the Settings panel. */
        @JavascriptInterface
        public String getDiagnostics() {
            return BotEngine.get().getDiagnosticsJson();
        }
    }

    /** Ask once to exempt the app from battery optimization so Doze mode
     * doesn't kill the background socket. */
    private void maybeAskBatteryExemption() {
        try {
            if (Build.VERSION.SDK_INT < 23) return;
            android.os.PowerManager pm =
                    (android.os.PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
            android.content.SharedPreferences prefs =
                    getSharedPreferences("pt_bot", MODE_PRIVATE);
            if (prefs.getBoolean("battery_asked", false)) return;
            prefs.edit().putBoolean("battery_asked", true).apply();
            Intent i = new Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName()));
            if (i.resolveActivity(getPackageManager()) != null) {
                startActivity(i);
            }
        } catch (Exception ignored) {}
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
        try {
            if (mActivityListener != null) BotEngine.get().removeListener(mActivityListener);
        } catch (Exception ignored) {}
        mActivityListener = null;
        if (sInstance == this) sInstance = null;
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
