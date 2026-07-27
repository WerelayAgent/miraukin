/* =============================================================================
   ON-CHAIN LAYER — real transactions against the Miraukin protocol on Robinhood
   Chain. Uses the vendored ethers (window.ethers) + the injected wallet.
   Active only when onchain-config.js has enabled:true with real addresses;
   otherwise the terminal stays in demo mode. No private keys ever touched here.
   ========================================================================== */
import { ONCHAIN } from './onchain-config.js';

const VAULT_ABI = [
  "function quote(string symbol, bool isCall, uint256 strike, uint64 expiry, uint256 qty) view returns (uint256 premium, uint256 collateral)",
  "function quoteSell(string symbol, bool isCall, uint256 strike, uint64 expiry, uint256 qty) view returns (uint256 premium, uint256 collateral)",
  "function buyOption(string symbol, bool isCall, uint256 strike, uint64 expiry, uint256 qty, uint256 maxPremium) returns (uint256)",
  "function sellOption(string symbol, bool isCall, uint256 strike, uint64 expiry, uint256 qty, uint256 minPremium) returns (uint256)",
  "function close(uint256 id) returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function freeAssets() view returns (uint256)",
  "function lockedCollateral() view returns (uint256)",
  "function positionsLength() view returns (uint256)",
  "function getPosition(uint256 id) view returns (tuple(address owner, bytes32 symbol, bool isCall, bool short, bool settled, uint64 expiry, uint256 strike, uint256 qty, uint256 collateral, uint256 premiumPaid))",
  "function markOf(uint256 id) view returns (uint256)",
];
const USD_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function faucet()",
];

const USD_DEC = 6n, PRICE_DEC = 8n;
export const isEnabled = () => !!(ONCHAIN.enabled && ONCHAIN.vault && ONCHAIN.mockUsd && window.ethers);

// USD number -> 8-dec strike BigInt; mUSD BigInt -> USD number
export const toStrike8 = (usd) => BigInt(Math.round(usd * 1e8));
export const fromUsd6 = (v) => Number(v) / 1e6;
export const toUsd6 = (usd) => BigInt(Math.round(usd * 1e6));

let provider, signer, vault, usd, account;

async function ensureChain(eth) {
  const hex = '0x' + ONCHAIN.chainId.toString(16);
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }); }
  catch (e) {
    if (e && e.code === 4902) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: hex, chainName: ONCHAIN.chainName || 'Robinhood Chain',
        rpcUrls: [ONCHAIN.rpc || 'https://rpc.mainnet.chain.robinhood.com'],
        nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
        blockExplorerUrls: ONCHAIN.explorer ? [ONCHAIN.explorer] : undefined,
      }] });
    } else throw e;
  }
}

/* ----- multi-wallet discovery (EIP-6963): MetaMask, Trust, Coinbase, Rabby… ----- */
const _providers = new Map(); // uuid -> { info, provider }
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = e.detail;
    if (d && d.info && d.provider) _providers.set(d.info.uuid, { info: d.info, provider: d.provider });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** All detected injected wallets, each { info:{name,icon,rdns,uuid}, provider }. */
export function listWallets() {
  const out = [...(_providers.values())];
  if (!out.length && window.ethereum) {
    // legacy fallback (no EIP-6963 support)
    const e = window.ethereum;
    const providers = Array.isArray(e.providers) ? e.providers : [e];
    providers.forEach((p, i) => out.push({
      info: { name: p.isMetaMask ? 'MetaMask' : p.isCoinbaseWallet ? 'Coinbase Wallet' : p.isTrust ? 'Trust Wallet' : 'Browser Wallet', icon: '', uuid: 'legacy-' + i, rdns: '' },
      provider: p,
    }));
  }
  return out;
}

/** Connect with a specific EIP-1193 provider (from listWallets). */
export async function connect(chosenProvider) {
  const eth = chosenProvider || (listWallets()[0] && listWallets()[0].provider) || window.ethereum;
  if (!eth) throw new Error('No wallet found');
  await eth.request({ method: 'eth_requestAccounts' });
  await ensureChain(eth);
  provider = new window.ethers.BrowserProvider(eth);
  signer = await provider.getSigner();
  account = await signer.getAddress();
  vault = new window.ethers.Contract(ONCHAIN.vault, VAULT_ABI, signer);
  usd = new window.ethers.Contract(ONCHAIN.mockUsd, USD_ABI, signer);
  return account;
}

export const getAccount = () => account;
export const isConnected = () => !!signer;
export const collateralSymbol = () => ONCHAIN.collateralSymbol || 'mUSD';
export const hasFaucet = () => ONCHAIN.collateralHasFaucet !== false; // real USDG has no faucet

export async function usdBalance() {
  return fromUsd6(await usd.balanceOf(account));
}

export async function faucet() {
  const tx = await usd.faucet();
  await tx.wait();
}

/** Returns { premium, collateral } in USD (buyer pays premium). */
export async function quote(symbol, isCall, strikeUsd, expirySec, qty) {
  const [prem, coll] = await vault.quote(symbol, isCall, toStrike8(strikeUsd), BigInt(expirySec), BigInt(qty));
  return { premium: fromUsd6(prem), collateral: fromUsd6(coll), premRaw: prem, collRaw: coll };
}

/** Sell/write quote — { premium: writer receives, collateral: writer must post } in USD. */
export async function quoteSell(symbol, isCall, strikeUsd, expirySec, qty) {
  const [prem, coll] = await vault.quoteSell(symbol, isCall, toStrike8(strikeUsd), BigInt(expirySec), BigInt(qty));
  return { premium: fromUsd6(prem), collateral: fromUsd6(coll), premRaw: prem, collRaw: coll };
}

/** Approve + buy. slippage as a fraction (e.g. 0.03). Returns tx hash. */
export async function buyOption(symbol, isCall, strikeUsd, expirySec, qty, slippage = 0.03) {
  const strike8 = toStrike8(strikeUsd);
  const [prem] = await vault.quote(symbol, isCall, strike8, BigInt(expirySec), BigInt(qty));
  const maxPrem = prem + (prem * BigInt(Math.round(slippage * 1000))) / 1000n;

  const allowance = await usd.allowance(account, ONCHAIN.vault);
  if (allowance < maxPrem) {
    const atx = await usd.approve(ONCHAIN.vault, maxPrem * 20n); // approve headroom
    await atx.wait();
  }
  const tx = await vault.buyOption(symbol, isCall, strike8, BigInt(expirySec), BigInt(qty), maxPrem);
  const rc = await tx.wait();
  return rc.hash;
}

/** Approve collateral + write (sell) an option. slippage as a fraction. Returns tx hash. */
export async function sellOption(symbol, isCall, strikeUsd, expirySec, qty, slippage = 0.05) {
  const strike8 = toStrike8(strikeUsd);
  const [prem, coll] = await vault.quoteSell(symbol, isCall, strike8, BigInt(expirySec), BigInt(qty));
  const minPrem = prem - (prem * BigInt(Math.round(slippage * 1000))) / 1000n;

  // the writer posts `coll` collateral — ensure the vault is approved for it
  const allowance = await usd.allowance(account, ONCHAIN.vault);
  if (allowance < coll) {
    const atx = await usd.approve(ONCHAIN.vault, coll * 20n); // approve headroom
    await atx.wait();
  }
  const tx = await vault.sellOption(symbol, isCall, strike8, BigInt(expirySec), BigInt(qty), minPrem);
  const rc = await tx.wait();
  return rc.hash;
}

export async function close(id) {
  const tx = await vault.close(BigInt(id));
  const rc = await tx.wait();
  return rc.hash;
}

/** All open positions owned by the connected account. */
export async function myPositions() {
  const n = Number(await vault.positionsLength());
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = await vault.getPosition(i);
    if (p.owner.toLowerCase() !== account.toLowerCase() || p.settled) continue;
    const mark = await vault.markOf(i);
    out.push({
      id: i,
      symbolHash: p.symbol.toLowerCase(),
      isCall: p.isCall,
      short: p.short,
      strike: Number(p.strike) / 1e8,
      expiry: Number(p.expiry) * 1000,
      qty: Number(p.qty),
      collateral: fromUsd6(p.collateral),
      entryPremium: fromUsd6(p.premiumPaid),
      mark: fromUsd6(mark),
    });
  }
  return out;
}

export async function vaultStats() {
  const [total, free, locked] = await Promise.all([vault.totalAssets(), vault.freeAssets(), vault.lockedCollateral()]);
  return { total: fromUsd6(total), free: fromUsd6(free), locked: fromUsd6(locked) };
}

/** Free vault liquidity in USD — read-only, no wallet connection required. */
export async function freeLiquidity() {
  if (!isEnabled()) return null;
  try {
    const prov = new window.ethers.JsonRpcProvider(ONCHAIN.rpc, ONCHAIN.chainId);
    const v = new window.ethers.Contract(ONCHAIN.vault, VAULT_ABI, prov);
    return fromUsd6(await v.freeAssets());
  } catch (_) { return null; }
}
