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
/** Tempo principal: o do Google PageSpeed (celular) quando disponível; senão, a medição local deste computador. */
export function mainSpeedMs(d) {
  if (d.psi?.status === 'ok' && d.psi.lcpMs != null) return d.psi.lcpMs;
  return d.speed.lcpMs ?? d.speed.loadMs ?? d.speed.fcpMs ?? null;
}
export const speedSource = (d) => (d.psi?.status === 'ok' && d.psi.lcpMs != null ? 'psi' : 'local');
const SRC_TEXT = { psi: 'Google PageSpeed, celular', local: 'medido neste computador' };
const NEED_PSI = 'Para medir, é preciso a chave gratuita do Google PageSpeed (veja Configurações).';
const fmtMB = (b) => (b / 1048576).toFixed(1).replace('.', ',');

export const SITE_TYPES = { ecommerce: 'Loja virtual', servicos: 'Serviços e captação de contatos', conteudo: 'Conteúdo e institucional' };

/** Identifica o tipo do site pelos sinais coletados (plataforma, schema, carrinho, preços, botões de compra). */
export function detectSiteType(d) {
  const s = d.site || {};
  const types = s.schemaTypes || [];
  if (s.platform || types.some((t) => /^(Product|ProductGroup|Offer|AggregateOffer)$/.test(t)) || (s.cart && s.prices >= 3) || (s.buy && s.prices >= 1)) return 'ecommerce';
  if (types.some((t) => /^(Article|BlogPosting|NewsArticle)$/.test(t))) return 'conteudo';
  return 'servicos';
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
    weight: 10, problem: "O site demora para abrir",
    cost: "Quanto mais demora, mais visitantes desistem antes de ver a sua oferta, inclusive os que chegaram por anúncio pago: você paga pelo clique e perde a pessoa.",
    fix: "Otimizar imagens, reduzir scripts e melhorar a hospedagem até o conteúdo principal aparecer em até 2,5 segundos.",
    run: (d) => {
      const ms = mainSpeedMs(d);
      if (ms == null) return na('Não foi possível medir o tempo de carregamento.');
      const t = `${fmtSeconds(ms)} segundos para o conteúdo principal aparecer (${SRC_TEXT[speedSource(d)]}). O ideal é até ${fmtSeconds(SPEED_LIMITS.OK_MS)}.`;
      return ({ ok, warn, bad })[speedLevel(ms)](t);
    },
  },
  {
    id: 'V2', group: 'velocidade', name: 'O servidor responde rápido',
    weight: 6, problem: "O servidor demora para responder",
    cost: "Tudo o que vem depois também atrasa, em todas as páginas do site.",
    fix: "Revisar a hospedagem e ativar cache; em geral, um servidor melhor ou uma camada de cache resolvem.",
    run: (d) => {
      const ms = d.psi?.status === 'ok' && d.psi.ttfbMs != null ? d.psi.ttfbMs : d.speed.ttfbMs;
      if (ms == null) return na('Não foi possível medir o tempo de resposta do servidor.');
      const t = `O servidor leva ${fmtSeconds(ms)} segundos para começar a responder (o ideal é até 0,8).`;
      return ms <= 800 ? ok(t) : ms <= 1800 ? warn(t) : bad(t);
    },
  },
  {
    id: 'V3', group: 'velocidade', name: 'O site responde logo ao toque',
    weight: 6, problem: "O site trava enquanto carrega",
    cost: "Enquanto o site carrega, cliques e toques demoram para funcionar. O visitante acha que travou e vai embora.",
    fix: "Reduzir scripts de terceiros (chat, pixels e plugins) e adiar o que não é essencial para a primeira tela.",
    run: (d) => {
      const ms = d.psi?.status === 'ok' ? d.psi.tbtMs : null;
      if (ms == null) return na(NEED_PSI);
      const t = `O site fica cerca de ${Math.round(ms)} ms sem responder ao toque durante o carregamento (o ideal é até 200 ms; Google PageSpeed, celular).`;
      return ms <= 200 ? ok(t) : ms <= 600 ? warn(t) : bad(t);
    },
  },
  {
    id: 'V4', group: 'velocidade', name: 'A página tem peso adequado',
    weight: 5, problem: "A página está pesada",
    cost: "Quem usa dados móveis ou conexão lenta espera mais, e cada megabyte a mais consome o plano de internet do cliente.",
    fix: "Comprimir imagens (formato WebP), remover scripts e plugins que não são usados e carregar imagens só quando aparecem na tela.",
    run: (d) => {
      const bytes = d.psi?.status === 'ok' ? d.psi.bytes : null;
      if (bytes == null) return na(NEED_PSI);
      const mb = bytes / 1048576;
      const t = `A página pesa ${fmtMB(bytes)} MB no total (o ideal é até 2 MB; Google PageSpeed).`;
      if (mb <= 2) return ok(t);
      // se o site abre rápido, o peso não pode ser tratado como problema grave
      const fast = speedLevel(mainSpeedMs(d)) === 'ok';
      return mb <= 4 || fast ? warn(fast ? `${t} Abre rápido, mas pesa para quem usa conexão lenta.` : t) : bad(t);
    },
  },

  // ---------------------------------------------------------------- Estrutura
  {
    id: 'E1', group: 'estrutura', name: 'O site é seguro (cadeado)',
    weight: 8, problem: "O site não é seguro (sem cadeado)",
    cost: "O navegador avisa que o site não é seguro e o Google rebaixa a página; muita gente abandona ao ver o aviso.",
    fix: "Instalar um certificado HTTPS e redirecionar todo o tráfego para ele.",
    run: (d) => (d.structure.https ? ok('O endereço usa HTTPS.') : bad('O endereço abre sem HTTPS (sem cadeado).')),
  },
  {
    id: 'E2', group: 'estrutura', name: 'Tem título para o Google',
    weight: 6, problem: "Título da página ausente ou fora do tamanho ideal",
    cost: "O título é a primeira linha que aparece na busca do Google; um título ruim reduz os cliques no seu resultado.",
    fix: "Escrever um título de 15 a 65 caracteres com o serviço e a cidade ou o diferencial.",
    run: (d) => {
      const len = d.structure.title.trim().length;
      if (!len) return bad('A página não tem título.');
      if (len < 15 || len > 65) return warn(`O título tem ${len} caracteres (o ideal é entre 15 e 65): "${d.structure.title.trim().slice(0, 70)}"`);
      return ok(`"${d.structure.title.trim()}"`);
    },
  },
  {
    id: 'E3', group: 'estrutura', name: 'Tem descrição para o Google',
    weight: 4, problem: "Sem descrição para o Google",
    cost: "O texto abaixo do título na busca fica aleatório e menos gente clica no seu resultado.",
    fix: "Escrever uma descrição de 50 a 170 caracteres que convença a clicar.",
    run: (d) => {
      const len = d.structure.description.trim().length;
      if (!len) return bad('A página não tem descrição.');
      if (len < 50 || len > 170) return warn(`A descrição tem ${len} caracteres (o ideal é entre 50 e 170).`);
      return ok(`Descrição com ${len} caracteres.`);
    },
  },
  {
    id: 'E4', group: 'estrutura', name: 'Tem um título principal claro (H1)',
    weight: 5, problem: "Título principal (H1) ausente ou repetido",
    cost: "O título principal diz ao Google e ao visitante do que a página trata; sem ele, a página perde clareza e posição.",
    fix: "Deixar um único título principal, com a palavra que o cliente busca.",
    run: (d) => {
      const n = d.structure.h1Count;
      if (n === 0) return bad('A página não tem título principal (H1).');
      if (n > 1) return warn(`A página tem ${n} títulos principais (o correto é 1).`);
      return ok(`"${d.structure.h1Text}"`);
    },
  },
  {
    id: 'E5', group: 'estrutura', name: 'As imagens têm descrição',
    weight: 3, problem: "Imagens sem descrição",
    cost: "O Google não entende as fotos, e quem usa leitor de tela fica sem informação.",
    fix: "Descrever cada imagem relevante em uma frase curta.",
    run: (d) => {
      const { imgTotal: t, imgWithAlt: a } = d.structure;
      if (!t) return na('A página não tem imagens para avaliar.');
      const text = `${a} de ${t} imagens têm descrição (${pctText(a, t)}).`;
      return a / t >= 0.8 ? ok(text) : a / t >= 0.5 ? warn(text) : bad(text);
    },
  },
  {
    id: 'E6', group: 'estrutura', name: 'Funciona bem no celular',
    weight: 8, problem: "O site não está adaptado ao celular",
    cost: "A maior parte das visitas vem do celular; sem adaptação o site fica ilegível e o visitante sai.",
    fix: "Configurar o site para telas pequenas (design responsivo).",
    run: (d) => (d.structure.viewport ? ok('A página se adapta à tela do celular.') : bad('A página não está configurada para telas de celular.')),
  },
  {
    id: 'E7', group: 'estrutura', name: 'O Google pode encontrar o site',
    weight: 10, problem: "O Google está impedido de encontrar o site",
    cost: "Se o site está bloqueado, ele não aparece nas buscas: é como ter a loja aberta com a porta trancada.",
    fix: "Remover o bloqueio (noindex ou robots.txt) o quanto antes.",
    run: (d, net) => {
      if (d.structure.noindex) return bad('A página pede ao Google para não aparecer na busca (noindex).');
      if (net?.robots?.blocksAll) return bad('O arquivo robots.txt bloqueia o Google em todo o site.');
      if (net?.robots?.status === 'unknown') return warn('Não foi possível confirmar o robots.txt do site.');
      return ok('Nada bloqueia o Google.');
    },
  },
  {
    id: 'E8', group: 'estrutura', name: 'Tem mapa do site (sitemap)',
    weight: 4, problem: "Sem mapa do site (sitemap)",
    cost: "Sem o mapa, o Google demora mais para descobrir páginas novas e pode deixar páginas importantes de fora.",
    fix: "Publicar o sitemap.xml e enviá-lo ao Google Search Console.",
    run: (d, net) => {
      const s = net?.sitemap?.status;
      if (s === 'found') return ok('O mapa do site está publicado.');
      if (s === 'missing') return bad('Não encontramos o mapa do site (sitemap.xml).');
      return na('Não foi possível verificar o mapa do site.');
    },
  },
  {
    id: 'E9', group: 'estrutura', name: 'Tem dados estruturados (schema)',
    weight: 3, problem: "Sem dados estruturados (schema)",
    cost: "Sem eles, o seu resultado no Google não mostra estrelas, preço ou endereço, e chama menos atenção que o do concorrente.",
    fix: "Adicionar o schema da empresa, dos serviços e das avaliações.",
    run: (d) => (d.structure.schemaCount > 0 ? ok(`${d.structure.schemaCount} bloco(s) de dados estruturados.`) : bad('Não encontramos dados estruturados na página.')),
  },

  // ---------------------------------------------------------------- Rastreamento
  {
    id: 'R1', group: 'rastreamento', name: 'Google Analytics instalado',
    weight: 8, problem: "Google Analytics não instalado",
    cost: "Sem ele, você não sabe quantas pessoas visitam o site, de onde vêm nem o que fazem. Decide no escuro e perde dados todos os dias.",
    fix: "Instalar o Google Analytics 4 pelo Gerenciador de Tags e marcar os contatos como conversões.",
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
    weight: 5, problem: "Gerenciador de Tags (GTM) não instalado",
    cost: "Cada ferramenta de rastreamento depende de programador, o que atrasa e encarece qualquer ajuste.",
    fix: "Instalar o GTM uma vez; depois as tags são ajustadas sem mexer no código.",
    run: (d) => (d.tracking.gtmIds.length ? ok(`GTM encontrado (${trackingFound(d.tracking.gtmIds)}).`) : bad('Não encontramos o Google Tag Manager.')),
  },
  {
    id: 'R3', group: 'rastreamento', name: 'Pixel do Meta (Facebook e Instagram)',
    weight: 7, problem: "Pixel do Meta não instalado",
    cost: "Os anúncios do Facebook e Instagram não aprendem quem compra e não reaproveitam quem visitou o site. Tende a sair mais caro cada contato.",
    fix: "Instalar o Pixel pelo Gerenciador de Tags e configurar os eventos de contato.",
    run: (d) => (d.tracking.metaPixel ? ok('Pixel do Meta encontrado.') : bad('Não encontramos o Pixel do Meta.')),
  },
  {
    id: 'R4', group: 'rastreamento', name: 'Tag do Google Ads instalada',
    weight: 7, problem: "Tag do Google Ads não instalada",
    cost: "O Google não sabe quais cliques viraram clientes, então não otimiza a verba, e você não consegue anunciar para quem já visitou o site.",
    fix: "Criar a conversão no Google Ads e instalar a tag pelo Gerenciador de Tags.",
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
    weight: 9, problem: "Sem botão de ação na primeira tela",
    cost: "Quem chega não sabe qual é o próximo passo e vai embora sem pedir orçamento ou agendar.",
    fix: "Colocar um botão claro (por exemplo, \"Agendar avaliação\") logo no topo da página.",
    run: (d) => (d.conversion.ctaAboveFold ? ok(`Botão encontrado: "${d.conversion.ctaAboveFold}".`) : bad('Não encontramos um botão de ação visível na primeira tela.')),
  },
  {
    id: 'C2', group: 'conversao', name: 'Tem WhatsApp',
    weight: 7, problem: "Sem WhatsApp",
    cost: "O WhatsApp é o canal que o cliente brasileiro mais usa para tirar dúvida e fechar; sem ele, parte dos contatos se perde.",
    fix: "Colocar um botão de WhatsApp fixo, com mensagem inicial pronta.",
    run: (d) => (d.conversion.whatsapp ? ok('Há link ou botão de WhatsApp.') : bad('Não encontramos WhatsApp na página.')),
  },
  {
    id: 'C3', group: 'conversao', types: ['servicos'], name: 'Tem formulário de contato',
    weight: 6, problem: "Sem formulário de contato",
    cost: "Quem não quer ligar nem chamar no WhatsApp não tem como deixar o contato, e a oportunidade se perde.",
    fix: "Criar um formulário curto (nome, telefone e e-mail) e ligá-lo ao atendimento.",
    run: (d) => (d.conversion.forms > 0 ? ok(`${d.conversion.forms} formulário(s) na página.`) : bad('Não encontramos formulário de contato na página.')),
  },
  {
    id: 'C4', group: 'conversao', types: ['servicos'], name: 'Tem telefone para clicar',
    weight: 4, problem: "Telefone não clicável",
    cost: "No celular, a pessoa precisa copiar o número, e parte desiste nesse ponto.",
    fix: "Transformar o telefone em link de chamada.",
    run: (d) => (d.conversion.phone ? ok('Há telefone clicável.') : bad('Não encontramos telefone clicável.')),
  },
  {
    id: 'C5', group: 'conversao', name: 'Mostra provas de outros clientes',
    weight: 5, problem: "Sem provas de outros clientes",
    cost: "Quem ainda não conhece a empresa precisa de segurança; sem depoimentos, avaliações ou cases, a decisão demora ou vai para o concorrente.",
    fix: "Incluir depoimentos reais, avaliações do Google e casos de clientes.",
    run: (d) => (d.conversion.socialProof ? ok('Encontramos depoimentos, avaliações ou cases.') : bad('Não identificamos depoimentos, avaliações ou cases na página.')),
  },
  {
    id: 'C6', group: 'conversao', types: ['ecommerce'], name: 'Tem busca de produtos',
    weight: 7, problem: "Sem busca de produtos",
    cost: "Quem já sabe o que quer não encontra rápido e desiste; a busca é um dos caminhos que mais levam à compra.",
    fix: "Colocar uma barra de busca visível no topo, com sugestões de produtos.",
    run: (d) => (d.site?.search ? ok('Há busca de produtos no site.') : bad('Não encontramos busca de produtos.')),
  },
  {
    id: 'C7', group: 'conversao', types: ['ecommerce'], name: 'Carrinho acessível',
    weight: 8, problem: "Carrinho não encontrado",
    cost: "Sem um carrinho visível, o cliente não vê o que já escolheu e a compra fica menos fluida.",
    fix: "Manter o ícone do carrinho sempre visível no topo, com a quantidade de itens.",
    run: (d) => (d.site?.cart || d.site?.buy ? ok('O carrinho ou o botão de compra está presente.') : bad('Não encontramos carrinho nem botão de compra.')),
  },
  {
    id: 'C8', group: 'conversao', types: ['ecommerce'], name: 'Mostra condições de compra',
    weight: 7, problem: "Condições de compra pouco visíveis",
    cost: "Dúvidas sobre frete, parcelamento, formas de pagamento e troca são motivo comum de abandono antes da compra.",
    fix: "Destacar na primeira tela: frete, parcelamento, formas de pagamento e política de troca.",
    run: (d) => {
      const c = d.site?.conditions || [];
      const t = c.length ? `Encontramos menção a: ${c.join(', ')}.` : 'Não encontramos menção a frete, parcelamento, pagamento ou troca.';
      return c.length >= 3 ? ok(t) : c.length >= 1 ? warn(t) : bad(t);
    },
  },
];

/** Roda os itens que se aplicam ao tipo de site (itens de outro tipo nem aparecem). */
export function runChecks(data, net = {}, siteType = detectSiteType(data)) {
  return CHECKS.filter((c) => !c.types || c.types.includes(siteType)).map((c) => {
    let res;
    try { res = c.run(data, net); } catch (e) { res = na(`Erro na verificação: ${e.message}`); }
    return { id: c.id, group: c.group, name: c.name, problem: c.problem, cost: c.cost, fix: c.fix, weight: c.weight, ...res };
  });
}

const levelOf = (pct) => (pct >= 0.75 ? 'ok' : pct >= 0.5 ? 'warn' : 'bad');
const SCORE = { ok: 1, warn: 0.5, bad: 0 };

export function siteHeadline(o) {
  const fix = o.bad + o.warn;
  return o.level === 'bad' ? `Seu site ${fix === 1 ? 'tem 1 ponto' : `tem ${fix} pontos`} a corrigir que podem estar afastando clientes.`
    : o.level === 'warn' ? `Seu site está razoável, mas ${fix === 1 ? 'tem 1 ponto' : `tem ${fix} pontos`} a corrigir.`
      : fix === 0 ? 'Seu site está bem estruturado.' : `Seu site está bem estruturado. ${fix === 1 ? 'Resta 1 ajuste' : `Restam ${fix} ajustes`}.`;
}

/** Placar por área e geral. 'na' não entra na conta. Serve a qualquer módulo (site, Instagram, anúncios). */
export function summarize(results, groups = GROUPS, headlineFn = siteHeadline) {
  const tally = (items) => {
    const counted = items.filter((r) => r.status !== 'na');
    const c = { ok: 0, warn: 0, bad: 0, total: counted.length };
    for (const r of counted) c[r.status]++;
    const pct = c.total ? counted.reduce((s, r) => s + SCORE[r.status], 0) / c.total : null;
    return { ...c, pct, level: pct == null ? 'na' : levelOf(pct) };
  };
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, tally(results.filter((r) => r.group === g.id))]));
  const overall = tally(results);
  overall.fix = overall.bad + overall.warn;
  overall.headline = overall.total ? headlineFn(overall) : 'Não foi possível verificar nenhum item.';
  return { groups: byGroup, overall };
}

/** Os pontos que mais custam clientes: ruins antes dos de atenção e, em cada faixa, os de maior peso. */
export function topLosses(results, n = 3) {
  const rank = { bad: 0, warn: 1 };
  return results.filter((r) => r.status in rank).sort((a, b) => rank[a.status] - rank[b.status] || (b.weight ?? 0) - (a.weight ?? 0)).slice(0, n);
}
