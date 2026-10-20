import { collectPage } from '../lib/collector.js';
import { fetchPage, fetchVariants, fetchRobots, fetchSitemaps, fetchLlmsTxt, fetchSoft404, checkLinks } from '../lib/network.js';
import { buildContext, runChecks, PAGE_TYPES } from '../lib/checks.js';
import { GROUPS, LEVELS, SCORE_LABELS, STATUS, byWorst, finalize, summarize } from '../lib/scoring.js';
import { toMarkdown, toCsv, fileStem } from '../lib/report.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const targetEl = $('#target');
const banner = $('#banner');
const rerunBtn = $('#rerun');

const state = {
  tab: null, page: null, net: null, pageTypeOverride: null, overrides: {},
  results: [], summary: null, tabView: 'resumo', filter: { level: 'all', status: 'all' },
  running: false, analyzedUrl: null, toast: '',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : n.toFixed(1).replace('.', ','));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ------------------------------------------------------------------ Aba alvo

async function getTargetTab() {
  const forced = new URLSearchParams(location.search).get('tabId'); // usado nos testes automatizados
  if (forced) return chrome.tabs.get(Number(forced));
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

const isAnalyzable = (url) => /^https?:\/\//i.test(url || '') && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);

// ------------------------------------------------------------------ Análise

const STEPS = [
  ['page', 'Lendo a página renderizada'],
  ['fetch', 'Consultando HTML bruto e cabeçalhos'],
  ['domain', 'Testando versões do domínio (http/https · www)'],
  ['robots', 'Lendo robots.txt, sitemap e teste de 404'],
  ['links', 'Testando uma amostra de links internos'],
  ['score', 'Calculando notas e prioridades'],
];

function renderProgress(done, current, failed = []) {
  view.innerHTML = `<div class="state"><h2>Analisando…</h2>
    <p>Leva em média 5 a 15 segundos. Mantenha a aba ativa.</p>
    <ul class="steps">${STEPS.map(([k, label]) => `<li class="${failed.includes(k) ? 'fail' : done.includes(k) ? 'done' : k === current ? 'run' : ''}">${esc(label)}</li>`).join('')}</ul></div>`;
}

function renderError(title, msg) {
  view.innerHTML = `<div class="state"><h2>${esc(title)}</h2><p>${esc(msg)}</p></div>`;
}

async function analyze() {
  if (state.running) return;
  state.running = true;
  rerunBtn.disabled = true;
  banner.hidden = true;
  state.overrides = {};
  state.pageTypeOverride = null;
  state.toast = '';
  const done = [], failed = [];
  try {
    const tab = await getTargetTab();
    state.tab = tab;
    if (!tab || !isAnalyzable(tab.url)) {
      targetEl.hidden = true;
      renderError('Esta aba não pode ser analisada', 'Abra uma página http(s) de um site (não vale chrome://, Chrome Web Store ou nova aba) e clique em Reanalisar.');
      return;
    }
    renderProgress(done, 'page');
    let page;
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectPage });
      page = res?.result;
    } catch (e) {
      renderError('Não consegui ler a página', `${e.message || e}. Se a aba acabou de abrir, aguarde o carregamento e tente de novo.`);
      return;
    }
    if (!page) { renderError('Não consegui ler a página', 'A página não devolveu dados. Recarregue a aba e tente novamente.'); return; }
    done.push('page');
    state.page = page;
    state.analyzedUrl = page.url;

    const net = {};
    const mark = (k, ok = true) => { (ok ? done : failed).push(k); renderProgress(done, null, failed); };
    renderProgress(done, 'fetch');
    const origin = page.origin;
    const tasks = [
      fetchPage(page.url).then((r) => { net.pageFetch = r; mark('fetch', !r.error); }),
      fetchVariants(page.host).then((r) => { net.variants = r; mark('domain'); }).catch((e) => { net.variants = { error: String(e) }; mark('domain', false); }),
      (async () => {
        net.robots = await fetchRobots(origin);
        const declared = net.robots.parsed?.sitemaps || [];
        [net.sitemap, net.llms, net.soft404] = await Promise.all([
          fetchSitemaps(origin, page.url, declared).catch((e) => ({ error: String(e) })),
          fetchLlmsTxt(origin),
          fetchSoft404(origin),
        ]);
        mark('robots', !net.robots.error);
      })(),
      checkLinks(page.links.internal).then((r) => { net.links = r; mark('links'); }).catch((e) => { net.links = { error: String(e) }; mark('links', false); }),
    ];
    await Promise.all(tasks);
    renderProgress(done, 'score', failed);
    state.net = net;
    recompute();
    state.tabView = 'resumo';
    render();
  } catch (e) {
    renderError('Algo deu errado', String(e.message || e));
  } finally {
    state.running = false;
    rerunBtn.disabled = false;
  }
}

function recompute() {
  const ctx = buildContext(state.page, state.net, state.pageTypeOverride, globalThis.DOMParser);
  state.ctx = ctx;
  state.results = finalize(runChecks(ctx), state.overrides);
  state.summary = summarize(state.results);
}

const meta = () => ({
  url: state.page.url, host: state.page.host, path: state.page.path, date: today(), pageType: state.ctx.pageType, platforms: state.page.platforms,
});

// ------------------------------------------------------------------ Render

function renderTarget() {
  const { page, ctx } = state;
  const u = new URL(page.url);
  const status = state.net.pageFetch?.status;
  targetEl.hidden = false;
  targetEl.innerHTML = `
    <div class="url">${esc(u.host)}<span style="font-weight:400;color:var(--muted)">${esc(u.pathname + u.search)}</span></div>
    <div class="row">
      ${status ? `<span class="tag">HTTP ${esc(status)}</span>` : ''}
      ${page.platforms.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}
      <label>Tipo de página:
        <select id="pageType" aria-label="Tipo de página">
          ${Object.entries(PAGE_TYPES).map(([k, v]) => `<option value="${k}" ${k === ctx.pageType ? 'selected' : ''}>${esc(v)}${k === ctx.detectedType ? ' (detectado)' : ''}</option>`).join('')}
        </select>
      </label>
    </div>`;
}

const scoreClass = (n) => `s${n}`;
const levelTag = (lvl) => `<span class="lvl lvl-${lvl}">${LEVELS[lvl].label}</span>`;

function scoreCard(lvl, title, sub) {
  const s = state.summary.levels[lvl];
  return `<div class="card overall ${scoreClass(s.level)}">
    <div class="num">${fmt(s.avg)}<small> /5</small></div>
    <div>
      <div class="scope-title">${levelTag(lvl)} ${esc(title)}</div>
      <div class="lbl">${esc(s.label)}</div>
      <p>${esc(sub)}</p>
      <p class="counts"><b class="c-problem">${s.problem}</b> com problema · <b class="c-attention">${s.attention}</b> atenção · <b class="c-ok">${s.ok}</b> ok${s.naCount ? ` · ${s.naCount} não verificados` : ''}</p>
    </div></div>`;
}

function renderResumo() {
  const { summary, results, page, ctx } = state;
  const top = results.filter((r) => !r.na && r.score <= 3).sort(byWorst).slice(0, 8);
  return `
    ${scoreCard('site', page.host, 'Vale para o domínio inteiro: rastreamento, versões do domínio, sitemap, 404 e acesso de IA.')}
    ${scoreCard('page', `${new URL(page.url).pathname}`, `Só esta URL · tipo: ${PAGE_TYPES[ctx.pageType]}.`)}

    <div class="card"><h3>Nível página por tema</h3><div class="dims">
      ${Object.entries(summary.groups).map(([g, s]) => `<div class="dim ${scoreClass(s.level)}">
        <span class="nm">${esc(s.name)}<small>${s.count} itens${s.problem ? ` · ${s.problem} com problema` : ''}</small></span>
        <span class="val">${fmt(s.avg)}</span>
        <span class="bar"><i style="width:${s.avg ? (s.avg / 5) * 100 : 0}%"></i></span></div>`).join('')}
    </div></div>

    <div class="card"><h3>Pontos de ação (nota 1 a 3)</h3>
      ${top.length ? `<ul class="prio">${top.map((r) => `<li><button type="button" data-open="${r.id}">
        ${levelTag(r.level)}
        <span class="t">${esc(r.name)}</span>
        <span class="pill ${scoreClass(r.score)}">${r.score}</span></button></li>`).join('')}</ul>`
      : '<p style="margin:0;color:var(--muted)">Nenhum ponto de ação: tudo com nota 4 ou 5.</p>'}
    </div>

    <div class="notice"><b>O que é cada nível.</b> <b>Site</b> = o que vale para o domínio todo (aparece igual em qualquer página dele). <b>Página</b> = só esta URL; os itens de <b>produto</b> ou <b>serviço</b> aparecem conforme o tipo da página. Não usa Search Console, Semrush nem PageSpeed; performance é medição local, indicativa.</div>`;
}

function findingHtml(r, open = false) {
  if (r.na) {
    return `<details class="finding na" id="f-${r.id}"><summary><span class="nm">${esc(r.name)}</span><span class="meta">${levelTag(r.level)}<span class="badge st-na">Não verificado</span></span></summary>
      <div class="body"><div class="txt">${esc(r.reason)}</div></div></details>`;
  }
  return `<details class="finding ${scoreClass(r.score)}" id="f-${r.id}" ${open ? 'open' : ''}>
    <summary><span class="nm">${esc(r.name)}</span>
      <span class="meta">${levelTag(r.level)}<span class="pill ${scoreClass(r.score)}">${r.score} · ${SCORE_LABELS[r.score]}</span></span></summary>
    <div class="body">
      <div><span class="lab">O que encontramos</span><div class="txt">${esc(r.evidence)}</div></div>
      ${r.score < 5 && r.recommendation ? `<div><span class="lab">O que fazer</span><div class="txt">${esc(r.recommendation)}</div></div>` : '<div class="txt" style="color:var(--s5);font-weight:600">Sem ação necessária.</div>'}
      <div class="calc">
        <label>Nota manual: <select data-override="${r.id}" aria-label="Nota manual de ${esc(r.name)}">
          <option value="">auto (${r.autoScore})</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${r.overridden && r.score === n ? 'selected' : ''}>${n} · ${SCORE_LABELS[n]}</option>`).join('')}
        </select></label></div>
    </div></details>`;
}

function renderAchados(openId) {
  const { results, page, ctx } = state;
  const { level, status } = state.filter;
  const match = (r) => (level === 'all' || r.level === level) && (status === 'all' || r.na === undefined && r.status === status);
  const chip = (group, value, label) => `<button type="button" class="chip" data-filter="${group}" data-value="${value}" aria-pressed="${state.filter[group] === value}">${label}</button>`;
  const sections = [];
  for (const lvl of ['site', 'page']) {
    if (level !== 'all' && level !== lvl) continue;
    const items = results.filter((r) => r.level === lvl);
    const heading = lvl === 'site'
      ? `${levelTag('site')} Vale para todo o domínio <small>${esc(page.host)}</small>`
      : `${levelTag('page')} Vale só para esta página <small>${esc(new URL(page.url).pathname)} · ${esc(PAGE_TYPES[ctx.pageType])}</small>`;
    let body = '';
    for (const g of Object.keys(GROUPS)) {
      const gi = items.filter((r) => r.group === g && !r.na && match(r)).sort(byWorst);
      if (!gi.length) continue;
      body += `<h4 class="grp">${esc(GROUPS[g])}</h4><div class="list">${gi.map((r) => findingHtml(r, r.id === openId)).join('')}</div>`;
    }
    const na = status === 'all' ? items.filter((r) => r.na) : [];
    if (na.length) body += `<details class="na-group"><summary>Não verificado (${na.length})</summary><div class="list" style="margin-top:6px">${na.map((r) => findingHtml(r)).join('')}</div></details>`;
    sections.push(`<section class="lvl-sec"><h3 class="lvl-head">${heading}</h3>${body || '<div class="state"><p style="margin:0">Nenhum item neste filtro.</p></div>'}</section>`);
  }
  return `
    <div class="filters">
      <div class="chips" role="group" aria-label="Filtrar por nível">${chip('level', 'all', 'Site e página')}${chip('level', 'site', 'Só site')}${chip('level', 'page', 'Só página')}</div>
      <div class="chips" role="group" aria-label="Filtrar por situação">${chip('status', 'all', 'Todas as notas')}${chip('status', 'problem', 'Com problema (1–2)')}${chip('status', 'attention', 'Atenção (3)')}${chip('status', 'ok', 'OK (4–5)')}</div>
    </div>
    ${sections.join('')}`;
}

function renderExportar() {
  const md = toMarkdown({ meta: meta(), results: state.results, summary: state.summary });
  state.md = md;
  return `<div class="card export">
    <h3>Levar para a proposta</h3>
    <div class="actions">
      <button class="btn btn-red" type="button" data-export="copy">Copiar resumo (Markdown)</button>
      <button class="btn" type="button" data-export="md">Baixar .md</button>
      <button class="btn" type="button" data-export="csv">Baixar .csv (planilha)</button>
    </div>
    <div class="toast" id="toast" role="status">${esc(state.toast)}</div>
    <textarea readonly aria-label="Pré-visualização do relatório em Markdown">${esc(md)}</textarea>
  </div>`;
}

function render(openId) {
  if (!state.summary) return;
  renderTarget();
  const tabs = [['resumo', 'Resumo'], ['achados', 'Achados'], ['exportar', 'Exportar']];
  const body = state.tabView === 'resumo' ? renderResumo() : state.tabView === 'achados' ? renderAchados(openId) : renderExportar();
  view.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="tab" data-tab="${k}" aria-selected="${state.tabView === k}">${l}</button>`).join('')}</div>${body}`;
  if (openId) document.getElementById('f-' + openId)?.scrollIntoView({ block: 'center' });
}

// ------------------------------------------------------------------ Eventos

view.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-open],[data-filter],[data-export]');
  if (!t) return;
  if (t.dataset.tab) { state.tabView = t.dataset.tab; render(); }
  else if (t.dataset.open) { state.filter = { level: 'all', status: 'all' }; state.tabView = 'achados'; render(t.dataset.open); document.getElementById('f-' + t.dataset.open)?.setAttribute('open', ''); }
  else if (t.dataset.filter) { state.filter[t.dataset.filter] = t.dataset.value; render(); }
  else if (t.dataset.export) await doExport(t.dataset.export);
});

view.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-override]');
  if (!sel) return;
  const id = sel.dataset.override;
  if (sel.value === '') delete state.overrides[id]; else state.overrides[id] = Number(sel.value);
  recompute();
  render(id);
  document.getElementById('f-' + id)?.setAttribute('open', '');
});

targetEl.addEventListener('change', (e) => {
  if (e.target.id !== 'pageType') return;
  state.pageTypeOverride = e.target.value === state.ctx.detectedType ? null : e.target.value;
  recompute();
  render();
});

rerunBtn.addEventListener('click', analyze);
banner.addEventListener('click', (e) => { if (e.target.closest('[data-analyze]')) analyze(); });

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function doExport(kind) {
  const m = meta();
  const stem = fileStem(m);
  const data = { meta: m, results: state.results, summary: state.summary };
  try {
    if (kind === 'copy') { await navigator.clipboard.writeText(toMarkdown(data)); state.toast = 'Resumo copiado.'; }
    else if (kind === 'md') { download(stem + '.md', toMarkdown(data), 'text/markdown;charset=utf-8'); state.toast = 'Arquivo .md baixado.'; }
    else { download(stem + '.csv', toCsv(data), 'text/csv;charset=utf-8'); state.toast = 'Arquivo .csv baixado.'; }
  } catch (e) { state.toast = 'Não foi possível exportar: ' + (e.message || e); }
  const el = document.getElementById('toast');
  if (el) el.textContent = state.toast;
}

// ----------------------------------------------- Aviso de troca de aba/URL

async function checkTabChange() {
  if (state.running || !state.analyzedUrl) return;
  const tab = await getTargetTab().catch(() => null);
  if (!tab || !tab.url || tab.url === state.analyzedUrl) { banner.hidden = true; return; }
  let host = tab.url; try { host = new URL(tab.url).host; } catch { /* mantém a url crua */ }
  banner.hidden = false;
  banner.innerHTML = `<span>A aba mudou para <b>${esc(host)}</b>. O resultado abaixo é da análise anterior.</span><button class="btn btn-red" type="button" data-analyze>Analisar esta aba</button>`;
}
if (!new URLSearchParams(location.search).get('tabId')) {
  chrome.tabs.onActivated.addListener(checkTabChange);
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) checkTabChange(); });
}

analyze();
