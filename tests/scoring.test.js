import test from 'node:test';
import assert from 'node:assert/strict';
import { labelForAverage, finalize, summarize, oppOf, byWorst } from '../lib/scoring.js';

test('rótulos iguais aos relatórios', () => {
  assert.equal(labelForAverage(1.2), 'Crítico');
  assert.equal(labelForAverage(2.2), 'Ruim');
  assert.equal(labelForAverage(2.8), 'Regular');
  assert.equal(labelForAverage(3.3), 'Regular');
  assert.equal(labelForAverage(4.0), 'Bom');
  assert.equal(labelForAverage(4.7), 'Excelente');
});

test('oportunidade: 1–2 grande, 3 média, 4 baixa, 5 nenhuma', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(oppOf), ['grande', 'grande', 'media', 'baixa', 'nenhuma']);
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
  assert.equal(sum.levels.site.media, 1);
  assert.equal(sum.groups.produto.avg, 5);
  assert.equal(sum.groups.performance.avg, null);
});

test('ordenação do pior para o melhor, empate pelo impacto', () => {
  const list = [{ id: 'A', score: 3, impact: 2 }, { id: 'B', score: 1, impact: 1 }, { id: 'C', score: 3, impact: 5 }].sort(byWorst);
  assert.deepEqual(list.map((r) => r.id), ['B', 'C', 'A']);
});

test('oportunidade do nível: falha séria em item de peso alto sobe para grande, mesmo com média boa', () => {
  const mk = (score, impact, id) => ({ id, level: 'page', group: 'tecnico', impact, score });
  const bom = finalize([mk(5, 5, 'a'), mk(5, 4, 'b'), mk(5, 4, 'c'), mk(5, 3, 'd'), mk(1, 5, 'e')]);
  assert.equal(summarize(bom).levels.page.opp, 'grande');
  const leve = finalize([mk(5, 5, 'a'), mk(5, 4, 'b'), mk(5, 4, 'c'), mk(5, 3, 'd'), mk(2, 2, 'e')]);
  assert.equal(summarize(leve).levels.page.opp, 'media', 'item ruim de peso baixo não passa de média');
  const ok = finalize([mk(5, 5, 'a'), mk(5, 4, 'b'), mk(4, 2, 'c')]);
  assert.equal(summarize(ok).levels.page.opp, 'baixa');
  assert.equal(summarize(finalize([mk(5, 5, 'a'), mk(5, 4, 'b')])).levels.page.opp, 'nenhuma');
  assert.equal(summarize(finalize([mk(2, 3, 'a'), mk(2, 3, 'b')])).levels.page.opp, 'grande');
});
