// Relatório para entregar ao dono do site: um único arquivo HTML, sem dependências,
// que o navegador imprime como PDF (Ctrl/Cmd + P). Linguagem simples, marca V4.

import { GROUPS, LEVELS, OPPS, byWorst } from './scoring.js';
import { PAGE_TYPES } from './checks.js';
import { friendly, impactOf, todoOf } from './insights.js';
import { headline, mainPoints, proofOf, verdict } from './report.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = (r) => friendly(r.id, r.name);
const fmtDate = (iso) => { const [y, m, d] = String(iso).split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };

const CSS = `
:root { --red:#c00000; --ink:#1a1a1a; --muted:#555; --line:#e0e0e0; --bg:#f5f5f5; --black:#0d0d0d;
  --grande:#c00000; --media:#e8710a; --baixa:#d4a100; --nenhuma:#2e7d32; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 var(--body, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif); }
h1,h2,h3 { font-family: var(--head, 'Arial Narrow', Impact, sans-serif); text-transform:uppercase; letter-spacing:.04em; margin:0; font-weight:600; }
.top { background:var(--black); border-bottom:4px solid var(--red); color:#fff; }
.top .in { max-width:900px; margin:0 auto; padding:18px 24px; display:flex; align-items:center; gap:14px; }
.mark { width:42px; height:42px; border-radius:7px; background:var(--red); color:#fff; font:700 28px/42px var(--head, Impact, sans-serif); text-align:center; flex:none; }
.top h1 { font-size:22px; letter-spacing:.1em; line-height:1.1; }
.top p { margin:2px 0 0; color:#aaa; font-size:13px; }
main { max-width:900px; margin:0 auto; padding:22px 24px 40px; display:grid; gap:20px; }
.card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:18px 20px; }
.info { display:grid; grid-template-columns:1fr auto; gap:18px; align-items:start; }
.info dl { margin:0; display:grid; grid-template-columns:auto 1fr; gap:4px 14px; font-size:14px; }
.info dt { color:var(--muted); } .info dd { margin:0; font-weight:600; word-break:break-all; }
.shot { width:260px; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
.shot img { display:block; width:100%; }
.shot span { display:block; font-size:11px; color:var(--muted); padding:4px 8px; background:#fafafa; }
.verdict { border-left:10px solid var(--c); }
.verdict .tag { display:inline-block; background:var(--c); color:#fff; font:600 12px/1 var(--head, Impact, sans-serif); text-transform:uppercase; letter-spacing:.08em; padding:5px 10px; border-radius:4px; }
.verdict .tag.o-baixa { color:#1a1a1a; }
.verdict h2 { font-size:28px; line-height:1.2; margin:10px 0 6px; text-transform:none; letter-spacing:0; }
.verdict p { margin:0; color:var(--muted); font-size:16px; }
.two { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.lvl .name { font:600 13px var(--head, Impact, sans-serif); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
.lvl .big { font:700 24px/1.15 var(--head, Impact, sans-serif); text-transform:uppercase; color:var(--c); margin:4px 0; }
.lvl p { margin:0 0 8px; font-size:14px; }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip { border:1px solid var(--c); color:var(--c); border-radius:999px; padding:1px 10px; font-size:12.5px; font-weight:600; }
.chip.o-baixa { color:#8a6a00; }
h2.sec { font-size:18px; margin-bottom:10px; }
.pt { border:1px solid var(--line); border-left:6px solid var(--c); border-radius:8px; padding:14px 16px; margin-bottom:12px; break-inside:avoid; background:#fff; }
.pt .head { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
.pt .n { font:700 20px var(--head, Impact, sans-serif); color:var(--c); }
.pt h3 { font-size:17px; text-transform:none; letter-spacing:0; }
.badge { font:600 11px/1 var(--head, Impact, sans-serif); text-transform:uppercase; letter-spacing:.07em; color:#fff; background:var(--c); padding:4px 8px; border-radius:4px; }
.badge.o-baixa { color:#1a1a1a; }
.lvltag { font:600 11px/1 var(--head, Impact, sans-serif); text-transform:uppercase; letter-spacing:.07em; border:1px solid #999; color:#555; padding:3px 7px; border-radius:4px; }
.row { margin-top:8px; } .lab { display:block; font:600 11px var(--head, Impact, sans-serif); text-transform:uppercase; letter-spacing:.09em; color:var(--muted); margin-bottom:2px; }
.proof { background:#fafafa; border:1px dashed #c9c9c9; border-radius:6px; padding:8px 10px; font-size:14px; word-break:break-word; }
table { width:100%; border-collapse:collapse; font-size:13.5px; }
th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font:600 11px var(--head, Impact, sans-serif); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
tr { break-inside:avoid; }
.dot { display:inline-block; width:10px; height:10px; border-radius:50%; background:var(--c); margin-right:6px; }
.ok { columns:2; column-gap:24px; margin:0; padding-left:18px; font-size:14px; } .ok li { break-inside:avoid; margin-bottom:3px; }
.foot { color:var(--muted); font-size:12px; }
.hint { background:#fff4e5; border:1px solid #f0c987; color:#7a4a00; border-radius:8px; padding:8px 12px; font-size:13px; }
.o-grande { --c:var(--grande); } .o-media { --c:var(--media); } .o-baixa { --c:var(--baixa); } .o-nenhuma { --c:var(--nenhuma); }
@media (max-width:640px) { .two, .info { grid-template-columns:1fr; } .shot { width:100%; } .ok { columns:1; } }
@media print { body { background:#fff; font-size:13px; } .hint { display:none; } .card { break-inside:avoid; } main { padding:12px 0; } }
@page { margin: 14mm; }
`;

function fontFaces(fonts) {
  if (!fonts) return '';
  const face = (family, b64) => `@font-face{font-family:'${family}';font-weight:400 700;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  return `${fonts.oswald ? face('Oswald', fonts.oswald) : ''}${fonts.inter ? face('Inter', fonts.inter) : ''}:root{--head:'Oswald','Arial Narrow',Impact,sans-serif;--body:'Inter',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;}`;
}

const oppClass = (o) => `o-${o || 'nenhuma'}`;

function levelCard(level, label, sum) {
  return `<div class="card lvl ${oppClass(sum.opp)}"><div class="name">${esc(label)}</div>
    <div class="big">${esc(OPPS[sum.opp]?.label || '—')}</div>
    <p>${esc(headline(level, sum))}</p>
    <div class="chips">${['grande', 'media', 'baixa', 'nenhuma'].map((o) => `<span class="chip ${oppClass(o)}"><b>${sum[o]}</b> ${esc(OPPS[o].short)}</span>`).join('')}</div></div>`;
}

export function toOwnerHtml({ meta, results, summary, screenshot = null, fonts = null, client = '', analyst = '' }) {
  const v = verdict(summary);
  const main = mainPoints(results, 5);
  const mainIds = new Set(main.map((r) => r.id));
  const rest = results.filter((r) => !r.na && r.score <= 4 && !mainIds.has(r.id)).sort((a, b) => (a.level === b.level ? byWorst(a, b) : a.level === 'page' ? -1 : 1));
  const good = results.filter((r) => !r.na && r.score === 5).sort((a, b) => title(a).localeCompare(title(b), 'pt-BR'));
  const unchecked = results.filter((r) => r.na);
  const site = meta.host;

  const point = (r, i) => `<section class="pt ${oppClass(r.opp)}">
    <div class="head"><span class="n">${i + 1}</span><h3>${esc(title(r))}</h3><span class="badge ${oppClass(r.opp)}">${esc(OPPS[r.opp].label)}</span><span class="lvltag">${esc(LEVELS[r.level].label)}</span></div>
    ${impactOf(r.id) ? `<div class="row"><span class="lab">O que isso causa</span>${esc(impactOf(r.id))}</div>` : ''}
    <div class="row"><span class="lab">O que encontramos</span><div class="proof">${esc(proofOf(r, 260))}</div></div>
    ${todoOf(r.id) ? `<div class="row"><span class="lab">O que fazer</span>${esc(todoOf(r.id))}</div>` : ''}
  </section>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Análise de página — ${esc(client || site)}</title>
<style>${fontFaces(fonts)}${CSS}</style></head><body>
<header class="top"><div class="in"><div class="mark">S</div><div><h1>Análise de página</h1><p>V4 Company · Carvalho &amp; Co.</p></div></div></header>
<main>
  <div class="hint">Para salvar em PDF: use Ctrl + P (Cmd + P no Mac) e escolha "Salvar como PDF".</div>

  <div class="card info">
    <dl>
      ${client ? `<dt>Cliente</dt><dd>${esc(client)}</dd>` : ''}
      <dt>Página analisada</dt><dd>${esc(meta.url)}</dd>
      <dt>Tipo de página</dt><dd>${esc(PAGE_TYPES[meta.pageType] || meta.pageType)}</dd>
      <dt>Data</dt><dd>${esc(fmtDate(meta.date))}</dd>
      ${analyst ? `<dt>Análise por</dt><dd>${esc(analyst)}</dd>` : ''}
    </dl>
    ${screenshot ? `<div class="shot"><img alt="Imagem da página analisada" src="${esc(screenshot)}"><span>A página no momento da análise</span></div>` : ''}
  </div>

  <div class="card verdict ${oppClass(v.opp)}">
    <span class="tag ${oppClass(v.opp)}">${esc(OPPS[v.opp]?.label || 'Sem dados')}</span>
    <h2>${esc(v.text)}</h2>
    <p>${esc(v.siteText)}</p>
  </div>

  <div class="two">${levelCard('page', 'Esta página', summary.levels.page)}${levelCard('site', `O site (${site})`, summary.levels.site)}</div>

  ${main.length ? `<div><h2 class="sec">Principais pontos para ajustar</h2>${main.map(point).join('')}</div>` : ''}

  ${rest.length ? `<div class="card"><h2 class="sec">Outros pontos de melhora</h2>
    <table><thead><tr><th>Item</th><th>Onde vale</th><th>Oportunidade</th><th>O que fazer</th></tr></thead><tbody>
    ${rest.map((r) => `<tr class="${oppClass(r.opp)}"><td><b>${esc(title(r))}</b><br><span class="foot">${esc(GROUPS[r.group] || '')}</span></td><td>${esc(LEVELS[r.level].label)}</td><td><span class="dot"></span>${esc(OPPS[r.opp].short)}</td><td>${esc(todoOf(r.id))}</td></tr>`).join('')}
    </tbody></table></div>` : ''}

  ${good.length ? `<div class="card"><h2 class="sec">O que já está bem</h2><ul class="ok">${good.map((r) => `<li>${esc(title(r))}</li>`).join('')}</ul></div>` : ''}

  <p class="foot">Análise automática da página indicada e do domínio, feita no momento da data acima. Não usa dados do Search Console, do Semrush nem do PageSpeed; as medições de velocidade são feitas no navegador de quem analisou e são indicativas.${unchecked.length ? ` ${unchecked.length} ${unchecked.length === 1 ? 'item não pôde ser verificado' : 'itens não puderam ser verificados'} e ${unchecked.length === 1 ? 'ficou' : 'ficaram'} fora da conta.` : ''} V4 Company.</p>
</main></body></html>`;
}
