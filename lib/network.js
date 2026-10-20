// Coletas de rede feitas pelo painel (host_permissions dispensam CORS).
// Todas as funções são tolerantes a falha: nunca lançam, devolvem { error } no lugar.

import { isApexHost, stripWww, normalizeUrl } from './util.js';
import { parseRobots } from './robots.js';

const TIMEOUT = 10000;

async function request(url, { method = 'GET', ms = TIMEOUT, readBody = true, maxBytes = 15e6 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method, redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: ctrl.signal,
    });
    const out = {
      url, status: res.status, finalUrl: res.url || url, redirected: res.redirected,
      contentType: res.headers.get('content-type') || '',
      headers: Object.fromEntries(res.headers.entries()),
    };
    if (readBody && method !== 'HEAD') {
      const len = Number(res.headers.get('content-length')) || 0;
      if (len > maxBytes) { out.tooLarge = true; res.body?.cancel?.(); }
      else out.text = await res.text();
    } else {
      res.body?.cancel?.();
    }
    return out;
  } catch (e) {
    return { url, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** HTML "cru" da URL atual (sem JavaScript) + headers. */
export async function fetchPage(url) {
  return request(url, { maxBytes: 6e6 });
}

/** Variações http/https × www/apex da home do domínio. */
export async function fetchVariants(host) {
  const bare = stripWww(host);
  const apex = isApexHost(host);
  const hosts = apex ? [bare, 'www.' + bare] : [host];
  const urls = [];
  for (const proto of ['http', 'https']) for (const h of hosts) urls.push(`${proto}://${h}/`);
  const results = await Promise.all(urls.map((u) => request(u, { readBody: false, ms: 8000 })));
  return { apex, variants: results };
}

export async function fetchRobots(origin) {
  const res = await request(origin + '/robots.txt', { ms: 8000 });
  if (res.error) return res;
  const isHtml = /html/i.test(res.contentType) || /^\s*<(!doctype|html)/i.test(res.text || '');
  return { ...res, isHtml, parsed: res.status === 200 && !isHtml ? parseRobots(res.text) : null };
}

export async function fetchLlmsTxt(origin) {
  const res = await request(origin + '/llms.txt', { ms: 8000 });
  if (res.error) return { found: false, error: res.error };
  const looksText = !/html/i.test(res.contentType) && !/^\s*</.test(res.text || '');
  return { found: res.status === 200 && looksText && (res.text || '').trim().length > 10, status: res.status, bytes: (res.text || '').length };
}

// ---------------------------------------------------------------- Sitemap

const TRANSACTIONAL_TOKENS = new Set([
  'obrigado', 'obrigada', 'thanks', 'thankyou', 'checkout', 'carrinho', 'cart', 'login', 'entrar',
  'invalido', 'invalid', 'erro', 'error', 'formulario', 'form', 'teste', 'test', 'staging',
  'busca', 'search', 'confirmacao', 'confirmation',
]);
const TRANSACTIONAL_PAIRS = ['pos-registro', 'pos-cadastro', 'minha-conta', 'my-account', 'thank-you', 'cadastro-concluido', 'cadastro-realizado'];

/** Páginas de obrigado, erro, formulário, carrinho etc. — não deveriam estar no sitemap. */
export function isTransactionalPath(pathname) {
  const p = String(pathname || '').toLowerCase();
  const tokens = p.split(/[\/\-_.]+/).filter(Boolean);
  if (tokens.some((t) => TRANSACTIONAL_TOKENS.has(t))) return true;
  const dashed = tokens.join('-');
  return TRANSACTIONAL_PAIRS.some((pair) => dashed.includes(pair));
}

function decodeXml(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

export function extractLocs(xml) {
  const locs = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) locs.push(decodeXml(m[1]));
  return locs;
}

async function fetchSitemapXml(url) {
  if (/\.gz(\?|$)/i.test(url)) {
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return { url, status: res.status, error: `HTTP ${res.status}` };
      const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
      return { url, status: 200, xml: await new Response(stream).text() };
    } catch (e) {
      return { url, error: 'gz: ' + (e.message || e) };
    }
  }
  const res = await request(url, { ms: 15000 });
  if (res.error || res.status !== 200) return { url, status: res.status, error: res.error || `HTTP ${res.status}` };
  const xml = res.text || '';
  if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) return { url, status: 200, error: 'não é um XML de sitemap válido' };
  return { url, status: 200, xml };
}

export async function fetchSitemaps(origin, pageUrl, robotsSitemaps, { maxChildren = 12 } = {}) {
  const roots = robotsSitemaps.length ? robotsSitemaps.slice(0, 5) : [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
  const out = {
    declaredInRobots: robotsSitemaps.length > 0,
    roots: [], files: [], totalUrls: 0, childrenTotal: 0, childrenFetched: 0,
    flagged: [], flaggedCount: 0, hostMismatch: 0, httpUrls: 0, containsPage: false, errors: [],
  };
  const pageNorm = normalizeUrl(pageUrl);
  const pageHost = stripWww(new URL(pageUrl).hostname);
  const pageHttps = pageUrl.startsWith('https:');

  const scan = (sm) => {
    const locs = extractLocs(sm.xml);
    out.totalUrls += locs.length;
    for (const loc of locs) {
      if (normalizeUrl(loc) === pageNorm) out.containsPage = true;
      let u; try { u = new URL(loc); } catch { continue; }
      if (stripWww(u.hostname) !== pageHost) out.hostMismatch++;
      if (pageHttps && u.protocol === 'http:') out.httpUrls++;
      if (isTransactionalPath(u.pathname)) {
        out.flaggedCount++;
        if (out.flagged.length < 10) out.flagged.push(u.pathname);
      }
    }
    return locs.length;
  };

  for (const root of roots) {
    const sm = await fetchSitemapXml(root);
    if (sm.error) { out.errors.push(`${root}: ${sm.error}`); continue; }
    out.roots.push(root);
    if (/<sitemapindex/i.test(sm.xml)) {
      const children = extractLocs(sm.xml);
      out.childrenTotal += children.length;
      const chosen = children.slice(0, Math.max(0, maxChildren - out.childrenFetched));
      const fetched = await Promise.all(chosen.map(fetchSitemapXml));
      for (const c of fetched) {
        out.childrenFetched++;
        if (c.error) { out.errors.push(`${c.url}: ${c.error}`); out.files.push({ url: c.url, error: c.error }); continue; }
        if (/<sitemapindex/i.test(c.xml)) { out.files.push({ url: c.url, nested: true }); continue; }
        out.files.push({ url: c.url, urls: scan(c) });
      }
    } else {
      out.childrenTotal++;
      out.childrenFetched++;
      out.files.push({ url: root, urls: scan(sm) });
    }
    if (out.roots.length && !robotsSitemaps.length) break; // achou o padrão, não precisa do segundo candidato
  }
  out.found = out.roots.length > 0;
  out.truncated = out.childrenFetched < out.childrenTotal;
  return out;
}

// ------------------------------------------------------- Amostra de links

export async function checkLinks(links, { limit = 25, concurrency = 5 } = {}) {
  if (!links.length) return { checked: 0, results: [] };
  const step = Math.max(1, links.length / limit);
  const sample = [];
  for (let i = 0; i < links.length && sample.length < limit; i += step) sample.push(links[Math.floor(i)]);

  const results = [];
  let idx = 0;
  const worker = async () => {
    while (idx < sample.length) {
      const l = sample[idx++];
      let res = await request(l.href, { method: 'HEAD', readBody: false, ms: 8000 });
      if (res.error || [403, 405, 501, 400].includes(res.status)) {
        res = await request(l.href, { method: 'GET', readBody: false, ms: 8000 });
      }
      results.push({
        href: l.href, status: res.status ?? null, error: res.error || null,
        redirected: !!res.redirected, finalUrl: res.finalUrl || null,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sample.length) }, worker));
  return { checked: results.length, total: links.length, results };
}
