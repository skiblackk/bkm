'use client';

import { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle2, History, Loader2, Lock, Plus, Send, Sparkles, Table2, X } from 'lucide-react';
import AiAnswer from './ai-answer';

type TraceItem = { tool: string; summary: string; denied?: boolean; requiresConfirmation?: boolean; draft?: unknown };
type Message = { role: 'user' | 'assistant'; content: string; toolTrace?: TraceItem[]; scope?: string[]; followUps?: string[]; engine?: string };
type Conversation = { id: string; title: string; created_at: string };

const starters = [
  'Give me today’s staff attendance summary.',
  'Who has been arriving late this month?',
  'What requires my attention?',
  'Show me overdue tasks and who holds them.',
  'Identify outstanding approvals.',
  'Check the system’s health.',
];

export default function AdminAiCopilot() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/copilot');
      const result = await response.json();
      if (response.ok) setConversations(result.conversations ?? []);
    } catch { /* history is optional */ }
  };
  useEffect(() => { void loadHistory(); }, []);

  const ask = async (value = question) => {
    const text = value.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setQuestion('');
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, conversationId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Copilot request failed.');
      if (result.conversationId) setConversationId(result.conversationId);
      setMessages([...next, { role: 'assistant', content: result.answer, toolTrace: result.toolTrace, scope: result.scope, followUps: result.followUps, engine: result.engine }]);
      void loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The management copilot is unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const openConversation = async (id: string) => {
    setShowHistory(false);
    setBusy(true);
    try {
      const response = await fetch(`/api/copilot?conversationId=${id}`);
      const result = await response.json();
      if (response.ok) {
        setConversationId(id);
        setMessages((result.messages ?? []).map((m: { role: string; content: string }) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })));
      }
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-navy/15 bg-white p-5 shadow-deep">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700"><BrainCircuit size={14} /> Management copilot</div>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-navy">Ask about the company — real records, real answers</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Attendance, workload, approvals, audit activity and system health — investigated live from BKM records with your permissions. It never invents activity and never executes an action without your confirmation.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setMessages([]); setConversationId(null); setError(''); }} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:border-gold hover:bg-gold/10"><Plus size={12} /> New conversation</button>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:border-gold hover:bg-gold/10"><History size={12} /> History</button>
        </div>
      </div>

      {showHistory && (
        <div className="mt-3 rounded-xl border border-line bg-canvas/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Recent conversations</div>
          {conversations.length === 0 && <div className="mt-2 text-xs text-slate-500">No conversations yet.</div>}
          <div className="mt-2 space-y-1">
            {conversations.map((c) => (
              <button key={c.id} type="button" onClick={() => void openConversation(c.id)} className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-gold/10">{c.title || 'Conversation'}</button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {messages.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {starters.map((starter) => (
              <button key={starter} type="button" onClick={() => void ask(starter)} className="rounded-xl border border-line bg-canvas/50 px-3 py-3 text-left text-xs font-semibold text-slate-600 transition hover:border-gold hover:bg-gold/10">{starter}</button>
            ))}
          </div>
        )}
        {messages.map((message, index) => message.role === 'user' ? (
          <div key={index} className="ml-auto max-w-3xl rounded-xl bg-navy px-4 py-3 text-xs leading-5 text-white">{message.content}</div>
        ) : (
          <div key={index} className="max-w-4xl rounded-xl border border-line bg-canvas/50 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-teal-700"><Sparkles size={13} /> Copilot {message.engine && <span className="font-normal normal-case tracking-normal text-slate-400">· {message.engine}</span>}</div>
            <div className="mt-2"><AiAnswer text={message.content} /></div>
            {message.toolTrace?.length ? (
              <div className="mt-3">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400"><Table2 size={11} /> Data used</div>
                <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-600">
                  {message.toolTrace.map((item, i) => (
                    <li key={i} className={`flex gap-2 ${item.denied ? 'text-red-600' : ''}`}>
                      {item.denied ? <Lock size={13} className="mt-1 shrink-0" /> : <CheckCircle2 size={13} className="mt-1 shrink-0 text-emerald-600" />}
                      <span><strong className="font-semibold">{item.tool.replace(/_/g, ' ')}</strong> — {item.summary}{item.requiresConfirmation ? ' · awaiting your confirmation' : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {message.scope?.length ? <div className="mt-2 text-[10px] text-slate-400">Scope: {message.scope.join(' · ')}</div> : null}
            {message.followUps?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {message.followUps.map((f) => (
                  <button key={f} type="button" onClick={() => void ask(f)} className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100">{f}</button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {busy && <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 size={14} className="animate-spin" /> Investigating the records…</div>}
      {error && <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><span>{error}</span><button type="button" onClick={() => setError('')}><X size={13} /></button></div>}

      <div className="mt-4 flex gap-2">
        <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void ask(); }} placeholder="Ask anything about attendance, work, approvals or the system…" className="h-11 min-w-0 flex-1 rounded-xl border border-line px-3 text-xs outline-none focus:border-teal-600" />
        <button type="button" disabled={busy || !question.trim()} onClick={() => void ask()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-4 text-xs font-bold text-white disabled:opacity-40"><Send size={14} /> Ask</button>
      </div>
    </section>
  );
}
