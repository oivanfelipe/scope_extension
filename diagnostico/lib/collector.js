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
  const CTA_RE = /(fale|falar|entre em contato|contato|solicit|or[çc]amento|agende|agendar|compr|quero|saiba mais|conhe[çc]a|come[çc]|teste|gr[aá]tis|baixar|download|whatsapp|cadastr|assine|contrat|simul|diagn[óo]stico|reserv|pedir|ver (planos|produtos|ofertas))/i;
  const buttonLike = (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /submit|button/.test(el.type)) || /(^|[\s_-])(btn|button|cta|botao|bot[ãa]o)([\s_-]|$)/i.test(el.className?.toString?.() || '');
  const ctaEl = qa('a, button, input[type=submit], [role=button]').find((el) => {
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    if (!text || text.length > 60 || !CTA_RE.test(text) || !buttonLike(el) || !visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
  const hrefs = qa('a[href]').map((a) => a.getAttribute('href') || '');
  const formFrames = qa('iframe').filter((f) => /typeform|hsforms|hubspot|rdstation|jotform|forms\.gle|docs\.google\.com\/forms|formulario|calendly/i.test(f.src));
  const realForms = qa('form').filter((f) => {
    if (f.getAttribute('role') === 'search') return false;
    const fields = [...f.querySelectorAll('input, textarea, select')].filter((i) => !/hidden|submit|button|search|checkbox|radio/.test(i.type || '') && visible(i));
    return fields.some((i) => /email|tel/.test(i.type)) || f.querySelector('textarea') || fields.length >= 2;
  });
  const bodyText = (d.body?.innerText || '').slice(0, 200000);
  const proofRe = /(depoimento|avalia[çc][õo]es|o que (nossos )?(clientes|alunos|pacientes) (dizem|falam)|cases? de sucesso|testimonial|reviews?|clientes satisfeitos|resultados (reais|comprovados)|nossos clientes|quem j[áa] (comprou|contratou|usa))/i;
  const proofEl = qa('[class*="testimonial" i], [class*="depoimento" i], [id*="testimonial" i], [id*="depoimento" i], [class*="review" i]').length > 0;
  const conversion = {
    ctaAboveFold: ctaEl ? (ctaEl.innerText || ctaEl.value || '').trim().slice(0, 40) : null,
    whatsapp: hrefs.some((h) => /wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\//i.test(h)) || /wa\.me|api\.whatsapp\.com/.test(seen) || qa('[class*="whats" i], [id*="whats" i]').length > 0,
    phone: hrefs.some((h) => /^tel:/i.test(h)),
    forms: realForms.length + formFrames.length,
    socialProof: proofRe.test(bodyText) || proofEl || /aggregateRating|"review"/i.test(inline),
  };

  return {
    url: location.href, origin: location.origin, host: location.hostname.replace(/^www\./, ''),
    title: d.title || '', speed, structure, tracking, conversion,
  };
}
