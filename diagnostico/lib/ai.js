import { teamConfig } from './team.js';

// Resumo e leitura de conteúdo por IA via API compatível com OpenAI (Groq ou xAI/Grok).
// Sem a opção "enviar conteúdo", só o resultado do checklist vai ao provedor.
export const PROVIDERS = {
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  xai: { name: 'xAI (Grok)', base: 'https://api.x.ai/v1', model: 'grok-3-mini' },
};

const KEY = 'aiSettings';
const teamDefaults = async () => (await teamConfig()).ai;

export async function loadAi() {
  let stored = {};
  try { stored = (await chrome.storage.local.get(KEY))[KEY] || {}; } catch { /* sem storage */ }
  const team = await teamConfig();
  return { provider: 'groq', apiKey: '', model: '', sendContent: true, autoAi: true, psiKey: '', ...stored, hasTeamKey: !!team.ai.apiKey, hasTeamPsi: !!team.psiKey };
}
export const saveAi = (settings) => chrome.storage.local.set({ [KEY]: { provider: settings.provider, apiKey: settings.apiKey, model: settings.model, sendContent: settings.sendContent !== false, autoAi: settings.autoAi !== false, psiKey: settings.psiKey || '' } });

/** Sem chave própria, usa a da equipe (provedor e modelo incluídos). */
export function withDefaults(settings, team = {}) {
  if (settings.apiKey) return settings;
  if (!team.apiKey) return settings;
  return { ...settings, provider: team.provider || settings.provider, apiKey: team.apiKey, model: team.model || '' };
}
export async function resolveAi(settings) { return withDefaults(settings, await teamDefaults()); }

const SYSTEM = `Você é consultor sênior de marketing digital da V4 Company. Escreve para ajudar um vendedor a conduzir uma conversa com o dono de uma empresa que NÃO entende de marketing.
Regras: considere o tipo de site informado (em loja virtual, não cobre formulário de contato: foque em compra, confiança, frete e condições); português do Brasil; frases curtas e linguagem simples, sem jargões (se citar um termo técnico, explique em poucas palavras); use SOMENTE os dados fornecidos, sem inventar números, porcentagens nem fatos; não use travessões; não elogie demais nem faça promessas de resultado.
Separe o que é dado medido (itens do checklist) do que é opinião sua sobre o conteúdo lido, usando apenas os títulos numerados que forem pedidos, sem títulos extras.
Escreva em texto simples, sem markdown (sem asteriscos, sem cerquilhas). Você recebe apenas texto: não descreva imagens, fotos nem vídeos. Se o conteúdo for insuficiente para opinar, diga isso em uma frase.`;

const STATUS = { ok: 'BOM', warn: 'ATENÇÃO', bad: 'RUIM', na: 'NÃO VERIFICADO' };
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Conteúdo público observado, em texto, para a leitura qualitativa. */
export function contentBlock(ctxId, c) {
  if (!c) return '';
  if (ctxId === 'site') {
    const parts = [
      c.h1 && `Título principal: ${clip(c.h1, 150)}`,
      c.headings?.length && `Subtítulos: ${c.headings.map((h) => clip(h, 100)).join(' | ')}`,
      c.ctas?.length && `Botões e chamadas visíveis: ${c.ctas.map((h) => clip(h, 50)).join(' | ')}`,
      c.description && `Descrição para o Google: ${clip(c.description, 200)}`,
      c.body && `Início do texto da página: ${clip(c.body, 2500)}`,
    ].filter(Boolean);
    return parts.join('\n');
  }
  if (ctxId === 'instagram') {
    // Sem legendas nem bio com texto de verdade a IA só especularia: nesse caso a leitura não é pedida.
    const bio = clip(String(c.bio ?? '').replace(/[\d.,]+\s*(?:mil|mi|k|m)?\s*(?:posts?|publica[çc][õo]es|seguidores|followers|seguindo|following)/gi, ''), 400);
    const posts = (c.posts || []).filter((p) => clip(p.caption, 300).length >= 15).slice(0, 12).map((p, i) => `${i + 1}. [${p.isReel ? 'Reels' : 'Post'}, ${p.likes ?? '?'} curtidas, ${p.comments ?? 0} comentários] ${clip(p.caption, 280)}`);
    return [c.links?.length && `Link na bio: ${c.links.join(', ')}`, bio.length >= 30 && `Bio e cabeçalho do perfil: ${bio}`, posts.length && `Legendas dos posts recentes:\n${posts.join('\n')}`].filter(Boolean).join('\n');
  }
  if (ctxId === 'ads') {
    const copies = (c.copies || []).slice(0, 10).map((t, i) => `${i + 1}. ${clip(t, 300)}`);
    return copies.length ? `Textos dos anúncios ativos:\n${copies.join('\n')}` : '';
  }
  return '';
}

const READING = {
  site: 'a proposta de valor fica clara em 5 segundos? a oferta e o botão de ação convencem? que dúvida ou objeção do cliente fica sem resposta?',
  instagram: 'os temas e o tom do perfil, se há chamadas para ação, se o conteúdo vende ou só entretém, e uma ideia concreta de conteúdo para testar.',
  ads: 'os ângulos e promessas usados, os gatilhos mentais presentes e o que falta testar.',
};

export function buildMessages({ ctx, client, data, results, summary, bigSentence, content, extra }) {
  const o = summary.overall;
  const lines = results.map((r) => `- [${STATUS[r.status]}] ${r.name}: ${r.found}`).join('\n');
  const block = contentBlock(ctx.id, content);
  const user = `Análise: ${ctx.title}${client ? `\nCliente: ${client}` : ''}\nEndereço: ${data.url}${extra ? `\n${extra}` : ''}
Resultado geral: ${o.ok} de ${o.total} itens bons.${bigSentence ? `\nDestaque: ${bigSentence}` : ''}

Itens verificados (dados medidos):
${lines}
${block ? `\nConteúdo público observado (para a sua leitura, não são dados medidos):\n${block}\n` : ''}
Escreva, para o vendedor usar na conversa:
1. "Em uma frase": o diagnóstico geral em até 25 palavras.
2. "Os 3 pontos mais importantes": os 3 problemas dos dados medidos que mais custam clientes ou vendas, cada um com uma frase sobre o impacto no negócio, em palavras simples.
${block ? `3. "Leitura do conteúdo (opinião da IA)": em até 4 frases curtas, ${READING[ctx.id] || 'sua leitura do conteúdo'} Baseie-se apenas no conteúdo acima.\n4. "O que o cliente já faz bem": 1 ou 2 itens bons, para abrir a conversa de forma positiva (se não houver, escreva "Nada de relevante a destacar").\n5.` : '3. "O que o cliente já faz bem": 1 ou 2 itens bons, para abrir a conversa de forma positiva (se não houver, escreva "Nada de relevante a destacar").\n4.'} "Próximo passo sugerido": uma frase para propor a continuação da conversa.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

async function call(path, settings, init = {}) {
  const p = PROVIDERS[settings.provider] || PROVIDERS.groq;
  const r = await fetch(`${p.base}${path}`, { ...init, headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `Erro ${r.status} do provedor de IA`);
  return body;
}

/** Remove marcações de markdown e blocos de raciocínio que o modelo às vezes devolve, pois a tela mostra texto puro. */
export function cleanAiText(raw) {
  return String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|__/g, '').replace(/^#{1,6}\s*/gm, '').replace(/[ \t]+$/gm, '').trim();
}

export async function generateSummary(settings, messages) {
  if (!settings.apiKey) throw new Error('Configure a chave da API da IA primeiro.');
  const model = settings.model || PROVIDERS[settings.provider]?.model;
  const payload = { model, messages, temperature: 0.3, max_tokens: 2500 };
  if (/gpt-oss/.test(model)) payload.reasoning_effort = 'low';
  const body = await call('/chat/completions', settings, { method: 'POST', body: JSON.stringify(payload) });
  const text = cleanAiText(body?.choices?.[0]?.message?.content);
  if (!text) throw new Error('A IA não devolveu texto.');
  return text;
}

export async function listModels(settings) {
  if (!settings.apiKey) throw new Error('Informe a chave da API primeiro.');
  const body = await call('/models', settings);
  return (body.data || []).map((m) => m.id).sort();
}
