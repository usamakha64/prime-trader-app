package com.primetrader.signals;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.TimeZone;

/**
 * v2.0.60: Supabase candle_backup sync from native Java.
 *
 * Same table / keys / merge semantics the JS used (PT_SB_URL / PT_SB_ANON
 * in js/app.js), but driven by a ScheduledExecutorService in BotEngine —
 * Java timers are NOT frozen in the background, unlike Chromium JS timers.
 *
 * Safety rules (ported from the v2.0.57 JS fixes):
 *  - never save before a successful cloud load/merge (we always GET first
 *    and merge, so a save can only grow cloud data, never shrink it);
 *  - never save when the local store has fewer than MIN_PAIRS_TO_SAVE pairs;
 *  - per-pair merge keeps the LONGER array (cloud vs local).
 */
public class SupabaseSync {

    private static final String SB_URL = "https://sovvicsyflemmrfghwan.supabase.co";
    private static final String SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdnZpY3N5ZmxlbW1yZmdod2FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzE2NjksImV4cCI6MjEwNjI0NzY2OX0.PB4Rz9acHTO4kLFuFYelG85AW5E2qIJkPEwnFGfOiQw";
    private static final String DEVICE_ID = "default";
    private static final int MIN_PAIRS_TO_SAVE = 5;

    private final CandleStore store;

    public SupabaseSync(CandleStore store) {
        this.store = store;
    }

    private static HttpURLConnection open(String path, String method) throws Exception {
        URL url = new URL(SB_URL + path);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setRequestProperty("apikey", SB_ANON);
        c.setRequestProperty("Authorization", "Bearer " + SB_ANON);
        c.setRequestProperty("Content-Type", "application/json");
        return c;
    }

    private static String readAll(HttpURLConnection c) throws Exception {
        InputStream in;
        try {
            in = c.getInputStream();
        } catch (Exception e) {
            in = c.getErrorStream();
            if (in == null) throw e;
        }
        BufferedReader br = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();
        return sb.toString();
    }

    /**
     * GET the current cloud candles. Returns the candles JSONObject, an empty
     * JSONObject when the table is reachable but has no row yet, or null on
     * network failure.
     */
    public JSONObject fetchCloud() {
        HttpURLConnection c = null;
        try {
            String path = "/rest/v1/candle_backup?device_id=eq."
                    + URLEncoder.encode(DEVICE_ID, "UTF-8") + "&select=candles";
            c = open(path, "GET");
            int code = c.getResponseCode();
            String body = readAll(c);
            if (code < 200 || code >= 300) return null;
            JSONArray arr = new JSONArray(body);
            if (arr.length() == 0) return new JSONObject();
            JSONObject row = arr.optJSONObject(0);
            if (row == null) return new JSONObject();
            JSONObject candles = row.optJSONObject("candles");
            return candles != null ? candles : new JSONObject();
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) {
                try { c.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    /** Load cloud candles into the store (called once at sync start; caller retries). */
    public boolean loadIntoStore() {
        try {
            JSONObject cloud = fetchCloud();
            if (cloud == null) return false;
            store.loadFromJson(cloud);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Save cycle: fetch cloud, merge per-pair keeping the LONGER array,
     * POST with resolution=merge-duplicates. Returns true on HTTP 2xx.
     */
    public boolean save() {
        HttpURLConnection c = null;
        try {
            if (store.pairCount() < MIN_PAIRS_TO_SAVE) return false;
            JSONObject cloud = fetchCloud();
            if (cloud == null) return false; // never write blind
            JSONObject local = store.toJson();

            JSONObject merged = new JSONObject();
            Iterator<String> ck = cloud.keys();
            while (ck.hasNext()) {
                String k = ck.next();
                try { merged.put(k, cloud.get(k)); } catch (Exception ignored) {}
            }
            Iterator<String> lk = local.keys();
            while (lk.hasNext()) {
                String k = lk.next();
                JSONArray lArr = local.optJSONArray(k);
                JSONArray cArr = merged.optJSONArray(k);
                int ll = (lArr != null) ? lArr.length() : 0;
                int cl = (cArr != null) ? cArr.length() : 0;
                if (lArr != null && ll >= cl) {
                    try { merged.put(k, lArr); } catch (Exception ignored) {}
                }
            }

            int pairs = 0;
            long total = 0;
            Iterator<String> mk = merged.keys();
            while (mk.hasNext()) {
                JSONArray a = merged.optJSONArray(mk.next());
                if (a != null) {
                    pairs++;
                    total += a.length();
                }
            }
            if (pairs < MIN_PAIRS_TO_SAVE) return false;

            JSONObject body = new JSONObject();
            body.put("device_id", DEVICE_ID);
            body.put("candles", merged);
            body.put("updated_at", isoNow());

            c = open("/rest/v1/candle_backup", "POST");
            c.setRequestProperty("Prefer", "resolution=merge-duplicates");
            c.setDoOutput(true);
            byte[] bytes = body.toString().getBytes("UTF-8");
            c.setFixedLengthStreamingMode(bytes.length);
            OutputStream os = c.getOutputStream();
            os.write(bytes);
            os.flush();
            os.close();
            int code = c.getResponseCode();
            readAll(c); // drain
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) {
                try { c.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    private static String isoNow() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }
}
