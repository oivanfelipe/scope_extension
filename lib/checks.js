// Checagens S.C.O.P.E. da v1 (análise estrutural da página aberta + domínio).
//
// Cada checagem devolve { score 1–5, evidence, recommendation } ou { na, reason }.
// Impacto (I) e Dependência (D) são fixos por checagem, definidos a partir da
// escala do playbook (ex.: indexação quebrada I=5 · alt ausente I=2 · URL ruim D=4).
// Qualidade (Q) vem da nota: Q = 6 − nota. Prioridade = Q × I × D.

import { isAllowed, rulesFor } from './robots.js';
import {
  clamp, fmtBytes, fmtMs, isApexHost, isThirdParty, normalizeUrl, pct, plural, priceVisible,
  stripTracking, stripWww, truncate,
} from './util.js';

const ok = (score, evidence, recommendation = '') => ({ score: clamp(Math.round(score), 1, 5), evidence, recommendation });
const NA = (reason) => ({ na: true, reason });
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const lines = (...l) => l.filter(Boolean).join('\n');

// ------------------------------------------------------------------ Schema

const typeName = (t) => String(t).replace(/^https?:\/\/schema\.org\//, '');

/** Percorre os JSON-LD e devolve todo objeto que tenha @type (inclusive aninhados). */
export function schemaNodes(jsonld) {
  const nodes = [];
  const walk = (v, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 12) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (v['@type']) nodes.push({ ...v, __types: asArray(v['@type']).map(typeName) });
    for (const val of Object.values(v)) walk(val, depth + 1);
  };
  for (const j of jsonld) if (j.ok) walk(j.data);
  return nodes;
}

const ORG_RE = /(Organization|Corporation|Business|Store|OnlineStore|Restaurant|Clinic|Dentist|Hospital|School|Agency|NGO)$/;
const PRODUCT_TYPES = ['Product', 'ProductGroup', 'IndividualProduct', 'ProductModel'];
const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report'];
const hasType = (nodes, pred) => nodes.some((n) => n.__types.some(pred));
const findNode = (nodes, pred) => nodes.find((n) => n.__types.some(pred));
const isOrgType = (t) => ORG_RE.test(t);
const isLocalBusinessType = (t) => /(LocalBusiness|Store|Restaurant|Clinic|Dentist|Hospital|Hotel|Gym|Salon|Pharmacy|Bakery|Service)$/.test(t) && t !== 'Service';

export function schemaPrices(nodes) {
  const out = new Set();
  for (const n of nodes) {
    if (!n.__types.some((t) => /Offer|PriceSpecification/.test(t))) continue;
    for (const k of ['price', 'lowPrice', 'highPrice']) {
      for (const raw of asArray(n[k])) {
        const num = Number(String(raw).replace(',', '.'));
        if (Number.isFinite(num) && num > 0) out.add(num);
      }
    }
  }
  return [...out];
}

export const PAGE_TYPES = {
  home: 'Home',
  category: 'Categoria / listagem',
  product: 'Produto',
  service: 'Serviço',
  article: 'Artigo / blog',
  page: 'Institucional / outra',
};

const BUY_CTA = /(comprar|adicionar (ao|à) (carrinho|sacola)|add to cart|buy now|compre agora|colocar no carrinho|adquirir)/i;
const QUOTE_CTA = /(or[çc]amento|solicit|fale com|falar com|agende|agendar|contrat|diagn[óo]stico gratuito|consultoria gratuita|whatsapp|entre em contato|quero (saber|contratar|um)|especialista)/i;
const SERVICE_PATH = /\/(servicos?|services?|solucoes|solu[cç][oõ]es|consultoria|especialidades|tratamentos?|planos?)(\/|$)/i;
const NON_SERVICE_PATH = /\/(contato|contact|sobre|quem-somos|about|privacidade|privacy|termos|terms|politica|blog|carreiras?)(\/|$)/i;

export function detectPageType(page) {
  const nodes = schemaNodes(page.jsonld);
  const path = (page.path || '/').split('?')[0];
  if (path === '/' || path === '') return 'home';
  const ogType = (page.og['og:type'] || '').toLowerCase();
  if (hasType(nodes, (t) => PRODUCT_TYPES.includes(t)) || /product/.test(ogType) || /\/(products?|produtos?|p)\/[^/]+/i.test(path)) return 'product';
  if (hasType(nodes, (t) => ARTICLE_TYPES.includes(t)) || ogType === 'article' || /\/(blog|artigos?|noticias|posts?|news)\/[^/]+/i.test(path)) return 'article';
  if (/\/(collections?|categorias?|category|categories|c)\//i.test(path) || hasType(nodes, (t) => ['CollectionPage', 'ItemList'].includes(t))) return 'category';
  const conv = page.conv || { ctas: [], forms: [] };
  const looksLikeService = hasType(nodes, (t) => ['Service', 'ProfessionalService'].includes(t)) || SERVICE_PATH.test(path)
    || (conv.forms.length > 0 && conv.ctas.some((c) => QUOTE_CTA.test(c.t)) && !conv.ctas.some((c) => BUY_CTA.test(c.t)));
  if (looksLikeService && !NON_SERVICE_PATH.test(path)) return 'service';
  return 'page';
}

export function buildContext(page, net = {}, pageType, DOMParserCtor) {
  const nodes = schemaNodes(page.jsonld);
  return {
    page, net, nodes,
    pageType: pageType && PAGE_TYPES[pageType] ? pageType : detectPageType(page),
    detectedType: detectPageType(page),
    url: new URL(page.url),
    DOMParser: DOMParserCtor || globalThis.DOMParser,
  };
}

const ECOM_PLATFORMS = ['Shopify', 'WooCommerce', 'VTEX', 'Nuvemshop', 'Magento', 'Loja Integrada'];

/** Contexto de loja virtual: página de produto/categoria, plataforma de e-commerce ou botão de compra. */
export function isStore(ctx) {
  const { page, pageType } = ctx;
  return pageType === 'product' || pageType === 'category'
    || (page.platforms || []).some((p) => ECOM_PLATFORMS.includes(p))
    || (page.conv?.ctas || []).some((c) => BUY_CTA.test(c.t));
}

// ----------------------------------------------------------- S · Técnico

const S = [];

S.push({
  id: 'S1', dim: 'S', name: 'Status HTTP da página', impact: 5, dependency: 5,
  run({ page, net }) {
    const pf = net.pageFetch;
    if (!pf || pf.error) return NA(`Não foi possível reconsultar a URL (${pf?.error || 'sem resposta'}).`);
    const s = pf.status;
    if ([401, 403, 429].includes(s)) return NA(`O servidor respondeu ${s} à consulta automática (provável proteção anti-bot). A página abriu normalmente no navegador.`);
    if (s >= 500) return ok(1, `A URL respondeu HTTP ${s} (erro de servidor).`, 'Corrigir o erro de servidor; páginas 5xx recorrentes perdem rastreamento e posições.');
    if (s === 404 || s === 410) return ok(1, `A URL respondeu HTTP ${s}; é uma página de erro.`, 'Restaurar a página ou redirecionar (301) para o equivalente mais próximo.');
    if (s >= 400) return ok(2, `A URL respondeu HTTP ${s}.`, 'Investigar o bloqueio/erro e garantir resposta 200 para o Googlebot.');
    if (pf.redirected && normalizeUrl(pf.finalUrl) !== normalizeUrl(page.url)) {
      return ok(3, `A URL aberta ainda redireciona para ${truncate(pf.finalUrl, 90)}.`, 'Usar sempre a URL final em links internos, sitemap e canonical.');
    }
    return ok(5, `HTTP ${s}, sem redirecionamento.`);
  },
});

S.push({
  id: 'S2', dim: 'S', name: 'Indexabilidade (meta robots / X-Robots-Tag)', impact: 5, dependency: 5,
  run({ page, net }) {
    const dirs = [];
    for (const m of page.robotsMeta) for (const t of m.content.split(',')) if (t.trim()) dirs.push({ src: `meta ${m.name}`, token: t.trim() });
    const xr = net.pageFetch?.headers?.['x-robots-tag'];
    if (xr) for (const t of xr.toLowerCase().replace(/^\s*(googlebot|bingbot|\*)\s*:/, '').split(',')) if (t.trim()) dirs.push({ src: 'X-Robots-Tag', token: t.trim() });
    const blocking = dirs.filter((d) => d.token === 'noindex' || d.token === 'none');
    const nofollow = dirs.filter((d) => d.token === 'nofollow');
    const shown = dirs.length ? dirs.map((d) => `${d.token} em ${d.src}`).join(', ') : 'nenhuma diretiva (padrão: index, follow)';
    if (blocking.length) {
      return ok(1, `Esta página está marcada para NÃO aparecer no Google (${shown}).`, 'Se a página deveria ranquear, remover o noindex. Se for intencional (obrigado, carrinho, busca interna), ignore este alerta.');
    }
    if (nofollow.length) return ok(3, `A página pede ao Google que não siga os links dela (${shown}).`, 'O nofollow na página impede a passagem de autoridade pelos links internos; remover se não for intencional.');
    return ok(5, `A página está liberada para aparecer no Google (${shown}).`);
  },
});

S.push({
  id: 'S3', dim: 'S', name: 'Canonical', impact: 4, dependency: 4,
  run({ page, net }) {
    const cs = page.canonicals;
    const header = /<([^>]+)>;\s*rel="?canonical"?/i.exec(net.pageFetch?.headers?.link || '');
    if (!cs.length) {
      return ok(3, 'A página não informa ao Google qual é o endereço oficial dela (canonical ausente).', 'Adicionar <link rel="canonical"> autorreferente em todas as páginas indexáveis para evitar duplicidade por parâmetros e variações.');
    }
    const distinct = [...new Set(cs.map((c) => normalizeUrl(c.href)))];
    if (distinct.length > 1) return ok(1, `${cs.length} canonicals conflitantes: ${distinct.slice(0, 3).join(' · ')}.`, 'Manter uma única canonical por página (verifique tema, apps/plugins de SEO duplicando a tag).');
    const c = cs[0].href;
    if (!c) return ok(2, 'A tag canonical está vazia.', 'Preencher a canonical com a URL absoluta da própria página.');
    const cu = new URL(c);
    const pu = new URL(page.url);
    let result;
    if (stripWww(cu.hostname) !== stripWww(pu.hostname)) {
      result = ok(2, `Canonical aponta para outro domínio: ${truncate(c, 100)}.`, 'Confirmar se a canonização cross-domain é intencional; caso contrário, apontar para a própria URL.');
    } else if (pu.protocol === 'https:' && cu.protocol === 'http:') {
      result = ok(2, `Canonical em HTTP numa página HTTPS: ${truncate(c, 100)}.`, 'Atualizar a canonical para HTTPS.');
    } else if (normalizeUrl(stripTracking(c)) === normalizeUrl(stripTracking(page.url))) {
      result = ok(5, `Canonical autorreferente: ${truncate(c, 100)}.`);
    } else if (normalizeUrl(cu.origin + cu.pathname) === normalizeUrl(pu.origin + pu.pathname)) {
      result = ok(5, `Canonical remove parâmetros da URL: ${truncate(c, 100)}.`);
    } else {
      result = ok(2, `O endereço oficial informado ao Google é outro: ${truncate(c, 100)}. Por isso o Google tende a ignorar esta página.`, 'Se esta página deveria ranquear por conta própria, a canonical precisa ser autorreferente; do contrário o Google tende a ignorá-la.');
    }
    if (header && normalizeUrl(header[1]) !== normalizeUrl(c)) {
      return ok(Math.min(result.score, 2), `${result.evidence}\nCanonical no header HTTP (${truncate(header[1], 80)}) diverge da canonical do HTML.`, 'Alinhar a canonical do header com a do HTML.');
    }
    return result;
  },
});

S.push({
  id: 'S4', dim: 'S', name: 'HTTPS e conteúdo misto', impact: 4, dependency: 3,
  run({ page }) {
    if (page.protocol !== 'https:') return ok(1, 'A página é servida em HTTP, sem criptografia.', 'Instalar certificado SSL e redirecionar todo o tráfego HTTP para HTTPS (301).');
    const { active, passive, samples } = page.mixed;
    const note = 'O navegador carregou a página sem alerta de certificado (validade/emissor/nota SSL Labs não são lidos pela extensão).';
    if (active) return ok(2, lines(`${plural(active, 'recurso ativo', 'recursos ativos')} em HTTP (script/iframe/CSS) numa página HTTPS: ${samples.join(', ')}.`, note), 'Trocar todos os recursos para HTTPS; conteúdo misto ativo é bloqueado pelo navegador e quebra a página.');
    if (passive) return ok(4, lines(`${plural(passive, 'imagem/mídia', 'imagens/mídias')} em HTTP numa página HTTPS: ${samples.join(', ')}.`, note), 'Trocar as URLs de mídia para HTTPS.');
    return ok(5, lines('HTTPS ativo, sem conteúdo misto.', note));
  },
});

S.push({
  id: 'S5', dim: 'S', name: 'Versões do domínio (http/https · www)', impact: 4, dependency: 4,
  run({ net, page }) {
    const v = net.variants;
    if (!v || v.error) return NA('Não foi possível testar as variações do domínio.');
    const resp = v.variants.filter((x) => !x.error && x.status < 400);
    const bad = v.variants.filter((x) => !x.error && x.status >= 400);
    const failed = v.variants.filter((x) => x.error);
    if (!resp.length) return NA('Nenhuma variação do domínio respondeu à consulta automática.');
    const finals = [...new Set(resp.map((x) => normalizeUrl(x.finalUrl)))];
    const detail = v.variants.map((x) => `${x.url} → ${x.error ? 'sem resposta' : `${truncate(x.finalUrl, 60)} (${x.status})`}`).join('\n');
    const withWww = v.apex ? '' : '\n(subdomínio: variação www não testada)';
    const hsts = '\n(o navegador pode ter aplicado HSTS e antecipado o http → https)';
    let r;
    if (finals.length === 1) {
      r = finals[0].startsWith('http:')
        ? ok(1, lines('O site só responde em HTTP.', detail), 'Migrar para HTTPS e redirecionar HTTP → HTTPS.')
        : ok(5, lines(`Todas as variações convergem para ${finals[0]}.`, detail) + withWww + hsts);
    } else if (finals.length === 2) {
      const [a, b] = finals.map((f) => new URL(f));
      const protocolOnly = stripWww(a.hostname) === stripWww(b.hostname) && a.protocol !== b.protocol;
      r = ok(2, lines(protocolOnly ? 'A versão HTTP responde sem redirecionar para HTTPS.' : 'Duas versões do domínio respondem sem redirecionar (www × sem www).', detail),
        'Definir uma única versão canônica e redirecionar (301) todas as demais para ela.');
    } else {
      r = ok(1, lines(`${finals.length} versões do domínio acessíveis e distintas.`, detail), 'Definir uma única versão canônica e redirecionar (301) todas as demais.');
    }
    if (bad.length && r.score > 4) return ok(4, lines(r.evidence, `${plural(bad.length, 'variação respondeu', 'variações responderam')} com erro (${bad.map((b) => b.status).join(', ')}).`), 'Configurar redirecionamento também para a variação que está dando erro.');
    if (failed.length && !bad.length) r.evidence += `\n${plural(failed.length, 'variação não resolveu', 'variações não resolveram')} (DNS/conexão) — ok se não for usada.`;
    return r;
  },
});

S.push({
  id: 'S6', dim: 'S', name: 'robots.txt', impact: 5, dependency: 5,
  run({ net, page }) {
    const r = net.robots;
    if (!r || r.error) return NA(`Não foi possível ler o robots.txt (${r?.error || 'sem resposta'}).`);
    if (r.status >= 500) return ok(2, `O robots.txt respondeu HTTP ${r.status}.`, 'Erros 5xx no robots.txt podem fazer o Google pausar o rastreamento do site inteiro; corrigir com urgência.');
    if (r.status === 404 || r.status === 410 || r.isHtml || !r.parsed) {
      return ok(3, `robots.txt inexistente${r.isHtml ? ' (a URL devolve uma página HTML)' : ` (HTTP ${r.status})`}.`, 'Criar um robots.txt com as regras de rastreamento e a referência ao sitemap.');
    }
    const p = r.parsed;
    const g = isAllowed(p, 'googlebot', page.path || '/');
    const { rules } = rulesFor(p, 'googlebot');
    const dis = rules.filter((x) => x.type === 'disallow');
    const rootBlocked = dis.some((x) => x.path === '/') && !rules.some((x) => x.type === 'allow' && x.path === '/');
    const strategic = dis.filter((x) => /^\/(blog|produtos?|products?|collections?|categorias?|artigos?|servicos|loja|noticias|posts?)\/?\*?$/i.test(x.path));
    const resources = dis.filter((x) => /^\/(\*\.?(js|css)\$?$|(wp-content|wp-includes|assets|static|_next|js|css)(\/|\*|$))/i.test(x.path));
    const base = `${dis.length} regras Disallow para ${rulesFor(p, 'googlebot').matched === 'googlebot' ? 'Googlebot' : 'User-agent: *'} · ${p.sitemaps.length ? plural(p.sitemaps.length, 'Sitemap declarado', 'Sitemaps declarados') : 'sem Sitemap declarado'}.`;
    if (rootBlocked) return ok(1, lines('O robots.txt bloqueia o site inteiro (Disallow: /).', base), 'Remover o Disallow: / — o site está invisível para o Google.');
    if (!g.allowed) return ok(1, lines(`Esta URL está bloqueada para o Googlebot pela regra "${g.rule.type === 'disallow' ? 'Disallow' : 'Allow'}: ${g.rule.path}".`, base), 'Liberar a URL no robots.txt se ela deve ser rastreada.');
    if (strategic.length) return ok(3, lines(`Seções que parecem estratégicas estão bloqueadas: ${strategic.map((x) => x.path).join(', ')}.`, base), 'Confirmar se o bloqueio é intencional; seções de conteúdo/produto não devem ficar em Disallow.');
    if (resources.length) return ok(3, lines(`Recursos de renderização possivelmente bloqueados: ${resources.slice(0, 4).map((x) => x.path).join(', ')}.`, base), 'Liberar JS/CSS necessários para o Googlebot renderizar a página.');
    if (!p.sitemaps.length) return ok(4, lines('robots.txt correto, mas sem a diretiva Sitemap.', base), 'Adicionar a linha "Sitemap: https://dominio/sitemap.xml" ao robots.txt.');
    return ok(5, lines('robots.txt presente e sem bloqueios indevidos; esta URL está liberada.', base));
  },
});

S.push({
  id: 'S7', dim: 'S', name: 'Sitemap.xml', impact: 4, dependency: 3,
  run({ net, page }) {
    const sm = net.sitemap;
    if (!sm || sm.error) return NA('Não foi possível analisar o sitemap.');
    if (!sm.found) {
      return ok(1, `Nenhum sitemap encontrado${sm.errors?.length ? ` (${truncate(sm.errors[0], 90)})` : ''}.`, 'Gerar o sitemap.xml e declará-lo no robots.txt e no Search Console.');
    }
    const files = `${plural(sm.childrenTotal, 'arquivo', 'arquivos')}, ~${sm.totalUrls.toLocaleString('pt-BR')} URLs${sm.truncated ? ` (lidos ${sm.childrenFetched} de ${sm.childrenTotal})` : ''}`;
    const err = sm.errors.length ? `\n${plural(sm.errors.length, 'arquivo com erro', 'arquivos com erro')}: ${truncate(sm.errors[0], 90)}` : '';
    const notes = [];
    let score = 5;
    const reco = [];
    if (sm.flaggedCount >= 3) { score = Math.min(score, 2); notes.push(`${sm.flaggedCount} URLs de obrigado/erro/formulário/carrinho no sitemap (ex.: ${sm.flagged.slice(0, 3).join(', ')})`); reco.push('Remover do sitemap e aplicar noindex nas páginas transacionais/internas.'); }
    else if (sm.flaggedCount) { score = Math.min(score, 3); notes.push(`${plural(sm.flaggedCount, 'URL transacional', 'URLs transacionais')} no sitemap (${sm.flagged.join(', ')})`); reco.push('Remover do sitemap as páginas de obrigado/erro/formulário.'); }
    if (sm.errors.length && !sm.files.some((f) => f.urls)) { score = Math.min(score, 2); reco.push('Corrigir os erros do sitemap.'); }
    else if (sm.errors.length) { score = Math.min(score, 4); reco.push('Corrigir os arquivos de sitemap com erro.'); }
    if (sm.hostMismatch) { score = Math.min(score, 3); notes.push(`${sm.hostMismatch} URLs de outro host`); reco.push('O sitemap deve listar apenas URLs do mesmo host.'); }
    if (sm.httpUrls) { score = Math.min(score, 3); notes.push(`${sm.httpUrls} URLs em HTTP`); reco.push('Listar apenas URLs HTTPS no sitemap.'); }
    if (!sm.declaredInRobots) { score = Math.min(score, 4); notes.push('sitemap não declarado no robots.txt'); reco.push('Declarar o sitemap no robots.txt.'); }
    const self = net.pageFetch && net.pageFetch.status === 200 && !sm.truncated;
    if (self && !sm.containsPage && !/noindex/.test(page.robotsMeta.map((m) => m.content).join())) {
      const canon = page.canonicals[0]?.href;
      if (!canon || normalizeUrl(canon) === normalizeUrl(page.url)) {
        score = Math.min(score, 4); notes.push('esta URL não consta no sitemap'); reco.push('Incluir esta URL no sitemap (se for uma página indexável).');
      }
    } else if (sm.containsPage) notes.push('esta URL consta no sitemap');
    else if (sm.truncated) notes.push('presença desta URL não verificada (sitemap grande)');
    return ok(score, lines(files + '.', notes.length ? notes.join(' · ') + '.' : '', err), reco.join(' '));
  },
});

S.push({
  id: 'S8', dim: 'S', name: 'Links internos quebrados e redirecionados (amostra)', impact: 4, dependency: 3,
  run({ net }) {
    const l = net.links;
    if (!l || l.error) return NA('Não foi possível testar os links.');
    if (!l.checked) return NA('A página não tem links internos para testar.');
    const broken = l.results.filter((r) => r.status >= 400);
    const redirected = l.results.filter((r) => r.redirected && r.status < 400);
    const failed = l.results.filter((r) => r.error);
    const tested = l.checked - failed.length;
    if (tested <= 0) return NA('Nenhum link interno respondeu ao teste.');
    const br = broken.length / tested, rr = redirected.length / tested;
    const ev = lines(
      `${tested} de ${l.total} links internos testados (amostra): ${plural(broken.length, 'quebrado', 'quebrados')} (4xx/5xx), ${redirected.length} com redirecionamento${failed.length ? `, ${failed.length} sem resposta` : ''}.`,
      broken.length ? 'Quebrados: ' + broken.slice(0, 4).map((b) => `${truncate(b.href, 70)} (${b.status})`).join(' · ') : '',
      redirected.length ? 'Redirecionados: ' + redirected.slice(0, 3).map((b) => truncate(b.href, 60)).join(' · ') : '',
    );
    let score;
    if (br === 0) score = rr <= 0.1 ? 5 : 4;
    else if (br <= 0.05) score = 3;
    else if (br <= 0.15) score = 2;
    else score = 1;
    return ok(score, ev, 'Corrigir os links que retornam 4xx/5xx e atualizar os que passam por redirecionamento para a URL final.');
  },
});

// ------------------------------------------- C · Conteúdo & Arquitetura

const C = [];
const GENERIC_H1 = /^(news|home|blog|início|inicio|welcome|bem[- ]vindo|página inicial|pagina inicial|produtos|products|shop|loja|store|collection|collections|coleção|catalog|catálogo|untitled|sem título)$/i;
const GENERIC_TITLE = /^(home|início|inicio|untitled|document|sem título|página inicial|index|new page)$/i;

C.push({
  id: 'C1', dim: 'C', name: 'Title tag', impact: 4, dependency: 2,
  run({ page }) {
    const t = page.title;
    if (!t) return ok(1, 'A página não tem <title>.', 'Criar um title único com a keyword principal e a marca (30–60 caracteres).');
    if (page.titleCount > 1) return ok(2, `${page.titleCount} tags <title> na página: "${truncate(t, 70)}".`, 'Manter uma única tag <title>.');
    if (GENERIC_TITLE.test(t)) return ok(2, `Title genérico: "${t}".`, 'Reescrever o title com a keyword principal e a marca.');
    const n = t.length;
    const ev = `"${truncate(t, 90)}" — ${n} caracteres.`;
    if (n >= 30 && n <= 65) return ok(5, ev);
    if ((n >= 20 && n < 30) || (n > 65 && n <= 75)) return ok(4, ev, n < 30 ? 'Title curto: aproveitar o espaço para incluir keyword e diferencial (30–60 caracteres).' : 'Title longo: pode ser truncado no Google; mirar em 30–60 caracteres.');
    return ok(3, ev, n < 20 ? 'Title muito curto: reescrever com keyword principal e marca.' : 'Title muito longo: será truncado no Google; reduzir para ~60 caracteres.');
  },
});

C.push({
  id: 'C2', dim: 'C', name: 'Meta description', impact: 2, dependency: 1,
  run({ page }) {
    const ds = page.metaDescriptions.filter((x) => x !== undefined);
    const d = ds[0] || '';
    if (!d) return ok(2, 'Meta description ausente ou vazia. O Google montará o snippet automaticamente.', 'Escrever uma meta description única (70–160 caracteres) com benefício e chamada para ação.');
    if (ds.length > 1) return ok(3, `${ds.length} meta descriptions na página.`, 'Manter uma única meta description.');
    const n = d.length;
    const ev = `${n} caracteres: "${truncate(d, 110)}"`;
    if (d.toLowerCase() === page.title.toLowerCase()) return ok(3, `${ev}\nIgual ao title.`, 'Diferenciar a description do title, com benefício e CTA.');
    if (n >= 70 && n <= 160) return ok(5, ev);
    if ((n >= 50 && n < 70) || (n > 160 && n <= 200)) return ok(4, ev, n < 70 ? 'Description curta: ampliar para 70–160 caracteres.' : 'Description longa: será truncada; reduzir para ~160 caracteres.');
    return ok(3, ev, n < 50 ? 'Description muito curta.' : 'Description muito longa: será truncada.');
  },
});

C.push({
  id: 'C3', dim: 'C', name: 'H1', impact: 4, dependency: 2,
  run({ page }) {
    const h1s = page.headings.filter((h) => h.level === 1);
    if (!h1s.length) return ok(1, 'A página não tem H1.', 'Definir um único H1 com a keyword principal da página.');
    if (h1s.length > 1) return ok(3, `${h1s.length} H1 na página: ${h1s.slice(0, 3).map((h) => `"${truncate(h.text, 40)}"`).join(' · ')}.`, 'Manter um único H1 descrevendo o tema da página.');
    const t = h1s[0].text;
    if (!t) return ok(1, 'O H1 existe mas está vazio (provavelmente só imagem/ícone).', 'Preencher o H1 com texto descritivo.');
    if (GENERIC_H1.test(t)) return ok(2, `H1 genérico: "${t}".`, 'Trocar por um H1 com a keyword relevante (ex.: "Blog de Ergonomia Corporativa").');
    const tok = (s) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const a = tok(t), b = tok(page.title);
    const overlap = [...a].filter((w) => b.has(w)).length;
    if (t.length > 70) return ok(4, `H1 longo (${t.length} caracteres): "${truncate(t, 90)}".`, 'Encurtar o H1 para ficar objetivo.');
    if (a.size && b.size && overlap === 0) return ok(4, `H1: "${truncate(t, 90)}" — sem termos em comum com o title.`, 'Alinhar H1 e title ao mesmo tema/keyword.');
    return ok(5, `H1 único: "${truncate(t, 90)}".`);
  },
});

C.push({
  id: 'C4', dim: 'C', name: 'Hierarquia de headings (H2–H6)', impact: 3, dependency: 2,
  run({ page }) {
    const hs = page.headings;
    const h2 = hs.filter((h) => h.level === 2).length;
    let skips = 0, prev = 0;
    for (const h of hs) { if (prev && h.level > prev + 1) skips++; prev = h.level; }
    const empty = hs.filter((h) => !h.text).length;
    const firstIsH1 = hs.length && hs[0].level === 1;
    const counts = [1, 2, 3, 4].map((l) => `H${l}:${hs.filter((h) => h.level === l).length}`).join(' ');
    const ev = `${plural(hs.length, 'heading', 'headings')} (${counts}); ${plural(skips, 'salto de nível', 'saltos de nível')}; ${plural(empty, 'vazio', 'vazios')}.`;
    if (!h2 && page.contentWordCount >= 250) return ok(2, `${ev}\nConteúdo longo sem nenhum H2.`, 'Estruturar o conteúdo em seções com H2/H3 (facilita leitura, rastreamento e extração por IA).');
    if (!h2) return ok(page.contentWordCount < 150 ? 4 : 3, `${ev}\nSem H2.`, 'Adicionar H2 para organizar as seções da página.');
    let s = 5;
    if (skips) s -= skips > 2 ? 2 : 1;
    if (empty) s -= 1;
    if (hs.length && !firstIsH1 && hs.some((h) => h.level === 1)) s -= 1;
    return ok(s, ev, 'Corrigir a ordem lógica dos headings (H1 → H2 → H3, sem pular níveis) e remover headings vazios.');
  },
});

C.push({
  id: 'C5', dim: 'C', name: 'Estrutura da URL', impact: 3, dependency: 4,
  run({ url, page }) {
    if (url.pathname === '/' && !url.search) return ok(5, 'URL da home, limpa.');
    const issues = [];
    let s = 5;
    const len = url.pathname.length + url.search.length;
    const segs = url.pathname.split('/').filter(Boolean);
    if (len > 115) { s--; issues.push(`longa (${len} caracteres)`); }
    if (/[A-Z]/.test(url.pathname)) { s--; issues.push('letras maiúsculas'); }
    if (/_/.test(url.pathname)) { s--; issues.push('underscores (use hífen)'); }
    const params = [...url.searchParams.keys()].filter((k) => !/^(variant|utm_|gclid|fbclid|msclkid|srsltid|ref$|cor$|color$|size$|tamanho$|pr_)/i.test(k)).length;
    if (params) { s -= params > 2 ? 2 : 1; issues.push(`${plural(params, 'parâmetro', 'parâmetros')} de query`); }
    if (/%[0-9a-f]{2}/i.test(url.pathname)) { s--; issues.push('caracteres codificados/acentos'); }
    if (segs.length > 4) { s--; issues.push(`${segs.length} níveis de profundidade`); }
    if (/\.(php|asp|aspx|jsp)$/i.test(url.pathname)) { s--; issues.push('extensão de script na URL'); }
    return ok(s, `${truncate(url.pathname + url.search, 110)} — ${issues.length ? issues.join(', ') : 'curta, legível, minúscula e com hífens'}.`, 'Adotar URLs curtas, em minúsculas, sem acentos/parâmetros e com palavras separadas por hífen; alterações exigem 301 do endereço antigo.');
  },
});

C.push({
  id: 'C6', dim: 'C', name: 'Links internos', impact: 4, dependency: 3,
  run({ page }) {
    const l = page.links;
    if (!l.internalUnique) return ok(1, 'A página não tem nenhum link interno (beco sem saída).', 'Adicionar links internos contextuais para páginas relacionadas e categorias.');
    const issues = [];
    let s = l.internalUnique >= 10 ? 5 : l.internalUnique >= 5 ? 4 : l.internalUnique >= 3 ? 3 : 2;
    if (l.internalAnchors && l.genericAnchors / l.internalAnchors > 0.2) { s--; issues.push(`${plural(l.genericAnchors, 'âncora genérica', 'âncoras genéricas')} ("clique aqui", "saiba mais")`); }
    if (l.internalAnchors && l.emptyAnchors / l.internalAnchors > 0.1) { s--; issues.push(`${l.emptyAnchors} links sem texto âncora`); }
    if (l.nofollowInternal) { s--; issues.push(`${l.nofollowInternal} links internos com nofollow`); }
    if (l.httpInternal) { s--; issues.push(`${l.httpInternal} links internos em HTTP`); }
    return ok(s, `${plural(l.internalUnique, 'link interno único', 'links internos únicos')}, ${plural(l.externalUnique, 'externo', 'externos')}${issues.length ? '. Problemas: ' + issues.join('; ') : ''}.`, 'Reforçar o interlinking com âncoras descritivas, sem nofollow interno, apontando para as URLs finais (HTTPS).');
  },
});

C.push({
  id: 'C7', dim: 'C', name: 'Breadcrumbs', impact: 2, dependency: 2,
  run({ page, nodes, pageType }) {
    if (pageType === 'home') return NA('A home não precisa de breadcrumb.');
    const schema = hasType(nodes, (t) => t === 'BreadcrumbList');
    const dom = page.breadcrumbDom;
    if (schema && dom) return ok(5, 'Breadcrumb visível e marcado com BreadcrumbList.');
    if (schema) return ok(4, 'BreadcrumbList presente no schema, mas sem breadcrumb visível identificado.', 'Exibir o breadcrumb na página, coerente com o schema.');
    if (dom) return ok(3, 'Breadcrumb visível, mas sem schema BreadcrumbList.', 'Marcar o breadcrumb com JSON-LD BreadcrumbList para exibir o caminho no resultado do Google.');
    return ok(2, 'Nenhum breadcrumb identificado.', 'Implementar breadcrumb visível + schema BreadcrumbList (reforça hierarquia e interlinking).');
  },
});

C.push({
  id: 'C8', dim: 'C', name: 'Texto alternativo das imagens', impact: 2, dependency: 1,
  run({ page }) {
    const imgs = page.images;
    if (!imgs.length) return NA('A página não tem imagens de conteúdo.');
    const missing = imgs.filter((i) => i.alt === 'missing').length;
    const empty = imgs.filter((i) => i.alt === 'empty').length;
    const share = missing / imgs.length;
    const s = share === 0 ? 5 : share <= 0.05 ? 4 : share <= 0.2 ? 3 : share <= 0.5 ? 2 : 1;
    return ok(s, `${missing} de ${imgs.length} imagens sem atributo alt (${pct(missing, imgs.length)}%); ${empty} com alt vazio (decorativas).`, 'Descrever as imagens relevantes no alt (e usar alt="" apenas nas decorativas).');
  },
});

C.push({
  id: 'C9', dim: 'C', name: 'Volume de conteúdo da página', impact: 3, dependency: 2, types: ['home', 'category', 'article', 'service', 'page'],
  run(ctx) {
    const { page, pageType } = ctx;
    const w = page.contentWordCount;
    const store = isStore(ctx);
    let s;
    if (pageType === 'article') s = w >= 1000 ? 5 : w >= 600 ? 4 : w >= 300 ? 3 : w >= 150 ? 2 : 1;
    else if (pageType === 'home') s = store ? (w >= 200 ? 5 : w >= 100 ? 4 : w >= 50 ? 3 : w >= 20 ? 2 : 1) : (w >= 300 ? 5 : w >= 150 ? 4 : w >= 80 ? 3 : w >= 30 ? 2 : 1);
    else if (pageType === 'category') s = w >= 250 ? 5 : w >= 150 ? 4 : w >= 80 ? 3 : w >= 30 ? 2 : 1;
    else s = w >= 500 ? 5 : w >= 300 ? 4 : w >= 150 ? 3 : w >= 50 ? 2 : 1;
    const note = pageType === 'category' ? ' Em categoria, basta um texto de apoio acima/abaixo da vitrine.' : '';
    return ok(s, `~${w.toLocaleString('pt-BR')} palavras no conteúdo principal (referência para tipo "${PAGE_TYPES[pageType]}").${note}`, pageType === 'category' ? 'Adicionar um texto curto e útil sobre a categoria (guia de escolha, diferenciais) para dar contexto ao Google.' : 'Páginas com pouco texto têm menos chance de ranquear; ampliar com conteúdo útil e estruturado (FAQ, especificações, guias).');
  },
});

C.push({
  id: 'C10', dim: 'C', name: 'Idioma, hreflang e Open Graph', impact: 2, dependency: 1,
  run({ page }) {
    let s = 5;
    const issues = [], notes = [];
    if (!page.lang) { s -= 2; issues.push('atributo lang ausente no <html>'); }
    else if (!/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(page.lang)) { s -= 1; issues.push(`lang inválido ("${page.lang}")`); }
    else notes.push(`lang="${page.lang}"`);
    const hl = page.hreflangs;
    if (hl.length) {
      const bad = hl.filter((h) => h.lang !== 'x-default' && !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(h.lang));
      const self = hl.some((h) => normalizeUrl(h.href) === normalizeUrl(page.url));
      if (bad.length) { s--; issues.push(`hreflang inválido (${bad.slice(0, 2).map((b) => b.lang).join(', ')})`); }
      if (!self) { s--; issues.push('hreflang sem referência à própria URL'); }
      if (!hl.some((h) => h.lang === 'x-default')) notes.push('sem x-default');
      notes.push(`${hl.length} hreflangs`);
    }
    const ogMissing = ['og:title', 'og:description', 'og:image'].filter((k) => !page.og[k]);
    if (ogMissing.length >= 2) { s--; issues.push(`Open Graph incompleto (faltam ${ogMissing.join(', ')})`); }
    else if (ogMissing.length) issues.push(`faltam ${ogMissing.join(', ')}`);
    else notes.push('Open Graph completo');
    return ok(s, [...issues, ...notes].join(' · ') + '.', 'Declarar lang no <html>, corrigir/completar hreflang quando houver versões de idioma e preencher og:title, og:description e og:image.');
  },
});

// ------------------------------------------------- P · Performance & UX

const P = [];

P.push({
  id: 'P1', dim: 'P', name: 'Mobile-first (viewport e overflow)', impact: 4, dependency: 3,
  run({ page }) {
    const v = page.viewport;
    if (!v) return ok(1, 'Sem meta viewport: a página não é adaptada a mobile.', 'Adicionar <meta name="viewport" content="width=device-width, initial-scale=1">.');
    let s = 5;
    const notes = [`viewport: "${v}"`];
    if (!/width\s*=\s*device-width/i.test(v)) { s = 2; notes.push('largura fixa/ausente'); }
    if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?(?!\d)/i.test(v)) { s = Math.min(s, 4); notes.push('bloqueia zoom (acessibilidade)'); }
    if (page.layout.overflowX) { s = Math.min(s, 3); notes.push(`rolagem horizontal na largura atual (${page.layout.innerWidth}px)`); }
    return ok(s, notes.join(' · ') + '.', 'Usar width=device-width, não bloquear o zoom e eliminar elementos que estouram a largura.');
  },
});

P.push({
  id: 'P2', dim: 'P', name: 'TTFB (medição local)', impact: 3, dependency: 2,
  run({ page }) {
    const nav = page.perf.nav;
    if (!nav) return NA('Navigation Timing indisponível.');
    if (nav.transferSize === 0 && nav.encodedBodySize > 0) return NA('A página veio do cache do navegador; recarregue (Ctrl+Shift+R) e analise de novo.');
    const t = nav.ttfb;
    const s = t <= 400 ? 5 : t <= 800 ? 4 : t <= 1200 ? 3 : t <= 1800 ? 2 : 1;
    return ok(s, `TTFB de ${fmtMs(t)} medido neste navegador/rede (indicativo, não é dado de campo).`, 'Reduzir o tempo de resposta do servidor: cache de página/CDN, otimizar consultas e apps no back-end.');
  },
});

P.push({
  id: 'P3', dim: 'P', name: 'LCP (medição local)', impact: 4, dependency: 2,
  run({ page }) {
    const l = page.perf.lcp;
    if (!l) return NA('LCP não reportado (a aba pode ter ficado em segundo plano). Deixe a aba ativa e reanalise.');
    let s = l.time <= 1800 ? 5 : l.time <= 2500 ? 4 : l.time <= 3200 ? 3 : l.time <= 4000 ? 2 : 1;
    const notes = [`LCP de ${fmtMs(l.time)} (${l.tag || 'elemento'}) medido localmente — indicativo; o dado oficial vem do CrUX/PageSpeed (etapa 2).`];
    if (l.lazy) { s = Math.min(s, 3); notes.push('o elemento do LCP usa loading="lazy"'); }
    return ok(s, notes.join('\n'), 'Priorizar a imagem/bloco principal (preload, fetchpriority="high", sem lazy-load), reduzir JS bloqueante e otimizar o servidor.');
  },
});

P.push({
  id: 'P4', dim: 'P', name: 'CLS (medição local)', impact: 3, dependency: 2,
  run({ page }) {
    const c = page.perf.cls;
    if (c == null) return NA('CLS indisponível neste navegador.');
    const s = c <= 0.05 ? 5 : c <= 0.1 ? 4 : c <= 0.18 ? 3 : c <= 0.25 ? 2 : 1;
    return ok(s, `CLS de ${c.toFixed(3).replace('.', ',')} medido localmente até agora (indicativo).`, 'Reservar espaço para imagens, banners e anúncios (width/height, aspect-ratio) e evitar inserir conteúdo acima do que já foi renderizado.');
  },
});

P.push({
  id: 'P5', dim: 'P', name: 'Peso da página', impact: 3, dependency: 2,
  run(ctx) {
    const { page } = ctx;
    const r = page.perf.resources;
    if (!r.count) return NA('Resource Timing indisponível.');
    const mb = r.bytes / 1048576;
    const store = isStore(ctx);
    const s = store ? (mb <= 2 ? 5 : mb <= 3.5 ? 4 : mb <= 5 ? 3 : mb <= 7 ? 2 : 1) : (mb <= 1 ? 5 : mb <= 2 ? 4 : mb <= 3.5 ? 3 : mb <= 5 ? 2 : 1);
    const top = Object.entries(r.byType).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, b]) => `${t}: ${fmtBytes(b)}`).join(' · ');
    return ok(s, `~${fmtBytes(r.bytes)} transferidos em ${plural(r.count, 'requisição', 'requisições')}${r.unknown ? ` (${r.unknown} sem tamanho informado — o peso real pode ser maior)` : ''}. Maiores: ${top}.`, 'Reduzir imagens (WebP/AVIF, dimensões corretas), JS/CSS não usados e fontes pesadas.');
  },
});

P.push({
  id: 'P6', dim: 'P', name: 'Otimização de imagens', impact: 3, dependency: 2,
  run({ page }) {
    const imgs = page.images;
    if (!imgs.length) return NA('A página não tem imagens de conteúdo.');
    const cdn = /(cdn\.shopify\.com|cloudinary\.com|imgix\.net|ctfassets\.net|\.wp\.com|cdn\.sanity\.io|vtexassets\.com|cloudfront\.net|akamaized\.net)/i;
    const issues = [];
    let s = 5;
    const noDims = imgs.filter((i) => !i.hasDims).length;
    if (noDims / imgs.length > 0.5 && imgs.length >= 3) { s--; issues.push(`${noDims} imagens sem width/height (risco de CLS)`); }
    const nonLazy = imgs.filter((i) => i.belowFold && i.loading !== 'lazy').length;
    if (nonLazy >= 5) { s--; issues.push(`${nonLazy} imagens abaixo da dobra sem lazy-load`); }
    const legacyCandidates = imgs.filter((i) => !cdn.test(i.src) && !i.modernSource && /\.(jpe?g|png|gif)(\?|$)/i.test(i.src));
    const withExt = imgs.filter((i) => /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(i.src) && !cdn.test(i.src));
    if (withExt.length >= 3 && legacyCandidates.length / withExt.length > 0.7) { s--; issues.push(`${legacyCandidates.length} imagens em JPG/PNG (sem WebP/AVIF)`); }
    const oversized = imgs.filter((i) => i.displayedWidth > 0 && i.naturalWidth > 800 && i.naturalWidth > i.displayedWidth * 2).length;
    if (oversized >= 3) { s--; issues.push(`${oversized} imagens com mais que o dobro da largura exibida`); }
    return ok(s, `${plural(imgs.length, 'imagem analisada', 'imagens analisadas')}${issues.length ? '. Problemas: ' + issues.join('; ') : ': sem problemas relevantes'}.`, 'Definir width/height, aplicar loading="lazy" abaixo da dobra, servir WebP/AVIF e entregar imagens no tamanho exibido.');
  },
});

P.push({
  id: 'P7', dim: 'P', name: 'Scripts, CSS bloqueante e terceiros', impact: 3, dependency: 2,
  run(ctx) {
    const { page, url } = ctx;
    const hosts = Object.keys(page.perf.resources.hosts).filter((h) => isThirdParty(url.hostname, h));
    const blocking = page.scripts.filter((s) => !s.inline && s.inHead && !s.async && !s.defer && !s.module).length;
    const extScripts = page.scripts.filter((s) => !s.inline).length;
    // Loja virtual convive com GTM, pixels, avaliações, chat e pagamento: a régua é mais larga.
    const n = hosts.length;
    let s = isStore(ctx) ? (n <= 8 ? 5 : n <= 15 ? 4 : n <= 25 ? 3 : n <= 40 ? 2 : 1) : (n <= 3 ? 5 : n <= 7 ? 4 : n <= 12 ? 3 : n <= 20 ? 2 : 1);
    if (blocking >= 3) s--;
    const top = Object.entries(page.perf.resources.hosts).filter(([h]) => isThirdParty(url.hostname, h)).sort((a, b) => b[1].count - a[1].count).slice(0, 4).map(([h]) => h).join(', ');
    return ok(s, `${hosts.length} domínios de terceiros${top ? ` (ex.: ${top})` : ''}; ${extScripts} scripts externos, ${blocking} bloqueantes no <head>; ${page.blockingCss} CSS no <head>.`, 'Remover scripts de terceiros que não geram valor, carregar o restante com async/defer (ou via gerenciador de tags após interação) e reduzir CSS bloqueante.');
  },
});

export function rawStats(html, DP) {
  const doc = new DP().parseFromString(html, 'text/html');
  const countWords = (s) => (String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const body = doc.body;
  body?.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  // junta os nós de texto com espaço (HTML minificado não cola palavras de elementos vizinhos)
  const textOf = (d, root) => {
    if (!root) return '';
    const walker = d.createTreeWalker(root, 4);
    const out = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.nodeValue);
    return out.join(' ');
  };
  const canon = doc.querySelector('link[rel~="canonical" i]');
  return {
    title: !!(doc.querySelector('head > title')?.textContent || '').trim(),
    h1: doc.querySelectorAll('h1').length,
    canonical: !!(canon && canon.getAttribute('href')),
    metaDescription: !!doc.querySelector('meta[name="description" i][content]:not([content=""])'),
    jsonld: doc.querySelectorAll('script[type="application/ld+json" i]').length,
    words: countWords(textOf(doc, body)),
    links: doc.querySelectorAll('a[href]').length,
  };
}

P.push({
  id: 'P8', dim: 'P', name: 'Renderização (HTML bruto × página renderizada)', impact: 4, dependency: 4,
  run({ page, net, DOMParser: DP }) {
    const pf = net.pageFetch;
    if (!pf || pf.error || !pf.text) return NA('HTML bruto indisponível para comparação.');
    if (pf.status >= 400) return NA(`O HTML bruto veio com HTTP ${pf.status}; comparação não confiável.`);
    if (!DP) return NA('Parser de HTML indisponível.');
    const raw = rawStats(pf.text, DP);
    const rendered = {
      title: !!page.title, h1: page.headings.filter((h) => h.level === 1).length, canonical: page.canonicals.some((c) => c.href),
      metaDescription: page.metaDescriptions.some(Boolean), jsonld: page.jsonld.length, words: page.bodyWordCount,
    };
    const ratio = rendered.words ? Math.min(1, raw.words / rendered.words) : 1;
    let s = ratio >= 0.8 ? 5 : ratio >= 0.5 ? 4 : ratio >= 0.25 ? 3 : 2;
    const jsOnly = [];
    if (rendered.title && !raw.title) { s--; jsOnly.push('title'); }
    if (rendered.h1 && !raw.h1) { s--; jsOnly.push('H1'); }
    if (rendered.canonical && !raw.canonical) { s--; jsOnly.push('canonical'); }
    const soft = [];
    if (rendered.metaDescription && !raw.metaDescription) soft.push('meta description');
    if (rendered.jsonld && !raw.jsonld) soft.push('JSON-LD');
    return ok(s, lines(
      `${Math.min(100, pct(raw.words, rendered.words))}% do texto já está no HTML inicial (${raw.words.toLocaleString('pt-BR')} de ${rendered.words.toLocaleString('pt-BR')} palavras).`,
      jsOnly.length ? `Só aparecem após JavaScript: ${jsOnly.join(', ')}.` : '',
      soft.length ? `Injetados via JavaScript: ${soft.join(', ')}.` : '',
    ), 'Entregar conteúdo e tags de SEO no HTML inicial (SSR/SSG ou template do servidor). O Google renderiza JS, mas outros buscadores e rastreadores de IA (ChatGPT, Perplexity, Claude) em geral não.');
  },
});

P.push({
  id: 'P9', dim: 'P', name: 'Compressão e protocolo', impact: 2, dependency: 1,
  run({ page, net }) {
    const nav = page.perf.nav;
    const enc = net.pageFetch?.headers?.['content-encoding'];
    const compressedByTiming = nav && nav.encodedBodySize > 0 && nav.decodedBodySize > nav.encodedBodySize * 1.05;
    const compressed = !!enc || compressedByTiming;
    if (!nav && !net.pageFetch) return NA('Sem dados de rede da página.');
    const proto = nav?.protocol || '';
    const modern = /^h2|h3/.test(proto);
    const big = (nav?.decodedBodySize || (net.pageFetch?.text || '').length) > 10240;
    if (!compressed && big) return ok(2, `HTML sem compressão (gzip/brotli)${proto ? `; protocolo ${proto}` : ''}.`, 'Ativar compressão Brotli/gzip no servidor/CDN.');
    if (!compressed) return ok(modern || !proto ? 5 : 4, `HTML pequeno, sem necessidade de compressão${proto ? `; protocolo ${proto}` : ''}.`, 'Habilitar HTTP/2 ou HTTP/3 no servidor/CDN.');
    if (!modern && proto) return ok(4, `HTML comprimido${enc ? ` (${enc})` : ''}, mas servido em ${proto}.`, 'Habilitar HTTP/2 ou HTTP/3 no servidor/CDN.');
    return ok(5, `HTML comprimido${enc ? ` (${enc})` : ''}${proto ? `; protocolo ${proto}` : ''}.`);
  },
});

// -------------------------------------------- E · Entidades & Semântica

const E = [];

E.push({
  id: 'E1', dim: 'E', name: 'Dados estruturados (presença e validade)', impact: 4, dependency: 3,
  run({ page, nodes, pageType }) {
    const errors = page.jsonld.filter((j) => !j.ok);
    const microdata = page.microdataTypes.length;
    if (!page.jsonld.length && !microdata) {
      return ok(['home', 'product', 'article'].includes(pageType) ? 1 : 2, 'Nenhum dado estruturado (JSON-LD/microdata) no DOM renderizado.', 'Implementar schema.org em JSON-LD adequado ao tipo da página (Organization/WebSite, Product, Article, BreadcrumbList…).');
    }
    const types = [...new Set(nodes.flatMap((n) => n.__types))];
    const shown = `${plural(page.jsonld.length, 'bloco JSON-LD', 'blocos JSON-LD')}${microdata ? ` + ${microdata} microdata` : ''}. Tipos: ${types.slice(0, 8).join(', ') || '—'}.`;
    if (errors.length) return ok(2, lines(shown, `${plural(errors.length, 'bloco com JSON inválido', 'blocos com JSON inválido')}: ${errors[0].error}.`), 'Corrigir o JSON-LD (o Google ignora blocos inválidos) e validar no Teste de Resultados Ricos.');
    return ok(types.length >= 3 ? 5 : 4, shown, 'Ampliar a cobertura de schema (ver E2) e validar no Teste de Resultados Ricos.');
  },
});

E.push({
  id: 'E2', dim: 'E', name: 'Schema adequado ao tipo de página', impact: 3, dependency: 2,
  run({ nodes, pageType }) {
    const any = nodes.length > 0;
    if (pageType === 'home') {
      const org = hasType(nodes, isOrgType), site = hasType(nodes, (t) => t === 'WebSite');
      if (org && site) return ok(5, 'Home com Organization e WebSite.');
      if (!org && !site) return ok(any ? 2 : 1, 'Home sem Organization nem WebSite.', 'Adicionar JSON-LD Organization (nome, logo, sameAs) e WebSite na home.');
      return ok(3, `Home com ${org ? 'Organization' : 'WebSite'}, faltando ${org ? 'WebSite' : 'Organization'}.`, `Adicionar o schema ${org ? 'WebSite' : 'Organization'} à home.`);
    }
    if (pageType === 'article') {
      const art = findNode(nodes, (t) => ARTICLE_TYPES.includes(t));
      if (!art) return ok(any ? 2 : 1, 'Artigo sem schema Article/BlogPosting.', 'Implementar BlogPosting/Article com headline, image, datePublished, dateModified, author e publisher.');
      const missing = ['headline', 'image', 'datePublished', 'dateModified', 'author'].filter((k) => !art[k]);
      if (!art.publisher && !nodes.some((n) => isOrgType(n.__types[0]) && n !== art)) missing.push('publisher');
      return ok(missing.length === 0 ? 5 : missing.length === 1 ? 4 : missing.length === 2 ? 3 : 2, missing.length ? `Article presente; faltam: ${missing.join(', ')}.` : 'Article completo.', 'Completar os campos do Article/BlogPosting.');
    }
    const coll = hasType(nodes, (t) => ['CollectionPage', 'ItemList', 'OfferCatalog', 'BreadcrumbList'].includes(t));
    if (coll) return ok(5, 'Listagem com BreadcrumbList/CollectionPage/ItemList.');
    return ok(any ? 4 : 3, 'Categoria sem BreadcrumbList nem CollectionPage/ItemList.', 'Marcar a categoria com BreadcrumbList (mínimo) e, se possível, CollectionPage + ItemList.');
  },
});

E.push({
  id: 'E3', dim: 'E', name: 'Coerência schema × conteúdo visível (preço)', impact: 4, dependency: 2,
  run({ page, nodes }) {
    const prices = schemaPrices(nodes);
    if (!prices.length) return NA('O schema da página não declara preço.');
    const gated = /(cadastre-se|fa[çc]a login|entre|login).{0,40}(ver|veja|visualizar).{0,25}pre[çc]o|pre[çc]os? (dispon[íi]ve(l|is) )?(ap[óo]s|mediante) (login|cadastro)|log ?in to (see|view) price|sign in (to|for) price/i.test(page.visibleText);
    const hidden = prices.filter((p) => !priceVisible(page.visibleText, p));
    const shown = prices.map((p) => p.toLocaleString('pt-BR', { minimumFractionDigits: 2 })).join(', ');
    if (gated && hidden.length) return ok(1, `O schema expõe preço (R$ ${shown}) mas a página pede cadastro/login para exibir preços.`, 'Conteúdo do schema precisa estar visível ao usuário. Mostrar um preço público ("a partir de") coerente com o schema, ou remover o preço do schema.');
    if (hidden.length) return ok(2, `Preço(s) do schema (R$ ${shown}) não encontrado(s) no texto visível da página.`, 'Alinhar o preço do schema ao preço exibido na página (inclusive variações) — divergência pode gerar perda de rich results.');
    return ok(5, `Preço(s) do schema (R$ ${shown}) conferem com o conteúdo visível.`);
  },
});

E.push({
  id: 'E4', dim: 'E', name: 'Entidade da organização (Organization)', impact: 3, dependency: 2,
  run({ page, nodes, pageType }) {
    if (pageType !== 'home') return NA('Avaliado na home da marca — abra a home e rode a análise.');
    const org = findNode(nodes, isOrgType);
    if (!org) return ok(1, `Nenhum schema Organization/LocalBusiness na home${page.social.length ? `; links sociais visíveis: ${page.social.join(', ')}` : ''}.`, 'Adicionar Organization com name, url, logo e sameAs (perfis oficiais) para consolidar a entidade da marca.');
    const same = asArray(org.sameAs).length;
    const missing = [];
    if (!org.name) missing.push('name');
    if (!org.url) missing.push('url');
    if (!org.logo) missing.push('logo');
    if (same < 2) missing.push(same ? 'sameAs (só 1 perfil)' : 'sameAs');
    return ok(5 - missing.length * (missing.includes('name') ? 1.5 : 1), `Organization (${org.__types.join('/')}) ${missing.length ? 'sem: ' + missing.join(', ') : 'completa'}; sameAs com ${same} perfis${page.social.length ? `; redes visíveis na página: ${page.social.join(', ')}` : ''}.`, 'Completar name, url, logo e sameAs com os perfis oficiais (Instagram, LinkedIn, YouTube, Google Business Profile…).');
  },
});

E.push({
  id: 'E5', dim: 'E', name: 'Páginas institucionais e sinais de confiança', impact: 3, dependency: 2,
  run(ctx) {
    const { page } = ctx;
    const i = page.inst;
    const store = isStore(ctx);
    const found = [['Sobre', i.about], ['Contato', i.contact], ['Privacidade', i.privacy], [store ? 'Termos ou política de troca' : 'Termos', store ? i.terms || i.returns : i.terms], ['CNPJ visível', page.local.cnpj]];
    const have = found.filter((f) => f[1]).map((f) => f[0]);
    const miss = found.filter((f) => !f[1]).map((f) => f[0]);
    const extra = !store && i.returns ? ' · política de troca/garantia linkada' : '';
    const s = have.length >= 5 ? 5 : have.length === 4 ? 4 : have.length === 3 ? 3 : have.length === 2 ? 2 : 1;
    return ok(s, `Encontrados: ${have.join(', ') || 'nenhum'}${extra}.${miss.length ? ' Não encontrados nesta página: ' + miss.join(', ') + '.' : ''}`, 'Linkar (no rodapé/menu) as páginas Sobre, Contato, Privacidade e Termos e exibir dados da empresa (CNPJ, endereço) — sinais de E-E-A-T.');
  },
});

E.push({
  id: 'E6', dim: 'E', name: 'Autoria e datas (E-E-A-T)', impact: 3, dependency: 1,
  run({ page, nodes, pageType }) {
    if (pageType !== 'article') return NA('Aplicável a artigos/blog (tipo atual: ' + PAGE_TYPES[pageType] + ').');
    const art = findNode(nodes, (t) => ARTICLE_TYPES.includes(t));
    const author = page.author || (art && art.author ? 'schema' : null);
    const pub = page.published || art?.datePublished;
    const mod = page.modified || art?.dateModified;
    const s = author && pub && mod ? 5 : author && pub ? 4 : pub && mod ? 3 : author || pub ? 2 : 1;
    return ok(s, `Autor: ${author ? truncate(String(author), 40) : 'não identificado'} · publicação: ${pub ? 'sim' : 'não'} · atualização: ${mod ? 'sim' : 'não'}.`, 'Exibir autor (com bio/credenciais), data de publicação e de atualização, e refletir isso no schema Article (author, datePublished, dateModified).');
  },
});

E.push({
  id: 'E7', dim: 'E', name: 'Estrutura para respostas diretas (SEO + IA)', impact: 3, dependency: 2,
  run({ page, nodes }) {
    const h2 = page.headings.filter((h) => h.level === 2).length;
    const faq = hasType(nodes, (t) => t === 'FAQPage') || page.structure.details >= 3;
    let pts = 0;
    const got = [];
    if (page.questionHeadings >= 2) { pts++; got.push(`${page.questionHeadings} títulos em formato de pergunta`); }
    if (faq) { pts++; got.push('FAQ (schema ou acordeão)'); }
    if (page.structure.lists + page.structure.tables >= 1) { pts++; got.push(`${plural(page.structure.lists, 'lista', 'listas')} e ${plural(page.structure.tables, 'tabela', 'tabelas')}`); }
    if (h2 >= 3) { pts++; got.push(`${h2} seções H2`); }
    return ok(1 + pts, got.length ? `Sinais: ${got.join(' · ')}.` : 'Sem perguntas/respostas diretas, FAQ, listas, tabelas ou seções H2 identificadas.', 'Estruturar o conteúdo para extração: títulos em forma de pergunta com resposta curta logo abaixo, listas/tabelas e FAQ (com FAQPage) — formato preferido por AI Overviews e LLMs.');
  },
});

const AI_CORE = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot'];
const AI_TRAINING = ['Google-Extended', 'CCBot', 'anthropic-ai', 'Applebot-Extended'];

E.push({
  id: 'E8', dim: 'E', name: 'Acesso de rastreadores de IA e llms.txt (AIO)', impact: 3, dependency: 3,
  run({ net }) {
    const r = net.robots;
    if (!r || r.error) return NA('robots.txt indisponível.');
    const parsed = r.parsed;
    const allowed = (bot) => !parsed || isAllowed(parsed, bot.toLowerCase(), '/').allowed;
    const blockedCore = AI_CORE.filter((b) => !allowed(b));
    const blockedTrain = AI_TRAINING.filter((b) => !allowed(b));
    const llms = net.llms?.found;
    const ev = lines(
      blockedCore.length ? `Bloqueados no robots.txt: ${blockedCore.join(', ')}.` : 'Rastreadores de busca/citação de IA liberados (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot).',
      blockedTrain.length ? `Treinamento bloqueado: ${blockedTrain.join(', ')}.` : '',
      `llms.txt: ${llms ? 'presente' : 'não encontrado'}.`,
    );
    const s = blockedCore.length === 0 ? (llms ? 5 : 4) : blockedCore.length <= 2 ? 3 : blockedCore.length <= 4 ? 2 : 1;
    return ok(s, ev, blockedCore.length ? 'Se a meta é aparecer em respostas de IA, liberar os rastreadores de busca/citação (bloquear só os de treinamento é uma decisão de negócio).' : 'Publicar um /llms.txt resumindo as páginas-chave do site para LLMs.');
  },
});

E.push({
  id: 'E9', dim: 'E', name: 'Dados de organização e local (NAP / LocalBusiness)', impact: 3, dependency: 2,
  run({ page, nodes }) {
    const lb = findNode(nodes, isLocalBusinessType);
    const l = page.local;
    const visiblePhone = l.telLinks > 0 || l.phones.length > 0;
    const visibleAddress = l.cep || l.addressTag;
    const map = l.mapEmbeds + l.mapLinks > 0;
    if (!lb && !visibleAddress && !map) return NA('Nenhum sinal de negócio local (endereço, mapa, LocalBusiness) — não aplicável.');
    const addr = lb && (lb.address || nodes.some((n) => n.__types.includes('PostalAddress')));
    const schemaOk = !!(lb && addr && lb.telephone);
    const found = [];
    if (schemaOk) found.push('LocalBusiness com endereço e telefone'); else if (lb) found.push('LocalBusiness incompleto (falta endereço/telefone)');
    if (visiblePhone) found.push('telefone visível');
    if (visibleAddress) found.push('endereço visível');
    if (map) found.push('mapa/link do Google Maps');
    const points = [schemaOk, visiblePhone, visibleAddress, map].filter(Boolean).length;
    let ev = `Sinais: ${found.join(' · ') || 'nenhum'}.`;
    if (lb?.telephone && l.phones.length) {
      const digits = (s) => String(s).replace(/\D/g, '');
      const sd = digits(lb.telephone).slice(-8);
      if (!l.phones.some((p) => digits(p).endsWith(sd))) { ev += ' O telefone do schema não bate com o exibido na página (NAP inconsistente).'; return ok(Math.min(1 + points, 3), ev, 'Padronizar nome, endereço e telefone entre site, schema e Google Business Profile.'); }
    }
    return ok(1 + points, ev, 'Marcar LocalBusiness (endereço, telefone, horário, geo), exibir NAP no rodapé e incorporar o mapa/Google Business Profile.');
  },
});

// ------------------------------------------------ Site · página inexistente

S.push({
  id: 'S9', dim: 'S', name: 'Tratamento de páginas inexistentes (404)', impact: 3, dependency: 3,
  run({ net }) {
    const r = net.soft404;
    if (!r || r.error) return NA('Não foi possível testar uma URL inexistente.');
    if (r.status === 404 || r.status === 410) return ok(5, `Uma URL inexistente devolve HTTP ${r.status}, como deve ser.`);
    if ([401, 403, 429].includes(r.status)) return NA(`O servidor respondeu ${r.status} ao teste (possível proteção anti-bot).`);
    if (r.status >= 500) return ok(2, `Uma URL inexistente devolve HTTP ${r.status} (erro de servidor).`, 'Configurar a página 404 para responder com status 404, não com erro de servidor.');
    if (r.redirected && new URL(r.finalUrl).pathname === '/') return ok(2, 'URLs inexistentes redirecionam para a home (soft 404).', 'Servir uma página 404 de verdade (status 404) em vez de redirecionar para a home; o Google trata o redirecionamento como soft 404.');
    return ok(1, `Uma URL inexistente responde HTTP ${r.status} (soft 404): o Google pode indexar páginas vazias.`, 'Configurar o servidor/tema para devolver status 404 nas URLs que não existem, com uma página 404 útil (links para categorias e busca).');
  },
});

// ------------------------------------------------------ Página de produto

const PR = [];
const only = (types) => ({ types });

PR.push({
  id: 'PR1', dim: 'PR', name: 'Schema Product completo', impact: 4, dependency: 3, ...only(['product']),
  run({ nodes }) {
    const any = nodes.length > 0;
    {
      const prod = findNode(nodes, (t) => PRODUCT_TYPES.includes(t));
      if (!prod) return ok(any ? 2 : 1, 'Página de produto sem schema Product.', 'Implementar Product com name, image, offers (price, priceCurrency, availability), brand e sku.');
      const prices = schemaPrices(nodes);
      const hasOffer = hasType(nodes, (t) => /Offer/.test(t));
      const avail = nodes.some((n) => n.availability);
      const cur = nodes.some((n) => n.priceCurrency);
      const missing = [];
      if (!prod.name) missing.push('name');
      if (!prod.image && !nodes.some((n) => n.__types.includes('ProductGroup') && n.image)) missing.push('image');
      if (!hasOffer) missing.push('offers'); else { if (!prices.length) missing.push('price'); if (!cur) missing.push('priceCurrency'); if (!avail) missing.push('availability'); }
      if (!prod.brand && !nodes.some((n) => n.brand)) missing.push('brand');
      if (!nodes.some((n) => n.sku || n.gtin || n.gtin13 || n.mpn)) missing.push('sku/gtin');
      return ok(missing.length === 0 ? 5 : missing.length === 1 ? 4 : missing.length === 2 ? 3 : 2, missing.length ? `Product presente; faltam: ${missing.join(', ')}.` : 'Product completo (name, image, offers, brand, sku).', 'Completar os campos do Product para elegibilidade a rich results de produto.');
    }
  },
});

PR.push({
  id: 'PR2', dim: 'PR', name: 'Oferta e conversão: preço, botão de compra e disponibilidade', impact: 4, dependency: 3, ...only(['product']),
  run({ page, nodes }) {
    const c = page.conv;
    const price = c.signals.price;
    const buy = c.ctas.some((x) => BUY_CTA.test(x.t));
    const quote = c.ctas.some((x) => QUOTE_CTA.test(x.t));
    const stock = c.signals.stock || nodes.some((n) => n.availability);
    const got = [price && 'preço visível', buy ? 'botão de compra' : quote && 'botão de orçamento/contato', stock && 'disponibilidade'].filter(Boolean);
    const missing = [];
    if (!price) missing.push('preço visível (ou "a partir de")');
    if (!buy && !quote) missing.push('botão de compra/orçamento');
    if (!stock) missing.push('indicação de disponibilidade');
    const pts = [price, buy || quote, stock].filter(Boolean).length;
    return ok(pts === 3 ? 5 : pts === 2 ? 4 : pts === 1 ? 2 : 1,
      `${got.length ? 'Encontrado: ' + got.join(', ') : 'Nada encontrado'}${missing.length ? '. Faltando: ' + missing.join(', ') : ''}.`,
      'A página de produto precisa mostrar preço, um botão de ação claro e a disponibilidade sem exigir login.');
  },
});

PR.push({
  id: 'PR3', dim: 'PR', name: 'Avaliações de clientes', impact: 3, dependency: 1, ...only(['product']),
  run({ page, nodes }) {
    const schemaRev = nodes.some((n) => n.__types.some((t) => t === 'AggregateRating' || t === 'Review'));
    const visible = page.conv.reviewDom || page.conv.reviewText;
    if (schemaRev && visible) return ok(5, 'Avaliações visíveis e marcadas no schema (AggregateRating/Review).');
    if (schemaRev) return ok(3, 'Schema de avaliação sem avaliações visíveis na página.', 'Exibir as avaliações na página: marcação de avaliação que o usuário não vê viola as diretrizes do Google.');
    if (visible) return ok(3, 'Há avaliações visíveis, mas sem AggregateRating/Review no schema.', 'Marcar as avaliações em JSON-LD para exibir estrelas no resultado do Google.');
    return ok(3, 'Nenhuma avaliação de clientes identificada.', 'Se a loja tem avaliações, exibi-las na página (e com schema AggregateRating): prova social e estrelas no Google aumentam o CTR.');
  },
});

PR.push({
  id: 'PR4', dim: 'PR', name: 'Galeria de imagens do produto', impact: 3, dependency: 1, ...only(['product']),
  run({ page }) {
    const { count, noAlt } = page.conv.gallery;
    if (!count) return ok(1, 'Nenhuma imagem grande de produto encontrada.', 'Adicionar fotos do produto (mínimo 3 ângulos/usos) com alt descritivo.');
    let s = count >= 3 ? 5 : count === 2 ? 4 : 3;
    if (noAlt / count > 0.5) s--;
    return ok(s, `${plural(count, 'imagem de produto', 'imagens de produto')}; ${noAlt} sem alt.`, 'Ter ao menos 3 imagens (ângulos, detalhe, uso) e alt com nome/modelo do produto.');
  },
});

PR.push({
  id: 'PR5', dim: 'PR', name: 'Descrição e especificações técnicas', impact: 4, dependency: 2, ...only(['product']),
  run({ page }) {
    const w = page.contentWordCount;
    const spec = page.conv.sections.spec || page.structure.tables > 0;
    const lists = page.structure.lists > 0;
    const pts = (w >= 100) + (w >= 250) + spec + lists;
    return ok(1 + pts, `~${w.toLocaleString('pt-BR')} palavras; ${spec ? 'seção/tabela de especificações presente' : 'sem seção de especificações'}; ${lists ? 'com listas de características' : 'sem listas de características'}.`,
      'Descrever o produto com texto próprio (250+ palavras), listar características e incluir uma ficha técnica (tabela de especificações).');
  },
});

PR.push({
  id: 'PR6', dim: 'PR', name: 'Frete, prazo, troca e garantia', impact: 3, dependency: 1, ...only(['product']),
  run({ page }) {
    const { shipping, warranty } = page.conv.signals;
    const n = shipping + warranty;
    return ok(n === 2 ? 5 : n === 1 ? 3 : 2, `Frete/prazo: ${shipping ? 'informado' : 'não encontrado'} · troca/garantia: ${warranty ? 'informada' : 'não encontrada'}${n < 2 ? ' (texto visível; confira abas ou acordeões fechados)' : ''}.`,
      'Informar na própria página o frete/prazo (ou calculadora) e a política de troca e garantia: reduz objeções e aumenta conversão.');
  },
});

PR.push({
  id: 'PR7', dim: 'PR', name: 'Categoria e produtos relacionados (interlinking)', impact: 3, dependency: 2, ...only(['product']),
  run({ page }) {
    const cat = page.conv.categoryLinks > 0;
    const rel = page.conv.sections.related;
    const n = cat + rel;
    return ok(n === 2 ? 5 : n === 1 ? 3 : 2, `Link para categoria: ${cat ? `sim (${page.conv.categoryLinks})` : 'não'} · bloco de relacionados/recomendados: ${rel ? 'sim' : 'não'}.`,
      'Linkar a categoria-mãe e incluir um bloco de produtos relacionados com links rastreáveis (distribui autoridade e aumenta o ticket).');
  },
});

// ------------------------------------------------------ Página de serviço

const SV = [];

SV.push({
  id: 'SV1', dim: 'SV', name: 'Schema de serviço', impact: 4, dependency: 3, ...only(['service']),
  run({ nodes }) {
    const any = nodes.length > 0;
    const svc = findNode(nodes, (t) => t === 'Service' || t === 'ProfessionalService') || findNode(nodes, isLocalBusinessType);
    if (!svc) return ok(any ? 2 : 1, 'Página de serviço sem schema Service, ProfessionalService ou LocalBusiness.', 'Implementar Service (ou ProfessionalService/LocalBusiness) com name, description, provider, areaServed e serviceType.');
    const isBusiness = svc.__types.some(isLocalBusinessType);
    const missing = [];
    if (!svc.name) missing.push('name');
    if (!svc.description) missing.push('description');
    if (!svc.provider && !isBusiness && !hasType(nodes, isOrgType)) missing.push('provider');
    if (!svc.areaServed && !nodes.some((n) => n.areaServed)) missing.push('areaServed');
    if (!svc.serviceType && !svc.category && !svc.hasOfferCatalog && !svc.offers) missing.push('serviceType');
    return ok(missing.length === 0 ? 5 : missing.length === 1 ? 4 : missing.length === 2 ? 3 : 2, `${svc.__types.join('/')} ${missing.length ? 'sem: ' + missing.join(', ') : 'completo'}.`, 'Completar os campos do schema do serviço.');
  },
});

SV.push({
  id: 'SV2', dim: 'SV', name: 'Chamadas para ação (CTA)', impact: 5, dependency: 3, ...only(['service']),
  run({ page }) {
    const c = page.conv;
    const quote = c.ctas.filter((x) => QUOTE_CTA.test(x.t));
    const atf = quote.some((x) => x.atf);
    const channels = [c.forms.length > 0, c.whatsapp > 0, page.local.telLinks > 0, c.mailto > 0].filter(Boolean).length;
    if (!quote.length && !channels) return ok(1, 'Nenhum CTA de contato/orçamento, formulário, WhatsApp, telefone ou e-mail encontrado.', 'Incluir um CTA claro (ex.: "Solicitar orçamento") logo no topo e repeti-lo ao longo da página.');
    const s = 2 + (atf ? 1 : 0) + (channels >= 2 ? 1 : 0) + (quote.length >= 2 ? 1 : 0);
    return ok(s, `${plural(quote.length, 'CTA de contato', 'CTAs de contato')}${quote.length ? ` (ex.: "${truncate(quote[0].t, 30)}")` : ''}; CTA na primeira dobra: ${atf ? 'sim' : 'não'}; ${plural(channels, 'canal de contato', 'canais de contato')} (formulário/WhatsApp/telefone/e-mail).`,
      'Colocar o CTA principal acima da dobra, repeti-lo após as seções-chave e oferecer ao menos dois canais de contato.');
  },
});

SV.push({
  id: 'SV3', dim: 'SV', name: 'Formulário de contato/orçamento', impact: 4, dependency: 2, ...only(['service']),
  run({ page }) {
    const forms = page.conv.forms;
    const alt = page.conv.whatsapp > 0 || page.local.telLinks > 0;
    if (!forms.length) return ok(alt ? 3 : 2, `Sem formulário na página${alt ? ' (há WhatsApp/telefone como alternativa)' : ''}.`, 'Adicionar um formulário curto de orçamento/contato na própria página.');
    const f = [...forms].sort((a, b) => a.fields - b.fields)[0];
    const reachable = f.email || f.phone;
    const s = !reachable ? 3 : f.fields <= 5 ? 5 : f.fields <= 8 ? 4 : 3;
    return ok(s, `${plural(forms.length, 'formulário', 'formulários')}; o menor tem ${plural(f.fields, 'campo', 'campos')}${reachable ? '' : ' e não pede e-mail nem telefone'}.`, 'Reduzir para até 5 campos (nome, e-mail/telefone, mensagem) e garantir um canal de retorno.');
  },
});

SV.push({
  id: 'SV4', dim: 'SV', name: 'Prova social (depoimentos, cases, avaliações)', impact: 4, dependency: 1, ...only(['service']),
  run({ page, nodes }) {
    const proof = page.conv.sections.proof;
    const rev = nodes.some((n) => n.__types.some((t) => t === 'AggregateRating' || t === 'Review')) || page.conv.reviewDom;
    if (proof && rev) return ok(5, 'Seção de prova social e avaliações encontradas.');
    if (proof || rev) return ok(3, proof ? 'Seção de depoimentos/cases presente, sem avaliações marcadas.' : 'Avaliações presentes, sem seção de depoimentos/cases.', 'Combinar depoimentos com nome/foto, cases com resultado e, se possível, avaliações com schema.');
    return ok(2, 'Nenhum depoimento, case ou avaliação identificado.', 'Adicionar depoimentos, logos de clientes e cases com números: principal gatilho de confiança em serviços.');
  },
});

SV.push({
  id: 'SV5', dim: 'SV', name: 'Estrutura da oferta (escopo, processo, público, benefícios, FAQ)', impact: 4, dependency: 2, ...only(['service']),
  run({ page }) {
    const s = page.conv.sections;
    const found = [['o que está incluso', s.scope], ['como funciona', s.process], ['para quem é', s.audience], ['benefícios', s.benefits], ['perguntas frequentes', s.faq]];
    const have = found.filter((f) => f[1]).map((f) => f[0]);
    const miss = found.filter((f) => !f[1]).map((f) => f[0]);
    return ok(have.length >= 4 ? 5 : have.length === 3 ? 4 : have.length === 2 ? 3 : have.length === 1 ? 2 : 1,
      `Seções encontradas: ${have.join(', ') || 'nenhuma'}.${miss.length ? ' Faltam: ' + miss.join(', ') + '.' : ''}`,
      'Estruturar a página com H2 para: o que está incluso, como funciona (etapas), para quem é, benefícios e perguntas frequentes.');
  },
});

SV.push({
  id: 'SV6', dim: 'SV', name: 'Credenciais e autoridade', impact: 3, dependency: 1, ...only(['service']),
  run({ page }) {
    const c = page.conv.signals.creds;
    const found = [['tempo de experiência', c.years], ['certificações/parcerias', c.cert], ['equipe/especialistas', c.team], ['registro profissional', c.license]];
    const have = found.filter((f) => f[1]).map((f) => f[0]);
    const n = have.length;
    return ok(n >= 3 ? 5 : n === 2 ? 4 : n === 1 ? 3 : 2, `Sinais encontrados: ${have.join(', ') || 'nenhum'}.`, 'Mostrar quem executa o serviço: anos de mercado, certificações, equipe com nome e registro profissional (E-E-A-T).');
  },
});

SV.push({
  id: 'SV7', dim: 'SV', name: 'Transparência de investimento (preço, planos ou orçamento)', impact: 3, dependency: 1, ...only(['service']),
  run({ page }) {
    const { pricingWords, budget } = page.conv.signals;
    if (pricingWords) return ok(5, 'A página informa preço, faixa, planos ou pacotes.');
    if (budget) return ok(4, 'Sem preço, mas o caminho para orçamento está claro.', 'Se possível, indicar uma faixa ("a partir de") ou critérios que definem o valor.');
    return ok(3, 'Nada sobre preço, planos ou como solicitar orçamento.', 'Explicar como o valor é definido e oferecer uma faixa ou pacotes para filtrar leads e reduzir atrito.');
  },
});

SV.push({
  id: 'SV8', dim: 'SV', name: 'Área de atuação / local', impact: 3, dependency: 1, ...only(['service']),
  run({ page, nodes }) {
    const l = page.local;
    const area = nodes.some((n) => n.areaServed);
    const addr = l.cep || l.addressTag;
    const map = l.mapEmbeds + l.mapLinks > 0;
    if (!area && !addr && !map) return NA('Sem sinais de atuação local. Se o serviço é regional, informe cidade/região, endereço e mapa.');
    const found = [area && 'areaServed no schema', addr && 'endereço visível', map && 'mapa/Google Maps', (l.telLinks > 0 || l.phones.length) && 'telefone'].filter(Boolean);
    const n = [area, addr, map].filter(Boolean).length;
    return ok(n === 3 ? 5 : n === 2 ? 4 : 3, `Sinais: ${found.join(', ')}.`, 'Declarar areaServed no schema, exibir endereço/região atendida e incorporar o mapa.');
  },
});

// ---------------------------------------------------------- Montagem

const GROUP_OF = { S: 'tecnico', C: 'conteudo', P: 'performance', E: 'semantica', PR: 'produto', SV: 'servico' };

/** Nível: o que vale para o domínio inteiro (site) × o que vale só para esta URL (página). */
const SITE_LEVEL = new Set(['S5', 'S6', 'S7', 'S9', 'E8']);
const TYPES_OVERRIDE = {
  C7: ['category', 'product', 'article', 'service', 'page'],
  E2: ['home', 'article', 'category'],
  E4: ['home'],
  E6: ['article'],
  E7: ['home', 'article', 'service', 'page'],      // perguntas/FAQ não se aplicam a produto nem a vitrine de categoria
  E9: ['home', 'article', 'service', 'page'],      // NAP/LocalBusiness não se aplica a produto/categoria de loja
};
/** Condições extras: se retornar false, o item nem aparece. */
const WHEN = {
  E7: (ctx) => !(ctx.pageType === 'home' && isStore(ctx)),   // home de loja não precisa de FAQ/pergunta-resposta
};
const GROUP_OVERRIDE = { E3: (ctx) => (ctx.pageType === 'product' ? 'produto' : 'semantica') };

export const CHECKS = [...S, ...C, ...P, ...E, ...PR, ...SV].map((c) => ({
  level: SITE_LEVEL.has(c.id) ? 'site' : 'page',
  types: TYPES_OVERRIDE[c.id] || c.types || null,
  ...c,
}));

export function runChecks(ctx) {
  const out = [];
  for (const c of CHECKS) {
    if (c.types && !c.types.includes(ctx.pageType)) continue; // item não se aplica a este tipo de página
    if (WHEN[c.id] && !WHEN[c.id](ctx)) continue;
    const group = (GROUP_OVERRIDE[c.id] ? GROUP_OVERRIDE[c.id](ctx) : GROUP_OF[c.dim]);
    const base = { id: c.id, level: c.level, group, name: c.name, impact: c.impact, dependency: c.dependency };
    try {
      out.push({ ...base, ...c.run(ctx) });
    } catch (e) {
      out.push({ ...base, na: true, reason: `Erro interno na checagem: ${e.message}` });
    }
  }
  return out;
}
