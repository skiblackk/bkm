import { getAccounting, getAttendance, getSnapshot } from './repository';
import { getCommunicationAlerts } from './communication-webhooks';
import { getAiTriageItems } from './ai-triage';
import { getConfiguredDemoDate, DEMO_PERIOD_LABEL } from './demo-config';

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

function buildContext() {
  const snapshot = getSnapshot();
  const accounting = getAccounting();
  const attendance = getAttendance();
  const today = getConfiguredDemoDate();
  const todayAttendance = attendance.records.filter((item) => item.date === today).map(({ id, staffId, date, status, checkIn, checkOut, note }) => ({ id, staffId, date, status, checkIn, checkOut, note }));
  const tasks = snapshot.tasks.map(({ id, title, clientId, engagementId, assignedTo, priority, dueDate, status }) => ({ id, title, clientId, engagementId, assignedTo, priority, dueDate, status }));
  const triage = getAiTriageItems(getCommunicationAlerts()).map(({ id, channel, senderName, subject, message, priority, summary, status, createdAt }) => ({ id, channel, senderName, subject, message, priority, summary, status, createdAt }));
  return {
    demoDate: today,
    period: DEMO_PERIOD_LABEL,
    clients: snapshot.clients.map(({ id, name, industry, status }) => ({ id, name, industry, status })),
    engagements: snapshot.engagements.map(({ id, name, clientId, type, status, progress, deadline, outstandingDocuments }) => ({ id, name, clientId, type, status, progress, deadline, outstandingDocuments })),
    attendance: todayAttendance,
    tasks,
    accounting: { incomeStatement: accounting.incomeStatement, balanceSheet: accounting.balanceSheet, cashFlow: accounting.cashFlow, trialBalance: accounting.trialBalance },
    messageTriage: triage,
  };
}

export async function askCeoCopilot(question: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = [], attempt = 0): Promise<CopilotResult> {
  const baseUrl = process.env.BUILT_IN_FORGE_API_URL || process.env.OPENAI_API_BASE;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.AI_MODEL || 'gpt-5-mini';
  if (!baseUrl || !apiKey) throw new Error('The live AI model is not configured in the server secret store.');
  const context = buildContext();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: 1800,
      messages: [
        { role: 'system', content: 'You are BKM CEO Copilot, a thoughtful senior co-worker for Benjamin Mutua, CEO of BenKim Associates in Kenya. You are not a canned FAQ bot. Reason over the supplied live BKM records, answer the exact question, show calculations when relevant, and say clearly when the records are insufficient. Never invent clients, people, balances, tax rates, messages, or completed actions. You may recommend actions but must not claim to have sent messages, changed accounting, approved documents, or created tasks unless the application explicitly reports that action. The records are a fictional demonstration dataset and the configured demo date is historical. Return JSON only with a concise answer, 2-5 evidence items naming the supporting records or calculations, recommended actions, and any missing data needed. Keep the answer executive-readable.', },
        { role: 'user', content: `BKM records:\n${JSON.stringify(context)}\n\nConversation context:\n${history.slice(-8).map((item) => `${item.role}: ${item.content}`).join('\n')}\n\nBenjamin's question: ${question}` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'ceo_copilot_response', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }, actions: { type: 'array', items: { type: 'string' } }, needsData: { type: 'array', items: { type: 'string' } } }, required: ['answer', 'evidence', 'actions', 'needsData'], additionalProperties: false } } },
    }),
  });
  if (!response.ok) throw new Error(`The live AI model returned HTTP ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = payload.choices?.[0]?.message?.content?.trim();
  if (!raw && attempt < 1) return askCeoCopilot(question, history, attempt + 1);
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
