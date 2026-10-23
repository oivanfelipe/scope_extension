import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, summarize, speedLevel, mainSpeedMs, speedSource, fmtSeconds, topLosses, detectSiteType, CHECKS, GROUPS } from '../lib/checks.js';
import { parsePsi } from '../lib/pagespeed.js';
import { parseRobots } from '../lib/network.js';
import { toMarkdown, toShortText, speedSentence } from '../lib/report.js';

const good = () => ({
  url: 'https://exemplo.com.br/', origin: 'https://exemplo.com.br', host: 'exemplo.com.br', title: 'Exemplo',
  speed: { lcpMs: 1800, fcpMs: 900, loadMs: 2200, ttfbMs: 300, requests: 40 },
  structure: { https: true, title: 'Consultoria de marketing em São Paulo', description: 'A descrição tem um tamanho adequado para aparecer completa nos resultados de busca do Google.', h1Count: 1, h1Text: 'Marketing que vende', imgTotal: 10, imgWithAlt: 10, viewport: true, noindex: false, schemaCount: 2 },
  tracking: { gtmIds: ['GTM-ABC123'], ga4Ids: ['G-ABCDEF1'], adsIds: ['AW-123456789'], adsRequest: false, metaPixel: true, universalAnalytics: false, others: [] },
  conversion: { ctaAboveFold: 'Fale com um especialista', whatsapp: true, phone: true, forms: 1, socialProof: true },
  psi: { status: 'ok', lcpMs: 1800, tbtMs: 150, ttfbMs: 300, bytes: 1.5 * 1048576 },
  site: { platform: '', schemaTypes: [], cart: false, buy: false, prices: 0, search: false, conditions: [] },
});
const goodNet = { robots: { status: 'found', blocksAll: false, sitemaps: [] }, sitemap: { status: 'found' } };
const bad = () => ({
  ...good(),
  speed: { lcpMs: 5200, fcpMs: 3000, loadMs: 7000, ttfbMs: 2500, requests: 220 },
  structure: { https: false, title: '', description: '', h1Count: 0, h1Text: '', imgTotal: 10, imgWithAlt: 2, viewport: false, noindex: true, schemaCount: 0 },
  tracking: { gtmIds: [], ga4Ids: [], adsIds: [], adsRequest: false, metaPixel: false, universalAnalytics: true, others: [] },
  conversion: { ctaAboveFold: null, whatsapp: false, phone: false, forms: 0, socialProof: false },
  psi: { status: 'ok', lcpMs: 5200, tbtMs: 900, ttfbMs: 2500, bytes: 6 * 1048576 },
});
const badNet = { robots: { status: 'missing', blocksAll: false, sitemaps: [] }, sitemap: { status: 'missing' } };
const by = (results, id) => results.find((r) => r.id === id);

test('todo item tem id único, área válida e contexto (problema, o que causa, como resolver, peso)', () => {
  const ids = CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CHECKS) {
    assert.ok(GROUPS.some((g) => g.id === c.group), c.id);
    assert.ok(c.name && c.problem && c.cost && c.fix, c.id);
    assert.ok(c.weight >= 1 && c.weight <= 10, c.id);
  }
});

test('onde está perdendo clientes: ruins antes de atenção, por peso, no máximo 3', () => {
  const r = runChecks(bad(), badNet);
  const top = topLosses(r);
  assert.equal(top.length, 3);
  assert.ok(top.every((x) => x.status === 'bad'));
  assert.ok(top[0].weight >= top[1].weight && top[1].weight >= top[2].weight);
  assert.equal(top[0].weight, 10);
  const d = good(); d.psi.lcpMs = 3000; d.structure.imgWithAlt = 5;
  const mixed = topLosses(runChecks(d, goodNet));
  assert.deepEqual(mixed.map((x) => x.id), ['V1', 'E5']);
  assert.deepEqual(topLosses(runChecks(good(), goodNet)), []);
});

test('site bom: todos os itens ok e veredito positivo', () => {
  const r = runChecks(good(), goodNet);
  assert.ok(r.every((x) => x.status === 'ok'), JSON.stringify(r.filter((x) => x.status !== 'ok')));
  const s = summarize(r);
  assert.equal(s.overall.level, 'ok');
  assert.equal(s.overall.ok, s.overall.total);
  assert.match(s.overall.headline, /bem estruturado/);
});

test('site ruim: itens ruins, nível ruim e headline com a contagem', () => {
  const r = runChecks(bad(), badNet);
  for (const id of ['V1', 'V2', 'V3', 'V4', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4', 'C5']) assert.equal(by(r, id).status, 'bad', id);
  const s = summarize(r);
  assert.equal(s.overall.level, 'bad');
  assert.equal(s.overall.ok, 0);
  assert.match(s.overall.headline, new RegExp(`${s.overall.fix} pontos`));
});

test('velocidade: limites de 2,5 s e 4 s e formatação em segundos', () => {
  assert.equal(speedLevel(2500), 'ok');
  assert.equal(speedLevel(2501), 'warn');
  assert.equal(speedLevel(4000), 'warn');
  assert.equal(speedLevel(4001), 'bad');
  assert.equal(speedLevel(null), 'na');
  assert.equal(fmtSeconds(5234), '5,2');
  assert.equal(mainSpeedMs({ speed: { lcpMs: null, loadMs: 3000, fcpMs: 1000 } }), 3000);
  assert.match(speedSentence(5200), /5,2 segundos.*ruim/);
});

test('Analytics antigo (Universal) é ruim; GA4 dentro do GTM não detectado é atenção', () => {
  const d = good();
  d.tracking.ga4Ids = []; d.tracking.universalAnalytics = true;
  assert.equal(by(runChecks(d, goodNet), 'R1').status, 'bad');
  d.tracking.universalAnalytics = false;
  assert.equal(by(runChecks(d, goodNet), 'R1').status, 'warn');
  d.tracking.gtmIds = [];
  assert.equal(by(runChecks(d, goodNet), 'R1').status, 'bad');
});

test('tag do Google Ads: sem ID mas com GTM vira atenção', () => {
  const d = good();
  d.tracking.adsIds = [];
  assert.equal(by(runChecks(d, goodNet), 'R4').status, 'warn');
  d.tracking.gtmIds = [];
  assert.equal(by(runChecks(d, goodNet), 'R4').status, 'bad');
});

test('rede indisponível vira "não verificado" e não entra na conta', () => {
  const r = runChecks(good(), { robots: { status: 'unknown' }, sitemap: { status: 'unknown' } });
  assert.equal(by(r, 'E8').status, 'na');
  assert.equal(by(r, 'E7').status, 'warn');
  const s = summarize(r);
  assert.equal(s.overall.total, r.length - 1);
});

test('imagens: 80% ok, 50% atenção; sem imagens não se aplica', () => {
  const d = good();
  d.structure.imgTotal = 10; d.structure.imgWithAlt = 8;
  assert.equal(by(runChecks(d, goodNet), 'E5').status, 'ok');
  d.structure.imgWithAlt = 5;
  assert.equal(by(runChecks(d, goodNet), 'E5').status, 'warn');
  d.structure.imgTotal = 0;
  assert.equal(by(runChecks(d, goodNet), 'E5').status, 'na');
});

test('robots.txt: detecta bloqueio total só para todos os robôs e lê sitemaps', () => {
  assert.equal(parseRobots('User-agent: *\nDisallow: /').blocksAll, true);
  assert.equal(parseRobots('User-agent: *\nDisallow: /admin').blocksAll, false);
  assert.equal(parseRobots('User-agent: Googlebot\nDisallow: /\n').blocksAll, false);
  assert.equal(parseRobots('User-agent: Bingbot\nUser-agent: *\nDisallow: /').blocksAll, true);
  assert.deepEqual(parseRobots('Sitemap: https://a.com/s.xml\nUser-agent: *\nDisallow:').sitemaps, ['https://a.com/s.xml']);
});

test('relatório .md traz placar, velocidade e os itens com ícone', () => {
  const data = bad();
  const results = runChecks(data, badNet);
  const summary = summarize(results);
  const md = toMarkdown({ client: 'Cliente X', data, results, summary, date: '2026-10-22' });
  assert.match(md, /# Diagnóstico rápido do site — Cliente X/);
  assert.match(md, /0 de 22 itens estão bons/);
  assert.match(md, /5,2 segundos/);
  assert.match(md, /❌ \*\*O site demora para abrir\.\*\*/);
  assert.match(md, /O que isso causa: Quanto mais demora/);
  assert.match(md, /Como resolver: Otimizar imagens/);
  assert.match(md, /## Onde está perdendo clientes\n\n1\. \*\*/);
  assert.match(toShortText({ client: '', data, results, summary }), /Principais problemas:/);
});

test('velocidade: o tempo do Google PageSpeed tem prioridade sobre a medição local', () => {
  const d = good();
  assert.equal(speedSource(d), 'psi');
  assert.equal(mainSpeedMs(d), 1800);
  d.psi = { status: 'unavailable', reason: 'limite' };
  assert.equal(speedSource(d), 'local');
  assert.equal(mainSpeedMs(d), 1800); // lcp local do fixture
  assert.match(by(runChecks(d, goodNet), 'V1').found, /medido neste computador/);
});

test('velocidade sem PageSpeed: toque e peso não são verificados (e não pesam na nota)', () => {
  const d = good(); d.psi = { status: 'unavailable', reason: 'limite' };
  const r = runChecks(d, goodNet);
  assert.equal(by(r, 'V3').status, 'na');
  assert.equal(by(r, 'V4').status, 'na');
  assert.match(by(r, 'V3').found, /chave gratuita do Google PageSpeed/);
});

test('peso alto não vira problema grave quando o site abre rápido (sem contradição com o tempo bom)', () => {
  const d = good(); d.psi.bytes = 7 * 1048576;
  const fast = by(runChecks(d, goodNet), 'V4');
  assert.equal(fast.status, 'warn');
  assert.match(fast.found, /Abre rápido, mas pesa/);
  d.psi.lcpMs = 5000;
  assert.equal(by(runChecks(d, goodNet), 'V4').status, 'bad');
  d.psi.lcpMs = 1800; d.psi.bytes = 1 * 1048576;
  assert.equal(by(runChecks(d, goodNet), 'V4').status, 'ok');
});

test('tempo de bloqueio (TBT): 200 ms ok, até 600 atenção, acima ruim', () => {
  const d = good();
  for (const [tbt, st] of [[150, 'ok'], [480, 'warn'], [900, 'bad']]) { d.psi.tbtMs = tbt; assert.equal(by(runChecks(d, goodNet), 'V3').status, st, String(tbt)); }
});

test('parsePsi extrai as métricas do Lighthouse e rejeita resposta sem resultado', () => {
  const json = { lighthouseResult: { categories: { performance: { score: 0.62 } }, audits: {
    'largest-contentful-paint': { numericValue: 2634.4 }, 'first-contentful-paint': { numericValue: 812 }, 'total-blocking-time': { numericValue: 480 },
    'speed-index': { numericValue: 3012 }, 'cumulative-layout-shift': { numericValue: 0.033 }, 'server-response-time': { numericValue: 215.6 }, 'total-byte-weight': { numericValue: 3145728 } } } };
  assert.deepEqual(parsePsi(json), { status: 'ok', strategy: 'mobile', score: 62, lcpMs: 2634, fcpMs: 812, tbtMs: 480, speedIndexMs: 3012, ttfbMs: 216, cls: 0.033, bytes: 3145728 });
  assert.equal(parsePsi({}), null);
  assert.equal(parsePsi({ lighthouseResult: {} }), null);
});

const shop = () => ({ ...good(), site: { platform: 'Nuvemshop', schemaTypes: [], cart: true, buy: false, prices: 12, search: true, conditions: ['frete', 'parcel', 'pix'] }, conversion: { ctaAboveFold: 'Conhecer os óleos', whatsapp: true, phone: false, forms: 0, socialProof: true } });

test('tipo de site: loja virtual, conteúdo e serviços', () => {
  assert.equal(detectSiteType(shop()), 'ecommerce');
  assert.equal(detectSiteType({ site: { platform: '', schemaTypes: ['Product'], prices: 0 } }), 'ecommerce');
  assert.equal(detectSiteType({ site: { platform: '', schemaTypes: [], cart: true, prices: 5 } }), 'ecommerce');
  assert.equal(detectSiteType({ site: { platform: '', schemaTypes: [], cart: true, prices: 1 } }), 'servicos');
  assert.equal(detectSiteType({ site: { platform: '', schemaTypes: ['BlogPosting'], prices: 0 } }), 'conteudo');
  assert.equal(detectSiteType(good()), 'servicos');
});

test('loja virtual não é cobrada por formulário nem telefone e ganha itens de compra', () => {
  const r = runChecks(shop(), goodNet);
  const ids = r.map((x) => x.id);
  assert.ok(!ids.includes('C3') && !ids.includes('C4'));
  assert.ok(['C6', 'C7', 'C8'].every((id) => ids.includes(id)));
  assert.ok(r.every((x) => x.status === 'ok'), JSON.stringify(r.filter((x) => x.status !== 'ok')));
  // a mesma página tratada como serviço seria cobrada por formulário e telefone
  const asService = runChecks(shop(), goodNet, 'servicos');
  assert.equal(by(asService, 'C3').status, 'bad');
  assert.equal(by(asService, 'C4').status, 'bad');
  assert.ok(!asService.some((x) => x.id === 'C6'));
});

test('loja virtual sem busca, carrinho e condições de compra: itens ruins', () => {
  const d = shop(); d.site = { ...d.site, cart: false, buy: false, search: false, conditions: [] };
  const r = runChecks(d, goodNet);
  for (const id of ['C6', 'C7', 'C8']) assert.equal(by(r, id).status, 'bad', id);
  d.site.conditions = ['frete'];
  assert.equal(by(runChecks(d, goodNet), 'C8').status, 'warn');
});

test('frases do veredito concordam em número', async () => {
  const { siteHeadline } = await import('../lib/checks.js');
  const { igHeadline } = await import('../lib/instagram.js');
  const { adsHeadline } = await import('../lib/adlibrary.js');
  assert.match(siteHeadline({ level: 'warn', bad: 1, warn: 0 }), /tem 1 ponto a corrigir/);
  assert.match(siteHeadline({ level: 'bad', bad: 3, warn: 1 }), /tem 4 pontos a corrigir/);
  assert.match(siteHeadline({ level: 'ok', bad: 1, warn: 0 }), /Resta 1 ajuste\./);
  assert.match(igHeadline({ level: 'ok', bad: 0, warn: 3 }), /Restam 3 ajustes/);
  assert.match(adsHeadline({ level: 'warn', bad: 0, warn: 1 }), /têm 1 ponto a corrigir/);
});
