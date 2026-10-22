import { GROUPS, LEVEL_LABEL, fmtSeconds, mainSpeedMs, speedLevel } from './checks.js';

const ICON = { ok: '✅', warn: '⚠️', bad: '❌', na: '➖' };

export const fileStem = (host, date) => `diagnostico-${host.replace(/[^a-z0-9.-]/gi, '-')}-${date}`;

export function speedSentence(ms) {
  if (ms == null) return 'Não foi possível medir o tempo de carregamento.';
  const lvl = speedLevel(ms);
  const base = `Seu site demora ${fmtSeconds(ms)} segundos para mostrar o conteúdo principal.`;
  return lvl === 'ok' ? `${base} Isso é bom.` : lvl === 'warn' ? `${base} Isso é lento: o ideal é até 2,5 segundos.` : `${base} Isso é ruim: o ideal é até 2,5 segundos.`;
}

const SITE_CTX = { title: 'Diagnóstico rápido do site', groups: GROUPS };

/** Relatório em Markdown: o mesmo checklist da tela, para anexar à proposta. */
export function toMarkdown({ client, data, results, summary, date, ctx = SITE_CTX, bigSentence, ai }) {
  const o = summary.overall;
  const sentence = bigSentence ?? speedSentence(mainSpeedMs(data));
  const L = [];
  L.push(`# ${ctx.title}${client ? ` — ${client}` : ''}`, '');
  L.push(`- **Endereço:** ${data.url}`, `- **Data:** ${date}`, '');
  L.push(`## Resultado: ${o.ok} de ${o.total} itens estão bons`, '', o.headline, '');
  if (sentence) L.push(`> ${sentence}`, '');
  for (const g of ctx.groups) {
    const gs = summary.groups[g.id];
    L.push(`## ${g.name} — ${LEVEL_LABEL[gs.level] || 'Sem dados'}`, `_${g.sub}_`, '');
    for (const r of results.filter((x) => x.group === g.id)) {
      L.push(`- ${ICON[r.status]} **${r.name}.** ${r.found}${r.status === 'bad' || r.status === 'warn' ? ` _Por que importa: ${r.why}_` : ''}`);
    }
    L.push('');
  }
  if (data.tracking?.others?.length) L.push(`Outras ferramentas encontradas: ${data.tracking.others.join(', ')}.`, '');
  if (ai) L.push('## Resumo para a conversa (gerado por IA)', '', ai, '');
  L.push('---', '_Itens detectados na página aberta, de forma automática; confira na tela antes de afirmar ao cliente. A velocidade é medida no navegador de quem analisou e serve como indicativo._');
  return L.join('\n');
}

/** Resumo curto para colar em conversa (WhatsApp, e-mail). */
export function toShortText({ client, data, results, summary, ctx = SITE_CTX, bigSentence }) {
  const o = summary.overall;
  const bads = results.filter((r) => r.status === 'bad').map((r) => `• ${r.name}`);
  return [
    `${ctx.title}${client ? ` — ${client}` : ''} (${data.host})`,
    `${o.ok} de ${o.total} itens estão bons.`,
    bigSentence ?? speedSentence(mainSpeedMs(data)),
    bads.length ? `\nPrincipais problemas:\n${bads.slice(0, 8).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}
