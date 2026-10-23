import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCount, parsePostHtml, parseProfileText, parseProfileApi, bioLinkState, analyzeIg, runIgChecks, engagementBenchmark, igHeadline, IG_GROUPS } from '../lib/instagram.js';
import { readFileSync } from 'node:fs';
import { parseAdCard, analyzeAds, runAdChecks, adsHeadline, AD_GROUPS, isAdLibraryUrl } from '../lib/adlibrary.js';
import { summarize } from '../lib/checks.js';
import { detectContext } from '../lib/contexts.js';
import { buildMessages } from '../lib/ai.js';
import { toMarkdown } from '../lib/report.js';

const by = (r, id) => r.find((x) => x.id === id);
const DAY = 86400000;

test('parseCount entende formatos em português e inglês', () => {
  assert.equal(parseCount('1,234'), 1234);
  assert.equal(parseCount('1.234'), 1234);
  assert.equal(parseCount('12.4K'), 12400);
  assert.equal(parseCount('12,4 mil'), 12400);
  assert.equal(parseCount('1,2 mi'), 1200000);
  assert.equal(parseCount('1.2M'), 1200000);
  assert.equal(parseCount('1.234.567'), 1234567);
  assert.equal(parseCount('abc'), null);
});

test('perfil: seguidores, seguindo e posts em pt e en', () => {
  assert.deepEqual(parseProfileText('12K Followers, 340 Following, 1,234 Posts - See Instagram photos'), { followers: 12000, following: 340, posts: 1234 });
  assert.deepEqual(parseProfileText('12,4 mil seguidores, 340 seguindo, 1.234 posts - Veja fotos'), { followers: 12400, following: 340, posts: 1234 });
});

test('post: curtidas, comentários e data em en e pt', () => {
  const en = '<meta property="og:description" content="1,234 likes, 56 comments - acme on October 20, 2025: &quot;Legenda&quot;">';
  const p = parsePostHtml('https://www.instagram.com/p/AAA/', en);
  assert.equal(p.likes, 1234); assert.equal(p.comments, 56); assert.equal(p.isReel, false);
  assert.equal(new Date(p.ts).getUTCFullYear(), 2025);
  const pt = '<meta content="2,3 mil curtidas, 8 comentários - acme em 3 de março de 2025: &quot;x&quot;" property="og:description">';
  const q = parsePostHtml('https://www.instagram.com/reel/BBB/', pt);
  assert.equal(q.likes, 2300); assert.equal(q.comments, 8); assert.equal(q.isReel, true);
  assert.equal(new Date(q.ts).getUTCMonth(), 2);
  assert.equal(parsePostHtml('x', '<html></html>'), null);
});

const post = (daysAgo, likes, comments, isReel = false, now = 1e12) => ({ url: 'u', isReel, likes, comments, ts: now - daysAgo * DAY });

test('Instagram: taxa de engajamento, frequência e formatos', () => {
  const now = 1e12;
  const profile = { headerItems: '1,234 posts | 10K followers | 300 following', ogText: '', bioLink: true };
  const posts = [post(1, 100, 10, true), post(3, 100, 10), post(6, 100, 10, true), post(8, 100, 10)];
  const a = analyzeIg(profile, posts, now);
  assert.equal(a.followers, 10000);
  assert.ok(Math.abs(a.engagementPct - 1.1) < 1e-9);
  assert.equal(a.daysSinceLast, 1);
  assert.ok(Math.abs(a.perWeek - (3 / 7) * 7) < 1e-9);
  assert.equal(a.reelShare, 0.5);
  const r = runIgChecks(a);
  assert.equal(by(r, 'I1').status, 'warn'); // 1,1% com 10 mil: bom ≥ 1,5; atenção ≥ 0,7
  assert.equal(by(r, 'I2').status, 'ok');
  assert.equal(by(r, 'I3').status, 'ok');
  assert.equal(by(r, 'I4').status, 'ok');
  assert.equal(by(r, 'I5').status, 'ok');
  assert.equal(by(r, 'I6').status, 'ok');
});

test('Instagram: perfil parado e sem engajamento vira ruim; curtidas ocultas são sinalizadas', () => {
  const now = 1e12;
  const profile = { headerItems: '200 posts | 50K followers', ogText: '', bioLink: false };
  const a = analyzeIg(profile, [post(60, null, 2), post(90, null, 1)], now);
  assert.equal(a.likesHidden, true);
  const r = runIgChecks(a);
  assert.equal(by(r, 'I1').status, 'bad');
  assert.equal(by(r, 'I4').status, 'bad');
  assert.equal(by(r, 'I5').status, 'bad');
  assert.equal(by(r, 'I6').status, 'na'); // sem confirmação da API, ausência de link não é prova
  assert.match(by(r, 'I1').found, /curtidas ocultas/);
  assert.deepEqual(engagementBenchmark(1000), [3, 1.5]);
});

test('Instagram sem seguidores legíveis: engajamento não verificado', () => {
  const a = analyzeIg({ headerItems: '', ogText: '', bioLink: false }, [post(1, 5, 1)], 1e12);
  assert.equal(by(runIgChecks(a), 'I1').status, 'na');
});

test('Biblioteca de anúncios: lê status, data, variações e destino de um cartão', () => {
  const c = parseAdCard({
    text: 'Active\nLibrary ID: 123456\nStarted running on 10 Oct 2025\n3 ads use this creative and text\nAgende hoje a sua consulta com desconto exclusivo para novos clientes\nSee ad details',
    hrefs: ['https://wa.me/5511999999999'], hasVideo: true,
  });
  assert.equal(c.active, true); assert.equal(c.variants, 3); assert.equal(c.video, true); assert.equal(c.destination, 'whatsapp');
  assert.equal(new Date(c.startTs).getUTCMonth(), 9);
  assert.match(c.copy, /agende hoje/);
  const pt = parseAdCard({ text: 'Ativo\nID da biblioteca: 99\nVeiculação iniciada em 5 de nov. de 2025', hrefs: ['https://loja.com.br/oferta'], hasVideo: false });
  assert.equal(pt.active, true); assert.equal(pt.destination, 'site'); assert.equal(new Date(pt.startTs).getUTCMonth(), 10);
  assert.equal(parseAdCard({ text: 'Inactive\nLibrary ID: 1', hrefs: [] }).active, false);
});

test('Biblioteca de anúncios: análise e itens', () => {
  const now = Date.UTC(2025, 10, 10);
  const mk = (i, video) => ({ text: `Active\nLibrary ID: ${i}\nStarted running on ${i + 1} Oct 2025\nTexto único do anúncio número ${i} com bastante conteúdo`, hrefs: ['https://wa.me/55'], hasVideo: video });
  const raw = { totalText: '24', cards: Array.from({ length: 9 }, (_, i) => mk(i, i < 3)) };
  const a = analyzeAds(raw, now);
  assert.equal(a.active, 9);
  const r = runAdChecks(a);
  for (const id of ['A1', 'A2', 'A3', 'A4', 'A7']) assert.equal(by(r, id).status, 'ok', id);
  assert.equal(by(r, 'A5').status, 'ok'); // mais antigo: 1 out → 40 dias
  assert.equal(by(r, 'A6').status, 'warn'); // mais recente: 9 out → 32 dias
  const none = runAdChecks(analyzeAds({ cards: [] }, now));
  assert.ok(none.every((x) => x.status === 'na'));
  const zero = runAdChecks(analyzeAds({ cards: [{ text: 'Inactive\nLibrary ID: 1', hrefs: [] }] }, now));
  assert.equal(by(zero, 'A1').status, 'bad');
  assert.match(adsHeadline({ level: 'bad', bad: 3, warn: 1 }), /4 pontos/);
});

test('summarize aceita grupos e frases de outros módulos', () => {
  const s = summarize([{ group: 'engajamento', status: 'bad' }, { group: 'frequencia', status: 'ok' }], IG_GROUPS, igHeadline);
  assert.equal(s.overall.level, 'warn');
  assert.match(s.overall.headline, /Instagram/);
  assert.equal(s.groups.engajamento.level, 'bad');
  assert.equal(summarize([], AD_GROUPS, adsHeadline).overall.total, 0);
  assert.match(summarize([{ group: 'presenca', status: 'na' }], AD_GROUPS, adsHeadline).overall.headline, /Não foi possível/);
});

test('detecta o módulo pela URL', () => {
  assert.equal(detectContext('https://www.instagram.com/acme/'), 'instagram');
  assert.equal(detectContext('https://www.facebook.com/ads/library/?active_status=all&view_all_page_id=1'), 'ads');
  assert.equal(isAdLibraryUrl('https://www.facebook.com/acme'), false);
  assert.equal(detectContext('https://www.facebook.com/acme'), 'site');
  assert.equal(detectContext('https://exemplo.com.br/'), 'site');
  assert.equal(detectContext('chrome://extensions'), null);
  assert.equal(detectContext('https://chromewebstore.google.com/detail/x'), null);
});

test('prompt da IA leva só o checklist e proíbe inventar dados', () => {
  const results = [{ id: 'V1', name: 'O site aparece rápido', status: 'bad', found: '5,2 segundos' }, { id: 'E1', name: 'O site é seguro', status: 'ok', found: 'HTTPS' }];
  const summary = summarize(results);
  const msgs = buildMessages({ ctx: { title: 'Diagnóstico rápido do site' }, client: 'Acme', data: { url: 'https://acme.com/' }, results, summary, bigSentence: 'Seu site demora 5,2 segundos.' });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /SOMENTE os dados fornecidos/);
  assert.match(msgs[1].content, /\[RUIM\] O site aparece rápido: 5,2 segundos/);
  assert.match(msgs[1].content, /Cliente: Acme/);
  assert.match(msgs[1].content, /Próximo passo sugerido/);
});

test('relatório .md de outro módulo usa o título e inclui o texto da IA', () => {
  const results = [{ id: 'I1', group: 'engajamento', name: 'X', status: 'bad', found: 'f', problem: 'P', cost: 'C', fix: 'F', weight: 5 }];
  const summary = summarize(results, IG_GROUPS, igHeadline);
  const md = toMarkdown({ client: 'Acme', data: { url: 'https://www.instagram.com/acme/' }, results, summary, date: '2026-10-22', ctx: { title: 'Diagnóstico rápido do Instagram', groups: IG_GROUPS }, bigSentence: 'A cada 100 seguidores...', ai: 'Texto da IA' });
  assert.match(md, /# Diagnóstico rápido do Instagram — Acme/);
  assert.match(md, /## Engajamento — Ruim/);
  assert.match(md, /Resumo para a conversa \(gerado por IA\)/);
  assert.match(md, /Texto da IA/);
  assert.match(md, /O que isso causa: C/);
  assert.match(md, /Como resolver: F/);
});

test('IA: chama a API compatível com OpenAI com chave, modelo e mensagens', async () => {
  const { generateSummary, listModels, PROVIDERS } = await import('../lib/ai.js');
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    return url.endsWith('/models') ? ok({ data: [{ id: 'b' }, { id: 'a' }] }) : ok({ choices: [{ message: { content: ' Resumo pronto ' } }] });
  };
  try {
    const msgs = [{ role: 'user', content: 'oi' }];
    assert.equal(await generateSummary({ provider: 'groq', apiKey: 'k', model: '' }, msgs), 'Resumo pronto');
    assert.equal(calls[0].url, `${PROVIDERS.groq.base}/chat/completions`);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.model, PROVIDERS.groq.model);
    assert.deepEqual(sent.messages, msgs);
    await generateSummary({ provider: 'xai', apiKey: 'k', model: 'grok-x' }, msgs);
    assert.equal(calls[1].url, `${PROVIDERS.xai.base}/chat/completions`);
    assert.equal(JSON.parse(calls[1].init.body).model, 'grok-x');
    assert.deepEqual(await listModels({ provider: 'groq', apiKey: 'k' }), ['a', 'b']);
    await assert.rejects(generateSummary({ provider: 'groq', apiKey: '' }, msgs), /chave/);
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key' } }) });
    await assert.rejects(generateSummary({ provider: 'groq', apiKey: 'x' }, msgs), /Invalid API Key/);
  } finally { globalThis.fetch = real; }
});

test('IA: conteúdo público entra no prompt só quando informado e fica separado dos dados medidos', async () => {
  const { contentBlock, buildMessages, withDefaults, PROVIDERS } = await import('../lib/ai.js');
  const results = [{ id: 'V1', name: 'O site aparece rápido', status: 'bad', found: '5,2 segundos' }];
  const summary = summarize(results);
  const base = { ctx: { id: 'site', title: 'Diagnóstico rápido do site' }, client: '', data: { url: 'https://a.com/' }, results, summary, bigSentence: '' };
  const without = buildMessages(base)[1].content;
  assert.doesNotMatch(without, /Conteúdo público observado/);
  assert.doesNotMatch(without, /Leitura do conteúdo/);
  const withC = buildMessages({ ...base, content: { h1: 'Sorriso saudável', headings: ['Tratamentos'], ctas: ['Agendar avaliação'], description: 'd', body: 'Texto da página' } })[1].content;
  assert.match(withC, /não são dados medidos/);
  assert.match(withC, /Título principal: Sorriso saudável/);
  assert.match(withC, /Leitura do conteúdo \(opinião da IA\)/);
  assert.match(withC, /proposta de valor/);
  assert.match(contentBlock('instagram', { bio: 'Clínica', posts: [{ isReel: true, likes: 10, comments: 2, caption: 'Agende sua avaliação gratuita' }] }), /1\. \[Reels, 10 curtidas, 2 comentários\] Agende sua avaliação gratuita/);
  // sem texto de verdade, não há o que ler: o bloco fica vazio e a leitura não é pedida
  assert.equal(contentBlock('instagram', { bio: 'acme 120 posts 12,4 mil seguidores 300 seguindo', posts: [{ caption: 'x' }, { caption: '' }] }), '');
  assert.match(contentBlock('ads', { copies: ['Agende hoje'] }), /1\. Agende hoje/);
  assert.equal(contentBlock('ads', { copies: [] }), '');
  assert.equal(PROVIDERS.groq.model, 'openai/gpt-oss-120b');
  // chave da equipe só entra quando o usuário não tem chave própria
  const team = { provider: 'groq', apiKey: 'team', model: '' };
  assert.equal(withDefaults({ provider: 'xai', apiKey: '', model: 'x' }, team).apiKey, 'team');
  assert.equal(withDefaults({ provider: 'xai', apiKey: 'own', model: 'x' }, team).apiKey, 'own');
  assert.equal(withDefaults({ provider: 'xai', apiKey: '', model: 'x' }, {}).apiKey, '');
});

test('Instagram: legenda do post e textos dos anúncios para a leitura por IA', async () => {
  const p = parsePostHtml('https://www.instagram.com/p/A/', '<meta property="og:description" content="10 likes, 2 comments - acme on October 20, 2025: &quot;Agende sua avaliação gratuita&quot;.">');
  assert.equal(p.caption, 'Agende sua avaliação gratuita');
  const { adCopies } = await import('../lib/adlibrary.js');
  const raw = { cards: [
    { text: 'Active\nLibrary ID: 1\nStarted running on 1 Oct 2025\nAgende hoje a sua consulta com desconto para novos clientes', hrefs: [] },
    { text: 'Active\nLibrary ID: 2\nAgende hoje a sua consulta com desconto para novos clientes', hrefs: [] },
    { text: 'Inactive\nLibrary ID: 3\nTexto de anúncio inativo que não deve entrar na lista', hrefs: [] },
  ] };
  assert.deepEqual(adCopies(raw), ['Agende hoje a sua consulta com desconto para novos clientes']);
});

test('IA: texto devolvido sai sem markdown nem raciocínio', async () => {
  const { cleanAiText } = await import('../lib/ai.js');
  assert.equal(cleanAiText('<think>x</think>## Título\n**Negrito** e __outro__  \n- item'), 'Título\nNegrito e outro\n- item');
  assert.equal(cleanAiText(null), '');
});

const igFixture = () => JSON.parse(readFileSync(new URL('./fixtures/ig-profile.json', import.meta.url), 'utf8'));

test('Instagram: lê a resposta real da API interna (seguidores, bio, link na bio e posts)', () => {
  const api = parseProfileApi(igFixture());
  assert.equal(api.handle, 'instagram');
  assert.equal(api.followers, 686460244);
  assert.equal(api.isPrivate, false);
  assert.ok(api.links.some((u) => /help\.instagram\.com/.test(u)));
  assert.equal(api.posts.length, 12);
  const p = api.posts[0];
  assert.match(p.url, /^https:\/\/www\.instagram\.com\/reel\/[\w-]+\/$/);
  assert.equal(p.isReel, true);
  assert.ok(p.likes > 0 && p.comments > 0 && p.ts > 1e12 && p.caption.length > 0);
  assert.equal(parseProfileApi({}), null);
  assert.equal(parseProfileApi({ data: { user: null } }), null);
});

test('Instagram: curtidas ocultas e posts fixados na API', () => {
  const j = igFixture();
  const edges = j.data.user.edge_owner_to_timeline_media.edges;
  edges[0].node.pinned_for_users = [{ username: 'x' }];
  edges[1].node.like_and_view_counts_disabled = true;
  const api = parseProfileApi(j);
  assert.equal(api.posts.length, 11); // o fixado sai
  assert.equal(api.posts[0].likes, null); // curtidas ocultas viram "não informado", não zero
  j.data.user.hide_like_and_view_counts = true;
  assert.ok(parseProfileApi(j).posts.every((x) => x.likes === null));
});

test('link na bio: só diz que não tem quando a API respondeu e nada indica link', () => {
  const api = parseProfileApi(igFixture());
  assert.equal(bioLinkState({ api, domLink: false }), 'yes');
  const noLink = { ...api, links: [], bio: 'Clínica odontológica' };
  assert.equal(bioLinkState({ api: noLink, domLink: false }), 'no');
  assert.equal(bioLinkState({ api: noLink, domLink: true }), 'yes'); // a página mostra um link
  assert.equal(bioLinkState({ api: { ...noLink, bio: 'Agende: wa.me/5511999' }, domLink: false }), 'yes'); // link no texto da bio
  assert.equal(bioLinkState({ api: null, domLink: false, bioText: '' }), 'unknown'); // sem API, ausência não é prova
  assert.equal(bioLinkState({ api: null, domLink: true }), 'yes');
});

test('Instagram: link na bio em três estados nos itens e a análise usa seguidores da API', () => {
  const api = parseProfileApi(igFixture());
  const a = analyzeIg({ followers: api.followers, postsCount: api.postsCount, bioLinkState: 'yes', bioLinkUrl: api.links[0] }, api.posts, Date.now());
  assert.equal(a.followers, 686460244);
  assert.equal(a.sampled, 12);
  assert.match(by(runIgChecks(a), 'I6').found, /tem link na bio \(http/);
  assert.equal(by(runIgChecks({ ...a, bioLink: 'no' }), 'I6').status, 'bad');
  assert.equal(by(runIgChecks({ ...a, bioLink: 'unknown' }), 'I6').status, 'na');
});
