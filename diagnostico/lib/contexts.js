// Detecta qual módulo usar a partir do endereço da aba e reúne a definição de cada um.
import { GROUPS, LEVEL_LABEL, siteHeadline } from './checks.js';
import { IG_GROUPS, igHeadline } from './instagram.js';
import { AD_GROUPS, adsHeadline, isAdLibraryUrl } from './adlibrary.js';

export const CONTEXTS = {
  site: { id: 'site', title: 'Diagnóstico rápido do site', groups: GROUPS, headline: siteHeadline, beta: false },
  instagram: { id: 'instagram', title: 'Diagnóstico rápido do Instagram', groups: IG_GROUPS, headline: igHeadline, beta: true },
  ads: { id: 'ads', title: 'Diagnóstico rápido dos anúncios na Meta', groups: AD_GROUPS, headline: adsHeadline, beta: true },
};

export function detectContext(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url)) return null;
  if (isAdLibraryUrl(url)) return 'ads';
  if (/^https?:\/\/([a-z-]+\.)?instagram\.com(\/|$)/i.test(url)) return 'instagram';
  return 'site';
}

export { LEVEL_LABEL };
