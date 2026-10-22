/**
 * Módulo Instagram: taxa de engajamento, frequência e formatos de um perfil aberto.
 * collectInstagram roda dentro da aba (autocontida); o resto são funções puras, testadas.
 */

export const IG_GROUPS = [
  { id: 'engajamento', name: 'Engajamento', sub: 'Se os seguidores reagem ao que você publica' },
  { id: 'frequencia', name: 'Frequência', sub: 'Se o perfil está ativo' },
  { id: 'perfil', name: 'Perfil e formatos', sub: 'Se o perfil está preparado para vender' },
];

const MONTHS = { jan: 0, janeiro: 0, january: 0, feb: 1, fev: 1, fevereiro: 1, february: 1, mar: 2, marco: 2, 'março': 2, march: 2, apr: 3, abr: 3, abril: 3, april: 3, may: 4, mai: 4, maio: 4, jun: 5, junho: 5, june: 5, jul: 6, julho: 6, july: 6, aug: 7, ago: 7, agosto: 7, august: 7, sep: 8, set: 8, setembro: 8, september: 8, oct: 9, out: 9, outubro: 9, october: 9, nov: 10, novembro: 10, november: 10, dec: 11, dez: 11, dezembro: 11, december: 11 };
const COUNT = '([\\d][\\d.,]*\\s*(?:k|mil|mi|m|b)?)';

/** "1.234", "1,234", "12,4 mil", "1.2M" → número. */
export function parseCount(raw) {
  if (raw == null) return null;
  const m = String(raw).toLowerCase().replace(/\s+/g, ' ').trim().match(/([\d][\d.,]*)\s*(k|mil|mi|m|b)?(?![a-z])/);
  if (!m) return null;
  const num = m[1].replace(/[.,]+$/, '');
  const mult = { k: 1e3, mil: 1e3, m: 1e6, mi: 1e6, b: 1e9 }[m[2] || ''] || 1;
  const dot = num.includes('.'), comma = num.includes(',');
  let v;
  if (dot && comma) {
    const dec = num.lastIndexOf('.') > num.lastIndexOf(',') ? '.' : ',';
    v = parseFloat(num.split(dec === '.' ? ',' : '.').join('').replace(dec, '.'));
  } else if (dot || comma) {
    const parts = num.split(dot ? '.' : ',');
    v = parts.length > 2 || (parts[1].length === 3 && !m[2]) ? parseFloat(parts.join('')) : parseFloat(`${parts[0]}.${parts[1]}`);
  } else v = parseFloat(num);
  return Number.isFinite(v) ? Math.round(v * mult) : null;
}

const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

function ogDescription(html) {
  const m = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:description["']/i);
  return m ? decode(m[1]) : '';
}

function parseDate(text, html = '') {
  let m = text.match(/\bon ([A-Za-z]+ \d{1,2}, \d{4})/);
  if (m && !Number.isNaN(Date.parse(m[1]))) return Date.parse(m[1]);
  m = text.match(/\bem (\d{1,2}) de ([a-zç]+)\.?,? (?:de )?(\d{4})/i);
  if (m && MONTHS[m[2].toLowerCase()] != null) return Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = html.match(/"taken_at(?:_timestamp)?"\s*:\s*(\d{9,10})/);
  if (m) return +m[1] * 1000;
  m = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (m && !Number.isNaN(Date.parse(m[1]))) return Date.parse(m[1]);
  return null;
}

/** Lê curtidas, comentários e data do HTML de um post (meta og:description). */
export function parsePostHtml(url, html) {
  const desc = ogDescription(html);
  if (!desc) return null;
  const likes = desc.match(new RegExp(`${COUNT}\\s*(?:likes?|curtidas?)`, 'i'));
  const comments = desc.match(new RegExp(`${COUNT}\\s*(?:comments?|coment[áa]rios?)`, 'i'));
  if (!likes && !comments) return null;
  const cap = desc.match(/:\s*["“](.*)["”]\.?\s*$/s);
  return {
    url,
    caption: cap ? cap[1].slice(0, 300) : '',
    isReel: /\/reels?\//.test(url),
    likes: likes ? parseCount(likes[1]) : null,
    comments: comments ? parseCount(comments[1]) : 0,
    ts: parseDate(desc, html),
  };
}

/** Lê seguidores, seguindo e posts do texto do perfil (DOM ou meta og:description). */
export function parseProfileText(text) {
  const grab = (re) => { const m = String(text).match(re); return m ? parseCount(m[1]) : null; };
  return {
    followers: grab(new RegExp(`${COUNT}\\s*(?:followers|seguidores)`, 'i')),
    following: grab(new RegExp(`${COUNT}\\s*(?:following|seguindo)`, 'i')),
    posts: grab(new RegExp(`${COUNT}\\s*(?:posts?|publica[çc][õo]es)`, 'i')),
  };
}

/** Roda na aba do Instagram. Devolve o que dá para ver no perfil aberto. */
export function collectInstagram() {
  const reserved = /^(explore|reels?|direct|accounts|stories|p|tv|about|legal|developers|web|challenge|emails|session)$/i;
  const parts = location.pathname.split('/').filter(Boolean);
  const handle = parts[0] || '';
  const isProfile = parts.length >= 1 && !reserved.test(handle) && (parts.length === 1 || /^(reels?|tagged)$/.test(parts[1]));
  const header = document.querySelector('header');
  const headerText = header ? header.innerText : '';
  const items = header ? [...header.querySelectorAll('li, a, span')].map((e) => `${e.querySelector('span[title]')?.getAttribute('title') || ''} ${e.innerText || ''}`.trim()).filter((t) => t && t.length < 60) : [];
  const og = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
  const ogOwn = og.toLowerCase().includes(`(@${handle.toLowerCase()})`) ? og : '';
  const pinned = (a) => !!a.querySelector('svg[aria-label*="Pinned" i], svg[aria-label*="Fixado" i], svg[aria-label*="fixada" i]');
  const links = [...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')].filter((a) => !pinned(a)).map((a) => new URL(a.getAttribute('href'), location.origin).href.split('?')[0]);
  const external = header ? [...header.querySelectorAll('a[href]')].some((a) => /l\.instagram\.com|^https?:\/\/(?!(www\.)?instagram\.com)/i.test(a.href)) : false;
  return {
    host: 'instagram.com', origin: location.origin, url: location.href, handle, isProfile,
    isPrivate: /this account is private|esta conta [ée] privada/i.test(document.body.innerText.slice(0, 5000)),
    headerItems: items.join(' | '), ogText: ogOwn, headerText: headerText.slice(0, 600),
    postLinks: [...new Set(links)], bioLink: external,
  };
}

const DAY = 86400000;

export function analyzeIg(profile, posts, now = Date.now()) {
  const fromDom = parseProfileText(profile.headerItems);
  const fromOg = parseProfileText(profile.ogText);
  const followers = fromDom.followers ?? fromOg.followers ?? null;
  const withLikes = posts.filter((p) => p.likes != null);
  const interactions = (p) => (p.likes ?? 0) + (p.comments ?? 0);
  const avgInteractions = posts.length ? posts.reduce((s, p) => s + interactions(p), 0) / posts.length : null;
  const dated = posts.filter((p) => p.ts).sort((a, b) => a.ts - b.ts);
  const spanDays = dated.length >= 2 ? (dated[dated.length - 1].ts - dated[0].ts) / DAY : null;
  return {
    followers, postsCount: fromDom.posts ?? fromOg.posts ?? null,
    sampled: posts.length, likesHidden: posts.length > 0 && withLikes.length === 0,
    engagementPct: followers && avgInteractions != null ? (avgInteractions / followers) * 100 : null,
    avgComments: posts.length ? posts.reduce((s, p) => s + (p.comments ?? 0), 0) / posts.length : null,
    perWeek: spanDays ? ((dated.length - 1) / spanDays) * 7 : null,
    daysSinceLast: dated.length ? Math.floor((now - dated[dated.length - 1].ts) / DAY) : null,
    reelShare: posts.length ? posts.filter((p) => p.isReel).length / posts.length : null,
    bioLink: profile.bioLink,
  };
}

/** Referência aproximada por porte do perfil: [bom a partir de, atenção a partir de], em %. */
export function engagementBenchmark(followers) {
  if (followers < 5000) return [3, 1.5];
  if (followers < 50000) return [1.5, 0.7];
  if (followers < 500000) return [1, 0.4];
  return [0.5, 0.2];
}

const fmtPct = (n) => n.toFixed(1).replace('.', ',');
const fmtNum = (n) => Math.round(n).toLocaleString('pt-BR');
const ok = (found) => ({ status: 'ok', found });
const warn = (found) => ({ status: 'warn', found });
const bad = (found) => ({ status: 'bad', found });
const na = (found) => ({ status: 'na', found });

export const IG_CHECKS = [
  {
    id: 'I1', group: 'engajamento', name: 'Os seguidores reagem aos posts',
    weight: 9, problem: "Os seguidores reagem pouco aos posts",
    cost: "Muitos seguidores sem curtidas e comentários indicam audiência que não vê ou não se interessa, e o alcance cai.",
    fix: "Testar chamadas para comentar, enquetes e conteúdos que respondam dúvidas reais dos clientes.",
    run: (a) => {
      if (a.engagementPct == null) return na('Não foi possível calcular a taxa de engajamento.');
      const [good, mid] = engagementBenchmark(a.followers);
      const t = `Taxa de engajamento de ${fmtPct(a.engagementPct)}% (${fmtNum(a.followers)} seguidores, ${a.sampled} posts analisados${a.likesHidden ? '; curtidas ocultas, só comentários' : ''}). Referência para o porte: acima de ${fmtPct(good)}%.`;
      return a.engagementPct >= good ? ok(t) : a.engagementPct >= mid ? warn(t) : bad(t);
    },
  },
  {
    id: 'I2', group: 'engajamento', name: 'Os posts geram conversa',
    weight: 6, problem: "Os posts quase não geram conversa",
    cost: "Comentários mostram interesse real e ajudam o Instagram a entregar o post para mais gente.",
    fix: "Fechar os posts com uma pergunta e responder todos os comentários nas primeiras horas.",
    run: (a) => {
      if (a.avgComments == null) return na('Não foi possível ler os comentários.');
      const t = `Média de ${fmtPct(a.avgComments)} comentários por post.`;
      return a.avgComments >= 5 ? ok(t) : a.avgComments >= 1 ? warn(t) : bad(t);
    },
  },
  {
    id: 'I3', group: 'frequencia', name: 'Publica com frequência',
    weight: 7, problem: "Publica pouco",
    cost: "Perfis que postam pouco perdem alcance e passam imagem de empresa parada.",
    fix: "Montar um calendário semanal com 3 ou mais posts por semana.",
    run: (a) => {
      if (a.perWeek == null) return na('Poucos posts com data para calcular a frequência.');
      const t = `Cerca de ${fmtPct(a.perWeek)} posts por semana (ideal: 3 ou mais).`;
      return a.perWeek >= 3 ? ok(t) : a.perWeek >= 1 ? warn(t) : bad(t);
    },
  },
  {
    id: 'I4', group: 'frequencia', name: 'Postou recentemente',
    weight: 8, problem: "Sem post recente",
    cost: "Um perfil sem post recente parece abandonado, e quem pesquisa a empresa antes de comprar desconfia.",
    fix: "Voltar a um ritmo fixo de publicação, retomando com um post de bastidores.",
    run: (a) => {
      if (a.daysSinceLast == null) return na('Não foi possível ler a data do último post.');
      const t = a.daysSinceLast === 0 ? 'O último post foi hoje.' : `O último post foi há ${a.daysSinceLast} dia(s).`;
      return a.daysSinceLast <= 7 ? ok(t) : a.daysSinceLast <= 30 ? warn(t) : bad(t);
    },
  },
  {
    id: 'I5', group: 'perfil', name: 'Usa vídeos curtos (Reels)',
    weight: 6, problem: "Não usa Reels",
    cost: "Os Reels são o formato que mais alcança quem ainda não segue o perfil; sem eles, o crescimento fica limitado a quem já conhece a empresa.",
    fix: "Publicar ao menos 1 Reels por semana, com bastidores e dúvidas frequentes.",
    run: (a) => {
      if (a.reelShare == null) return na('Não foi possível identificar os formatos.');
      const t = `${Math.round(a.reelShare * 100)}% dos posts analisados são Reels.`;
      return a.reelShare >= 0.25 ? ok(t) : a.reelShare > 0 ? warn(t) : bad(t);
    },
  },
  {
    id: 'I6', group: 'perfil', name: 'Tem link na bio',
    weight: 7, problem: "Sem link na bio",
    cost: "Quem se interessa não tem para onde ir, e o perfil não gera contato nem venda.",
    fix: "Colocar na bio um link para o WhatsApp ou para uma página de contato.",
    run: (a) => (a.bioLink ? ok('O perfil tem link na bio.') : bad('Não encontramos link na bio.')),
  },
];

export function igHeadline(o) {
  const fix = o.bad + o.warn;
  return o.level === 'bad' ? `Seu Instagram tem ${fix} pontos a corrigir que podem estar travando o alcance e as vendas.`
    : o.level === 'warn' ? `Seu Instagram está razoável, mas tem ${fix} pontos a corrigir.`
      : fix === 0 ? 'Seu Instagram está bem cuidado.' : `Seu Instagram está bem cuidado. Restam ${fix} ajustes.`;
}

export function runIgChecks(a) {
  return IG_CHECKS.map((c) => {
    let res;
    try { res = c.run(a); } catch (e) { res = na(`Erro na verificação: ${e.message}`); }
    return { id: c.id, group: c.group, name: c.name, problem: c.problem, cost: c.cost, fix: c.fix, weight: c.weight, ...res };
  });
}
