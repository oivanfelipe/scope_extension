import { collectPage } from '../lib/collector.js';
import { fetchPage, fetchVariants, fetchRobots, fetchSitemaps, fetchLlmsTxt, checkLinks } from '../lib/network.js';
import { buildContext, runChecks, PAGE_TYPES } from '../lib/checks.js';
import { DIMENSIONS, SCORE_LABELS, SPRINTS, byPriority, finalize, summarize } from '../lib/scoring.js';
import { toMarkdown, toCsv, fileStem } from '../lib/report.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const targetEl = $('#target');
const banner = $('#banner');
const rerunBtn = $('#rerun');

const state = {
  tab: null, page: null, net: null, pageTypeOverride: null, overrides: {},
  results: [], summary: null, tabView: 'resumo', filter: { dim: 'all', sprint: 'all' },
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
  ['robots', 'Lendo robots.txt e sitemap'],
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
        [net.sitemap, net.llms] = await Promise.all([
          fetchSitemaps(origin, page.url, declared).catch((e) => ({ error: String(e) })),
          fetchLlmsTxt(origin),
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
  url: state.page.url, host: state.page.host, date: today(), pageType: state.ctx.pageType, platforms: state.page.platforms,
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

function renderResumo() {
  const { summary, results } = state;
  const ov = summary.overall;
  const top = results.filter((r) => !r.na && r.score < 5).sort(byPriority).slice(0, 6);
  return `
    <div class="card overall ${scoreClass(summary.overallLevel)}">
      <div class="num">${fmt(ov)}<small> /5</small></div>
      <div><div class="lbl">${esc(summary.overallLabel)}</div>
      <p>Score geral S.C.O.P.E. · ${summary.scoredCount} checagens avaliadas${results.some((r) => r.na) ? ` · ${results.filter((r) => r.na).length} não aplicáveis/não verificadas` : ''}.</p></div>
    </div>

    <div class="sprints" role="group" aria-label="Itens por sprint">
      ${[1, 2, 3, 4].map((n) => `<button type="button" class="sprint-chip sp${n}" data-goto-sprint="${n}" title="${esc(SPRINTS[n].hint)}"><b>${summary.sprintCounts[n]}</b><span>${SPRINTS[n].label}</span></button>`).join('')}
    </div>

    <div class="card"><h3>Score por dimensão</h3><div class="dims">
      ${DIMENSIONS.map((d) => {
        const s = summary.dims[d.key];
        if (d.pending) return `<div class="dim pending"><span class="k">${d.key}</span><span class="nm">${esc(d.name)}<small>${esc(d.pending)}</small></span><span class="val">—</span><span class="bar"></span></div>`;
        return `<div class="dim ${scoreClass(s.level)}"><span class="k">${d.key}</span>
          <span class="nm">${esc(d.name)}<small>${s.count} checagens${d.preview ? ' · ' + esc(d.preview) : ''}</small></span>
          <span class="val">${fmt(s.avg)}</span>
          <span class="bar"><i style="width:${s.avg ? (s.avg / 5) * 100 : 0}%"></i></span></div>`;
      }).join('')}
    </div></div>

    <div class="card"><h3>Principais prioridades</h3>
      ${top.length ? `<ul class="prio">${top.map((r) => `<li><button type="button" data-open="${r.id}">
        <span class="badge sp${r.sprint}">${SPRINTS[r.sprint].label}</span>
        <span class="t">${esc(r.name)}</span>
        <span class="pill ${scoreClass(r.score)}">${r.score}</span></button></li>`).join('')}</ul>`
      : '<p style="margin:0;color:var(--muted)">Nenhum ponto de atenção — tudo com nota máxima.</p>'}
    </div>

    <div class="notice"><b>Prévia estrutural.</b> Esta análise lê a página aberta e o domínio. Não usa Search Console, Semrush nem PageSpeed — por isso a dimensão <b>O</b> não é avaliada e as métricas de performance são medições locais (indicativas). Prioridade = Qualidade × Impacto × Dependência.</div>`;
}

function findingHtml(r, open = false) {
  if (r.na) {
    return `<details class="finding na" id="f-${r.id}"><summary><span class="nm"><code>${r.id}</code>${esc(r.name)}</span><span class="meta"><span class="badge sp0">N/A</span></span></summary>
      <div class="body"><div class="txt">${esc(r.reason)}</div></div></details>`;
  }
  const sp = r.sprint ? `<span class="badge sp${r.sprint}">${SPRINTS[r.sprint].label}</span>` : '<span class="badge sp4">OK</span>';
  return `<details class="finding ${scoreClass(r.score)}" id="f-${r.id}" ${open ? 'open' : ''}>
    <summary><span class="nm"><code>${r.id}</code>${esc(r.name)}</span>
      <span class="meta">${sp}<span class="pill ${scoreClass(r.score)}">${r.score} · ${SCORE_LABELS[r.score]}</span></span></summary>
    <div class="body">
      <div><span class="lab">Evidência</span><div class="txt">${esc(r.evidence)}</div></div>
      ${r.score < 5 && r.recommendation ? `<div><span class="lab">Recomendação</span><div class="txt">${esc(r.recommendation)}</div></div>` : '<div class="txt" style="color:var(--s5);font-weight:600">Sem ação necessária.</div>'}
      <div class="calc"><span>Q ${r.quality} × I ${r.impact} × D ${r.dependency} = <b>${r.priority}</b></span>
        <label>Nota manual: <select data-override="${r.id}" aria-label="Nota manual de ${esc(r.name)}">
          <option value="">auto (${r.autoScore})</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${r.overridden && r.score === n ? 'selected' : ''}>${n} · ${SCORE_LABELS[n]}</option>`).join('')}
        </select></label></div>
    </div></details>`;
}

function renderAchados(openId) {
  const { results } = state;
  const { dim, sprint } = state.filter;
  const scored = results.filter((r) => !r.na);
  let list = scored.filter((r) => (dim === 'all' || r.dim === dim) && (sprint === 'all' || (sprint === 'ok' ? r.score >= 5 : r.sprint === Number(sprint))));
  list = list.sort((a, b) => (a.score >= 5) - (b.score >= 5) || byPriority(a, b));
  const na = results.filter((r) => r.na && (dim === 'all' || r.dim === dim));
  const chip = (group, value, label) => `<button type="button" class="chip" data-filter="${group}" data-value="${value}" aria-pressed="${state.filter[group] === value}">${label}</button>`;
  return `
    <div class="filters">
      <div class="chips" role="group" aria-label="Filtrar por dimensão">${chip('dim', 'all', 'Todas')}${DIMENSIONS.filter((d) => !d.pending).map((d) => chip('dim', d.key, d.key + ' · ' + d.short)).join('')}</div>
      <div class="chips" role="group" aria-label="Filtrar por sprint">${chip('sprint', 'all', 'Todas')}${[1, 2, 3, 4].map((n) => chip('sprint', String(n), 'Sprint ' + n)).join('')}${chip('sprint', 'ok', 'OK (nota 5)')}</div>
    </div>
    <div style="display:grid;gap:8px">${list.length ? list.map((r) => findingHtml(r, r.id === openId)).join('') : '<div class="state"><p style="margin:0">Nenhum item neste filtro.</p></div>'}</div>
    ${na.length && sprint === 'all' ? `<details class="na-group"><summary>Não aplicável / não verificado (${na.length})</summary><div style="display:grid;gap:8px;margin-top:6px">${na.map((r) => findingHtml(r)).join('')}</div></details>` : ''}`;
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
  const t = e.target.closest('[data-tab],[data-open],[data-goto-sprint],[data-filter],[data-export]');
  if (!t) return;
  if (t.dataset.tab) { state.tabView = t.dataset.tab; render(); }
  else if (t.dataset.open) { state.filter = { dim: 'all', sprint: 'all' }; state.tabView = 'achados'; render(t.dataset.open); document.getElementById('f-' + t.dataset.open)?.setAttribute('open', ''); }
  else if (t.dataset.gotoSprint) { state.filter = { dim: 'all', sprint: t.dataset.gotoSprint }; state.tabView = 'achados'; render(); }
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
