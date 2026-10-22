import { GROUPS, LEVEL_LABEL, fmtSeconds, mainSpeedMs, speedLevel } from './checks.js';

const ICON = { ok: '✅', warn: '⚠️', bad: '❌', na: '➖' };

export const fileStem = (host, date) => `diagnostico-${host.replace(/[^a-z0-9.-]/gi, '-')}-${date}`;

export function speedSentence(ms) {
  if (ms == null) return 'Não foi possível medir o tempo de carregamento.';
  const lvl = speedLevel(ms);
  const base = `Seu site demora ${fmtSeconds(ms)} segundos para mostrar o conteúdo principal.`;
  return lvl === 'ok' ? `${base} Isso é bom.` : lvl === 'warn' ? `${base} Isso é lento: o ideal é até 2,5 segundos.` : `${base} Isso é ruim: o ideal é até 2,5 segundos.`;
}

/** Relatório em Markdown: o mesmo checklist da tela, para anexar à proposta. */
export function toMarkdown({ client, data, results, summary, date }) {
  const o = summary.overall;
  const L = [];
  L.push(`# Diagnóstico rápido do site${client ? ` — ${client}` : ''}`, '');
  L.push(`- **Site:** ${data.url}`, `- **Data:** ${date}`, '');
  L.push(`## Resultado: ${o.ok} de ${o.total} itens estão bons`, '', o.headline, '');
  L.push(`> ${speedSentence(mainSpeedMs(data))}`, '');
  for (const g of GROUPS) {
    const gs = summary.groups[g.id];
    L.push(`## ${g.name} — ${LEVEL_LABEL[gs.level] || 'Sem dados'}`, `_${g.sub}_`, '');
    for (const r of results.filter((x) => x.group === g.id)) {
      L.push(`- ${ICON[r.status]} **${r.name}.** ${r.found}${r.status === 'bad' || r.status === 'warn' ? ` _Por que importa: ${r.why}_` : ''}`);
    }
    L.push('');
  }
  if (data.tracking.others.length) L.push(`Outras ferramentas encontradas: ${data.tracking.others.join(', ')}.`, '');
  L.push('---', '_Medição de velocidade feita no navegador de quem analisou; serve como indicativo. Itens de rastreamento e conversão são detectados na página aberta; o que só carrega após consentimento ou ação do usuário pode não aparecer._');
  return L.join('\n');
}

/** Resumo curto para colar em conversa (WhatsApp, e-mail). */
export function toShortText({ client, data, results, summary }) {
  const o = summary.overall;
  const bads = results.filter((r) => r.status === 'bad').map((r) => `• ${r.name}`);
  return [
    `Diagnóstico rápido${client ? ` — ${client}` : ''} (${data.host})`,
    `${o.ok} de ${o.total} itens estão bons.`,
    speedSentence(mainSpeedMs(data)),
    bads.length ? `\nPrincipais problemas:\n${bads.slice(0, 8).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}
