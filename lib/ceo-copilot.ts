import { executeTool } from './copilot-tools';
import { businessDate } from './business-clock';
import { getAiProvider, resolveModel, chatCompletionsUrl } from './ai-provider';
import type { DemoSession } from './auth';

export type CopilotResult = { answer: string; evidence: string[]; actions: string[]; needsData: string[]; model: string; live: true };

function repairJson(raw: string) {
  let output = ''; let inString = false; let escaped = false;
  for (const character of raw) {
    if (escaped) { output += character; escaped = false; continue; }
    if (character === '\\' && inString) { output += character; escaped = true; continue; }
    if (character === '"') { output += character; inString = !inString; continue; }
    if (inString && character === '\n') { output += '\\n'; continue; }
    if (inString && character === '\r') { output += '\\r'; continue; }
    if (inString && character === '\t') { output += '\\t'; continue; }
    output += character;
  }
  return output;
}

/**
 * Live context for the assistant.
 *
 * This previously shipped the in-memory demonstration store, anchored to a
 * hardcoded historical demo date and labelled "fictional" in the prompt — so
 * the model correctly described mock data. It now runs the same
 * permission-checked tool layer as the management copilot, over real records.
 */
async function buildContext(session: DemoSession) {
  const provider = getAiProvider();
  if (!provider) throw new Error('The live AI model is not configured on the server, so no answer was generated. Ask an administrator to set GROQ_API_KEY.');
  const model = await resolveModel(provider);
  const today = businessDate();
  const monthStart = `${today.slice(0, 7)}-01`;

  const results: Array<{ tool: string; summary: string; data?: unknown; denied?: boolean; scope?: string }> = [];
  const wanted: Array<[string, Record<string, unknown>]> = [
    ['attendance_summary', { from: monthStart, to: today }],
    ['task_workload', {}],
    ['pending_approvals', {}],
    ['employee_directory', {}],
  ];
  for (const [name, args] of wanted) {
    try {
      results.push(await executeTool(name, args, session));
    } catch (error) {
      results.push({ tool: name, summary: `Tool unavailable: ${error instanceof Error ? error.message : 'unknown error'}` });
    }
  }
  return {
    today,
    model,
    // Only successfully authorised tool output is passed to the model.
    tools: results.map((result) => ({ tool: result.tool, summary: result.summary, data: result.data, denied: result.denied, scope: result.scope })),
  };
}

export async function askCeoCopilot(question: string, session: DemoSession, history: Array<{ role: 'user' | 'assistant'; content: string }> = [], attempt = 0): Promise<CopilotResult> {
  const context = await buildContext(session);
  const provider = getAiProvider()!;
  const { baseUrl, apiKey } = provider;
  const model = context.model;
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: 1800,
      messages: [
        { role: 'system', content: `You are the BKM work assistant for ${session.name} (${session.role}) at BenKim Associates, an audit and advisory firm in Nairobi, Kenya. Today is ${context.today} in Africa/Nairobi. All figures come from the company's live operational records, retrieved through permission-checked tools run on this request. Answer only from that tool output. Never invent people, dates, balances or actions. If a tool reports a permission denial, say the user lacks that permission rather than guessing. If a tool returned no data, say so plainly and name what is missing. Show the dates and figures you used so the answer is checkable. You may recommend actions but must never claim to have sent a message, posted a journal, approved a document or created a task unless the application reported that it happened. Return JSON only with a concise answer, 2-5 evidence items naming the records or calculations behind it, recommended actions, and any missing data.

Write the answer field for a formatted panel that renders plain text, NOT markdown. Rules:
- Never use asterisks, underscores, hash signs, backticks or pipe tables.
- Lead with one short sentence stating the headline, then put each figure on its own line as "Label: value" with a label of at most four words (for example "Late arrivals: 0").
- Put any grouped detail on lines beginning with a dash and a space.
- Keep every line under about 90 characters. Do not repeat the same number twice.` },
        { role: 'user', content: `Live records retrieved for this question:\n${JSON.stringify(context.tools)}\n\nConversation context:\n${history.slice(-8).map((item) => `${item.role}: ${item.content}`).join('\n')}\n\nQuestion: ${question}` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'ceo_copilot_response', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }, actions: { type: 'array', items: { type: 'string' } }, needsData: { type: 'array', items: { type: 'string' } } }, required: ['answer', 'evidence', 'actions', 'needsData'], additionalProperties: false } } },
    }),
  });
  if (!response.ok) { const detail = await response.text().catch(() => ''); throw new Error(`The live AI model (${model} via ${provider.provider}) returned HTTP ${response.status}. ${detail.slice(0, 200)}`); }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = payload.choices?.[0]?.message?.content?.trim();
  if (!raw && attempt < 1) return askCeoCopilot(question, session, history, attempt + 1);
  if (!raw) throw new Error('The live AI model returned an empty response after retrying.');
  const normalized = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  let parsed: Omit<CopilotResult, 'model' | 'live'>;
  try {
    parsed = JSON.parse(repairJson(normalized)) as Omit<CopilotResult, 'model' | 'live'>;
  } catch {
    const answerStart = normalized.indexOf('"answer"');
    const valueStart = normalized.indexOf(':', answerStart) + 1;
    const evidenceStart = normalized.indexOf(',"evidence"', valueStart);
    const fallback = normalized.slice(valueStart, evidenceStart > valueStart ? evidenceStart : undefined).trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
    parsed = { answer: fallback || normalized, evidence: ['Live model response returned, but its structured evidence fields could not be parsed. Review the source records before acting.'], actions: [], needsData: ['Structured evidence parsing failed for this response. Ask the question again if you need itemized support.'] };
  }
  return { answer: parsed.answer, evidence: parsed.evidence.slice(0, 5), actions: parsed.actions.slice(0, 5), needsData: parsed.needsData.slice(0, 5), model, live: true };
}
