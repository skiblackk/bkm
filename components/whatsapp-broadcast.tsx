'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, CheckCheck, Copy, ExternalLink, Loader2, MessageCircle, PhoneOff, Send, Smartphone, Users, X,
} from 'lucide-react';

/**
 * Broadcasting to staff who are not in the system.
 *
 * There is no WhatsApp Business provider attached to this workspace, so nothing
 * can be sent by the server. Instead the message is prepared once, addressed
 * person by person, and opened chat by chat from the administrator's own
 * WhatsApp — which is exactly what "sent from my number" means in practice.
 *
 * Nothing is reported as delivered. A chat is marked reached only when the
 * administrator says they pressed send, and the screen says so plainly.
 */

type Recipient = { staffId: string; name: string; role: string; phone: string | null; optedOut: boolean };
type Prepared = {
  id: string;
  recipient: { staffId: string; name: string; role: string; phone: string; link: string };
};

export default function WhatsAppBroadcast() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [prepared, setPrepared] = useState<{ id: string; recipients: Prepared['recipient'][] } | null>(null);
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [reached, setReached] = useState<Record<string, boolean>>({});

  const loadRecipients = useCallback(async () => {
    try {
      const response = await fetch('/api/staff?scope=team', { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json();
      setRecipients(body.recipients ?? []);
    } catch { /* leave the last list */ }
  }, []);

  useEffect(() => { void loadRecipients(); }, [loadRecipients]);

  const reachable = useMemo(() => recipients.filter((person) => person.phone && !person.optedOut), [recipients]);
  const withoutNumber = recipients.filter((person) => !person.phone || person.optedOut);
  const audience = selected.length ? reachable.filter((person) => selected.includes(person.staffId)) : reachable;

  const prepare = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'broadcast-whatsapp', message, senderNumber: senderNumber || null, staffIds: selected.length ? selected : null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body.error ?? 'The broadcast could not be prepared.'));
      if (!body.broadcast?.recipients?.length) {
        setPrepared(null);
        setSkipped(body.skipped ?? []);
        setError('Nobody in that audience has a WhatsApp number on file. Ask staff to add theirs in My workspace.');
        return;
      }
      setPrepared({ id: body.broadcast.id, recipients: body.broadcast.recipients });
      setSkipped(body.skipped ?? []);
      setReached({});
      setNotice(`Prepared for ${body.broadcast.recipients.length} ${body.broadcast.recipients.length === 1 ? 'person' : 'people'}. Open each chat below and press send in WhatsApp.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The broadcast could not be prepared.');
    } finally {
      setBusy(false);
    }
  };

  const markReached = async (staffId: string) => {
    if (!prepared) return;
    setReached((current) => ({ ...current, [staffId]: true }));
    await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark-broadcast-reached', broadcastId: prepared.id, staffId }),
    }).catch(() => undefined);
  };

  const copyAll = async () => {
    const numbers = prepared ? prepared.recipients.map((person) => `+${person.phone}`).join(', ') : audience.map((person) => `+${person.phone}`).join(', ');
    try {
      await navigator.clipboard.writeText(numbers);
      setNotice('Numbers copied — paste them into a WhatsApp broadcast list.');
    } catch {
      setError('The clipboard is not available in this browser.');
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-panel">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Reaching people off the system</div>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">Send a broadcast to WhatsApp</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            For staff who are not in the workspace today. The message is addressed to each person and opens in your own WhatsApp, so it goes out from your number.
            <span className="mt-1 block font-semibold text-navy">This workspace has no WhatsApp provider attached: nothing is sent by the server, and no message is reported as delivered until you mark it.</span>
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">Manual send · your number</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500" htmlFor="wa-message">Message</label>
            <textarea
              id="wa-message"
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 900))}
              rows={5}
              placeholder="e.g. Good morning team — the office closes at 4pm today for the stock count. Finish your check-outs before you leave."
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-xs outline-none focus:border-gold"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
              <span>{message.length}/900 characters · plain text only, WhatsApp links cannot attach files</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={senderNumber}
              onChange={(event) => setSenderNumber(event.target.value)}
              placeholder="Your WhatsApp number (optional, for routing)"
              className="h-9 w-64 rounded-lg border border-line px-2 text-[11px] outline-none focus:border-gold"
              inputMode="tel"
            />
            <button type="button" onClick={() => setSelected([])} className={`h-9 rounded-lg border px-3 text-[11px] font-bold ${selected.length === 0 ? 'border-navy bg-navy text-white' : 'border-line text-slate-600'}`}>
              <Users size={12} className="mr-1 inline" /> Everyone with a number ({reachable.length})
            </button>
            <button
              type="button"
              disabled={busy || !message.trim()}
              onClick={() => void prepare()}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Prepare {audience.length || ''} chats
            </button>
          </div>

          {recipients.length > 0 && (
            <div className="rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                <span>Audience</span>
                <span>{selected.length ? `${selected.length} selected` : 'all with a number'}</span>
              </div>
              <div className="max-h-52 divide-y divide-line overflow-y-auto">
                {recipients.map((person) => {
                  const usable = Boolean(person.phone) && !person.optedOut;
                  const checked = selected.includes(person.staffId);
                  return (
                    <label key={person.staffId} className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${usable ? 'cursor-pointer' : 'opacity-60'}`}>
                      <input
                        type="checkbox"
                        disabled={!usable}
                        checked={checked}
                        onChange={(event) => setSelected((current) => event.target.checked ? [...current, person.staffId] : current.filter((id) => id !== person.staffId))}
                        className="h-3.5 w-3.5"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{person.name}</span>
                      <span className="truncate text-[10px] text-slate-400">{person.role}</span>
                      <span className="w-28 shrink-0 text-right font-mono text-[10px] text-slate-500">{person.phone ? `+${person.phone}` : 'no number'}</span>
                      {person.optedOut && <PhoneOff size={10} className="text-amber-600" />}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {withoutNumber.length > 0 && (
            <p className="text-[10px] text-slate-400">
              {withoutNumber.length} {withoutNumber.length === 1 ? 'person has' : 'people have'} no usable WhatsApp number and will be skipped: {withoutNumber.map((person) => person.name).join(', ')}.
            </p>
          )}
        </div>

        <div className="space-y-2">
          {notice && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800"><Check size={13} className="mt-0.5 shrink-0" /><span>{notice}</span></div>}
          {error && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700"><X size={13} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

          {prepared
            ? (
              <div className="rounded-xl border border-line">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Chats to open · {Object.values(reached).filter(Boolean).length}/{prepared.recipients.length} marked</span>
                  <button type="button" onClick={() => void copyAll()} className="flex items-center gap-1 text-[10px] font-bold text-navy hover:text-gold"><Copy size={10} /> Copy numbers</button>
                </div>
                <div className="max-h-[320px] divide-y divide-line overflow-y-auto">
                  {prepared.recipients.map((person) => (
                    <div key={person.staffId} className="flex items-center gap-2 px-3 py-2">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${reached[person.staffId] ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {reached[person.staffId] ? <CheckCheck size={11} /> : <MessageCircle size={11} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold text-slate-700">{person.name}</div>
                        <div className="truncate font-mono text-[10px] text-slate-400">+{person.phone}</div>
                      </div>
                      <a
                        href={person.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => { const opened = window.open(person.link, '_blank'); if (opened) opened.opener = null; }}
                        className="flex h-7 items-center gap-1 rounded-md bg-navy px-2 text-[10px] font-bold text-white hover:bg-[#1b255d]"
                      >
                        <ExternalLink size={10} /> Open chat
                      </a>
                      <button
                        type="button"
                        onClick={() => void markReached(person.staffId)}
                        className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-bold ${reached[person.staffId] ? 'border-emerald-200 text-emerald-700' : 'border-line text-slate-500 hover:border-gold'}`}
                      >
                        <Check size={10} /> Sent
                      </button>
                    </div>
                  ))}
                </div>
                <p className="border-t border-line px-3 py-2 text-[10px] leading-4 text-slate-400">
                  &ldquo;Sent&rdquo; only records that you pressed send in WhatsApp. The workspace cannot confirm delivery without a WhatsApp provider.
                </p>
              </div>
            )
            : (
              <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                <Smartphone size={20} className="mx-auto text-slate-300" />
                <p className="mt-2 text-xs font-semibold text-slate-500">Write the message, then prepare the chats.</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">Each one opens WhatsApp already addressed to that staff member, with the message filled in.</p>
              </div>
            )}

          {skipped.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
              <div className="font-bold">Skipped</div>
              {skipped.map((person) => <div key={person.name}>{person.name} — {person.reason}</div>)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
