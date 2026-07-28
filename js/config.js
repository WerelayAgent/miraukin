/* =============================================================================
   BRAND SOURCE OF TRUTH
   -----------------------------------------------------------------------------
   Everything user-facing about the brand lives here. To rename the whole
   product, change BRAND.name / BRAND.ticker / BRAND.accent below and reload.
   The on-page brand is driven entirely from this file by js/brand.js, so the
   folder name is cosmetic.)
   ========================================================================== */

export const BRAND = {
  name: 'Miraukin',                    // <- change to rename everywhere
  shortName: 'Miraukin',
  ticker: 'MIRAUKIN',                  // token ticker (shown as $MIRAUKIN)
  ca: '9PviLSRnFtWrDfdz5wE25opzscqDvxZe9Rzk69qWpump', // $MIRAUKIN contract address
  domain: 'miraukin.com',            // placeholder domain
  tagline: 'Options on Pump.fun & Solana memecoins.',
  heroSub:
    'Buy calls and puts on your favorite Solana tokens, or write them to earn premium. ' +
    'Fully collateralized, priced by live oracles, and open 24/7.',

  // Single signature accent (mint-aqua). Distinct from Hyperliquid mint,
  // premium on near-black. Swap this one value to re-tone the whole site.
  accent: '#a855f7', // Purple accent for Pump.fun vibe
  accentInk: '#000000',

  // Chain
  chain: {
    name: 'Solana',
    chainId: 101,                   
    chainIdHex: '0x65',
    rpc: 'https://api.mainnet-beta.solana.com',
    currency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
    explorer: 'https://solscan.io',
  },

  // Holder gate. Empty mint => open to everyone (free play).
  gate: { mint: '', minHold: 0, decimals: 9 },

  social: {
    x: 'https://x.com/miraukin',
    docs: '#',
    discord: '#',
    github: '#',
  },

  excluded: ['U.S.', 'Canada', 'U.K.', 'Switzerland'],

  riskFreeRate: 0.08,               // 8% annualized for crypto
  contractMultiplier: 1,             
  houseEdge: 0.40,                   // +40% premium markup

  /* Solana / Pump.fun meme markets. */
  markets: [
    { sym: 'WIF',    name: 'dogwifhat',      baseSpot: 2.50,      iv: 1.20, gmgn: 'sol/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
    { sym: 'POPCAT', name: 'Popcat',         baseSpot: 0.85,      iv: 1.50, gmgn: 'sol/7GCihgDB8fe6KNjn2MyTKzYc121eZo18q14x8J76pUa7' },
    { sym: 'BOME',   name: 'BOOK OF MEME',   baseSpot: 0.009,     iv: 1.40, gmgn: 'sol/ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82' },
    { sym: 'BONK',   name: 'Bonk',           baseSpot: 0.000028,  iv: 1.10, gmgn: 'sol/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { sym: 'MEW',    name: 'cat in a dogs world', baseSpot: 0.004, iv: 1.60, gmgn: 'sol/MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREqcMsdZ3k' },
    { sym: 'MOTHER', name: 'MOTHER IGGY',    baseSpot: 0.045,     iv: 1.70, gmgn: 'sol/3S8qX1MsMqRbiwKg2cQyx7nis1oHMgaCuc9c4VfvVdPN' },
    { sym: 'MICHI',  name: 'michi',          baseSpot: 0.15,      iv: 1.80, gmgn: 'sol/5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp' },
    { sym: 'PONKE',  name: 'PONKE',          baseSpot: 0.42,      iv: 1.30, gmgn: 'sol/5z3EqYQo9HiCEs3R84RCDMu2n7anpJCjDscE8BNDWw3P' },
    { sym: 'WEN',    name: 'Wen',            baseSpot: 0.00015,   iv: 1.25, gmgn: 'sol/WENWENvqqNya429ubCdR81ZmD69brwQaaVNKKX2NeeT' }
  ],

  // Symbols shown in the static landing ticker
  tickerSymbols: ['WIF', 'POPCAT', 'BOME', 'BONK', 'MEW', 'MOTHER', 'PONKE'],

  // Use GMGN for all charts
  gmgnDefault: 'sol/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
};

export const fmtUsd = (n, d = 2) => {
  if (n == null || isNaN(n)) return '—';
  // If price is extremely small (like Bonk), show more decimals
  const num = Number(n);
  if (num < 0.01 && num > 0) d = 6;
  if (num < 0.0001 && num > 0) d = 8;
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

export const fmtPct = (n, d = 2) =>
  n == null || isNaN(n) ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(d) + '%';

export const fmtNum = (n, d = 2) =>
  n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const marketBySym = (sym) => BRAND.markets.find((m) => m.sym === sym);

// TradingView fallback (not used since gmgn is active)
export const tvSymbol = (sym) => {
  return `BINANCE:${sym}USDT`;
};
