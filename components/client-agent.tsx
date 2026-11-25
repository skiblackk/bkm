'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Send, Sparkles, TriangleAlert, Undo2, X, History, Plus } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

type Proposal = {
  action: string;
  label: string;
  payload: Record<string, unknown>;
};

type Status = 'pending' | 'saving' | 'done' | 'rejected' | 'failed';

/**
 * Conversational client-register agent.
 *
 * The whole point is that staff should not have to fill in a nine-field form to
 * add a client, nor remember to classify it as serviced or payable. You talk to
 * it, it works out which way the money runs, and it files the record.
 *
 * It never writes on its own: every write appears as a proposal card with a
 * Confirm button. That is not decoration — it is the only thing standing between
 * a language model and your register.
 */
export default function ClientAgent({ onChanged }: { onChanged: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([{
    role: 'assistant',
    content: 'Tell me about the organisation and I will file it. Start with the name — for example "Harbour Logistics Ltd". I will ask for the rest, including whether BKM services them or pays them.',
  }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<{ action: string; payload: Record<string, unknown> } | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; title: string; updatedAt: string; messageCount: number }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Open onto the last conversation rather than a blank screen.
   *
   * Leaving this page used to discard everything that had been said, so coming
   * back meant starting an interview over. The conversation is stored per person
   * now and reopens where it stopped, pending proposal cards included.
   */
  const restore = async () => {
    try {
      const [latestResponse, listResponse] = await Promise.all([
        fetch('/api/agent?latest=1', { cache: 'no-store' }),
        fetch('/api/agent', { cache: 'no-store' }),
      ]);
      const list = await listResponse.json();
      setAiReady(Boolean(list?.ai?.configured));
      setHistory(Array.isArray(list?.conversations) ? list.conversations : []);
      const latest = await latestResponse.json();
      if (latest?.conversationId && Array.isArray(latest.messages) && latest.messages.length) {
        setConversationId(latest.conversationId);
        setMessages(latest.messages.map((message: { role: string; content: string; metadata?: { proposal?: Proposal } | null }) => ({
          role: message.role === 'user' ? 'user' as const : 'assistant' as const,
          content: message.content,
        })));
        // A proposal that was waiting to be confirmed is still waiting.
        const pending = latest.messages
          .map((message: { metadata?: { proposal?: Proposal } | null }) => message.metadata?.proposal)
          .filter(Boolean) as Proposal[];
        if (pending.length) setProposals(pending);
      }
    } catch {
      setAiReady(false);
    }
  };

  useEffect(() => { void restore(); }, []);

  const openConversation = async (id: string) => {
    setShowHistory(false);
    setProposals([]);
    try {
      const response = await fetch(`/api/agent?conversationId=${id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) return;
      setConversationId(payload.conversationId ?? id);
      setMessages((payload.messages ?? []).map((message: { role: string; content: string }) => ({
        role: message.role === 'user' ? 'user' as const : 'assistant' as const,
        content: message.content,
      })));
    } catch {
      setError('That conversation could not be opened.');
    }
  };

  const startNew = () => {
    setShowHistory(false);
    setConversationId(null);
    setProposals([]);
    setNotice('');
    setError('');
    setMessages([{ role: 'assistant', content: 'Tell me about the organisation and I will file it. Start with the name — for example "Harbour Logistics Ltd". I will ask for the rest, including whether BKM services them or pays them.' }]);
  };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async (value = input) => {
    const text = value.trim();
    if (!text || busy) return;
    setError(''); setNotice('');
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the new message once the conversation is stored server-side; the
        // server already holds the rest. Sending the whole transcript again
        // duplicated every earlier turn in the history.
        body: JSON.stringify(conversationId ? { conversationId, message: text } : { messages: next }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'The agent could not answer.');
        return;
      }
      setMessages((items) => [...items, { role: 'assistant', content: payload.reply || 'I did not have a reply.' }]);
      if (payload.conversationId) setConversationId(payload.conversationId);
      if (payload.proposals?.length) setProposals((items) => [...items, ...payload.proposals]);
    } catch {
      setError('The agent could not be reached. Check the connection and try again.');
    } finally { setBusy(false); }
  };

  const confirmProposal = async (proposal: Proposal) => {
    const key = proposalKey(proposal);
    setStatus((current) => ({ ...current, [key]: 'saving' }));
    setError(''); setNotice('');
    try {
      const response = await fetch('/api/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus((current) => ({ ...current, [key]: 'failed' }));
        setError(payload.error ?? 'That change could not be saved.');
        return;
      }
      setStatus((current) => ({ ...current, [key]: 'done' }));
      setNotice(payload.message ?? 'Saved.');
      if (payload.undo) setUndo(payload.undo);
      setMessages((items) => [...items, { role: 'assistant', content: payload.message ?? 'Done.' }]);
      onChanged();
    } catch {
      setStatus((current) => ({ ...current, [key]: 'failed' }));
      setError('That change could not be saved.');
    }
  };

  const runUndo = async () => {
    if (!undo) return;
    const response = await fetch('/api/agent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal: undo }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setNotice(payload.message ?? 'Undone.'); setUndo(null); onChanged(); }
    else setError(payload.error ?? 'That could not be undone.');
  };

  const suggestions = ['We have a new supplier called Harbour Logistics', 'Check the register for broken or incomplete records', 'What needs fixing on our client records?'];

  return <div className="panel flex min-h-[560px] flex-col overflow-hidden" data-testid="client-agent">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><Bot size={17} /></span>
        <div>
          <div className="text-sm font-semibold">Client register agent</div>
          <div className="text-[11px] text-slate-400">Files records, classifies them, finds broken ones</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {aiReady === false
          ? <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800"><TriangleAlert size={11} /> No model</span>
          : <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live</span>}
        <button type="button" data-testid="agent-history-toggle" onClick={() => setShowHistory((value) => !value)} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300 hover:text-teal-700">
          <History size={12} /> Past chats{history.length ? ` (${history.length})` : ''}
        </button>
        <button type="button" data-testid="agent-new-chat" onClick={startNew} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300 hover:text-teal-700">
          <Plus size={12} /> New
        </button>
      </div>
    </div>

    {showHistory && (
      <div data-testid="agent-history" className="border-b border-line bg-canvas px-5 py-3">
        {history.length === 0 ? (
          <p className="text-[11px] text-slate-500">No past conversations yet. Anything you say here is kept, so you can leave and come back to it.</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid="agent-history-item"
                  onClick={() => void openConversation(item.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left text-[11px] transition ${item.id === conversationId ? 'border-teal-300 bg-white font-semibold text-teal-800' : 'border-transparent bg-white/60 text-slate-600 hover:border-line hover:bg-white'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{item.messageCount} message{item.messageCount === 1 ? '' : 's'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )}

    <div className="flex-1 space-y-4 overflow-y-auto p-5">
      {messages.map((message, index) => (
        <div key={`${message.role}-${index}`} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
          <div className={`max-w-[88%] ${message.role === 'assistant' ? '' : 'order-1'}`}>
            {message.role === 'assistant' && <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-700">Register agent</div>}
            {message.role === 'user'
              ? <div className="whitespace-pre-line rounded-2xl rounded-br-sm bg-teal-700 px-4 py-3 text-sm leading-6 text-white">{message.content}</div>
              : <div className="whitespace-pre-line rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-3.5 text-sm leading-6 text-slate-700 shadow-sm">{message.content}</div>}
          </div>
        </div>
      ))}

      {proposals.filter((proposal) => status[proposalKey(proposal)] !== 'done' && status[proposalKey(proposal)] !== 'rejected').map((proposal) => {
        const key = proposalKey(proposal);
        const state = status[key] ?? 'pending';
        return <div key={key} className="rounded-xl border border-teal-200 bg-teal-50/50 p-4" data-testid="agent-proposal">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-teal-800"><Sparkles size={12} /> Proposed change</div>
              <div className="mt-1 text-sm font-semibold text-navy">{proposal.label}</div>
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-teal-700">Needs your confirmation</span>
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
            {Object.entries(proposal.payload)
              .filter(([key_]) => !['clientId', 'patch', 'current', 'missing'].includes(key_))
              .map(([key_, value]) => value === '' || value === null || value === undefined ? null : (
                <div key={key_} className="flex gap-1.5"><dt className="text-slate-400">{key_.replace(/([A-Z])/g, ' $1').toLowerCase()}:</dt><dd className="font-semibold text-slate-700">{String(value)}</dd></div>
              ))}
          </dl>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" data-testid="agent-confirm" disabled={state === 'saving'} onClick={() => void confirmProposal(proposal)} className="flex items-center gap-1.5 rounded-md bg-navy px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">
              {state === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Confirm and save
            </button>
            <button type="button" data-testid="agent-reject" onClick={() => setStatus((current) => ({ ...current, [key]: 'rejected' }))} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-[11px] font-semibold text-slate-600"><X size={12} /> Discard</button>
            <span className="text-[10px] text-slate-400">Nothing is saved until you confirm.</span>
          </div>
        </div>;
      })}

      {busy && <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-teal-700"><Loader2 size={14} className="animate-spin" /></span><span className="text-[11px] text-slate-500">Reading the register…</span></div>}
      <div ref={endRef} />
    </div>

    {notice && <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800" data-testid="agent-notice">
      <CheckCircle2 size={13} /> {notice}
      {undo && <button type="button" onClick={() => void runUndo()} className="ml-auto flex items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-1 text-[10px] font-bold text-emerald-800"><Undo2 size={11} /> Undo</button>}
    </div>}
    {error && <div className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="agent-error">{error}</div>}

    <div className="border-t border-line p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)} className="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300 hover:text-teal-700">{suggestion}</button>)}
      </div>
      <div className="flex items-end gap-2 border border-line bg-white p-2 focus-within:border-teal-400">
        <textarea
          data-testid="agent-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}
          placeholder="Name a new supplier or client, or ask me to check the register…"
          className="min-h-[42px] flex-1 resize-none px-2 py-2 text-sm outline-none placeholder:text-slate-400"
        />
        <button type="button" data-testid="agent-send" onClick={() => void send()} disabled={!input.trim() || busy} className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white disabled:opacity-40"><Send size={15} /></button>
      </div>
    </div>
  </div>;
}

/** A stable key per proposal, including its payload, so two proposals of the
 *  same action on the same client stay distinguishable. */
function proposalKey(proposal: Proposal): string {
  return `${proposal.action}:${JSON.stringify(proposal.payload).slice(0, 120)}`;
}
