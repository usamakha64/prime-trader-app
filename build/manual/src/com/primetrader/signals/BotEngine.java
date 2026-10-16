package com.primetrader.signals;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Phase 5: process-wide singleton that owns the single QuotexWsClient.
 *
 * Before Phase 5 the client lived inside MainActivity's JS bridge, so the
 * socket died with the Activity (background/swipe-away = disconnect).
 * Now both MainActivity and the foreground QuotexService delegate to this
 * one engine, and connection events fan out to every registered listener
 * (each listener pushes them into its own WebView via evaluateJavascript).
 */
public class BotEngine {

    private static final String PREFS = "pt_bot";
    private static final String KEY_SSID = "ssid";

    private static volatile BotEngine sInstance;

    public static BotEngine get() {
        if (sInstance == null) {
            synchronized (BotEngine.class) {
                if (sInstance == null) sInstance = new BotEngine();
            }
        }
        return sInstance;
    }

    private final Object mLock = new Object();
    private QuotexWsClient mClient;
    private final List<QuotexWsClient.Listener> mListeners = new CopyOnWriteArrayList<>();
    private volatile String mSsid = "";
    private volatile boolean mConnecting = false;
    private volatile String mLastHost = "";
    // v2.0.30: auto-reconnect state
    private volatile boolean mManualDisconnect = false;
    private volatile int mReconnectAttempts = 0;
    private static final String PREFS_PAIRS = "quotex_pairs";
    private static final String KEY_PAIRS = "pairs_json";
    private volatile Context mAppCtx = null;

    /** Single internal listener that fans every event out to all registrants. */
    private final QuotexWsClient.Listener mFanout = new QuotexWsClient.Listener() {
        @Override public void onConnected(String host) {
            mLastHost = host == null ? "" : host;
            // v2.0.30: connection restored — reset reconnect backoff
            mReconnectAttempts = 0;
            for (QuotexWsClient.Listener l : mListeners) {
                try { l.onConnected(host); } catch (Exception ignored) {}
            }
        }
        @Override public void onAuthFailed(String reason) {
            for (QuotexWsClient.Listener l : mListeners) {
                try { l.onAuthFailed(reason); } catch (Exception ignored) {}
            }
        }
        @Override public void onDisconnected(String reason) {
            for (QuotexWsClient.Listener l : mListeners) {
                try { l.onDisconnected(reason); } catch (Exception ignored) {}
            }
            // v2.0.30: auto-reconnect with exponential backoff (unless user manually disconnected)
            scheduleReconnect();
        }
        @Override public void onBalance(double demo, double live, String cur) {
            for (QuotexWsClient.Listener l : mListeners) {
                try { l.onBalance(demo, live, cur); } catch (Exception ignored) {}
            }
        }
        @Override public void onInstruments(org.json.JSONArray instruments) {
            // v2.0.12: persist pairs to disk (92 survives restarts)
            if (mAppCtx != null) {
                try {
                    String json = QuotexWsClient.exportPayoutMap();
                    if (!json.isEmpty()) {
                        mAppCtx.getSharedPreferences(PREFS_PAIRS, Context.MODE_PRIVATE)
                            .edit().putString(KEY_PAIRS, json).apply();
                    }
                } catch (Exception ignored) {}
            }
            for (QuotexWsClient.Listener l : mListeners) {
                try { l.onInstruments(instruments); } catch (Exception ignored) {}
            }
        }
        @Override public void onPriceTick(String asset, long ts, double price) {
            for (QuotexWsClient.Listener l : mListeners) {
                try { l.onPriceTick(asset, ts, price); } catch (Exception ignored) {}
            }
        }
    };

    private BotEngine() {}

    public void addListener(QuotexWsClient.Listener l) {
        if (l != null && !mListeners.contains(l)) mListeners.add(l);
    }

    public void removeListener(QuotexWsClient.Listener l) {
        mListeners.remove(l);
    }

    /**
     * Connect with an SSID. Idempotent: no-op when already authenticated with
     * the same SSID, so the Activity and the Service can both call it safely.
     * Persists the SSID so a restarted service can reconnect on its own.
     * Runs the blocking socket work off the calling thread.
     */
    public void connect(final String ssid, final Context ctx) {
        String s = (ssid == null) ? "" : ssid.trim();
        if (s.isEmpty() && ctx != null) s = getSavedSsid(ctx);
        if (s.isEmpty()) return;
        final String target = s;
        // v2.0.30: user-initiated connect — clear manual-disconnect flag, reset backoff
        mManualDisconnect = false;
        mReconnectAttempts = 0;
        if (ctx != null) mAppCtx = ctx.getApplicationContext();
        synchronized (mLock) {
            if (mClient != null && mClient.isAuthenticated() && target.equals(mSsid)) {
                return; // already up with this SSID
            }
            if (mConnecting) return;
            mConnecting = true;
            mSsid = target;
        }
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit().putString(KEY_SSID, target).apply();
            } catch (Exception ignored) {}
        }
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    QuotexWsClient c;
                    synchronized (mLock) {
                        if (mClient == null) {
                            mClient = new QuotexWsClient(mFanout);
                            // v2.0.12: restore pairs from disk (92 survives restarts)
                            if (ctx != null) {
                                try {
                                    String saved = ctx.getSharedPreferences(PREFS_PAIRS, Context.MODE_PRIVATE)
                                        .getString(KEY_PAIRS, "");
                                    QuotexWsClient.importPayoutMap(saved);
                                } catch (Exception ignored) {}
                            }
                        }
                        c = mClient;
                    }
                    // v2.0.29: pass full WebView-login cookies to the WS handshake
                    // (pyquotex-style). Falls back to session=ssid when empty.
                    if (mAppCtx != null) {
                        try {
                            String wc = mAppCtx.getSharedPreferences("quotex", Context.MODE_PRIVATE)
                                .getString("web_cookies", "");
                            c.setWebCookies(wc == null ? "" : wc);
                        } catch (Exception ignored) {}
                    }
                    c.connect(target); // blocking; fans out onConnected/onAuthFailed/onDisconnected
                } catch (Exception ignored) {
                } finally {
                    synchronized (mLock) { mConnecting = false; }
                }
            }
        }, "botengine-connect").start();
    }

    /** Tear the socket down (async). */
    public void disconnect() {
        // v2.0.30: mark manual disconnect so auto-reconnect doesn't fire
        mManualDisconnect = true;
        mReconnectAttempts = 0;
        new Thread(new Runnable() {
            @Override public void run() {
                synchronized (mLock) {
                    mConnecting = false;
                    if (mClient != null) {
                        try { mClient.disconnect(); } catch (Exception ignored) {}
                    }
                }
            }
        }, "botengine-disconnect").start();
    }

    /** v2.0.30: auto-reconnect with exponential backoff after unexpected disconnect. */
    private void scheduleReconnect() {
        if (mManualDisconnect) return; // user chose to disconnect
        final int attempt;
        synchronized (mLock) {
            mReconnectAttempts++;
            attempt = mReconnectAttempts;
        }
        // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
        final long delayMs = Math.min(5000L * (1L << Math.min(attempt - 1, 3)), 60000L);
        new Thread(new Runnable() {
            @Override public void run() {
                try { Thread.sleep(delayMs); } catch (InterruptedException ignored) { return; }
                if (mManualDisconnect) return;
                synchronized (mLock) {
                    if (mClient != null && mClient.isAuthenticated()) {
                        mReconnectAttempts = 0; // already back — reset counter
                        return;
                    }
                    if (mConnecting) return;
                }
                String ssid = (mAppCtx != null) ? getSavedSsid(mAppCtx) : mSsid;
                if (ssid == null || ssid.isEmpty()) return;
                // Reset manual flag (this is an automatic reconnect, not user action)
                connect(ssid, mAppCtx);
            }
        }, "botengine-reconnect-" + attempt).start();
    }

    public boolean isConnected() {
        synchronized (mLock) {
            return mClient != null && mClient.isAuthenticated();
        }
    }

    public boolean isConnecting() {
        synchronized (mLock) { return mConnecting; }
    }

    public String getLastHost() { return mLastHost; }

    public String getSavedSsid(Context ctx) {
        if (ctx == null) return "";
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return p.getString(KEY_SSID, "");
        } catch (Exception e) {
            return "";
        }
    }

    public void clearSavedSsid(Context ctx) {
        mSsid = "";
        if (ctx == null) return;
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().remove(KEY_SSID).apply();
        } catch (Exception ignored) {}
    }

    /** Last known balances as JSON (same shape the JS bridge has always used). */
    public String getBalanceJson() {
        synchronized (mLock) {
            boolean c = mClient != null && mClient.isAuthenticated();
            double d = (mClient != null) ? mClient.getDemoBalance() : 0;
            double l = (mClient != null) ? mClient.getLiveBalance() : 0;
            String cur = (mClient != null) ? mClient.getCurrency() : "USD";
            return "{\"demo\":" + d + ",\"live\":" + l
                    + ",\"balance\":" + d
                    + ",\"currency\":" + JSONObject.quote(cur)
                    + ",\"connected\":" + c + "}";
        }
    }

    public String getAssetsJson() {
        synchronized (mLock) {
            return (mClient != null) ? mClient.getInstrumentsJson() : "[]";
        }
    }

    /** v2.0.1: full connection diagnostics as JSON for the Settings panel. */
    public String getDiagnosticsJson() {
        synchronized (mLock) {
            boolean conn = mClient != null && mClient.isAuthenticated();
            String clientDiag = (mClient != null) ? mClient.getDiagnosticsJson() : "{}";
            return "{\"connected\":" + conn
                    + ",\"connecting\":" + mConnecting
                    + ",\"client\":" + clientDiag + "}";
        }
    }

    public void subscribe(final String asset) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    synchronized (mLock) {
                        if (mClient == null) mClient = new QuotexWsClient(mFanout);
                        mClient.followAsset(asset);
                    }
                } catch (Exception ignored) {}
            }
        }, "botengine-sub").start();
    }

    public void refreshAssets() {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    synchronized (mLock) {
                        if (mClient != null) mClient.requestInstruments();
                    }
                } catch (Exception ignored) {}
            }
        }, "botengine-assets").start();
    }

    /** v2.0.11: Fetch balance using web session cookies (from WebView login). */
    public void fetchBalanceWithCookies(final String cookies) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    synchronized (mLock) {
                        if (mClient != null) mClient.fetchBalanceWithCookies(cookies);
                    }
                } catch (Exception ignored) {}
            }
        }, "botengine-balance").start();
    }
}
