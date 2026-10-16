package com.primetrader.signals;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Minimal Quotex WebSocket client (Phase 2 - REAL connection).
 *
 * Protocol (reverse-engineered from pyquotex):
 *  - wss://ws2.{host}/socket.io/?EIO=3&transport=websocket  (socket.io EIO=3)
 *  - Engine.io open: server sends 0{"sid":"...","pingInterval":25000,...}
 *  - Client sends 40 (socket.io connect)
 *  - Client sends 42["authorization",{"session":"SSID","isDemo":1,"tournamentId":0}]
 *  - Server replies with s_authorization (OK) or authorization/reject (SSID expired)
 *  - Heartbeat: 42["tick"] every 5s + engine.io ping/pong (2/3)
 *  - Instruments: 42["instruments/get"] -> 51-["instruments/list",[...]]
 *  - Prices: server pushes 42[[asset, ts, price, ...]] for followed assets
 *  - Follow: 42["depth/follow","EURUSD"]
 *
 * Pure JDK + Android (org.json is built into Android). No external deps.
 */
public class QuotexWsClient {

    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

    private static final String[] HOSTS = {"quotex.com", "quotex.io", "qxbroker.com", "qxbroker.io"};

    /** Callback interface for connection events -> bridged to JS. */
    public interface Listener {
        void onConnected(String host);
        void onAuthFailed(String reason);   // SSID expired / invalid
        void onDisconnected(String reason);
        void onBalance(double demoBalance, double liveBalance, String currency);
        void onInstruments(JSONArray instruments);
        void onPriceTick(String asset, long timestamp, double price);
    }

    private final Listener listener;
    private volatile Socket socket;
    private volatile InputStream in;
    private volatile OutputStream out;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean authenticated = new AtomicBoolean(false);
    private volatile String connectedHost = "";
    private volatile String ssid = "";
    // v2.0.29: full browser cookies from WebView login (pyquotex-style).
    // The WS handshake sends these (not just session=ssid) so the server
    // attaches the full account session -> balance events flow.
    private volatile String webCookies = "";

    /** Set full session cookies (from WebView login). Call before connect(). */
    public void setWebCookies(String cookies) {
        this.webCookies = (cookies == null) ? "" : cookies.trim();
    }

    // Last known data (for getBalance/getAssets bridge calls)
    private volatile double demoBalance = 0;
    private volatile double liveBalance = 0;
    private volatile String currency = "USD";
    private volatile String instrumentsJson = "[]";
    private final List<String> followedAssets = new CopyOnWriteArrayList<>();

    // v2.0.1 diagnostics: what the socket is actually doing
    private volatile long tickCount = 0;
    private volatile long lastTickTime = 0;
    private volatile long lastAuthTime = 0;
    private volatile long lastInstrumentsTime = 0;
    private volatile int instrumentsCount = 0;
    private volatile String lastError = "";
    private volatile String lastAuthSnippet = "";
    // v2.0.2: true after a 451- instruments placeholder, until payload arrives
    private volatile boolean instrumentsPending = false;
    // v2.0.3: ring buffer of recent inbound messages for debugging (SSID redacted)
    private final java.util.ArrayDeque<String> recentMessages = new java.util.ArrayDeque<>();
    // v2.0.4: depth/change carries live [symbol, payout] pairs (binary event)
    private volatile boolean depthPending = false;
    // v2.0.6: quotes/stream carries live price ticks (binary event)
    private volatile boolean quotesPending = false;
    // v2.0.9: static so pairs survive reconnects (92 won't drop back to 24)
    private static final java.util.Map<String, Integer> payoutMap = new java.util.LinkedHashMap<>();
    // v2.0.4: dedicated capture of the balance event (ring buffer gets flooded)
    private volatile String lastBalanceRaw = "";
    // v2.0.6: REST balance attempt result (for diagnostics)
    private volatile String balanceRest = "";
    // v2.0.8: throttle for payout UI publishes
    private volatile long lastPublishTime = 0;

    /** Log an inbound message (truncated, SSID redacted) for diagnostics. */
    private void logRaw(String msg) {
        try {
            String t = msg.length() > 160 ? msg.substring(0, 160) + "…" : msg;
            // redact anything that looks like a session token
            t = t.replaceAll("\"session\"\\s*:\\s*\"[^\"]*\"", "\"session\":\"[redacted]\"");
            synchronized (recentMessages) {
                recentMessages.addLast(System.currentTimeMillis() / 1000 + " " + t);
                while (recentMessages.size() > 25) recentMessages.removeFirst();
            }
        } catch (Exception ignored) {}
    }

    private Thread readerThread;
    private Thread heartbeatThread;

    public QuotexWsClient(Listener listener) {
        this.listener = listener;
    }

    public boolean isAuthenticated() {
        return authenticated.get() && running.get();
    }

    public String getConnectedHost() {
        return connectedHost;
    }

    public double getDemoBalance() { return demoBalance; }
    public double getLiveBalance() { return liveBalance; }
    public String getCurrency() { return currency; }
    public String getInstrumentsJson() { return instrumentsJson; }

    /** v2.0.1: diagnostics snapshot as JSON for the Settings panel. */
    public String getDiagnosticsJson() {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("authenticated", isAuthenticated());
            o.put("running", running.get());
            o.put("host", connectedHost);
            o.put("demoBalance", demoBalance);
            o.put("liveBalance", liveBalance);
            o.put("currency", currency);
            o.put("tickCount", tickCount);
            o.put("lastTickAgeSec", lastTickTime > 0 ? (System.currentTimeMillis() - lastTickTime) / 1000 : -1);
            o.put("instrumentsCount", instrumentsCount);
            o.put("lastAuthAgeSec", lastAuthTime > 0 ? (System.currentTimeMillis() - lastAuthTime) / 1000 : -1);
            o.put("lastError", lastError);
            o.put("lastAuthSnippet", lastAuthSnippet);
            o.put("lastBalanceRaw", lastBalanceRaw); // v2.0.4
            o.put("balanceRest", balanceRest); // v2.0.6
            org.json.JSONArray recent = new org.json.JSONArray();
            synchronized (recentMessages) {
                for (String m : recentMessages) recent.put(m);
            }
            o.put("recent", recent);
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }

    /** Connect with SSID. Tries each host until one authenticates. Blocking - call off UI thread. */
    public void connect(String ssid) {
        this.ssid = (ssid == null) ? "" : ssid.trim();
        if (this.ssid.isEmpty()) {
            safeCallback(() -> listener.onAuthFailed("empty ssid"));
            return;
        }
        disconnect(); // clean slate
        running.set(true);

        String failReason = "";
        for (String host : HOSTS) {
            if (!running.get()) break;
            try {
                if (tryHost(host)) {
                    this.lastError = "";
                    return; // success - reader thread now owns the connection
                }
                failReason = "auth failed on " + host;
            } catch (Exception e) {
                failReason = host + ": " + e.getMessage();
            }
            closeSocket();
        }
        running.set(false);
        this.lastError = failReason.isEmpty() ? "all hosts failed" : failReason;
        final String errMsg = this.lastError;
        safeCallback(() -> listener.onDisconnected(errMsg));
    }

    /** Attempt one host: TCP+TLS, WS handshake, socket.io connect, SSID auth. */
    private boolean tryHost(String host) throws Exception {
        String wsHost = "ws2." + host;
        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        // v2.0.1: connect timeout — a hanging TCP connect used to wedge the
        // connect thread forever (mConnecting stuck), making later SSID
        // saves silently do nothing.
        SSLSocket ssl = (SSLSocket) factory.createSocket();
        ssl.connect(new java.net.InetSocketAddress(wsHost, 443), 10000);
        ssl.setSoTimeout(15000);
        this.socket = ssl;
        this.in = ssl.getInputStream();
        this.out = ssl.getOutputStream();

        // ---- WebSocket handshake ----
        String path = "/socket.io/?EIO=3&transport=websocket";
        byte[] keyBytes = new byte[16];
        new Random().nextBytes(keyBytes);
        String wsKey = Base64.getEncoder().encodeToString(keyBytes);

        String req = "GET " + path + " HTTP/1.1\r\n"
                + "Host: " + wsHost + "\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + wsKey + "\r\n"
                + "Sec-WebSocket-Version: 13\r\n"
                + "User-Agent: " + UA + "\r\n"
                + "Origin: https://" + host + "\r\n"
                // v2.0.29: send FULL browser cookies (WebView login) like pyquotex does.
                // Falls back to session=ssid when no web cookies are saved.
                + "Cookie: " + (webCookies.isEmpty() ? "session=" + ssid : webCookies) + "\r\n"
                + "\r\n";
        out.write(req.getBytes(StandardCharsets.UTF_8));
        out.flush();

        // Read HTTP status + headers manually (byte-wise, no BufferedReader:
        // BufferedReader would over-buffer and eat the first WebSocket frame).
        String statusLine = readHttpLine(in);
        if (statusLine == null || !statusLine.contains("101")) {
            throw new Exception("WS handshake failed: " + statusLine);
        }
        // consume headers
        String hline;
        while ((hline = readHttpLine(in)) != null && !hline.isEmpty()) { /* skip */ }

        // ---- Engine.io open packet: 0{...} ----
        String open = readWsText();
        if (open == null || !open.startsWith("0")) {
            throw new Exception("no engine.io open, got: " + abbrev(open));
        }
        long pingInterval = 25000;
        try {
            JSONObject o = new JSONObject(open.substring(1));
            pingInterval = o.optLong("pingInterval", 25000);
        } catch (Exception ignored) {}

        // ---- socket.io connect ----
        sendWsText("40");

        // ---- SSID auth ----
        JSONObject payload = new JSONObject();
        payload.put("session", ssid);
        payload.put("isDemo", 1);
        payload.put("tournamentId", 0);
        JSONArray arr = new JSONArray();
        arr.put("authorization");
        arr.put(payload);
        sendWsText("42" + arr.toString());

        // ---- Wait for auth result (up to 15s) ----
        ssl.setSoTimeout(15000);
        long deadline = System.currentTimeMillis() + 15000;
        while (System.currentTimeMillis() < deadline && running.get()) {
            String msg = readWsText();
            if (msg == null) break;
            if (msg.contains("authorization/reject")) {
                safeCallback(() -> listener.onAuthFailed("ssid expired or invalid"));
                return false;
            }
            if (msg.contains("s_authorization")) {
                // Auth OK - parse profile/balance from the message
                // v2.0.1: record when auth happened + a snippet for diagnostics
                lastAuthTime = System.currentTimeMillis();
                try { lastAuthSnippet = msg.length() > 300 ? msg.substring(0, 300) : msg; }
                catch (Exception ignored) { lastAuthSnippet = ""; }
                parseAuthSuccess(msg);
                authenticated.set(true);
                connectedHost = host;
                ssl.setSoTimeout(60000);
                startReader(pingInterval);
                startHeartbeat();
                // v2.0.2: match the real client's post-auth sequence exactly
                // (pyquotex sends these; the server gates data pushes on them)
                sendWsText("42[\"tick\"]");
                sendWsText("42[\"indicator/list\"]");
                sendWsText("42[\"drawing/load\"]");
                sendWsText("42[\"pending/list\"]");
                sendWsText("42[\"chart_notification/get\"]");
                // v2.0.6: account/change often triggers the server to push balance
                sendWsText("42[\"account/change\",{\"demo\":1,\"tournamentId\":0}]");
                // request instruments list
                sendWsText("42[\"instruments/get\"]");
                // v2.0.32: retry instruments/get after 15s if list is empty/small
                // (server sometimes doesn't respond to first request)
                final QuotexWsClient self = this;
                new Thread(() -> {
                    try { Thread.sleep(15000); } catch (InterruptedException ignored) { return; }
                    if (!running.get() || !authenticated.get()) return;
                    if (instrumentsCount < 20) {
                        try { self.sendWsText("42[\"instruments/get\"]"); } catch (Exception ignored) {}
                    }
                }, "instruments-retry").start();
                // re-follow assets (v2.0.5: full 3-step sequence)
                for (String a : followedAssets) {
                    sendFollowSequence(a);
                }
                // v2.0.32: auto-follow comprehensive pairs list to discover ALL active pairs
                // (server only sends depth/change for followed assets)
                autoFollowAllPairs();
                // v2.0.6: balance doesn't come over ws in production - try REST digest
                fetchBalanceRest();
                safeCallback(() -> listener.onConnected(host));
                return true;
            }
            // ignore other pre-auth messages (e.g. 40 ack)
        }
        return false;
    }

    /** Parse balance/profile from the s_authorization message. */
    private void parseAuthSuccess(String msg) {
        try {
            int idx = msg.indexOf('{');
            if (idx < 0) return;
            // v2.0.28: strip the socket.io array envelope ["event",{...}] properly —
            // the raw substring leaves a trailing ']' which breaks JSONObject parsing
            String sub = msg.substring(idx);
            int depth = 0;
            int end = -1;
            for (int i = 0; i < sub.length(); i++) {
                char ch = sub.charAt(i);
                if (ch == '{') depth++;
                else if (ch == '}') { depth--; if (depth == 0) { end = i + 1; break; } }
            }
            if (end > 0) sub = sub.substring(0, end);
            JSONObject root = new JSONObject(sub);
            parseBalanceObject(root);
        } catch (Exception ignored) {}
    }

    /** v2.0.28: Extract demo/live balance from an already-parsed payload object
     *  (pyquotex _h_balance: the "balance" event payload IS the balance object). */
    private void parseBalanceObject(JSONObject root) {
        try {
            if (root == null) return;
            JSONObject data = root;
            if (!root.has("demoBalance") && !root.has("liveBalance")) {
                // try to find nested profile object
                data = findProfileObject(root);
                if (data == null) return;
            }
            // v2.0.23: Handle string balances like "11094" (Termux flow)
            demoBalance = parseBalanceValue(data, "demoBalance", demoBalance);
            liveBalance = parseBalanceValue(data, "liveBalance", liveBalance);
            String cur = data.optString("currencyCode", data.optString("currency", ""));
            if (!cur.isEmpty()) currency = cur;
            safeCallback(() -> listener.onBalance(demoBalance, liveBalance, currency));
        } catch (Exception ignored) {}
    }

    /** v2.0.23: Parse balance that may be a number or a string like "11094". */
    private double parseBalanceValue(JSONObject data, String key, double def) {
        try {
            Object v = data.opt(key);
            if (v == null) return def;
            if (v instanceof Number) return ((Number) v).doubleValue();
            if (v instanceof String) {
                String s = ((String) v).trim().replace(",", "");
                if (!s.isEmpty()) return Double.parseDouble(s);
            }
        } catch (Exception ignored) {}
        return def;
    }

    private JSONObject findProfileObject(JSONObject root) {
        // breadth-first-ish search for an object containing demoBalance
        try {
            java.util.ArrayDeque<JSONObject> q = new java.util.ArrayDeque<>();
            q.add(root);
            int steps = 0;
            while (!q.isEmpty() && steps++ < 40) {
                JSONObject o = q.poll();
                if (o.has("demoBalance") || o.has("liveBalance")) return o;
                java.util.Iterator<String> keys = o.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    Object v = o.opt(k);
                    if (v instanceof JSONObject) q.add((JSONObject) v);
                    else if (v instanceof JSONArray) {
                        JSONArray ja = (JSONArray) v;
                        for (int i = 0; i < Math.min(ja.length(), 5); i++) {
                            if (ja.opt(i) instanceof JSONObject) q.add(ja.getJSONObject(i));
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** Background reader: engine.io packets + socket.io events. */
    private void startReader(final long pingInterval) {
        readerThread = new Thread(() -> {
            try {
                while (running.get() && socket != null && !socket.isClosed()) {
                    String msg = readWsText();
                    if (msg == null) break;
                    handleMessage(msg);
                }
            } catch (Exception e) {
                // connection lost
            } finally {
                boolean wasAuth = authenticated.getAndSet(false);
                running.set(false);
                closeSocket();
                if (wasAuth) {
                    safeCallback(() -> listener.onDisconnected("connection lost"));
                }
            }
        }, "quotex-ws-reader");
        readerThread.setDaemon(true);
        readerThread.start();
    }

    private void startHeartbeat() {
        heartbeatThread = new Thread(() -> {
            try {
                while (running.get() && authenticated.get()) {
                    Thread.sleep(5000);
                    if (!running.get()) break;
                    try { sendWsText("42[\"tick\"]"); } catch (Exception ignored) {}
                }
            } catch (InterruptedException ignored) {}
        }, "quotex-ws-heartbeat");
        heartbeatThread.setDaemon(true);
        heartbeatThread.start();
    }

    /** v2.0.6: balance isn't pushed over ws in production - try the REST digest
     *  endpoint with the SSID as session cookie. Result goes to diagnostics. */
    private void fetchBalanceRest() {
        final String host = connectedHost;
        final String token = ssid;
        if (host.isEmpty() || token.isEmpty()) return;
        // v2.0.30: include full web cookies (WebView login) as first try — pyquotex-style
        final String wc = webCookies;
        Thread t = new Thread(() -> {
            // v2.0.7: try several auth styles; log each result to diagnostics
            java.util.List<String[]> tries = new java.util.ArrayList<>();
            if (wc != null && !wc.isEmpty()) {
                tries.add(new String[]{wc, null}); // full browser cookies FIRST
            }
            tries.add(new String[]{"session=" + token, null});
            tries.add(new String[]{token, null});
            tries.add(new String[]{null, "Bearer " + token});
            StringBuilder log = new StringBuilder();
            for (String[] tr : tries) {
                java.net.HttpURLConnection c = null;
                try {
                    java.net.URL url = new java.net.URL("https://" + host + "/api/v1/cabinets/digest");
                    c = (java.net.HttpURLConnection) url.openConnection();
                    c.setConnectTimeout(10000);
                    c.setReadTimeout(10000);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
                    c.setRequestProperty("Referer", "https://" + host + "/en/trade");
                    if (tr[0] != null) c.setRequestProperty("Cookie", tr[0]);
                    if (tr[1] != null) c.setRequestProperty("Authorization", tr[1]);
                    int code = c.getResponseCode();
                    String body = "";
                    try {
                        java.io.InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
                        // v2.0.31: read FULL body (was 2000 bytes -> JSON truncated -> parse fail)
                        StringBuilder sb = new StringBuilder();
                        byte[] buf = new byte[8000];
                        int n;
                        while ((n = is.read(buf)) > 0) {
                            sb.append(new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8));
                            if (sb.length() > 100000) break; // safety cap
                        }
                        body = sb.toString();
                    } catch (Exception ignored) {}
                    log.append("HTTP ").append(code).append("; ");
                    balanceRest = log.toString() + (body.length() > 200 ? body.substring(0, 200) : body);
                    if (code == 200 && body.contains("demoBalance")) {
                        try {
                            JSONObject root = new JSONObject(body);
                            JSONObject d = root.optJSONObject("data");
                            if (d == null) d = root;
                            // v2.0.31: use parseBalanceValue (handles "11094" strings, not just numbers)
                            demoBalance = parseBalanceValue(d, "demoBalance", demoBalance);
                            liveBalance = parseBalanceValue(d, "liveBalance", liveBalance);
                            String cur = d.optString("currencyCode", d.optString("currency", ""));
                            if (!cur.isEmpty()) currency = cur;
                            final double db = demoBalance, lb = liveBalance;
                            final String cu = currency;
                            safeCallback(() -> listener.onBalance(db, lb, cu));
                        } catch (Exception ignored) {}
                        return; // success - stop trying
                    }
                } catch (Exception e) {
                    log.append("ERR; ");
                    balanceRest = log.toString() + e.getMessage();
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }, "quotex-rest-balance");
        t.setDaemon(true);
        t.start();
    }

    /** Route one engine.io/socket.io text packet. */
    private void handleMessage(String msg) {
        if (msg.isEmpty()) return;
        logRaw(msg); // v2.0.3: keep recent messages for diagnostics
        char c = msg.charAt(0);
        if (c == '2') {
            // engine.io ping -> reply pong
            try { sendWsText("3"); } catch (Exception ignored) {}
            return;
        }
        if (c == '1' || c == '3') return; // close / pong - ignore
        if (!msg.startsWith("42")) {
            // v2.0.2: binary-event header is 451- (socket.io type 45 = binary
            // event, 1 attachment), NOT 51- as previously assumed.
            // e.g. 451-["instruments/list",{"_placeholder":true,"num":1}]
            if (msg.startsWith("451-") || msg.startsWith("51-")) {
                handleInstrumentsPlaceholder(msg);
                return;
            }
            // Binary payload following a placeholder: raw JSON, no 42 envelope.
            if (instrumentsPending) {
                handleInstrumentsPayload(msg);
                return;
            }
            // v2.0.4: depth/change payout payload: [["BTCUSD",50],["ETHUSD",44],...]
            if (depthPending) {
                handleDepthPayload(msg);
                return;
            }
            // v2.0.6: quotes/stream tick payload: [["BTCUSD",1792112413.11,82279.14,1],...]
            if (quotesPending) {
                handleQuotesPayload(msg);
                return;
            }
            return;
        }
        String body = msg.substring(2);
        try {
            JSONArray arr = new JSONArray(body);
            if (arr.length() == 0) return;
            Object first = arr.get(0);
            if (first instanceof String) {
                String event = (String) first;
                Object data = arr.length() > 1 ? arr.get(1) : null;
                handleEvent(event, data, arr);
            } else if (first instanceof JSONArray) {
                // price tick: [[asset, ts, price, ...]]
                handlePriceTick((JSONArray) first);
            }
        } catch (Exception ignored) {
            // Fallback: raw string scan for balance/profile updates
            if (msg.contains("demoBalance") || msg.contains("liveBalance")) {
                parseAuthSuccess(msg);
            }
        }
    }

    private void handleEvent(String event, Object data, JSONArray arr) {
        try {
            switch (event) {
                case "instruments/list":
                    // v2.0.13: MERGE instead of overwrite (prevents 92->24)
                    try {
                        JSONArray list = null;
                        if (data instanceof JSONArray) list = (JSONArray) data;
                        else if (data instanceof JSONObject && ((JSONObject) data).has("list"))
                            list = ((JSONObject) data).getJSONArray("list");
                        if (list != null) storeInstruments(list);
                    } catch (Exception ignored) {}
                    break;
                case "authorization/reject":
                    authenticated.set(false);
                    safeCallback(() -> listener.onAuthFailed("ssid expired or invalid"));
                    break;
                case "s_authorization":
                    // v2.0.28: payload directly when available (envelope-safe)
                    if (data instanceof JSONObject) {
                        parseBalanceObject((JSONObject) data);
                    } else {
                        parseAuthSuccess(arr.toString());
                    }
                    break;
                case "balance":
                case "profile":
                    lastBalanceRaw = arr.toString(); // v2.0.4: dedicated capture
                    if (lastBalanceRaw.length() > 500) lastBalanceRaw = lastBalanceRaw.substring(0, 500);
                    // v2.0.28: parse the event payload DIRECTLY (pyquotex _h_balance) —
                    // re-parsing the raw ["balance",{...}] string breaks on the envelope
                    if (data instanceof JSONObject) {
                        parseBalanceObject((JSONObject) data);
                    } else {
                        parseAuthSuccess(arr.toString());
                    }
                    break;
                case "history":
                    // v2.0.13: historical candles response (for immediate signals like old bot)
                    try {
                        handleHistoryCandles(data, arr);
                    } catch (Exception ignored) {}
                    break;
                default:
                    // price ticks can also arrive as named events in some flows
                    if (data instanceof JSONArray) {
                        JSONArray d = (JSONArray) data;
                        if (d.length() >= 3 && d.opt(0) instanceof String
                                && d.opt(1) instanceof Number && d.opt(2) instanceof Number) {
                            handlePriceTick(d);
                        }
                    }
                    // balance updates may ride along other events
                    String raw = arr.toString();
                    if (raw.contains("demoBalance") || raw.contains("liveBalance")) {
                        parseAuthSuccess(raw);
                    }
                    break;
            }
        } catch (Exception ignored) {}
    }

    private void handleInstrumentsPlaceholder(String msg) {
        // 451-["instruments/list",{"_placeholder":true,"num":1}] - the real
        // instruments JSON arrives in the NEXT binary frame(s), raw JSON
        // with no socket.io envelope (pyquotex correlates via _temp_status).
        // v2.0.4: production also sends 451-["depth/change",{"_placeholder":true,"num":0}]
        // followed by [["SYMBOL",payout],...] - this is the live pairs+payout feed.
        try {
            int idx = msg.indexOf('[');
            if (idx < 0) return;
            JSONArray arr = new JSONArray(msg.substring(idx));
            if (arr.length() < 2) return;
            String event = arr.optString(0, "");
            Object payload = arr.get(1);
            boolean isPlaceholder = payload instanceof JSONObject
                    && ((JSONObject) payload).optBoolean("_placeholder", false);
            if ("depth/change".equals(event)) {
                if (isPlaceholder) depthPending = true; // payout payload comes next
                return;
            }
            // v2.0.6: live price ticks
            if ("quotes/stream".equals(event)) {
                if (isPlaceholder) quotesPending = true; // tick payload comes next
                return;
            }
            if ("instruments/list".equals(event)) {
                if (isPlaceholder) {
                    instrumentsPending = true; // data comes next
                    return;
                }
                JSONArray list = null;
                if (payload instanceof JSONArray) list = (JSONArray) payload;
                else if (payload instanceof JSONObject && ((JSONObject) payload).has("list"))
                    list = ((JSONObject) payload).getJSONArray("list");
                if (list != null) {
                    storeInstruments(list);
                } else {
                    instrumentsPending = true; // unknown shape - try next frame
                }
            }
        } catch (Exception ignored) {}
    }

    /** v2.0.6: quotes/stream tick payload: [["BTCUSD",1792112413.11,82279.14,1],...] */
    private void handleQuotesPayload(String msg) {
        quotesPending = false; // consumed (one payload per placeholder)
        try {
            String t = msg.trim();
            if (!t.startsWith("[")) return;
            JSONArray arr = new JSONArray(t);
            for (int i = 0; i < arr.length(); i++) {
                JSONArray row = arr.optJSONArray(i);
                if (row != null) handlePriceTick(row);
            }
        } catch (Exception ignored) {}
    }

    /** v2.0.4: depth/change payout payload: [["BTCUSD",50],["ETHUSD",44],...] */
    private void handleDepthPayload(String msg) {
        try {
            String t = msg.trim();
            if (!t.startsWith("[")) return;
            JSONArray arr = new JSONArray(t);
            // sanity: rows must be [string, number]
            if (arr.length() == 0) return;
            JSONArray r0 = arr.optJSONArray(0);
            if (r0 == null || !(r0.opt(0) instanceof String) || !(r0.opt(1) instanceof Number)) return;
            depthPending = false; // got it
            synchronized (payoutMap) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONArray row = arr.optJSONArray(i);
                    if (row == null || row.length() < 2) continue;
                    String sym = row.optString(0, "");
                    int payout = row.optInt(1, -1);
                    if (!sym.isEmpty() && payout >= 0) {
                        payoutMap.put(sym, payout);
                    }
                }
            }
            // v2.0.8: ALWAYS publish the full accumulated list so the UI never
            // goes stale (JS throttles its own toast; render is cheap).
            publishPayoutInstruments();
        } catch (Exception ignored) {}
    }

    private String payoutInstrumentsJson() throws Exception {
        JSONArray list = new JSONArray();
        synchronized (payoutMap) {
            for (java.util.Map.Entry<String, Integer> e : payoutMap.entrySet()) {
                JSONObject o = new JSONObject();
                o.put("symbol", e.getKey());
                o.put("name", e.getKey());
                o.put("payout", e.getValue());
                list.put(o);
            }
        }
        return list.toString();
    }

    /** v2.0.12: Export payout map for disk persistence (so 92 survives restarts). */
    public static String exportPayoutMap() {
        try {
            JSONArray list = new JSONArray();
            synchronized (payoutMap) {
                for (java.util.Map.Entry<String, Integer> e : payoutMap.entrySet()) {
                    JSONObject o = new JSONObject();
                    o.put("s", e.getKey());
                    o.put("p", e.getValue());
                    list.put(o);
                }
            }
            return list.toString();
        } catch (Exception ignored) { return ""; }
    }

    /** v2.0.12: Import payout map from disk (restore 92 after restart). */
    public static void importPayoutMap(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            JSONArray list = new JSONArray(json);
            synchronized (payoutMap) {
                for (int i = 0; i < list.length(); i++) {
                    JSONObject o = list.optJSONObject(i);
                    if (o == null) continue;
                    String s = o.optString("s", "");
                    int p = o.optInt("p", -1);
                    if (!s.isEmpty() && p >= 0 && !payoutMap.containsKey(s)) {
                        payoutMap.put(s, p);
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private void publishPayoutInstruments() {
        try {
            // v2.0.8: throttle UI publishes to at most one per 3s
            long now = System.currentTimeMillis();
            if (now - lastPublishTime < 3000 && instrumentsCount > 0) return;
            lastPublishTime = now;
            instrumentsJson = payoutInstrumentsJson();
            instrumentsCount = payoutMap.size();
            lastInstrumentsTime = System.currentTimeMillis();
            final JSONArray copy = new JSONArray(instrumentsJson);
            safeCallback(() -> listener.onInstruments(copy));
        } catch (Exception ignored) {}
    }

    /** Raw JSON payload (binary frame) after an instruments placeholder. */
    private void handleInstrumentsPayload(String msg) {
        try {
            String t = msg.trim();
            if (t.startsWith("[")) {
                storeInstruments(new JSONArray(t));
                // v2.0.38: DON'T clear instrumentsPending immediately — server may send
                // instruments in multiple chunks. Keep collecting for 5s, then stop.
                // (Old code cleared on first chunk → only 48 pairs, rest lost.)
                scheduleInstrumentsDone();
            } else if (t.startsWith("{")) {
                JSONObject o = new JSONObject(t);
                if (o.has("list")) {
                    storeInstruments(o.getJSONArray("list"));
                    scheduleInstrumentsDone();
                }
            }
        } catch (Exception ignored) {}
    }

    /** v2.0.38: Clear instrumentsPending after 5s (allows multi-chunk responses). */
    private volatile boolean instrumentsDoneScheduled = false;
    private void scheduleInstrumentsDone() {
        if (instrumentsDoneScheduled) return;
        instrumentsDoneScheduled = true;
        new Thread(() -> {
            try { Thread.sleep(5000); } catch (Exception ignored) {}
            instrumentsPending = false;
            instrumentsDoneScheduled = false;
        }, "instruments-done-timer").start();
    }

    private void storeInstruments(JSONArray list) {
        try {
            // v2.0.10: MERGE into payoutMap instead of overwriting (prevents 92->24 drop)
            // v2.0.30: accept instruments even without payout (default 0) — don't skip
            // v2.0.36: collect new symbols to auto-follow (server's full list, not hardcoded)
            java.util.List<String> newSymbols = new java.util.ArrayList<>();
            synchronized (payoutMap) {
                for (int i = 0; i < list.length(); i++) {
                    try {
                        JSONObject o = list.optJSONObject(i);
                        if (o == null) continue;
                        String sym = o.optString("asset", o.optString("symbol", o.optString("name", "")));
                        int payout = o.optInt("payout", o.optInt("profit", o.optInt("payout_percent", 0)));
                        if (!sym.isEmpty()) {
                            boolean isNew = !payoutMap.containsKey(sym);
                            payoutMap.put(sym, Math.max(0, payout));
                            if (isNew && !followedAssets.contains(sym)) {
                                newSymbols.add(sym);
                            }
                        }
                    } catch (Exception ignored) {}
                }
            }
            // Always publish from the merged map
            publishPayoutInstruments();
            lastInstrumentsTime = System.currentTimeMillis();
            // v2.0.36: auto-follow ALL instruments from server (not just hardcoded 58)
            // This discovers the 58-60 live pairs Quotex actually has
            if (!newSymbols.isEmpty()) {
                final java.util.List<String> toFollow = newSymbols;
                new Thread(() -> {
                    try {
                        for (String sym : toFollow) {
                            if (!running.get() || !authenticated.get()) break;
                            if (followedAssets.contains(sym)) continue;
                            try { sendFollowSequence(sym); } catch (Exception ignored) {}
                            Thread.sleep(150);
                        }
                    } catch (Exception ignored) {}
                }, "autofollow-server-pairs").start();
            }
        } catch (Exception ignored) {}
    }

    /** v2.0.13: Handle historical candles from history/load (for immediate signals).
     *  Format: {"candles": [[time, open, high, low, close], ...]} or similar.
     *  Sends to JS via onQxHistory(asset, candlesJson). */
    private void handleHistoryCandles(Object data, JSONArray arr) {
        try {
            JSONArray candles = null;
            String asset = "";
            if (data instanceof JSONObject) {
                JSONObject o = (JSONObject) data;
                asset = o.optString("asset", "");
                if (o.has("candles")) candles = o.optJSONArray("candles");
                else if (o.has("data")) {
                    Object d = o.get("data");
                    if (d instanceof JSONArray) candles = (JSONArray) d;
                    else if (d instanceof JSONObject) candles = ((JSONObject) d).optJSONArray("candles");
                }
            } else if (data instanceof JSONArray) {
                candles = (JSONArray) data;
            }
            // Also check arr[2] for asset name
            if (asset.isEmpty() && arr.length() > 2) {
                Object a = arr.opt(2);
                if (a instanceof String) asset = (String) a;
                else if (a instanceof JSONObject) asset = ((JSONObject) a).optString("asset", "");
            }
            if (candles == null || candles.length() == 0 || asset.isEmpty()) return;
            final String fAsset = asset;
            final String fJson = candles.toString();
            // Store in static map for JS to pull via getHistoryCandles
            synchronized (historyCandles) {
                historyCandles.put(fAsset, fJson);
            }
        } catch (Exception ignored) {}
    }

    /** v2.0.13: Static store for historical candles (JS pulls via getHistoryCandles). */
    private static final java.util.Map<String, String> historyCandles = new java.util.LinkedHashMap<>();

    /** v2.0.13: JS calls this to get historical candles for an asset. */
    public static String getHistoryCandles(String asset) {
        synchronized (historyCandles) {
            String j = historyCandles.get(asset);
            if (j == null) {
                // Try normalized variants
                for (java.util.Map.Entry<String, String> e : historyCandles.entrySet()) {
                    if (e.getKey().equalsIgnoreCase(asset)) { j = e.getValue(); break; }
                }
            }
            return j == null ? "" : j;
        }
    }

    private void handlePriceTick(JSONArray tick) {
        try {
            // v2.0.4: unwrap [[[asset,ts,price]]] nesting if present
            while (tick.length() == 1 && tick.opt(0) instanceof JSONArray) {
                JSONArray inner = tick.optJSONArray(0);
                if (inner == null) break;
                tick = inner;
            }
            if (tick.length() < 3) return;
            if (!(tick.opt(0) instanceof String)) return;
            final String asset = tick.getString(0);
            // v2.0.6: server sends timestamp in SECONDS (fractional), JS needs ms
            double tsRaw = tick.optDouble(1, 0);
            final long ts = tsRaw > 1e12 ? (long) tsRaw : (long) (tsRaw * 1000);
            final double price = tick.getDouble(2);
            tickCount++;
            lastTickTime = System.currentTimeMillis();
            safeCallback(() -> listener.onPriceTick(asset, ts, price));
        } catch (Exception ignored) {}
    }

    /** Subscribe to real-time prices for an asset.
     * v2.0.5: full 3-step sequence like pyquotex (depth/follow alone gives no ticks). */
    public void followAsset(String asset) {
        if (asset == null || asset.isEmpty()) return;
        if (!followedAssets.contains(asset)) followedAssets.add(asset);
        if (isAuthenticated()) {
            sendFollowSequence(asset);
        }
    }

    private void sendFollowSequence(String asset) {
        try {
            String q = JSONObject.quote(asset);
            sendWsText("42[\"instruments/update\",{\"asset\":" + q + ",\"period\":60}]");
            sendWsText("42[\"chart_notification/get\",{\"asset\":" + q + ",\"version\":\"1.0.0\"}]");
            sendWsText("42[\"depth/follow\"," + q + "]");
            // v2.0.13: fetch historical candles for immediate signals (like old bot)
            long nowSec = System.currentTimeMillis() / 1000;
            sendWsText("42[\"history/load\",{\"asset\":" + q + ",\"index\":0,\"time\":" + nowSec + ",\"offset\":3600,\"period\":60}]");
        } catch (Exception ignored) {}
    }

    /** Request the instruments list again. */
    public void requestInstruments() {
        if (isAuthenticated()) {
            try { sendWsText("42[\"instruments/get\"]"); } catch (Exception ignored) {}
        }
    }

    /** v2.0.32: Auto-follow comprehensive pairs list to discover ALL active pairs.
     * Server sends depth/change only for followed assets, so we follow them all. */
    private void autoFollowAllPairs() {
        // Major forex, OTC variants, crypto, commodities — comprehensive Quotex list
        // v2.0.40: expanded with OTC crypto pairs (from user's Telegram screenshots)
        String[] pairs = {
            "EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF","EURGBP","EURJPY","GBPJPY","NZDUSD",
            "AUDCAD","AUDJPY","CADJPY","CHFJPY","EURAUD","EURCAD","EURNZD","GBPAUD","GBPCAD","GBPNZD",
            "NZDCAD","NZDJPY","AUDNZD","CADCHF","EURCHF","GBPCHF","AUDCHF","NZDCHF",
            "USDTRY","EURTRY","USDMXN","USDZAR","USDSGD","USDHKD",
            "EURUSD_otc","GBPUSD_otc","USDJPY_otc","AUDUSD_otc","USDCAD_otc","USDCHF_otc","EURGBP_otc","EURJPY_otc",
            "GBPJPY_otc","NZDUSD_otc","AUDCAD_otc","AUDJPY_otc","EURAUD_otc","EURCAD_otc","EURNZD_otc","GBPCAD_otc",
            "GBPNZD_otc","CADJPY_otc","NZDJPY_otc","AUDNZD_otc","EURCHF_otc","GBPCHF_otc",
            "BTCUSD","ETHUSD","LTCUSD","XRPUSD","DOGEUSD","ADAUSD","SOLUSD","BNBUSD",
            "BTCUSD_otc","ETHUSD_otc","LTCUSD_otc","XRPUSD_otc","DOGEUSD_otc","ADAUSD_otc","SOLUSD_otc","BNBUSD_otc",
            "BCHUSD_otc","DOTUSD_otc","TRUUSD_otc","ZECUSD_otc","AXSUSD_otc","DASUSD_otc","ATOUSD_otc","ETCUSD_otc",
            "LINUSD_otc","AVAUSD_otc",
            "XAUUSD","XAGUSD","USOIL","UKOIL","SP500","NAS100","US30","GER30","JPN225","AUS200"
        };
        new Thread(() -> {
            try {
                // Stagger follows to avoid overwhelming the server
                for (String p : pairs) {
                    if (!running.get() || !authenticated.get()) break;
                    if (followedAssets.contains(p)) continue;
                    try { sendFollowSequence(p); } catch (Exception ignored) {}
                    Thread.sleep(200);
                }
            } catch (Exception ignored) {}
        }, "autofollow-pairs").start();
    }

    public void disconnect() {
        running.set(false);
        authenticated.set(false);
        try { sendWsText("41"); } catch (Exception ignored) {}
        closeSocket();
        if (readerThread != null) { readerThread.interrupt(); readerThread = null; }
        if (heartbeatThread != null) { heartbeatThread.interrupt(); heartbeatThread = null; }
    }

    private void closeSocket() {
        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        socket = null;
    }

    private void safeCallback(Runnable r) {
        try { r.run(); } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------------
    // Minimal RFC 6455 WebSocket framing over the raw socket.
    // ------------------------------------------------------------------

    private synchronized void sendWsText(String text) throws Exception {
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        int len = payload.length;
        // header: FIN+text opcode, MASK set, length
        java.io.ByteArrayOutputStream frame = new java.io.ByteArrayOutputStream();
        frame.write(0x81);
        if (len < 126) {
            frame.write(0x80 | len);
        } else if (len < 65536) {
            frame.write(0x80 | 126);
            frame.write((len >> 8) & 0xFF);
            frame.write(len & 0xFF);
        } else {
            frame.write(0x80 | 127);
            for (int i = 7; i >= 0; i--) frame.write((int) ((len >> (8 * i)) & 0xFF));
        }
        byte[] mask = new byte[4];
        new Random().nextBytes(mask);
        frame.write(mask);
        for (int i = 0; i < len; i++) frame.write(payload[i] ^ mask[i % 4]);
        out.write(frame.toByteArray());
        out.flush();
    }

    /** Read one complete text frame. Returns null on close/error. */
    private String readWsText() {
        try {
            int b0 = in.read();
            int b1 = in.read();
            if (b0 < 0 || b1 < 0) return null;
            boolean fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0F;
            boolean masked = (b1 & 0x80) != 0;
            long len = b1 & 0x7F;
            if (len == 126) {
                len = ((in.read() & 0xFF) << 8) | (in.read() & 0xFF);
            } else if (len == 127) {
                len = 0;
                for (int i = 0; i < 8; i++) len = (len << 8) | (in.read() & 0xFF);
            }
            byte[] mask = new byte[4];
            if (masked) {
                readFully(mask, 4);
            }
            if (opcode == 0x8) return null; // close frame
            if (opcode != 0x1 && opcode != 0x0 && opcode != 0x2) {
                // ping -> pong, then continue
                if (opcode == 0x9) {
                    sendPong();
                    return readWsText();
                }
                return readWsText();
            }
            if (len > 16 * 1024 * 1024) return null; // sanity cap
            byte[] payload = new byte[(int) len];
            readFully(payload, (int) len);
            if (masked) {
                for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
            }
            String text = new String(payload, StandardCharsets.UTF_8);
            if (!fin) {
                // fragmented - append continuations (rare for this API)
                StringBuilder sb = new StringBuilder(text);
                String next;
                while ((next = readWsText()) != null) {
                    sb.append(next);
                    break; // our readWsText consumes one frame; good enough
                }
                return sb.toString();
            }
            return text;
        } catch (Exception e) {
            return null;
        }
    }

    private void readFully(byte[] buf, int len) throws Exception {
        int off = 0;
        while (off < len) {
            int n = in.read(buf, off, len - off);
            if (n < 0) throw new java.io.EOFException();
            off += n;
        }
    }

    private void sendPong() {
        try {
            out.write(new byte[]{(byte) 0x8A, (byte) 0x80, 0, 0, 0, 0});
            out.flush();
        } catch (Exception ignored) {}
    }

    /** Read one CRLF-terminated HTTP header line, byte-wise (no over-buffering). */
    private static String readHttpLine(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        int b;
        while ((b = in.read()) >= 0) {
            if (b == '\n') break;
            if (b != '\r') bos.write(b);
            if (bos.size() > 8192) break;
        }
        if (b < 0 && bos.size() == 0) return null;
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String abbrev(String s) {
        if (s == null) return "null";
        return s.length() > 120 ? s.substring(0, 120) + "..." : s;
    }

    /** Extract a readable asset/payout summary from the instruments JSON. */
    public static List<String> summarizeInstruments(String json) {
        List<String> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String name = o.optString("name", o.optString("asset", ""));
                double payout = o.optDouble("payout", o.optDouble("profit", -1));
                if (!name.isEmpty()) out.add(name + ":" + (int) payout);
            }
        } catch (Exception ignored) {}
        return out;
    }

    /** v2.0.11: Fetch balance using web session cookies from WebView login.
     *  Cookies come from CookieManager after user logs in on quotex.com manually. */
    public void fetchBalanceWithCookies(final String cookies) {
        final String host = connectedHost;
        if (host.isEmpty() || cookies == null || cookies.isEmpty()) return;
        Thread t = new Thread(() -> {
            java.net.HttpURLConnection c = null;
            try {
                java.net.URL url = new java.net.URL("https://" + host + "/api/v1/cabinets/digest");
                c = (java.net.HttpURLConnection) url.openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(10000);
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
                c.setRequestProperty("Referer", "https://" + host + "/en/trade");
                c.setRequestProperty("Cookie", cookies);
                c.setRequestProperty("Accept", "application/json");
                int code = c.getResponseCode();
                String body = "";
                try {
                    java.io.InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
                    byte[] buf = new byte[4000];
                    int n = is.read(buf);
                    if (n > 0) body = new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8);
                } catch (Exception ignored) {}
                balanceRest = "WEB HTTP " + code + "; " + (body.length() > 200 ? body.substring(0, 200) : body);
                if (code == 200 && (body.contains("demoBalance") || body.contains("balance"))) {
                    try {
                        JSONObject root = new JSONObject(body);
                        JSONObject d = root.optJSONObject("data");
                        if (d == null) d = root;
                        // v2.0.12: Quotex sends balances as STRINGS ("11094"), not numbers
                        String dbStr = d.optString("demoBalance", d.optString("demo_balance", ""));
                        String lbStr = d.optString("liveBalance", d.optString("live_balance", ""));
                        if (!dbStr.isEmpty()) {
                            try { demoBalance = Double.parseDouble(dbStr); } catch (Exception ignored) {}
                        }
                        if (!lbStr.isEmpty()) {
                            try { liveBalance = Double.parseDouble(lbStr); } catch (Exception ignored) {}
                        }
                        String cur = d.optString("currencyCode", d.optString("currency", ""));
                        if (!cur.isEmpty()) currency = cur;
                        final double fdb = demoBalance, flb = liveBalance;
                        final String fcu = currency;
                        safeCallback(() -> listener.onBalance(fdb, flb, fcu));
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                balanceRest = "WEB ERR; " + e.getMessage();
            } finally {
                if (c != null) c.disconnect();
            }
        }, "quotex-web-balance");
        t.setDaemon(true);
        t.start();
    }
}
