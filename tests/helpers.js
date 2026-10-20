import { JSDOM } from 'jsdom';
import { collectPage } from '../lib/collector.js';

/** Executa o coletor real dentro de um DOM simulado. */
export async function collectFromHtml(html, url = 'https://www.exemplo.com.br/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const page = await dom.window.eval(`(${collectPage.toString()})()`);
  return { page, DOMParser: dom.window.DOMParser, dom };
}
