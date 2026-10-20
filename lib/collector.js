// Coletor injetado na página (chrome.scripting.executeScript, world MAIN).
// ATENÇÃO: a função é serializada e executada na aba — precisa ser 100% autocontida
// (nada de imports nem de variáveis do módulo aqui dentro).

export async function collectPage() {
  const d = document;
  const loc = location;
  const MAX = 300;

  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const attr = (el, n) => (el.getAttribute ? el.getAttribute(n) : null);
  const countWords = (s) => (String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const visibleText = (el) => (el ? (el.innerText ?? el.textContent ?? '') : '');
  const stripWww = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
  const pageHost = stripWww(loc.hostname);
  const safeUrl = (u) => { try { return new URL(u, loc.href); } catch { return null; } };

  // ---------- Metadados básicos ----------
  const titles = [...d.querySelectorAll('head > title')];
  const metas = (sel) => [...d.querySelectorAll(sel)].map((m) => clean(attr(m, 'content')));
  const metaDescriptions = metas('meta[name="description" i]');
  const robotsMeta = [...d.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i], meta[name="bingbot" i]')]
    .map((m) => ({ name: (attr(m, 'name') || '').toLowerCase(), content: clean(attr(m, 'content')).toLowerCase() }));
  const canonicals = [...d.querySelectorAll('link[rel~="canonical" i]')]
    .map((l) => ({ raw: attr(l, 'href') || '', href: l.href || '' }));
  const hreflangs = [...d.querySelectorAll('link[rel="alternate" i][hreflang]')]
    .map((l) => ({ lang: (attr(l, 'hreflang') || '').toLowerCase(), href: l.href || '' }));
  const og = {};
  d.querySelectorAll('meta[property^="og:" i]').forEach((m) => { og[(attr(m, 'property') || '').toLowerCase()] = clean(attr(m, 'content')); });
  const twitter = {};
  d.querySelectorAll('meta[name^="twitter:" i]').forEach((m) => { twitter[(attr(m, 'name') || '').toLowerCase()] = clean(attr(m, 'content')); });

  // ---------- Headings ----------
  const headings = [...d.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 400).map((h) => ({
    level: Number(h.tagName[1]),
    text: clean(h.textContent).slice(0, 200),
  }));
  const questionRe = /\?\s*$|^(como|o que|qual|quais|quando|onde|por ?que|quem|quanto|quantos|quantas|posso|devo|what|how|why|when|where|who|which|can|should|does)\b/i;
  const questionHeadings = headings.filter((h) => h.level >= 2 && h.level <= 4 && questionRe.test(h.text)).length;

  // ---------- Texto ----------
  const bodyText = visibleText(d.body);
  let contentText = '';
  const mainEl = d.querySelector('main, [role="main"], article');
  if (mainEl) {
    contentText = visibleText(mainEl);
  } else if (d.body) {
    const clone = d.body.cloneNode(true);
    clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach((n) => n.remove());
    contentText = clone.textContent || '';
  }

  // ---------- Imagens ----------
  const vh = window.innerHeight || 800;
  const images = [];
  let imagesTotal = 0;
  for (const img of d.images) {
    const w = Number(attr(img, 'width')) || img.naturalWidth || 0;
    const h = Number(attr(img, 'height')) || img.naturalHeight || 0;
    if ((w && w <= 2) || (h && h <= 2)) continue; // pixel de rastreio
    imagesTotal++;
    if (images.length >= MAX) continue;
    const altRaw = attr(img, 'alt');
    const src = img.currentSrc || img.src || '';
    const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { top: 0, width: 0 };
    const pic = img.closest ? img.closest('picture') : null;
    images.push({
      src: src.slice(0, 300),
      alt: altRaw === null ? 'missing' : altRaw.trim() === '' ? 'empty' : 'ok',
      hasDims: img.hasAttribute('width') && img.hasAttribute('height'),
      loading: (attr(img, 'loading') || '').toLowerCase(),
      belowFold: rect.top + (window.scrollY || 0) > vh,
      displayedWidth: Math.round(rect.width || 0),
      naturalWidth: img.naturalWidth || 0,
      modernSource: !!(pic && pic.querySelector('source[type="image/webp"], source[type="image/avif"]')),
    });
  }

  // ---------- Links ----------
  const anchors = [...d.querySelectorAll('a[href]')];
  const genericRe = /^(clique aqui|clique|aqui|saiba mais|leia mais|veja mais|ver mais|mais|saiba|continue lendo|acesse|ver|link|read more|click here|here|more|learn more)$/i;
  const internal = new Map();
  const externalSet = new Set();
  let internalAnchors = 0, genericAnchors = 0, emptyAnchors = 0, nofollowInternal = 0, httpInternal = 0, jsHref = 0, hashOnly = 0;
  const social = new Set();
  const socialHosts = { 'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'linkedin.com': 'LinkedIn', 'youtube.com': 'YouTube', 'x.com': 'X', 'twitter.com': 'X', 'tiktok.com': 'TikTok', 'pinterest.com': 'Pinterest', 'threads.net': 'Threads' };
  const inst = { about: false, contact: false, privacy: false, terms: false, returns: false };
  const instRe = {
    about: [/(sobre( n[óo]s)?|quem somos|nossa hist[óo]ria|about( us)?)/i, /\/(sobre|quem-somos|about|institucional)/i],
    contact: [/(contato|fale conosco|fale com|contact|atendimento)/i, /\/(contato|contact|fale-conosco|atendimento)/i],
    privacy: [/(privacidade|privacy|lgpd|prote[çc][ãa]o de dados)/i, /(privacidade|privacy|lgpd)/i],
    terms: [/(termos|terms|condi[çc][õo]es)/i, /(termos|terms|condicoes)/i],
    returns: [/(troca|devolu[çc][ãa]o|reembolso|returns?|refund|garantia)/i, /(troca|devolucao|reembolso|returns?|refund|garantia)/i],
  };
  for (const a of anchors) {
    const raw = (attr(a, 'href') || '').trim();
    const text = clean(a.textContent) || clean(attr(a, 'aria-label')) || clean(attr(a, 'title')) || clean(a.querySelector('img[alt]')?.getAttribute('alt'));
    if (/^javascript:/i.test(raw)) { jsHref++; continue; }
    if (/^(mailto:|tel:|sms:|whatsapp:)/i.test(raw)) continue;
    if (raw === '' || raw === '#') { hashOnly++; continue; }
    const u = safeUrl(raw);
    if (!u || !/^https?:$/.test(u.protocol)) continue;
    for (const k of Object.keys(instRe)) {
      if (instRe[k][0].test(text) || instRe[k][1].test(u.pathname)) inst[k] = true;
    }
    const h = stripWww(u.hostname);
    for (const [dom, name] of Object.entries(socialHosts)) if (h === dom || h.endsWith('.' + dom)) social.add(name);
    const isInternal = h === pageHost;
    if (isInternal) {
      if (u.hash && u.pathname === loc.pathname && u.search === loc.search) continue; // âncora da própria página
      internalAnchors++;
      const rel = (attr(a, 'rel') || '').toLowerCase();
      if (/nofollow/.test(rel)) nofollowInternal++;
      if (loc.protocol === 'https:' && u.protocol === 'http:') httpInternal++;
      if (!text) emptyAnchors++;
      else if (genericRe.test(text)) genericAnchors++;
      u.hash = '';
      const key = u.href;
      if (!internal.has(key)) {
        internal.set(key, { href: key, text: text.slice(0, 80), inNav: !!(a.closest && a.closest('nav, header, footer')) });
      }
    } else {
      externalSet.add(u.origin + u.pathname);
    }
  }

  // ---------- Dados estruturados ----------
  const jsonld = [...d.querySelectorAll('script[type="application/ld+json" i]')].slice(0, 40).map((s) => {
    const txt = s.textContent || '';
    try { return { ok: true, data: JSON.parse(txt), bytes: txt.length }; }
    catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120), bytes: txt.length }; }
  }).filter((j) => j.bytes <= 400000);
  const microdataTypes = [...d.querySelectorAll('[itemscope][itemtype]')].map((e) => attr(e, 'itemtype')).slice(0, 40);
  const rdfaCount = d.querySelectorAll('[typeof]').length;

  // ---------- Sinais de E-E-A-T / autoria ----------
  const authorEl = d.querySelector('a[rel~="author"], [itemprop="author"], meta[name="author" i]');
  let author = null;
  if (authorEl) author = clean(attr(authorEl, 'content') || authorEl.textContent).slice(0, 80) || 'presente';
  if (!author) {
    const by = [...d.querySelectorAll('[class*="author" i], [class*="autor" i], [class*="byline" i], [id*="author" i]')]
      .find((e) => { const t = clean(e.textContent); return t && t.length <= 80; });
    if (by) author = clean(by.textContent);
  }
  const published = attr(d.querySelector('meta[property="article:published_time"]') || {}, 'content')
    || attr(d.querySelector('[itemprop="datePublished"]') || {}, 'content')
    || attr(d.querySelector('[itemprop="datePublished"]') || {}, 'datetime')
    || attr(d.querySelector('time[datetime]') || {}, 'datetime') || null;
  const modified = attr(d.querySelector('meta[property="article:modified_time"]') || {}, 'content')
    || attr(d.querySelector('[itemprop="dateModified"]') || {}, 'content')
    || attr(d.querySelector('[itemprop="dateModified"]') || {}, 'datetime') || null;

  // ---------- Local / NAP ----------
  const phoneRe = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g;
  const phones = [...new Set((bodyText.match(phoneRe) || []).map((p) => p.trim()))].slice(0, 5);
  const local = {
    telLinks: d.querySelectorAll('a[href^="tel:" i]').length,
    phones,
    cep: /\b\d{5}-?\d{3}\b/.test(bodyText) && /(cep|rua|av\.|avenida|alameda|rodovia|estrada|pra[çc]a)/i.test(bodyText),
    addressTag: !!d.querySelector('address, [itemprop="address"], [itemtype*="PostalAddress"]'),
    mapEmbeds: d.querySelectorAll('iframe[src*="google.com/maps" i], iframe[src*="maps.google" i]').length,
    mapLinks: d.querySelectorAll('a[href*="google.com/maps" i], a[href*="maps.app.goo.gl" i], a[href*="g.page" i], a[href*="goo.gl/maps" i]').length,
    cnpj: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(bodyText),
  };

  // ---------- Estrutura para respostas diretas ----------
  const lists = [...d.querySelectorAll('ul, ol')].filter((l) => !(l.closest && l.closest('nav, header, footer')) && l.querySelectorAll(':scope > li').length >= 3).length;

  // ---------- Conteúdo misto ----------
  let mixed = { active: 0, passive: 0, samples: [] };
  if (loc.protocol === 'https:') {
    const act = [...d.querySelectorAll('script[src^="http:" i], iframe[src^="http:" i], link[rel="stylesheet" i][href^="http:" i], object[data^="http:" i], embed[src^="http:" i]')];
    const pas = [...d.querySelectorAll('img[src^="http:" i], video[src^="http:" i], audio[src^="http:" i], source[src^="http:" i]')];
    mixed = {
      active: act.length,
      passive: pas.length,
      samples: [...act, ...pas].slice(0, 3).map((e) => (attr(e, 'src') || attr(e, 'href') || attr(e, 'data') || '').slice(0, 120)),
    };
  }

  // ---------- Plataforma ----------
  const srcBlob = [...d.querySelectorAll('script[src], link[href], img[src]')].slice(0, 400)
    .map((e) => attr(e, 'src') || attr(e, 'href') || '').join(' ');
  const generator = clean(attr(d.querySelector('meta[name="generator" i]') || {}, 'content'));
  const platforms = [];
  const add = (cond, name) => { if (cond && !platforms.includes(name)) platforms.push(name); };
  add(window.Shopify || /cdn\.shopify\.com/.test(srcBlob), 'Shopify');
  add(/wordpress/i.test(generator) || /\/wp-(content|includes)\//.test(srcBlob), 'WordPress');
  add(/woocommerce/i.test(d.body?.className || '') || /woocommerce/i.test(srcBlob), 'WooCommerce');
  add(/wix/i.test(generator) || /static\.parastorage\.com|wixstatic\.com/.test(srcBlob), 'Wix');
  add(window.vtex || /vtexassets|vteximg|vtex\.com/.test(srcBlob), 'VTEX');
  add(/nuvemshop|tiendanube|d26lpennugtm8s/.test(srcBlob), 'Nuvemshop');
  add(/magento/i.test(generator) || /\/static\/(version\d+\/)?frontend\//.test(srcBlob), 'Magento');
  add(d.documentElement.hasAttribute('data-wf-site'), 'Webflow');
  add(!!d.getElementById('__NEXT_DATA__') || /\/_next\//.test(srcBlob), 'Next.js');
  add(!!window.__NUXT__ || /\/_nuxt\//.test(srcBlob), 'Nuxt');
  add(!!d.getElementById('___gatsby'), 'Gatsby');
  add(/squarespace/.test(srcBlob), 'Squarespace');
  add(/lojaintegrada/.test(srcBlob), 'Loja Integrada');
  add(/framer\.com|framerusercontent/.test(srcBlob), 'Framer');
  if (generator && !platforms.length) platforms.push(generator.slice(0, 30));

  // ---------- Scripts, CSS e recursos ----------
  const scripts = [...d.scripts].slice(0, 300).map((s) => {
    const u = s.src ? safeUrl(s.src) : null;
    return {
      host: u ? u.hostname : '',
      inline: !s.src,
      async: s.async || s.hasAttribute('async'),
      defer: s.defer || s.hasAttribute('defer'),
      module: (s.type || '').toLowerCase() === 'module',
      inHead: !!(s.closest && s.closest('head')),
    };
  });
  const blockingCss = [...d.querySelectorAll('head link[rel~="stylesheet" i]')]
    .filter((l) => !/print/i.test(attr(l, 'media') || '') && !l.disabled).length;

  const perf = { nav: null, resources: { count: 0, bytes: 0, unknown: 0, hosts: {}, byType: {} }, lcp: null, cls: null };
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
      perf.nav = {
        ttfb: nav.responseStart - nav.requestStart,
        responseStart: nav.responseStart,
        domContentLoaded: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd,
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        decodedBodySize: nav.decodedBodySize,
        protocol: nav.nextHopProtocol,
        navType: nav.type,
      };
    }
    for (const r of performance.getEntriesByType('resource')) {
      const size = r.transferSize || r.encodedBodySize || 0;
      perf.resources.count++;
      perf.resources.bytes += size;
      if (!size) perf.resources.unknown++;
      const u = safeUrl(r.name);
      if (u) {
        const h = perf.resources.hosts[u.hostname] || (perf.resources.hosts[u.hostname] = { count: 0, bytes: 0 });
        h.count++; h.bytes += size;
      }
      const t = r.initiatorType || 'other';
      perf.resources.byType[t] = (perf.resources.byType[t] || 0) + size;
    }
    perf.resources.bytes += (perf.nav && (perf.nav.transferSize || perf.nav.encodedBodySize)) || 0;
  } catch { /* API indisponível */ }

  try {
    const observe = (type) => new Promise((resolve) => {
      const out = [];
      try {
        const po = new PerformanceObserver((l) => out.push(...l.getEntries()));
        po.observe({ type, buffered: true });
        setTimeout(() => { po.disconnect(); resolve(out); }, 200);
      } catch { resolve(null); }
    });
    const [lcpEntries, clsEntries] = await Promise.all([observe('largest-contentful-paint'), observe('layout-shift')]);
    const last = lcpEntries && lcpEntries[lcpEntries.length - 1];
    if (last) {
      perf.lcp = {
        time: last.startTime,
        tag: last.element ? last.element.tagName : null,
        url: last.url || null,
        lazy: !!(last.element && attr(last.element, 'loading') === 'lazy'),
      };
    }
    if (clsEntries) {
      let value = 0, session = 0, sessionEntries = [];
      for (const e of clsEntries) {
        if (e.hadRecentInput) continue;
        const first = sessionEntries[0], prev = sessionEntries[sessionEntries.length - 1];
        if (sessionEntries.length && e.startTime - prev.startTime < 1000 && e.startTime - first.startTime < 5000) {
          session += e.value; sessionEntries.push(e);
        } else { session = e.value; sessionEntries = [e]; }
        value = Math.max(value, session);
      }
      perf.cls = value;
    }
  } catch { /* sem observer */ }

  const de = d.documentElement;
  return {
    url: loc.href,
    origin: loc.origin,
    protocol: loc.protocol,
    host: loc.hostname,
    path: loc.pathname + loc.search,
    title: clean(d.title),
    titleCount: titles.length,
    lang: (de.getAttribute('lang') || '').trim(),
    metaDescriptions,
    robotsMeta,
    canonicals,
    hreflangs,
    viewport: clean(attr(d.querySelector('meta[name="viewport" i]') || {}, 'content')) || null,
    og,
    twitter,
    headings,
    questionHeadings,
    bodyWordCount: countWords(bodyText),
    contentWordCount: countWords(contentText),
    visibleText: bodyText.slice(0, 250000),
    imagesTotal,
    images,
    links: {
      internal: [...internal.values()].slice(0, 500),
      internalUnique: internal.size,
      internalAnchors,
      externalUnique: externalSet.size,
      genericAnchors,
      emptyAnchors,
      nofollowInternal,
      httpInternal,
      jsHref,
      hashOnly,
    },
    social: [...social],
    inst,
    jsonld,
    microdataTypes,
    rdfaCount,
    author,
    published,
    modified,
    local,
    structure: {
      lists,
      tables: d.querySelectorAll('table').length,
      details: d.querySelectorAll('details').length,
      hasMain: !!mainEl,
      hasArticleTag: !!d.querySelector('article'),
    },
    breadcrumbDom: !!d.querySelector('[aria-label*="breadcrumb" i], nav.breadcrumb, .breadcrumb, .breadcrumbs, [class*="breadcrumb" i], [itemtype*="BreadcrumbList"]'),
    mixed,
    platforms,
    scripts,
    blockingCss,
    perf,
    layout: { overflowX: de.scrollWidth > de.clientWidth + 1, innerWidth: window.innerWidth || 0 },
    collectedAt: new Date().toISOString(),
  };
}
