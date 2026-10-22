// Textos de resumo e exportações (Markdown e CSV), em linguagem simples.

import { GROUPS, LEVELS, OPPS, SCORE_LABELS, byWorst } from './scoring.js';
import { PAGE_TYPES } from './checks.js';
import { friendly, why, impactOf, todoOf } from './insights.js';
import { truncate } from './util.js';

const fmt = (n) => (n == null ? '—' : n.toFixed(1).replace('.', ','));
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' · ');
export const title = (r) => friendly(r.id, r.name);

/** Dado concreto que sustenta o ponto (primeira linha da evidência). */
export const proofOf = (r, max = 200) => truncate(String(r.evidence ?? '').split('\n')[0], max);

/** Itens que viram "pontos para ajustar": oportunidade grande ou média, do pior para o melhor. */
export const mainPoints = (results, limit = 5) => results.filter((r) => !r.na && r.score <= 3).sort(byWorst).slice(0, limit);

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

/** Veredito em uma frase, pensado para mostrar ao dono do site. */
export function verdict(summary) {
  const p = summary.levels.page;
  const s = summary.levels.site;
  const m = p.grande + p.media;
  const page = {
    grande: `Esta página precisa de ajustes: encontramos ${p.grande === 1 ? '1 problema importante' : `${p.grande} problemas importantes`} que podem estar afastando clientes.`,
    media: `Esta página funciona, mas tem ${m} ${m === 1 ? 'ponto que pode' : 'pontos que podem'} trazer mais clientes se for ajustado.`,
    baixa: 'Esta página está bem. Restam apenas ajustes finos.',
    nenhuma: 'Esta página está em ótimo estado. Nenhum ajuste necessário.',
  }[p.opp] || 'Não foi possível avaliar esta página.';
  const site = {
    grande: 'O site, como um todo, também tem pontos importantes a corrigir.',
    media: 'O site, como um todo, tem alguns pontos a melhorar.',
    baixa: 'O site, como um todo, está em boa forma.',
    nenhuma: 'O site, como um todo, está em ótima forma.',
  }[s.opp] || '';
  return { opp: p.opp, text: page, siteText: site, siteOpp: s.opp };
}

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
      if (impactOf(r.id)) L.push(`  - O que isso causa: ${impactOf(r.id)}`);
      L.push(`  - O que encontramos: ${oneLine(r.evidence)}`);
      if (todoOf(r.id)) L.push(`  - O que fazer: ${todoOf(r.id)}`);
      if (r.recommendation) L.push(`  - Detalhe técnico (para quem executa): ${r.recommendation}`);
    }
    if (fine.length) {
      L.push('');
      L.push('**Baixa oportunidade (ajustes finos)**');
      for (const r of fine) L.push(`- ${title(r)}: ${oneLine(r.evidence)}${todoOf(r.id) ? ` → ${todoOf(r.id)}` : ''}`);
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
  const v = verdict(summary);
  const L = [];
  L.push(`# Análise de página — ${meta.client ? `${meta.client} · ` : ''}${meta.host}`);
  L.push('');
  L.push(`- **URL analisada:** ${meta.url}`);
  L.push(`- **Data:** ${meta.date}`);
  L.push(`- **Tipo de página:** ${PAGE_TYPES[meta.pageType] || meta.pageType}${meta.platforms?.length ? ` · **Plataforma:** ${meta.platforms.join(', ')}` : ''}`);
  L.push('');
  L.push('## Resumo');
  L.push('');
  L.push(`**${v.text}** ${v.siteText}`);
  const focus = mainPoints(results);
  if (focus.length) {
    L.push('');
    L.push('**Principais pontos para ajustar**');
    focus.forEach((r, i) => L.push(`${i + 1}. **${title(r)}** (${LEVELS[r.level].label.toLowerCase()}) — ${impactOf(r.id) || why(r.id)}`));
  }
  L.push('');
  L.push('> Oportunidade de melhora: **grande** (nota 1–2) · **média** (3) · **baixa** (4) · **sem oportunidade** (5). **Site** vale para o domínio inteiro; **Página** vale só para esta URL.');
  levelSection(L, 'page', data);
  levelSection(L, 'site', data);
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
  const head = ['URL', 'Data', 'Tipo de página', 'Nível', 'Tema', 'Item', 'Item (nome técnico)', 'Oportunidade de melhora', 'Nota (1-5)', 'O que isso causa', 'O que encontramos', 'O que fazer', 'Detalhe técnico'];
  const order = (r) => (r.level === 'page' ? 0 : 1) * 1000 + (r.na ? 500 : 0);
  const rows = [...results].sort((a, b) => order(a) - order(b) || byWorst(a, b)).map((r) => [
    meta.url, meta.date, PAGE_TYPES[meta.pageType] || meta.pageType, LEVELS[r.level].label, GROUPS[r.group] || r.group, title(r), r.name,
    r.na ? 'Não verificado' : OPPS[r.opp].label, r.na ? '' : r.score,
    r.na || r.score >= 5 ? '' : impactOf(r.id), r.na ? r.reason : oneLine(r.evidence),
    r.na || r.score >= 5 ? '' : todoOf(r.id), r.na || r.score >= 5 ? '' : r.recommendation,
  ]);
  return '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function fileStem(meta) {
  const host = meta.host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  return `analise_${host}_${meta.date}`;
}
