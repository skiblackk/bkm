/**
 * Single source of truth for the language model.
 *
 * Groq is the primary provider (OpenAI-compatible endpoint). The older
 * Forge/OpenAI variable names are still honoured so an existing deployment
 * keeps working after a rename. Nothing here is read on the client: the API
 * key is server-only.
 *
 * A model is never guessed silently. If the configured model does not exist on
 * the provider, the provider returns a 400 naming it, and callers surface that
 * error instead of pretending an answer came from live data.
 */

export type AiProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: 'groq' | 'openai-compatible';
};

const GROQ_URL = 'https://api.groq.com/openai/v1';

/**
 * Groq has retired several Llama chat models. This list is the set we have
 * verified against the live /models endpoint, preferring tool-calling capable
 * models with the largest context window.
 */
const GROQ_PREFERRED = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

let cachedModel: { key: string; model: string } | null = null;

export function getAiProvider(): AiProvider | null {
  const groqKey = process.env.GROQ_API_KEY;
  const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
  const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
  const openaiUrl = process.env.OPENAI_API_BASE;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (groqKey) {
    return { baseUrl: GROQ_URL, apiKey: groqKey, model: process.env.AI_MODEL || process.env.GROQ_MODEL || GROQ_PREFERRED[0], provider: 'groq' };
  }
  if (forgeUrl && forgeKey) {
    return { baseUrl: forgeUrl.replace(/\/$/, ''), apiKey: forgeKey, model: process.env.AI_MODEL || 'gpt-5-mini', provider: 'openai-compatible' };
  }
  if (openaiUrl && openaiKey) {
    return { baseUrl: openaiUrl.replace(/\/$/, ''), apiKey: openaiKey, model: process.env.AI_MODEL || 'gpt-4o-mini', provider: 'openai-compatible' };
  }
  return null;
}

export function aiConfigured(): boolean {
  return getAiProvider() !== null;
}

/**
 * Pick a model that actually exists on the provider. Only used when the
 * operator has not pinned AI_MODEL: we ask the provider what it serves rather
 * than shipping a hardcoded name that may have been retired.
 */
export async function resolveModel(provider: AiProvider): Promise<string> {
  if (process.env.AI_MODEL || process.env.GROQ_MODEL) return provider.model;
  const cacheKey = provider.baseUrl;
  if (cachedModel?.key === cacheKey) return cachedModel.model;
  if (provider.provider !== 'groq') return provider.model;
  try {
    const response = await fetch(`${provider.baseUrl}/models`, { headers: { Authorization: `Bearer ${provider.apiKey}` }, cache: 'no-store' });
    if (!response.ok) return provider.model;
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    const available = (payload.data ?? []).map((entry) => entry.id ?? '').filter(Boolean);
    const chosen = GROQ_PREFERRED.find((candidate) => available.includes(candidate)) ?? available.find((id) => !/whisper|orpheus|prompt-guard|allam/.test(id)) ?? provider.model;
    cachedModel = { key: cacheKey, model: chosen };
    return chosen;
  } catch {
    return provider.model;
  }
}

/** Build the chat-completions URL from a base that may or may not include /v1. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;
}

export function aiStatus() {
  const provider = getAiProvider();
  return {
    configured: Boolean(provider),
    provider: provider?.provider ?? null,
    model: provider?.model ?? null,
  };
}
