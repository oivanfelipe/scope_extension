import test from 'node:test';
import assert from 'node:assert/strict';
import { priorityOf, sprintOf, labelForAverage, finalize, summarize } from '../lib/scoring.js';

test('prioridade = (6 − nota) × I × D', () => {
  assert.equal(priorityOf(1, 5, 5), 125);
  assert.equal(priorityOf(3, 4, 4), 48);
  assert.equal(priorityOf(5, 5, 5), 25);
});

test('cortes de sprint do playbook e nota 5 fora das sprints', () => {
  assert.equal(sprintOf(125, 1), 1);
  assert.equal(sprintOf(80, 2), 1);
  assert.equal(sprintOf(79, 2), 2);
  assert.equal(sprintOf(40, 3), 2);
  assert.equal(sprintOf(39, 3), 3);
  assert.equal(sprintOf(15, 4), 3);
  assert.equal(sprintOf(14, 4), 4);
  assert.equal(sprintOf(25, 5), null);
});

test('rótulos iguais aos relatórios da Elements', () => {
  assert.equal(labelForAverage(1.2), 'Crítico');
  assert.equal(labelForAverage(2.2), 'Ruim');
  assert.equal(labelForAverage(2.8), 'Regular');
  assert.equal(labelForAverage(3.0), 'Regular');
  assert.equal(labelForAverage(3.3), 'Regular');
  assert.equal(labelForAverage(4.0), 'Bom');
  assert.equal(labelForAverage(4.7), 'Excelente');
});

test('nota manual recalcula prioridade; média ignora N/A e dimensão O', () => {
  const raw = [
    { id: 'S1', dim: 'S', impact: 5, dependency: 5, score: 1 },
    { id: 'S2', dim: 'S', impact: 4, dependency: 4, score: 5 },
    { id: 'C1', dim: 'C', impact: 4, dependency: 2, score: 3 },
    { id: 'P1', dim: 'P', na: true, reason: 'x' },
  ];
  const fin = finalize(raw, { S1: 4 });
  assert.equal(fin[0].score, 4);
  assert.equal(fin[0].overridden, true);
  assert.equal(fin[0].priority, 50);
  const sum = summarize(fin);
  assert.equal(sum.dims.S.avg, 4.5);
  assert.equal(sum.dims.O.avg, null);
  assert.equal(sum.dims.P.avg, null);
  assert.equal(sum.overall, (4.5 + 3) / 2);
  assert.equal(sum.sprintCounts[2], 1);
});
