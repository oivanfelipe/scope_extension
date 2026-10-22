import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, summarize, speedLevel, mainSpeedMs, fmtSeconds, CHECKS, GROUPS } from '../lib/checks.js';
import { parseRobots } from '../lib/network.js';
import { toMarkdown, toShortText, speedSentence } from '../lib/report.js';

const good = () => ({
  url: 'https://exemplo.com.br/', origin: 'https://exemplo.com.br', host: 'exemplo.com.br', title: 'Exemplo',
  speed: { lcpMs: 1800, fcpMs: 900, loadMs: 2200, ttfbMs: 300, requests: 40 },
  structure: { https: true, title: 'Consultoria de marketing em São Paulo', description: 'A descrição tem um tamanho adequado para aparecer completa nos resultados de busca do Google.', h1Count: 1, h1Text: 'Marketing que vende', imgTotal: 10, imgWithAlt: 10, viewport: true, noindex: false, schemaCount: 2 },
  tracking: { gtmIds: ['GTM-ABC123'], ga4Ids: ['G-ABCDEF1'], adsIds: ['AW-123456789'], adsRequest: false, metaPixel: true, universalAnalytics: false, others: [] },
  conversion: { ctaAboveFold: 'Fale com um especialista', whatsapp: true, phone: true, forms: 1, socialProof: true },
});
const goodNet = { robots: { status: 'found', blocksAll: false, sitemaps: [] }, sitemap: { status: 'found' } };
const bad = () => ({
  ...good(),
  speed: { lcpMs: 5200, fcpMs: 3000, loadMs: 7000, ttfbMs: 2500, requests: 220 },
  structure: { https: false, title: '', description: '', h1Count: 0, h1Text: '', imgTotal: 10, imgWithAlt: 2, viewport: false, noindex: true, schemaCount: 0 },
  tracking: { gtmIds: [], ga4Ids: [], adsIds: [], adsRequest: false, metaPixel: false, universalAnalytics: true, others: [] },
  conversion: { ctaAboveFold: null, whatsapp: false, phone: false, forms: 0, socialProof: false },
});
const badNet = { robots: { status: 'missing', blocksAll: false, sitemaps: [] }, sitemap: { status: 'missing' } };
const by = (results, id) => results.find((r) => r.id === id);

test('todo item tem id único, área válida e texto "por que importa"', () => {
  const ids = CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CHECKS) {
    assert.ok(GROUPS.some((g) => g.id === c.group), c.id);
    assert.ok(c.name && c.why, c.id);
  }
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
  for (const id of ['V1', 'V2', 'V3', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4', 'C5']) assert.equal(by(r, id).status, 'bad', id);
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
  assert.equal(s.overall.total, CHECKS.length - 1);
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
  assert.match(md, /0 de 21 itens estão bons/);
  assert.match(md, /5,2 segundos/);
  assert.match(md, /❌ \*\*O site aparece rápido\./);
  assert.match(md, /Por que importa:/);
  assert.match(toShortText({ client: '', data, results, summary }), /Principais problemas:/);
});
