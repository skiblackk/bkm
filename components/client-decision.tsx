'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = { token: string; status: string; clientName: string; number: string };

/**
 * The client-side action on the shared quotation link. It posts to a public,
 * rate-limited endpoint that only accepts a decision for a quotation that has
 * actually been issued — never for a draft.
 */
export default function ClientDecision({ token, status, clientName, number }: Props) {
  const router = useRouter();
  const [choice, setChoice] = useState<'Accepted' | 'Rejected' | null>(null);
  const [name, setName] = useState(clientName);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const open = status === 'Sent' || status === 'Viewed';
  // The confirmation is kept on screen even after the page re-renders with the
  // new status, so the client is never left wondering whether it registered.
  if (state !== 'done' && !open) return null;

  // The decision is passed in rather than read from state: the click handler
  // sets the choice and calls submit in the same tick, so state would still
  // hold the previous value here and the request would never be sent.
  const submit = async (decision: 'Accepted' | 'Rejected') => {
    setChoice(decision);
    setState('saving');
    setError('');
    try {
      const response = await fetch('/api/quotations/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decision, decidedBy: name.trim(), note: note.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState('error');
        setError(payload.error ?? 'Your decision could not be recorded. Please reply to the email instead.');
        return;
      }
      setState('done');
      // Re-render the server component so the heading and status pill reflect
      // the decision that was just recorded.
      router.refresh();
    } catch {
      setState('error');
      setError('The response could not reach our server. Reply to the email and we will record it for you.');
    }
  };

  if (state === 'done') {
    return (
      <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800">
          {choice === 'Accepted' ? 'Accepted' : 'Declined'}
        </div>
        <p className="mt-2 text-xs leading-6 text-emerald-900">
          {choice === 'Accepted'
            ? `Thank you — your acceptance of ${number} has been recorded and our team has been notified.`
            : `Your decision on ${number} has been recorded. Our team will be in touch about the scope.`}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-white p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Your decision</div>
      <p className="mt-1.5 text-xs leading-5 text-slate-500">Confirm the quotation here, or reply to the email if you would rather discuss the scope first.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          className="rounded-md border border-line px-3 py-2 text-xs text-navy outline-none focus:border-teal-500"
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Reference — e.g. purchase order number"
          className="rounded-md border border-line px-3 py-2 text-xs text-navy outline-none focus:border-teal-500"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void submit('Accepted')}
          disabled={state === 'saving' || !name.trim()}
          className="rounded-md bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
        >
          {state === 'saving' && choice === 'Accepted' ? 'Recording…' : 'Accept this quotation'}
        </button>
        <button
          onClick={() => void submit('Rejected')}
          disabled={state === 'saving' || !name.trim()}
          className="rounded-md border border-line bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-700 disabled:opacity-50"
        >
          Decline / request changes
        </button>
      </div>
      {!name.trim() ? <p className="mt-2 text-[10px] text-slate-400">Please add your name so we can attribute the decision.</p> : null}
      {state === 'error' ? <p className="mt-2 text-[11px] leading-5 text-red-700">{error}</p> : null}
    </section>
  );
}
