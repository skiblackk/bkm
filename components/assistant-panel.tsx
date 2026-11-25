'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle, CheckCircle2, Download, FileSpreadsheet, History, ListChecks, Loader2,
  Plus, ScanLine, Send,
} from 'lucide-react';
import AiAnswer from './ai-answer';
import AssistantDocumentAction, { type AssistantScan } from './assistant-document-action';
import { Badge, PageTitle, SectionHeader } from './ui';

/**
 * The work assistant.
 *
 * Pulled out of workspace-app.tsx so it can own its conversation. It previously
 * kept every message in React state, which meant navigating to another screen
 * threw the conversation away — the panel now restores the last conversation on
 * mount and keeps a list of past ones.
 */
export default function AssistantPanel({ clients, counts }: { clients: Array<{ id: string; name: string }>; counts: { engagements: number; tasks: number; activities: number } }) {
  type Message = { role: 'user' | 'assistant'; content: string; tool?: string; scan?: AssistantScan; documentId?: string };
  type ScanStatus = { phase: 'uploading' | 'scanning' | 'complete' | 'failed'; filename?: string; progress?: number; message?: string };
  const [question, setQuestion] = useState(''); const [loading, setLoading] = useState(false); const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const opening: Message = { role: 'assistant', content: 'Ask about BKM records or attach a client document for a review.' };
  const [messages, setMessages] = useState<Message[]>([opening]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; title: string; messageCount: number }>>([]);
  const [showHistory, setShowHistory] = useState(false);

  /**
   * Reopen the last conversation instead of an empty screen.
   *
   * Everything said here used to live only in React state, so leaving the view
   * destroyed it — the single most irritating thing about this panel. Each turn
   * is written to the conversation store now, and this puts it back, document
   * scans included.
   */
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const [latestResponse, listResponse] = await Promise.all([
          fetch('/api/assistant/history?latest=1', { cache: 'no-store' }),
          fetch('/api/assistant/history', { cache: 'no-store' }),
        ]);
        const list = await listResponse.json();
        if (!cancelled && Array.isArray(list?.conversations)) setHistory(list.conversations);
        const latest = await latestResponse.json();
        if (cancelled || !latest?.conversationId || !Array.isArray(latest.messages) || !latest.messages.length) return;
        setConversationId(latest.conversationId);
        setMessages(latest.messages.map((message: { role: string; content: string; metadata?: { scan?: AssistantScan; tool?: string } | null }) => ({
          role: message.role === 'user' ? 'user' as const : 'assistant' as const,
          content: message.content,
          tool: message.metadata?.tool,
          scan: message.metadata?.scan,
        })));
      } catch { /* a missing history must never stop the panel working */ }
    };
    void restore();
    return () => { cancelled = true; };
  }, []);

  const openConversation = async (id: string) => {
    setShowHistory(false);
    try {
      const response = await fetch(`/api/assistant/history?conversationId=${id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.messages) || !payload.messages.length) return;
      setConversationId(id);
      setMessages(payload.messages.map((message: { role: string; content: string; metadata?: { scan?: AssistantScan; tool?: string } | null }) => ({
        role: message.role === 'user' ? 'user' as const : 'assistant' as const,
        content: message.content,
        tool: message.metadata?.tool,
        scan: message.metadata?.scan,
      })));
    } catch { /* ignore: the panel stays usable */ }
  };

  const startNew = () => { setShowHistory(false); setConversationId(null); setMessages([opening]); };
  const suggestions = ['Which audits are approaching their deadlines?', 'Show me overdue work', 'Create a task to request the bank confirmations', 'Build a balance sheet from the uploaded workbook'];
  const attached = messages.filter((item) => item.scan).map((item) => item.scan!).pop();
  const ask = async (value = question) => { if (!value.trim() || loading) return; setMessages((items) => [...items, { role: 'user', content: value }]); setQuestion(''); setLoading(true); try { const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: value, documentId: attached?.id, conversationId }) }); const payload = await response.json(); if (payload.conversationId) setConversationId(payload.conversationId); setMessages((items) => [...items, { role: 'assistant', content: payload.answer ?? payload.error ?? 'The assistant returned no answer.', tool: payload.tool }]); } catch { setMessages((items) => [...items, { role: 'assistant', content: 'The assistant could not be reached. Check the connection and try again.' }]); } finally { setLoading(false); } };
  const handleScan = (scan: AssistantScan) => {
    const content = `${scan.summary}\n\nAsk me for a balance sheet, the ledger, a profit and loss or a summary of this file.`;
    setMessages((items) => [...items, { role: 'assistant', tool: 'document_analysis', content, scan }]);
    // A scan result is a card, not prose — stored as metadata so it survives a
    // reload instead of degrading into a paragraph of text.
    void fetch('/api/assistant/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, role: 'assistant', content, metadata: { tool: 'document_analysis', scan } }) })
      .then((response) => response.json())
      .then((payload) => { if (payload?.conversationId) setConversationId(payload.conversationId); })
      .catch(() => undefined);
  };
  const downloadScanReport = async (scan: AssistantScan, format: 'pdf' | 'xlsx') => { const response = await fetch('/api/exports/document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scan, format }) }); if (!response.ok) return; const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${scan.filename.replace(/[^a-z0-9._-]/gi, '_')}-scan.${format === 'xlsx' ? 'xlsx' : 'pdf'}`; link.click(); URL.revokeObjectURL(url); };
  return <div className="space-y-5"><PageTitle eyebrow="Work support" title="Work assistant" description="Ask a question, give an instruction or attach a file to review your work." action={<Badge tone="teal">Ready</Badge>} /><div className="grid gap-5 xl:grid-cols-[1fr_320px]"><div className="panel flex min-h-[620px] flex-col overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700"></span><div><div className="text-sm font-semibold">BKM work assistant</div><div className="text-[11px] text-slate-400">Records · Excel · task preparation</div></div></div><div className="flex items-center gap-2"><button type="button" data-testid="assistant-history-toggle" onClick={() => setShowHistory((value) => !value)} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300 hover:text-teal-700"><History size={12} /> Past chats{history.length ? ` (${history.length})` : ''}</button><button type="button" data-testid="assistant-new-chat" onClick={startNew} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300 hover:text-teal-700"><Plus size={12} /> New</button><span className="text-[10px] font-semibold text-emerald-700">Online</span></div></div>{showHistory && <div data-testid="assistant-history" className="border-b border-line bg-canvas px-5 py-3">{history.length === 0 ? <p className="text-[11px] text-slate-500">No past conversations yet. Anything you say here is kept, so you can leave and come back to it.</p> : <ul className="max-h-56 space-y-1 overflow-y-auto">{history.map((item) => <li key={item.id}><button type="button" data-testid="assistant-history-item" onClick={() => void openConversation(item.id)} className={`flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left text-[11px] transition ${item.id === conversationId ? 'border-teal-300 bg-white font-semibold text-teal-800' : 'border-transparent bg-white/60 text-slate-600 hover:border-line hover:bg-white'}`}><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="shrink-0 text-[10px] text-slate-400">{item.messageCount} message{item.messageCount === 1 ? '' : 's'}</span></button></li>)}</ul>}</div>}<div className="flex-1 space-y-5 overflow-y-auto p-5">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}><div className={`max-w-[88%] ${message.role === 'user' ? 'order-1' : ''}`}>{message.role === 'assistant' && <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-700"> BKM work assistant {message.tool && <><span className="text-slate-300">·</span><span className="font-normal normal-case tracking-normal text-slate-400">Action: {message.tool}</span></>}</div>}{message.role === 'user' ? <div className="whitespace-pre-line rounded-2xl rounded-br-sm bg-teal-700 px-4 py-3 text-sm leading-6 text-white">{message.content}</div> : <div className="rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-3.5 shadow-sm"><AiAnswer text={message.content} compact /></div>}{message.scan && <div className="mt-2 overflow-hidden rounded-xl border border-teal-100 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 bg-teal-50/60 px-3 py-2"><div className="flex min-w-0 items-center gap-2"><CheckCircle2 size={14} className="shrink-0 text-teal-700" /><span className="truncate text-xs font-semibold text-teal-900">{message.scan.filename}</span><span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-teal-700">{message.scan.status}</span></div><div className="flex items-center gap-1"><button type="button" onClick={() => void downloadScanReport(message.scan!, 'pdf')} className="flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-1 text-[9px] font-semibold text-teal-800 hover:border-teal-400"><Download size={10} /> PDF</button><button type="button" onClick={() => void downloadScanReport(message.scan!, 'xlsx')} className="flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-1 text-[9px] font-semibold text-teal-800 hover:border-teal-400"><Download size={10} /> Excel</button></div></div><div className="space-y-3 p-3"><p className="text-xs leading-5 text-slate-600">{message.scan.summary}</p><div className="grid gap-2 sm:grid-cols-3">{message.scan.keyFields.slice(0, 3).map((field) => <div key={field.label} className="rounded-md bg-canvas px-2.5 py-2"><div className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">{field.label}</div><div className="mt-1 text-xs font-semibold text-navy">{field.value}</div></div>)}</div>{message.scan.transactions.length > 0 && <div><div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Extracted transactions</div><div className="max-h-32 overflow-auto rounded-md border border-line">{message.scan.transactions.slice(0, 5).map((row, rowIndex) => <div key={`${row.date}-${rowIndex}`} className="grid grid-cols-[75px_1fr_90px] gap-2 border-b border-line px-2.5 py-2 text-[10px] last:border-0"><span className="text-slate-400">{row.date || '—'}</span><span className="truncate font-semibold text-slate-700">{row.description || 'Unlabelled row'}</span><span className="text-right tabular text-navy">{row.amount || '—'}</span></div>)}</div></div>}{message.scan.warnings.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900"><span className="font-bold">Check before posting:</span> {message.scan.warnings.join(' ')}</div>}</div></div>}</div></div>)}{loading && <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-teal-700"><Loader2 size={14} className="animate-spin" /></span><div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Retrieving records</div><div className="mt-1 flex items-center gap-1 text-teal-600"><Loader2 size={12} className="animate-spin" /><span className="text-[10px]">Working through live records</span></div></div></div>}{scanStatus && scanStatus.phase !== 'complete' && <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-xs ${scanStatus.phase === 'failed' ? 'border-red-200 bg-red-50 text-red-800' : 'border-teal-100 bg-teal-50 text-teal-800'}`}><ScanLine size={14} className={scanStatus.phase === 'scanning' ? 'animate-pulse' : ''} /><div className="min-w-0 flex-1"><div className="font-semibold">{scanStatus.message}</div>{scanStatus.filename && <div className="truncate text-[10px] opacity-70">{scanStatus.filename}</div>}</div>{scanStatus.progress != null && <span className="font-mono text-[10px]">{scanStatus.progress}%</span>}</div>}</div><div className="border-t border-line p-4"><div className="mb-3 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)} className="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300 hover:text-teal-700">{suggestion}</button>)}</div><AssistantDocumentAction clients={clients} onStatus={setScanStatus} onScan={handleScan} /><div className="flex items-end gap-2 border border-line bg-white p-2 focus-within:border-teal-400"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); } }} placeholder="Ask about clients, tasks, deadlines or workload…" className="min-h-[42px] flex-1 resize-none px-2 py-2 text-sm outline-none placeholder:text-slate-400" /><button onClick={() => ask()} disabled={!question.trim() || loading} className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white disabled:opacity-40"><Send size={15} /></button></div></div></div><div className="space-y-5"><div className="panel p-5"><SectionHeader eyebrow="How it works" title="How it works" /><div className="space-y-3 text-xs leading-5 text-slate-600"><div className="flex gap-2.5"><CheckCircle size={15} className="mt-0.5 shrink-0 text-teal-700" /><span>Questions use current records and clear instructions.</span></div><div className="flex gap-2.5"><FileSpreadsheet size={15} className="mt-0.5 shrink-0 text-teal-700" /><span>PDF, CSV, TXT and Excel files can be reviewed, including large workbooks.</span></div><div className="flex gap-2.5"><ListChecks size={15} className="mt-0.5 shrink-0 text-teal-700" /><span>Tasks and reports can be prepared here; final records and messages remain in the normal BKM workflow.</span></div></div></div><div className="panel p-5"><SectionHeader eyebrow="Available context" title="Live record coverage" /><div className="space-y-3">{[['Clients', clients.length], ['Engagements', counts.engagements], ['Tasks', counts.tasks], ['Activity events', counts.activities]].map(([label, value]) => <div key={label as string} className="flex items-center justify-between border-b border-line pb-2 text-xs last:border-0 last:pb-0"><span className="text-slate-500">{label}</span><span className="font-semibold tabular">{value}</span></div>)}</div></div></div></div></div>;
}
