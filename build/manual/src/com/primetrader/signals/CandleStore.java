package com.primetrader.signals;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * v2.0.60: Native-Java 1-minute candle store — the SINGLE source of truth
 * for candles.
 *
 * Why Java and not JS: Chromium freezes JS timers in background/hidden
 * WebViews, so the old JS candle building + 30s cloud-save died as soon as
 * the app was backgrounded ("progress disappears"). This store lives in the
 * process (owned by BotEngine, kept alive by the foreground QuotexService)
 * and is driven by real socket ticks + a ScheduledExecutorService, so
 * candles keep building and saving in the background.
 *
 * Candle JSON shape matches the JS/app + Supabase format exactly:
 *   { "EURUSD": [ {"t":<bucketMs>,"o":..,"h":..,"l":..,"c":..}, ... ], ... }
 * Asset names are normalized like JS qxNormAsset(): UPPERCASE, "_OTC" -> "-OTC".
 * Keeps MAX_CANDLES (61) per pair — the strategy warmup size.
 */
public class CandleStore {

    public static final int MAX_CANDLES = 61;

    private static class Candle {
        long t;
        double o, h, l, c;

        Candle(long t, double p) {
            this.t = t;
            o = h = l = c = p;
        }

        void tick(double p) {
            if (p > h) h = p;
            if (p < l) l = p;
            c = p;
        }

        JSONObject toJson() throws Exception {
            JSONObject j = new JSONObject();
            j.put("t", t);
            j.put("o", o);
            j.put("h", h);
            j.put("l", l);
            j.put("c", c);
            return j;
        }
    }

    private final Object lock = new Object();
    private final Map<String, Deque<Candle>> map = new HashMap<>();

    /** Normalize like JS qxNormAsset(): 'EURUSD_otc' -> 'EURUSD-OTC'. */
    public static String normAsset(String a) {
        if (a == null) return "";
        String s = a.trim().toUpperCase();
        if (s.endsWith("_OTC")) s = s.substring(0, s.length() - 4) + "-OTC";
        return s;
    }

    /** Feed one price tick. Thread-safe and cheap — called on every socket tick. */
    public void onTick(String asset, long tsMs, double price) {
        if (asset == null || asset.isEmpty()) return;
        if (!(price > 0) || Double.isNaN(price) || Double.isInfinite(price)) return;
        if (tsMs <= 0) return;
        String norm = normAsset(asset);
        if (norm.isEmpty()) return;
        long bucket = (tsMs / 60000L) * 60000L;
        synchronized (lock) {
            Deque<Candle> dq = map.get(norm);
            if (dq == null) {
                dq = new ArrayDeque<>();
                map.put(norm, dq);
            }
            Candle last = dq.peekLast();
            if (last != null && last.t == bucket) {
                last.tick(price);
            } else if (last != null && bucket < last.t) {
                // Out-of-order old tick: merge into the matching bucket if present.
                for (Candle c : dq) {
                    if (c.t == bucket) {
                        c.tick(price);
                        break;
                    }
                }
            } else {
                dq.addLast(new Candle(bucket, price));
                while (dq.size() > MAX_CANDLES) dq.removeFirst();
            }
        }
    }

    /** Whole store as JSONObject in the Supabase/JS shape. */
    public JSONObject toJson() {
        JSONObject out = new JSONObject();
        synchronized (lock) {
            // TreeMap for stable key ordering (deterministic output).
            for (Map.Entry<String, Deque<Candle>> e : new TreeMap<>(map).entrySet()) {
                try {
                    JSONArray arr = new JSONArray();
                    for (Candle c : e.getValue()) arr.put(c.toJson());
                    out.put(e.getKey(), arr);
                } catch (Exception ignored) {}
            }
        }
        return out;
    }

    public String toJsonString() {
        try {
            return toJson().toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    public int pairCount() {
        synchronized (lock) {
            return map.size();
        }
    }

    public int totalCandles() {
        synchronized (lock) {
            int n = 0;
            for (Deque<Candle> dq : map.values()) n += dq.size();
            return n;
        }
    }

    /**
     * Seed/replace from a Supabase-shaped JSONObject ({asset:[{t,o,h,l,c}]}).
     * Per pair keeps the LONGER array (cloud vs ticks built so far) — never shrinks.
     */
    public void loadFromJson(JSONObject cloud) {
        if (cloud == null) return;
        synchronized (lock) {
            Iterator<String> keys = cloud.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                try {
                    JSONArray arr = cloud.optJSONArray(k);
                    if (arr == null || arr.length() == 0) continue;
                    String norm = normAsset(k);
                    if (norm.isEmpty()) continue;
                    Deque<Candle> dq = map.get(norm);
                    if (dq != null && dq.size() >= arr.length()) continue; // keep longer
                    Deque<Candle> nd = new ArrayDeque<>();
                    int start = Math.max(0, arr.length() - MAX_CANDLES);
                    for (int i = start; i < arr.length(); i++) {
                        JSONObject c = arr.optJSONObject(i);
                        if (c == null) continue;
                        long t = c.optLong("t", 0);
                        double o = c.optDouble("o", Double.NaN);
                        if (t <= 0 || Double.isNaN(o) || !(o > 0)) continue;
                        Candle nc = new Candle(t, o);
                        nc.h = c.optDouble("h", o);
                        nc.l = c.optDouble("l", o);
                        nc.c = c.optDouble("c", o);
                        Candle prev = nd.peekLast();
                        if (prev == null || nc.t >= prev.t) nd.addLast(nc);
                    }
                    if (!nd.isEmpty()) map.put(norm, nd);
                } catch (Exception ignored) {}
            }
        }
    }

    /**
     * Merge historical candles [{t,o,h,l,c}, ...] for one asset (dedup by
     * bucket t, chronological, trimmed to MAX_CANDLES). Called from the JS
     * history backfill via BotEngine.pushHistoryCandles().
     */
    public void mergeHistory(String normAsset, JSONArray arr) {
        if (normAsset == null || normAsset.isEmpty() || arr == null || arr.length() == 0) return;
        synchronized (lock) {
            Deque<Candle> dq = map.get(normAsset);
            if (dq == null) {
                dq = new ArrayDeque<>();
                map.put(normAsset, dq);
            }
            Set<Long> seen = new HashSet<>();
            for (Candle c : dq) seen.add(c.t);
            List<Candle> add = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject c = arr.optJSONObject(i);
                if (c == null) continue;
                long t = c.optLong("t", 0);
                double o = c.optDouble("o", Double.NaN);
                if (t <= 0 || Double.isNaN(o) || !(o > 0) || seen.contains(t)) continue;
                seen.add(t);
                Candle nc = new Candle(t, o);
                nc.h = c.optDouble("h", o);
                nc.l = c.optDouble("l", o);
                nc.c = c.optDouble("c", o);
                add.add(nc);
            }
            if (add.isEmpty()) return;
            for (Candle nc : add) dq.addLast(nc);
            List<Candle> all = new ArrayList<>(dq);
            Collections.sort(all, (a, b) -> Long.compare(a.t, b.t));
            LinkedHashMap<Long, Candle> dm = new LinkedHashMap<>();
            for (Candle c : all) dm.put(c.t, c); // dedup: keep last
            dq.clear();
            dq.addAll(dm.values());
            while (dq.size() > MAX_CANDLES) dq.removeFirst();
        }
    }

    /**
     * Periodic maintenance (every 5s from the scheduler): enforce the
     * 61-candle cap and drop empty pairs. Bucket-based candles close
     * themselves on tick rollover, so this just enforces invariants.
     */
    public void maintenance() {
        synchronized (lock) {
            Iterator<Map.Entry<String, Deque<Candle>>> it = map.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<String, Deque<Candle>> e = it.next();
                Deque<Candle> dq = e.getValue();
                while (dq.size() > MAX_CANDLES) dq.removeFirst();
                if (dq.isEmpty()) it.remove();
            }
        }
    }

    public void clear() {
        synchronized (lock) {
            map.clear();
        }
    }
}
