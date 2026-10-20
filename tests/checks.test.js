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
  res.__all = finalize(runChecks(ctx));
  return { page, ctx, res };
};

test('página problemática: pega noindex, canonical divergente, H1, schema × preço oculto', async () => {
  const { res, ctx } = await run(BAD_PRODUCT, 'https://www.exemplo.com.br/products/astra', baseNet());
  assert.equal(ctx.pageType, 'product');
  assert.equal(res.S2.score, 1);
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
  assert.equal(res.PR1.score >= 4, true, res.PR1.evidence);
  assert.equal(res.E5.score >= 4, true, res.E5.evidence);
  const sum = summarize(Object.values(res));
  assert.ok(sum.levels.page.avg > 3.5, `page avg ${sum.levels.page.avg}`);
  assert.equal(sum.groups.produto.count >= 5, true);
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
  assert.equal(res.C7, undefined, 'home não tem breadcrumb: item fora do tipo');
  assert.equal(res.E6, undefined, 'autoria só para artigo');
  assert.equal(res.E3.na, true);
  assert.equal(res.C8.na, true);
  assert.equal(res.E9.na, true);
  assert.equal(res.E4.score, 1);
});

test('rede indisponível não derruba a análise', async () => {
  const { res } = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', {});
  for (const id of ['S1', 'S5', 'S6', 'S7', 'S8', 'S9', 'P8']) assert.equal(res[id].na, true, id);
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

const SERVICE_PAGE = `<!doctype html><html lang="pt-BR"><head><title>Consultoria de SEO para e-commerce | Agência Exemplo</title>
<meta name="description" content="Consultoria de SEO para e-commerce com diagnóstico técnico, plano de ação e acompanhamento mensal. Solicite um orçamento.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ProfessionalService","name":"Consultoria de SEO","description":"d","areaServed":"BR","serviceType":"SEO","provider":{"@type":"Organization","name":"Exemplo"}}</script>
</head><body><main><h1>Consultoria de SEO para e-commerce</h1>
<a href="#form" class="btn">Solicitar orçamento</a>
<h2>O que está incluso</h2><p>${'entregáveis do serviço '.repeat(60)}</p>
<h2>Como funciona</h2><p>Etapas do processo.</p><h2>Para quem é</h2><p>Lojas.</p><h2>Benefícios</h2><p>b</p>
<h2>Depoimentos de clientes</h2><p>Mais de 10 anos de experiência. Nossa equipe de especialistas. Planos a partir de R$ 2.500.</p>
<form id="form"><input name="nome"><input type="email" name="email"><textarea name="msg"></textarea><button>Enviar</button></form>
<a href="https://wa.me/5511999999999">WhatsApp</a>
</main></body></html>`;

test('página de serviço é detectada e recebe checagens de serviço (e não as de produto)', async () => {
  const { res, ctx } = await run(SERVICE_PAGE, 'https://www.exemplo.com.br/servicos/seo-ecommerce', baseNet());
  assert.equal(ctx.pageType, 'service');
  const ids = res.__all.map((r) => r.id);
  assert.ok(ids.includes('SV1') && ids.includes('SV5'));
  assert.ok(!ids.some((i) => i.startsWith('PR')), 'sem itens de produto');
  assert.equal(res.SV1.score, 5, res.SV1.evidence);
  assert.equal(res.SV2.score >= 4, true, res.SV2.evidence);
  assert.equal(res.SV3.score, 5, res.SV3.evidence);
  assert.equal(res.SV5.score, 5, res.SV5.evidence);
  assert.equal(res.SV7.score, 5);
  assert.equal(res.SV2.group, 'servico');
  assert.equal(res.E2, undefined, 'schema de serviço é avaliado em SV1');
});

test('página de produto recebe itens de produto, não de serviço; níveis site × página', async () => {
  const { res, ctx } = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', baseNet({ soft404: { status: 404 } }));
  const ids = res.__all.map((r) => r.id);
  assert.ok(ids.includes('PR1') && ids.includes('PR7'));
  assert.ok(!ids.some((i) => i.startsWith('SV')));
  assert.equal(res.PR1.score >= 4, true, res.PR1.evidence);
  assert.equal(res.E3.group, 'produto', 'preço × schema aparece junto dos itens de produto');
  const siteIds = res.__all.filter((r) => r.level === 'site').map((r) => r.id).sort();
  assert.deepEqual(siteIds, ['E8', 'S5', 'S6', 'S7', 'S9']);
  assert.equal(res.S9.score, 5);
  assert.equal(res.S6.level, 'site');
  assert.equal(res.C1.level, 'page');
});

test('soft 404: URL inexistente respondendo 200 é problema crítico', async () => {
  const { res } = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', baseNet({ soft404: { status: 200, redirected: false, finalUrl: 'https://x/y' } }));
  assert.equal(res.S9.score, 1);
  const r2 = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', baseNet({ soft404: { status: 200, redirected: true, finalUrl: 'https://www.exemplo.com.br/' } }));
  assert.equal(r2.res.S9.score, 2);
});

test('e-commerce: produto e categoria não recebem FAQ, NAP/local nem volume de texto de produto', async () => {
  const prod = await run(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro', baseNet());
  const ids = prod.res.__all.map((r) => r.id);
  for (const id of ['E7', 'E9', 'C9']) assert.ok(!ids.includes(id), `${id} não faz sentido em página de produto`);
  const catHtml = `<!doctype html><html lang="pt-BR"><head><title>Cadeiras ergonômicas para escritório | Loja</title>
    <meta name="description" content="Veja nossas cadeiras ergonômicas com NR-17, garantia estendida e entrega para todo o Brasil. Compare modelos e escolha."><meta name="viewport" content="width=device-width">
    <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script></head>
    <body><main><h1>Cadeiras ergonômicas</h1><p>${'guia de escolha da cadeira '.repeat(40)}</p><a href="/products/a">Astra</a></main></body></html>`;
  const cat = await run(catHtml, 'https://www.exemplo.com.br/collections/cadeiras', baseNet());
  const cids = cat.res.__all.map((r) => r.id);
  assert.equal(cat.ctx.pageType, 'category');
  for (const id of ['E7', 'E9']) assert.ok(!cids.includes(id), id);
  assert.equal(cat.res.C9.score >= 4, true, cat.res.C9.evidence);
  assert.equal(cat.res.E2.score, 5, cat.res.E2.evidence);
  assert.ok(!cids.some((i) => i.startsWith('PR') || i.startsWith('SV')));
});

test('e-commerce: home de loja não pede FAQ; home institucional ainda pede', async () => {
  const shop = await run('<html lang="pt"><head><title>Loja de cadeiras ergonômicas e mesas | Exemplo</title><script src="https://cdn.shopify.com/s/x.js"></script></head><body><main><h1>Loja</h1></main></body></html>', 'https://loja.exemplo.com.br/', baseNet());
  assert.ok(!shop.res.__all.some((r) => r.id === 'E7'));
  const corp = await run('<html lang="pt"><head><title>Agência Exemplo | Marketing para empresas</title></head><body><main><h1>Agência</h1></main></body></html>', 'https://www.exemplo.com.br/', baseNet());
  assert.ok(corp.res.__all.some((r) => r.id === 'E7'));
});

test('e-commerce: ?variant= não penaliza URL; terceiros e peso usam régua de loja; troca vale como termos', async () => {
  const { page, DOMParser } = await collectFromHtml(GOOD_PRODUCT, 'https://www.exemplo.com.br/products/astra-pro?variant=123456');
  page.perf.resources = { count: 120, bytes: 4.2 * 1048576, unknown: 0, byType: {}, hosts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}.terceiro${i}.com`, { count: 1, bytes: 1 }])) };
  page.inst = { about: true, contact: true, privacy: true, terms: false, returns: true };
  page.local.cnpj = true;
  const ctx = buildContext(page, baseNet(), null, DOMParser);
  const res = Object.fromEntries(finalize(runChecks(ctx)).map((r) => [r.id, r]));
  assert.equal(res.C5.score, 5, res.C5.evidence);
  assert.equal(res.P7.score, 3, res.P7.evidence);
  assert.equal(res.P5.score, 3, res.P5.evidence);
  assert.equal(res.E5.score, 5, res.E5.evidence);
  const sem = buildContext(page, baseNet(), 'page', DOMParser);
  sem.page = { ...page, platforms: [], conv: { ...page.conv, ctas: [] } };
  const r2 = Object.fromEntries(finalize(runChecks(sem)).map((r) => [r.id, r]));
  assert.equal(r2.P7.score, 2, 'fora de loja a régua continua rígida');
});
