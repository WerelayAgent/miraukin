/* =============================================================================
   BLACK-SCHOLES OPTION PRICING ENGINE  (real math, no placeholders)
   European options on a non-dividend underlying. Time in YEARS.
   Greeks: delta, gamma, vega (per 1 vol pt), theta (per day), rho (per 1% rate).
   ========================================================================== */

const SQRT2PI = Math.sqrt(2 * Math.PI);

export const normPdf = (x) => Math.exp(-0.5 * x * x) / SQRT2PI;

/* Standard normal CDF — Zelen & Severo (abs error < 7.5e-8). */
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = normPdf(x);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
            t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/* Core pricer. Returns price + full greeks.
   type: 'call' | 'put'. */
export function bs({ S, K, T, r = 0.043, vol, type = 'call' }) {
  // Expiry / degenerate handling
  if (T <= 0) {
    const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const itm = type === 'call' ? S > K : S < K;
    return {
      price: intrinsic,
      delta: itm ? (type === 'call' ? 1 : -1) : 0,
      gamma: 0, vega: 0, theta: 0, rho: 0, d1: 0, d2: 0,
    };
  }
  vol = Math.max(vol, 1e-6);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * vol * vol) * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const nd1 = normPdf(d1);
  const disc = Math.exp(-r * T);
  const gamma = nd1 / (S * vol * sqrtT);
  const vega = (S * nd1 * sqrtT) / 100;      // per 1 vol point (0.01)

  if (type === 'call') {
    const Nd1 = normCdf(d1), Nd2 = normCdf(d2);
    return {
      price: S * Nd1 - K * disc * Nd2,
      delta: Nd1,
      gamma, vega,
      theta: (-(S * nd1 * vol) / (2 * sqrtT) - r * K * disc * Nd2) / 365,
      rho: (K * T * disc * Nd2) / 100,
      d1, d2,
    };
  } else {
    const Nnd1 = normCdf(-d1), Nnd2 = normCdf(-d2);
    return {
      price: K * disc * Nnd2 - S * Nnd1,
      delta: normCdf(d1) - 1,
      gamma, vega,
      theta: (-(S * nd1 * vol) / (2 * sqrtT) + r * K * disc * Nnd2) / 365,
      rho: (-K * T * disc * Nnd2) / 100,
      d1, d2,
    };
  }
}

/* Implied vol from a market price via Newton-Raphson with bisection fallback. */
export function impliedVol({ S, K, T, r = 0.043, type = 'call', price }) {
  const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (price <= intrinsic + 1e-8) return 0;
  let vol = 0.5, lo = 1e-4, hi = 5;
  for (let i = 0; i < 60; i++) {
    const o = bs({ S, K, T, r, vol, type });
    const diff = o.price - price;
    if (Math.abs(diff) < 1e-6) return vol;
    const vderiv = o.vega * 100;               // dPrice/dVol
    let next = vderiv > 1e-8 ? vol - diff / vderiv : vol;
    if (!(next > lo && next < hi)) {           // fall back to bisection
      if (diff > 0) hi = vol; else lo = vol;
      next = 0.5 * (lo + hi);
    } else {
      if (diff > 0) hi = vol; else lo = vol;
    }
    vol = next;
  }
  return vol;
}

/* Simple volatility smile: OTM puts / far strikes priced richer.
   Returns the per-strike IV given an at-the-money base IV. */
export function smileIv(baseIv, S, K) {
  const m = Math.log(K / S);                   // log-moneyness
  const skew = -0.6;                           // negative skew (equity-like)
  const curv = 1.4;
  const iv = baseIv * (1 + skew * m + curv * m * m);
  return Math.min(Math.max(iv, baseIv * 0.55), baseIv * 2.4);
}

/* Year-fraction between now and an expiry Date (ACT/365). */
export function yearsTo(expiryMs, nowMs = Date.now()) {
  return Math.max((expiryMs - nowMs) / (365 * 24 * 3600 * 1000), 0);
}
