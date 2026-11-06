import { NextResponse } from 'next/server';
import { businessDate } from '@/lib/business-clock';
import { getDemoSession, hasPermission, type DemoSession } from '@/lib/auth';
import { executeTool, TOOL_SPECS, resolvePeriod } from '@/lib/copilot-tools';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

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
  const baseUrl = process.env.BUILT_IN_FORGE_API_URL || process.env.OPENAI_API_BASE;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.AI_MODEL || 'gpt-5-mini';
  if (!baseUrl || !apiKey) return null;
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: `You are the BKM Management Copilot for ${session.name}. Answer from the approved tools only — never invent people, attendance, tasks or figures. When a tool reports a denial, explain that the user lacks permission instead of guessing. Dates use Africa/Nairobi. Distinguish confirmed facts from possible explanations. Consequential actions come back as drafts requiring confirmation.` },
    ...history.slice(-8).map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: question },
  ];
  const trace: CopilotAnswer['toolTrace'] = [];
  const scope: string[] = [];
  for (let round = 0; round < 4; round += 1) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
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
  return { answer: 'The conversation reached the tool-call limit before a final answer. Narrow the question and try again.', engine: 'llm-tool-calling', toolTrace: trace, scope: Array.from(new Set(scope)), followUps: [], conversationId: null };
}

export async function GET(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  const admin = db();
  if (conversationId) {
    const { data: messages } = await admin.from('ai_messages').select('id, role, content, created_at').eq('conversation_id', conversationId).order('created_at');
    return NextResponse.json({ messages: messages ?? [] });
  }
  const { data: conversations } = await admin.from('ai_conversations').select('id, title, created_at').eq('profile_id', session.account).order('created_at', { ascending: false }).limit(20);
  return NextResponse.json({ conversations: conversations ?? [] });
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
    try {
      answer = await llmAnswer(question, session, history);
    } catch {
      answer = null;
    }
    if (!answer) answer = await routeQuestion(question, session, history.map((h) => h.content));
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
