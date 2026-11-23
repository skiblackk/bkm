import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { getAiProvider, resolveModel, aiStatus, chatCompletionsUrl } from '@/lib/ai-provider';
import { executeAgentTool, AGENT_TOOL_SPECS, type AgentProposal } from '@/lib/agent-tools';
import { createClient, updateClient } from '@/lib/data-access';
import { addServiceCharge } from '@/lib/data-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { recordAudit } from '@/lib/data-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The client-register agent.
 *
 * The user's ask was for something that behaves like "the brain of the system":
 * it asks for the client's details, works out whether the client is serviced by
 * BKM or paid by BKM, files everything itself — and can clean up broken records.
 *
 * The split is deliberate and is the whole safety story:
 *
 *   GET   — tells the panel whether a live model is actually configured.
 *   POST  — runs the conversation. The model may READ freely (find_client,
 *           client_health_report) but may only PROPOSE writes. A proposal
 *           comes back as a card with a confirm button.
 *   PUT   — applies a confirmed proposal. This is the only place a write
 *           happens, it re-checks permissions against the *human's* session,
 *           and it records an undoable entry in agent_actions.
 *
 * So the model can never write on its own initiative, and it cannot widen its
 * own access: every tool re-checks the caller's permissions.
 */

const SYSTEM_PROMPT = `You are the client-register agent in the BKM Operations Hub.

Goal: fill the client register by conversation, so staff never complete forms by hand.

Rules:
1. Ask one step at a time for what you still need: organisation name, industry, location,
   contact name, contact email, and what BKM does for or with them.
2. Always establish the money direction before proposing: does BKM service this
   organisation (BKM bills them, relationship 'serviced') or pay them (they supply BKM,
   relationship 'vendor')? Never guess.
3. Call find_client first to avoid duplicates. Call client_health_report when asked to
   check, repair or audit the register.
4. Use the propose_* tools to change anything. They never write; they produce a proposal
   a human confirms. Never invent a client, amount or contact.
5. Once you have the five details and the direction, propose the record. Do not ask for
   optional extras (phone, description) and never ask twice for the same thing.
6. When asked to fix or audit, report the faults found and propose the fix for each. Do
   not interrogate the user for data in reply to an audit request.
7. Be brief: one or two sentences, plus the single question you need answered.
8. NEVER propose deleting a record just because it is incomplete, empty or badly
   filled in. An incomplete record is repaired by proposing the missing details.
   Only propose deletion when the person explicitly asked to delete or remove
   something, and say what will be removed before you do.

Register facts come only from your tools. Do not claim to know anything you have not looked up.`;

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: unknown[]; tool_call_id?: string };

/**
 * Call the model, waiting out short rate limits.
 *
 * The hosted free tier allows 8000 tokens per minute, which a normal
 * conversation can brush against. Rather than failing the staff member's turn on
 * a limit that clears in seconds, the request is retried once after the delay
 * the provider asks for.
 */
async function callModel(provider: { baseUrl: string; apiKey: string }, body: Record<string, unknown>) {
  const send = (payload: Record<string, unknown>) => fetch(chatCompletionsUrl(provider.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify(payload),
  });

  let response = await send(body);
  if (response.status !== 429) return response;

  // Free tier: 8000 tokens/minute, counted per model. Waiting the advertised
  // delay usually clears it; if it does not, retry once on the smaller of the
  // known models, which has its own separate allowance. Either way the staff
  // member gets an answer instead of an error.
  const retryAfter = Number(response.headers.get('retry-after') ?? '');
  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15000) : 5000;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  response = await send(body);
  if (response.status !== 429) return response;

  const current = String(body.model ?? '');
  const alternative = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].find((id) => id !== current);
  if (!alternative) return response;
  return send({ ...body, model: alternative });
}

/**
 * Does the conversation already contain everything a client record needs?
 *
 * The model is asked to propose once it has the essentials, but in practice it
 * keeps finding one more optional thing to ask about — a phone number, a "brief
 * description" — and the staff member never gets their record. This check makes
 * the outcome deterministic: when the essentials are present, the assistant is
 * told firmly to file it now. It decides *when* to insist; the model still fills
 * in every field, and a human still confirms.
 */
function registerReady(history: Array<{ role: string; content: string }>) {
  const userText = history.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(userText);
  const hasDirection = /\b(bkm (pays|bills|services|charges)|we pay|they pay|supplier|vendor|servic\w*|bill\w*|monthly|retainer)\b/i.test(userText);
  const hasTrade = /\b(industr\w*|firm|company|business|logistics|security|freight|bank|insur\w*|manufactur\w*|retail|construction|health|school|ngo|consult\w*)\b/i.test(userText);
  return hasEmail && hasDirection && hasTrade;
}

async function requireAgentSession() {
  const session = await getDemoSession();
  if (!session) return { error: NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 }) } as const;
  if (!hasPermission(session, 'use_assistant')) return { error: NextResponse.json({ error: 'Permission required: use_assistant.' }, { status: 403 }) } as const;
  return { session } as const;
}

export async function GET() {
  const auth = await requireAgentSession();
  if ('error' in auth) return auth.error;
  const status = aiStatus();
  return NextResponse.json({
    ai: status,
    tools: AGENT_TOOL_SPECS.map((spec) => ({ name: spec.name, description: spec.description })),
    canWrite: auth.session.isAdmin || hasPermission(auth.session, 'manage_clients'),
  });
}

export async function POST(request: Request) {
  const auth = await requireAgentSession();
  if ('error' in auth) return auth.error;
  const { session } = auth;

  const provider = getAiProvider();
  if (!provider) {
    return NextResponse.json({
      error: 'No AI provider is configured, so the agent cannot hold a conversation yet. The register tools still work from the Clients screen.',
      configured: false,
    }, { status: 503 });
  }

  try {
    const input = await request.json() as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
    const history = (input.messages ?? [])
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-10)
      .map((message) => ({ role: message.role, content: String(message.content ?? '').slice(0, 4000) }));
    if (!history.length) return NextResponse.json({ error: 'Say something to start.' }, { status: 400 });

    const model = await resolveModel(provider);
    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];
    const trace: Array<{ tool: string; summary: string; denied?: boolean }> = [];
    let proposal: AgentProposal | null = null;
    // The model's own sentence about what it found. Kept so that running out of
    // tool rounds never costs the user the explanation — replacing it with a
    // generic "review the details" line hides exactly the useful part.
    let lastContent = '';
    // Three rounds is enough to look something up and then propose from it,
    // without letting a confused model spin.
    let insisted = false;
    for (let round = 0; round < 3; round += 1) {
      const response = await callModel(provider, {
        model,
        messages,
        tools: AGENT_TOOL_SPECS.map((spec) => ({ type: 'function', function: spec })),
        tool_choice: 'auto',
        temperature: 0.2,
      });

      if (!response.ok) {
        const detail = await response.text();
        // Friendliness matters more than detail here: a staff member should never
        // be shown a provider's rate-limit JSON. 429 is by far the most common
        // failure on the free tier (8000 tokens/minute).
        if (response.status === 429) {
          return NextResponse.json({
            error: 'The assistant is getting a lot of requests right now. Wait about a minute and try again — nothing you typed has been lost.',
          }, { status: 429 });
        }
        console.error('agent provider error', response.status, detail.slice(0, 500));
        return NextResponse.json({ error: 'The assistant could not reach its language model just now. Please try again in a moment.' }, { status: 502 });
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      };
      const message = payload.choices?.[0]?.message;
      if (!message) return NextResponse.json({ error: 'The AI provider returned an empty response.' }, { status: 502 });

      if (message.content) lastContent = message.content;
      if (!message.tool_calls?.length) {
        // Everything needed is already in the conversation but nothing has been
        // proposed: one more round with an explicit instruction, then accept
        // whatever comes back.
        const nothingProposed = !trace.some((item) => item.tool.startsWith('propose_'));
        if (!insisted && nothingProposed && registerReady(history)) {
          insisted = true;
          messages.push({ role: 'assistant', content: message.content ?? null });
          messages.push({
            role: 'user',
            content: 'That is all the detail I have. Please file it now: call propose_create_client with what I have given you. Leave anything I did not mention blank rather than asking me again.',
          });
          round -= 1; // the insistence round does not count against the budget
          continue;
        }
        return NextResponse.json({
          reply: message.content ?? '',
          proposals: proposal ? [proposal] : [],
          trace,
          model,
        });
      }

      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
      for (const call of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        const result = await executeAgentTool(call.function.name, args, session);
        trace.push({ tool: result.tool, summary: result.summary, denied: result.denied });
        if (result.proposal) proposal = result.proposal;
        // Tool output is fed back to a model with an 8000 token/minute budget, so
        // it is capped rather than dumping whole records into the conversation.
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            summary: String(result.summary).slice(0, 600),
            data: result.data === undefined ? undefined : JSON.parse(String(JSON.stringify(result.data)).slice(0, 1200)),
            denied: result.denied,
            pending: result.pending,
          }),
        });
      }
    }

    // A proposal on the table is a usable outcome even if the model ran out of
    // rounds before writing its sentence. Use its own explanation if it wrote one.
    const userText = history.filter((item) => item.role === 'user').map((item) => item.content).join('\n');
    const deleteWasAskedFor = /\b(delete|remove|discard|drop|de-?duplicate|duplicate)\b/i.test(userText);
    let finalProposal = proposal;
    let reply = lastContent.trim();

    // Guard rail. A model that reaches for "delete" to tidy an incomplete record
    // is doing something the user never asked for, and it is the one agent action
    // that can hide a real client. Incomplete records are repaired, not removed.
    if (finalProposal?.action === 'delete_client' && !deleteWasAskedFor) {
      finalProposal = null;
      reply = 'That record is incomplete rather than wrong, so I have not proposed removing it. Tell me the missing details and I will propose updating it instead — or say "delete it" if you really do want it gone.';
    }

    if (!reply) {
      reply = finalProposal
        ? `${finalProposal.label}. Review the details and confirm when you are happy.`
        : 'I gathered what I could but did not reach a conclusion. Try stating the organisation name and what BKM does for or with them.';
    }

    return NextResponse.json({
      reply,
      proposals: finalProposal ? [finalProposal] : [],
      trace,
      model,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The agent could not complete that.' }, { status: 500 });
  }
}

/**
 * Apply a confirmed proposal.
 *
 * This is the only code path in the agent that writes. It re-checks the human's
 * permissions, performs the write through the same atomic functions the manual
 * forms use, and records an entry that can be undone.
 */
export async function PUT(request: Request) {
  const auth = await requireAgentSession();
  if ('error' in auth) return auth.error;
  const { session } = auth;
  if (!session.isAdmin && !hasPermission(session, 'manage_clients')) {
    return NextResponse.json({ error: 'Permission required: manage_clients.' }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });

  try {
    const input = await request.json() as { proposal?: { action?: string; payload?: Record<string, unknown> } };
    const action = String(input.proposal?.action ?? '');
    const payload = (input.proposal?.payload ?? {}) as Record<string, unknown>;
    const actor = { id: session.staffId ?? session.account, name: session.name, role: session.role };
    const str = (key: string) => String(payload[key] ?? '').trim();

    const log = async (entry: { action: string; targetType: string; targetId: string; summary: string; reversible: boolean; undoPayload?: Record<string, unknown> }) => {
      await admin.from('agent_actions').insert({
        actor_id: actor.id,
        actor_name: actor.name,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        summary: entry.summary,
        reversible: entry.reversible,
        undo_payload: entry.undoPayload ?? null,
      }).then(() => undefined, () => undefined);
    };

    if (action === 'create_client') {
      const name = str('name');
      if (!name) return NextResponse.json({ error: 'The proposal has no organisation name.' }, { status: 400 });
      const missing = ['industry', 'location', 'contactName', 'contactEmail'].filter((key) => !str(key));
      if (missing.length) return NextResponse.json({ error: `Still needed before this can be saved: ${missing.join(', ')}.` }, { status: 422 });

      const snapshot = await createClient({
        name,
        industry: str('industry'),
        location: str('location'),
        contactName: str('contactName'),
        contactEmail: str('contactEmail'),
        contactPhone: str('contactPhone'),
        description: str('description') || undefined,
      }, actor);

      const created = snapshot.clients.find((client) => client.name.toLowerCase() === name.toLowerCase());

      // Categorise the record and record what is being paid for, in the same
      // breath — this is the part the user asked to be automatic.
      if (created) {
        const relationship = str('relationship') === 'vendor' ? 'vendor' : 'serviced';
        await admin.rpc('bkm_set_client_relationship', {
          p_actor_id: actor.id, p_actor_name: actor.name, p_actor_role: actor.role,
          p_client_id: created.id, p_relationship_type: relationship,
        }).then(() => undefined, () => undefined);

        const amount = Number(String(payload.amount ?? '').replace(/[^0-9.]/g, ''));
        if (str('serviceName') && Number.isFinite(amount) && amount > 0) {
          await addServiceCharge({
            clientId: created.id,
            serviceName: str('serviceName'),
            direction: relationship === 'vendor' ? 'payable' : 'receivable',
            amount,
            billingFrequency: str('billingFrequency') || 'monthly',
          }, actor).catch(() => undefined);
        }
      }

      await log({
        action: 'agent_create_client', targetType: 'Client', targetId: created?.id ?? name,
        summary: `Created ${name} as ${str('relationship') === 'vendor' ? 'paid by BKM' : 'serviced by BKM'}`,
        reversible: Boolean(created), undoPayload: created ? { clientId: created.id } : undefined,
      });
      await recordAudit({
        actorId: actor.id, actorName: actor.name, actorRole: actor.role, action: 'agent_create_client',
        targetType: 'Client', targetId: created?.id ?? name, detail: `Agent created ${name}`, severity: 'change',
      }).catch(() => undefined);

      return NextResponse.json({
        message: `${name} created and filed as ${str('relationship') === 'vendor' ? 'paid by BKM' : 'serviced by BKM'}.`,
        clientId: created?.id ?? null,
        snapshot,
      });
    }

    if (action === 'update_client') {
      const clientId = str('clientId');
      const patch = (payload.patch ?? {}) as Record<string, string>;
      if (!clientId || !Object.keys(patch).length) return NextResponse.json({ error: 'The proposal has nothing to change.' }, { status: 400 });
      const { data: before } = await admin.from('clients').select('*').eq('id', clientId).maybeSingle();
      if (!before) return NextResponse.json({ error: 'That client record no longer exists.' }, { status: 404 });

      const snapshot = await updateClient(clientId, {
        name: patch.name, industry: patch.industry, location: patch.location, description: patch.description,
        status: patch.status as 'Active' | 'On hold' | 'Archived' | undefined,
      }, actor);

      await log({
        action: 'agent_update_client', targetType: 'Client', targetId: clientId,
        summary: `Changed ${Object.keys(patch).join(', ')} on ${before.name}`,
        reversible: true, undoPayload: { clientId, previous: before },
      });
      return NextResponse.json({ message: `${before.name} updated.`, clientId, snapshot });
    }

    if (action === 'delete_client') {
      const clientId = str('clientId');
      const { data: before } = await admin.from('clients').select('id, name, deleted_at').eq('id', clientId).maybeSingle();
      if (!before) return NextResponse.json({ error: 'That client record no longer exists.' }, { status: 404 });
      if (before.deleted_at) return NextResponse.json({ message: `${before.name} was already removed.` });

      // Soft delete: hidden from the register, fully recoverable.
      const { error } = await admin.from('clients').update({
        deleted_at: new Date().toISOString(),
        deleted_by: actor.id,
        deleted_reason: str('reason').slice(0, 500),
      }).eq('id', clientId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await log({
        action: 'agent_delete_client', targetType: 'Client', targetId: clientId,
        summary: `Removed ${before.name}${str('reason') ? ` — ${str('reason')}` : ''}`,
        reversible: true, undoPayload: { clientId, name: before.name },
      });
      await recordAudit({
        actorId: actor.id, actorName: actor.name, actorRole: actor.role, action: 'agent_delete_client',
        targetType: 'Client', targetId: clientId, detail: `Agent removed ${before.name}`, severity: 'security',
      }).catch(() => undefined);

      return NextResponse.json({ message: `${before.name} removed. It can be restored.`, undo: { action: 'restore_client', payload: { clientId } } });
    }

    if (action === 'restore_client') {
      const clientId = str('clientId');
      const { data: before } = await admin.from('clients').select('id, name').eq('id', clientId).maybeSingle();
      if (!before) return NextResponse.json({ error: 'That record no longer exists.' }, { status: 404 });
      const { error } = await admin.from('clients').update({ deleted_at: null, deleted_by: null, deleted_reason: '' }).eq('id', clientId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await log({ action: 'agent_restore_client', targetType: 'Client', targetId: clientId, summary: `Restored ${before.name}`, reversible: false });
      return NextResponse.json({ message: `${before.name} restored to the register.` });
    }

    return NextResponse.json({ error: 'That proposal type is not recognised.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The change could not be applied.' }, { status: 400 });
  }
}
