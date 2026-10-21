// Exportações: Markdown (para proposta/ata) e CSV (para planilha), em linguagem simples.

import { GROUPS, LEVELS, OPPS, SCORE_LABELS, byWorst } from './scoring.js';
import { PAGE_TYPES } from './checks.js';
import { friendly, why } from './insights.js';

const fmt = (n) => (n == null ? '—' : n.toFixed(1).replace('.', ','));
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' · ');

/** Frase de abertura de cada nível, para leitura rápida. */
export function headline(level, sum) {
  const scope = level === 'site' ? 'O site' : 'Esta página';
  const n = sum.grande;
  switch (sum.opp) {
    case 'grande': return `${scope} tem grande oportunidade de melhora: ${n === 1 ? '1 ponto importante' : `${n} pontos importantes`} para corrigir${sum.media ? `, além de ${sum.media} de média prioridade` : ''}.`;
    case 'media': { const m = sum.grande + sum.media; return `${scope} tem oportunidade média de melhora: o básico funciona, mas ${m} ${m === 1 ? 'ponto pode' : 'pontos podem'} render resultado.`; }
    case 'baixa': return `${scope} tem baixa oportunidade de melhora: está bem, restam só ajustes finos.`;
    case 'nenhuma': return `${scope} está em ótimo estado: sem oportunidade relevante de melhora.`;
    default: return `${scope}: sem dados suficientes.`;
  }
}

const title = (r) => friendly(r.id, r.name);

function levelSection(L, level, { results, summary, meta }) {
  const sum = summary.levels[level];
  const items = results.filter((r) => r.level === level);
  const scored = items.filter((r) => !r.na);
  L.push('');
  L.push(`## ${LEVELS[level].title} — ${level === 'site' ? meta.host : meta.path}`);
  L.push(`_${LEVELS[level].hint}_`);
  L.push('');
  L.push(`**${OPPS[sum.opp]?.label || '—'}** (nota ${fmt(sum.avg)}/5). ${headline(level, sum)}`);
  L.push(`Grande: ${sum.grande} · Média: ${sum.media} · Baixa: ${sum.baixa} · Sem oportunidade: ${sum.nenhuma}`);

  for (const g of Object.keys(GROUPS)) {
    const gi = scored.filter((r) => r.group === g).sort(byWorst);
    if (!gi.length) continue;
    const act = gi.filter((r) => r.score <= 3);
    const fine = gi.filter((r) => r.score === 4);
    const good = gi.filter((r) => r.score === 5);
    L.push('');
    L.push(`### ${GROUPS[g]}`);
    for (const r of act) {
      L.push('');
      L.push(`- **${title(r)}** — ${OPPS[r.opp].label}`);
      if (why(r.id)) L.push(`  - Por que importa: ${why(r.id)}`);
      L.push(`  - O que encontramos: ${oneLine(r.evidence)}`);
      if (r.recommendation) L.push(`  - O que fazer: ${r.recommendation}`);
    }
    if (fine.length) {
      L.push('');
      L.push('**Baixa oportunidade (ajustes finos)**');
      for (const r of fine) L.push(`- ${title(r)}: ${oneLine(r.evidence)}${r.recommendation ? ` → ${r.recommendation}` : ''}`);
    }
    if (good.length) {
      L.push('');
      L.push(`**Sem oportunidade (ok):** ${good.map(title).join(' · ')}`);
    }
  }
  const na = items.filter((r) => r.na);
  if (na.length) {
    L.push('');
    L.push('**Não verificado**');
    for (const r of na) L.push(`- ${title(r)}: ${r.reason}`);
  }
}

export function toMarkdown(data) {
  const { meta, summary, results } = data;
  const L = [];
  L.push(`# Análise de página — ${meta.host}`);
  L.push('');
  L.push(`- **URL analisada:** ${meta.url}`);
  L.push(`- **Data:** ${meta.date}`);
  L.push(`- **Tipo de página:** ${PAGE_TYPES[meta.pageType] || meta.pageType}${meta.platforms?.length ? ` · **Plataforma:** ${meta.platforms.join(', ')}` : ''}`);
  L.push('');
  L.push('## Resumo');
  L.push('');
  for (const lvl of ['site', 'page']) {
    const s = summary.levels[lvl];
    L.push(`- **${LEVELS[lvl].label}: ${OPPS[s.opp]?.label || '—'}.** ${headline(lvl, s)}`);
  }
  const focus = results.filter((r) => !r.na && r.score <= 3).sort(byWorst).slice(0, 5);
  if (focus.length) {
    L.push('');
    L.push('**Onde focar primeiro**');
    focus.forEach((r, i) => L.push(`${i + 1}. ${title(r)} (${LEVELS[r.level].label.toLowerCase()}) — ${why(r.id)}`));
  }
  L.push('');
  L.push('> Oportunidade de melhora: **grande** (nota 1–2) · **média** (3) · **baixa** (4) · **sem oportunidade** (5). **Site** vale para o domínio inteiro; **Página** vale só para esta URL.');
  levelSection(L, 'site', data);
  levelSection(L, 'page', data);
  L.push('');
  L.push('---');
  L.push('_Análise automática da página aberta e do domínio. Não usa Search Console, Semrush nem PageSpeed; as métricas de performance são medições locais, indicativas. V4 Company._');
  return L.join('\n');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function toCsv({ meta, results }) {
  const head = ['URL', 'Data', 'Tipo de página', 'Nível', 'Tema', 'Item', 'Item (nome técnico)', 'Oportunidade de melhora', 'Nota (1-5)', 'Classificação', 'Por que importa', 'O que encontramos', 'O que fazer'];
  const order = (r) => (r.level === 'site' ? 0 : 1) * 1000 + (r.na ? 500 : 0);
  const rows = [...results].sort((a, b) => order(a) - order(b) || byWorst(a, b)).map((r) => [
    meta.url, meta.date, PAGE_TYPES[meta.pageType] || meta.pageType, LEVELS[r.level].label, GROUPS[r.group] || r.group, title(r), r.name,
    r.na ? 'Não verificado' : OPPS[r.opp].label, r.na ? '' : r.score, r.na ? '' : SCORE_LABELS[r.score],
    why(r.id), r.na ? r.reason : oneLine(r.evidence), r.na || r.score >= 5 ? '' : r.recommendation,
  ]);
  return '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function fileStem(meta) {
  const host = meta.host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  return `analise_${host}_${meta.date}`;
}
