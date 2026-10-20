// Exportações: Markdown (para proposta/ata) e CSV (para a planilha de acompanhamento).

import { DIMENSIONS, SCORE_LABELS, SPRINTS, byPriority } from './scoring.js';
import { PAGE_TYPES } from './checks.js';

const fmt = (n) => (n == null ? '—' : n.toFixed(1).replace('.', ','));
const dimName = (k) => DIMENSIONS.find((d) => d.key === k)?.name || k;
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' · ');

export function toMarkdown({ meta, results, summary }) {
  const L = [];
  L.push(`# Análise prévia S.C.O.P.E. — ${meta.host}`);
  L.push('');
  L.push(`- **URL analisada:** ${meta.url}`);
  L.push(`- **Data:** ${meta.date}`);
  L.push(`- **Tipo de página:** ${PAGE_TYPES[meta.pageType] || meta.pageType}${meta.platforms?.length ? ` · **Plataforma:** ${meta.platforms.join(', ')}` : ''}`);
  L.push(`- **Score geral:** **${fmt(summary.overall)} / 5** (${summary.overallLabel})`);
  L.push('');
  L.push('| Dimensão | Score | Classificação |');
  L.push('| --- | --- | --- |');
  for (const d of DIMENSIONS) {
    const s = summary.dims[d.key];
    L.push(`| ${d.key} · ${d.name} | ${s.avg == null ? '—' : fmt(s.avg)} | ${s.avg == null ? (d.pending || 'não avaliado') : SCORE_LABELS[s.level]} |`);
  }
  L.push('');
  L.push('> Escala: 1 = Crítico · 2 = Ruim · 3 = Regular · 4 = Bom · 5 = Excelente. Prioridade = Qualidade × Impacto × Dependência (máx. 125).');
  L.push('');

  const scored = results.filter((r) => !r.na);
  L.push('## Plano de ação priorizado');
  for (const n of [1, 2, 3, 4]) {
    const items = scored.filter((r) => r.sprint === n).sort(byPriority);
    L.push('');
    L.push(`### ${SPRINTS[n].label} — ${SPRINTS[n].hint} (${items.length})`);
    if (!items.length) { L.push('_Nenhum item._'); continue; }
    for (const r of items) {
      L.push(`- **[${r.id}] ${r.name}** — nota ${r.score} (${SCORE_LABELS[r.score]}) · prioridade ${r.priority}`);
      L.push(`  - Evidência: ${oneLine(r.evidence)}`);
      if (r.recommendation) L.push(`  - Recomendação: ${r.recommendation}`);
    }
  }

  const strong = scored.filter((r) => r.score >= 5).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  L.push('');
  L.push(`## Pontos fortes (nota 5) — ${strong.length}`);
  if (strong.length) for (const r of strong) L.push(`- [${r.id}] ${r.name}: ${oneLine(r.evidence)}`);
  else L.push('_Nenhum item com nota máxima._');

  const na = results.filter((r) => r.na);
  if (na.length) {
    L.push('');
    L.push(`## Não verificado / não aplicável — ${na.length}`);
    for (const r of na) L.push(`- [${r.id}] ${r.name}: ${r.reason}`);
  }

  L.push('');
  L.push('---');
  L.push('_Prévia estrutural automática da página e do domínio. Não inclui dados de Search Console, Semrush ou PageSpeed (dimensão O e métricas de campo ficam para a etapa seguinte). Metodologia S.C.O.P.E. · V4 Company._');
  return L.join('\n');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function toCsv({ meta, results }) {
  const head = ['URL', 'Data', 'Tipo de página', 'Dimensão', 'Código', 'Checagem', 'Nota (1-5)', 'Classificação', 'Q', 'I', 'D', 'Prioridade (QxIxD)', 'Sprint', 'Status', 'Evidência', 'Recomendação'];
  const rows = [...results].sort((a, b) => (a.na ? 1 : 0) - (b.na ? 1 : 0) || byPriority(a, b)).map((r) => [
    meta.url, meta.date, PAGE_TYPES[meta.pageType] || meta.pageType, dimName(r.dim), r.id, r.name,
    r.na ? '' : r.score, r.na ? '' : SCORE_LABELS[r.score], r.na ? '' : r.quality, r.impact, r.dependency,
    r.na ? '' : r.priority, r.na || !r.sprint ? '' : SPRINTS[r.sprint].label,
    r.na ? 'Não aplicável / não verificado' : r.score >= 5 ? 'OK' : 'Ação necessária',
    r.na ? r.reason : oneLine(r.evidence), r.na || r.score >= 5 ? '' : r.recommendation,
  ]);
  return '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function fileStem(meta) {
  const host = meta.host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  return `scope_${host}_${meta.date.replace(/\//g, '-')}`;
}
