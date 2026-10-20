import test from 'node:test';
import assert from 'node:assert/strict';
import { labelForAverage, finalize, summarize, statusOf, byWorst } from '../lib/scoring.js';

test('rótulos iguais aos relatórios', () => {
  assert.equal(labelForAverage(1.2), 'Crítico');
  assert.equal(labelForAverage(2.2), 'Ruim');
  assert.equal(labelForAverage(2.8), 'Regular');
  assert.equal(labelForAverage(3.3), 'Regular');
  assert.equal(labelForAverage(4.0), 'Bom');
  assert.equal(labelForAverage(4.7), 'Excelente');
});

test('situação: 1–2 problema, 3 atenção, 4–5 ok', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(statusOf), ['problem', 'problem', 'attention', 'ok', 'ok']);
});

test('nota manual recalcula; médias separadas por nível e tema; N/A fora da média', () => {
  const raw = [
    { id: 'S6', level: 'site', group: 'tecnico', impact: 5, score: 1 },
    { id: 'S7', level: 'site', group: 'tecnico', impact: 4, score: 5 },
    { id: 'C1', level: 'page', group: 'conteudo', impact: 4, score: 3 },
    { id: 'PR1', level: 'page', group: 'produto', impact: 4, score: 5 },
    { id: 'P2', level: 'page', group: 'performance', impact: 3, na: true, reason: 'x' },
  ];
  const fin = finalize(raw, { S6: 3 });
  assert.equal(fin[0].score, 3);
  assert.equal(fin[0].overridden, true);
  const sum = summarize(fin);
  assert.equal(sum.levels.site.avg, 4);
  assert.equal(sum.levels.page.avg, 4);
  assert.equal(sum.levels.page.naCount, 1);
  assert.equal(sum.levels.site.attention, 1);
  assert.equal(sum.groups.produto.avg, 5);
  assert.equal(sum.groups.performance.avg, null);
});

test('ordenação do pior para o melhor, empate pelo impacto', () => {
  const list = [{ id: 'A', score: 3, impact: 2 }, { id: 'B', score: 1, impact: 1 }, { id: 'C', score: 3, impact: 5 }].sort(byWorst);
  assert.deepEqual(list.map((r) => r.id), ['B', 'C', 'A']);
});
