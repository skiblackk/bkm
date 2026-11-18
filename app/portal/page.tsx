'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, FileText, Loader2, Trash2, UploadCloud } from 'lucide-react';
import type { UploadedDocument } from '@/lib/uploaded-documents';

type ClientOption = { id: string; name: string };

/**
 * Client evidence portal.
 *
 * The client record linked to "/portal?client=<id>" and the route did not
 * exist, so it returned a 404. This is the real page: an authenticated staff
 * screen for uploading evidence against a chosen client and managing what is
 * already there. It deliberately reuses the same permissioned APIs as the
 * workspace, so nothing here widens access.
 */
function PortalBody() {
  const params = useSearchParams();
  const initialClient = params.get('client') ?? '';
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState(initialClient);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/data', { cache: 'no-store' });
        if (response.status === 401 || response.status === 403) { window.location.assign('/'); return; }
        const payload = await response.json();
        const list: ClientOption[] = (payload?.snapshot?.clients ?? []).map((client: ClientOption) => ({ id: client.id, name: client.name }));
        setClients(list);
        setClientId((current) => current || list[0]?.id || '');
      } catch { setError('The client list could not be loaded.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) { setDocuments([]); return; }
    const response = await fetch(`/api/documents?clientId=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (response.ok) setDocuments((await response.json()).documents);
    else setDocuments([]);
  }, []);

  useEffect(() => { void load(clientId); }, [clientId, load]);

  const selected = clients.find((client) => client.id === clientId);

  const upload = async (file: File) => {
    if (!clientId || !selected) return;
    setBusy(true); setMessage(''); setError('');
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', clientId);
    form.set('clientName', selected.name);
    const response = await fetch('/api/documents', { method: 'POST', body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) setError(result.error ?? 'The upload could not be completed.');
    else { setMessage(`${file.name} uploaded and reviewed.`); await load(clientId); }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setDeleting(id); setError(''); setMessage('');
    const response = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) setError(result.error ?? 'The document could not be deleted.');
    else { setMessage('Document deleted.'); await load(clientId); }
    setDeleting('');
  };

  return <main style={{ minHeight: '100vh', background: '#f6f5f2', padding: '32px 16px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8a8f98' }}>BKM Associates</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em', color: '#12263a' }}>Client evidence portal</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#5b6672' }}>Upload supporting documents against a client record, or remove one that should not be there.</p>
        </div>
        <a href="/clients" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#0f766e', textDecoration: 'none', whiteSpace: 'nowrap' }}><ArrowLeft size={14} /> Back to workspace</a>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e4e2dd', borderRadius: 10, padding: 20 }}>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8a8f98', marginBottom: 6 }}>Client</label>
        <select value={clientId} onChange={(event) => { setClientId(event.target.value); setMessage(''); setError(''); }} style={{ width: '100%', height: 38, border: '1px solid #e4e2dd', borderRadius: 6, padding: '0 10px', fontSize: 13, color: '#12263a', background: '#fff' }}>
          {!clients.length && <option value="">{loading ? 'Loading clients…' : 'No clients available'}</option>}
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>

        <input ref={inputRef} type="file" accept=".pdf,.csv,.txt,.xlsx,.xls" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} />
        <button type="button" disabled={busy || !clientId} onClick={() => inputRef.current?.click()} style={{ marginTop: 16, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px dashed #5eead4', background: '#f0fdfa', borderRadius: 8, padding: '18px 12px', fontSize: 12, fontWeight: 600, color: '#0f766e', cursor: busy || !clientId ? 'not-allowed' : 'pointer', opacity: busy || !clientId ? 0.6 : 1 }}>
          {busy ? <><Loader2 size={16} className="animate-spin" /> Reviewing document…</> : <><UploadCloud size={17} /> Choose a document to upload</>}
        </button>

        {message && <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start', background: '#f8fafc', padding: 10, borderRadius: 6, fontSize: 12, color: '#475569' }}><CheckCircle2 size={14} color="#0f766e" style={{ flexShrink: 0, marginTop: 2 }} />{message}</div>}
        {error && <div style={{ marginTop: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>{error}</div>}

        <div style={{ marginTop: 22, borderTop: '1px solid #e4e2dd', paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#12263a', marginBottom: 10 }}>Documents for this client ({documents.length})</div>
          {!documents.length && <p style={{ fontSize: 12, color: '#8a8f98', margin: 0 }}>Nothing uploaded yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {documents.map((document) => <div key={document.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e4e2dd', borderRadius: 8, padding: 10 }}>
              <FileText size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#12263a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{document.filename}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{new Date(document.uploadedAt).toLocaleString()} · {document.status}</div>
              </div>
              <button type="button" aria-label={`Delete ${document.filename}`} disabled={deleting === document.id} onClick={() => void remove(document.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: '1px solid #e4e2dd', borderRadius: 6, background: '#fff', color: '#64748b', cursor: 'pointer' }}>
                {deleting === document.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </div>)}
          </div>
        </div>
      </div>
    </div>
  </main>;
}

export default function PortalPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return <Suspense fallback={<main style={{ minHeight: '100vh', background: '#f6f5f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#5b6672' }}>Loading evidence portal…</main>}><PortalBody /></Suspense>;
}
