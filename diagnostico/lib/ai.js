// Resumo de apoio por IA via API compatível com OpenAI (Groq ou xAI/Grok).
// Só o resultado do checklist é enviado: nunca o conteúdo da página.
export const PROVIDERS = {
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  xai: { name: 'xAI (Grok)', base: 'https://api.x.ai/v1', model: 'grok-3-mini' },
};

const KEY = 'aiSettings';

export async function loadAi() {
  try { return { provider: 'groq', apiKey: '', model: '', ...((await chrome.storage.local.get(KEY))[KEY] || {}) }; } catch { return { provider: 'groq', apiKey: '', model: '' }; }
}
export const saveAi = (settings) => chrome.storage.local.set({ [KEY]: settings });

const SYSTEM = `Você é consultor sênior de marketing digital da V4 Company. Escreve para ajudar um vendedor a conduzir uma conversa com o dono de uma empresa que NÃO entende de marketing.
Regras: português do Brasil; frases curtas e linguagem simples, sem jargões (se citar um termo técnico, explique em poucas palavras); use SOMENTE os dados fornecidos, sem inventar números nem fatos; não use travessões; não elogie demais nem faça promessas de resultado.`;

const STATUS = { ok: 'BOM', warn: 'ATENÇÃO', bad: 'RUIM', na: 'NÃO VERIFICADO' };

export function buildMessages({ ctx, client, data, results, summary, bigSentence }) {
  const o = summary.overall;
  const lines = results.map((r) => `- [${STATUS[r.status]}] ${r.name}: ${r.found}`).join('\n');
  const user = `Análise: ${ctx.title}${client ? `\nCliente: ${client}` : ''}\nEndereço: ${data.url}
Resultado geral: ${o.ok} de ${o.total} itens bons.${bigSentence ? `\nDestaque: ${bigSentence}` : ''}

Itens verificados:
${lines}

Escreva, para o vendedor usar na conversa:
1. "Em uma frase": o diagnóstico geral em até 25 palavras.
2. "Os 3 pontos mais importantes": os 3 problemas que mais custam clientes ou vendas, cada um com uma frase sobre o impacto no negócio, em palavras simples.
3. "O que o cliente já faz bem": 1 ou 2 itens bons, para abrir a conversa de forma positiva (se não houver, escreva "Nada de relevante a destacar").
4. "Próximo passo sugerido": uma frase para propor a continuação da conversa.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

async function call(path, settings, init = {}) {
  const p = PROVIDERS[settings.provider] || PROVIDERS.groq;
  const r = await fetch(`${p.base}${path}`, { ...init, headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `Erro ${r.status} do provedor de IA`);
  return body;
}

export async function generateSummary(settings, messages) {
  if (!settings.apiKey) throw new Error('Configure a chave da API da IA primeiro.');
  const model = settings.model || PROVIDERS[settings.provider]?.model;
  const body = await call('/chat/completions', settings, { method: 'POST', body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 700 }) });
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('A IA não devolveu texto.');
  return text;
}

export async function listModels(settings) {
  if (!settings.apiKey) throw new Error('Informe a chave da API primeiro.');
  const body = await call('/models', settings);
  return (body.data || []).map((m) => m.id).sort();
}
