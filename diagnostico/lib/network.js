// Consultas ao próprio site analisado (robots.txt e sitemap). Rodam no painel, com host_permissions.
const TIMEOUT_MS = 8000;

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', cache: 'no-store' });
    return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 500000) };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  } finally { clearTimeout(timer); }
}

/** Interpreta o texto de um robots.txt: se bloqueia todos os robôs e quais sitemaps declara. */
export function parseRobots(text) {
  let agents = [];
  let lastWasAgent = false;
  let blocksAll = false;
  const sitemaps = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) agents = [];
      agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap' && val) sitemaps.push(val);
    if (key === 'disallow' && val === '/' && agents.includes('*')) blocksAll = true;
  }
  return { blocksAll, sitemaps };
}

/** status: 'found' | 'missing' | 'unknown' (erro de rede ou bloqueio do servidor). */
export async function fetchRobots(origin) {
  const r = await get(`${origin}/robots.txt`);
  if (r.error || r.status === 403 || r.status >= 500) return { status: 'unknown', blocksAll: false, sitemaps: [] };
  const looksRobots = r.ok && !/<html/i.test(r.text.slice(0, 500)) && /user-agent|disallow|sitemap/i.test(r.text);
  if (!looksRobots) return { status: 'missing', blocksAll: false, sitemaps: [] };
  return { status: 'found', ...parseRobots(r.text) };
}

export async function fetchSitemap(origin, declared = []) {
  const urls = [...declared.slice(0, 2), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  let unknown = false;
  for (const url of [...new Set(urls)]) {
    const r = await get(url);
    if (r.error || r.status === 403 || r.status >= 500) { unknown = true; continue; }
    if (r.ok && /<urlset|<sitemapindex/i.test(r.text)) return { status: 'found', url };
  }
  return { status: unknown ? 'unknown' : 'missing' };
}
