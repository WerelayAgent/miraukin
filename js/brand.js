/* Applies BRAND config to the page: CSS accent, <title>, and any element
   carrying a [data-brand="..."] hook. Import-and-call on every page. */
import { BRAND } from './config.js';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function applyBrand() {
  const root = document.documentElement;
  const [r, g, b] = hexToRgb(BRAND.accent);
  root.style.setProperty('--accent', BRAND.accent);
  root.style.setProperty('--accent-ink', BRAND.accentInk);
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
  root.style.setProperty('--accent-line', `rgba(${r}, ${g}, ${b}, 0.30)`);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.45)`);

  document.title = document.title.replace(/\{brand\}/g, BRAND.name);

  // Substitute placeholders in meta tags (description, og:*) too.
  document.querySelectorAll('meta[content*="{brand}"], meta[content*="{chain}"]').forEach((m) => {
    m.setAttribute('content', m.getAttribute('content')
      .replace(/\{brand\}/g, BRAND.name)
      .replace(/\{chain\}/g, BRAND.chain.name));
  });

  const set = (key, val) => {
    document.querySelectorAll(`[data-brand="${key}"]`).forEach((el) => {
      if (val instanceof Node) { el.innerHTML = ''; el.append(val); }
      else el.textContent = val;
    });
  };
  set('name', BRAND.name);
  set('ticker', '$' + BRAND.ticker);
  set('tagline', BRAND.tagline);
  set('herosub', BRAND.heroSub);
  set('chain', BRAND.chain.name);
  set('domain', BRAND.domain);
  set('year', new Date().getFullYear());
  set('excluded', BRAND.excluded.join(', '));
  set('marketcount', BRAND.markets.length);

  // contract address: short display + click-to-copy the full CA
  if (BRAND.ca) {
    const short = BRAND.ca.slice(0, 6) + '…' + BRAND.ca.slice(-4);
    set('ca-short', short);
    document.querySelectorAll('[data-ca-copy]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.title = 'Click to copy contract address';
      const orig = el.innerHTML;
      el.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(BRAND.ca); } catch (_) { /* ignore */ }
        el.textContent = 'Copied ✓';
        setTimeout(() => { el.innerHTML = orig; }, 1200);
      });
    });
  }

  // wire social links
  document.querySelectorAll('[data-link]').forEach((el) => {
    const key = el.getAttribute('data-link');
    if (BRAND.social[key]) el.setAttribute('href', BRAND.social[key]);
  });
}
