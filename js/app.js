/* =============================================================================
   OPTIONS TERMINAL
   Live option chain, trade ticket, payoff diagram and mark-to-market positions.
   All pricing is real Black-Scholes off the shared price feed.
   ========================================================================== */
import { BRAND, fmtUsd, fmtPct, marketBySym, tvSymbol } from './config.js';
import { applyBrand } from './brand.js';
import { feed } from './feed.js';
import { bs, smileIv, yearsTo } from './bs.js';
import { wallet } from './wallet.js';
import { createPriceChart } from './chart.js';
import * as oc from './onchain.js';
import { activeNetwork, setNetwork, NETWORKS } from './onchain-config.js';

applyBrand();
feed.start();

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const MULT = BRAND.contractMultiplier;
const R = BRAND.riskFreeRate;
const EDGE = 1 + (BRAND.houseEdge || 0);   // house margin on premiums (vault = counterparty)
let ocFreeLiq = null;                       // cached on-chain vault free liquidity (USD)
const strikeStep = (s) => s < 50 ? 1 : s < 200 ? 2.5 : s < 500 ? 5 : 10;
const roundTo = (v, s) => Math.round(v / s) * s;
const isBuy = (side) => side.startsWith('buy');
const optType = (side) => side.toLowerCase().includes('call') ? 'call' : 'put';
const isCovered = (side) => side === 'sellCall';   // written calls are collateralized by the underlying

/* P/L at expiry for one leg, shared by the ticket, payoff diagram and positions
   so all three always agree. Short calls are modelled as covered (long underlying
   bought at entrySpot + short call) -> finite, fully-collateralized risk. */
function pnlAtExpiry(side, K, prem, entrySpot, notional, ST) {
  const type = optType(side), buy = isBuy(side);
  const intr = type === 'call' ? Math.max(ST - K, 0) : Math.max(K - ST, 0);
  if (buy) return (intr - prem) * notional;                 // long option
  if (type === 'put') return (prem - intr) * notional;      // cash-secured short put
  return ((ST - entrySpot) + (prem - intr)) * notional;     // covered call
}

/* ---------- expiries ---------- */
function buildExpiries() {
  const day0 = new Date(); day0.setHours(16, 0, 0, 0);           // ~market close
  const offsets = [7, 14, 30, 60, 90, 180];
  return offsets.map((d) => {
    const ms = day0.getTime() + d * 86400000;
    return { ms, days: d, label: new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
  });
}
const EXP = buildExpiries();

/* ---------- state ---------- */
const params = new URLSearchParams(location.search);
const state = {
  sym: marketBySym(params.get('sym')) ? params.get('sym') : 'NVDA',
  expiry: EXP[2].ms,           // ~30d default
  side: 'buyCall',
  strike: null,                // set on first render
  strikeLocked: false,         // false = ticket follows ATM; true once user picks a strike
  qty: 1,
  range: '1M',                 // chart range
  positions: loadPositions(),
};
const atmOf = (sym) => { const s = feed.get(sym).price; return roundTo(s, strikeStep(s)); };

function loadPositions() {
  try { return JSON.parse(localStorage.getItem('miraukin_positions') || '[]'); } catch { return []; }
}
function savePositions() { localStorage.setItem('miraukin_positions', JSON.stringify(state.positions)); }

/* ---------- strike ladder ---------- */
function ladder(spot) {
  const step = strikeStep(spot);
  const atm = roundTo(spot, step);
  const out = [];
  for (let i = -8; i <= 8; i++) { const K = atm + i * step; if (K > 0) out.push(K); }
  return out;
}

/* ============================ price chart ============================ */
const chart = createPriceChart($('#priceChart'));
const RANGES = {
  '1D': { range: '1d',  interval: '5m',  n: 78 },
  '1W': { range: '5d',  interval: '30m', n: 66 },
  '1M': { range: '1mo', interval: '1d',  n: 22 },
  '3M': { range: '3mo', interval: '1d',  n: 64 },
  '1Y': { range: '1y',  interval: '1wk', n: 52 },
};
function gaussC() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function synthHistory(sym, n) {  // local fallback: random-walk OHLC candles back from the live spot
  const m = marketBySym(sym); const spot = feed.get(sym).price;
  const stepVol = (m.iv / Math.sqrt(252)) * 0.9;
  const now = Math.floor(Date.now() / 1000);
  const closes = new Array(n); let p = spot;
  for (let i = n - 1; i >= 0; i--) { closes[i] = p; p = p / (1 + stepVol * gaussC()); if (p <= 0.01) p = spot * 0.6; }
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = closes[i], o = i === 0 ? c / (1 + stepVol * gaussC() * 0.5) : closes[i - 1];
    const wick = Math.abs(c) * stepVol * (0.4 + Math.random());
    out[i] = {
      t: now - (n - 1 - i) * 86400,
      o, c,
      h: Math.max(o, c) + wick * Math.random(),
      l: Math.min(o, c) - wick * Math.random(),
      v: Math.round(1e6 * (0.5 + Math.random()) * (spot / 100)),
    };
  }
  return out;
}
async function fetchHistory(sym, key) {
  const cfg = RANGES[key] || RANGES['1M'];
  try {
    const r = await fetch(`/api/history?symbol=${sym}&range=${cfg.range}&interval=${cfg.interval}`, { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.candles) && j.candles.length > 2) return { candles: j.candles, live: true }; }
  } catch (_) { /* fall back to sim */ }
  return { candles: synthHistory(sym, cfg.n), live: false };
}
let chartToken = 0;
async function loadChart() {
  const my = ++chartToken;
  const el = $('#chartSrc'); if (el) el.textContent = 'loading…';
  const { candles, live } = await fetchHistory(state.sym, state.range);
  if (my !== chartToken) return;              // superseded by a newer request
  chart.setData(candles);
  if (el) el.textContent = live ? '● live · Yahoo' : '● simulated';
}
$('#chartRanges').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.range = b.dataset.r;
  $('#chartRanges').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  loadChart();
});

/* TradingView chart embed (real stock candles) via the official tv.js widget. */
function applyChartProvider() {
  const wrap = document.querySelector('.chart-wrap');
  wrap.classList.add('embed');
  const holder = $('#chartFrame');
  const sym = tvSymbol(state.sym);
  if (holder.getAttribute('data-sym') === sym) return true;
  if (!window.TradingView || !window.TradingView.widget) { setTimeout(applyChartProvider, 300); return true; }
  holder.setAttribute('data-sym', sym);
  holder.innerHTML = '';
  new window.TradingView.widget({
    container_id: 'chartFrame', symbol: sym, interval: 'D',
    theme: 'dark', style: '1', locale: 'en', autosize: true,
    hide_side_toolbar: true, allow_symbol_change: false, save_image: false,
    backgroundColor: 'rgba(10,10,15,1)', gridColor: 'rgba(255,255,255,0.04)',
  });
  return true;
}

/* ============================ RENDER: rail ============================ */
// A market is locked when the vault can't back even one contract (its price
// exceeds the free liquidity). Unlocks automatically as liquidity grows.
function isLocked(sym) {
  if (!oc.isEnabled() || ocFreeLiq == null) return false;
  return feed.get(sym).price * MULT > ocFreeLiq + 1e-6;
}
function renderRail() {
  const list = $('#railList'); list.innerHTML = '';
  for (const m of BRAND.markets) {
    const s = feed.get(m.sym);
    const locked = isLocked(m.sym);
    const row = el('button', 'rail-item' + (m.sym === state.sym ? ' active' : '') + (locked ? ' locked' : ''));
    row.dataset.sym = m.sym;
    row.innerHTML = `<span class="ri-sym">${m.sym}${locked ? ' <span class="ri-lock" title="Needs more vault liquidity">🔒</span>' : ''}</span>
      <span class="ri-px mono">${fmtUsd(s.price)}</span>
      <span class="delta ri-d ${s.changePct >= 0 ? 'pos' : 'neg'}">${fmtPct(s.changePct)}</span>`;
    row.addEventListener('click', () => {
      if (isLocked(m.sym)) { toast(`🔒 ${m.sym} is locked · not enough vault liquidity yet`, 'muted'); return; }
      selectMarket(m.sym);
    });
    list.appendChild(row);
  }
  $('#railRate').textContent = (R * 100).toFixed(2) + '%';
  const rm = $('#railMult'); if (rm) rm.textContent = '×' + MULT;
}
function updateRail() {
  for (const m of BRAND.markets) {
    const s = feed.get(m.sym); const row = $(`.rail-item[data-sym="${m.sym}"]`); if (!row) continue;
    row.querySelector('.ri-px').textContent = fmtUsd(s.price);
    const d = row.querySelector('.ri-d'); d.textContent = fmtPct(s.changePct); d.className = 'delta ri-d ' + (s.changePct >= 0 ? 'pos' : 'neg');
    const locked = isLocked(m.sym);
    row.classList.toggle('locked', locked);
    const sy = row.querySelector('.ri-sym');
    sy.innerHTML = m.sym + (locked ? ' <span class="ri-lock" title="Needs more vault liquidity">🔒</span>' : '');
  }
}

function selectMarket(sym) {
  state.sym = sym;
  const spot = feed.get(sym).price;
  state.strike = roundTo(spot, strikeStep(spot));   // reset strike to ATM
  state.strikeLocked = false;                       // new market -> follow ATM again
  renderRail(); renderHeader(); populateTicketSelects(); renderChain(); renderTicket();
  if (!applyChartProvider()) loadChart();
}

/* ============================ RENDER: header + expiry ============================ */
function renderHeader() {
  const m = marketBySym(state.sym); const s = feed.get(state.sym);
  $('#mhSym').textContent = m.sym; $('#mhName').textContent = m.name;
  $('#mhSpot').textContent = fmtUsd(s.price);
  const d = $('#mhDelta'); d.textContent = fmtPct(s.changePct); d.className = 'delta ' + (s.changePct >= 0 ? 'pos' : 'neg');
}
function renderExpiryTabs() {
  const wrap = $('#expiryTabs'); wrap.innerHTML = '';
  for (const e of EXP) {
    const t = el('button', 'exp-tab' + (e.ms === state.expiry ? ' active' : ''), `${e.label}<span class="exp-d">${e.days}d</span>`);
    t.addEventListener('click', () => { state.expiry = e.ms; renderExpiryTabs(); populateTicketSelects(); renderChain(); renderTicket(); });
    wrap.appendChild(t);
  }
}

/* ============================ RENDER: chain ============================ */
function renderChain() {
  const s = feed.get(state.sym); const spot = s.price; const base = marketBySym(state.sym).iv;
  const T = yearsTo(state.expiry);
  const atm = roundTo(spot, strikeStep(spot));
  const body = $('#chainBody'); body.innerHTML = '';
  for (const K of ladder(spot)) {
    const civ = smileIv(base, spot, K), piv = smileIv(base, spot, K);
    const c = bs({ S: spot, K, T, r: R, vol: civ, type: 'call' });
    const p = bs({ S: spot, K, T, r: R, vol: piv, type: 'put' });
    const itmCall = K < spot, itmPut = K > spot;
    const isAtm = Math.abs(K - atm) < 1e-9;
    const sel = Math.abs(K - state.strike) < 1e-9;
    const tr = el('tr', 'crow' + (isAtm ? ' atm' : '') + (sel ? ' sel' : ''));
    tr.dataset.k = K;
    tr.innerHTML = `
      <td class="c call-cell ${itmCall ? 'itm' : ''}" data-type="call">${(c.price * EDGE).toFixed(2)}</td>
      <td class="c call-cell dim" data-type="call">${c.delta.toFixed(2)}</td>
      <td class="c call-cell dim" data-type="call">${(civ * 100).toFixed(0)}%</td>
      <td class="c strike">${K}</td>
      <td class="c put-cell dim" data-type="put">${(piv * 100).toFixed(0)}%</td>
      <td class="c put-cell dim" data-type="put">${p.delta.toFixed(2)}</td>
      <td class="c put-cell ${itmPut ? 'itm' : ''}" data-type="put">${(p.price * EDGE).toFixed(2)}</td>`;
    body.appendChild(tr);
  }
}
$('#chainBody').addEventListener('click', (e) => {
  const cell = e.target.closest('td[data-type]'); if (!cell) return;
  const K = parseFloat(cell.closest('tr').dataset.k);
  const type = cell.dataset.type;
  state.strike = K;
  state.strikeLocked = true;                        // user chose a strike
  const selling = state.side.startsWith('sell');
  state.side = (selling ? 'sell' : 'buy') + (type === 'call' ? 'Call' : 'Put');
  syncSideButtons(); populateTicketSelects(); renderChain(); renderTicket();
  // on stacked (mobile/tablet) layouts, jump to the ticket after picking a strike
  if (window.matchMedia('(max-width: 1100px)').matches) {
    document.querySelector('.ticket-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

/* ============================ RENDER: ticket ============================ */
function syncSideButtons() {
  $('#ticketSides').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.side === state.side));
}
function populateTicketSelects() {
  const spot = feed.get(state.sym).price;
  const sel = $('#ticketStrike'); sel.innerHTML = '';
  for (const K of ladder(spot)) {
    const o = el('option', null, K); o.value = K; if (Math.abs(K - state.strike) < 1e-9) o.selected = true; sel.appendChild(o);
  }
  if (state.strike == null || !ladder(spot).some((k) => Math.abs(k - state.strike) < 1e-9)) {
    state.strike = roundTo(spot, strikeStep(spot)); sel.value = state.strike;
  }
  const esel = $('#ticketExpiry'); esel.innerHTML = '';
  for (const e of EXP) { const o = el('option', null, `${e.label} · ${e.days}d`); o.value = e.ms; if (e.ms === state.expiry) o.selected = true; esel.appendChild(o); }
  $('#ticketQty').value = state.qty;
}

function legMetrics() {
  const s = feed.get(state.sym); const spot = s.price; const base = marketBySym(state.sym).iv;
  const T = yearsTo(state.expiry); const K = state.strike;
  const type = optType(state.side); const buy = isBuy(state.side);
  const iv = smileIv(base, spot, K);
  const o = bs({ S: spot, K, T, r: R, vol: iv, type });
  // buyers pay fair + edge; writers receive fair - edge (the spread is the house edge)
  const prem = o.price * (buy ? EDGE : Math.max(0, 2 - EDGE));
  const notional = state.qty * MULT;
  const cash = prem * notional;                         // paid (buy) or received (sell)
  const covered = isCovered(state.side);

  let maxProfit, maxLoss, collateral, breakeven, delta, note;
  let coveredEff = covered;
  const dir = buy ? 1 : -1;
  if (buy) {
    breakeven = type === 'call' ? K + prem : K - prem;
    maxLoss = cash;
    maxProfit = type === 'call' ? Infinity : Math.max(K - prem, 0) * notional;
    collateral = cash;
    delta = o.delta * notional;
    note = 'Long premium · defined risk';
  } else if (type === 'put') {                          // cash-secured short put
    breakeven = K - prem;
    maxProfit = cash;
    maxLoss = Math.max(K - prem, 0) * notional;
    collateral = K * notional;                          // cash securing assignment
    delta = -o.delta * notional;
    note = 'Cash-secured · collateral in USDC';
  } else {                                              // covered call (long underlying + short call)
    breakeven = spot - prem;
    maxProfit = (K - spot + prem) * notional;           // called away at strike
    maxLoss = (spot - prem) * notional;                 // underlying to zero — finite
    collateral = spot * notional;                       // underlying held
    delta = (1 - o.delta) * notional;                   // long stock (1) minus short call
    note = 'Covered call · collateral in underlying';
  }
  // On-chain writing is a cash-collateralized CAPPED short (same for calls & puts):
  // post strike*qty, keep the premium, max loss capped at the strike width.
  if (oc.isEnabled() && !buy) {
    collateral = K * notional;                          // matches the contract's posted collateral
    maxProfit = cash;                                   // premium received
    maxLoss = Math.max(K - prem, 0) * notional;         // capped, not "to zero"
    breakeven = type === 'call' ? K + prem : K - prem;
    coveredEff = false;
    note = `Short · capped · ${oc.collateralSymbol()} collateral`;
  }
  return {
    spot, T, K, type, buy, covered: coveredEff, iv, prem, notional, cash, breakeven, maxProfit, maxLoss, collateral, note,
    entrySpot: spot,
    delta,
    theta: o.theta * notional * dir,                    // stock has no theta/vega
    vega: o.vega * notional * dir,
    gamma: o.gamma * notional * dir,
  };
}

function renderTicket() {
  const m = legMetrics();
  const inf = (v, d = 2) => v === Infinity ? 'Unlimited' : fmtUsd(v, d);
  const rows = [
    ['Premium / contract', fmtUsd(m.prem)],
    [m.buy ? 'Total cost' : 'Credit received', fmtUsd(m.cash)],
    ['Breakeven', fmtUsd(m.breakeven)],
    ['Max profit', m.maxProfit === Infinity ? 'Unlimited' : fmtUsd(m.maxProfit), m.maxProfit === Infinity ? '' : 'up'],
    ['Max loss', inf(m.maxLoss), 'down'],
    ['Collateral required', fmtUsd(m.collateral)],
  ];
  const box = $('#ticketMetrics'); box.innerHTML = '';
  for (const [l, v, cls] of rows) {
    box.appendChild(el('div', 'tm-row', `<span class="tm-l">${l}</span><span class="tm-v ${cls || ''}">${v}</span>`));
  }
  // greeks
  const g = el('div', 'tm-greeks',
    `<span>Δ <b>${m.delta.toFixed(1)}</b></span><span>Θ <b>${m.theta.toFixed(1)}</b></span><span>V <b>${m.vega.toFixed(1)}</b></span>`);
  box.appendChild(g);

  $('#payoffBE').textContent = 'BE ' + fmtUsd(m.breakeven);
  const btn = $('#placeBtn');
  btn.textContent = (m.buy ? 'Buy ' : 'Sell ') + state.qty + ' ' + state.sym + ' ' + m.K + ' ' + (m.type === 'call' ? 'Call' : 'Put');

  // On-chain: the vault must be able to lock a buyer's collateral / pay a
  // writer's premium. If it can't, warn and block BEFORE a failing tx.
  let note = oc.isEnabled() ? `◆ Live on-chain · ${oc.collateralSymbol()} collateral` : m.note;
  btn.disabled = false; btn.classList.remove('disabled');
  if (oc.isEnabled() && ocFreeLiq != null) {
    // what the VAULT must set aside: a buy locks strike*qty of its own funds;
    // a sell pays the writer's premium out of its free liquidity.
    const need = m.buy ? (m.K * m.notional) : m.cash;
    if (need > ocFreeLiq + 1e-6) {
      const maxContracts = Math.floor(ocFreeLiq / (need / state.qty));
      note = maxContracts >= 1
        ? `⚠ Vault covers up to ${maxContracts} contract${maxContracts > 1 ? 's' : ''} here. Lower the size or pick a cheaper stock.`
        : `⚠ Not enough vault liquidity for this trade. Pick a cheaper stock.`;
      btn.disabled = true; btn.classList.add('disabled');
    }
  }
  $('#ticketNote').textContent = note;
  drawPayoff(m);
}

/* ============================ payoff canvas ============================ */
function drawPayoff(m) {
  const cv = $('#payoff'); const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 300, H = 150;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);

  const spot = m.spot;
  // Puts and covered calls carry exposure all the way to zero — extend the
  // domain so the plateau that defines max profit/loss is actually drawn.
  const toZero = m.type === 'put' || m.covered;
  const lo = toZero ? 0.01 : Math.max(0.01, Math.min(spot, m.K) * 0.7);
  const hi = Math.max(spot, m.K) * 1.3;
  const pnl = (ST) => pnlAtExpiry(state.side, m.K, m.prem, m.entrySpot, m.notional, ST);
  const N = 120; const xs = [], ys = [];
  for (let i = 0; i <= N; i++) { const ST = lo + (hi - lo) * i / N; xs.push(ST); ys.push(pnl(ST)); }
  let maxAbs = Math.max(...ys.map(Math.abs), m.cash); maxAbs *= 1.15 || 1;
  const X = (v) => ((v - lo) / (hi - lo)) * W;
  const Y = (v) => H / 2 - (v / maxAbs) * (H / 2 - 8);

  // zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();

  // profit / loss fills
  const drawFill = (sign, color) => {
    ctx.beginPath(); ctx.moveTo(X(xs[0]), Y(0));
    for (let i = 0; i <= N; i++) { const y = sign > 0 ? Math.min(Y(ys[i]), Y(0)) : Math.max(Y(ys[i]), Y(0)); ctx.lineTo(X(xs[i]), y); }
    ctx.lineTo(X(xs[N]), Y(0)); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  };
  drawFill(1, 'rgba(47,224,160,0.14)');
  drawFill(-1, 'rgba(255,93,110,0.12)');

  // curve
  ctx.beginPath();
  for (let i = 0; i <= N; i++) { const x = X(xs[i]), y = Y(ys[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#57ebd0';
  ctx.lineWidth = 2; ctx.stroke();

  // breakeven marker
  if (m.breakeven > lo && m.breakeven < hi) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(m.breakeven), 0); ctx.lineTo(X(m.breakeven), H); ctx.stroke(); ctx.setLineDash([]);
  }
  // spot marker
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X(spot), 0); ctx.lineTo(X(spot), H); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillText('spot', X(spot) + 4, 12);
}

/* ============================ place order + positions ============================ */
async function placeOrder() {
  if (oc.isEnabled()) return placeOrderOnchain();
  if (!wallet.get().connected) { await doConnect(); if (!wallet.get().connected) return; }
  if (!(await wallet.gateOk())) { toast(`Hold $${BRAND.ticker} to trade`, 'down'); return; }
  const m = legMetrics();
  const pos = {
    id: 'p' + Date.now() + Math.floor(Math.random() * 1000),
    sym: state.sym, side: state.side, K: m.K, expiry: state.expiry, qty: state.qty,
    entryPrem: m.prem, entrySpot: m.spot, ts: Date.now(),
  };
  state.positions.unshift(pos); savePositions(); renderPositions();
  toast(`${m.buy ? 'Bought' : 'Sold'} ${state.qty} ${state.sym} ${m.K} ${m.type === 'call' ? 'Call' : 'Put'} @ ${fmtUsd(m.prem)}`, 'up');
}

/* ---------- on-chain trading (active only when onchain-config is enabled) ---------- */
const HASH2SYM = {};
function buildHashMap() {
  if (!window.ethers) return;
  for (const m of BRAND.markets) HASH2SYM[window.ethers.id(m.sym).toLowerCase()] = m.sym;
}
async function placeOrderOnchain() {
  const m = legMetrics();
  const label = `${state.sym} ${m.K} ${m.type === 'call' ? 'Call' : 'Put'}`;
  try {
    if (!oc.isConnected()) await oc.connect();
    if ((await oc.usdBalance()) <= 0) {
      if (oc.hasFaucet()) { toast('Minting test USD (faucet)…', 'muted'); await oc.faucet(); }
      else { toast(`You need ${oc.collateralSymbol()} in your wallet to trade`, 'down'); return; }
    }
    toast('Confirm in your wallet…', 'muted');
    const exp = Math.floor(state.expiry / 1000);
    if (m.buy) {
      const hash = await oc.buyOption(state.sym, m.type === 'call', m.K, exp, state.qty, 0.05);
      toast(`Bought ${state.qty} ${label} · tx ${hash.slice(0, 10)}…`, 'up');
    } else {
      const hash = await oc.sellOption(state.sym, m.type === 'call', m.K, exp, state.qty, 0.05);
      toast(`Sold ${state.qty} ${label} · tx ${hash.slice(0, 10)}…`, 'up');
    }
    await refreshOnchain();
    await refreshLiquidity();
  } catch (e) {
    toast('Trade failed: ' + (e.shortMessage || e.message || 'error'), 'down');
  }
}
let liqInitDone = false;
async function refreshLiquidity() {
  const free = await oc.freeLiquidity();
  if (free == null) return;
  ocFreeLiq = free;
  const anyLocked = BRAND.markets.some((m) => isLocked(m.sym));
  const note = $('#railNote'); if (note) note.hidden = !anyLocked;
  updateRail();                              // lock/unlock markets as liquidity changes
  // on first load, if the selected market is locked, jump to a tradeable one
  if (!liqInitDone) {
    liqInitDone = true;
    if (isLocked(state.sym)) {
      const affordable = BRAND.markets.find((m) => !isLocked(m.sym));
      if (affordable) selectMarket(affordable.sym);
    }
  }
  renderTicket();
}
async function refreshOnchain() {
  if (!oc.isEnabled() || !oc.isConnected()) return;
  try {
    const positions = await oc.myPositions();
    renderOnchainPositions(positions);
    let pnl = 0, collat = 0;
    for (const p of positions) { pnl += p.short ? (p.entryPremium - p.mark) : (p.mark - p.entryPremium); collat += p.collateral; }
    $('#sumOpen').textContent = positions.length;
    $('#sumCollat').textContent = fmtUsd(collat);
    $('#sumDelta').textContent = '—';
    const pe = $('#sumPnl'); pe.textContent = (pnl >= 0 ? '+' : '') + fmtUsd(pnl); pe.className = 'ps-v ' + (pnl >= 0 ? 'up' : 'down');
  } catch (_) { /* transient RPC errors ignored */ }
}
function renderOnchainPositions(positions) {
  const body = $('#posBody');
  if (!positions.length) {
    body.innerHTML = '<tr class="pos-empty"><td colspan="10">No open positions. Click a strike in the chain to build a trade.</td></tr>';
    return;
  }
  body.innerHTML = '';
  for (const p of positions) {
    const sym = HASH2SYM[p.symbolHash] || '—';
    // long buyer P/L = mark - premium paid; short writer P/L = premium received - mark
    const pnl = p.short ? (p.entryPremium - p.mark) : (p.mark - p.entryPremium);
    const daysLeft = Math.max(0, Math.round((p.expiry - Date.now()) / 86400000));
    const tr = el('tr', 'prow');
    tr.innerHTML = `
      <td class="p-sym">${sym}</td>
      <td class="${p.short ? 'down' : 'up'}">${p.short ? 'Short' : 'Long'} ${p.isCall ? 'Call' : 'Put'}</td>
      <td>${p.strike}</td><td class="p-exp">${daysLeft}d</td><td>${p.qty}</td>
      <td>${fmtUsd(p.entryPremium)}</td><td class="p-mark">${fmtUsd(p.mark)}</td>
      <td class="p-value">${fmtUsd(p.mark)}</td>
      <td class="p-pnl ${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : ''}${fmtUsd(pnl)}</td>
      <td><button class="close-x" data-id="${p.id}" title="Close">✕</button></td>`;
    body.appendChild(tr);
  }
}

function posMark(pos) {
  const s = feed.get(pos.sym); const spot = s.price; const base = marketBySym(pos.sym).iv;
  const T = yearsTo(pos.expiry); const type = optType(pos.side); const buy = isBuy(pos.side);
  const covered = isCovered(pos.side);
  const iv = smileIv(base, spot, pos.K);
  const o = bs({ S: spot, K: pos.K, T, r: R, vol: iv, type });
  const mark = o.price;
  const notional = pos.qty * MULT;
  const entrySpot = pos.entrySpot ?? spot;

  let pnl, delta, collateral;
  if (buy) {
    pnl = (mark - pos.entryPrem) * notional;
    delta = o.delta * notional;
    collateral = pos.entryPrem * notional;
  } else if (type === 'put') {                                   // cash-secured short put
    pnl = (pos.entryPrem - mark) * notional;
    delta = -o.delta * notional;
    collateral = pos.K * notional;
  } else {                                                       // covered call: option leg + underlying
    pnl = (pos.entryPrem - mark) * notional + (spot - entrySpot) * notional;
    delta = (1 - o.delta) * notional;
    collateral = spot * notional;
  }
  const daysLeft = Math.max(0, Math.round(T * 365));
  return { spot, type, buy, covered, mark, notional, pnl, delta, collateral, daysLeft, value: mark * notional };
}

/* Full rebuild — only on add / remove so the close button stays stable. */
function renderPositions() {
  const body = $('#posBody');
  if (!state.positions.length) {
    body.innerHTML = '<tr class="pos-empty"><td colspan="10">No open positions. Click a strike in the chain to build a trade.</td></tr>';
    updateSummary(); return;
  }
  body.innerHTML = '';
  for (const pos of state.positions) {
    const mk = posMark(pos);
    const label = (mk.buy ? 'Long ' : 'Short ') + (mk.type === 'call' ? 'Call' : 'Put');
    const tr = el('tr', 'prow'); tr.dataset.id = pos.id;
    tr.innerHTML = `
      <td class="p-sym">${pos.sym}</td>
      <td class="${mk.buy ? 'up' : 'down'}">${label}</td>
      <td>${pos.K}</td>
      <td class="p-exp">${mk.daysLeft}d</td>
      <td>${pos.qty}</td>
      <td>${fmtUsd(pos.entryPrem)}</td>
      <td class="p-mark">${fmtUsd(mk.mark)}</td>
      <td class="p-value">${fmtUsd(mk.value)}</td>
      <td class="p-pnl ${mk.pnl >= 0 ? 'up' : 'down'}">${mk.pnl >= 0 ? '+' : ''}${fmtUsd(mk.pnl)}</td>
      <td><button class="close-x" data-id="${pos.id}" title="Close">✕</button></td>`;
    body.appendChild(tr);
  }
  updateSummary();
}

/* In-place value refresh on every tick — no DOM churn, close button survives. */
function updatePositionsLive() {
  if (!state.positions.length) return;
  for (const pos of state.positions) {
    const tr = $(`.prow[data-id="${pos.id}"]`); if (!tr) continue;
    const mk = posMark(pos);
    tr.querySelector('.p-exp').textContent = mk.daysLeft + 'd';
    tr.querySelector('.p-mark').textContent = fmtUsd(mk.mark);
    tr.querySelector('.p-value').textContent = fmtUsd(mk.value);
    const pe = tr.querySelector('.p-pnl');
    pe.textContent = (mk.pnl >= 0 ? '+' : '') + fmtUsd(mk.pnl);
    pe.className = 'p-pnl ' + (mk.pnl >= 0 ? 'up' : 'down');
  }
  updateSummary();
}
$('#posBody').addEventListener('click', async (e) => {
  const x = e.target.closest('.close-x'); if (!x) return;
  if (oc.isEnabled()) {
    try { toast('Confirm close in your wallet…', 'muted'); const hash = await oc.close(x.dataset.id); toast('Closed · tx ' + hash.slice(0, 10) + '…', 'up'); await refreshOnchain(); }
    catch (err) { toast('Close failed: ' + (err.shortMessage || err.message || 'error'), 'down'); }
    return;
  }
  const id = x.dataset.id; const pos = state.positions.find((p) => p.id === id);
  if (pos) { const mk = posMark(pos); toast(`Closed ${pos.sym} ${pos.K} — realized ${mk.pnl >= 0 ? '+' : ''}${fmtUsd(mk.pnl)}`, mk.pnl >= 0 ? 'up' : 'down'); }
  state.positions = state.positions.filter((p) => p.id !== id); savePositions(); renderPositions();
});

function updateSummary() {
  let collat = 0, delta = 0, pnl = 0;
  for (const pos of state.positions) { const mk = posMark(pos); collat += mk.collateral; delta += mk.delta; pnl += mk.pnl; }
  $('#sumOpen').textContent = state.positions.length;
  $('#sumCollat').textContent = fmtUsd(collat);
  $('#sumDelta').textContent = delta.toFixed(1);
  const pe = $('#sumPnl'); pe.textContent = (pnl >= 0 ? '+' : '') + fmtUsd(pnl); pe.className = 'ps-v ' + (pnl >= 0 ? 'up' : 'down');
}

/* ============================ wallet + feed status ============================ */
function pickWallet(wallets) {
  return new Promise((resolve) => {
    const overlay = el('div', 'wallet-modal');
    const card = el('div', 'wallet-card');
    card.innerHTML = '<div class="wallet-head"><span>Connect a wallet</span><button class="wallet-x" aria-label="Close">✕</button></div>';
    const list = el('div', 'wallet-list');
    wallets.forEach((w) => {
      const b = el('button', 'wallet-item');
      b.innerHTML = `${w.info.icon ? `<img src="${w.info.icon}" alt="" width="26" height="26"/>` : '<span class="wallet-dot"></span>'}<span>${w.info.name}</span>`;
      b.addEventListener('click', () => { cleanup(); resolve(w); });
      list.appendChild(b);
    });
    card.appendChild(list);
    if (!wallets.length) list.innerHTML = '<p class="wallet-empty">No wallet detected. Install MetaMask, Coinbase Wallet, Rabby or Trust and reload.</p>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('in'));
    const cleanup = () => { overlay.classList.remove('in'); setTimeout(() => overlay.remove(), 200); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(null); } });
    card.querySelector('.wallet-x').addEventListener('click', () => { cleanup(); resolve(null); });
  });
}

async function doConnect() {
  if (oc.isEnabled()) {
    try {
      const wallets = oc.listWallets();
      const chosen = wallets.length === 1 ? wallets[0] : await pickWallet(wallets);
      if (!chosen) return;
      toast(`Connecting ${chosen.info.name}…`, 'muted');
      const addr = await oc.connect(chosen.provider);
      const btn = $('#connectBtn');
      btn.textContent = addr.slice(0, 6) + '…' + addr.slice(-4);
      btn.classList.add('connected');
      toast('Wallet connected · Robinhood Chain', 'up');
      await refreshOnchain();
    } catch (e) { toast('Connect failed: ' + (e.shortMessage || e.message || 'error'), 'down'); }
    return;
  }
  const w = await wallet.connect();
  const btn = $('#connectBtn');
  btn.textContent = w.short + (w.demo ? ' · demo' : '');
  btn.classList.add('connected');
  if (w.demo) toast('Demo wallet connected (no injected wallet found)', 'muted');
  else toast('Wallet connected', 'up');
}
$('#connectBtn').addEventListener('click', () => { if (oc.isEnabled() ? oc.isConnected() : wallet.get().connected) return; doConnect(); });

function updateFeedStatus() {
  const dot = $('#feedDot'), lbl = $('#feedLabel');
  if (feed.mode === 'live') { dot.className = 'feed-dot live'; lbl.textContent = 'Live oracle feed'; }
  else { dot.className = 'feed-dot sim'; lbl.textContent = 'Simulated feed · live on deploy'; }
}

/* ============================ ticket controls ============================ */
$('#ticketSides').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.side = b.dataset.side; syncSideButtons(); renderChain(); renderTicket();
});
$('#ticketStrike').addEventListener('change', (e) => { state.strike = parseFloat(e.target.value); state.strikeLocked = true; renderChain(); renderTicket(); });
$('#ticketExpiry').addEventListener('change', (e) => { state.expiry = parseFloat(e.target.value); renderExpiryTabs(); renderChain(); renderTicket(); });
$('#ticketQty').addEventListener('input', (e) => { state.qty = Math.max(1, parseInt(e.target.value) || 1); renderTicket(); });
$('#qtyMinus').addEventListener('click', () => { state.qty = Math.max(1, state.qty - 1); $('#ticketQty').value = state.qty; renderTicket(); });
$('#qtyPlus').addEventListener('click', () => { state.qty += 1; $('#ticketQty').value = state.qty; renderTicket(); });
// Spend-by-amount: type a USDG budget -> contracts = floor(budget / premium-per-contract)
function sizeByBudget() {
  const budget = parseFloat($('#ticketBudget').value);
  if (!(budget > 0)) return;
  const per = legMetrics().prem;                         // USDG per contract (incl. house edge)
  if (per > 0) { state.qty = Math.max(1, Math.floor(budget / per)); $('#ticketQty').value = state.qty; renderTicket(); }
}
$('#ticketBudget').addEventListener('input', sizeByBudget);
$('#placeBtn').addEventListener('click', placeOrder);

/* ============================ toast ============================ */
let toastTimer;
function toast(msg, kind) {
  const host = $('#toastHost');
  const t = el('div', 'toast ' + (kind || ''), msg);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2600);
}

/* ============================ boot ============================ */
/* ---- network switch (Mainnet real USDG ⇄ Testnet free) ---- */
function initNetSwitch() {
  const sw = $('#netSwitch'); if (!sw) return;
  const active = activeNetwork();
  sw.querySelectorAll('.net-opt').forEach((b) => {
    const net = b.dataset.net;
    b.classList.toggle('active', net === active);
    b.disabled = !(NETWORKS[net] && NETWORKS[net].enabled);
    b.title = net === 'mainnet' ? 'Mainnet · real USDG' : 'Testnet · free test money (faucet)';
    b.addEventListener('click', () => {
      if (net === activeNetwork()) return;
      setNetwork(net);
      location.reload();                      // reload swaps the active ONCHAIN config
    });
  });
}

function boot() {
  initNetSwitch();
  // Spend box currency label reflects the active collateral token
  const budgetInput = $('#ticketBudget'); if (budgetInput) budgetInput.nextElementSibling.textContent = oc.isEnabled() ? oc.collateralSymbol() : 'USDG';
  if (oc.isEnabled()) {
    $('#ticketSides').querySelectorAll('button[data-write]').forEach((b) =>
      b.title = 'Write (sell) to the vault: post collateral, receive premium.');
  }
  const spot = feed.get(state.sym).price;
  state.strike = roundTo(spot, strikeStep(spot));
  renderRail(); renderHeader(); renderExpiryTabs(); syncSideButtons();
  populateTicketSelects(); renderChain(); renderTicket(); updateFeedStatus();
  if (!applyChartProvider()) loadChart();
  if (oc.isEnabled()) {
    buildHashMap();
    renderOnchainPositions([]);            // real positions load from chain after wallet connect
    setInterval(refreshOnchain, 12000);    // keep marks fresh from the oracle
    refreshLiquidity();                    // load vault liquidity for the ticket check
    setInterval(refreshLiquidity, 30000);
  } else {
    renderPositions();                     // demo (localStorage) positions
  }
}
boot();

feed.onTick(() => {
  // until the user picks a strike, keep the ticket centered on the at-the-money
  // strike (fixes a stale in-the-money default after the seed -> live spot jump)
  if (!state.strikeLocked) {
    const atm = atmOf(state.sym);
    if (Math.abs(atm - state.strike) > 1e-9) { state.strike = atm; populateTicketSelects(); }
  }
  updateFeedStatus(); updateRail(); renderHeader(); renderChain(); renderTicket();
  if (!oc.isEnabled()) updatePositionsLive();     // demo marks; on-chain uses refreshOnchain timer
  chart.setLast(feed.get(state.sym).price);       // live chart edge
});

window.addEventListener('resize', () => renderTicket());
