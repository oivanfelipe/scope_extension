/**
 * Módulo Biblioteca de Anúncios da Meta: presença, criativos e estratégia dos anúncios ativos do anunciante.
 * collectAdLibrary roda dentro da aba (autocontida); o resto são funções puras, testadas.
 * Só lê o que os anúncios já carregados na tela mostram: a Biblioteca não expõe gasto nem resultados.
 */

export const AD_GROUPS = [
  { id: 'presenca', name: 'Presença', sub: 'Se a empresa está anunciando de verdade' },
  { id: 'criativos', name: 'Criativos', sub: 'Se os anúncios são variados e atraentes' },
  { id: 'estrategia', name: 'Estratégia', sub: 'Se há método por trás dos anúncios' },
];

const MONTHS = { jan: 0, fev: 1, feb: 1, mar: 2, abr: 3, apr: 3, mai: 4, may: 4, jun: 5, jul: 6, ago: 7, aug: 7, set: 8, sep: 8, out: 9, oct: 9, nov: 10, dez: 11, dec: 11 };
const DAY = 86400000;

/** Roda na aba da Biblioteca de Anúncios. Cada anúncio é achado pelo texto "Library ID / ID da biblioteca". */
export function collectAdLibrary() {
  const ID_RE = /^(library id|id da biblioteca)\s*:?\s*\d+/i;
  const idNodes = [...document.querySelectorAll('span, div')].filter((el) => el.children.length === 0 && ID_RE.test((el.textContent || '').trim()));
  const cardOf = (el) => {
    let cur = el;
    for (let i = 0; i < 14 && cur.parentElement; i++) {
      const p = cur.parentElement;
      if (idNodes.filter((n) => p.contains(n)).length > 1) break;
      cur = p;
    }
    return cur;
  };
  const decodeLink = (href) => {
    try {
      const u = new URL(href, location.href);
      return u.hostname === 'l.facebook.com' ? (u.searchParams.get('u') || href) : u.href;
    } catch { return ''; }
  };
  const seen = new Set();
  const cards = [];
  for (const el of idNodes) {
    const card = cardOf(el);
    if (seen.has(card)) continue;
    seen.add(card);
    cards.push({
      text: (card.innerText || '').slice(0, 2500),
      hrefs: [...card.querySelectorAll('a[href]')].map((a) => decodeLink(a.getAttribute('href'))).filter(Boolean).slice(0, 12),
      hasVideo: !!card.querySelector('video'),
      hasImage: !!card.querySelector('img'),
    });
  }
  const head = (document.body.innerText || '').slice(0, 4000);
  const total = head.match(/~?\s*([\d.,]+)\s*(?:results?|resultados?)/i);
  return {
    host: 'facebook.com', origin: location.origin, url: location.href, title: document.title,
    key: `facebook.com/ads/library?${new URL(location.href).searchParams.get('view_all_page_id') || new URL(location.href).searchParams.get('q') || ''}`,
    totalText: total ? total[1] : null, cards,
  };
}

export const isAdLibraryUrl = (url) => /^https?:\/\/([a-z-]+\.)?facebook\.com\/ads\/library/i.test(url || '');

const UI_LINES = /^(library id|id da biblioteca|active|ativo|inactive|inativo|started running|veicula[çc][ãa]o|platforms?|plataformas?|sponsored|patrocinado|see ad details|ver detalhes|open dropdown|abrir lista|ads? use|an[úu]ncios? usam?|ver resumo|this ad has|este an[úu]ncio)/i;

function parseStart(text) {
  let m = text.match(/started running on\s+(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})/i);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] != null) return Date.UTC(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = text.match(/started running on\s+([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] != null) return Date.UTC(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = text.match(/veicula[çc][ãa]o iniciada em\s+(\d{1,2})\s+de\s+([a-zç]{3,9})\.?\s+de\s+(\d{4})/i);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] != null) return Date.UTC(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  return null;
}

function classifyDestination(hrefs) {
  for (const h of hrefs) {
    let host;
    try { host = new URL(h).hostname.replace(/^www\./, ''); } catch { continue; }
    if (/(^|\.)(wa\.me|whatsapp\.com)$/.test(host)) return 'whatsapp';
  }
  for (const h of hrefs) {
    let host;
    try { host = new URL(h).hostname.replace(/^www\./, ''); } catch { continue; }
    if (/(^|\.)(facebook\.com|fb\.com|instagram\.com|messenger\.com|m\.me|fbcdn\.net|fb\.me)$/.test(host)) continue;
    return 'site';
  }
  return hrefs.some((h) => /m\.me|messenger\.com/.test(h)) ? 'messenger' : null;
}

export function parseAdCard(card) {
  const text = card.text || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const inactive = /(^|\n)\s*(inactive|inativo)\b/i.test(text);
  const active = !inactive && /(^|\n)\s*(active|ativo)\b/i.test(text);
  const variants = text.match(/(\d+)\s+ads?\s+use\s+this\s+creative/i) || text.match(/(\d+)\s+an[úu]ncios?\s+usam?\s+este\s+criativo/i);
  const copy = lines.filter((l) => !UI_LINES.test(l) && l.length > 25).sort((a, b) => b.length - a.length)[0] || '';
  return {
    active, inactive,
    startTs: parseStart(text),
    variants: variants ? +variants[1] : 1,
    copy: copy.toLowerCase().replace(/\s+/g, ' ').slice(0, 160),
    video: !!card.hasVideo,
    destination: classifyDestination(card.hrefs || []),
  };
}

/** Texto principal de cada anúncio ativo (sem repetições), para a leitura qualitativa por IA. */
export function adCopies(raw, max = 10) {
  const out = [];
  for (const c of raw.cards || []) {
    const a = parseAdCard(c);
    if (a.inactive) continue;
    const best = (c.text || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 25 && !UI_LINES.test(l)).sort((x, y) => y.length - x.length)[0];
    if (best && !out.includes(best)) out.push(best.slice(0, 300));
    if (out.length >= max) break;
  }
  return out;
}

export function analyzeAds(raw, now = Date.now()) {
  const ads = (raw.cards || []).map(parseAdCard);
  const active = ads.filter((a) => a.active);
  const pool = active.length ? active : ads;
  const copies = pool.map((a) => a.copy).filter(Boolean);
  const starts = pool.map((a) => a.startTs).filter(Boolean);
  const withDest = pool.filter((a) => a.destination);
  return {
    analyzed: ads.length,
    active: active.length,
    totalText: raw.totalText,
    uniqueCopies: new Set(copies).size,
    copyCount: copies.length,
    videoShare: pool.length ? pool.filter((a) => a.video).length / pool.length : null,
    longestDays: starts.length ? Math.floor((now - Math.min(...starts)) / DAY) : null,
    newestDays: starts.length ? Math.floor((now - Math.max(...starts)) / DAY) : null,
    destShare: pool.length ? withDest.length / pool.length : null,
    whatsappShare: pool.length ? pool.filter((a) => a.destination === 'whatsapp').length / pool.length : null,
    siteShare: pool.length ? pool.filter((a) => a.destination === 'site').length / pool.length : null,
    maxVariants: pool.reduce((m, a) => Math.max(m, a.variants), 1),
  };
}

const ok = (found) => ({ status: 'ok', found });
const warn = (found) => ({ status: 'warn', found });
const bad = (found) => ({ status: 'bad', found });
const na = (found) => ({ status: 'na', found });
const pct = (n) => `${Math.round(n * 100)}%`;
const NO_READ = 'Não conseguimos ler os anúncios. Role a página para carregá-los e reanalise.';

export const AD_CHECKS = [
  {
    id: 'A1', group: 'presenca', name: 'Está anunciando agora',
    weight: 10, problem: "Não está anunciando agora",
    cost: "Sem anúncios ativos, a empresa depende só de quem já a conhece, e os concorrentes que anunciam ficam com os clientes novos.",
    fix: "Colocar no ar uma campanha simples de captação de contatos.",
    run: (a) => (a.analyzed === 0 ? na(NO_READ) : a.active > 0 ? ok(`${a.active} anúncio(s) ativo(s) encontrados.`) : bad('Não há anúncios ativos na Biblioteca de Anúncios.')),
  },
  {
    id: 'A2', group: 'presenca', name: 'Tem volume de anúncios',
    weight: 7, problem: "Poucos anúncios no ar",
    cost: "Poucos anúncios significam pouco teste de mensagem e de público; fica difícil descobrir o que convence.",
    fix: "Criar variações de texto e imagem para testar lado a lado.",
    run: (a) => {
      if (a.analyzed === 0) return na(NO_READ);
      const t = `${a.active} anúncio(s) ativo(s) lidos${a.totalText ? ` (a Biblioteca informa cerca de ${a.totalText} resultados)` : ''}. Ideal: 8 ou mais.`;
      return a.active >= 8 ? ok(t) : a.active >= 3 ? warn(t) : bad(t);
    },
  },
  {
    id: 'A3', group: 'criativos', name: 'Testa mensagens diferentes',
    weight: 6, problem: "Repete a mesma mensagem",
    cost: "Repetir o mesmo texto impede descobrir o que realmente convence o cliente.",
    fix: "Testar ao menos 4 mensagens diferentes (dor, prova, oferta e objeção).",
    run: (a) => {
      if (a.copyCount === 0) return na('Não foi possível ler os textos dos anúncios.');
      const t = `${a.uniqueCopies} texto(s) diferentes em ${a.copyCount} anúncios lidos.`;
      return a.uniqueCopies >= 4 && a.uniqueCopies / a.copyCount >= 0.5 ? ok(t) : a.uniqueCopies >= 2 ? warn(t) : bad(t);
    },
  },
  {
    id: 'A4', group: 'criativos', name: 'Usa vídeo nos anúncios',
    weight: 5, problem: "Não usa vídeo",
    cost: "O vídeo prende mais atenção no feed e nos Stories do que a imagem parada; sem ele, o anúncio perde espaço para os concorrentes.",
    fix: "Gravar vídeos curtos de 15 a 30 segundos mostrando o serviço e o atendimento.",
    run: (a) => {
      if (a.videoShare == null) return na(NO_READ);
      const t = `${pct(a.videoShare)} dos anúncios lidos usam vídeo.`;
      return a.videoShare >= 0.2 ? ok(t) : a.videoShare > 0 ? warn(t) : bad(t);
    },
  },
  {
    id: 'A5', group: 'estrategia', name: 'Mantém no ar o que funciona',
    weight: 4, problem: "Nenhum anúncio se mantém no ar",
    cost: "Anúncio que roda há semanas costuma ser o que dá resultado; se nenhum fica no ar, pode ser que nenhum esteja funcionando.",
    fix: "Identificar o que gera contato, manter esses anúncios e ajustar o resto.",
    run: (a) => {
      if (a.longestDays == null) return na('Não foi possível ler as datas de início dos anúncios.');
      const t = `O anúncio mais antigo está no ar há ${a.longestDays} dia(s).`;
      return a.longestDays >= 30 ? ok(t) : a.longestDays >= 7 ? warn(t) : bad(t);
    },
  },
  {
    id: 'A6', group: 'estrategia', name: 'Renova os anúncios',
    weight: 6, problem: "Não renova os anúncios",
    cost: "O público se cansa de ver sempre o mesmo anúncio, e o custo por contato tende a subir.",
    fix: "Lançar anúncios novos a cada 2 a 4 semanas.",
    run: (a) => {
      if (a.newestDays == null) return na('Não foi possível ler as datas de início dos anúncios.');
      const t = `O anúncio mais recente começou há ${a.newestDays} dia(s).`;
      return a.newestDays <= 14 ? ok(t) : a.newestDays <= 45 ? warn(t) : bad(t);
    },
  },
  {
    id: 'A7', group: 'estrategia', name: 'Leva o cliente para um destino claro',
    weight: 8, problem: "Destino dos anúncios pouco claro",
    cost: "Anúncio sem destino claro gasta verba sem gerar contato.",
    fix: "Levar cada anúncio para uma página ou conversa de WhatsApp pensada para aquela oferta.",
    run: (a) => {
      if (a.destShare == null) return na(NO_READ);
      if (a.destShare === 0) return na('Não foi possível identificar o destino dos anúncios.');
      const t = `${pct(a.destShare)} dos anúncios levam a um destino identificável (${pct(a.siteShare)} site, ${pct(a.whatsappShare)} WhatsApp).`;
      return a.destShare >= 0.7 ? ok(t) : a.destShare >= 0.4 ? warn(t) : bad(t);
    },
  },
];

export function adsHeadline(o) {
  const fix = o.bad + o.warn;
  return o.level === 'bad' ? `Seus anúncios na Meta têm ${fix} pontos a corrigir que podem estar desperdiçando investimento.`
    : o.level === 'warn' ? `Seus anúncios na Meta estão razoáveis, mas têm ${fix} pontos a corrigir.`
      : fix === 0 ? 'Seus anúncios na Meta estão bem estruturados.' : `Seus anúncios na Meta estão bem estruturados. Restam ${fix} ajustes.`;
}

export function runAdChecks(a) {
  return AD_CHECKS.map((c) => {
    let res;
    try { res = c.run(a); } catch (e) { res = na(`Erro na verificação: ${e.message}`); }
    return { id: c.id, group: c.group, name: c.name, problem: c.problem, cost: c.cost, fix: c.fix, weight: c.weight, ...res };
  });
}
