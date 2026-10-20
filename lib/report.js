// Exportações: Markdown (para proposta/ata) e CSV (para planilha).

import { GROUPS, LEVELS, SCORE_LABELS, STATUS, byWorst } from './scoring.js';
import { PAGE_TYPES } from './checks.js';

const fmt = (n) => (n == null ? '—' : n.toFixed(1).replace('.', ','));
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' · ');

function levelSection(L, level, { results, summary, meta }) {
  const sum = summary.levels[level];
  const items = results.filter((r) => r.level === level);
  const scored = items.filter((r) => !r.na);
  L.push('');
  L.push(`## ${LEVELS[level].title} — ${level === 'site' ? meta.host : meta.path}`);
  L.push(`_${LEVELS[level].hint}_`);
  L.push('');
  L.push(`**Nota ${fmt(sum.avg)} / 5 (${sum.label})** · ${sum.problem} com problema · ${sum.attention} em atenção · ${sum.ok} ok`);

  const groupKeys = Object.keys(GROUPS).filter((g) => scored.some((r) => r.group === g));
  for (const g of groupKeys) {
    const gi = scored.filter((r) => r.group === g).sort(byWorst);
    const act = gi.filter((r) => r.score <= 3);
    const fine = gi.filter((r) => r.score === 4);
    const good = gi.filter((r) => r.score === 5);
    L.push('');
    L.push(`### ${GROUPS[g]}`);
    if (act.length) {
      L.push('');
      L.push('**Pontos de ação**');
      for (const r of act) {
        L.push(`- **${r.name}** — nota ${r.score} (${SCORE_LABELS[r.score]})`);
        L.push(`  - O que encontramos: ${oneLine(r.evidence)}`);
        if (r.recommendation) L.push(`  - O que fazer: ${r.recommendation}`);
      }
    }
    if (fine.length) {
      L.push('');
      L.push('**Ajustes finos**');
      for (const r of fine) L.push(`- ${r.name} — nota 4: ${oneLine(r.evidence)}${r.recommendation ? ` → ${r.recommendation}` : ''}`);
    }
    if (good.length) {
      L.push('');
      L.push(`**OK (nota 5):** ${good.map((r) => r.name).join(' · ')}`);
    }
  }
  const na = items.filter((r) => r.na);
  if (na.length) {
    L.push('');
    L.push('**Não verificado**');
    for (const r of na) L.push(`- ${r.name}: ${r.reason}`);
  }
}

export function toMarkdown(data) {
  const { meta, summary } = data;
  const L = [];
  L.push(`# Análise de página — ${meta.host}`);
  L.push('');
  L.push(`- **URL analisada:** ${meta.url}`);
  L.push(`- **Data:** ${meta.date}`);
  L.push(`- **Tipo de página:** ${PAGE_TYPES[meta.pageType] || meta.pageType}${meta.platforms?.length ? ` · **Plataforma:** ${meta.platforms.join(', ')}` : ''}`);
  L.push('');
  L.push('| Nível | Nota (1–5) | Classificação | Com problema | Atenção | OK |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const lvl of ['site', 'page']) {
    const s = summary.levels[lvl];
    L.push(`| ${LEVELS[lvl].label} | ${fmt(s.avg)} | ${s.label} | ${s.problem} | ${s.attention} | ${s.ok} |`);
  }
  L.push('');
  L.push('> Escala: 1 = Crítico · 2 = Ruim · 3 = Regular · 4 = Bom · 5 = Excelente. **Site** vale para o domínio inteiro; **Página** vale só para esta URL.');
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
  const head = ['URL', 'Data', 'Tipo de página', 'Nível', 'Grupo', 'Checagem', 'Nota (1-5)', 'Classificação', 'Situação', 'O que encontramos', 'O que fazer'];
  const order = (r) => (r.level === 'site' ? 0 : 1) * 1000 + (r.na ? 500 : 0);
  const rows = [...results].sort((a, b) => order(a) - order(b) || byWorst(a, b)).map((r) => [
    meta.url, meta.date, PAGE_TYPES[meta.pageType] || meta.pageType, LEVELS[r.level].label, GROUPS[r.group] || r.group, r.name,
    r.na ? '' : r.score, r.na ? '' : SCORE_LABELS[r.score], r.na ? 'Não verificado' : STATUS[r.status].label,
    r.na ? r.reason : oneLine(r.evidence), r.na || r.score >= 5 ? '' : r.recommendation,
  ]);
  return '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function fileStem(meta) {
  const host = meta.host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  return `analise_${host}_${meta.date}`;
}
