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

    // Last known data (for getBalance/getAssets bridge calls)
    private volatile double demoBalance = 0;
    private volatile double liveBalance = 0;
    private volatile String currency = "USD";
    private volatile String instrumentsJson = "[]";
    private final List<String> followedAssets = new CopyOnWriteArrayList<>();

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

    /** Connect with SSID. Tries each host until one authenticates. Blocking - call off UI thread. */
    public void connect(String ssid) {
        this.ssid = (ssid == null) ? "" : ssid.trim();
        if (this.ssid.isEmpty()) {
            safeCallback(() -> listener.onAuthFailed("empty ssid"));
            return;
        }
        disconnect(); // clean slate
        running.set(true);

        String lastError = "";
        for (String host : HOSTS) {
            if (!running.get()) break;
            try {
                if (tryHost(host)) {
                    return; // success - reader thread now owns the connection
                }
                lastError = "auth failed on " + host;
            } catch (Exception e) {
                lastError = host + ": " + e.getMessage();
            }
            closeSocket();
        }
        running.set(false);
        final String err = lastError;
        safeCallback(() -> listener.onDisconnected(err.isEmpty() ? "all hosts failed" : err));
    }

    /** Attempt one host: TCP+TLS, WS handshake, socket.io connect, SSID auth. */
    private boolean tryHost(String host) throws Exception {
        String wsHost = "ws2." + host;
        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        SSLSocket ssl = (SSLSocket) factory.createSocket(wsHost, 443);
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
                parseAuthSuccess(msg);
                authenticated.set(true);
                connectedHost = host;
                ssl.setSoTimeout(60000);
                startReader(pingInterval);
                startHeartbeat();
                // request instruments list
                sendWsText("42[\"instruments/get\"]");
                // re-follow assets
                for (String a : followedAssets) {
                    sendWsText("42[\"depth/follow\"," + JSONObject.quote(a) + "]");
                }
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
            JSONObject root = new JSONObject(msg.substring(idx));
            // The message may be ["s_authorization", {...}] or nested
            JSONObject data = root;
            if (root.has("demoBalance") || root.has("liveBalance")) {
                data = root;
            } else {
                // try to find nested profile object
                data = findProfileObject(root);
                if (data == null) return;
            }
            demoBalance = data.optDouble("demoBalance", demoBalance);
            liveBalance = data.optDouble("liveBalance", liveBalance);
            String cur = data.optString("currencyCode", data.optString("currency", ""));
            if (!cur.isEmpty()) currency = cur;
            safeCallback(() -> listener.onBalance(demoBalance, liveBalance, currency));
        } catch (Exception ignored) {}
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

    /** Route one engine.io/socket.io text packet. */
    private void handleMessage(String msg) {
        if (msg.isEmpty()) return;
        char c = msg.charAt(0);
        if (c == '2') {
            // engine.io ping -> reply pong
            try { sendWsText("3"); } catch (Exception ignored) {}
            return;
        }
        if (c == '1' || c == '3') return; // close / pong - ignore
        if (!msg.startsWith("42")) {
            // 51- placeholder pattern: 51-["instruments/list",[...]]
            if (msg.startsWith("51-")) {
                handleInstrumentsPlaceholder(msg);
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
                    if (data instanceof JSONArray) {
                        instrumentsJson = ((JSONArray) data).toString();
                        final JSONArray copy = new JSONArray(instrumentsJson);
                        safeCallback(() -> listener.onInstruments(copy));
                    } else if (data instanceof JSONObject && ((JSONObject) data).has("list")) {
                        JSONArray list = ((JSONObject) data).getJSONArray("list");
                        instrumentsJson = list.toString();
                        final JSONArray copy = new JSONArray(instrumentsJson);
                        safeCallback(() -> listener.onInstruments(copy));
                    }
                    break;
                case "authorization/reject":
                    authenticated.set(false);
                    safeCallback(() -> listener.onAuthFailed("ssid expired or invalid"));
                    break;
                case "s_authorization":
                    parseAuthSuccess(arr.toString());
                    break;
                case "balance":
                case "profile":
                    parseAuthSuccess(arr.toString());
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
        // 51-["instruments/list",[...]] - the [...] may arrive in a follow-up packet;
        // pyquotex correlates via _temp_status. We do a best-effort inline parse.
        try {
            int idx = msg.indexOf('[');
            if (idx < 0) return;
            JSONArray arr = new JSONArray(msg.substring(idx));
            if (arr.length() >= 2 && "instruments/list".equals(arr.optString(0))) {
                Object payload = arr.get(1);
                JSONArray list = null;
                if (payload instanceof JSONArray) list = (JSONArray) payload;
                else if (payload instanceof JSONObject && ((JSONObject) payload).has("list"))
                    list = ((JSONObject) payload).getJSONArray("list");
                if (list != null) {
                    instrumentsJson = list.toString();
                    final JSONArray copy = new JSONArray(instrumentsJson);
                    safeCallback(() -> listener.onInstruments(copy));
                }
            }
        } catch (Exception ignored) {}
    }

    private void handlePriceTick(JSONArray tick) {
        try {
            if (tick.length() < 3) return;
            final String asset = tick.getString(0);
            final long ts = tick.getLong(1);
            final double price = tick.getDouble(2);
            safeCallback(() -> listener.onPriceTick(asset, ts, price));
        } catch (Exception ignored) {}
    }

    /** Subscribe to real-time prices for an asset. */
    public void followAsset(String asset) {
        if (asset == null || asset.isEmpty()) return;
        if (!followedAssets.contains(asset)) followedAssets.add(asset);
        if (isAuthenticated()) {
            try { sendWsText("42[\"depth/follow\"," + JSONObject.quote(asset) + "]"); }
            catch (Exception ignored) {}
        }
    }

    /** Request the instruments list again. */
    public void requestInstruments() {
        if (isAuthenticated()) {
            try { sendWsText("42[\"instruments/get\"]"); } catch (Exception ignored) {}
        }
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
}
