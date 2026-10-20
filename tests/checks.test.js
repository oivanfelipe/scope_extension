import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFromHtml } from './helpers.js';
import { buildContext, runChecks, detectPageType, schemaPrices, schemaNodes, rawStats } from '../lib/checks.js';
import { parseRobots } from '../lib/robots.js';
import { finalize, summarize } from '../lib/scoring.js';

const BAD_PRODUCT = `<!doctype html><html><head>
<title>Astra</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="https://www.exemplo.com.br/outra-pagina">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ProductGroup","name":"Cadeira Astra",
 "offers":{"@type":"Offer","price":"1167.37","priceCurrency":"BRL","availability":"https://schema.org/InStock"}}</script>
</head><body>
<h1>News</h1><h1>Outro</h1><h3>Salto</h3>
<p>Cadastre-se e veja os preços da cadeira.</p>
<img src="/a.jpg"><img src="/b.jpg" alt="ok">
<a href="/produtos/x">clique aqui</a><a href="/produtos/y" rel="nofollow">Y</a>
</body></html>`;

const GOOD_PRODUCT = `<!doctype html><html lang="pt-BR"><head>
<title>Cadeira Ergonômica Astra Pro com NR-17 | Elements</title>
<meta name="description" content="Cadeira ergonômica Astra Pro com regulagens completas, certificada NR-17. Garantia estendida e frete para todo o Brasil. Compre agora.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://www.exemplo.com.br/products/astra-pro">
<meta property="og:title" content="Astra Pro"><meta property="og:description" content="d"><meta property="og:image" content="https://x/y.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Product","name":"Astra Pro","image":"https://x/y.jpg","brand":{"@type":"Brand","name":"Elements"},"sku":"A1",
  "offers":{"@type":"Offer","price":"1167.37","priceCurrency":"BRL","availability":"https://schema.org/InStock"}},
 {"@type":"BreadcrumbList","itemListElement":[]}]}</script>
</head><body>
<nav aria-label="breadcrumb"><a href="/">Home</a></nav>
<main><h1>Cadeira Ergonômica Astra Pro</h1>
<h2>Benefícios</h2><p>${'texto relevante '.repeat(120)}</p><h2>Como regular?</h2><ul><li>a</li><li>b</li><li>c</li></ul><h2>Garantia</h2>
<p>Por R$ 1.167,37 à vista.</p>
<img src="/a.webp" alt="Cadeira" width="800" height="600" loading="lazy">
<a href="/sobre">Sobre nós</a> <a href="/contato">Fale conosco</a> <a href="/privacidade">Política de privacidade</a> <a href="/termos">Termos de uso</a>
</main></body></html>`;

const baseNet = (over = {}) => ({
  pageFetch: { status: 200, finalUrl: 'https://www.exemplo.com.br/x', redirected: false, headers: {}, text: '<html></html>' },
  variants: { apex: true, variants: [
    { url: 'http://exemplo.com.br/', status: 200, finalUrl: 'https://www.exemplo.com.br/' },
    { url: 'http://www.exemplo.com.br/', status: 200, finalUrl: 'https://www.exemplo.com.br/' },
    { url: 'https://exemplo.com.br/', status: 200, finalUrl: 'https://www.exemplo.com.br/' },
    { url: 'https://www.exemplo.com.br/', status: 200, finalUrl: 'https://www.exemplo.com.br/' }] },
  robots: { status: 200, parsed: parseRobots('User-agent: *\nDisallow: /admin\nSitemap: https://www.exemplo.com.br/sitemap.xml') },
  sitemap: { found: true, declaredInRobots: true, childrenTotal: 1, childrenFetched: 1, truncated: false, totalUrls: 10, flagged: [], flaggedCount: 0, hostMismatch: 0, httpUrls: 0, containsPage: true, errors: [], files: [] },
  links: { checked: 4, total: 4, results: [{ status: 200 }, { status: 200 }, { status: 200 }, { status: 200 }] },
  llms: { found: false },
  ...over,
});

const run = async (html, url, net, type) => {
  const { page, DOMParser } = await collectFromHtml(html, url);
  const ctx = buildContext(page, net, type, DOMParser);
  const res = Object.fromEntries(finalize(runChecks(ctx)).map((r) => [r.id, r]));
  return { page, ctx, res };
};

test('página problemática: pega noindex, canonical divergente, H1, schema × preço oculto', async () => {
  const { res, ctx } = await run(BAD_PRODUCT, 'https://www.exemplo.com.br/products/astra', baseNet());
  assert.equal(ctx.pageType, 'product');
  assert.equal(res.S2.score, 1);
  assert.equal(res.S2.sprint, 1);
  assert.equal(res.S3.score, 2);
  assert.equal(res.C1.score <= 3, true);
  assert.equal(res.C2.score, 2);
  assert.equal(res.C3.score, 3);
  assert.equal(res.C4.score <= 4, true);
  assert.equal(res.E3.score, 1, 'schema expõe preço que a página esconde (caso Elements B2B)');
  assert.match(res.E3.evidence, /1\.167,37/);
  assert.equal(res.C8.score <= 4, true);
});

test('página saudável: notas altas e preço do schema visível', async () => {
  const { res, ctx } = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', baseNet());
  assert.equal(ctx.pageType, 'product');
  for (const id of ['S2', 'S3', 'C1', 'C2', 'C3', 'C7', 'C8', 'E3']) assert.equal(res[id].score, 5, `${id}: ${res[id].evidence}`);
  assert.equal(res.S1.score, 5);
  assert.equal(res.S5.score, 5);
  assert.equal(res.S6.score, 5);
  assert.equal(res.E2.score >= 4, true, res.E2.evidence);
  assert.equal(res.E5.score >= 4, true, res.E5.evidence);
  const sum = summarize(Object.values(res));
  assert.equal(sum.dims.O.avg, null);
  assert.ok(sum.overall > 3.5, `overall ${sum.overall}`);
});

test('domínio: várias versões acessíveis, robots bloqueando, sitemap com páginas de obrigado', async () => {
  const net = baseNet({
    variants: { apex: true, variants: [
      { url: 'http://exemplo.com.br/', status: 200, finalUrl: 'http://exemplo.com.br/' },
      { url: 'https://exemplo.com.br/', status: 200, finalUrl: 'https://exemplo.com.br/' },
      { url: 'http://www.exemplo.com.br/', status: 200, finalUrl: 'https://www.exemplo.com.br/' },
      { url: 'https://www.exemplo.com.br/', status: 200, finalUrl: 'https://www.exemplo.com.br/' }] },
    robots: { status: 200, parsed: parseRobots('User-agent: *\nDisallow: /products/\nUser-agent: GPTBot\nDisallow: /') },
    sitemap: { found: true, declaredInRobots: false, childrenTotal: 5, childrenFetched: 5, truncated: false, totalUrls: 100, flagged: ['/pages/obrigado', '/pages/cnpj-invalido', '/pages/formulario-x'], flaggedCount: 3, hostMismatch: 0, httpUrls: 0, containsPage: false, errors: [], files: [] },
  });
  const { res } = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', net);
  assert.equal(res.S5.score, 1);
  assert.equal(res.S6.score, 1, res.S6.evidence);
  assert.equal(res.S7.score, 2);
  assert.equal(res.E8.score <= 4, true);
});

test('checagens dependentes de contexto viram N/A em vez de nota', async () => {
  const { res } = await run('<html lang="pt"><head><title>Home da marca com título razoável</title></head><body><main><h1>Marca</h1></main></body></html>', 'https://marca.com.br/', baseNet());
  assert.equal(res.C7.na, true);
  assert.equal(res.E6.na, true);
  assert.equal(res.E3.na, true);
  assert.equal(res.C8.na, true);
  assert.equal(res.E9.na, true);
  assert.equal(res.E4.score, 1);
});

test('rede indisponível não derruba a análise', async () => {
  const { res } = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', {});
  for (const id of ['S1', 'S5', 'S6', 'S7', 'S8', 'P8']) assert.equal(res[id].na, true, id);
  assert.equal(res.C1.score, 5);
});

test('rawStats e detectPageType', async () => {
  const { DOMParser } = await collectFromHtml('<html></html>');
  const raw = rawStats('<html><head><title>T</title></head><body><h1>A</h1><p>um dois três</p><script>var a=1</script></body></html>', DOMParser);
  assert.deepEqual([raw.title, raw.h1, raw.words], [true, 1, 4]);
  const { page } = await collectFromHtml('<html><body><h1>Blog</h1></body></html>', 'https://x.com/blog/meu-post');
  assert.equal(detectPageType(page), 'article');
  assert.deepEqual(schemaPrices(schemaNodes([{ ok: true, data: { '@type': 'Offer', price: '10.5' } }])), [10.5]);
});

test('robots: Shopify padrão (/cart.js, /cdn/wpm/*.js) não é falso positivo; /wp-content/ é', async () => {
  const mk = (txt) => baseNet({ robots: { status: 200, parsed: parseRobots(txt + '\nSitemap: https://x/s.xml') } });
  const a = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', mk('User-agent: *\nDisallow: /cart.js\nDisallow: /cdn/wpm/*.js\nDisallow: /admin'));
  assert.equal(a.res.S6.score, 5, a.res.S6.evidence);
  const b = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', mk('User-agent: *\nDisallow: /wp-content/plugins/'));
  assert.equal(b.res.S6.score, 3, b.res.S6.evidence);
});
