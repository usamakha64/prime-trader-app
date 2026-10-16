/* ============================================================
   PRIME TRADER — Signals App (frontend demo)
   All state in localStorage. Backend (Python Quotex bot) connects later.
   ============================================================ */
'use strict';

/* ---------- APP VERSION / IN-APP UPDATES ---------- */
const APP_VERSION = '2.0.48';
// version.json lives at the repo root; bump its "version" + "apk_url" on every GitHub release.
const UPDATE_URL = 'https://raw.githubusercontent.com/usamakha64/prime-trader-app/main/version.json';

/* ---------- SETTINGS STORE ---------- */
const DEFAULTS = {
  theme: 'gold-dark',
  account: 'demo',            // demo | real | tournament
  tournamentId: '',
  ssid: '',                   // Quotex session ID (real connection)
  minConf: 75, strongConf: 85, compConf: 95,
  minPayout: 75,
  sigCount: 15, sigPeriod: 30,          // signals per N minutes
  sigGap: 120,                          // seconds between signals
  expiry: 60,                       // seconds: 60 | 120 | 300
  futureTimeframes: [5],            // minutes: subset of [5,15,30]
  futureMinConf: 75, futurePayout: 85,
  futureLookback: 1,               // hours: 1 | 2 | 4
  futureBatchSize: 20,             // 15 | 20 | 25 | 30
  futureSigCount: 20, futureSigPeriod: 30,
  futureSigGap: 120,               // seconds
  futureExpiry: 60,                // seconds: 60 | 120 | 300
  autoTrade: true, amount: 10, mtgMult: 2.0, mtgSteps: 3,
  autoTradeConf: 85,             // auto-trade only signals at/above this confidence
  compounding: false, compCap: 5,
  lossLimit: 100, profitTarget: 200, autoStop: true,
  startTime: '09:00', endTime: '23:00', newsPause: true,
  assets: ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','EURGBP','EURJPY','GBPJPY','USDCHF','NZDUSD'],
  tgToken: '', tgChat: '', tgSignals: true, tgStatus: true,
  pinLock: false, pin: '', fingerprint: false,
  pushSignals: true, pushResults: true, pushSsid: true,
  stopped: false, onboarded: false,
};
const store = {
  get() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('pt-settings') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  },
  set(patch) {
    const s = Object.assign(this.get(), patch);
    localStorage.setItem('pt-settings', JSON.stringify(s));
    return s;
  }
};
let S = store.get();

/* ---------- HELPERS ---------- */
const $ = (id) => document.getElementById(id);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.innerHTML = msg;
  $('toastWrap').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
}
function fmtMoney(n) {
  const v = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '+$') + v;
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(d) { d = d instanceof Date ? d : new Date(d); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function fmtDate(d) { d = d instanceof Date ? d : new Date(d); return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }); }

/* ---------- THEME ---------- */
function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  document.querySelector('meta[name="theme-color"]').setAttribute('content',
    name === 'gold-light' ? '#faf8f2' : (name === 'midnight' ? '#04070f' : '#0a0e1a'));
  S = store.set({ theme: name });
  $('themeToggle').textContent = (name === 'gold-light') ? '☀️' : '🌙';
  $$('#themeGrid .theme-opt').forEach(o => o.classList.toggle('selected', o.dataset.themeOpt === name));
  drawCharts();
}
$('themeToggle').addEventListener('click', () => {
  applyTheme(S.theme === 'gold-light' ? 'gold-dark' : 'gold-light');
  toast('🎨 Theme: ' + (S.theme === 'gold-light' ? 'Gold Light' : 'Gold Dark'));
});

/* ---------- NAVIGATION ---------- */
function goPage(name) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $('page-' + name).classList.add('active');
  $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.nav === name));
  window.scrollTo({ top: 0 });
  requestAnimationFrame(observeReveals);
  if (name === 'stats') setTimeout(drawCharts, 60);
}
$$('.nav-tab').forEach(t => t.addEventListener('click', () => goPage(t.dataset.nav)));
$$('[data-nav]').forEach(b => { if (!b.classList.contains('nav-tab')) b.addEventListener('click', () => goPage(b.dataset.nav)); });

/* ---------- SCROLL REVEAL ---------- */
const revealObs = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); } });
}, { threshold: 0.08 });
function observeReveals() { $$('.reveal:not(.visible)').forEach(el => revealObs.observe(el)); }

/* ---------- MODAL ---------- */
let modalCleanup = null;
function openModal(html, center) {
  $('modalContent').innerHTML = html;
  $('modalBackdrop').classList.add('open');
  $('modalBackdrop').classList.toggle('center', !!center);
}
function closeModal() {
  $('modalBackdrop').classList.remove('open', 'center');
  if (modalCleanup) { try { modalCleanup(); } catch (e) {} modalCleanup = null; }
}
$('modalBackdrop').addEventListener('click', (e) => { if (e.target === $('modalBackdrop')) closeModal(); });

/* ---------- DEMO DATA ---------- */
const ALL_ASSETS = ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','EURGBP','EURJPY','GBPJPY','USDCHF','NZDUSD','EURCHF','GBPCHF','AUDJPY','CADJPY','EURAUD','GBPAUD','USDTRY','EURTRY','BTCUSD','ETHUSD','GOLD','SILVER','US30','NAS100','SPX500','UKOIL','EURUSD-OTC','GBPUSD-OTC','USDJPY-OTC','AUDUSD-OTC','EURJPY-OTC','GBPJPY-OTC'];
/* OTC display helper: 'EURUSD-OTC' -> 'EURUSD OTC' + badge */
function assetName(a) { return a.replace('-OTC', ' OTC'); }
function otcBadge(a) { return a.endsWith('-OTC') ? ' <span class="pill pill-blue" style="font-size:.62rem;padding:.1rem .4rem">OTC</span>' : ''; }
function assetLabel(a) { return `<span class="sig-asset">${assetName(a)}</span>`; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const now = Date.now();
/* Demo signal/trade generation DISABLED — arrays stay empty until a real Quotex connection provides live data */
const demoSignals = [];
const demoFuture = [];
const demoRegular = [];
/* Live trades — tick every second, P&L from live price vs entry */
function basePrice(asset) {
  let h = 0; for (const c of asset) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return 0.8 + (h % 500) / 1000;
}
/* Live trades — start empty; real trades only (demo seed trades removed) */
const liveTrades = [];

function tickLivePrices() {
  liveTrades.forEach(t => {
    // random walk around entry
    t.cur = t.entryPrice * (1 + (Math.random() - 0.5) * 0.0012);
  });
}
function tradeLivePL(t) {
  const winning = t.dir === 'CALL' ? t.cur > t.entryPrice : t.cur < t.entryPrice;
  const diff = t.dir === 'CALL' ? t.cur - t.entryPrice : t.entryPrice - t.cur;
  const est = winning ? t.amount * t.payout : -t.amount;
  return { winning, est, diff };
}
function tradeRemaining(t) {
  const elapsed = (Date.now() - t.entryTime.getTime()) / 1000;
  return Math.max(0, Math.ceil(t.duration - elapsed));
}

/* Batch history - starts empty, real trades only */
const batches = [];

/* Signal history (past signals + results) - starts empty */
const sigHistory = [];
// v2.0.26: Persist signal history locally (user requirement: records in app too)
try {
  const saved = localStorage.getItem('pt_sig_history');
  if (saved) {
    const arr = JSON.parse(saved);
    if (Array.isArray(arr)) {
      for (const s of arr.slice(0, 200)) sigHistory.push(s);
    }
  }
} catch (e) {}
function persistSigHistory() {
  try {
    localStorage.setItem('pt_sig_history', JSON.stringify(sigHistory.slice(0, 200)));
  } catch (e) {}
}

/* Strategies */
const strategies = [
  { name: '7-Indicator Strategy', trades: 0, wins: 0, desc: 'EMA 9/21/50 • RSI 14 • ADX 14 • ATR 14 • BB 20,2' },
];
strategies.forEach(s => { s.acc = s.trades ? Math.round(s.wins / s.trades * 100) : 0; });
strategies.sort((a, b) => b.acc - a.acc);

/* P&L + equity series — start at zero (demo history removed); real data only */
const pnlDays = ['Today'];
const pnlVals = [0];
const eqVals = [0];

/* ---------- RENDER: HOME ---------- */
function renderHome() {
  // live feed
  $('liveFeed').innerHTML = demoSignals.length ? demoSignals.map(s => `
    <div class="signal-card ${s.strong ? 'strong' : ''}">
      <div class="sig-top">
        ${assetLabel(s.asset)}
        <span class="sig-time">${fmtTime(s.time)}</span>
      </div>
      <div class="sig-mid">
        <span class="sig-dir ${s.dir === 'CALL' ? 'dir-call' : 'dir-put'}">${s.dir === 'CALL' ? '▲ CALL' : '▼ PUT'}</span>
        <div class="sig-conf"><div class="conf-num">${s.conf}%</div><div class="conf-label">Confidence</div></div>
      </div>
      <div class="sig-bot">
        <span class="sig-expiry">Expiry ${s.expiry}s</span>
        ${s.strong ? '<span class="pill pill-gold">⭐ Strong</span>' : '<span class="pill pill-muted">Signal</span>'}
      </div>
      <div class="conf-bar"><div class="fill" style="width:${s.conf}%"></div></div>
    </div>`).join('') : `<div class="empty-state"><div class="big">📡</div><p>No signals yet.<br>Connect to Quotex to receive live signals.</p></div>`;
  // home strategies (top 3)
  $('homeStrategies').innerHTML = strategies.map((s, i) => `
    <div class="strat-row ${i === 0 ? 'top' : ''}" style="margin-bottom:.55rem">
      <div class="strat-rank">${i + 1}</div>
      <div class="strat-info"><div class="strat-name">${s.name}</div><div class="strat-meta">${s.wins}W / ${s.trades - s.wins}L • ${s.trades} trades</div></div>
      <div class="strat-acc"><div class="num">${s.acc}%</div><div class="lbl">Win</div></div>
    </div>`).join('');
}

/* ---------- RENDER: SIGNALS PAGE ---------- */
function renderSignals() {
  const emptySig = `<div class="empty-state"><div class="big">📡</div><p>No signals yet.<br>Connect to Quotex to receive live signals.</p></div>`;
  $('sigRegular').innerHTML = demoRegular.length ? demoRegular.map((r, i) => `
    <div class="signal-card${r.strong ? ' strong' : ''}">
      <div class="sig-top">${assetLabel(r.asset)}<span class="pill ${r.strong ? 'pill-gold' : 'pill-green'}">${r.strong ? '⚡ Strong' : '● Live'}</span></div>
      <div class="sig-mid">
        <span class="sig-dir ${r.dir === 'CALL' ? 'dir-call' : 'dir-put'}">${r.dir === 'CALL' ? '▲ CALL' : '▼ PUT'}</span>
        <div class="sig-conf"><div class="conf-num">${r.conf}%</div><div class="conf-label">Confidence</div></div>
      </div>
      <div class="sig-bot"><span class="sig-expiry">Expiry: ${r.expiry / 60} min</span><span class="countdown" data-countmin="${r.expiry / 60}">--:--</span></div>
      <div class="conf-bar"><div class="fill" style="width:${r.conf}%"></div></div>
      <button class="btn btn-gold btn-sm btn-block mt1" data-mantrade="reg:${i}">📈 Trade</button>
    </div>`).join('') : emptySig;
  $('sigFuture').innerHTML = demoFuture.length ? demoFuture.map((f, i) => `
    <div class="signal-card">
      <div class="sig-top">${assetLabel(f.asset)}<span class="pill pill-blue">in ~${f.inMin} min</span></div>
      <div class="sig-mid">
        <span class="sig-dir ${f.dir === 'CALL' ? 'dir-call' : 'dir-put'}">${f.dir === 'CALL' ? '▲ CALL' : '▼ PUT'}</span>
        <div class="sig-conf"><div class="conf-num">${f.conf}%</div><div class="conf-label">Confidence</div></div>
      </div>
      <div class="sig-bot"><span class="sig-expiry">Window: ${f.window} candles</span><span class="countdown" data-countmin="${f.inMin}">--:--</span></div>
      <div class="conf-bar"><div class="fill" style="width:${f.conf}%"></div></div>
      <button class="btn btn-gold btn-sm btn-block mt1" data-mantrade="fut:${i}">📈 Trade</button>
    </div>`).join('') : emptySig;
}
$$('#sigTabs button').forEach(b => b.addEventListener('click', () => {
  $$('#sigTabs button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const t = b.dataset.sigtab;
  $('sigRegular').style.display = t === 'regular' ? '' : 'none';
  $('sigFuture').style.display = t === 'future' ? '' : 'none';
}));

/* ---------- MANUAL TRADE ---------- */
function getSignal(kind, idx) {
  return kind === 'reg' ? demoRegular[idx] : demoFuture[idx];
}
function signalExpirySec(kind, sig) {
  return kind === 'reg' ? (sig.expiry || S.expiry) : (S.futureExpiry || 60);
}
function openManualTradeModal(kind, idx) {
  const sig = getSignal(kind, idx);
  if (!sig) return;
  if (S.stopped) { toast('🛑 <b>Trading is stopped.</b> Resume to place trades.', 'red'); return; }
  const expSec = signalExpirySec(kind, sig);
  const expLabel = expSec >= 60 ? (expSec / 60) + ' min' : expSec + 's';
  openModal(`
    <div class="modal-title">📈 Confirm Manual Trade</div>
    <div class="modal-sub">You are placing this trade yourself on the <b>${S.account === 'demo' ? 'DEMO' : S.account === 'real' ? 'REAL' : 'TOURNAMENT'}</b> account.</div>
    <div class="lt-grid" style="margin:.8rem 0">
      <div><div class="k">Asset</div><div class="v">${assetName(sig.asset)}</div></div>
      <div><div class="k">Direction</div><div class="v ${sig.dir === 'CALL' ? 'dir-call' : 'dir-put'}">${sig.dir === 'CALL' ? '▲ CALL' : '▼ PUT'}</div></div>
      <div><div class="k">Confidence</div><div class="v">${sig.conf}%</div></div>
      <div><div class="k">Amount</div><div class="v">$${S.amount}</div></div>
      <div><div class="k">Expiry</div><div class="v">${expLabel}</div></div>
      <div><div class="k">Entry</div><div class="v">Now</div></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mTradeCancel">Cancel</button>
      <button class="btn btn-gold" id="mTradeConfirm">✅ Place Trade</button>
    </div>`, true);
  $('mTradeCancel').addEventListener('click', closeModal);
  $('mTradeConfirm').addEventListener('click', () => { closeModal(); placeManualTrade(kind, idx); });
}
function placeManualTrade(kind, idx) {
  const sig = getSignal(kind, idx);
  if (!sig) return;
  const expSec = signalExpirySec(kind, sig);
  const t = {
    id: 'LT-' + Date.now().toString().slice(-6),
    asset: sig.asset, dir: sig.dir, amount: S.amount, mtg: 0,
    entryTime: new Date(), duration: expSec,
    entryPrice: basePrice(sig.asset), cur: 0, payout: 0.82,
    manual: true,
  };
  t.cur = t.entryPrice;
  liveTrades.push(t);
  renderLiveTrades();
  toast(`✅ <b>Manual trade placed:</b> ${assetName(sig.asset)} ${sig.dir} $${S.amount}`, 'green');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mantrade]');
  if (b) {
    const [kind, idx] = b.dataset.mantrade.split(':');
    openManualTradeModal(kind, +idx);
  }
});

/* ---------- RENDER: LIVE TRADES (real-time P&L) ---------- */
function renderLiveTrades() {
  const el = $('histLive');
  $('liveCount').textContent = liveTrades.length;
  if (!liveTrades.length) {
    el.innerHTML = `<div class="empty-state"><div class="big">💤</div><p>No open trades right now.<br>New trades appear here instantly.</p></div>`;
    return;
  }
  el.innerHTML = liveTrades.map(t => {
    const { winning, est } = tradeLivePL(t);
    const rem = tradeRemaining(t);
    const pct = Math.max(0, Math.min(100, (t.duration - rem) / t.duration * 100));
    return `
    <div class="live-trade" data-lt="${t.id}">
      <div class="lt-top">
        <span class="pulse-dot"></span>
        <span class="lt-asset">${assetName(t.asset)}</span>
        <span class="lt-live-label">Live</span>
        ${t.manual ? '<span class="pill pill-gold">👆 Manual</span>' : ''}
        <button class="chart-btn" data-chart="${t.id}">📊 Chart</button>
        <span class="pill ${winning ? 'pill-green' : 'pill-red'}" data-lt-status>${winning ? '▲ WINNING' : '▼ LOSING'}</span>
      </div>
      <div class="lt-grid">
        <div><div class="k">Direction</div><div class="v ${t.dir === 'CALL' ? 'dir-call' : 'dir-put'}">${t.dir}</div></div>
        <div><div class="k">Amount</div><div class="v">$${t.amount}${t.mtg ? ` <span class="mtg-badge">MTG ${t.mtg}</span>` : ''}</div></div>
        <div><div class="k">Entry Time</div><div class="v">${fmtTime(t.entryTime)}</div></div>
        <div><div class="k">Entry Price</div><div class="v">${t.entryPrice.toFixed(5)}</div></div>
        <div><div class="k">Live Price</div><div class="v" data-lt-price>${t.cur.toFixed(5)}</div></div>
        <div><div class="k">Live P&amp;L</div><div class="v ${winning ? 'text-green' : 'text-red'}" data-lt-pl>${fmtMoney(est)}</div></div>
      </div>
      <div class="lt-countdown-bar"><div class="fill" data-lt-bar style="width:${pct}%"></div></div>
      <div class="lt-foot">
        <span class="small text-muted">Expires in</span>
        <span class="lt-count" data-lt-count>${rem}s</span>
      </div>
      ${t.linkedTo ? `<div class="tiny text-muted mt1">🔗 MTG of ${t.linkedTo} • Level ${t.mtg}</div>` : ''}
      <div data-lt-mtgwrap>${!winning && !t.mtgTaken ? `<button class="btn btn-gold btn-sm btn-block mt1" data-mtg="${t.id}">⚡ Take MTG — $${Math.round(t.amount * S.mtgMult)}</button>` : ''}${t.mtgTaken ? `<div class="mt1"><span class="pill pill-muted">✓ MTG placed</span></div>` : ''}</div>
    </div>`;
  }).join('');
}
/* tick live trades every second */
setInterval(() => {
  if (!liveTrades.length) return;
  tickLivePrices();
  liveTrades.forEach(t => {
    const card = document.querySelector(`[data-lt="${t.id}"]`);
    if (!card) return;
    const { winning, est } = tradeLivePL(t);
    const rem = tradeRemaining(t);
    const pct = Math.max(0, Math.min(100, (t.duration - rem) / t.duration * 100));
    const st = card.querySelector('[data-lt-status]');
    st.className = 'pill ' + (winning ? 'pill-green' : 'pill-red');
    st.textContent = winning ? '▲ WINNING' : '▼ LOSING';
    const pl = card.querySelector('[data-lt-pl]');
    pl.className = 'v ' + (winning ? 'text-green' : 'text-red');
    pl.textContent = fmtMoney(est);
    card.querySelector('[data-lt-price]').textContent = t.cur.toFixed(5);
    card.querySelector('[data-lt-count]').textContent = rem + 's';
    card.querySelector('[data-lt-bar]').style.width = pct + '%';
    const wrap = card.querySelector('[data-lt-mtgwrap]');
    if (wrap && !t.mtgTaken) {
      const shouldShow = !winning;
      const isShowing = !!wrap.querySelector('[data-mtg]');
      if (shouldShow && !isShowing) wrap.innerHTML = `<button class="btn btn-gold btn-sm btn-block mt1" data-mtg="${t.id}">⚡ Take MTG — $${Math.round(t.amount * S.mtgMult)}</button>`;
      if (!shouldShow && isShowing) wrap.innerHTML = '';
    }
  });
  // countdowns on signals page
  $$('[data-countmin]').forEach(el => {
    const m = +el.dataset.countmin;
    const s = Math.floor(rnd(0, 59));
    el.textContent = pad(m) + ':' + pad(s);
  });
}, 1000);
$$('#histTabs button').forEach(b => b.addEventListener('click', () => {
  $$('#histTabs button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const t = b.dataset.histtab;
  $('histLive').style.display = t === 'live' ? '' : 'none';
  $('histBatches').style.display = t === 'history' ? '' : 'none';
  $('histSignals').style.display = t === 'signals' ? '' : 'none';
}));

/* ---------- RENDER: BATCH HISTORY ---------- */
function renderBatches() {
  const totalW = batches.reduce((a, b) => a + b.wins, 0);
  const totalL = batches.reduce((a, b) => a + b.losses, 0);
  const totalPL = batches.reduce((a, b) => a + b.pl, 0);
  $('histSummary').textContent = `${batches.length} batches • ${totalW}W/${totalL}L • ${fmtMoney(totalPL)}`;
  $('batchList').innerHTML = batches.map((b, i) => `
    <div class="batch-block">
      <div class="batch-head" data-batch="${i}">
        <div><div class="b-name">📦 Batch ${b.num}</div><div class="b-meta">${fmtDate(b.time)} • ${fmtTime(b.time)}</div></div>
        <div style="text-align:right">
          <div style="font-weight:800" class="${b.pl >= 0 ? 'text-green' : 'text-red'}">${fmtMoney(b.pl)}</div>
          <div class="b-meta">${b.wins}W / ${b.losses}L</div>
        </div>
      </div>
      <div class="batch-body ${i > 0 ? 'collapsed' : ''}">
        ${b.trades.map(t => `
          <div class="trade-row">
            <div class="tr-top">
              <span class="tr-asset">${assetName(t.asset)} <span class="${t.dir === 'CALL' ? 'dir-call' : 'dir-put'}">${t.dir}</span>${t.mtg ? ` <span class="mtg-badge">MTG ${t.mtg}</span>` : ''}</span>
              <span class="tr-pl ${t.win ? 'win' : 'loss'}">${fmtMoney(t.pl)}</span>
            </div>
            <div class="tr-grid">
              <div><div class="k">Entry</div><div class="v">${fmtTime(t.entryTime)}</div></div>
              <div><div class="k">Exit</div><div class="v">${fmtTime(t.exitTime)}</div></div>
              <div><div class="k">Date</div><div class="v">${t.date}</div></div>
              <div><div class="k">Open</div><div class="v">${t.open}</div></div>
              <div><div class="k">Close</div><div class="v">${t.close}</div></div>
              <div><div class="k">Amount</div><div class="v">$${t.amount}</div></div>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
  $$('[data-batch]').forEach(h => h.addEventListener('click', () => {
    h.nextElementSibling.classList.toggle('collapsed');
  }));
}

/* ---------- RENDER: SIGNAL HISTORY ---------- */
function renderSigHistory() {
  $('histSignals').innerHTML = sigHistory.map(s => `
    <div class="signal-card">
      <div class="sig-top">
        ${assetLabel(s.asset)}
        <span class="pill ${s.win ? 'pill-green' : 'pill-red'}">${s.win ? '✓ WIN' : '✗ LOSS'}</span>
      </div>
      <div class="sig-mid">
        <span class="sig-dir ${s.dir === 'CALL' ? 'dir-call' : 'dir-put'}">${s.dir === 'CALL' ? '▲ CALL' : '▼ PUT'}</span>
        <div class="sig-conf"><div class="conf-num">${s.conf}%</div><div class="conf-label">Conf</div></div>
      </div>
      <div class="sig-bot">
        <span class="sig-expiry">${fmtDate(s.time)} • ${fmtTime(s.time)}</span>
        ${s.compound ? '<span class="pill pill-gold">💎 Compound</span>' : ''}
      </div>
    </div>`).join('');
}

/* ---------- RENDER: STRATEGIES ---------- */
function renderStrategies() {
  $('stratList').innerHTML = strategies.map((s, i) => `
    <div class="strat-row ${i === 0 ? 'top' : ''}">
      <div class="strat-rank">${i + 1}</div>
      <div class="strat-info">
        <div class="strat-name">${s.name}</div>
        <div class="strat-meta">${s.desc}</div>
        <div class="acc-bar"><div class="fill" style="width:${s.acc}%"></div></div>
      </div>
      <div class="strat-acc">
        <div class="num">${s.acc}%</div><div class="lbl">${s.wins}/${s.trades}</div>
      </div>
    </div>`).join('');
}

/* ---------- CHARTS (canvas, no library) ---------- */
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function setupCanvas(id) {
  const c = $(id); if (!c) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = 190;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  return { ctx, w, h };
}
function drawCharts() {
  // P&L bars
  let s = setupCanvas('pnlChart');
  if (s) {
    const { ctx, w, h } = s; ctx.clearRect(0, 0, w, h);
    const max = Math.max(...pnlVals.map(Math.abs), 1);
    const bw = w / pnlVals.length;
    pnlVals.forEach((v, i) => {
      const bh = Math.abs(v) / max * (h / 2 - 14);
      const x = i * bw + bw * 0.22, y = v >= 0 ? h / 2 - bh : h / 2;
      ctx.fillStyle = v >= 0 ? cssVar('--green') : cssVar('--red');
      ctx.globalAlpha = 0.88;
      ctx.beginPath(); ctx.roundRect(x, y, bw * 0.56, Math.max(bh, 3), 3); ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.strokeStyle = cssVar('--card-border');
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.fillStyle = cssVar('--muted'); ctx.font = '9px sans-serif';
    ctx.fillText(pnlDays[0], 2, h - 4);
    ctx.fillText(pnlDays[pnlDays.length - 1], w - 34, h - 4);
  }
  // Equity curve
  s = setupCanvas('eqChart');
  if (s) {
    const { ctx, w, h } = s; ctx.clearRect(0, 0, w, h);
    const min = Math.min(...eqVals), max = Math.max(...eqVals);
    const span = (max - min) || 1;
    const px = i => i / (eqVals.length - 1) * (w - 8) + 4;
    const py = v => h - 16 - (v - min) / span * (h - 36);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, cssVar('--accent')); grad.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.moveTo(px(0), py(eqVals[0]));
    eqVals.forEach((v, i) => ctx.lineTo(px(i), py(v)));
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 2.5; ctx.stroke();
    ctx.lineTo(px(eqVals.length - 1), h); ctx.lineTo(px(0), h); ctx.closePath();
    ctx.globalAlpha = 0.18; ctx.fillStyle = grad; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = cssVar('--accent');
    ctx.beginPath(); ctx.arc(px(eqVals.length - 1), py(eqVals[eqVals.length - 1]), 4, 0, 7); ctx.fill();
    ctx.fillStyle = cssVar('--text'); ctx.font = 'bold 11px sans-serif';
    ctx.fillText('$' + eqVals[eqVals.length - 1].toLocaleString(), px(eqVals.length - 1) - 44, py(eqVals[eqVals.length - 1]) - 10);
  }
}
window.addEventListener('resize', drawCharts);

/* ---------- MANUAL MTG ---------- */
function takeMTG(origId) {
  const t = liveTrades.find(x => x.id === origId);
  if (!t || t.mtgTaken) return;
  if (t.mtg + 1 > S.mtgSteps) { toast('⚠️ Max MTG steps reached', 'red'); return; }
  const mtgAmount = Math.round(t.amount * S.mtgMult);
  const mtgTrade = {
    id: 'LT-' + Date.now().toString().slice(-6),
    asset: t.asset, dir: t.dir, amount: mtgAmount, mtg: t.mtg + 1,
    entryTime: new Date(), duration: 60,
    entryPrice: basePrice(t.asset), cur: 0, payout: t.payout,
    linkedTo: t.id,
  };
  mtgTrade.cur = mtgTrade.entryPrice;
  t.mtgTaken = true;
  liveTrades.push(mtgTrade);
  renderLiveTrades();
  toast(`⚡ <b>MTG ${mtgTrade.mtg} placed:</b> ${assetName(t.asset)} ${t.dir} $${mtgAmount}`, 'gold');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mtg]');
  if (b) takeMTG(b.dataset.mtg);
});

/* ---------- EMERGENCY STOP ---------- */
function renderStop() {
  const btn = $('stopBtn');
  btn.classList.toggle('stopped', S.stopped);
  btn.innerHTML = S.stopped
    ? '▶ RESUME'
    : '<span class="pulse-ring"></span>🛑 STOP';
  $('stoppedBanner').classList.toggle('show', S.stopped);
  renderConnPill();
}
$('stopBtn').addEventListener('click', () => {
  if (S.stopped) {
    S = store.set({ stopped: false });
    renderStop();
    toast('▶ <b>Trading resumed.</b> Next signal will be taken.', 'green');
    return;
  }
  openModal(`
    <div class="modal-title">🛑 Emergency Stop?</div>
    <div class="modal-sub">This will <b>immediately halt all trading</b>.<br>No new trades will be taken until you resume.</div>
    <div class="warn-box">⚠️ Open trades continue to expiry. Only new entries are blocked.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-red" id="mStop">STOP NOW</button>
    </div>`, true);
  $('mCancel').addEventListener('click', closeModal);
  $('mStop').addEventListener('click', () => {
    S = store.set({ stopped: true });
    renderStop(); closeModal();
    toast('🛑 <b>Emergency stop active.</b> All trading halted.', 'red');
  });
});

/* ---------- ACCOUNT SWITCHER ---------- */
const ACCTS = {
  demo: { ico: '📊', name: 'Demo Account', desc: 'Practice with virtual funds' },
  real: { ico: '💰', name: 'Real Account', desc: 'Live trading with real money' },
  tournament: { ico: '🏆', name: 'Tournament', desc: 'Compete with tournament balance' },
};
function renderAcct() {
  $('acctChip').textContent = (S.account === 'demo' ? '📊 DEMO' : S.account === 'real' ? '💰 REAL' : '🏆 TOURNAMENT') + ' ▾';
  $('setAcctVal').textContent = (S.account === 'demo' ? 'DEMO' : S.account === 'real' ? 'REAL' : 'TOURNAMENT') + ' ▸';
  $('rowTournament').style.display = S.account === 'tournament' ? '' : 'none';
  // v2.0.38: show the actual balance for the selected account (was hardcoded '$0.00')
  const bal = (S.account === 'real') ? (S.qxLiveBalance || 0) : (S.qxDemoBalance || 0);
  $('stBalance').textContent = '$' + Number(bal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function openAccountModal() {
  openModal(`
    <div class="modal-title">Switch Account</div>
    <div class="modal-sub">Choose which Quotex account the bot trades on.</div>
    ${Object.entries(ACCTS).map(([k, a]) => `
      <div class="acct-opt ${S.account === k ? 'selected' : ''}" data-acct="${k}">
        <div class="a-ico">${a.ico}</div>
        <div><div class="a-name">${a.name}</div><div class="a-desc">${a.desc}</div></div>
        <div class="a-check">✓</div>
      </div>`).join('')}`);
  $$('[data-acct]').forEach(o => o.addEventListener('click', () => {
    const k = o.dataset.acct;
    if (k === S.account) { closeModal(); return; }
    if (k === 'real') {
      openModal(`
        <div class="modal-title">⚠️ Switch to REAL?</div>
        <div class="warn-box"><b>Real money trading.</b> The bot will place live trades on your real Quotex balance. Are you sure?</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="mCancel2">Cancel</button>
          <button class="btn btn-red" id="mConfirmReal">Yes, go REAL</button>
        </div>`, true);
      $('mCancel2').addEventListener('click', closeModal);
      $('mConfirmReal').addEventListener('click', () => {
        S = store.set({ account: 'real' }); renderAcct(); closeModal();
        toast('💰 <b>Switched to REAL account.</b> Trade carefully!', 'red');
        // v2.0.40: Telegram notify on account switch
        try { if (S.tgStatus) PTTelegram.sendStatus('💰 <b>Switched to REAL account</b>\nTime: ' + PTTelegram.fmtTime(new Date())); } catch (e) {}
      });
      return;
    }
    S = store.set({ account: k }); renderAcct(); closeModal();
    toast(`${ACCTS[k].ico} <b>Switched to ${ACCTS[k].name}.</b>`, 'gold');
    // v2.0.40: Telegram notify on account switch
    try { if (S.tgStatus) PTTelegram.sendStatus(`${ACCTS[k].ico} <b>Switched to ${ACCTS[k].name} account</b>\nTime: ` + PTTelegram.fmtTime(new Date())); } catch (e) {}
  }));
}
$('acctChip').addEventListener('click', openAccountModal);
$('rowAccount').addEventListener('click', openAccountModal);

/* ---------- SSID (Real Quotex connection) ---------- */
// Native bridge (added in v1.0.8): window.QuotexNative
function qxNative() { return (typeof window.QuotexNative !== 'undefined') ? window.QuotexNative : null; }
function qxIsConnected() {
  const n = qxNative();
  try { return n ? !!n.isConnected() : false; } catch (e) { return false; }
}
// Show/hide SSID toggle
$('btnSsidToggle').addEventListener('click', () => {
  const inp = $('inSsid');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('btnSsidToggle').textContent = show ? '🙈' : '👁️';
  $('btnSsidToggle').setAttribute('aria-label', show ? 'Hide SSID' : 'Show SSID');
});
// Refresh SSID status UI from state
function renderSsid() {
  const has = !!(S.ssid && S.ssid.length > 8);
  const connected = qxIsConnected();
  const st = $('ssidStatus');
  if (connected) { st.className = 'pill pill-green'; st.textContent = '● Connected'; }
  else if (has) { st.className = 'pill pill-gold'; st.textContent = '● Saved — not connected'; }
  else { st.className = 'pill pill-red'; st.textContent = '● Not set'; }
  $('ssidAge').textContent = S.ssidSavedAt ? ('Saved ' + S.ssidSavedAt) : '';
  $('btnDisconnectSsid').style.display = has ? '' : 'none';
  $('btnCopySsid').style.display = has ? '' : 'none';
  // mask indicator: show placeholder when an SSID is stored
  if (has && !$('inSsid').value) $('inSsid').placeholder = '•••••••• SSID saved — paste new to replace';
  else if (!has) $('inSsid').placeholder = 'Paste new SSID here';
  // v2.0.16: restore saved email
  try {
    const qe = $('inQxEmail');
    if (qe && !qe.value) {
      const se = localStorage.getItem('qx_email');
      if (se) qe.value = se;
    }
  } catch (e) {}
  renderConnPill();
}
// Connection pill: SSID + native status drive the header pill
function renderConnPill() {
  const pill = $('connPill');
  if (!pill) return;
  const has = !!(S.ssid && S.ssid.length > 8);
  const connected = qxIsConnected();
  if (S.stopped) { pill.classList.add('off'); pill.innerHTML = '<span class="dot"></span>STOPPED'; }
  else if (connected) { pill.classList.remove('off'); pill.innerHTML = '<span class="dot"></span>CONNECTED'; }
  else if (has) { pill.classList.add('off'); pill.innerHTML = '<span class="dot"></span>CONNECTING…'; }
  else { pill.classList.add('off'); pill.innerHTML = '<span class="dot"></span>DISCONNECTED'; }
}
// v2.0.29: Login & Connect — WebView auto-login (no manual SSID needed).
// Email/password se Quotex me login → SSID + cookies auto-extract → connect.
const btnQxLogin = $('btnQxLogin');
if (btnQxLogin) btnQxLogin.addEventListener('click', () => {
  const qe = $('inQxEmail'), qp = $('inQxPass');
  const email = qe ? qe.value.trim() : '', pass = qp ? qp.value : '';
  if (!email || !pass) { toast('⚠️ Pehle email aur password dalo', 'red'); return; }
  try { localStorage.setItem('qx_email', email); } catch (e) {}
  const n = qxNative();
  if (n && typeof n.qxEmailLogin === 'function') {
    try {
      n.saveQxCreds(email, pass);
      n.qxEmailLogin(email, pass);
      toast('🔐 <b>Logging in…</b> (browser khul raha hai)', 'gold');
    } catch (e) { toast('⚠️ Login failed: ' + e.message, 'red'); }
  } else {
    toast('📱 <b>Saved.</b> Real login works inside the Android app.', 'green');
  }
});
// Save & Connect — v2.0.28: Termux jaisa manual SSID flow (fallback)
$('btnSaveSsid').addEventListener('click', () => {
  const v = $('inSsid').value.trim();
  if (!v) { toast('⚠️ SSID dalo — Chrome console se copy karke paste karo', 'red'); return; }
  if (v.length < 8) { toast('⚠️ SSID looks too short', 'red'); return; }
  S = store.set({ ssid: v, ssidSavedAt: new Date().toLocaleString() });
  $('inSsid').value = '';
  $('inSsid').type = 'password'; $('btnSsidToggle').textContent = '👁️';
  // v2.0.13: save Quotex email/password locally (Termux .env jaisa — sirf phone me)
  const qe = $('inQxEmail'), qp = $('inQxPass');
  const email = qe ? qe.value.trim() : '', pass = qp ? qp.value : '';
  if (email) { try { localStorage.setItem('qx_email', email); } catch (e) {} }
  const n2 = qxNative();
  if (email && pass && n2 && typeof n2.saveQxCreds === 'function') {
    try { n2.saveQxCreds(email, pass); } catch (e) {}
  }
  toast('🔑 <b>Connecting…</b>', 'gold');
  renderSsid();
  const n = qxNative();
  if (n) {
    try { n.connect(v); } catch (e) { toast('⚠️ Native connect failed: ' + e.message, 'red'); }
    setTimeout(renderSsid, 2500);
  } else {
    toast('📱 <b>Saved.</b> Real connection works inside the Android app.', 'green');
  }
});
// Disconnect — v2.0.24: also clears email/password (full account removal)
$('btnDisconnectSsid').addEventListener('click', () => {
  const n = qxNative();
  if (n) { try { n.disconnect(); } catch (e) {} }
  S = store.set({ ssid: '' , ssidSavedAt: '' });
  // Clear saved email/password too
  try {
    localStorage.removeItem('qx_email');
    const qe = $('inQxEmail'), qp = $('inQxPass');
    if (qe) qe.value = '';
    if (qp) qp.value = '';
    if (n && typeof n.clearQxCreds === 'function') {
      try { n.clearQxCreds(); } catch (e) {}
    }
  } catch (e) {}
  renderSsid();
  toast('🔌 <b>Account removed.</b> Naya account add kar sakte ho.', 'red');
});
// v2.0.11: Quotex web login for balance (user logs in on quotex.com directly)
// v2.0.25: Removed manual Quotex login button handler (Termux auto-login now)
// Called by native after successful web login
window.onQuotexLogin = function (ok) {
  if (ok) toast('✅ <b>Quotex login!</b> Balance aa raha hai…', 'green');
};
// Copy SSID
$('btnCopySsid').addEventListener('click', () => {
  if (S.ssid) {
    navigator.clipboard.writeText(S.ssid).then(() => {
      toast('📋 <b>SSID copied!</b>', 'green');
    }).catch(() => {
      toast('❌ Copy failed', 'red');
    });
  }
});
// Copy SSID console command
$('btnCopySsidCmd').addEventListener('click', () => {
  navigator.clipboard.writeText('copy(window.settings.token)').then(() => {
    toast('📋 <b>Command copied!</b> Chrome console me paste karo.', 'green');
  }).catch(() => {
    toast('❌ Copy failed', 'red');
  });
});
// v2.0.1: Connection Diagnostics — Settings panel me asal haalat dikhata hai
function renderDiagnostics() {
  var box = $('diagBox');
  if (!box) return;
  var n = qxNative();
  if (!n || !n.getDiagnostics) {
    box.textContent = '⚠️ App ka native hissa (bridge) nahi mila.\nYe purana version ho sakta hai — v2.0.1 install karo.';
    return;
  }
  var d;
  try { d = JSON.parse(n.getDiagnostics()); }
  catch (e) { box.textContent = '❌ Diagnostics parhne me masla: ' + e.message; return; }
  var c = d.client || {};
  function age(s) { return (s == null || s < 0) ? '—' : (s < 90 ? s + 's pehle' : Math.round(s / 60) + 'm pehle'); }
  var lines = [];
  lines.push('🔌 Authenticated: ' + (d.connected ? 'YES ✅' : 'NO ❌'));
  lines.push('⏳ Connecting (atkha hua): ' + (d.connecting ? 'YES ⚠️' : 'no'));
  lines.push('🌐 Host: ' + (c.host || '—'));
  lines.push('💰 Balance — Demo: $' + Number(c.demoBalance || 0).toFixed(2) + ' | Live: $' + Number(c.liveBalance || 0).toFixed(2));
  lines.push('📊 Pairs mile: ' + (c.instrumentsCount || 0));
  lines.push('📈 Ticks aaye: ' + (c.tickCount || 0) + ' (akhri: ' + age(c.lastTickAgeSec) + ')');
  lines.push('🔑 Akhri kamyab login: ' + age(c.lastAuthAgeSec));
  if (c.lastError) lines.push('❌ Akhri error: ' + c.lastError);
  if (!d.connected && !d.connecting) lines.push('\n💡 Hal: naya SSID nikalo aur Save & Connect dabao.');
  box.textContent = lines.join('\n');
}
// SSID expiry hook (wired to native QuotexWsClient onAuthFailed)
// v2.0.28: SSID expired → user pastes a new one manually (Termux flow; no auto-login)
function onSsidExpired() {
  $('ssidStatus').className = 'pill pill-red'; $('ssidStatus').textContent = '● Expired';
  renderConnPill();
  toast('🔔 <b>SSID expired!</b> Chrome console se naya SSID copy karke paste karo.', 'red');
}

/* ---------- REAL Quotex callbacks (native -> JS, Phase 2) ---------- */
// Called by native when the WebSocket authenticates successfully.
window.onQxConnected = function (host) {
  toast('✅ <b>Quotex connected</b> via ' + host, 'green');
  // v2.0.1: Telegram connect notification (user asked)
  try { if (S.tgStatus) PTTelegram.sendStatus('✅ <b>Quotex CONNECTED</b>\nHost: ' + host + '\nTime: ' + PTTelegram.fmtTime(new Date())); } catch (e) {}
  renderSsid();
  renderConnPill();
  // ask native for the latest balance + assets
  const n = qxNative();
  if (n) {
    try {
      const b = JSON.parse(n.getBalance());
      onQxBalance(b.demo || 0, b.live || 0, b.currency || 'USD');
    } catch (e) {}
    try { n.refreshAssets(); } catch (e) {}
    // Phase 3: subscribe the socket to the user's selected assets for the signal engine
    qxSubscribeAssets();
    startSignalEngine();
    // v2.0.46: Load historical candles for immediate signals (was defined but never called!)
    setTimeout(() => { try { qxLoadHistory(); } catch (e) {} }, 5000);
    // Retry history load every 30s to pick up newly arrived history data
    setInterval(() => { try { qxLoadHistory(); } catch (e) {} }, 30000);
  }
};
// Called by native when the socket drops.
window.onQxDisconnected = function (reason) {
  // v2.0.1: Telegram disconnect notification (user asked)
  try { if (S.tgStatus) PTTelegram.sendStatus('⚠️ <b>Quotex DISCONNECTED</b>\n' + (reason || '')); } catch (e) {}
  renderSsid();
  renderConnPill();
};
// Called by native with live balances: onQxBalance(demo, live, currency)
window.onQxBalance = function (demo, live, currency) {
  try {
    S = store.set({ qxDemoBalance: demo, qxLiveBalance: live, qxCurrency: currency });
  } catch (e) {}
  // show the balance matching the selected account
  const bal = (S.account === 'real') ? live : demo;
  const el = $('stBalance');
  if (el) el.textContent = '$' + Number(bal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  renderSsid();
};
// Called by native with the instruments/pairs JSON string.
window.onQxInstruments = function (jsonStr) {
  try {
    const arr = JSON.parse(jsonStr);
    // v2.0.4: pairs refresh often (live payouts) — toast only on first load / count change
    const first = !S.qxInstruments || S.qxInstruments.length === 0;
    const countChanged = S.qxInstruments && S.qxInstruments.length !== arr.length;
    S = store.set({ qxInstruments: arr });
    if (first || countChanged) toast('📊 <b>' + arr.length + ' pairs</b> loaded from Quotex', 'green');
    renderAssetChips();
  } catch (e) {}
};
// v2.0.43: Load saved candles from localStorage on startup (survives app updates)
try {
  var savedCandles = localStorage.getItem('pt-candles-v1');
  if (savedCandles) {
    window._qxCandles = JSON.parse(savedCandles);
    console.log('[candles] Restored from storage:', Object.keys(window._qxCandles).length, 'pairs');
  }
} catch (e) { console.log('[candles] Restore failed:', e); }

// v2.0.43: Save candles to localStorage every 30s (max ~400KB)
setInterval(() => {
  try {
    if (window._qxCandles && Object.keys(window._qxCandles).length > 0) {
      localStorage.setItem('pt-candles-v1', JSON.stringify(window._qxCandles));
    }
  } catch (e) {}
}, 30000);

// Called by native for every real price tick: onPriceTick(asset, timestampMs, price)
window.onPriceTick = function (asset, ts, price) {
  try {
    if (!window._qxPrices) window._qxPrices = {};
    var norm = qxNormAsset(asset);
    window._qxPrices[norm] = { ts: ts, price: price };
    // --- build 1-minute candles for the Phase 3 signal engine ---
    if (!window._qxCandles) window._qxCandles = {};
    var bucket = Math.floor(ts / 60000) * 60000;
    var arr = window._qxCandles[norm];
    if (!arr) arr = window._qxCandles[norm] = [];
    var last = arr[arr.length - 1];
    if (last && last.t === bucket) {
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
      last.c = price;
    } else {
      arr.push({ t: bucket, o: price, h: price, l: price, c: price });
      if (arr.length > 150) arr.splice(0, arr.length - 150); // keep ~2.5h of 1m candles
    }
  } catch (e) {}
};

/* ============================================================
   PHASE 3 — REAL 7-INDICATOR SIGNAL ENGINE
   Strategy (user-confirmed FINAL):
     EMA 9 / EMA 21 / EMA 50, RSI 14, ADX 14, ATR 14, Bollinger 20,2
   CALL: EMA9 > EMA21 > EMA50, RSI 50-65, ADX > 20, bullish close, vol OK
   PUT:  EMA9 < EMA21 < EMA50, RSI 35-50, ADX > 20, bearish close, vol OK
   else: NO TRADE
   ============================================================ */

/* Normalize Quotex wire names to app asset names: 'EURUSD_otc' -> 'EURUSD-OTC' */
function qxNormAsset(a) {
  if (!a) return a;
  var s = String(a).toUpperCase();
  if (/_OTC$/.test(s)) s = s.replace(/_OTC$/, '-OTC');
  return s;
}
/* App asset name -> Quotex wire name: 'EURUSD-OTC' -> 'EURUSD_otc' */
function qxWireAsset(a) {
  if (!a) return a;
  return String(a).replace(/-OTC$/i, '_otc');
}
/* Payout % for an asset from the live instruments list (0 = unknown) */
function qxPayout(asset) {
  var inst = (S.qxInstruments || []);
  var want = String(asset).toUpperCase().replace(/[^A-Z]/g, '');
  for (var i = 0; i < inst.length; i++) {
    var o = inst[i] || {};
    var name = String(o.name || o.asset || o.symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (name && name === want) {
      var p = (o.payout !== undefined) ? o.payout : ((o.profit !== undefined) ? o.profit : 0);
      return +p || 0;
    }
  }
  return 0;
}

/* ---------- Indicator math (pure functions) ---------- */
function qxLastVal(arr) {
  for (var i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined && !isNaN(arr[i])) return arr[i];
  }
  return null;
}
function qxEma(values, period) {
  var out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  var k = 2 / (period + 1), sum = 0, i;
  for (i = 0; i < period; i++) sum += values[i];
  var prev = sum / period;
  out[period - 1] = prev;
  for (i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function qxRsi(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return null;
  var i, d, gains = 0, losses = 0;
  for (i = 1; i <= period; i++) {
    d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  var avgG = gains / period, avgL = losses / period;
  for (i = period + 1; i < closes.length; i++) {
    d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - (100 / (1 + avgG / avgL));
}
/* Wilder ATR + ADX in one pass */
function qxAtrAdx(highs, lows, closes, period) {
  period = period || 14;
  var n = closes.length;
  if (n < period * 2 + 1) return { atr: null, adx: null };
  var trs = [], pDM = [], mDM = [], i;
  for (i = 1; i < n; i++) {
    var h = highs[i], l = lows[i], pc = closes[i - 1];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    var up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pDM.push((up > dn && up > 0) ? up : 0);
    mDM.push((dn > up && dn > 0) ? dn : 0);
  }
  function wilder(arr) {
    var out = new Array(arr.length).fill(null), i, s = 0;
    if (arr.length < period) return out;
    for (i = 0; i < period; i++) s += arr[i];
    out[period - 1] = s;
    for (i = period; i < arr.length; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  }
  var sTR = wilder(trs), sP = wilder(pDM), sM = wilder(mDM), dx = [];
  for (i = 0; i < sTR.length; i++) {
    if (sTR[i] === null || sTR[i] === 0) { dx.push(null); continue; }
    var pdi = 100 * sP[i] / sTR[i], mdi = 100 * sM[i] / sTR[i], tot = pdi + mdi;
    dx.push(tot === 0 ? 0 : 100 * Math.abs(pdi - mdi) / tot);
  }
  var dxv = dx.filter(function (v) { return v !== null; }), adx = null;
  if (dxv.length >= period) {
    var a = 0;
    for (i = 0; i < period; i++) a += dxv[i];
    a /= period;
    for (i = period; i < dxv.length; i++) a = (a * (period - 1) + dxv[i]) / period;
    adx = a;
  }
  var lastTR = qxLastVal(sTR);
  return { atr: lastTR === null ? null : lastTR / period, adx: adx };
}
function qxBollinger(closes, period, mult) {
  period = period || 20; mult = mult || 2;
  if (closes.length < period) return null;
  var slice = closes.slice(closes.length - period), sum = 0, i;
  for (i = 0; i < slice.length; i++) sum += slice[i];
  var mid = sum / period, sq = 0;
  for (i = 0; i < slice.length; i++) sq += Math.pow(slice[i] - mid, 2);
  var sd = Math.sqrt(sq / period);
  return { upper: mid + mult * sd, middle: mid, lower: mid - mult * sd };
}

/* ---------- Analyze one asset: returns {signal:'CALL'|'PUT'|'NONE', conf, details, reason} ---------- */
function analyzeAsset(asset) {
  var candles = (window._qxCandles && window._qxCandles[qxNormAsset(asset)]) || [];
  if (candles.length < 61) return { signal: 'NONE', conf: 0, reason: 'warming up (' + candles.length + '/61 candles)' };
  var closed = candles.slice(0, candles.length - 1); // last candle may still be forming
  var n = closed.length;
  var closes = [], highs = [], lows = [], i;
  for (i = 0; i < n; i++) { closes.push(closed[i].c); highs.push(closed[i].h); lows.push(closed[i].l); }

  var ema9 = qxLastVal(qxEma(closes, 9));
  var ema21 = qxLastVal(qxEma(closes, 21));
  var ema50 = qxLastVal(qxEma(closes, 50));
  var rsi = qxRsi(closes, 14);
  var aa = qxAtrAdx(highs, lows, closes, 14);
  var bb = qxBollinger(closes, 20, 2);
  if (ema9 === null || ema21 === null || ema50 === null || rsi === null || aa.adx === null || aa.atr === null || !bb) {
    return { signal: 'NONE', conf: 0, reason: 'indicators warming up' };
  }
  var last = closed[n - 1];
  var bullishClose = last.c > last.o;
  var bearishClose = last.c < last.o;

  // ATR suitability: not dead-flat, not extreme vs the recent average candle range
  var m = Math.min(20, n), avgRange = 0;
  for (i = n - m; i < n; i++) avgRange += (highs[i] - lows[i]);
  avgRange /= m;
  var volOk = avgRange > 0 && aa.atr > avgRange * 0.25 && aa.atr < avgRange * 4;

  var call = ema9 > ema21 && ema21 > ema50 && rsi >= 50 && rsi <= 65 && aa.adx > 20 && bullishClose && volOk;
  var put = ema9 < ema21 && ema21 < ema50 && rsi >= 35 && rsi <= 50 && aa.adx > 20 && bearishClose && volOk;
  var signal = call ? 'CALL' : (put ? 'PUT' : 'NONE');

  var conf = 0;
  var details = { ema9: ema9, ema21: ema21, ema50: ema50, rsi: +rsi.toFixed(1), adx: +aa.adx.toFixed(1), atr: aa.atr, bbMid: bb.middle };
  if (signal !== 'NONE') {
    conf = 70;
    if (Math.abs(ema9 - ema50) > aa.atr * 0.5) conf += 5;      // strong EMA separation
    if (signal === 'CALL') {
      if (rsi >= 55 && rsi <= 60) conf += 5;                   // RSI centered in bullish zone
      if (last.c > bb.middle) conf += 5;                      // price holding above BB middle
    } else {
      if (rsi >= 40 && rsi <= 45) conf += 5;                   // RSI centered in bearish zone
      if (last.c < bb.middle) conf += 5;
    }
    if (aa.adx > 25) conf += 5;
    if (aa.adx > 30) conf += 5;
    conf = Math.min(97, conf);
  }
  return { signal: signal, conf: Math.round(conf), details: details, reason: signal === 'NONE' ? 'no setup' : 'setup found' };
}

/* ---------- Signal engine state ---------- */
if (!window._qxLastSignalAt) window._qxLastSignalAt = {};  // per-asset last signal timestamp (gap)
if (!window._qxSignals) window._qxSignals = [];            // real bot signals (mirrored to UI lists)
if (!window._qxEngineTimer) window._qxEngineTimer = null;
if (!window._qxSettleTimer) window._qxSettleTimer = null;

function qxEngineReady() {
  try { return qxIsConnected() && !S.stopped; } catch (e) { return false; }
}

/* Subscribe the native socket to the user's selected assets (call on connect) */
function qxSubscribeAssets() {
  try {
    var n = qxNative();
    if (!n || typeof n.subscribe !== 'function') return;
    var as = S.assets || [];
    for (var i = 0; i < as.length; i++) {
      try { n.subscribe(qxWireAsset(as[i])); } catch (e) {}
    }
    // v2.0.13: after subscribing, try to load historical candles for immediate signals
    setTimeout(qxLoadHistory, 3000);
  } catch (e) {}
}

/* v2.0.13: Load historical candles (like old Termux bot) for immediate signals */
function qxLoadHistory() {
  try {
    var n = qxNative();
    if (!n || typeof n.getHistoryCandles !== 'function') return;
    var as = S.assets || [];
    for (var i = 0; i < as.length; i++) {
      (function(asset) {
        try {
          var wire = qxWireAsset(asset);
          var json = n.getHistoryCandles(wire);
          if (!json) json = n.getHistoryCandles(asset);
          if (!json) return;
          var arr = JSON.parse(json);
          if (!arr || !arr.length) return;
          var norm = qxNormAsset(asset);
          if (!window._qxCandles) window._qxCandles = {};
          var candles = [];
          for (var j = 0; j < arr.length; j++) {
            var c = arr[j];
            // Format: [time, open, high, low, close] or {t,o,h,l,c}
            var t, o, h, l, cl;
            if (c instanceof Array) {
              t = c[0] * 1000; o = +c[1]; h = +c[2]; l = +c[3]; cl = +c[4];
            } else {
              t = (c.t || c.time || 0) * 1000; o = +c.o || +c.open; h = +c.h || +c.high;
              l = +c.l || +c.low; cl = +c.c || +c.close;
            }
            if (!t || !isFinite(o)) continue;
            var bucket = Math.floor(t / 60000) * 60000;
            candles.push({ t: bucket, o: o, h: h, l: l, c: cl });
          }
          if (candles.length > 10) {
            // Merge with existing (don't duplicate)
            var existing = window._qxCandles[norm] || [];
            var seen = {};
            for (var k = 0; k < existing.length; k++) seen[existing[k].t] = 1;
            for (var k = 0; k < candles.length; k++) {
              if (!seen[candles[k].t]) existing.push(candles[k]);
            }
            existing.sort(function(a, b) { return a.t - b.t; });
            if (existing.length > 150) existing.splice(0, existing.length - 150);
            window._qxCandles[norm] = existing;
          }
        } catch (e) {}
      })(as[i]);
    }
  } catch (e) {}
}

/* Phase 5: background engine leader election.
   Only ONE WebView runs the signal engine at a time, so signals are generated
   exactly once. While the foreground bot service runs, its hidden page owns
   the engine; otherwise the visible app page owns it. */
function qxEngineOwner() {
  try {
    var n = qxNative();
    if (n && typeof n.amEngineOwner === 'function') return !!n.amEngineOwner();
  } catch (e) {}
  return true; // no native bridge (desktop preview): run the engine here
}

/* Phase 5: signals generated by the background service's engine are pushed
   here so the visible app stays in sync (lists, history, dashboard). */
window.onRemoteSignal = function (json) {
  try {
    var d = JSON.parse(json), i;
    for (i = 0; i < window._qxSignals.length; i++) if (window._qxSignals[i].id === d.id) return; // de-dupe
    var sig = {
      id: d.id, asset: d.asset, dir: d.dir, conf: d.conf,
      time: new Date(d.time), expiry: d.expiry, entryPrice: d.entryPrice,
      settled: false, result: null, strong: d.strong, source: d.source || 'bot-7ind'
    };
    window._qxSignals.unshift(sig);
    if (window._qxSignals.length > 30) window._qxSignals.pop();
    demoRegular.unshift(sig);
    if (demoRegular.length > 20) demoRegular.pop();
    demoSignals.unshift(sig);
    if (demoSignals.length > 20) demoSignals.pop();
    renderSignals(); renderHome();
  } catch (e) {}
};
window.onRemoteSettle = function (id, result, exitPrice) {
  try {
    var i, sig = null;
    for (i = 0; i < window._qxSignals.length; i++) if (window._qxSignals[i].id === id) { sig = window._qxSignals[i]; break; }
    if (!sig || sig.settled) return;
    var win = result === 'WIN';
    sig.settled = true; sig.result = result; sig.exitPrice = exitPrice;
    sigHistory.unshift({ asset: sig.asset, dir: sig.dir, conf: sig.conf, time: sig.time, win: win, compound: false });
    try { persistSigHistory(); } catch (e) {}
    var st = strategies[0];
    st.trades++; if (win) st.wins++;
    st.acc = Math.round(st.wins / st.trades * 100);
    renderSignals(); renderHome(); renderSigHistory(); renderStrategies(); renderDashStats();
  } catch (e) {}
};

/* Main engine pass — every 30s: analyze eligible assets, emit real signals */
function runSignalEngine() {
  if (!qxEngineOwner()) return;
  if (!qxEngineReady()) return;
  var nowMs = Date.now();
  var minConf = +S.minConf || 0;
  var minPayout = +S.minPayout || 0;
  var gapSec = +S.sigGap || 0;
  var assets = S.assets || [];
  var knowPayouts = (S.qxInstruments || []).length > 0;
  for (var i = 0; i < assets.length; i++) {
    var asset = assets[i];
    if (knowPayouts && qxPayout(asset) < minPayout) continue;      // payout filter
    if ((nowMs - (window._qxLastSignalAt[asset] || 0)) < gapSec * 1000) continue; // signal gap
    var r;
    try { r = analyzeAsset(asset); } catch (e) { continue; }
    if (r.signal === 'NONE' || r.conf < minConf) continue;
    var price = (window._qxPrices && window._qxPrices[qxNormAsset(asset)]) ? window._qxPrices[qxNormAsset(asset)].price : null;
    var sig = {
      id: 'qx' + nowMs + '_' + i,
      asset: asset, dir: r.signal, conf: r.conf,
      time: new Date(), expiry: +S.expiry || 60,
      entryPrice: price, settled: false, result: null,
      strong: r.conf >= (+S.strongConf || 85), source: 'bot-7ind'
    };
    window._qxSignals.unshift(sig);
    if (window._qxSignals.length > 30) window._qxSignals.pop();
    demoRegular.unshift(sig);                                     // Signals page (Regular tab)
    if (demoRegular.length > 20) demoRegular.pop();
    demoSignals.unshift(sig);                                     // Home live feed
    if (demoSignals.length > 20) demoSignals.pop();
    window._qxLastSignalAt[asset] = nowMs;
    renderSignals(); renderHome();
    if (S.pushSignals) toast('📡 <b>New signal:</b> ' + assetName(asset) + ' ' + r.signal + ' ' + r.conf + '%', 'gold');
    // Phase 4: publish to website + Telegram (fire and forget)
    try {
      window._ptLastSignalAt = sig.time.toISOString();
      PTWeb.publishSignal(sig).then(function() { PTWeb.syncBotStatus(); });
      PTTelegram.sendSignal(sig);
    } catch (e) {}
    // Phase 5: hand the signal to native (background service forwards it to
    // the visible app + raises a status-bar notification when app is hidden)
    try {
      var __n = qxNative();
      if (__n && typeof __n.engineSignal === 'function') {
        __n.engineSignal(JSON.stringify({
          id: sig.id, asset: sig.asset, dir: sig.dir, conf: sig.conf,
          time: sig.time.getTime(), expiry: sig.expiry,
          entryPrice: sig.entryPrice, strong: sig.strong, source: sig.source
        }));
      }
    } catch (e) {}
  }
}

/* Settle expired signals locally (entry vs exit price) — every 5s */
function settleSignals() {
  if (!qxEngineOwner()) return;
  if (!window._qxSignals.length) return;
  var nowMs = Date.now(), changed = false, i, j;
  for (i = 0; i < window._qxSignals.length; i++) {
    var sig = window._qxSignals[i];
    if (sig.settled) continue;
    if (sig.time.getTime() + sig.expiry * 1000 > nowMs) continue;
    var exit = null;
    var arr = (window._qxCandles && window._qxCandles[qxNormAsset(sig.asset)]) || [];
    var expBucket = Math.floor((sig.time.getTime() + sig.expiry * 1000) / 60000) * 60000;
    for (j = arr.length - 1; j >= 0; j--) { if (arr[j].t >= expBucket) exit = arr[j].c; else break; }
    if (exit === null && window._qxPrices && window._qxPrices[qxNormAsset(sig.asset)]) exit = window._qxPrices[qxNormAsset(sig.asset)].price;
    if (exit === null || sig.entryPrice === null) continue;
    var win = sig.dir === 'CALL' ? exit > sig.entryPrice : exit < sig.entryPrice; // tie = loss
    sig.settled = true; sig.result = win ? 'WIN' : 'LOSS'; sig.exitPrice = exit;
    sigHistory.unshift({ asset: sig.asset, dir: sig.dir, conf: sig.conf, time: sig.time, win: win, compound: false });
    try { persistSigHistory(); } catch (e) {}
    var st = strategies[0];
    st.trades++; if (win) st.wins++;
    st.acc = Math.round(st.wins / st.trades * 100);
    changed = true;
    if (S.pushResults) toast((win ? '✅ <b>WIN</b>' : '❌ <b>LOSS</b>') + ' ' + assetName(sig.asset) + ' ' + sig.dir + ' ' + sig.conf + '%', win ? 'green' : 'red');
    // Phase 4: settle on website + Telegram result (fire and forget)
    try {
      var amt = (typeof S.amount === 'number') ? S.amount : 10;
      var pnl = win ? +(amt * 0.8).toFixed(2) : -amt;
      PTWeb.settleSignal(sig, win ? 'win' : 'loss', exit, pnl).then(function() { PTWeb.syncBotStatus(); });
      PTTelegram.sendResult(sig, win ? 'win' : 'loss', pnl);
    } catch (e) {}
    // Phase 5: forward the settle to native (visible app sync + notification)
    try {
      var __n2 = qxNative();
      if (__n2 && typeof __n2.engineSettled === 'function') __n2.engineSettled(sig.id, sig.result, sig.exitPrice);
    } catch (e) {}
  }
  if (changed) { renderSignals(); renderHome(); renderSigHistory(); renderStrategies(); renderDashStats(); }
}

/* Dashboard Hisab Kitab — from real settled signal results */
function renderDashStats() {
  var wins = 0, losses = 0, i;
  for (i = 0; i < sigHistory.length; i++) { if (sigHistory[i].win) wins++; else losses++; }
  var total = wins + losses;
  var wr = total ? Math.round(wins / total * 100) : 0;
  var el;
  el = $('stWinRate'); if (el) el.textContent = wr + '%';
  el = $('stWins'); if (el) el.textContent = wins;
  el = $('stLosses'); if (el) el.textContent = losses;
  el = $('stTotal'); if (el) el.textContent = total;
  el = $('wrPct'); if (el) el.textContent = wr + '%';
}

/* Start/stop the engine timers (idempotent) */
function startSignalEngine() {
  if (!window._qxEngineTimer) window._qxEngineTimer = setInterval(runSignalEngine, 30000);
  if (!window._qxSettleTimer) window._qxSettleTimer = setInterval(settleSignals, 5000);
}

/* ================= PHASE 4: WEBSITE API + TELEGRAM =================
   Real signal pipeline: emitRealSignal(sig) -> UI list + Supabase + Telegram
   settleRealSignal(sig, result, exitPrice) -> UI + Supabase update + Telegram
   Canonical signal object:
   { id, webId, asset, dir ('CALL'|'PUT'), conf, time (Date), expiry (sec),
     entryPrice, strong, settled, result }
------------------------------------------------------------------------ */
const PT_SB_URL = 'https://sovvicsyflemmrfghwan.supabase.co';
const PT_SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdnZpY3N5ZmxlbW1yZmdod2FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzE2NjksImV4cCI6MjEwNjI0NzY2OX0.PB4Rz9acHTO4kLFuFYelG85AW5E2qIJkPEwnFGfOiQw';
const PT_SB_HEADERS = {
  'apikey': PT_SB_ANON,
  'Authorization': 'Bearer ' + PT_SB_ANON,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

/* ---------- Supabase website API ---------- */
const PTWeb = {
  // offline queue for signals that failed to publish
  _queue: [],
  _syncing: false,

  async publishSignal(sig) {
    const row = {
      asset: sig.asset,
      direction: sig.dir,
      confidence: sig.conf,
      entry_time: (sig.time instanceof Date ? sig.time : new Date(sig.time)).toISOString(),
      expiry_seconds: sig.expiry || 60,
      source: 'bot',
      status: 'open',
      strategy: '7-indicator',
      entry_price: sig.entryPrice != null ? sig.entryPrice : null
    };
    try {
      const r = await fetch(PT_SB_URL + '/rest/v1/signals', {
        method: 'POST', headers: PT_SB_HEADERS, body: JSON.stringify(row)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (data && data[0] && data[0].id) { sig.webId = data[0].id; }
      return sig.webId || true;
    } catch (e) {
      // queue for retry when back online
      this._queue.push({ type: 'publish', sig: sig });
      return false;
    }
  },

  async settleSignal(sig, result, exitPrice, pnl) {
    // result: 'win' | 'loss'
    if (!sig.webId) {
      // never published (was queued) — mark queue entry
      const q = this._queue.find(x => x.type === 'publish' && x.sig.id === sig.id);
      if (q) q.settled = { result, exitPrice, pnl };
      return false;
    }
    try {
      const r = await fetch(PT_SB_URL + '/rest/v1/signals?id=eq.' + sig.webId, {
        method: 'PATCH',
        headers: PT_SB_HEADERS,
        body: JSON.stringify({
          status: result, exit_price: exitPrice != null ? exitPrice : null,
          settled_by: 'bot', pnl: pnl != null ? pnl : 0
        })
      });
      return r.ok;
    } catch (e) { return false; }
  },

  async syncBotStatus() {
    const connected = (typeof qxIsConnected === 'function') ? qxIsConnected() : false;
    const body = {
      id: 1,
      connected: !!connected,
      ssid_valid: !!(S.ssid && S.ssid.length > 8),
      auto_publish: true,
      auto_settle: true,
      last_signal_at: window._ptLastSignalAt || null,
      updated_at: new Date().toISOString()
    };
    try {
      await fetch(PT_SB_URL + '/rest/v1/bot_status', {
        method: 'POST', headers: Object.assign({}, PT_SB_HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify(body)
      });
    } catch (e) {}
  },

  // retry queued publishes (call periodically / on reconnect)
  async flushQueue() {
    if (this._syncing || !this._queue.length) return;
    this._syncing = true;
    const pending = this._queue.splice(0, this._queue.length);
    for (const item of pending) {
      if (item.type === 'publish') {
        const ok = await this.publishSignal(item.sig);
        if (ok && item.settled) {
          await this.settleSignal(item.sig, item.settled.result, item.settled.exitPrice, item.settled.pnl);
        }
        if (!ok) this._queue.push(item); // still offline — requeue
      }
    }
    this._syncing = false;
  }
};
// expose for Phase 3 engine + debugging
window.PTWeb = PTWeb;

/* ---------- Telegram ---------- */
const PTTelegram = {
  _lastSent: 0,
  _minGapMs: 1500, // avoid Telegram rate limits
  _pending: {}, // callbackId -> resolver for native async results

  _canSend() {
    return !!(S.tgToken && S.tgChat && S.tgSignals);
  },

  // v2.0.37: native async result handler (called from Java, never blocks)
  _initNativeCallback() {
    if (window._onTgNativeResult) return;
    window._onTgNativeResult = function(cbId, result) {
      const r = PTTelegram._pending[cbId];
      if (r) { delete PTTelegram._pending[cbId]; r(result); }
    };
  },

  // v2.0.37: send via native async (non-blocking). Returns Promise<boolean|string>.
  _sendNativeAsync(text) {
    this._initNativeCallback();
    return new Promise((resolve) => {
      try {
        const n = qxNative();
        if (n && typeof n.sendTelegramNative === 'function') {
          const cbId = 'tg' + Date.now() + Math.floor(Math.random() * 10000);
          // v2.0.39: 15s timeout (native uses 10s timeouts now)
          const to = setTimeout(() => {
            if (PTTelegram._pending[cbId]) { delete PTTelegram._pending[cbId]; resolve('error: timeout (no response from app — try again)'); }
          }, 15000);
          PTTelegram._pending[cbId] = (result) => { clearTimeout(to); resolve(result); };
          n.sendTelegramNative(String(S.tgToken).trim(), String(S.tgChat).trim(), text, cbId);
          return;
        }
      } catch (e) {}
      resolve('error: no native bridge');
    });
  },

  async _post(text, ignoreGate) {
    if (!ignoreGate && !this._canSend()) return false;
    if (!(S.tgToken && S.tgChat)) return false;
    const nowMs = Date.now();
    if (nowMs - this._lastSent < this._minGapMs) {
      await new Promise(r => setTimeout(r, this._minGapMs - (nowMs - this._lastSent)));
    }
    this._lastSent = Date.now();
    // v2.0.37: use native async (non-blocking — v2.0.35 sync version hung the app)
    try {
      const res = await this._sendNativeAsync(text);
      if (typeof res === 'string') return res === 'ok';
      return !!res;
    } catch (e) { return false; }
  },

  fmtTime(d) {
    try { const x = (d instanceof Date) ? d : new Date(d); return x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch (e) { return ''; }
  },

  async sendSignal(sig) {
    if (!S.pushSignals) return false;
    const arrow = sig.dir === 'CALL' ? '🟢' : '🔴';
    const text =
      '📡 <b>NEW SIGNAL</b>\n' +
      'Asset: <b>' + assetName(sig.asset) + '</b>\n' +
      'Direction: <b>' + sig.dir + '</b> ' + arrow + '\n' +
      'Confidence: <b>' + sig.conf + '%</b>\n' +
      'Expiry: <b>' + (sig.expiry || 60) + 's</b>\n' +
      'Time: ' + this.fmtTime(sig.time);
    return this._post(text);
  },

  async sendResult(sig, result, pnl) {
    if (!S.pushResults) return false;
    const win = result === 'win';
    const icon = win ? '✅' : '❌';
    const amt = (pnl != null) ? (' ' + (win ? '+' : '') + '$' + Number(pnl).toFixed(2)) : '';
    const text = icon + ' <b>' + (win ? 'WIN' : 'LOSS') + '</b> — ' +
      assetName(sig.asset) + ' ' + sig.dir + amt;
    return this._post(text);
  },

  async sendText(text) { return this._post(text); },

  // v2.0.1: status alerts (connect/disconnect) — needs only token+chat, not signal alerts
  async sendStatus(text) { return this._post(text, true); },

  // v2.0.3: returns the REAL Telegram error so the user can fix token/chat
  // v2.0.35: uses native Java HTTP (JS fetch blocked in WebView)
  // v2.0.37: async native (non-blocking — sync version hung the app)
  async testSend() {
    if (!(S.tgToken && S.tgChat)) return { ok: false, detail: 'Token ya Chat ID khaali hai' };
    try {
      const res = await this._sendNativeAsync('✅ Prime Trader test — Telegram kaam kar raha hai!');
      if (res === 'ok') return { ok: true, detail: 'Test message bheja gaya! Telegram check karo.' };
      if (typeof res === 'string' && res.startsWith('error:')) return { ok: false, detail: res };
      return { ok: false, detail: 'Bheja nahi ja saka: ' + res };
    } catch (e) { return { ok: false, detail: 'Error: ' + e.message }; }
  }
};
window.PTTelegram = PTTelegram;

/* ---------- Central signal pipeline ---------- */
// Called by the signal engine (Phase 3) for every new real signal.
// Adds to UI list, publishes to website, sends Telegram.
function emitRealSignal(sig) {
  // normalize
  sig.id = sig.id || ('sig_' + Date.now() + '_' + Math.floor(Math.random() * 1e6));
  sig.time = (sig.time instanceof Date) ? sig.time : new Date(sig.time || Date.now());
  sig.expiry = sig.expiry || 60;
  sig.settled = false; sig.result = null; sig.webId = null;
  // 1) UI — newest first
  demoSignals.unshift(sig);
  if (demoSignals.length > 10) demoSignals.pop();
  try { renderHome(); } catch (e) {}
  try { if (typeof renderSignals === 'function') renderSignals(); } catch (e) {}
  // 2) Website (Supabase) — fire and forget
  window._ptLastSignalAt = sig.time.toISOString();
  PTWeb.publishSignal(sig).then(() => PTWeb.syncBotStatus());
  // 3) Telegram — fire and forget
  PTTelegram.sendSignal(sig);
  // 4) schedule settlement at expiry
  const settleInMs = Math.max(1000, sig.expiry * 1000);
  setTimeout(() => settleRealSignal(sig), settleInMs);
  return sig;
}
window.emitRealSignal = emitRealSignal;

// Settles a signal at expiry: compares entry vs current price.
function settleRealSignal(sig) {
  if (!sig || sig.settled) return;
  sig.settled = true;
  // current price from the live tick cache (fallback: entry price = push)
  let cur = null;
  try {
    const tick = window._qxPrices && window._qxPrices[qxNormAsset(sig.asset)];
    if (tick) cur = tick.price;
  } catch (e) {}
  const entry = (sig.entryPrice != null) ? sig.entryPrice : cur;
  let result = 'loss', pnl = 0;
  if (entry != null && cur != null) {
    const won = sig.dir === 'CALL' ? (cur > entry) : (cur < entry);
    // push (exact equal) counts as loss for the signal record
    result = won ? 'win' : 'loss';
    const amt = (typeof S.amount === 'number') ? S.amount : 10;
    const payoutPct = 80; // settled P&L estimate; real trade P&L comes from trade records
    pnl = won ? +(amt * payoutPct / 100).toFixed(2) : -amt;
  }
  sig.result = result;
  // strategy stats
  try {
    const st = strategies[0];
    if (st) { st.trades++; if (result === 'win') st.wins++; st.acc = Math.round(st.wins / st.trades * 100); }
  } catch (e) {}
  // signal history
  try { sigHistory.unshift({ asset: sig.asset, dir: sig.dir, conf: sig.conf, time: sig.time, result: result.toUpperCase(), pnl: pnl }); persistSigHistory(); } catch (e) {}
  try { renderHome(); } catch (e) {}
  try { if (typeof renderSignals === 'function') renderSignals(); } catch (e) {}
  // website + telegram
  PTWeb.settleSignal(sig, result, cur, pnl).then(() => PTWeb.syncBotStatus());
  PTTelegram.sendResult(sig, result, pnl);
}
window.settleRealSignal = settleRealSignal;

// Periodic maintenance: flush offline queue + sync bot status every 60s
setInterval(() => { PTWeb.flushQueue(); PTWeb.syncBotStatus(); }, 60000);

/* ---------- SETTINGS BINDINGS ---------- */
function bindRange(id, key, fmt, vid) {
  const el = $(id);
  el.value = S[key];
  const show = () => { $(vid).textContent = fmt(+el.value); };
  show();
  el.addEventListener('input', () => { S = store.set({ [key]: +el.value }); show(); });
  // Tap the value to type an exact number (for wide ranges like 1-3000)
  const vidEl = $(vid);
  if (vidEl) {
    vidEl.style.cursor = 'pointer';
    vidEl.title = 'Tap to type exact value';
    vidEl.addEventListener('click', () => {
      const cur = S[key];
      const raw = prompt('Enter value (' + el.min + ' - ' + el.max + '):', cur);
      if (raw === null) return;
      let v = parseFloat(raw);
      if (isNaN(v)) return;
      v = Math.min(+el.max, Math.max(+el.min, v));
      el.value = v;
      S = store.set({ [key]: v });
      show();
    });
  }
}
function bindToggle(id, key, cb) {
  const el = $(id);
  el.checked = !!S[key];
  el.addEventListener('change', () => { S = store.set({ [key]: el.checked }); if (cb) cb(el.checked); });
}
function initSettings() {
  bindRange('inMinConf', 'minConf', v => v + '%', 'vMinConf');
  bindRange('inStrongConf', 'strongConf', v => v + '%', 'vStrongConf');
  bindRange('inCompConf', 'compConf', v => v + '%', 'vCompConf');
  bindRange('inMinPayout', 'minPayout', v => v + '%', 'vMinPayout');
  bindRange('inFutureMinConf', 'futureMinConf', v => v + '%', 'vFutureMinConf');
  bindRange('inFuturePayout', 'futurePayout', v => v + '%', 'vFuturePayout');
  bindRange('inAmount', 'amount', v => '$' + v, 'vAmount');
  // Manual base amount input — syncs with slider
  $('inAmountManual').addEventListener('change', e => {
    let v = Math.round(+e.target.value);
    if (isNaN(v)) return;
    v = Math.max(1, Math.min(3000, v));
    S = store.set({ amount: v });
    $('inAmount').value = v;
    $('vAmount').textContent = '$' + v;
    e.target.value = '';
    toast('💰 Base amount set to <b>$' + v + '</b>', 'green');
  });
  bindRange('inAutoTradeConf', 'autoTradeConf', v => v + '%', 'vAutoTradeConf');
  $('inAutoTradeConf').addEventListener('change', () => toast('🎯 Auto-trade only on ' + S.autoTradeConf + '%+ signals', 'gold'));
  bindRange('inMtgMult', 'mtgMult', v => v.toFixed(1) + '×', 'vMtgMult');
  bindRange('inMtgSteps', 'mtgSteps', v => v, 'vMtgSteps');
  bindRange('inCompCap', 'compCap', v => '×' + v, 'vCompCap');
  bindRange('inLossLimit', 'lossLimit', v => '$' + v, 'vLossLimit');
  bindRange('inProfitTarget', 'profitTarget', v => '$' + v, 'vProfitTarget');
  bindToggle('tAutoTrade', 'autoTrade');
  bindToggle('tCompounding', 'compounding', on => toast(on ? '💎 Compounding ON' : 'Compounding OFF', 'gold'));
  bindToggle('tAutoStop', 'autoStop');
  bindToggle('tNewsPause', 'newsPause');
  bindToggle('tTgSignals', 'tgSignals');
  bindToggle('tTgStatus', 'tgStatus');
  bindToggle('tPushSignals', 'pushSignals');
  bindToggle('tPushResults', 'pushResults');
  bindToggle('tPushSsid', 'pushSsid');
  bindToggle('tPinLock', 'pinLock', on => { $('rowSetPin').style.display = on ? '' : 'none'; if (on) toast('🔐 Set a 4-digit PIN below', 'gold'); });
  bindToggle('tFingerprint', 'fingerprint');
  $('rowSetPin').style.display = S.pinLock ? '' : 'none';
  $('inPin').value = S.pin || '';
  $('inPin').addEventListener('change', () => { S = store.set({ pin: $('inPin').value }); toast('🔐 PIN saved', 'green'); });
  $('inStartTime').value = S.startTime; $('inEndTime').value = S.endTime;
  $('inStartTime').addEventListener('change', e => { S = store.set({ startTime: e.target.value }); });
  $('inEndTime').addEventListener('change', e => { S = store.set({ endTime: e.target.value }); });
  $('inTgToken').value = S.tgToken; $('inTgChat').value = S.tgChat;
  $('inTgToken').addEventListener('change', e => { S = store.set({ tgToken: e.target.value }); toast('✈️ Telegram token saved', 'green'); });
  $('inTgChat').addEventListener('change', e => { S = store.set({ tgChat: e.target.value }); });
  $('inTournId').value = S.tournamentId || '';
  $('inTournId').addEventListener('change', e => { S = store.set({ tournamentId: e.target.value }); toast('🏆 Tournament ID saved', 'green'); });
  // theme grid
  $$('#themeGrid .theme-opt').forEach(o => {
    o.classList.toggle('selected', o.dataset.themeOpt === S.theme);
    o.addEventListener('click', () => { applyTheme(o.dataset.themeOpt); toast('🎨 Theme: ' + o.querySelector('.theme-name').textContent, 'gold'); });
  });
  // v2.0.1: connection diagnostics
  var btnDiag = $('btnDiagRefresh');
  if (btnDiag) btnDiag.addEventListener('click', renderDiagnostics);
  // v2.0.3: copy raw diagnostics JSON to clipboard — user pastes it in chat
  var btnCopy = $('btnDiagCopy');
  if (btnCopy) btnCopy.addEventListener('click', function () {
    var n = qxNative();
    var txt = 'no native bridge';
    try { txt = n && n.getDiagnostics ? n.getDiagnostics() : txt; } catch (e) { txt = 'error: ' + e.message; }
    var done = function (ok) { toast(ok ? '📋 Report copy ho gayi — mujhe chat me paste kardo' : '❌ Copy nahi hui', ok ? 'green' : 'red'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
      } else { done(false); }
    } catch (e) { done(false); }
  });
  // v2.0.47: Tick Report — which pairs are getting ticks
  var btnTick = $('btnTickReport');
  if (btnTick) btnTick.addEventListener('click', function () {
    try {
      var n = qxNative();
      if (!n) { toast('❌ Native bridge nahi mila', 'red'); return; }
      if (typeof n.getTickReport !== 'function') { toast('❌ getTickReport nahi mila (v2.0.47 install karo)', 'red'); return; }
      var txt = n.getTickReport() || '{}';
      var data = JSON.parse(txt);
      var keys = Object.keys(data);
      if (keys.length === 0) { toast('⚠️ Abhi koi ticks nahi aaye — 1 min wait karo', 'yellow'); return; }
      var withTicks = keys.filter(k => data[k] > 0).length;
      var msg = '📊 Tick Report: ' + withTicks + ' pairs / ' + keys.length + ' tracked\n\n';
      keys.slice(0, 20).forEach(k => { msg += k + ': ' + data[k] + '\n'; });
      if (keys.length > 20) msg += '... aur ' + (keys.length - 20);
      // Copy to clipboard and show toast
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(msg).then(function() {
            toast('📋 Tick Report copy ho gayi!', 'green');
          }, function() { toast(msg.substring(0, 100), 'green'); });
        } else {
          toast(msg.substring(0, 200), 'green');
        }
      } catch (e) { toast(msg.substring(0, 200), 'green'); }
    } catch (e) { toast('❌ Error: ' + e.message, 'red'); }
  });
  var btnTg = $('btnTgTest');
  if (btnTg) btnTg.addEventListener('click', function () {
    toast('✈️ Telegram test bheja ja raha hai...', 'gold');
    PTTelegram.testSend().then(function (res) {
      toast((res.ok ? '✅ ' : '❌ ') + res.detail, res.ok ? 'green' : 'red');
    });
  });
  // assets
  renderAssetChips();
  // expiry + future timeframes
  renderExpiryChips();
  renderFutureTfChips();
  renderFutureLookbackChips();
  renderFutureBatchSizeChips();
  // signals-per-period + gap (regular + future)
  renderSigCountChips();
  renderSigPeriodChips();
  renderSigGapChips();
  renderFutureSigCountChips();
  renderFutureSigPeriodChips();
  renderFutureSigGapChips();
  renderFutureExpiryChips();
}
function renderAssetChips() {
  // Use real Quotex instruments with payouts if available, else fallback to hardcoded
  const instruments = S.qxInstruments && S.qxInstruments.length > 0 ? S.qxInstruments : null;
  // v2.0.42: show LIVE streaming indicator — which pairs have recent ticks (analysis running)
  const now = Date.now();
  const prices = window._qxPrices || {};
  let streamingCount = 0;
  let chipsHtml = '';
  if (instruments) {
    // Real pairs from Quotex with payout %
    chipsHtml = instruments.map(inst => {
      const name = inst.name || inst.asset || inst.symbol;
      const payout = inst.payout || inst.profit || 0;
      const selected = S.assets.includes(name);
      // Check if this pair is actively streaming (tick within last 60 sec)
      // v2.0.43: increased from 15s to 60s — some pairs have sparse ticks
      const norm = qxNormAsset(name);
      const tick = prices[norm] || prices[name];
      const isStreaming = tick && (now - tick.ts < 60000);
      if (isStreaming) streamingCount++;
      const liveDot = isStreaming ? '<span class="live-dot" title="Streaming live">🟢</span>' : '<span class="live-dot" title="No ticks yet">⚪</span>';
      return `<button class="chip ${selected ? 'on' : ''}" data-asset="${name}">${liveDot} ${assetName(name)} <span class="payout">${payout}%</span></button>`;
    }).join('');
    $('assetCount').textContent = `(${instruments.length} from Quotex • ${streamingCount} streaming)`;
  } else {
    // Fallback to hardcoded list
    chipsHtml = ALL_ASSETS.map(a => `
      <button class="chip ${S.assets.includes(a) ? 'on' : ''}" data-asset="${a}">${assetName(a)}</button>`).join('');
    $('assetCount').textContent = `(${S.assets.length} selected)`;
  }
  $('assetChips').innerHTML = chipsHtml;
  $$('#assetChips .chip').forEach(c => c.addEventListener('click', () => {
    const a = c.dataset.asset;
    let arr = S.assets.slice();
    if (arr.includes(a)) { if (arr.length > 1) arr = arr.filter(x => x !== a); }
    else arr.push(a);
    S = store.set({ assets: arr });
    renderAssetChips();
  }));
}
// v2.0.42: auto-refresh streaming indicators every 5s (real-time, 0-delay feel)
setInterval(() => {
  try {
    if (S.qxInstruments && S.qxInstruments.length > 0) renderAssetChips();
  } catch (e) {}
}, 5000);
/* ---------- EXPIRY + FUTURE-TIMEFRAME CHIPS ---------- */
const EXPIRY_OPTS = [{ s: 60, label: '1 min' }, { s: 120, label: '2 min' }, { s: 300, label: '5 min' }];
function expiryLabel(sec) {
  const o = EXPIRY_OPTS.find(o => o.s === sec);
  return o ? o.label : sec + 's';
}
function renderExpiryChips() {
  const box = $('expiryChips');
  if (!box) return;
  box.innerHTML = EXPIRY_OPTS.map(o => `
    <button class="chip ${S.expiry === o.s ? 'on' : ''}" data-expiry="${o.s}">${o.label}</button>`).join('');
  $('vExpiry').textContent = expiryLabel(S.expiry);
  $$('#expiryChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ expiry: +c.dataset.expiry });
    renderExpiryChips();
    toast('⏱️ Expiry: ' + expiryLabel(S.expiry), 'gold');
  }));
}
const FUTURE_TF_OPTS = [5, 15, 30];
function renderFutureTfChips() {
  const box = $('futureTfChips');
  if (!box) return;
  if (!Array.isArray(S.futureTimeframes)) S = store.set({ futureTimeframes: [5] });
  box.innerHTML = FUTURE_TF_OPTS.map(t => `
    <button class="chip ${S.futureTimeframes.includes(t) ? 'on' : ''}" data-tf="${t}">${t} min</button>`).join('');
  $('vFutureTf').textContent = S.futureTimeframes.slice().sort((a, b) => a - b).map(t => t + 'm').join(', ');
  $$('#futureTfChips .chip').forEach(c => c.addEventListener('click', () => {
    const t = +c.dataset.tf;
    let arr = Array.isArray(S.futureTimeframes) ? S.futureTimeframes.slice() : [5];
    if (arr.includes(t)) { if (arr.length > 1) arr = arr.filter(x => x !== t); }
    else arr.push(t);
    S = store.set({ futureTimeframes: arr });
    renderFutureTfChips();
  }));
}

const FUTURE_LB_OPTS = [1, 2, 4];
function renderFutureLookbackChips() {
  const box = $('futureLookbackChips');
  if (!box) return;
  box.innerHTML = FUTURE_LB_OPTS.map(h => `
    <button class="chip ${S.futureLookback === h ? 'on' : ''}" data-lb="${h}">${h} hour${h > 1 ? 's' : ''}</button>`).join('');
  $('vFutureLookback').textContent = S.futureLookback + ' hour' + (S.futureLookback > 1 ? 's' : '');
  $$('#futureLookbackChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ futureLookback: +c.dataset.lb });
    renderFutureLookbackChips();
    toast('🔮 Lookback: ' + S.futureLookback + ' hour' + (S.futureLookback > 1 ? 's' : ''), 'gold');
  }));
}
const FUTURE_BS_OPTS = [15, 20, 25, 30];
function renderFutureBatchSizeChips() {
  const box = $('futureBatchSizeChips');
  if (!box) return;
  box.innerHTML = FUTURE_BS_OPTS.map(n => `
    <button class="chip ${S.futureBatchSize === n ? 'on' : ''}" data-bs="${n}">${n}</button>`).join('');
  $('vFutureBatchSize').textContent = S.futureBatchSize;
  $$('#futureBatchSizeChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ futureBatchSize: +c.dataset.bs });
    renderFutureBatchSizeChips();
    toast('🔮 Batch size: ' + S.futureBatchSize + ' signals', 'gold');
  }));
}

/* ---------- SIGNALS-PER-PERIOD / GAP / EXPIRY CHIPS (regular + future) ---------- */
const SIG_COUNT_OPTS = [5, 10, 15, 20, 30];
const REG_SIG_COUNT_OPTS = [2, 3, 5, 10, 15, 20, 30];
const SIG_PERIOD_OPTS = [{ m: 10, label: '10 min' }, { m: 30, label: '30 min' }, { m: 60, label: '1 hour' }];
const REG_SIG_PERIOD_OPTS = [{ m: 5, label: '5 min' }, { m: 10, label: '10 min' }, { m: 20, label: '20 min' }, { m: 30, label: '30 min' }, { m: 60, label: '1 hour' }];
const SIG_GAP_OPTS = [{ s: 30, label: '30s' }, { s: 60, label: '60s' }, { s: 120, label: '120s' }, { s: 300, label: '300s' }];
function periodLabel(min) {
  const o = REG_SIG_PERIOD_OPTS.find(o => o.m === min) || SIG_PERIOD_OPTS.find(o => o.m === min);
  return o ? o.label : min + ' min';
}
function sigCountLabel(count, periodMin) { return count + ' / ' + periodLabel(periodMin); }

function renderSigCountChips() {
  const box = $('sigCountChips');
  if (!box) return;
  box.innerHTML = REG_SIG_COUNT_OPTS.map(n => `
    <button class="chip ${S.sigCount === n ? 'on' : ''}" data-sc="${n}">${n}</button>`).join('');
  $('vSigCount').textContent = sigCountLabel(S.sigCount, S.sigPeriod);
  $$('#sigCountChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ sigCount: +c.dataset.sc });
    renderSigCountChips();
    toast('📡 Signals per period: ' + sigCountLabel(S.sigCount, S.sigPeriod), 'gold');
  }));
}
function renderSigPeriodChips() {
  const box = $('sigPeriodChips');
  if (!box) return;
  box.innerHTML = REG_SIG_PERIOD_OPTS.map(o => `
    <button class="chip ${S.sigPeriod === o.m ? 'on' : ''}" data-sp="${o.m}">${o.label}</button>`).join('');
  $('vSigCount').textContent = sigCountLabel(S.sigCount, S.sigPeriod);
  $$('#sigPeriodChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ sigPeriod: +c.dataset.sp });
    renderSigPeriodChips();
    toast('📡 Signals per period: ' + sigCountLabel(S.sigCount, S.sigPeriod), 'gold');
  }));
}
function renderSigGapChips() {
  const box = $('sigGapChips');
  if (!box) return;
  box.innerHTML = SIG_GAP_OPTS.map(o => `
    <button class="chip ${S.sigGap === o.s ? 'on' : ''}" data-sg="${o.s}">${o.label}</button>`).join('');
  $('vSigGap').textContent = S.sigGap + 's';
  $$('#sigGapChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ sigGap: +c.dataset.sg });
    renderSigGapChips();
    toast('📡 Signal gap: ' + S.sigGap + 's', 'gold');
  }));
}
function renderFutureSigCountChips() {
  const box = $('futureSigCountChips');
  if (!box) return;
  box.innerHTML = SIG_COUNT_OPTS.map(n => `
    <button class="chip ${S.futureSigCount === n ? 'on' : ''}" data-fsc="${n}">${n}</button>`).join('');
  $('vFutureSigCount').textContent = sigCountLabel(S.futureSigCount, S.futureSigPeriod);
  $$('#futureSigCountChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ futureSigCount: +c.dataset.fsc });
    renderFutureSigCountChips();
    toast('🔮 Future signals per period: ' + sigCountLabel(S.futureSigCount, S.futureSigPeriod), 'gold');
  }));
}
function renderFutureSigPeriodChips() {
  const box = $('futureSigPeriodChips');
  if (!box) return;
  box.innerHTML = SIG_PERIOD_OPTS.map(o => `
    <button class="chip ${S.futureSigPeriod === o.m ? 'on' : ''}" data-fsp="${o.m}">${o.label}</button>`).join('');
  $('vFutureSigCount').textContent = sigCountLabel(S.futureSigCount, S.futureSigPeriod);
  $$('#futureSigPeriodChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ futureSigPeriod: +c.dataset.fsp });
    renderFutureSigPeriodChips();
    toast('🔮 Future signals per period: ' + sigCountLabel(S.futureSigCount, S.futureSigPeriod), 'gold');
  }));
}
function renderFutureSigGapChips() {
  const box = $('futureSigGapChips');
  if (!box) return;
  box.innerHTML = SIG_GAP_OPTS.map(o => `
    <button class="chip ${S.futureSigGap === o.s ? 'on' : ''}" data-fsg="${o.s}">${o.label}</button>`).join('');
  $('vFutureSigGap').textContent = S.futureSigGap + 's';
  $$('#futureSigGapChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ futureSigGap: +c.dataset.fsg });
    renderFutureSigGapChips();
    toast('🔮 Future signal gap: ' + S.futureSigGap + 's', 'gold');
  }));
}
function renderFutureExpiryChips() {
  const box = $('futureExpiryChips');
  if (!box) return;
  box.innerHTML = EXPIRY_OPTS.map(o => `
    <button class="chip ${S.futureExpiry === o.s ? 'on' : ''}" data-fexp="${o.s}">${o.label}</button>`).join('');
  $('vFutureExpiry').textContent = expiryLabel(S.futureExpiry);
  $$('#futureExpiryChips .chip').forEach(c => c.addEventListener('click', () => {
    S = store.set({ futureExpiry: +c.dataset.fexp });
    renderFutureExpiryChips();
    toast('🔮 Future expiry: ' + expiryLabel(S.futureExpiry), 'gold');
  }));
}

/* ---------- IN-APP UPDATES ---------- */
function verCmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
async function fetchRemoteVersion() {
  const resp = await fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}
function startApkInstall(url) {
  if (!url) { toast('⚠️ No download link for this update', 'red'); return; }
  if (window.PrimeTrader && typeof window.PrimeTrader.downloadAndInstall === 'function') {
    try {
      window.PrimeTrader.downloadAndInstall(url);
      toast('⬇ Downloading update… watch the notification shade', 'gold');
      // Manual fallback: poll for the downloaded APK; when present show an Install button
      // (auto-install does not trigger on some devices).
      startInstallPoll();
    } catch (e) { window.open(url, '_blank'); }
  } else {
    // browser preview (no native bridge): just open the APK link
    window.open(url, '_blank');
    toast('🌐 Opening download link…', 'gold');
  }
}
// Poll every 2s for the downloaded update APK; when found, show a manual Install button.
var installPollTimer = null;
function startInstallPoll() {
  if (!(window.PrimeTrader && typeof window.PrimeTrader.isUpdateDownloaded === 'function')) return;
  stopInstallPoll();
  var r = $('updateResult');
  installPollTimer = setInterval(function () {
    var ready = false;
    try { ready = window.PrimeTrader.isUpdateDownloaded(); } catch (e) {}
    if (ready) {
      stopInstallPoll();
      if (r) {
        r.innerHTML = '<div class="update-banner"><div class="u-ico">📲</div>' +
          '<div style="flex:1"><div class="set-label">Update downloaded</div>' +
          '<div class="small text-muted">Tap below to install it now.</div></div></div>' +
          '<button class="btn btn-gold btn-block" id="btnInstallNow">📲 Install Update</button>';
        $('btnInstallNow').addEventListener('click', function () {
          try { window.PrimeTrader.installDownloadedUpdate(); }
          catch (e) { toast('⚠️ Could not open installer', 'red'); }
        });
      }
      toast('📲 Update ready — tap Install Update', 'gold');
    }
  }, 2000);
}
function stopInstallPoll() {
  if (installPollTimer) { clearInterval(installPollTimer); installPollTimer = null; }
}
function showUpdateDialog(info) {
  const cl = info.changelog
    ? `<div class="small text-muted mt1" style="white-space:pre-line;text-align:left">${info.changelog}</div>` : '';
  openModal(`
    <div class="text-center">
      <div style="font-size:2.4rem">⬆️</div>
      <div class="modal-title">New version available!</div>
      <div class="small text-muted">v${info.version} is ready — you have v${APP_VERSION}.</div>
      ${cl}
    </div>
    <div class="modal-actions" style="flex-direction:column">
      <button class="btn btn-gold btn-block" id="btnDlUpdate">⬇ Download &amp; Install</button>
      <button class="btn btn-ghost btn-block" id="btnLaterUpdate">Later</button>
    </div>`, true);
  $('btnLaterUpdate').addEventListener('click', closeModal);
  $('btnDlUpdate').addEventListener('click', () => { closeModal(); startApkInstall(info.apk_url); });
}
async function checkForUpdates(silent) {
  const r = $('updateResult');
  if (!silent) {
    r.style.display = '';
    r.innerHTML = '<div class="spinner"></div><div class="small text-muted text-center mt1">Checking GitHub for updates…</div>';
  }
  try {
    const info = await fetchRemoteVersion();
    if (verCmp(info.version, APP_VERSION) > 0) {
      if (silent) {
        // auto-prompt at most once per version per day
        const key = 'pt-update-prompt';
        let last = {};
        try { last = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
        const today = new Date().toDateString();
        if (last.v !== info.version || last.d !== today) {
          localStorage.setItem(key, JSON.stringify({ v: info.version, d: today }));
          showUpdateDialog(info);
        }
      } else {
        r.innerHTML = `<div class="update-banner"><div class="u-ico">⬆️</div>
          <div style="flex:1"><div class="set-label">v${info.version} available</div>
          <div class="small text-muted">You have v${APP_VERSION}.</div></div></div>
          <button class="btn btn-gold btn-block" id="btnUpdNow">⬇ Download &amp; Install</button>`;
        $('btnUpdNow').addEventListener('click', () => startApkInstall(info.apk_url));
      }
    } else if (!silent) {
      r.innerHTML = `<div class="update-banner"><div class="u-ico">✅</div>
        <div><div class="set-label">You're up to date</div><div class="small text-muted">v${APP_VERSION} is the latest release on GitHub.</div></div></div>`;
      toast('✅ App is up to date', 'green');
    }
  } catch (e) {
    if (!silent) {
      r.innerHTML = `<div class="update-banner"><div class="u-ico">⚠️</div>
        <div><div class="set-label">Update check failed</div><div class="small text-muted">No internet or GitHub unreachable.</div></div></div>`;
      toast('⚠️ Could not check for updates', 'red');
    }
  }
}
$('btnCheckUpdate').addEventListener('click', () => checkForUpdates(false));

/* ---------- EXPORT ---------- */
function allTradesFlat() {
  const rows = [['Batch', 'Asset', 'Direction', 'Entry Time', 'Exit Time', 'Date', 'Open Price', 'Close Price', 'MTG', 'Amount', 'P/L']];
  batches.forEach(b => b.trades.forEach(t => rows.push([
    b.num, t.asset, t.dir, fmtTime(t.entryTime), fmtTime(t.exitTime), t.date, t.open, t.close, t.mtg, t.amount, t.pl
  ])));
  return rows;
}
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('exportCsv').addEventListener('click', () => {
  const csv = allTradesFlat().map(r => r.join(',')).join('\n');
  download('prime-trader-history.csv', csv, 'text/csv');
  toast('⬇ CSV exported', 'green');
});
$('exportXls').addEventListener('click', () => {
  const rows = allTradesFlat().map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
  download('prime-trader-history.xls', `<table>${rows}</table>`, 'application/vnd.ms-excel');
  toast('⬇ Excel exported', 'green');
});

/* ---------- LOCK SCREEN ---------- */
let pinEntry = '';
function renderPinDots() {
  $$('#pinDots .pin-dot').forEach((d, i) => d.classList.toggle('filled', i < pinEntry.length));
}
function openLock() { pinEntry = ''; renderPinDots(); $('lockScreen').classList.add('open'); }
function closeLock() { $('lockScreen').classList.remove('open'); }
$$('#pinPad .pin-key').forEach(k => k.addEventListener('click', () => {
  if (k.id === 'pinClear') { pinEntry = pinEntry.slice(0, -1); renderPinDots(); return; }
  if (k.id === 'pinOk') { checkPin(); return; }
  if (pinEntry.length < 4) { pinEntry += k.textContent; renderPinDots(); }
  if (pinEntry.length === 4) setTimeout(checkPin, 180);
}));
function checkPin() {
  if (pinEntry === (S.pin || '1234')) { closeLock(); toast('🔓 <b>Unlocked.</b> Welcome back!', 'green'); }
  else {
    $$('#pinDots .pin-dot').forEach(d => d.classList.add('error'));
    setTimeout(() => { $$('#pinDots .pin-dot').forEach(d => d.classList.remove('error')); pinEntry = ''; renderPinDots(); }, 400);
    toast('❌ Wrong PIN', 'red');
  }
}
$('fpBtn').addEventListener('click', () => {
  toast('👆 Fingerprint…', 'gold');
  setTimeout(() => { closeLock(); toast('🔓 <b>Unlocked via fingerprint.</b>', 'green'); }, 1100);
});

/* ---------- ONBOARDING ---------- */
let obIdx = 0;
function renderOb() {
  $('obSlides').style.transform = '';
  $$('#obSlides .ob-slide').forEach((s, i) => { s.style.transform = `translateX(-${obIdx * 100}%)`; });
  $$('#obDots .ob-dot').forEach((d, i) => d.classList.toggle('active', i === obIdx));
  $('obBack').style.display = obIdx === 0 ? 'none' : '';
  $('obNext').textContent = obIdx === 3 ? 'Get Started 🚀' : 'Next →';
}
$('obNext').addEventListener('click', () => {
  if (obIdx < 3) { obIdx++; renderOb(); }
  else { $('onboard').classList.remove('open'); S = store.set({ onboarded: true }); }
});
$('obBack').addEventListener('click', () => { if (obIdx > 0) { obIdx--; renderOb(); } });
$('obSkip').addEventListener('click', () => { $('onboard').classList.remove('open'); S = store.set({ onboarded: true }); });
$('rowTutorial').addEventListener('click', () => { obIdx = 0; renderOb(); $('onboard').classList.add('open'); });

/* ---------- INIT ---------- */
function init() {
  applyTheme(S.theme);
  renderStop();
  renderAcct();
  renderSsid();
  renderHome();
  renderSignals();
  renderDashStats();
  renderLiveTrades();
  renderBatches();
  renderSigHistory();
  renderStrategies();
  initSettings();
  observeReveals();
  setTimeout(drawCharts, 120);
  // Phase 3: start the real 7-indicator signal engine timers (runs only when connected)
  startSignalEngine();
  // v2.0.39: AUTO-LOGIN on startup — if SSID is saved, connect automatically.
  // User never has to tap "Login & Connect" again (unless SSID expires).
  setTimeout(() => {
    try {
      if (qxIsConnected()) return; // already connected
      const n = qxNative();
      if (n && typeof n.getSavedSsid === 'function') {
        const saved = n.getSavedSsid();
        if (saved && saved.length > 10) {
          toast('🔄 <b>Auto-connecting...</b> Saved session found.', 'gold');
          // Use native connect (starts foreground service too)
          if (typeof n.connect === 'function') {
            n.connect(saved);
          } else {
            // fallback: BotEngine direct via bridge
            window._autoSsid = saved;
            if (window.onQuotexLogin) window.onQuotexLogin(true);
          }
        }
      }
    } catch (e) {}
  }, 2000);
  // version badge + silent update check on app start
  const av = $('appVer');
  if (av) av.textContent = 'v' + APP_VERSION + ' • GitHub: prime-trader-app';
  setTimeout(() => checkForUpdates(true), 4000);
  // if an update APK was downloaded in a previous session but never installed,
  // show the manual Install button right away
  setTimeout(() => {
    try {
      if (window.PrimeTrader && typeof window.PrimeTrader.isUpdateDownloaded === 'function'
          && window.PrimeTrader.isUpdateDownloaded()) {
        const r = $('updateResult');
        if (r) {
          r.style.display = '';
          r.innerHTML = '<div class="update-banner"><div class="u-ico">📲</div>' +
            '<div style="flex:1"><div class="set-label">Update downloaded</div>' +
            '<div class="small text-muted">Tap below to install it now.</div></div></div>' +
            '<button class="btn btn-gold btn-block" id="btnInstallNow">📲 Install Update</button>';
          $('btnInstallNow').addEventListener('click', function () {
            try { window.PrimeTrader.installDownloadedUpdate(); }
            catch (e) { toast('⚠️ Could not open installer', 'red'); }
          });
        }
      }
    } catch (e) {}
  }, 5000);
  if (!S.onboarded) { setTimeout(() => $('onboard').classList.add('open'), 500); }
  else if (S.pinLock) { setTimeout(openLock, 500); }
  // demo signal generator DISABLED — no fake signals until a real Quotex connection provides live data
  // (previously: new signal arrived every ~25s)
}
document.addEventListener('DOMContentLoaded', init);

/* ---------- LIVE CANDLESTICK CHART ---------- */
const candleFeeds = {};
function getFeed(asset) {
  if (candleFeeds[asset]) return candleFeeds[asset];
  let price = basePrice(asset);
  const candles = [];
  for (let i = 0; i < 48; i++) {
    const o = price;
    let h = o, l = o;
    for (let t = 0; t < 6; t++) {
      price = price * (1 + (Math.random() - 0.5) * 0.0009);
      h = Math.max(h, price); l = Math.min(l, price);
    }
    candles.push({ o, h, l, c: price });
  }
  const feed = { candles, cur: { o: price, h: price, l: price, c: price }, ticks: 0 };
  candleFeeds[asset] = feed;
  return feed;
}
function tickFeed(asset) {
  const f = getFeed(asset);
  f.ticks++;
  const p = f.cur.c * (1 + (Math.random() - 0.5) * 0.0011);
  f.cur.c = p;
  f.cur.h = Math.max(f.cur.h, p);
  f.cur.l = Math.min(f.cur.l, p);
  if (f.ticks % 8 === 0) {           // new candle every ~8s (demo)
    f.candles.push(f.cur);
    if (f.candles.length > 60) f.candles.shift();
    f.cur = { o: p, h: p, l: p, c: p };
  }
  return f;
}
function drawCandleChart(canvas, asset, entryPrice, dir) {
  const f = getFeed(asset);
  const all = f.candles.concat([f.cur]);
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = 300;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const padR = 58, padB = 18, padT = 10;
  const cw = w - padR, ch = h - padB - padT;
  let mn = Math.min(entryPrice, ...all.map(c => c.l));
  let mx = Math.max(entryPrice, ...all.map(c => c.h));
  const span = (mx - mn) || 1; mn -= span * 0.12; mx += span * 0.12;
  const py = v => padT + (1 - (v - mn) / (mx - mn)) * ch;
  const n = all.length, bw = cw / n, bodyW = Math.max(2, bw * 0.62);
  // win/loss zone shading
  const ey = py(entryPrice);
  ctx.fillStyle = dir === 'CALL' ? 'rgba(34,197,94,.07)' : 'rgba(239,68,68,.07)';
  ctx.fillRect(0, dir === 'CALL' ? padT : ey, cw, dir === 'CALL' ? ey - padT : padT + ch - ey);
  ctx.fillStyle = dir === 'CALL' ? 'rgba(239,68,68,.07)' : 'rgba(34,197,94,.07)';
  ctx.fillRect(0, dir === 'CALL' ? ey : padT, cw, dir === 'CALL' ? padT + ch - ey : ey - padT);
  // grid
  ctx.strokeStyle = cssVar('--card-border'); ctx.fillStyle = cssVar('--muted');
  ctx.font = '9px sans-serif'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const v = mn + (mx - mn) * g / 4, y = py(v);
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(v.toFixed(5), cw + 5, y + 3);
  }
  // candles
  all.forEach((c, i) => {
    const x = i * bw + bw / 2;
    const up = c.c >= c.o;
    const col = up ? cssVar('--green') : cssVar('--red');
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, py(c.h)); ctx.lineTo(x, py(c.l)); ctx.stroke();
    const yO = py(c.o), yC = py(c.c);
    ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(2, Math.abs(yC - yO)));
  });
  // entry price line (dashed gold)
  ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(0, ey); ctx.lineTo(w, ey); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = cssVar('--accent'); ctx.font = 'bold 9px sans-serif';
  ctx.fillText('ENTRY ' + entryPrice.toFixed(5), 6, ey - 5);
  // live price line
  const lp = f.cur.c, ly = py(lp);
  ctx.strokeStyle = cssVar('--text'); ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(cw, ly); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = dir === 'CALL' ? (lp >= entryPrice ? cssVar('--green') : cssVar('--red')) : (lp <= entryPrice ? cssVar('--green') : cssVar('--red'));
  const lbl = lp.toFixed(5);
  const tw = ctx.measureText(lbl).width + 10;
  ctx.fillRect(w - tw - 2, ly - 9, tw, 18);
  ctx.fillStyle = '#fff'; ctx.fillText(lbl, w - tw + 3, ly + 3);
  return lp;
}
function openTradeChart(tradeId) {
  const t = liveTrades.find(x => x.id === tradeId);
  if (!t) return;
  openModal(`
    <div class="candle-head">
      <div><div class="candle-asset">${assetName(t.asset)}</div>
      <div class="small text-muted">${t.dir} • $${t.amount}${t.mtg ? ` • MTG ${t.mtg}` : ''} • Entry ${t.entryPrice.toFixed(5)}</div></div>
      <div class="candle-price" id="candleLivePx">—</div>
    </div>
    <canvas id="candleCanvas"></canvas>
    <div class="candle-legend">
      <span><span class="sw" style="background:var(--green)"></span>Bullish</span>
      <span><span class="sw" style="background:var(--red)"></span>Bearish</span>
      <span><span class="sw" style="background:var(--accent)"></span>Entry price</span>
    </div>
    <div class="candle-est" id="candleEst">—</div>
    <div class="modal-actions"><button class="btn btn-ghost btn-block" id="mCloseChart">Close Chart</button></div>`);
  $('mCloseChart').addEventListener('click', closeModal);
  const canvas = $('candleCanvas');
  const paint = () => {
    tickFeed(t.asset);
    const lp = drawCandleChart(canvas, t.asset, t.entryPrice, t.dir);
    const pxEl = $('candleLivePx');
    if (pxEl) {
      pxEl.textContent = lp.toFixed(5);
      pxEl.className = 'candle-price ' + (lp >= t.cur.c ? 'up' : 'down');
    }
    const winning = t.dir === 'CALL' ? lp > t.entryPrice : lp < t.entryPrice;
    const est = $('candleEst');
    if (est) {
      est.className = 'candle-est ' + (winning ? 'win' : 'loss');
      est.textContent = winning ? '▲ Currently WINNING' : '▼ Currently LOSING';
    }
  };
  paint();
  const iv = setInterval(() => { if (!document.body.contains(canvas)) { clearInterval(iv); return; } paint(); }, 1000);
  modalCleanup = () => clearInterval(iv);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-chart]');
  if (b) openTradeChart(b.dataset.chart);
});
