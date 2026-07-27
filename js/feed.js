/* =============================================================================
   PRICE FEED
   Single source of truth for live spot prices, shared by the landing ticker
   and the terminal.
     • On deploy: polls /api/prices (real quotes, server-side, no CORS).
     • Locally / on failure: a mean-reverting random walk seeded from config,
       flagged mode='sim' so the UI can label it honestly.
   Subscribe with feed.onTick(cb). Read a symbol with feed.get(sym).
   ========================================================================== */
import { BRAND } from './config.js';

function gauss() { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class Feed {
  constructor() {
    this.state = {};
    this.subs = new Set();
    this.mode = 'sim';           // 'live' once /api/prices answers
    this.started = false;
    for (const m of BRAND.markets) {
      const openChg = (Math.random() - 0.45) * m.iv * 0.06;   // synthetic day move
      const prevClose = m.baseSpot / (1 + openChg);
      this.state[m.sym] = {
        sym: m.sym, name: m.name, iv: m.iv,
        price: m.baseSpot, prevClose,
        change: m.baseSpot - prevClose,
        changePct: openChg * 100,
      };
    }
  }

  get(sym) { return this.state[sym]; }
  all() { return Object.values(this.state); }
  onTick(cb) { this.subs.add(cb); return () => this.subs.delete(cb); }
  _emit() { for (const cb of this.subs) try { cb(this.state, this.mode); } catch (e) { /* noop */ } }

  start() {
    if (this.started) return;
    this.started = true;
    this._poll();                                  // try real data immediately
    this._pollTimer = setInterval(() => this._poll(), 15000);
    this._tick = setInterval(() => this._walk(), 1500);
    this._walk();
  }

  _walk() {
    if (this.mode === 'live') return;   // never fabricate over real quotes
    for (const m of BRAND.markets) {
      const s = this.state[m.sym];
      const sigma = m.iv * 0.0016;                  // per-tick vol (demo-scaled)
      const revert = (m.baseSpot - s.price) / m.baseSpot * 0.02;  // gentle pull to seed
      s.price = Math.max(0.01, s.price * (1 + sigma * gauss() + revert));
      s.change = s.price - s.prevClose;
      s.changePct = (s.change / s.prevClose) * 100;
    }
    this._emit();
  }

  async _poll() {
    try {
      const syms = BRAND.markets.map((m) => m.sym).join(',');
      const res = await fetch(`/api/prices?symbols=${syms}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('no api');
      const data = await res.json();
      if (!data || !data.quotes) throw new Error('bad shape');
      let got = 0;
      for (const q of data.quotes) {
        const s = this.state[q.symbol];
        if (!s || q.price == null) continue;
        s.price = q.price;
        if (q.prevClose) s.prevClose = q.prevClose;
        s.change = s.price - s.prevClose;
        s.changePct = (s.change / s.prevClose) * 100;
        got++;
      }
      if (got) { this.mode = 'live'; this._emit(); }
    } catch (_) {
      this.mode = 'sim';   // stay on the simulator; never throws to the UI
    }
  }
}

export const feed = new Feed();
