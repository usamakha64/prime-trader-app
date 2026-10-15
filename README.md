# Prime Trader — Signals App (UI)

Premium trading signals app UI for the **Prime Trader** brand.
Matches the [prime-trader-website](https://prime-trader.vercel.app) gold/dark professional theme.

## Run it

No build step needed — pure HTML/CSS/JS.

```bash
cd ~/workspace/prime-trader-app
python3 -m http.server 8899
```

Then open on the phone browser: `http://<computer-ip>:8899/`

Or open `index.html` directly (some features need http:// for localStorage).

## What's inside

| Page | Contents |
|------|----------|
| 🏠 Home | Hisab Kitab dashboard (Win Rate, Wins, Losses, Total Trades, Today's P&L), account balance + win-rate ring, strategy record, live signals feed |
| 📡 Signals | Future Signals + Compounding 95% (segmented tabs), countdown timers |
| 📜 Trades | **Live Trades** (real-time WINNING/LOSING P&L, countdown, manual MTG button, 📊 candle chart per trade), batch-wise History (expandable batches, entry/exit/open/close/MTG/amount/date), Signal history, CSV/Excel export |
| 📊 Stats | P&L bar chart (14 days), equity curve (canvas, no library), strategy-wise accuracy ranking |
| ⚙️ Settings | Account switcher (Demo/Real/Tournament + confirmation), SSID input + expire simulation, signal/trade/compounding/risk/trading-hours settings, asset picker, Telegram, 3 themes, PIN + fingerprint lock, push notifications, GitHub update check, tutorial replay |

**Header:** 🛑 Emergency STOP button (with confirm), 🌙 day/night toggle, connection pill, account chip.

**Overlays:** PIN lock screen, 4-slide onboarding tutorial, bottom-sheet modals, toasts.

**Themes:** Gold Dark (default), Gold Light, Midnight Blue — persisted in localStorage.

## Status

**UI/frontend only.** All data is realistic demo data. The Python Quotex bot backend
(`~/workspace/your_files/quotex-termux/quotex-app-BACKUP-2026-10-15.py`) connects later
via API — settings keys in `localStorage` (`pt-settings`) are designed to map 1:1.

## Files

- `index.html` — all pages + overlays
- `css/app.css` — theme system, components, animations
- `js/app.js` — navigation, demo data, charts, settings store
