import { collectPage } from '../lib/collector.js';
import { fetchRobots, fetchSitemap } from '../lib/network.js';
import { GROUPS, LEVEL_LABEL, SPEED_LIMITS, fmtSeconds, mainSpeedMs, runChecks, speedLevel, summarize } from '../lib/checks.js';
import { fileStem, speedSentence, toMarkdown, toShortText } from '../lib/report.js';
import { addEntry, loadHost, saveClient } from '../lib/storage.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const banner = $('#banner');
const rerunBtn = $('#rerun');
const fullBtn = $('#fullscreen');

const forcedTabId = new URLSearchParams(location.search).get('tabId'); // aba grande aberta pelo botão "Tela grande"
if (forcedTabId) fullBtn.hidden = true;

const state = { data: null, results: [], summary: null, client: '', history: [], running: false, analyzedUrl: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ICON = { ok: '✅', warn: '⚠️', bad: '❌', na: '➖' };
const isAnalyzable = (url) => /^https?:\/\//i.test(url || '') && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ------------------------------------------------------------------ Análise

async function analyze() {
  if (state.running) return;
  state.running = true;
  rerunBtn.disabled = true;
  banner.hidden = true;
  try {
    const tab = await getTargetTab();
    if (!tab || !isAnalyzable(tab.url)) {
      showState('Esta aba não pode ser analisada', 'Abra o site do cliente (um endereço http ou https; não vale chrome://, Chrome Web Store ou nova aba) e clique em Reanalisar.');
      return;
    }
    showState('Analisando o site…', 'Leva alguns segundos. Mantenha a aba aberta.');
    let data;
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectPage });
      data = res?.result;
    } catch (e) {
      showState('Não consegui ler a página', `${e.message || e}. Se a aba acabou de abrir, aguarde o carregamento e tente de novo.`);
      return;
    }
    if (!data) { showState('Não consegui ler a página', 'A página não devolveu dados. Recarregue a aba e tente de novo.'); return; }

    const net = {};
    net.robots = await fetchRobots(data.origin);
    net.sitemap = await fetchSitemap(data.origin, net.robots.sitemaps);

    state.data = data;
    state.results = runChecks(data, net);
    state.summary = summarize(state.results);
    state.analyzedUrl = tab.url;

    const saved = await loadHost(data.host);
    state.client = saved.client || '';
    const previous = saved.entries[0] || null;
    const items = Object.fromEntries(state.results.map((r) => [r.id, r.status]));
    const o = state.summary.overall;
    const after = await addEntry(data.host, { ts: Date.now(), url: data.url, ok: o.ok, total: o.total, speedMs: mainSpeedMs(data), items });
    state.history = after.entries;
    state.previous = previous;
    render();
  } catch (e) {
    showState('Algo deu errado', String(e.message || e));
  } finally {
    state.running = false;
    rerunBtn.disabled = false;
  }
}

/** Recarrega a aba sem cache e mede de novo: dá a medição mais fiel do tempo de carregamento. */
async function remeasure() {
  const tab = await getTargetTab();
  if (!tab || !isAnalyzable(tab.url)) return;
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

function speedCard() {
  const ms = mainSpeedMs(state.data);
  const lvl = speedLevel(ms);
  if (ms == null) return `<section class="card speed"><div class="label">Tempo de carregamento</div><p>Não foi possível medir. Use "Medir velocidade de novo".</p></section>`;
  const pos = Math.min(100, (ms / 6000) * 100);
  return `<section class="card speed ${lvl}">
    <div class="label">Tempo para o site aparecer</div>
    <div class="num">${fmtSeconds(ms)}<small> segundos</small></div>
    <p>${esc(speedSentence(ms))}</p>
    <div class="bar" role="img" aria-label="Escala de 0 a 6 segundos"><i style="left:${pos}%"></i></div>
    <div class="bar-scale"><span>0 s</span><span>${fmtSeconds(SPEED_LIMITS.OK_MS)} s ideal</span><span>${fmtSeconds(SPEED_LIMITS.WARN_MS)} s</span><span>6 s+</span></div>
    <p class="hint">Medido neste computador. Para a medição mais fiel, use "Medir velocidade de novo".</p>
  </section>`;
}

function heroCard() {
  const o = state.summary.overall;
  return `<section class="card hero ${o.level}">
    <div class="big">${o.ok}<small> de ${o.total} itens estão bons</small></div>
    <p>${esc(o.headline)}</p>
    <div class="counts"><span>❌ ${o.bad} ruins</span><span>⚠️ ${o.warn} em atenção</span><span>✅ ${o.ok} bons</span></div>
  </section>`;
}

function groupCard(g) {
  const gs = state.summary.groups[g.id];
  const items = state.results.filter((r) => r.group === g.id);
  const order = { bad: 0, warn: 1, na: 2, ok: 3 };
  items.sort((a, b) => order[a.status] - order[b.status]);
  return `<section class="card group">
    <h2>${esc(g.name)} <span class="badge ${gs.level}">${LEVEL_LABEL[gs.level] || 'Sem dados'} · ${gs.ok}/${gs.total}</span></h2>
    <p class="sub">${esc(g.sub)}</p>
    <ul class="items">${items.map((r) => `<li class="item ${r.status}"><span class="mark" aria-hidden="true">${ICON[r.status]}</span><div><b>${esc(r.name)}</b><span class="found">${esc(r.found)}</span>${r.status === 'bad' || r.status === 'warn' ? `<div class="why">Por que importa: ${esc(r.why)}</div>` : ''}</div></li>`).join('')}</ul>
  </section>`;
}

function historyCard() {
  const o = state.summary.overall;
  let delta = '';
  if (state.previous) {
    const diff = o.ok - state.previous.ok;
    const when = new Date(state.previous.ts).toLocaleDateString('pt-BR');
    delta = diff === 0 ? `<div class="delta">Sem mudança desde a análise de ${when}.</div>`
      : `<div class="delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${diff} ${Math.abs(diff) === 1 ? 'item' : 'itens'} bons desde a análise de ${when}.</div>`;
  }
  const rows = state.history.slice(0, 6).map((e) => `<li><span>${new Date(e.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span><span>${e.ok} de ${e.total} bons${e.speedMs != null ? ` · ${fmtSeconds(e.speedMs)} s` : ''}</span></li>`).join('');
  return `<section class="card history"><h2>Histórico deste site</h2>${delta}<ul>${rows}</ul></section>`;
}

function render() {
  const { data } = state;
  const others = data.tracking.others.length ? `<p class="others">Outras ferramentas encontradas: ${esc(data.tracking.others.join(', '))}.</p>` : '';
  view.innerHTML = `
    <section class="card site">
      <input id="client" type="text" placeholder="Nome do cliente (opcional)" value="${esc(state.client)}" aria-label="Nome do cliente">
      <div class="url">${esc(data.url)}</div>
    </section>
    ${heroCard()}
    ${speedCard()}
    ${GROUPS.map(groupCard).join('')}
    ${others}
    <div class="tools">
      <button class="btn btn-red" id="remeasure" type="button">Medir velocidade de novo</button>
      <button class="btn" id="dl" type="button">Baixar .md</button>
      <button class="btn" id="copy" type="button">Copiar resumo</button>
    </div>
    ${historyCard()}`;
}

// ------------------------------------------------------------------ Ações

function reportInput() {
  return { client: state.client.trim(), data: state.data, results: state.results, summary: state.summary, date: today() };
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'dl') { download(`${fileStem(state.data.host, today())}.md`, toMarkdown(reportInput()), 'text/markdown'); toast('Arquivo baixado'); }
  if (id === 'copy') {
    try { await navigator.clipboard.writeText(toShortText(reportInput())); toast('Resumo copiado'); } catch { toast('Não foi possível copiar'); }
  }
  if (id === 'remeasure') remeasure();
  if (id === 'banner-go') analyze();
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'client' && state.data) { state.client = e.target.value; saveClient(state.data.host, state.client); }
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
  if (!tab || !isAnalyzable(tab.url) || tab.url === state.analyzedUrl) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.innerHTML = `<span>Você abriu outra página. O resultado abaixo é da página anterior.</span><button id="banner-go" class="btn btn-red" type="button">Analisar esta</button>`;
}
chrome.tabs.onActivated.addListener(checkTabChange);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') checkTabChange(); });

analyze();
