import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, rulesFor } from '../lib/robots.js';

const txt = `
User-agent: *
Disallow: /admin
Disallow: /cart/
Allow: /admin/public
Disallow: /*?sort=
Disallow: /*.pdf$

User-agent: GPTBot
Disallow: /

User-agent: Googlebot
User-agent: Bingbot
Disallow: /private
Sitemap: https://exemplo.com/sitemap.xml
`;

test('parse: grupos, agentes múltiplos e sitemaps', () => {
  const p = parseRobots(txt);
  assert.equal(p.groups.length, 3);
  assert.deepEqual(p.groups[2].agents, ['googlebot', 'bingbot']);
  assert.deepEqual(p.sitemaps, ['https://exemplo.com/sitemap.xml']);
});

test('Googlebot usa o grupo específico e ignora o "*"', () => {
  const p = parseRobots(txt);
  assert.equal(isAllowed(p, 'googlebot', '/admin').allowed, true);
  assert.equal(isAllowed(p, 'googlebot', '/private/x').allowed, false);
});

test('"*" vale para quem não tem grupo próprio; Allow mais específico vence', () => {
  const p = parseRobots(txt);
  assert.equal(isAllowed(p, 'claudebot', '/admin/x').allowed, false);
  assert.equal(isAllowed(p, 'claudebot', '/admin/public/a').allowed, true);
  assert.equal(isAllowed(p, 'claudebot', '/loja?sort=preco').allowed, false);
  assert.equal(isAllowed(p, 'claudebot', '/manual.pdf').allowed, false);
  assert.equal(isAllowed(p, 'claudebot', '/manual.pdf?x=1').allowed, true);
});

test('GPTBot bloqueado por Disallow: /', () => {
  const p = parseRobots(txt);
  assert.equal(isAllowed(p, 'gptbot', '/').allowed, false);
  assert.equal(rulesFor(p, 'gptbot').matched, 'gptbot');
});

test('Disallow vazio libera tudo; robots vazio libera tudo', () => {
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:'), 'googlebot', '/x').allowed, true);
  assert.equal(isAllowed(parseRobots(''), 'googlebot', '/x').allowed, true);
});
