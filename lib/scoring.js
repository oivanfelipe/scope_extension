// Escala e agrupamento dos resultados.
//
// Nota por item: 1 = Crítico · 2 = Ruim · 3 = Regular · 4 = Bom · 5 = Excelente.
// Cada item pertence a um NÍVEL (site = vale para o domínio todo · página = só esta URL)
// e a um GRUPO temático. Não há prioridade/sprint: a lista vem ordenada do pior para o melhor.

export const SCORE_LABELS = { 1: 'Crítico', 2: 'Ruim', 3: 'Regular', 4: 'Bom', 5: 'Excelente' };

export const LEVELS = {
  site: { label: 'Site', title: 'Nível site', hint: 'Vale para o domínio inteiro, qualquer que seja a página aberta.' },
  page: { label: 'Página', title: 'Nível página', hint: 'Vale só para a URL que está aberta.' },
};

/** Ordem de exibição: itens do tipo de página primeiro. */
export const GROUPS = {
  produto: 'Página de produto',
  servico: 'Página de serviço',
  tecnico: 'Técnico e rastreamento',
  conteudo: 'Conteúdo e estrutura',
  semantica: 'Dados estruturados e IA',
  performance: 'Performance (medição local)',
};

export const STATUS = {
  problem: { label: 'Com problema', range: 'nota 1–2' },
  attention: { label: 'Atenção', range: 'nota 3' },
  ok: { label: 'OK', range: 'nota 4–5' },
};

export const statusOf = (score) => (score <= 2 ? 'problem' : score === 3 ? 'attention' : 'ok');
export const clampScore = (n) => Math.min(5, Math.max(1, Math.round(n)));

/** Mesmo corte usado nos relatórios (2.2 Ruim · 2.8 Regular · 1.2 Crítico). */
export function labelForAverage(avg) {
  if (avg == null) return '—';
  return SCORE_LABELS[levelForAverage(avg)];
}

export function levelForAverage(avg) {
  if (avg == null) return 0;
  return clampScore(avg < 1.5 ? 1 : avg < 2.5 ? 2 : avg < 3.5 ? 3 : avg < 4.5 ? 4 : 5);
}

/** Aplica nota manual (se houver) e classifica cada item. */
export function finalize(raw, overrides = {}) {
  return raw.map((r) => {
    if (r.na) return { ...r };
    const auto = r.score;
    const score = overrides[r.id] != null ? clampScore(overrides[r.id]) : auto;
    return { ...r, autoScore: auto, score, overridden: score !== auto, status: statusOf(score) };
  });
}

const avgOf = (items) => (items.length ? items.reduce((s, r) => s + r.score, 0) / items.length : null);

function summarizeSet(items, all) {
  const avg = avgOf(items);
  return {
    avg, level: levelForAverage(avg), label: labelForAverage(avg), count: items.length,
    naCount: all.length - items.length,
    problem: items.filter((r) => r.status === 'problem').length,
    attention: items.filter((r) => r.status === 'attention').length,
    ok: items.filter((r) => r.status === 'ok').length,
  };
}

export function summarize(results) {
  const out = { levels: {}, groups: {} };
  for (const lvl of Object.keys(LEVELS)) {
    const all = results.filter((r) => r.level === lvl);
    out.levels[lvl] = summarizeSet(all.filter((r) => !r.na), all);
  }
  for (const g of Object.keys(GROUPS)) {
    const all = results.filter((r) => r.level === 'page' && r.group === g);
    if (all.length) out.groups[g] = { name: GROUPS[g], ...summarizeSet(all.filter((r) => !r.na), all) };
  }
  return out;
}

/** Do pior para o melhor; empate resolvido pelo peso interno do item (impacto). */
export const byWorst = (a, b) => a.score - b.score || b.impact - a.impact || a.id.localeCompare(b.id, 'en', { numeric: true });
