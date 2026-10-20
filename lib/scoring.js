// Escala e priorização do S.C.O.P.E.
//
// Exibição (igual aos relatórios): 1 = Crítico … 5 = Excelente.
// Prioridade (playbook): Qualidade × Impacto × Dependência, onde a Qualidade do
// playbook é o inverso da nota exibida (Q = 6 − nota). Máximo 125.

export const DIMENSIONS = [
  { key: 'S', name: 'Solução Técnica', short: 'Técnico' },
  { key: 'C', name: 'Conteúdo & Arquitetura', short: 'Conteúdo' },
  { key: 'O', name: 'Orgânico & Keywords', short: 'Orgânico', pending: 'Requer Search Console / Semrush — etapa 2' },
  { key: 'P', name: 'Performance & UX', short: 'Performance', preview: 'Prévia local; PageSpeed/CrUX entra na etapa 2' },
  { key: 'E', name: 'Entidades & Semântica', short: 'Semântica' },
];

export const SCORE_LABELS = { 1: 'Crítico', 2: 'Ruim', 3: 'Regular', 4: 'Bom', 5: 'Excelente' };

export const SPRINTS = {
  1: { label: 'Sprint 1', hint: 'Ação imediata — alto impacto, bloqueio de crescimento', range: '80–125' },
  2: { label: 'Sprint 2', hint: 'Urgente — ganhos expressivos em prazo curto', range: '40–79' },
  3: { label: 'Sprint 3', hint: 'Importante — melhoria contínua e refinamento', range: '15–39' },
  4: { label: 'Sprint 4', hint: 'Backlog — baixo impacto relativo', range: '< 15' },
};

export const clampScore = (n) => Math.min(5, Math.max(1, Math.round(n)));

export const qualityOf = (score) => 6 - score;
export const priorityOf = (score, impact, dependency) => qualityOf(score) * impact * dependency;

/** Nota 5 = sem ação necessária, fica fora das sprints. */
export function sprintOf(priority, score) {
  if (score >= 5) return null;
  if (priority >= 80) return 1;
  if (priority >= 40) return 2;
  if (priority >= 15) return 3;
  return 4;
}

/** Mesmo corte usado nos relatórios da Elements (2.2 Ruim · 2.8 Regular · 1.2 Crítico). */
export function labelForAverage(avg) {
  if (avg == null) return '—';
  if (avg < 1.5) return SCORE_LABELS[1];
  if (avg < 2.5) return SCORE_LABELS[2];
  if (avg < 3.5) return SCORE_LABELS[3];
  if (avg < 4.5) return SCORE_LABELS[4];
  return SCORE_LABELS[5];
}

export function levelForAverage(avg) {
  if (avg == null) return 0;
  return clampScore(avg < 1.5 ? 1 : avg < 2.5 ? 2 : avg < 3.5 ? 3 : avg < 4.5 ? 4 : 5);
}

/** Aplica nota manual (se houver) e calcula Q, prioridade e sprint de cada checagem. */
export function finalize(raw, overrides = {}) {
  return raw.map((r) => {
    if (r.na) return { ...r };
    const auto = r.score;
    const score = overrides[r.id] != null ? clampScore(overrides[r.id]) : auto;
    const priority = priorityOf(score, r.impact, r.dependency);
    return {
      ...r,
      autoScore: auto,
      score,
      overridden: score !== auto,
      quality: qualityOf(score),
      priority,
      sprint: sprintOf(priority, score),
    };
  });
}

export function summarize(results) {
  const scored = results.filter((r) => !r.na);
  const dims = {};
  for (const dim of DIMENSIONS) {
    const items = scored.filter((r) => r.dim === dim.key);
    const avg = items.length ? items.reduce((s, r) => s + r.score, 0) / items.length : null;
    dims[dim.key] = { ...dim, avg, count: items.length, naCount: results.filter((r) => r.dim === dim.key && r.na).length, level: levelForAverage(avg) };
  }
  const avgs = Object.values(dims).map((d) => d.avg).filter((a) => a != null);
  const overall = avgs.length ? avgs.reduce((s, a) => s + a, 0) / avgs.length : null;
  const sprintCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of scored) if (r.sprint) sprintCounts[r.sprint]++;
  return { dims, overall, overallLabel: labelForAverage(overall), overallLevel: levelForAverage(overall), sprintCounts, scoredCount: scored.length };
}

export const byPriority = (a, b) => b.priority - a.priority || a.score - b.score || a.id.localeCompare(b.id);
