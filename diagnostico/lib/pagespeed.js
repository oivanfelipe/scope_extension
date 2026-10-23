// Google PageSpeed Insights (simulação de celular em rede 4G): o mesmo número que o cliente vê no PageSpeed.
// A API é gratuita, mas sem chave a cota compartilhada costuma estourar (erro 429); por isso a chave é opcional.
const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const TIMEOUT_MS = 70000;

/** Extrai as métricas do JSON da API. Devolve null se a resposta não trouxer o resultado do Lighthouse. */
export function parsePsi(json) {
  const lh = json?.lighthouseResult;
  const a = lh?.audits;
  if (!a) return null;
  const num = (id) => (typeof a[id]?.numericValue === 'number' ? a[id].numericValue : null);
  const round = (n) => (n == null ? null : Math.round(n));
  return {
    status: 'ok', strategy: 'mobile',
    score: typeof lh.categories?.performance?.score === 'number' ? Math.round(lh.categories.performance.score * 100) : null,
    lcpMs: round(num('largest-contentful-paint')),
    fcpMs: round(num('first-contentful-paint')),
    tbtMs: round(num('total-blocking-time')),
    speedIndexMs: round(num('speed-index')),
    ttfbMs: round(num('server-response-time')),
    cls: num('cumulative-layout-shift'),
    bytes: round(num('total-byte-weight')),
  };
}

export async function fetchPageSpeed(url, key = '') {
  const params = new URLSearchParams({ url, strategy: 'mobile', category: 'performance', locale: 'pt_BR' });
  if (key) params.set('key', key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return { status: 'unavailable', reason: r.status === 429 ? 'limite de uso do Google PageSpeed atingido (use uma chave gratuita)' : (json?.error?.message || `erro ${r.status}`).slice(0, 120) };
    return parsePsi(json) || { status: 'unavailable', reason: 'resposta sem resultado' };
  } catch (e) {
    return { status: 'unavailable', reason: e.name === 'AbortError' ? 'o Google PageSpeed demorou demais' : String(e.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}
