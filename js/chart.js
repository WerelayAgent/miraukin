/* =============================================================================
   PRICE CHART — GMGN-style candlesticks + volume, with hover crosshair.
   Pure renderer: createPriceChart(canvas) -> { setData, setLast, draw }.
   setData(candles) where candles = [{ t: unixSeconds, o, h, l, c, v }].
   ========================================================================== */

const PAD_R = 58, PAD_L = 4, PAD_T = 8, PAD_B = 16;

export function createPriceChart(canvas) {
  const ctx = canvas.getContext('2d');
  let candles = [], hoverIdx = -1;
  const css = (v, f) => (getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f);

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 160;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  const fmt = (c) => '$' + (c < 10 ? c.toFixed(2) : c < 1000 ? c.toFixed(1) : c.toFixed(0));
  const fmtV = (v) => v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v | 0);
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    const { w, h } = size();
    ctx.clearRect(0, 0, w, h);
    if (candles.length < 2) return;

    const up = css('--up', '#2fe0a0'), down = css('--down', '#ff5d6e');
    const innerW = w - PAD_R - PAD_L, innerH = h - PAD_T - PAD_B;
    const volH = Math.max(18, innerH * 0.16), gap = 6;
    const priceH = innerH - volH - gap;
    const priceTop = PAD_T, priceBot = PAD_T + priceH;
    const volTop = priceBot + gap, volBot = volTop + volH;

    let min = Infinity, max = -Infinity, vmax = 0;
    for (const k of candles) { if (k.l < min) min = k.l; if (k.h > max) max = k.h; if (k.v > vmax) vmax = k.v; }
    const rng = (max - min) || 1; min -= rng * 0.06; max += rng * 0.06;
    const n = candles.length;
    const slot = innerW / n;
    const bodyW = Math.max(1, Math.min(slot * 0.66, 16));
    const X = (i) => PAD_L + slot * (i + 0.5);
    const Y = (p) => priceTop + (1 - (p - min) / (max - min)) * priceH;
    const VY = (v) => volBot - (v / (vmax || 1)) * volH;

    // horizontal price grid + labels
    ctx.font = '10px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const p = min + (max - min) * i / 4, y = Y(p);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + innerW, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.34)'; ctx.textAlign = 'left';
      ctx.fillText(fmt(p), PAD_L + innerW + 6, y);
    }

    // volume bars
    for (let i = 0; i < n; i++) {
      const k = candles[i], x = X(i);
      ctx.fillStyle = (k.c >= k.o ? up : down) + '';
      ctx.globalAlpha = 0.16;
      const vy = VY(k.v);
      ctx.fillRect(x - bodyW / 2, vy, bodyW, volBot - vy);
      ctx.globalAlpha = 1;
    }

    // candles
    for (let i = 0; i < n; i++) {
      const k = candles[i], x = X(i);
      const c = k.c >= k.o ? up : down;
      // wick
      ctx.strokeStyle = c; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(k.h)); ctx.lineTo(x, Y(k.l)); ctx.stroke();
      // body
      const yo = Y(k.o), yc = Y(k.c);
      const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
      ctx.fillStyle = c;
      if (bodyW >= 3) { roundRect(x - bodyW / 2, top, bodyW, bh, 1.5); ctx.fill(); }
      else ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
    }

    // current price line + chip
    const last = candles[n - 1].c, cy = Y(last);
    const lc = last >= candles[0].c ? up : down;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD_L, cy); ctx.lineTo(PAD_L + innerW, cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lc; roundRect(PAD_L + innerW + 2, cy - 8, PAD_R - 4, 16, 3); ctx.fill();
    ctx.fillStyle = '#04120e'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(last), PAD_L + innerW + 7, cy);

    // time labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let s = 0; s <= 3; s++) {
      const i = Math.round((n - 1) * s / 3);
      const lbl = new Date(candles[i].t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const x = Math.max(PAD_L + 16, Math.min(PAD_L + innerW - 16, X(i)));
      ctx.fillText(lbl, x, h - 4);
    }

    // hover crosshair + OHLC tooltip
    if (hoverIdx >= 0 && hoverIdx < n) {
      const k = candles[hoverIdx], x = X(hoverIdx);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, priceTop); ctx.lineTo(x, volBot); ctx.stroke(); ctx.setLineDash([]);
      const c = k.c >= k.o ? up : down;
      const dstr = new Date(k.t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const line1 = `O ${k.o.toFixed(2)}  H ${k.h.toFixed(2)}  L ${k.l.toFixed(2)}  C ${k.c.toFixed(2)}`;
      const line2 = `${dstr}   Vol ${fmtV(k.v)}`;
      ctx.font = '10px "JetBrains Mono", monospace';
      const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 16;
      let bx = 6; // pin tooltip top-left (GMGN-style)
      ctx.fillStyle = 'rgba(16,18,27,0.94)'; ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      roundRect(bx, 4, tw, 32, 6); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = c; ctx.fillText(line1, bx + 8, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText(line2, bx + 8, 30);
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    if (candles.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const innerW = (canvas.clientWidth || rect.width) - PAD_R - PAD_L;
    const slot = innerW / candles.length;
    let i = Math.floor((e.clientX - rect.left - PAD_L) / slot);
    i = Math.max(0, Math.min(candles.length - 1, i));
    if (i !== hoverIdx) { hoverIdx = i; draw(); }
  });
  canvas.addEventListener('mouseleave', () => { if (hoverIdx !== -1) { hoverIdx = -1; draw(); } });
  window.addEventListener('resize', draw);

  return {
    setData(cs) { candles = Array.isArray(cs) ? cs.filter((k) => k && k.c != null) : []; hoverIdx = -1; draw(); },
    setLast(price) {
      if (!candles.length) return;
      const k = candles[candles.length - 1];
      k.c = price; if (price > k.h) k.h = price; if (price < k.l) k.l = price;
      draw();
    },
    draw,
  };
}
