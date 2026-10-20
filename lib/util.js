// Utilitários compartilhados (sem dependência de DOM).

const SECOND_LEVEL = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'co.uk', 'org.uk', 'com.au',
  'com.ar', 'com.mx', 'co.za', 'com.pt', 'co.nz', 'com.co', 'com.pe', 'com.uy', 'com.py',
]);

export function stripWww(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

export function rootDomain(host) {
  const parts = String(host || '').toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}

/** true se o host é o domínio raiz (ou www.raiz); false se é um subdomínio como loja.exemplo.com.br */
export function isApexHost(host) {
  const h = stripWww(host);
  return h === rootDomain(h);
}

export function isThirdParty(pageHost, otherHost) {
  return rootDomain(pageHost) !== rootDomain(otherHost);
}

/** Normaliza URL para comparação: sem hash, host minúsculo, sem "/" final (exceto raiz). */
export function normalizeUrl(u, base) {
  try {
    const url = new URL(u, base);
    url.hash = '';
    let s = url.href;
    if (url.pathname !== '/' && s.endsWith('/') && !url.search) s = s.slice(0, -1);
    if (url.pathname === '/' && !url.search) s = url.origin + '/';
    return s;
  } catch {
    return String(u);
  }
}

/** Remove parâmetros de tracking para comparar canonical × URL atual. */
export function stripTracking(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|gbraid|wbraid|msclkid|mc_|_ga|ref$|srsltid)/i.test(k)) url.searchParams.delete(k);
    }
    return url.href;
  } catch {
    return u;
  }
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function truncate(s, n = 80) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function fmtBytes(b) {
  if (b == null || Number.isNaN(b)) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2).replace('.', ',')} s` : `${Math.round(ms)} ms`;
}

/**
 * O preço do schema aparece no texto visível? Testa formatos BR/US
 * (1.167,37 · 1167,37 · 1,167.37 · 1167.37 · R$ 1.167).
 */
export function priceVisible(text, price) {
  const n = Number(price);
  if (!Number.isFinite(n) || !text) return false;
  const [intPart, dec = '00'] = n.toFixed(2).split('.');
  const group = (sep) => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const forms = new Set([
    `${group('.')},${dec}`, `${intPart},${dec}`, `${group(',')}.${dec}`, `${intPart}.${dec}`,
  ]);
  if (dec === '00') {
    forms.add(group('.')); forms.add(intPart); forms.add(group(','));
  }
  for (const f of forms) {
    const re = new RegExp(`(?<![\\d.,])${f.replace(/[.,]/g, (m) => '\\' + m)}(?![\\d]|[.,]\\d)`);
    if (re.test(text)) return true;
  }
  return false;
}
