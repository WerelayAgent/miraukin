/* Wallet connect for the terminal.
   Uses an injected EVM provider (window.ethereum) on Robinhood Chain when
   available; otherwise a clearly-labelled demo address so the terminal is
   fully usable without a wallet. Holder gate: BRAND.gate.mint empty => open. */
import { BRAND } from './config.js';

const state = { address: null, demo: false, connected: false };
const subs = new Set();
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';

export const wallet = {
  get() { return { ...state, short: short(state.address) }; },
  onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
  _emit() { for (const cb of subs) cb(this.get()); },

  async connect() {
    const eth = window.ethereum;
    if (eth && eth.request) {
      try {
        const accounts = await eth.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          state.address = accounts[0]; state.demo = false; state.connected = true;
          this._switchChain(eth).catch(() => {});
          this._emit();
          return this.get();
        }
      } catch (e) { /* user rejected -> fall through to demo */ }
    }
    // Demo fallback — deterministic-looking address, flagged as demo.
    const hex = '0123456789abcdef';
    let a = '0x'; for (let i = 0; i < 40; i++) a += hex[Math.floor(Math.random() * 16)];
    state.address = a; state.demo = true; state.connected = true;
    this._emit();
    return this.get();
  },

  disconnect() { state.address = null; state.connected = false; state.demo = false; this._emit(); },

  async _switchChain(eth) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BRAND.chain.chainIdHex }] });
    } catch (err) {
      if (err && err.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: BRAND.chain.chainIdHex,
            chainName: BRAND.chain.name,
            rpcUrls: [BRAND.chain.rpc],
            nativeCurrency: BRAND.chain.currency,
            blockExplorerUrls: [BRAND.chain.explorer],
          }],
        });
      }
    }
  },

  // Holder gate. Open when no mint configured; otherwise read the connected
  // wallet's ERC-20 balance on-chain and compare against minHold.
  async gateOk() {
    if (!BRAND.gate.mint) return true;                 // ungated (shipped default)
    if (state.demo || !window.ethereum || !state.address) return false; // can't verify a demo wallet
    try {
      const data = '0x70a08231' + state.address.slice(2).toLowerCase().padStart(64, '0'); // balanceOf(address)
      const res = await window.ethereum.request({
        method: 'eth_call', params: [{ to: BRAND.gate.mint, data }, 'latest'],
      });
      const raw = BigInt(res || '0x0');
      const dec = BigInt(10) ** BigInt(BRAND.gate.decimals ?? 18);
      const whole = Number(raw / dec);
      return whole >= (BRAND.gate.minHold || 0);
    } catch (_) { return false; }
  },
};
