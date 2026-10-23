/**
 * Lê a página aberta. Roda dentro da aba (world MAIN) via chrome.scripting.executeScript,
 * por isso precisa ser autocontida: nada aqui pode referenciar outros módulos.
 * Devolve só dados simples (JSON); a interpretação fica em checks.js.
 */
export async function collectPage() {
  const d = document;
  const q = (s) => d.querySelector(s);
  const qa = (s) => [...d.querySelectorAll(s)];
  const metaContent = (n) => q(`meta[name="${n}" i]`)?.getAttribute('content') ?? null;

  // ---------- Velocidade
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  const lcpEntry = await new Promise((resolve) => {
    let last = null;
    try {
      const po = new PerformanceObserver((list) => { const e = list.getEntries(); last = e[e.length - 1]; });
      po.observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => { po.disconnect(); resolve(last); }, 300);
    } catch { resolve(null); }
  });
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const speed = {
    lcpMs: lcpEntry ? Math.round(lcpEntry.startTime) : null,
    fcpMs: fcp ? Math.round(fcp.startTime) : null,
    loadMs: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null,
    ttfbMs: nav && nav.responseStart > 0 ? Math.round(nav.responseStart) : null,
    requests: resources.length + 1,
  };

  // ---------- Estrutura
  const robotsMeta = `${metaContent('robots') || ''} ${metaContent('googlebot') || ''}`.toLowerCase();
  const imgs = qa('img').filter((i) => (i.naturalWidth || i.width || 0) > 2 && (i.naturalHeight || i.height || 0) > 2);
  let schemaCount = 0;
  for (const s of qa('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.textContent); schemaCount += Array.isArray(j) ? j.length : (j['@graph'] ? j['@graph'].length : 1); } catch { /* json inválido */ }
  }
  const structure = {
    https: location.protocol === 'https:',
    title: d.title || '',
    description: metaContent('description') || '',
    h1Count: qa('h1').length,
    h1Text: (q('h1')?.textContent || '').trim().slice(0, 120),
    imgTotal: imgs.length,
    imgWithAlt: imgs.filter((i) => (i.getAttribute('alt') || '').trim()).length,
    viewport: /width\s*=\s*device-width/i.test(metaContent('viewport') || ''),
    noindex: /noindex/.test(robotsMeta),
    schemaCount,
  };

  // ---------- Rastreamento
  const scripts = [...d.scripts];
  const srcs = scripts.map((s) => s.src).filter(Boolean);
  const inline = scripts.filter((s) => !s.src).map((s) => s.textContent || '').join('\n').slice(0, 500000);
  const seen = `${srcs.join('\n')}\n${resources.map((r) => r.name).join('\n')}`;
  const uniq = (a) => [...new Set(a)];
  const all = (re, text) => uniq([...text.matchAll(re)].map((m) => m[1] || m[0]));
  const gtmKeys = Object.keys(window.google_tag_manager || {});
  const gtmIds = uniq([
    ...gtmKeys.filter((k) => /^GTM-/.test(k)),
    ...all(/googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/g, seen),
    ...all(/['"](GTM-[A-Z0-9]{4,})['"]/g, inline),
  ]);
  const ga4Ids = uniq([
    ...gtmKeys.filter((k) => /^G-[A-Z0-9]+$/.test(k)),
    ...all(/googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/g, seen),
    ...all(/['"](G-[A-Z0-9]{6,})['"]/g, inline),
  ]);
  const adsIds = uniq([
    ...gtmKeys.filter((k) => /^AW-\d+$/.test(k)),
    ...all(/googletagmanager\.com\/gtag\/js\?id=(AW-\d+)/g, seen),
    ...all(/['"](AW-\d{6,})(?:\/[\w-]+)?['"]/g, inline),
  ]);
  const adsRequest = /googleadservices\.com\/pagead\/(conversion|viewthrough)|googleads\.g\.doubleclick\.net\/pagead\/viewthroughconversion/.test(seen);
  const metaPixel = typeof window.fbq === 'function' || /connect\.facebook\.net\/[^\n]*fbevents\.js/.test(seen) || /facebook\.com\/tr[/?]/.test(seen);
  const tracking = {
    gtmIds, ga4Ids, adsIds, adsRequest, metaPixel,
    universalAnalytics: /google-analytics\.com\/analytics\.js|\/ga\.js|['"]UA-\d{4,}-\d+['"]/.test(`${seen}\n${inline}`),
    others: [
      ['TikTok Pixel', /analytics\.tiktok\.com/],
      ['LinkedIn Insight', /snap\.licdn\.com|px\.ads\.linkedin\.com/],
      ['Hotjar', /static\.hotjar\.com|hotjar\.io/],
      ['Microsoft Clarity', /clarity\.ms/],
      ['RD Station', /rdstation\.com|d335luupugsy2\.cloudfront\.net/],
      ['HubSpot', /js\.hs-scripts\.com|hs-analytics\.net|hsforms\.net/],
    ].filter(([, re]) => re.test(seen)).map(([n]) => n),
  };

  // ---------- Conversão
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };
  const CTA_RE = /(fale|falar|entre em contato|contato|solicit|or[çc]amento|agende|agendar|compr|quero|saiba mais|conhe[çc](a|er)|come[çc]|teste|gr[aá]tis|baixar|download|whatsapp|cadastr|assine|contrat|simul|diagn[óo]stico|reserv|pedir|pe[çc]a|descubr|confira|explor|aproveit|ver (mais|planos|produtos|ofertas|cole[çc][aã]o|loja|cardápio)|shop|buy)/i;
  const filled = (el) => { const cs = getComputedStyle(el); const bg = cs.backgroundColor; const r = el.getBoundingClientRect(); return !!bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg) && r.width >= 70 && r.height >= 28; };
  const buttonLike = (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /submit|button/.test(el.type)) || /(^|[\s_-])(btn|button|cta|botao|bot[ãa]o)([\s_-]|$)/i.test(el.className?.toString?.() || '') || (el.tagName === 'A' && filled(el));
  const ctaEl = qa('a, button, input[type=submit], [role=button]').find((el) => {
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    if (!text || text.length > 60 || !CTA_RE.test(text) || !buttonLike(el) || !visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
  const hrefs = qa('a[href]').map((a) => a.getAttribute('href') || '');
  // HTML renderizado inteiro, incluindo o conteúdo de shadow DOM aberto: widgets de WhatsApp costumam viver ali ou em onclick/scripts.
  const shadowHtml = [];
  const walk = (root) => { for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { shadowHtml.push(el.shadowRoot.innerHTML); walk(el.shadowRoot); } };
  try { walk(d); } catch { /* ignora */ }
  const fullHtml = `${d.documentElement.outerHTML.slice(0, 3000000)}\n${shadowHtml.join('\n').slice(0, 500000)}`;
  const WA_RE = /(wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\/|wa\.link\/|chat\.whatsapp\.com|joinchat|whatsapp-?(button|widget|float))/i;
  const formFrames = qa('iframe').filter((f) => /typeform|hsforms|hubspot|rdstation|jotform|forms\.gle|docs\.google\.com\/forms|formulario|calendly/i.test(f.src));
  const realForms = qa('form').filter((f) => {
    if (f.getAttribute('role') === 'search') return false;
    const fields = [...f.querySelectorAll('input, textarea, select')].filter((i) => !/hidden|submit|button|search|checkbox|radio/.test(i.type || '') && visible(i));
    return fields.some((i) => /email|tel/.test(i.type)) || f.querySelector('textarea') || fields.length >= 2;
  });
  const bodyText = (d.body?.innerText || '').slice(0, 200000);
  const schemaTypes = [];
  const collectTypes = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(collectTypes); const t = n['@type']; (Array.isArray(t) ? t : [t]).filter(Boolean).forEach((x) => schemaTypes.push(String(x))); if (n['@graph']) collectTypes(n['@graph']); if (n.mainEntity) collectTypes(n.mainEntity); if (n.itemListElement) collectTypes(n.itemListElement); if (n.item) collectTypes(n.item); };
  for (const sc of qa('script[type="application/ld+json"]')) { try { collectTypes(JSON.parse(sc.textContent)); } catch { /* json inválido */ } }
  const platformOf = () => {
    if (window.Shopify || /cdn\.shopify\.com/.test(seen)) return 'Shopify';
    if (window.LS || /nuvemshop|tiendanube|mitiendanube/i.test(seen)) return 'Nuvemshop';
    if (window.vtex || /vtexassets|vteximg|vtex\.com\.br/i.test(seen)) return 'VTEX';
    if (d.body?.classList.contains('woocommerce') || /wc-ajax|woocommerce/i.test(seen)) return 'WooCommerce';
    if (/lojaintegrada|awsli\.com\.br/i.test(seen)) return 'Loja Integrada';
    if (/tray\.com\.br|traycdn|tcdn\.com\.br/i.test(seen)) return 'Tray';
    if (/yampi\.(io|com)/i.test(seen)) return 'Yampi';
    if (/mage\/|Magento/i.test(`${seen}${d.documentElement.className}`)) return 'Magento';
    if (/wixstores|wix-ecommerce/i.test(seen)) return 'Wix Stores';
    return '';
  };
  const bodyAll = (d.body?.innerText || '');
  const cartRe = /\/(cart|carrinho|checkout|sacola|basket)(\/|$|\?)/i;
  const site = {
    platform: platformOf(),
    schemaTypes: uniq(schemaTypes).slice(0, 30),
    cart: hrefs.some((h) => cartRe.test(h)) || qa('[class*="cart" i], [class*="carrinho" i], [class*="sacola" i], [aria-label*="carrinho" i], [aria-label*="cart" i]').length > 0,
    buy: qa('button, a, input[type=submit]').some((el) => /(comprar|adicionar (ao|à) (carrinho|sacola)|add to cart|buy now|compre agora)/i.test(el.innerText || el.value || '')),
    prices: (bodyAll.match(/R\$\s?\d/g) || []).length,
    search: qa('input[type=search], [role=search], form[action*="search" i], form[action*="busca" i], input[name="q"], input[name="s"], [aria-label*="buscar" i], [aria-label*="pesquis" i], [aria-label*="search" i]').length > 0,
    conditions: ['frete', 'parcel', 'pix', 'cartão|cartao', 'boleto', 'troca', 'devolu[çc][ãa]o', 'entrega', 'garantia'].filter((w) => new RegExp(w, 'i').test(bodyAll)),
  };
  const proofRe = /(depoimento|avalia[çc][õo]es|o que (nossos )?(clientes|alunos|pacientes) (dizem|falam)|cases? de sucesso|testimonial|reviews?|clientes satisfeitos|resultados (reais|comprovados)|nossos clientes|quem j[áa] (comprou|contratou|usa))/i;
  const proofEl = qa('[class*="testimonial" i], [class*="depoimento" i], [id*="testimonial" i], [id*="depoimento" i], [class*="review" i]').length > 0;
  const conversion = {
    ctaAboveFold: ctaEl ? (ctaEl.innerText || ctaEl.value || '').trim().slice(0, 40) : null,
    whatsapp: WA_RE.test(fullHtml) || WA_RE.test(seen) || qa('[aria-label*="whats" i], [title*="whats" i], img[alt*="whats" i], img[src*="whats" i], [class*="whats" i], [id*="whats" i]').length > 0,
    phone: hrefs.some((h) => /^tel:/i.test(h)),
    forms: realForms.length + formFrames.length,
    socialProof: proofRe.test(bodyText) || proofEl || /aggregateRating|"review"/i.test(inline),
  };

  // ---------- Conteúdo público (usado só na leitura qualitativa por IA, se o vendedor permitir)
  const squish = (t, n) => (t || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const content = {
    h1: squish(q('h1')?.textContent, 150),
    headings: qa('h2').slice(0, 8).map((h) => squish(h.textContent, 100)).filter(Boolean),
    ctas: uniq(qa('a, button, [role=button]').filter((el) => buttonLike(el) && visible(el)).map((el) => squish(el.innerText || el.value, 50)).filter((t) => t && t.length > 2)).slice(0, 8),
    description: structure.description,
    body: squish(d.body?.innerText, 3000),
  };

  return {
    url: location.href, origin: location.origin, host: location.hostname.replace(/^www\./, ''),
    title: d.title || '', speed, structure, tracking, conversion, content, site,
  };
}
