// Configuração da equipe, lida de lib/config.local.js (fora do GitHub, só existe no pacote distribuído).
// Formato: export const DEFAULT_AI = { provider, apiKey, model }; export const PSI_KEY = '<chave do Google PageSpeed>';
export async function teamConfig() {
  try {
    const m = await import('./config.local.js');
    return { ai: m.DEFAULT_AI || {}, psiKey: m.PSI_KEY || '' };
  } catch { return { ai: {}, psiKey: '' }; }
}
