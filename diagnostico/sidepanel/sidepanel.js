import { collectPage } from '../lib/collector.js';
import { fetchRobots, fetchSitemap } from '../lib/network.js';
import { LEVEL_LABEL, SPEED_LIMITS, fmtSeconds, mainSpeedMs, runChecks, speedLevel, summarize, topLosses } from '../lib/checks.js';
import { CONTEXTS, detectContext } from '../lib/contexts.js';
import { analyzeIg, collectInstagram, engagementBenchmark, parsePostHtml, runIgChecks } from '../lib/instagram.js';
import { adCopies, analyzeAds, collectAdLibrary, runAdChecks } from '../lib/adlibrary.js';
import { PROVIDERS, buildMessages, generateSummary, listModels, loadAi, resolveAi, saveAi } from '../lib/ai.js';
import { fileStem, speedSentence, toMarkdown, toShortText } from '../lib/report.js';
import { addEntry, loadHost, saveClient } from '../lib/storage.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const banner = $('#banner');
const rerunBtn = $('#rerun');
const fullBtn = $('#fullscreen');

const forcedTabId = new URLSearchParams(location.search).get('tabId'); // aba grande aberta pelo botão "Tela grande"
if (forcedTabId) fullBtn.hidden = true;

// state.run = { ctx, key, data, results, summary, big }  ·  big = { label, value, sentence, level, bar? }
const state = { run: null, client: '', history: [], previous: null, running: false, analyzedUrl: null, ai: { text: '', loading: false, error: '' } };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const SYM = { ok: '✓', warn: '!', bad: '✕', na: '–' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtPct = (n) => n.toFixed(1).replace('.', ',');

async function getTargetTab() {
  if (forcedTabId) return chrome.tabs.get(Number(forcedTabId));
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function showState(title, msg) {
  view.innerHTML = `<div class="card state"><h2>${esc(title)}</h2><p>${esc(msg)}</p></div>`;
}

function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

const runIn = async (tab, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func, args }))[0]?.result;

// ------------------------------------------------------------------ Módulos

const SPEED_CONTEXT = {
  bad: 'Na prática: quem chega por um anúncio ou pelo Google e espera tanto tempo tende a fechar a página antes de ver a sua oferta. Você paga pelo clique e perde o visitante.',
  warn: 'Na prática: o site está acima do ideal. Parte dos visitantes, principalmente no celular, pode desistir antes de ver a oferta.',
  ok: 'Na prática: o site abre rápido, o que ajuda a manter o visitante na página e o Google a valorizar o site.',
};
const ENGAGEMENT_CONTEXT = {
  bad: 'Na prática: o perfil tem seguidores, mas só uma pequena parte reage. O Instagram entrega os posts para cada vez menos gente.',
  warn: 'Na prática: há espaço para o conteúdo gerar mais reação, o que aumenta o alcance de cada post.',
  ok: 'Na prática: a audiência reage bem ao conteúdo, o que ajuda cada post a chegar a mais gente.',
};

async function runSite(tab) {
  showState('Analisando o site…', 'Leva alguns segundos. Mantenha a aba aberta.');
  const data = await runIn(tab, collectPage);
  if (!data) throw new Error('A página não devolveu dados. Recarregue a aba e tente de novo.');
  const net = { robots: await fetchRobots(data.origin) };
  net.sitemap = await fetchSitemap(data.origin, net.robots.sitemaps);
  const results = runChecks(data, net);
  const ms = mainSpeedMs(data);
  return {
    data, results, key: data.host, content: data.content,
    big: ms == null ? { label: 'Tempo de carregamento', value: null, sentence: 'Não foi possível medir. Use "Medir velocidade de novo".', level: 'na' }
      : { label: 'Tempo para o site aparecer', value: `${fmtSeconds(ms)}`, unit: ' segundos', sentence: speedSentence(ms), level: speedLevel(ms), barMs: ms, context: SPEED_CONTEXT[speedLevel(ms)], hint: 'Medido neste computador. Para a medição mais fiel, use "Medir velocidade de novo".' },
    historyText: ms == null ? null : `${fmtSeconds(ms)} s`,
  };
}

async function runInstagram(tab) {
  showState('Lendo o perfil do Instagram…', 'Leva cerca de 10 a 20 segundos. Mantenha a aba aberta.');
  const profile = await runIn(tab, collectInstagram);
  if (!profile?.isProfile) { const e = new Error('Abra o perfil que quer analisar (instagram.com/nome-do-perfil) e clique em Reanalisar.'); e.title = 'Abra um perfil do Instagram'; throw e; }
  if (profile.isPrivate) { const e = new Error('Este perfil é privado: não dá para ler os posts.'); e.title = 'Perfil privado'; throw e; }
  const links = profile.postLinks.slice(0, 12);
  const posts = [];
  for (let i = 0; i < links.length; i++) {
    showState('Lendo o perfil do Instagram…', `Lendo post ${i + 1} de ${links.length}. Mantenha a aba aberta.`);
    try {
      const html = await runIn(tab, async (u) => (await (await fetch(u, { credentials: 'include' })).text()).slice(0, 150000), [links[i]]);
      const p = html && parsePostHtml(links[i], html);
      if (p) posts.push(p);
    } catch { /* post ignorado */ }
    await sleep(600);
  }
  const a = analyzeIg(profile, posts);
  const results = runIgChecks(a);
  const data = { ...profile, url: profile.url, host: `instagram.com/${profile.handle}` };
  let big;
  if (a.engagementPct == null) big = { label: 'Taxa de engajamento', value: null, sentence: 'Não foi possível calcular a taxa de engajamento. Role o perfil para carregar posts e reanalise.', level: 'na' };
  else {
    const [good, mid] = engagementBenchmark(a.followers);
    const level = a.engagementPct >= good ? 'ok' : a.engagementPct >= mid ? 'warn' : 'bad';
    big = {
      label: 'Taxa de engajamento', value: fmtPct(a.engagementPct), unit: '%', level,
      sentence: `A cada 100 seguidores, cerca de ${fmtPct(a.engagementPct)} interagem (curtem ou comentam) em cada post. ${level === 'ok' ? 'Isso é bom.' : level === 'warn' ? 'Há espaço para melhorar.' : 'Isso é baixo para o porte do perfil.'}`,
      context: ENGAGEMENT_CONTEXT[level],
      hint: `Calculado com ${a.sampled} posts recentes e ${a.followers.toLocaleString('pt-BR')} seguidores. Referência de mercado aproximada.`,
    };
  }
  const content = { bio: profile.headerText, posts };
  return { data, results, key: data.host, content, big, historyText: a.engagementPct == null ? null : `${fmtPct(a.engagementPct)}%`, notes: posts.length === 0 ? 'Nenhum post pôde ser lido. Confirme que está logado no Instagram e role o perfil.' : '' };
}

async function runAds(tab) {
  showState('Lendo a Biblioteca de Anúncios…', 'Leitura dos anúncios que já estão carregados na tela.');
  const raw = await runIn(tab, collectAdLibrary);
  const a = analyzeAds(raw);
  const results = runAdChecks(a);
  const data = { url: raw.url, host: raw.key, tracking: {} };
  return {
    data, results, key: raw.key, content: { copies: adCopies(raw) },
    big: a.analyzed === 0
      ? { label: 'Anúncios ativos', value: null, sentence: 'Não conseguimos ler anúncios. Abra a Biblioteca de Anúncios do anunciante, role a página para carregar e reanalise.', level: 'na' }
      : { label: 'Anúncios ativos lidos', value: String(a.active), unit: a.active === 1 ? ' anúncio' : ' anúncios', level: a.active >= 8 ? 'ok' : a.active >= 3 ? 'warn' : 'bad',
        sentence: a.active ? `A empresa tem ${a.active} anúncio(s) ativo(s) entre os ${a.analyzed} lidos na tela.` : 'A empresa não tem anúncios ativos na Meta neste momento.',
        context: a.active === 0 ? 'Na prática: sem anúncios ativos, a empresa depende só de quem já a conhece, e os concorrentes que anunciam ficam com os clientes novos.' : a.active < 8 ? 'Na prática: poucos anúncios significam pouco teste. Quem anuncia bem coloca várias mensagens no ar ao mesmo tempo e descobre qual convence mais.' : 'Na prática: há volume saudável de anúncios para testar mensagens diferentes.',
        hint: 'Quanto mais você rolar a página antes de analisar, mais completa fica a leitura. A Biblioteca não mostra gasto nem resultados.' },
    historyText: a.analyzed ? `${a.active} ativos` : null,
  };
}

const RUNNERS = { site: runSite, instagram: runInstagram, ads: runAds };

// ------------------------------------------------------------------ Análise

async function analyze() {
  if (state.running) return;
  state.running = true;
  rerunBtn.disabled = true;
  banner.hidden = true;
  try {
    const tab = await getTargetTab();
    const ctxId = tab && detectContext(tab.url);
    if (!ctxId) { showState('Esta aba não pode ser analisada', 'Abra o site do cliente, o perfil do Instagram ou a Biblioteca de Anúncios (um endereço http ou https; não vale chrome://, Chrome Web Store ou nova aba) e clique em Reanalisar.'); return; }
    const ctx = CONTEXTS[ctxId];
    let out;
    try { out = await RUNNERS[ctxId](tab); } catch (e) { showState(e.title || 'Não consegui ler a página', e.title ? e.message : `${e.message || e}. Se a aba acabou de abrir, aguarde o carregamento e tente de novo.`); return; }

    const summary = summarize(out.results, ctx.groups, ctx.headline);
    state.run = { ctx, key: out.key, data: out.data, results: out.results, summary, big: out.big, content: out.content || null, notes: out.notes || '' };
    state.analyzedUrl = tab.url;
    state.ai = { text: '', loading: false, error: '' };

    const saved = await loadHost(out.key);
    state.client = saved.client || '';
    state.previous = saved.entries[0] || null;
    const o = summary.overall;
    const after = await addEntry(out.key, { ts: Date.now(), url: out.data.url, ok: o.ok, total: o.total, bigText: out.historyText, items: Object.fromEntries(out.results.map((r) => [r.id, r.status])) });
    state.history = after.entries;
    render();
  } catch (e) {
    showState('Algo deu errado', String(e.message || e));
  } finally {
    state.running = false;
    rerunBtn.disabled = false;
  }
}

/** Recarrega a aba sem cache e mede de novo: medição mais fiel do tempo de carregamento (só no site). */
async function remeasure() {
  const tab = await getTargetTab();
  if (!tab) return;
  showState('Recarregando o site para medir a velocidade…', 'Aguarde até a página terminar de carregar.');
  await new Promise((resolve) => {
    const done = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); } };
    chrome.tabs.onUpdated.addListener(done);
    chrome.tabs.reload(tab.id, { bypassCache: true });
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, 25000);
  });
  await sleep(1500);
  await analyze();
}

// ------------------------------------------------------------------ Tela

function bigCard() {
  const { big } = state.run;
  if (big.value == null) return `<section class="card speed"><div class="label">${esc(big.label)}</div><p>${esc(big.sentence)}</p></section>`;
  const bar = big.barMs == null ? '' : `<div class="bar" role="img" aria-label="Escala de 0 a 6 segundos"><i style="left:${Math.min(100, (big.barMs / 6000) * 100)}%"></i></div>
    <div class="bar-scale"><span>0 s</span><span>${fmtSeconds(SPEED_LIMITS.OK_MS)} s ideal</span><span>${fmtSeconds(SPEED_LIMITS.WARN_MS)} s</span><span>6 s+</span></div>`;
  return `<section class="card speed ${big.level}">
    <div class="label">${esc(big.label)}</div>
    <div class="num">${esc(big.value)}<small>${esc(big.unit || '')}</small></div>
    <p>${esc(big.sentence)}</p>${bar}
    ${big.context ? `<p class="ctx">${esc(big.context)}</p>` : ''}
    ${big.hint ? `<p class="hint">${esc(big.hint)}</p>` : ''}
  </section>`;
}

function heroCard() {
  const o = state.run.summary.overall;
  return `<section class="card hero ${o.level}">
    <div class="big">${o.ok}<small> de ${o.total} itens estão bons</small></div>
    <p>${esc(o.headline)}</p>
    <div class="counts"><span>✕ ${o.bad} ruins</span><span>! ${o.warn} em atenção</span><span>✓ ${o.ok} bons</span></div>
  </section>`;
}

function itemCard(r) {
  return `<div class="item ${r.status}"><span class="dot ${r.status}" aria-hidden="true">${SYM[r.status]}</span><div><h3>${esc(r.problem)}</h3>
    <div class="row"><small>O que encontramos</small><p>${esc(r.found)}</p></div>
    <div class="row cost"><small>O que isso causa</small><p>${esc(r.cost)}</p></div>
    <div class="row fix"><small>Como resolver</small><p>${esc(r.fix)}</p></div></div></div>`;
}

function groupCard(g) {
  const gs = state.run.summary.groups[g.id];
  const items = state.run.results.filter((r) => r.group === g.id);
  const issues = items.filter((r) => r.status === 'bad' || r.status === 'warn').sort((a, b) => (a.status === b.status ? (b.weight ?? 0) - (a.weight ?? 0) : a.status === 'bad' ? -1 : 1));
  const goods = items.filter((r) => r.status === 'ok');
  const unknown = items.filter((r) => r.status === 'na');
  const row = (r, sym) => `<li><span class="dot ${r.status}" aria-hidden="true">${sym}</span><div><b>${esc(r.name)}</b><span>${esc(r.found)}</span></div></li>`;
  return `<section class="card group">
    <h2>${esc(g.name)} <span class="badge ${gs.level}">${LEVEL_LABEL[gs.level] || 'Sem dados'}${gs.total ? ` · ${gs.ok}/${gs.total}` : ''}</span></h2>
    <p class="sub">${esc(g.sub)}</p>
    ${issues.length ? `<div class="items">${issues.map(itemCard).join('')}</div>` : ''}
    ${goods.length ? `<details class="goods" ${issues.length ? '' : 'open'}><summary>Ver o que está bom (${goods.length})</summary><ul>${goods.map((r) => row(r, SYM.ok)).join('')}</ul></details>` : ''}
    ${unknown.length ? `<details class="goods unk"><summary>Não verificado (${unknown.length})</summary><ul>${unknown.map((r) => row(r, SYM.na)).join('')}</ul></details>` : ''}
  </section>`;
}

function lossCard() {
  const losses = topLosses(state.run.results);
  if (!losses.length) return '';
  return `<section class="card loss"><span class="tag">Onde está perdendo clientes</span><p class="sub">Os ${losses.length === 1 ? 'ponto' : losses.length + ' pontos'} com maior impacto no negócio, em ordem.</p>
    <ol>${losses.map((r, i) => `<li><span class="dot ${r.status}" aria-hidden="true">${i + 1}</span><div><b>${esc(r.problem)}</b><span>${esc(r.cost)}</span></div></li>`).join('')}</ol></section>`;
}

function historyCard() {
  const o = state.run.summary.overall;
  let delta = '';
  if (state.previous) {
    const diff = o.ok - state.previous.ok;
    const when = new Date(state.previous.ts).toLocaleDateString('pt-BR');
    delta = diff === 0 ? `<div class="delta">Sem mudança desde a análise de ${when}.</div>`
      : `<div class="delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${diff} ${Math.abs(diff) === 1 ? 'item' : 'itens'} bons desde a análise de ${when}.</div>`;
  }
  const rows = state.history.slice(0, 6).map((e) => `<li><span>${new Date(e.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span><span>${e.ok} de ${e.total} bons${e.bigText ? ` · ${esc(e.bigText)}` : ''}</span></li>`).join('');
  return `<section class="card history"><h2>Histórico</h2>${delta}<ul>${rows}</ul></section>`;
}

function aiCard(settings) {
  const { ai } = state;
  const provider = settings.provider;
  const ready = settings.apiKey || settings.hasTeamKey;
  return `<section class="card ai">
    <h2>Análise com IA</h2>
    ${ai.text ? `<div class="ai-text">${esc(ai.text)}</div>` : '<p class="sub">A IA escreve, em linguagem simples, os 3 pontos mais importantes, uma leitura do conteúdo (opinião da IA, separada dos dados medidos) e um próximo passo para a conversa com o cliente.</p>'}
    ${ai.error ? `<p class="ai-error">${esc(ai.error)}</p>` : ''}
    <label class="check"><input id="ai-content" type="checkbox" ${settings.sendContent ? 'checked' : ''}> <span>Enviar também o conteúdo público (textos da página, bio e legendas, ou textos dos anúncios) para a leitura qualitativa</span></label>
    <div class="tools"><button class="btn btn-red" id="ai-go" type="button" ${ai.loading ? 'disabled' : ''}>${ai.loading ? 'Gerando…' : ai.text ? 'Gerar de novo' : 'Gerar análise com IA'}</button>${ai.text ? '<button class="btn" id="ai-copy" type="button">Copiar análise da IA</button>' : ''}</div>
    <details class="settings" ${ready ? '' : 'open'}><summary>Configurar IA ${settings.hasTeamKey && !settings.apiKey ? '(chave da equipe ativa)' : ''}</summary>
      <label>Provedor <select id="ai-provider">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}" ${k === provider ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Chave da API <input id="ai-key" type="password" autocomplete="off" value="${esc(settings.apiKey)}" placeholder="${settings.hasTeamKey ? 'vazio = usa a chave da equipe' : 'cole a sua chave'}"></label>
      <label>Modelo <input id="ai-model" list="ai-models" value="${esc(settings.model)}" placeholder="${esc(PROVIDERS[provider].model)}"><datalist id="ai-models"></datalist></label>
      <div class="tools"><button class="btn" id="ai-save" type="button">Salvar</button><button class="btn" id="ai-models-btn" type="button">Listar modelos</button></div>
      <p class="hint">Sem a opção de conteúdo, a IA recebe apenas o resultado do checklist. Com ela, recebe também os textos públicos da página, da bio, das legendas ou dos anúncios. Nunca recebe dados de login nem de navegação.</p>
    </details>
  </section>`;
}

async function render() {
  const { ctx, data, notes } = state.run;
  const settings = await loadAi();
  const isSite = ctx.id === 'site';
  const others = isSite && data.tracking.others.length ? `<p class="others">Outras ferramentas encontradas: ${esc(data.tracking.others.join(', '))}.</p>` : '';
  const betaNote = ctx.beta ? `<div class="banner beta">Módulo em teste: a leitura depende da estrutura da página, que a plataforma pode mudar. Confira os números na tela antes de apresentar.</div>` : '';
  view.innerHTML = `
    ${betaNote}
    <section class="card site">
      <input id="client" type="text" placeholder="Nome do cliente (opcional)" value="${esc(state.client)}" aria-label="Nome do cliente">
      <div class="url">${esc(data.url)}</div>
      ${notes ? `<div class="url">${esc(notes)}</div>` : ''}
    </section>
    ${heroCard()}
    ${bigCard()}
    ${lossCard()}
    ${ctx.groups.map(groupCard).join('')}
    ${others}
    <div class="tools">
      ${isSite ? '<button class="btn btn-red" id="remeasure" type="button">Medir velocidade de novo</button>' : ''}
      <button class="btn" id="dl" type="button">Baixar .md</button>
      <button class="btn" id="copy" type="button">Copiar resumo</button>
    </div>
    ${aiCard(settings)}
    ${historyCard()}`;
}

// ------------------------------------------------------------------ Ações

function reportInput() {
  const { ctx, data, results, summary, big } = state.run;
  return { client: state.client.trim(), data, results, summary, date: today(), ctx, bigSentence: big.sentence, bigContext: big.context, ai: state.ai.text };
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const readAiForm = () => ({ provider: $('#ai-provider').value, apiKey: $('#ai-key').value.trim(), model: $('#ai-model').value.trim(), sendContent: $('#ai-content').checked });

document.addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (!id) return;
  if (id === 'dl') { download(`${fileStem(state.run.data.host, today())}.md`, toMarkdown(reportInput()), 'text/markdown'); toast('Arquivo baixado'); }
  if (id === 'copy') { try { await navigator.clipboard.writeText(toShortText(reportInput())); toast('Resumo copiado'); } catch { toast('Não foi possível copiar'); } }
  if (id === 'ai-copy') { try { await navigator.clipboard.writeText(state.ai.text); toast('Resumo da IA copiado'); } catch { toast('Não foi possível copiar'); } }
  if (id === 'remeasure') remeasure();
  if (id === 'banner-go') analyze();
  if (id === 'ai-save') { await saveAi(readAiForm()); toast('IA configurada'); }
  if (id === 'ai-models-btn') {
    try {
      const models = await listModels(await resolveAi(readAiForm()));
      $('#ai-models').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
      toast(`${models.length} modelos encontrados: clique no campo Modelo`);
    } catch (err) { toast(String(err.message || err).slice(0, 80)); }
  }
  if (id === 'ai-go') {
    const form = $('#ai-key') ? readAiForm() : await loadAi();
    await saveAi(form);
    state.ai = { text: '', loading: true, error: '' };
    await render();
    try {
      const { ctx, data, results, summary, big, content } = state.run;
      const settings = await resolveAi(form);
      state.ai = { text: await generateSummary(settings, buildMessages({ ctx, client: state.client.trim(), data, results, summary, bigSentence: big.sentence, content: form.sendContent ? content : null })), loading: false, error: '' };
    } catch (err) { state.ai = { text: '', loading: false, error: String(err.message || err) }; }
    await render();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'client' && state.run) { state.client = e.target.value; saveClient(state.run.key, state.client); }
  if (e.target.id === 'ai-provider') { const m = $('#ai-model'); m.value = ''; m.placeholder = PROVIDERS[e.target.value].model; }
});

rerunBtn.addEventListener('click', analyze);
fullBtn.addEventListener('click', async () => {
  const tab = await getTargetTab();
  if (tab) chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel/index.html?tabId=${tab.id}`) });
});

// Aviso quando o usuário troca de página depois da análise
async function checkTabChange() {
  if (state.running || !state.analyzedUrl) return;
  const tab = await getTargetTab().catch(() => null);
  if (!tab || !detectContext(tab.url) || tab.url === state.analyzedUrl) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.innerHTML = `<span>Você abriu outra página. O resultado abaixo é da página anterior.</span><button id="banner-go" class="btn btn-red" type="button">Analisar esta</button>`;
}
chrome.tabs.onActivated.addListener(checkTabChange);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') checkTabChange(); });

analyze();
