/* Landing page interactivity: live ticker strip, market grid + sparklines,
   live hero mini-chain, FAQ, scroll reveals. */
import { BRAND, fmtUsd, fmtPct } from './config.js';
import { applyBrand } from './brand.js';
import { feed } from './feed.js';
import { bs, smileIv, yearsTo } from './bs.js';

applyBrand();
feed.start();

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const strikeStep = (spot) => spot < 50 ? 1 : spot < 200 ? 2.5 : spot < 500 ? 5 : 10;
const roundTo = (v, step) => Math.round(v / step) * step;
const previewExpiry = Date.now() + 32 * 24 * 3600 * 1000;   // ~ next monthly

/* ---------- nav ticker (cycles symbols) ---------- */
let navIdx = 0;
function updateNavTicker() {
  const sym = BRAND.tickerSymbols[navIdx % BRAND.tickerSymbols.length];
  const s = feed.get(sym); if (!s) return;
  const up = s.changePct >= 0;
  $('#navTickerText').innerHTML = `${sym} ${fmtUsd(s.price)} <span class="delta ${up ? 'pos' : 'neg'}">${fmtPct(s.changePct)}</span>`;
  $('#navTicker .dot').style.background = up ? 'var(--up)' : 'var(--down)';
  $('#navTicker .dot').style.boxShadow = `0 0 8px ${up ? 'var(--up)' : 'var(--down)'}`;
}
setInterval(() => { navIdx++; updateNavTicker(); }, 3200);

/* ---------- hero live mini-chain ---------- */
const PREVIEW_SYM = 'WIF';
function renderPreview() {
  const s = feed.get(PREVIEW_SYM); if (!s) return;
  const spot = s.price;
  $('#prevSym').textContent = PREVIEW_SYM;
  $('#prevName').textContent = `${s.name} · ${new Date(previewExpiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  $('#prevSpot').textContent = fmtUsd(spot);
  const up = s.changePct >= 0;
  const d = $('#prevDelta'); d.textContent = fmtPct(s.changePct); d.className = 'delta ' + (up ? 'pos' : 'neg');

  const step = strikeStep(spot);
  const atm = roundTo(spot, step);
  const T = yearsTo(previewExpiry);
  const body = $('#prevChain');
  body.innerHTML = '';
  for (let i = 2; i >= -2; i--) {
    const K = atm + i * step;
    if (K <= 0) continue;
    const civ = smileIv(s.iv, spot, K), piv = smileIv(s.iv, spot, K);
    const call = bs({ S: spot, K, T, r: BRAND.riskFreeRate, vol: civ, type: 'call' }).price;
    const put = bs({ S: spot, K, T, r: BRAND.riskFreeRate, vol: piv, type: 'put' }).price;
    const isAtm = Math.abs(K - atm) < 1e-6;
    const row = el('div', 'crow' + (isAtm ? ' atm' : ''),
      `<span class="c-call">${call.toFixed(2)}</span><span class="c-strike">${K}</span><span class="c-put">${put.toFixed(2)}</span>`);
    body.appendChild(row);
  }
  const dot = $('#prevFeedDot'), lbl = $('#prevFeed');
  if (feed.mode === 'live') { dot.className = 'feed-dot live'; lbl.textContent = 'Live oracle feed'; }
  else { dot.className = 'feed-dot sim'; lbl.textContent = 'Simulated feed · live on deploy'; }
}

/* ---------- market grid + sparklines ---------- */
const history = {};
const HISTLEN = 40;
function pushHist(sym, px) { (history[sym] ||= []).push(px); if (history[sym].length > HISTLEN) history[sym].shift(); }
function sparkPath(vals, w = 132, h = 30) {
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
  return vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - ((v - min) / rng) * (h - 4) - 2).toFixed(1)}`).join(' ');
}
const grid = $('#marketGrid');
function buildGrid() {
  grid.innerHTML = '';
  for (const m of BRAND.markets) {
    const s = feed.get(m.sym);
    const card = el('a', 'mkt');
    card.href = `app.html?sym=${m.sym}`;
    card.dataset.sym = m.sym;
    card.innerHTML = `
      <div class="mkt-top">
        <div><div class="mkt-sym">${m.sym}</div><div class="mkt-name">${m.name}</div></div>
        <div class="delta pos js-delta">+0.00%</div>
      </div>
      <div class="mkt-spot js-spot">${fmtUsd(s.price)}</div>
      <svg class="spark" viewBox="0 0 132 30" preserveAspectRatio="none"><polyline class="js-spark" fill="none" stroke="var(--accent)" stroke-width="1.5" points=""/></svg>
      <div class="mkt-bot"><span class="mkt-iv">IV ${(m.iv * 100).toFixed(0)}%</span><span class="muted">Trade →</span></div>`;
    grid.appendChild(card);
  }
}
function updateGrid() {
  for (const m of BRAND.markets) {
    const s = feed.get(m.sym); if (!s) continue;
    pushHist(m.sym, s.price);
    const card = grid.querySelector(`[data-sym="${m.sym}"]`); if (!card) continue;
    card.querySelector('.js-spot').textContent = fmtUsd(s.price);
    const up = s.changePct >= 0;
    const d = card.querySelector('.js-delta');
    d.textContent = fmtPct(s.changePct); d.className = 'delta js-delta ' + (up ? 'pos' : 'neg');
    const poly = card.querySelector('.js-spark');
    poly.setAttribute('points', sparkPath(history[m.sym]));
    poly.setAttribute('stroke', up ? 'var(--up)' : 'var(--down)');
  }
}

/* ---------- FAQ ---------- */
const FAQ = [
  ['What exactly am I trading?', 'Options on tokenized stocks — ERC-20 tokens that track real equities like WIF or SPY via on-chain oracle price feeds. You trade standard calls and puts designed to cash-settle to the oracle price at expiry.'],
  ['Where does my collateral go?', 'By design, into the protocol’s settlement contract: long premium and short collateral are locked on-chain and never rehypothecated or lent out. This interface is a working preview — pricing and payoffs are real, and the settlement contracts go live on deploy.'],
  ['How is a fair price determined?', 'Premiums are quoted from a live pricing engine — Black-Scholes with a per-name volatility surface — referencing the oracle spot. What you see in the chain is exactly what the ticket and payoff price against.'],
  ['Do I need to be online at expiry?', 'No. Contracts are designed to cash-settle automatically against the oracle at expiry, so there is no manual exercise and no assignment surprises.'],
  ['What are the risks?', 'Options can expire worthless — a long can lose 100% of premium, and a short writer can be assigned. This is unaudited, experimental software. Trade only what you can afford to lose, and never treat anything here as financial advice.'],
  ['Who can use it?', `Anyone with a wallet, except persons in restricted jurisdictions (currently ${BRAND.excluded.join(', ')}). By connecting a wallet you confirm you are not in a restricted region.`],
];
function buildFaq() {
  const list = $('#faqList');
  FAQ.forEach(([q, a]) => {
    const item = el('div', 'faq-item');
    item.innerHTML = `<button class="faq-q" aria-expanded="false">${q}<span class="plus" aria-hidden="true">+</span></button><div class="faq-a"><p>${a}</p></div>`;
    const btn = item.querySelector('.faq-q'), ans = item.querySelector('.faq-a');
    btn.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      ans.style.maxHeight = open ? ans.scrollHeight + 'px' : '0';
    });
    list.appendChild(item);
  });
}

/* ---------- background video autoplay (robust across browsers) ---------- */
function initSiteVideo() {
  const v = document.querySelector('.site-bg video');
  if (!v) return;
  v.muted = true; v.playsInline = true;
  const tryPlay = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
  tryPlay();
  ['pointerdown', 'touchstart', 'scroll', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, tryPlay, { once: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tryPlay(); });
}

/* ---------- reveal + nav scroll ---------- */
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((n) => io.observe(n));
}
function initNav() {
  const shell = $('.nav-shell');
  const on = () => shell.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', on, { passive: true }); on();

  // mobile menu
  const btn = $('#navMenuBtn'), links = $('.nav-links');
  if (btn && links) {
    btn.addEventListener('click', () => {
      const open = shell.classList.toggle('menu-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') { shell.classList.remove('menu-open'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }
}

// Recompute open FAQ answer heights on resize so long answers keep fitting.
window.addEventListener('resize', () => {
  document.querySelectorAll('.faq-item.open .faq-a').forEach((a) => { a.style.maxHeight = a.scrollHeight + 'px'; });
});

/* ---------- boot ---------- */
buildGrid(); buildFaq(); initReveal(); initNav(); initSiteVideo();
renderPreview(); updateNavTicker(); updateGrid();

let last = 0;
feed.onTick(() => {
  renderPreview(); updateGrid();
  const now = performance.now();
  if (now - last > 3000) { last = now; }   // nav ticker cycles on its own timer
});
