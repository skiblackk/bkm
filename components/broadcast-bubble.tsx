'use client';

import { BellRing, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type Broadcast = { id: string; senderName: string; body: string; createdAt: string };

export default function BroadcastBubble() {
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch('/api/messages', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json() as { broadcasts?: Broadcast[] };
    const latest = payload.broadcasts?.[0] ?? null;
    setBroadcast(latest);
    if (latest && window.sessionStorage.getItem('bkm-dismissed-broadcast') === latest.id) setDismissed(latest.id);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  if (!broadcast || dismissed === broadcast.id) return null;

  const dismiss = () => {
    window.sessionStorage.setItem('bkm-dismissed-broadcast', broadcast.id);
    setDismissed(broadcast.id);
  };

  return <aside className="fixed bottom-6 right-5 z-[60] w-[min(380px,calc(100vw-2.5rem))] animate-page-in rounded-2xl border border-gold/40 bg-navy p-4 text-white shadow-deep" role="status" aria-live="polite">
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold text-navy"><BellRing size={17} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Company broadcast</div>
          <button type="button" onClick={dismiss} aria-label="Dismiss broadcast" className="text-white/50 hover:text-white"><X size={15} /></button>
        </div>
        <div className="mt-1 text-sm font-semibold">{broadcast.senderName}</div>
        <p className="mt-1 text-xs leading-5 text-white/75">{broadcast.body}</p>
        <div className="mt-2 text-[10px] text-white/45">{broadcast.createdAt}</div>
      </div>
    </div>
  </aside>;
}
