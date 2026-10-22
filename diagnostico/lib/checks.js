/**
 * Checklist do diagnóstico. Cada item responde uma pergunta de sim ou não, em linguagem simples.
 * Funções puras: recebem os dados coletados (collector.js) e a rede (network.js).
 * Status: 'ok' (está bom) · 'warn' (atenção) · 'bad' (está ruim) · 'na' (não deu para verificar).
 */

export const GROUPS = [
  { id: 'velocidade', name: 'Velocidade', sub: 'Quanto tempo o visitante espera' },
  { id: 'estrutura', name: 'Estrutura do site', sub: 'Se o Google entende e mostra o seu site' },
  { id: 'rastreamento', name: 'Rastreamento', sub: 'Se você sabe de onde vêm os seus clientes' },
  { id: 'conversao', name: 'Conversão', sub: 'Se o visitante tem como falar com você' },
];

export const LEVEL_LABEL = { ok: 'Bom', warn: 'Atenção', bad: 'Ruim' };

/** Limites do tempo de carregamento (ms): até OK_MS é bom, até WARN_MS é atenção, acima disso é ruim. */
export const SPEED_LIMITS = { OK_MS: 2500, WARN_MS: 4000 };

export const fmtSeconds = (ms) => (ms / 1000).toFixed(1).replace('.', ',');
const pctText = (n, t) => `${Math.round((n / t) * 100)}%`;

const ok = (found) => ({ status: 'ok', found });
const warn = (found) => ({ status: 'warn', found });
const bad = (found) => ({ status: 'bad', found });
const na = (found) => ({ status: 'na', found });

/** Tempo principal mostrado ao cliente: quando o conteúdo principal aparece (LCP); se faltar, a carga completa. */
export function mainSpeedMs(d) {
  return d.speed.lcpMs ?? d.speed.loadMs ?? d.speed.fcpMs ?? null;
}

export function speedLevel(ms) {
  if (ms == null) return 'na';
  return ms <= SPEED_LIMITS.OK_MS ? 'ok' : ms <= SPEED_LIMITS.WARN_MS ? 'warn' : 'bad';
}

const trackingFound = (list) => list.join(', ');

export const CHECKS = [
  // ---------------------------------------------------------------- Velocidade
  {
    id: 'V1', group: 'velocidade', name: 'O site aparece rápido',
    why: 'Quanto mais demora, mais visitantes desistem antes de ver a sua oferta.',
    run: (d) => {
      const ms = mainSpeedMs(d);
      if (ms == null) return na('Não foi possível medir o tempo de carregamento.');
      const t = `${fmtSeconds(ms)} segundos para o conteúdo principal aparecer (o ideal é até ${fmtSeconds(SPEED_LIMITS.OK_MS)}).`;
      return ({ ok, warn, bad })[speedLevel(ms)](t);
    },
  },
  {
    id: 'V2', group: 'velocidade', name: 'O servidor responde rápido',
    why: 'Um servidor lento atrasa tudo o que vem depois, em todas as páginas.',
    run: (d) => {
      const ms = d.speed.ttfbMs;
      if (ms == null) return na('Não foi possível medir o tempo de resposta do servidor.');
      const t = `O servidor leva ${fmtSeconds(ms)} segundos para começar a responder (o ideal é até 0,8).`;
      return ms <= 800 ? ok(t) : ms <= 1800 ? warn(t) : bad(t);
    },
  },
  {
    id: 'V3', group: 'velocidade', name: 'A página é leve',
    why: 'Páginas com centenas de arquivos pesam no celular e em conexões mais lentas.',
    run: (d) => {
      const n = d.speed.requests;
      const t = `A página carrega ${n} arquivos (o ideal é até 80).`;
      return n <= 80 ? ok(t) : n <= 150 ? warn(t) : bad(t);
    },
  },

  // ---------------------------------------------------------------- Estrutura
  {
    id: 'E1', group: 'estrutura', name: 'O site é seguro (cadeado)',
    why: 'Sem o cadeado, o navegador avisa que o site não é seguro e o Google rebaixa a página.',
    run: (d) => (d.structure.https ? ok('O endereço usa HTTPS.') : bad('O endereço abre sem HTTPS (sem cadeado).')),
  },
  {
    id: 'E2', group: 'estrutura', name: 'Tem título para o Google',
    why: 'O título é a primeira linha que aparece na busca. Sem um bom título, menos gente clica.',
    run: (d) => {
      const len = d.structure.title.trim().length;
      if (!len) return bad('A página não tem título.');
      if (len < 15 || len > 65) return warn(`O título tem ${len} caracteres (o ideal é entre 15 e 65): "${d.structure.title.trim().slice(0, 70)}"`);
      return ok(`"${d.structure.title.trim()}"`);
    },
  },
  {
    id: 'E3', group: 'estrutura', name: 'Tem descrição para o Google',
    why: 'A descrição é o texto que aparece abaixo do título na busca e convence a pessoa a clicar.',
    run: (d) => {
      const len = d.structure.description.trim().length;
      if (!len) return bad('A página não tem descrição.');
      if (len < 50 || len > 170) return warn(`A descrição tem ${len} caracteres (o ideal é entre 50 e 170).`);
      return ok(`Descrição com ${len} caracteres.`);
    },
  },
  {
    id: 'E4', group: 'estrutura', name: 'Tem um título principal claro (H1)',
    why: 'O título principal diz ao Google e ao visitante do que a página trata.',
    run: (d) => {
      const n = d.structure.h1Count;
      if (n === 0) return bad('A página não tem título principal (H1).');
      if (n > 1) return warn(`A página tem ${n} títulos principais (o correto é 1).`);
      return ok(`"${d.structure.h1Text}"`);
    },
  },
  {
    id: 'E5', group: 'estrutura', name: 'As imagens têm descrição',
    why: 'Sem descrição nas imagens, o Google não entende as fotos e perde-se acessibilidade.',
    run: (d) => {
      const { imgTotal: t, imgWithAlt: a } = d.structure;
      if (!t) return na('A página não tem imagens para avaliar.');
      const text = `${a} de ${t} imagens têm descrição (${pctText(a, t)}).`;
      return a / t >= 0.8 ? ok(text) : a / t >= 0.5 ? warn(text) : bad(text);
    },
  },
  {
    id: 'E6', group: 'estrutura', name: 'Funciona bem no celular',
    why: 'A maior parte das visitas vem do celular. Sem adaptação, o site fica ilegível.',
    run: (d) => (d.structure.viewport ? ok('A página se adapta à tela do celular.') : bad('A página não está configurada para telas de celular.')),
  },
  {
    id: 'E7', group: 'estrutura', name: 'O Google pode encontrar o site',
    why: 'Se o site está bloqueado para o Google, ele simplesmente não aparece nas buscas.',
    run: (d, net) => {
      if (d.structure.noindex) return bad('A página pede ao Google para não aparecer na busca (noindex).');
      if (net?.robots?.blocksAll) return bad('O arquivo robots.txt bloqueia o Google em todo o site.');
      if (net?.robots?.status === 'unknown') return warn('Não foi possível confirmar o robots.txt do site.');
      return ok('Nada bloqueia o Google.');
    },
  },
  {
    id: 'E8', group: 'estrutura', name: 'Tem mapa do site (sitemap)',
    why: 'O mapa do site mostra ao Google todas as páginas, e elas são encontradas mais rápido.',
    run: (d, net) => {
      const s = net?.sitemap?.status;
      if (s === 'found') return ok('O mapa do site está publicado.');
      if (s === 'missing') return bad('Não encontramos o mapa do site (sitemap.xml).');
      return na('Não foi possível verificar o mapa do site.');
    },
  },
  {
    id: 'E9', group: 'estrutura', name: 'Tem dados estruturados (schema)',
    why: 'Dados estruturados permitem estrelas, preços e endereço direto no resultado do Google.',
    run: (d) => (d.structure.schemaCount > 0 ? ok(`${d.structure.schemaCount} bloco(s) de dados estruturados.`) : bad('Não encontramos dados estruturados na página.')),
  },

  // ---------------------------------------------------------------- Rastreamento
  {
    id: 'R1', group: 'rastreamento', name: 'Google Analytics instalado',
    why: 'Sem ele, você não sabe quantas pessoas visitam o site nem de onde elas vêm.',
    run: (d) => {
      const t = d.tracking;
      if (t.ga4Ids.length) return ok(`Google Analytics 4 encontrado (${trackingFound(t.ga4Ids)}).`);
      if (t.universalAnalytics) return bad('Só encontramos o Analytics antigo (Universal), que parou de coletar dados em 2023.');
      if (t.gtmIds.length) return warn('Não detectamos o Analytics direto; pode estar dentro do Gerenciador de Tags.');
      return bad('Não encontramos o Google Analytics.');
    },
  },
  {
    id: 'R2', group: 'rastreamento', name: 'Gerenciador de Tags (GTM) instalado',
    why: 'É ele que permite instalar e ajustar o rastreamento sem mexer no código do site.',
    run: (d) => (d.tracking.gtmIds.length ? ok(`GTM encontrado (${trackingFound(d.tracking.gtmIds)}).`) : bad('Não encontramos o Google Tag Manager.')),
  },
  {
    id: 'R3', group: 'rastreamento', name: 'Pixel do Meta (Facebook e Instagram)',
    why: 'Sem o Pixel, os anúncios no Facebook e Instagram não otimizam nem reaproveitam visitantes.',
    run: (d) => (d.tracking.metaPixel ? ok('Pixel do Meta encontrado.') : bad('Não encontramos o Pixel do Meta.')),
  },
  {
    id: 'R4', group: 'rastreamento', name: 'Tag do Google Ads instalada',
    why: 'Sem ela, o Google Ads não sabe quais cliques viraram clientes e não faz remarketing.',
    run: (d) => {
      const t = d.tracking;
      if (t.adsIds.length || t.adsRequest) return ok(`Tag do Google Ads encontrada${t.adsIds.length ? ` (${trackingFound(t.adsIds)})` : ''}.`);
      if (t.gtmIds.length) return warn('Não detectamos a tag do Google Ads direto; pode estar dentro do Gerenciador de Tags.');
      return bad('Não encontramos a tag do Google Ads.');
    },
  },

  // ---------------------------------------------------------------- Conversão
  {
    id: 'C1', group: 'conversao', name: 'Tem botão de ação na primeira tela',
    why: 'Quem chega e não vê o que fazer vai embora. O botão precisa estar visível sem rolar.',
    run: (d) => (d.conversion.ctaAboveFold ? ok(`Botão encontrado: "${d.conversion.ctaAboveFold}".`) : bad('Não encontramos um botão de ação visível na primeira tela.')),
  },
  {
    id: 'C2', group: 'conversao', name: 'Tem WhatsApp',
    why: 'O WhatsApp é o canal que o cliente brasileiro mais usa para tirar dúvida e fechar.',
    run: (d) => (d.conversion.whatsapp ? ok('Há link ou botão de WhatsApp.') : bad('Não encontramos WhatsApp na página.')),
  },
  {
    id: 'C3', group: 'conversao', name: 'Tem formulário de contato',
    why: 'O formulário captura quem não quer ligar nem chamar no WhatsApp.',
    run: (d) => (d.conversion.forms > 0 ? ok(`${d.conversion.forms} formulário(s) na página.`) : bad('Não encontramos formulário de contato na página.')),
  },
  {
    id: 'C4', group: 'conversao', name: 'Tem telefone para clicar',
    why: 'No celular, o telefone precisa ligar com um toque. Senão a pessoa desiste de copiar o número.',
    run: (d) => (d.conversion.phone ? ok('Há telefone clicável.') : bad('Não encontramos telefone clicável.')),
  },
  {
    id: 'C5', group: 'conversao', name: 'Mostra provas de outros clientes',
    why: 'Depoimentos, avaliações e cases dão confiança a quem ainda não conhece a empresa.',
    run: (d) => (d.conversion.socialProof ? ok('Encontramos depoimentos, avaliações ou cases.') : bad('Não identificamos depoimentos, avaliações ou cases na página.')),
  },
];

export function runChecks(data, net = {}) {
  return CHECKS.map((c) => {
    let res;
    try { res = c.run(data, net); } catch (e) { res = na(`Erro na verificação: ${e.message}`); }
    return { id: c.id, group: c.group, name: c.name, why: c.why, ...res };
  });
}

const levelOf = (pct) => (pct >= 0.75 ? 'ok' : pct >= 0.5 ? 'warn' : 'bad');
const SCORE = { ok: 1, warn: 0.5, bad: 0 };

/** Placar por área e geral. 'na' não entra na conta. */
export function summarize(results) {
  const tally = (items) => {
    const counted = items.filter((r) => r.status !== 'na');
    const c = { ok: 0, warn: 0, bad: 0, total: counted.length };
    for (const r of counted) c[r.status]++;
    const pct = c.total ? counted.reduce((s, r) => s + SCORE[r.status], 0) / c.total : null;
    return { ...c, pct, level: pct == null ? 'na' : levelOf(pct) };
  };
  const groups = Object.fromEntries(GROUPS.map((g) => [g.id, tally(results.filter((r) => r.group === g.id))]));
  const overall = tally(results);
  const fix = overall.bad + overall.warn;
  overall.fix = fix;
  overall.headline = overall.level === 'bad'
    ? `Seu site tem ${fix} pontos a corrigir que podem estar afastando clientes.`
    : overall.level === 'warn'
      ? `Seu site está razoável, mas tem ${fix} pontos a corrigir.`
      : fix === 0 ? 'Seu site está bem estruturado.' : `Seu site está bem estruturado. Restam ${fix} ajustes.`;
  return { groups, overall };
}
