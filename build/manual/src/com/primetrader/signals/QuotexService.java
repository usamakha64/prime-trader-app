package com.primetrader.signals;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Phase 5: foreground service that keeps the Quotex connection (and the
 * 7-indicator signal engine) alive when the app is in the background or
 * swiped away.
 *
 * How it works:
 *  - Started with ACTION_START (+ SSID extra) from MainActivity's
 *    QuotexNative.connect(). Runs START_STICKY so the system restarts it
 *    (reconnecting from the persisted SSID) if the process is killed.
 *  - Hosts a hidden WebView that loads the same bundled app page. That page's
 *    JS is the designated "engine owner" while the service runs (see
 *    qxEngineOwner() in app.js), so the 30s signal engine, 5s settler,
 *    Telegram sends and website sync keep working headless.
 *  - Every engine event is fanned out by BotEngine to the Activity too, and
 *    engineSignal/engineSettled calls from the hidden page are forwarded to
 *    the visible Activity (window.onRemoteSignal / window.onRemoteSettle) so
 *    the UI stays in sync, plus an Android status-bar notification when the
 *    app is not in the foreground.
 */
public class QuotexService extends Service {

    public static final String ACTION_START = "com.primetrader.signals.action.START_BOT";
    public static final String ACTION_STOP = "com.primetrader.signals.action.STOP_BOT";
    public static final String EXTRA_SSID = "extra_ssid";

    private static final int NOTIF_ID = 4101;
    private static final int NOTIF_SIG_ID = 4102;
    private static final String CHANNEL_BOT = "pt_bot_channel";
    private static final String CHANNEL_SIG = "pt_sig_channel";
    private static final String HOME_URL = "file:///android_asset/www/index.html";

    /** True while this foreground service is up (engine owner = service WebView). */
    public static volatile boolean sRunning = false;
    /** Managed by MainActivity onResume/onPause: skip signal popups when visible. */
    public static volatile boolean sActivityVisible = false;

    private WebView mEngineView;
    private ServiceBridge mBridge;
    private QuotexWsClient.Listener mSvcListener;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = (intent != null) ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            shutdown();
            return START_NOT_STICKY;
        }
        String ssid = (intent != null) ? intent.getStringExtra(EXTRA_SSID) : null;
        if (ssid == null || ssid.trim().isEmpty()) {
            ssid = BotEngine.get().getSavedSsid(this);
        }
        if (ssid == null || ssid.trim().isEmpty()) {
            // Nothing to connect with (e.g. user disconnected before a restart).
            stopSelf();
            return START_NOT_STICKY;
        }
        sRunning = true;
        Notification n = buildStatusNotification("Connecting to Quotex…");
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
        ensureEngine(ssid.trim());
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // started service, no binding
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    /** Bring up the hidden engine WebView and make sure the socket is connected. */
    private void ensureEngine(String ssid) {
        if (mSvcListener == null) {
            mBridge = new ServiceBridge();
            mSvcListener = new QuotexWsClient.Listener() {
                @Override public void onConnected(final String host) {
                    evalJs("if(window.onQxConnected)window.onQxConnected("
                            + JSONObject.quote(host) + ");");
                    updateStatusNotification("Connected — watching markets");
                }
                @Override public void onAuthFailed(final String reason) {
                    evalJs("if(window.onSsidExpired)window.onSsidExpired();");
                    showAlertNotification("⚠️ SSID expired",
                            "Quotex rejected the SSID. Open Prime Trader to update it.");
                    updateStatusNotification("SSID expired — action needed");
                }
                @Override public void onDisconnected(final String reason) {
                    evalJs("if(window.onQxDisconnected)window.onQxDisconnected("
                            + JSONObject.quote(reason == null ? "" : reason) + ");");
                    if (sRunning) updateStatusNotification("Reconnecting…");
                }
                @Override public void onBalance(final double demo, final double live, final String cur) {
                    evalJs("if(window.onQxBalance)window.onQxBalance("
                            + demo + "," + live + "," + JSONObject.quote(cur) + ");");
                }
                @Override public void onInstruments(final org.json.JSONArray instruments) {
                    final String json = instruments.toString();
                    postToEngine(new Runnable() {
                        @Override public void run() {
                            try {
                                mEngineView.evaluateJavascript(
                                        "if(window.onQxInstruments)window.onQxInstruments("
                                                + JSONObject.quote(json) + ");", null);
                            } catch (Exception ignored) {}
                        }
                    });
                }
                @Override public void onPriceTick(final String asset, final long ts, final double price) {
                    evalJs("if(window.onPriceTick)window.onPriceTick("
                            + JSONObject.quote(asset) + "," + ts + "," + price + ");");
                }
            };
            BotEngine.get().addListener(mSvcListener);
        }
        if (mEngineView == null) {
            try {
                // Must be created on the main thread; onStartCommand runs there.
                mEngineView = new WebView(getApplicationContext());
                WebSettings s = mEngineView.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setMediaPlaybackRequiresUserGesture(false);
                mEngineView.addJavascriptInterface(mBridge, "QuotexNative");
                mEngineView.setWebViewClient(new WebViewClient());
                mEngineView.loadUrl(HOME_URL);
            } catch (Exception e) {
                // Headless WebView unavailable on this device: the socket still
                // stays alive via BotEngine; the JS engine just won't run here.
                mEngineView = null;
                updateStatusNotification("Connected (no background engine on this device)");
            }
        }
        // Idempotent: no-op if already authenticated with this SSID.
        BotEngine.get().connect(ssid, this);
        if (BotEngine.get().isConnected()) {
            updateStatusNotification("Connected — watching markets");
        }
    }

    private void evalJs(final String js) {
        postToEngine(new Runnable() {
            @Override public void run() {
                try {
                    if (mEngineView != null) mEngineView.evaluateJavascript(js, null);
                } catch (Exception ignored) {}
            }
        });
    }

    private void postToEngine(Runnable r) {
        if (mEngineView != null) {
            try { mEngineView.post(r); return; } catch (Exception ignored) {}
        }
        // No engine view: run on a background thread so callers never block.
        new Thread(r).start();
    }

    /** Full teardown: stop engine, drop socket, remove notification. */
    private void shutdown() {
        sRunning = false;
        try {
            if (mSvcListener != null) BotEngine.get().removeListener(mSvcListener);
        } catch (Exception ignored) {}
        mSvcListener = null;
        try { BotEngine.get().disconnect(); } catch (Exception ignored) {}
        if (mEngineView != null) {
            try { mEngineView.destroy(); } catch (Exception ignored) {}
            mEngineView = null;
        }
        try { stopForeground(true); } catch (Exception ignored) {}
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Exception ignored) {}
        stopSelf();
    }

    // ------------------------------------------------------------------
    // Notifications
    // ------------------------------------------------------------------

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel bot = new NotificationChannel(
                    CHANNEL_BOT, "Prime Trader Bot", NotificationManager.IMPORTANCE_LOW);
            bot.setDescription("Persistent status while the trading bot runs in the background.");
            nm.createNotificationChannel(bot);
            NotificationChannel sig = new NotificationChannel(
                    CHANNEL_SIG, "Signal alerts", NotificationManager.IMPORTANCE_HIGH);
            sig.setDescription("New signal and result alerts from the background bot.");
            nm.createNotificationChannel(sig);
        } catch (Exception ignored) {}
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class);
        i.setAction(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 100, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent stopActionIntent() {
        Intent i = new Intent(this, QuotexService.class).setAction(ACTION_STOP);
        return PendingIntent.getService(this, 101, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildStatusNotification(String text) {
        Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(this, CHANNEL_BOT)
                : new Notification.Builder(this);
        b.setContentTitle("Prime Trader — Bot Running")
                .setContentText(text)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentIntent(openAppIntent())
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Open App", openAppIntent()).build())
                .addAction(new Notification.Action.Builder(null, "Stop", stopActionIntent()).build());
        if (Build.VERSION.SDK_INT >= 26) {
            try { b.setChannelId(CHANNEL_BOT); } catch (Exception ignored) {}
        }
        return b.build();
    }

    private void updateStatusNotification(String text) {
        if (!sRunning) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildStatusNotification(text));
        } catch (Exception ignored) {}
    }

    /** Status-bar alert for a background signal (skipped while the app is open). */
    private void showSignalNotification(String title, String body) {
        if (sActivityVisible) return;
        try {
            Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                    ? new Notification.Builder(this, CHANNEL_SIG)
                    : new Notification.Builder(this);
            b.setContentTitle(title)
                    .setContentText(body)
                    .setSmallIcon(getApplicationInfo().icon)
                    .setContentIntent(openAppIntent())
                    .setAutoCancel(true);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_SIG_ID, b.build());
        } catch (Exception ignored) {}
    }

    private void showAlertNotification(String title, String body) {
        try {
            Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                    ? new Notification.Builder(this, CHANNEL_SIG)
                    : new Notification.Builder(this);
            b.setContentTitle(title)
                    .setContentText(body)
                    .setSmallIcon(getApplicationInfo().icon)
                    .setContentIntent(openAppIntent())
                    .setAutoCancel(true);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_SIG_ID + 1, b.build());
        } catch (Exception ignored) {}
    }

    private void toastOnUi(final String msg) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() {
                try {
                    Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_LONG).show();
                } catch (Exception ignored) {}
            }
        });
    }

    // ------------------------------------------------------------------
    // JS bridge for the hidden engine WebView (window.QuotexNative).
    // The hidden page is ALWAYS the engine owner while the service runs.
    // ------------------------------------------------------------------
    public class ServiceBridge {

        @JavascriptInterface
        public void connect(final String ssid) {
            // Already inside the service: just (re)connect, never re-start self.
            BotEngine.get().connect(ssid, QuotexService.this);
        }

        @JavascriptInterface
        public void disconnect() {
            shutdown();
        }

        @JavascriptInterface
        public boolean isConnected() {
            return BotEngine.get().isConnected();
        }

        @JavascriptInterface
        public String getBalance() {
            return BotEngine.get().getBalanceJson();
        }

        @JavascriptInterface
        public String getAssets() {
            return BotEngine.get().getAssetsJson();
        }

        @JavascriptInterface
        public void subscribe(final String asset) {
            BotEngine.get().subscribe(asset);
        }

        @JavascriptInterface
        public void refreshAssets() {
            BotEngine.get().refreshAssets();
        }

        /** Engine leader election: the service's hidden page always owns it. */
        @JavascriptInterface
        public boolean amEngineOwner() {
            return true;
        }

        @JavascriptInterface
        public boolean isServiceRunning() {
            return true;
        }

        /**
         * Called by the hidden page's JS engine right after it emits a real
         * signal (Telegram + website already fired from JS). Forwards the
         * signal to the visible Activity for live UI sync and raises a
         * status-bar notification when the app isn't open.
         */
        @JavascriptInterface
        public void engineSignal(final String json) {
            MainActivity.pushRemoteSignal(json);
            try {
                JSONObject o = new JSONObject(json);
                String asset = o.optString("asset", "");
                String dir = o.optString("dir", "");
                int conf = o.optInt("conf", 0);
                showSignalNotification("📡 New Signal",
                        asset + " " + dir + " " + conf + "% — tap to open");
            } catch (Exception ignored) {}
        }

        /**
         * Called by the hidden page's JS settler when a signal expires.
         * Forwards to the visible Activity and notifies on the result.
         */
        @JavascriptInterface
        public void engineSettled(final String id, final String result, final double exitPrice) {
            MainActivity.pushRemoteSettle(id, result, exitPrice);
            try {
                boolean win = "WIN".equals(result);
                showSignalNotification(win ? "✅ WIN" : "❌ LOSS",
                        (win ? "Signal " : "Signal ") + id + " settled: " + result);
            } catch (Exception ignored) {}
        }
    }
}
