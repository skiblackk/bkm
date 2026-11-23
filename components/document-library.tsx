'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import type { UploadedDocument } from '@/lib/uploaded-documents';

type Props = { clients: { id: string; name: string }[]; isAdmin: boolean };

/**
 * Document library.
 *
 * Files could be uploaded from three places — a client record, the client
 * evidence portal, and the work assistant — but could only be deleted from one
 * of them: the client record panel. Anything uploaded through the assistant was
 * filed as "unassigned", never appeared on a client record, and so could never
 * be removed. That is why the delete button looked like it did not work: for
 * those files there was no button at all.
 *
 * This screen lists every upload the caller may manage, and can delete it.
 */
export default function DocumentLibrary({ clients, isAdmin }: Props) {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState('');
  const [confirming, setConfirming] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [canSeeAll, setCanSeeAll] = useState(isAdmin);

  const clientName = useCallback((id: string) => {
    if (!id || id === 'unassigned') return 'Unassigned';
    return clients.find((client) => client.id === id)?.name ?? 'Unassigned';
  }, [clients]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/documents?scope=${canSeeAll ? scope : 'mine'}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.error ?? 'The library could not be loaded.'); setDocuments([]); return; }
      setDocuments(payload.documents ?? []);
      setCanSeeAll(Boolean(payload.canSeeAll));
      setError('');
    } catch {
      setError('The library could not be loaded.');
    } finally { setLoading(false); }
  }, [canSeeAll, scope]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    setDeleting(id); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) setError(payload.error ?? 'The document could not be deleted.');
      else { setMessage('Document deleted.'); setConfirming(''); }
      await load();
    } catch {
      setError('The document could not be deleted.');
    } finally { setDeleting(''); }
  };

  const unassigned = documents.filter((document) => !document.clientId || document.clientId === 'unassigned').length;

  return <div className="panel p-5" data-testid="document-library">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="eyebrow">Evidence</div>
        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-[-0.03em]"><FileText size={17} className="text-teal-700" /> Document library</h3>
        <p className="mt-1 text-xs text-slate-500">Every uploaded document the register holds, including files that were never attached to a client record.</p>
      </div>
      <div className="flex items-center gap-2">
        {canSeeAll && <select value={scope} onChange={(event) => setScope(event.target.value as 'all' | 'mine')} className="h-9 border border-line bg-white px-2 text-xs text-slate-600 outline-none">
          <option value="all">Everyone&apos;s uploads</option>
          <option value="mine">Only mine</option>
        </select>}
        <button type="button" onClick={() => void load()} className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:border-teal-300"><RefreshCw size={12} /> Refresh</button>
      </div>
    </div>

    {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="library-error">{error}</div>}
    {message && !error && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800" data-testid="library-notice">{message}</div>}

    {unassigned > 0 && <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <ShieldAlert size={14} className="mt-0.5 shrink-0" />
      <span><strong>{unassigned}</strong> uploaded document{unassigned === 1 ? ' was' : 's were'} never attached to a client record. They are listed here so they can be deleted or kept deliberately.</span>
    </div>}

    <div className="mt-4 space-y-2">
      {loading && <div className="flex items-center gap-2 px-1 py-6 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading documents…</div>}
      {!loading && !documents.length && <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-slate-500">No documents to show.</p>}
      {documents.map((document) => <div key={document.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5" data-testid="library-row">
        <FileText size={16} className="shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold" data-testid="library-filename">{document.filename}</div>
          <div className="text-[11px] text-slate-500">
            {clientName(document.clientId)} · {new Date(document.uploadedAt).toLocaleString('en-KE')} · {document.status}
          </div>
        </div>
        {confirming === document.id
          ? <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-600">Delete permanently?</span>
              <button type="button" data-testid="library-delete-confirm" disabled={deleting === document.id} onClick={() => void remove(document.id)} className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">{deleting === document.id ? 'Deleting…' : 'Delete'}</button>
              <button type="button" onClick={() => setConfirming('')} className="rounded-md border border-line px-2 py-1 text-[10px] font-semibold text-slate-600">Keep</button>
            </div>
          : <button type="button" aria-label={`Delete ${document.filename}`} data-testid="library-delete" onClick={() => { setConfirming(document.id); setMessage(''); }} className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-500 hover:border-red-300 hover:text-red-600">
              <Trash2 size={13} />
            </button>}
      </div>)}
    </div>
  </div>;
}
