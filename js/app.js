/* ============================================================
   PRIME TRADER — Signals App (frontend demo)
   All state in localStorage. Backend (Python Quotex bot) connects later.
   ============================================================ */
'use strict';

/* ---------- APP VERSION / IN-APP UPDATES ---------- */
const APP_VERSION = '1.1.2';
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
  tgToken: '', tgChat: '', tgSignals: true,
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
  $('stBalance').textContent = '$0.00';
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
      });
      return;
    }
    S = store.set({ account: k }); renderAcct(); closeModal();
    toast(`${ACCTS[k].ico} <b>Switched to ${ACCTS[k].name}.</b>`, 'gold');
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
// Save & Connect
$('btnSaveSsid').addEventListener('click', () => {
  const v = $('inSsid').value.trim();
  if (!v) { toast('⚠️ Paste an SSID first', 'red'); return; }
  if (v.length < 8) { toast('⚠️ SSID looks too short', 'red'); return; }
  S = store.set({ ssid: v, ssidSavedAt: new Date().toLocaleString() });
  $('inSsid').value = '';
  $('inSsid').type = 'password'; $('btnSsidToggle').textContent = '👁️';
  toast('🔑 <b>SSID saved.</b> Connecting…', 'gold');
  renderSsid();
  const n = qxNative();
  if (n) {
    try { n.connect(v); } catch (e) { toast('⚠️ Native connect failed: ' + e.message, 'red'); }
    // re-check status shortly after native attempts connection
    setTimeout(renderSsid, 2500);
  } else {
    // No native bridge (e.g. preview in desktop browser) — mark saved, real connect needs the app
    toast('📱 <b>SSID saved.</b> Real connection works inside the Android app.', 'green');
  }
});
// Disconnect
$('btnDisconnectSsid').addEventListener('click', () => {
  const n = qxNative();
  if (n) { try { n.disconnect(); } catch (e) {} }
  S = store.set({ ssid: '' , ssidSavedAt: '' });
  renderSsid();
  toast('🔌 <b>Disconnected.</b> SSID removed.', 'red');
});
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
// SSID expiry hook (wired to native QuotexWsClient onAuthFailed)
function onSsidExpired() {
  $('ssidStatus').className = 'pill pill-red'; $('ssidStatus').textContent = '● Expired';
  renderConnPill();
  if (S.pushSsid) toast('🔔 <b>SSID expired!</b> Paste a new SSID in Settings → Quotex SSID.', 'red');
}

/* ---------- REAL Quotex callbacks (native -> JS, Phase 2) ---------- */
// Called by native when the WebSocket authenticates successfully.
window.onQxConnected = function (host) {
  toast('✅ <b>Quotex connected</b> via ' + host, 'green');
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
  }
};
// Called by native when the socket drops.
window.onQxDisconnected = function (reason) {
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
    S = store.set({ qxInstruments: arr });
    toast('📊 <b>' + arr.length + ' pairs</b> loaded from Quotex', 'green');
    renderAssetChips();
  } catch (e) {}
};
// Called by native for every real price tick: onPriceTick(asset, timestampMs, price)
window.onPriceTick = function (asset, ts, price) {
  try {
    if (!window._qxPrices) window._qxPrices = {};
    window._qxPrices[asset] = { ts: ts, price: price };
  } catch (e) {}
};

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
  let chipsHtml = '';
  if (instruments) {
    // Real pairs from Quotex with payout %
    chipsHtml = instruments.map(inst => {
      const name = inst.name || inst.asset || inst.symbol;
      const payout = inst.payout || inst.profit || 0;
      const selected = S.assets.includes(name);
      return `<button class="chip ${selected ? 'on' : ''}" data-asset="${name}">${assetName(name)} <span class="payout">${payout}%</span></button>`;
    }).join('');
    $('assetCount').textContent = `(${instruments.length} live from Quotex)`;
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
  renderLiveTrades();
  renderBatches();
  renderSigHistory();
  renderStrategies();
  initSettings();
  observeReveals();
  setTimeout(drawCharts, 120);
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
