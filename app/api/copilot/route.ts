import { NextResponse } from 'next/server';
import { businessDate } from '@/lib/business-clock';
import { getDemoSession, hasPermission, type DemoSession } from '@/lib/auth';
import { executeTool, TOOL_SPECS, resolvePeriod } from '@/lib/copilot-tools';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAiProvider, resolveModel, aiStatus, chatCompletionsUrl } from '@/lib/ai-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export interface CopilotAnswer {
  answer: string;
  engine: 'llm-tool-calling' | 'tool-router';
  engineError?: string | null;
  toolTrace: Array<{ tool: string; summary: string; denied?: boolean; requiresConfirmation?: boolean; draft?: unknown }>;
  scope: string[];
  followUps: string[];
  conversationId: string | null;
  needsConfirmation?: boolean;
}

function parseDates(text: string): { from: string; to: string; label: string } {
  const lower = text.toLowerCase();
  // Anchor every relative period to the company's local day, not the server's UTC day.
  const todayIso = businessDate();
  const today = new Date(`${todayIso}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const day = (n: number) => iso(new Date(today.getTime() + n * 86400000));
  const dow = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  if (/\btoday\b/.test(lower)) return { from: todayIso, to: todayIso, label: 'today' };
  if (/\byesterday\b/.test(lower)) return { from: day(-1), to: day(-1), label: 'yesterday' };
  if (/\blast week\b/.test(lower)) return { from: day(-dow - 6), to: day(-dow), label: 'last week' };
  if (/\bthis week\b/.test(lower)) return { from: day(-(dow - 1)), to: todayIso, label: 'this week' };
  if (/\blast month\b/.test(lower)) { const d = new Date(today); d.setUTCMonth(d.getUTCMonth() - 1, 1); return { from: iso(d), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))), label: 'last month' }; }
  if (/\bthis month\b/.test(lower)) return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: todayIso, label: 'this month' };
  return { from: day(-6), to: todayIso, label: 'the last 7 days' };
}

function guidanceFor(focus: string[], findings: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (focus.includes('attendance')) {
    const f = findings.attendance as { configured?: boolean; totals?: { late: number; missing: number } } | undefined;
    if (f && f.configured === false) out.push('First configure the working schedule and grace period — lateness cannot be judged without them.');
    if (f?.totals?.missing) out.push(`Investigate the ${f.totals.missing} missing check-in record(s): they may be unrecorded work, leave, or absences — do not assume absence without checking.`);
    if (f?.totals?.late) out.push('Compare lateness across teams and dates to see whether it is a scheduling problem or a recurring pattern before taking action.');
  }
  if (focus.includes('tasks')) {
    const f = findings.tasks as { overdue?: number; unassigned?: number } | undefined;
    if (f?.overdue) out.push(`${f.overdue} overdue task(s): check whether they are blocked, then rebalance workload with the responsible managers.`);
    if (f?.unassigned) out.push('Assign the unassigned work — unowned tasks are the most common source of silent delay.');
  }
  if (focus.includes('approvals')) { const a = findings.approvals as { approvals?: unknown[]; leaveRequests?: unknown[] } | undefined; if (((a?.approvals?.length ?? 0) + (a?.leaveRequests?.length ?? 0)) > 0) out.push('Decide the pending requests so employees are not blocked; every decision is logged.'); }
  if (focus.includes('system')) out.push('Reconnect any disconnected integrations and configure the missing webhook secrets.');
  return out;
}

async function routeQuestion(question: string, session: DemoSession, prior: string[]): Promise<CopilotAnswer> {
  const lower = question.toLowerCase();
  const trace: CopilotAnswer['toolTrace'] = [];
  const scope: string[] = [];
  const findings: Record<string, unknown> = {};
  const focus: string[] = [];
  const sentences: string[] = [];
  const period = parseDates(lower);
  const wantsCompare = /\bcompare\b|\bversus\b|\bvs\.?\b/.test(lower) && prior.length > 0;
  const isFollowUp = /\bwhat about\b|\band (?:last|this|next)\b|\bhow about\b|\bcompare\b|\bthe same\b|\bagain\b/.test(lower) && prior.length > 0;
  const topic = isFollowUp ? `${lower} ${prior.join(' ').toLowerCase()}` : lower;

  const run = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await executeTool(tool, args, session);
    trace.push({ tool: result.tool, summary: result.summary, denied: result.denied, requiresConfirmation: result.requiresConfirmation, draft: result.draft });
    if (result.scope && result.scope !== 'none') scope.push(result.scope);
    return result;
  };

  if (/\blate|lateness|check.?in|absent|absence|attendance|punctual/.test(topic)) {
    focus.push('attendance');
    const result = await run('attendance_summary', { from: period.from, to: period.to });
    findings.attendance = result.data;
    sentences.push(`For ${period.label}: ${result.summary}`);
    if (wantsCompare) {
      const prev = { from: period.from, to: period.to };
      const days = Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / 86400000) + 1;
      const prevFrom = new Date(new Date(period.from).getTime() - days * 86400000).toISOString().slice(0, 10);
      const prevResult = await run('attendance_summary', { from: prevFrom, to: prev.from });
      sentences.push(`Compared with the previous ${days}-day period (${prevFrom} → ${prev.from}): ${prevResult.summary}`);
    }
  }
  if (/\boverdue|task|workload|assignment|behind|delay|productiv|unassigned|deadline/.test(topic)) {
    focus.push('tasks');
    const result = await run('task_workload');
    findings.tasks = result.data;
    sentences.push(result.summary);
  }
  const attention = /\bapproval|leave request|pending leave|waiting for me|(?:need|requir)\w*\s+(?:my\s+)?(?:attention|decision|approval)|what should i (?:do|prioriti)\w*|what requires/.test(topic);
  if (attention) {
    focus.push('approvals');
    const result = await run('pending_approvals');
    findings.approvals = result.data;
    sentences.push(result.summary);
    if (!focus.includes('tasks')) {
      const t = await run('task_workload');
      findings.tasks = t.data;
      sentences.push(t.summary);
    }
  }
  if (/\baudit|security|login|permission change|who changed/.test(lower)) {
    focus.push('audit');
    const result = await run('audit_log_summary', { from: period.from, to: period.to });
    sentences.push(`For ${period.label}: ${result.summary}`);
  }
  if (/\bsystem|integration|webhook|health|error|broken|disconnect|normal\b/.test(lower)) {
    focus.push('system');
    const result = await run('system_health');
    findings.system = result.data;
    sentences.push(result.summary);
  }
  if (/\bwho\b|\bemployee|staff|people|directory|team member|colleague/.test(lower) && !focus.length) {
    const result = await run('employee_directory');
    sentences.push(result.summary);
    if (/\bwho\b/.test(lower) && /\bwork|task/.test(lower)) {
      const t = await run('task_workload');
      sentences.push(t.summary);
    }
  }
  if (/\bfinance|journal|revenue|income|cash|balance|accounting|money/.test(lower)) {
    const result = await run('finance_overview');
    sentences.push(result.summary);
  }
  if (/\bannounce|broadcast/.test(lower) && /\bdraft|prepare|write|help/.test(lower)) {
    focus.push('draft');
    const result = await run('prepare_announcement_draft', { audience: 'all', message: question.replace(/.*?(announcement|broadcast)\s*(to|for)?\s*/i, '').trim() || '(draft text to be written with the manager)' });
    sentences.push(result.summary);
    return finalize(sentences, trace, scope, focus, findings, result.draft ? true : false);
  }
  if (!sentences.length) {
    const result = await run('my_tasks');
    sentences.push(`I could not map that question to one of my approved data tools, so I retrieved only what your own account allows. ${result.summary} Try asking about attendance, tasks, approvals, audit activity, system health, staff, or finance.`);
    focus.push('fallback');
  }
  return finalize(sentences, trace, scope, focus, findings, false);
}

function finalize(sentences: string[], trace: CopilotAnswer['toolTrace'], scope: string[], focus: string[], findings: Record<string, unknown>, needsConfirmation: boolean): CopilotAnswer {
  const guidance = guidanceFor(focus, findings);
  const answer = [
    sentences.join(' '),
    guidance.length ? `\n\nWhat I would do next:\n${guidance.map((g, i) => `${i + 1}. ${g}`).join('\n')}` : '',
  ].join('');
  const followUps = [
    focus.includes('attendance') ? 'Show me last week for comparison' : 'What requires my attention today?',
    focus.includes('tasks') ? 'Who has the most overdue work?' : 'Show me overdue tasks',
    'Check the system’s health',
  ];
  return { answer, engine: 'tool-router', toolTrace: trace, scope: Array.from(new Set(scope)), followUps, conversationId: null, needsConfirmation: needsConfirmation || undefined };
}

async function llmAnswer(question: string, session: DemoSession, history: Array<{ role: string; content: string }>): Promise<CopilotAnswer | null> {
  const provider = getAiProvider();
  if (!provider) return null;
  const { baseUrl, apiKey } = provider;
  const model = await resolveModel(provider);
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: `You are the BKM Management Copilot for ${session.name} (${session.role}). Today is ${businessDate()} in Africa/Nairobi — use that year. Answer from the approved tools only; never invent people, attendance, tasks or figures. Quote the exact dates a tool returned rather than restating them. When a tool reports a denial, explain that the user lacks permission instead of guessing. Distinguish confirmed facts from possible explanations. Consequential actions come back as drafts requiring confirmation.

Style: your answer is shown in a formatted panel that renders plain text, NOT markdown. Never use asterisks, underscores, hash signs, backticks or pipe tables. Open with one short sentence giving the headline finding, then put each figure on its own line as "Label: value" with a label of at most four words (for example "Late arrivals: 0"). Use lines beginning with "- " for grouped detail, and numbered lines for recommendations. Keep lines under about 90 characters and never restate the same figure twice, because the interface already shows the underlying data beneath your answer.` },
    // Keep history small and plain: only real user/assistant text, no empty
    // entries and no oversized markdown tables, which the provider rejects.
    ...history
      .filter((item) => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string' && item.content.trim().length > 0)
      .slice(-6)
      .map((item) => ({ role: item.role, content: item.content.slice(0, 2000) })),
    { role: 'user', content: question },
  ];
  const trace: CopilotAnswer['toolTrace'] = [];
  const scope: string[] = [];
  for (let round = 0; round < 6; round += 1) {
    const response = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: TOOL_SPECS.map((spec) => ({ type: 'function', function: spec })), tool_choice: round === 0 ? 'auto' : 'auto' }),
    });
    if (!response.ok) throw new Error(`The live AI model returned HTTP ${response.status}.`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error('The live AI model returned an empty response.');
    if (!message.tool_calls?.length) {
      return { answer: message.content ?? '', engine: 'llm-tool-calling', toolTrace: trace, scope: Array.from(new Set(scope)), followUps: ['What requires my attention today?', 'Show me overdue tasks'], conversationId: null };
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      const result = await executeTool(call.function.name, args, session);
      trace.push({ tool: result.tool, summary: result.summary, denied: result.denied, requiresConfirmation: result.requiresConfirmation, draft: result.draft });
      if (result.scope && result.scope !== 'none') scope.push(result.scope);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ summary: result.summary, data: result.data, denied: result.denied, requiresConfirmation: result.requiresConfirmation, draft: result.draft }) });
    }
  }
  // Out of rounds: force a final answer from the evidence already gathered
  // instead of returning a dead end.
  try {
    const finalMessages = [...messages, { role: 'user', content: 'Give your final answer now using only the tool results above. Do not call more tools.' }];
    const response = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: finalMessages }),
    });
    if (response.ok) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (content) return { answer: content, engine: 'llm-tool-calling', toolTrace: trace, scope: Array.from(new Set(scope)), followUps: [], conversationId: null };
    }
  } catch { /* fall through to the explicit message below */ }
  return { answer: 'I gathered the records but could not compose a final answer. Narrow the question and try again.', engine: 'llm-tool-calling', toolTrace: trace, scope: Array.from(new Set(scope)), followUps: [], conversationId: null };
}

export async function GET(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  // Lets the panel state plainly whether answers come from a live model or the
  // deterministic router, instead of implying generative answers either way.
  const status = aiStatus();
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  const admin = db();
  if (conversationId) {
    const { data: messages } = await admin.from('ai_messages').select('id, role, content, created_at').eq('conversation_id', conversationId).order('created_at');
    return NextResponse.json({ messages: messages ?? [] });
  }
  const { data: conversations } = await admin.from('ai_conversations').select('id, title, created_at').eq('profile_id', session.account).order('created_at', { ascending: false }).limit(20);
  return NextResponse.json({ conversations: conversations ?? [], ai: status });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!hasPermission(session, 'use_assistant')) return NextResponse.json({ error: 'Permission required: use_assistant.' }, { status: 403 });
  try {
    const input = await request.json() as { message?: string; conversationId?: string | null };
    const question = String(input.message ?? '').trim().slice(0, 4000);
    if (question.length < 2) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
    const admin = db();

    let conversationId = input.conversationId ?? null;
    let history: Array<{ role: string; content: string }> = [];
    if (conversationId) {
      const { data: prior } = await admin.from('ai_messages').select('role, content').eq('conversation_id', conversationId).order('created_at').limit(12);
      const { data: owned } = await admin.from('ai_conversations').select('id').eq('id', conversationId).eq('profile_id', session.account).maybeSingle();
      if (!owned) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
      history = (prior ?? []) as Array<{ role: string; content: string }>;
    } else {
      const { data: created } = await admin.from('ai_conversations').insert({ profile_id: session.account, title: question.slice(0, 80) }).select('id').single();
      conversationId = created?.id ?? null;
    }

    let answer: CopilotAnswer | null = null;
    let engineError: string | null = null;
    try {
      answer = await llmAnswer(question, session, history);
    } catch (error) {
      // Never swallow this: a silent fallback is how a deterministic router
      // gets mistaken for a live model. Log it and report it to the caller.
      engineError = error instanceof Error ? error.message : String(error);
      console.error('[copilot] live model failed:', engineError);
      answer = null;
    }
    if (!answer) {
      answer = await routeQuestion(question, session, history.map((h) => h.content));
      if (engineError) {
        answer.engineError = engineError;
        answer.answer = `[Live model unavailable — this answer came from the deterministic record reader, not the AI model.] ${engineError}

${answer.answer}`;
      }
    }
    answer.conversationId = conversationId;

    if (conversationId) {
      await admin.from('ai_messages').insert([
        { conversation_id: conversationId, role: 'user', content: question },
        { conversation_id: conversationId, role: 'assistant', content: answer.answer },
      ]).then(() => undefined, () => undefined);
    }
    for (const item of answer.toolTrace) {
      await admin.from('ai_actions').insert({ conversation_id: conversationId, tool_name: item.tool, input_json: { question: question.slice(0, 200) }, result_summary: item.summary.slice(0, 500) }).then(() => undefined, () => undefined);
    }
    return NextResponse.json(answer);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The copilot could not complete the request.' }, { status: 400 });
  }
}
