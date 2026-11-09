'use client';
import { useRef, useState } from 'react';
import { FileSearch, Loader2, Paperclip, ScanLine, UploadCloud } from 'lucide-react';

export type AssistantScan = {
  id: string;
  filename: string;
  status: string;
  summary: string;
  transactions: { date: string; description: string; amount: string }[];
  keyFields: { label: string; value: string }[];
  warnings: string[];
};

type Client = { id: string; name: string };

type Props = {
  clients: Client[];
  onScan: (scan: AssistantScan) => void;
  onStatus?: (status: { phase: 'uploading' | 'scanning' | 'complete' | 'failed'; filename?: string; progress?: number; message?: string }) => void;
};

/**
 * Attaches a file to the conversation. The document is parsed and analysed on
 * the server; the returned id is then sent with every follow-up question so the
 * assistant answers from the file rather than from company records.
 */
export default function AssistantDocumentAction({ clients, onScan, onStatus }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState(clients[0]?.id ?? 'unassigned');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const client = clients.find((item) => item.id === clientId) ?? { id: 'unassigned', name: 'Unassigned' };

  const upload = (file: File) => {
    if (!/\.(pdf|csv|txt|xlsx|xls)$/i.test(file.name)) {
      onStatus?.({ phase: 'failed', filename: file.name, message: 'Upload a PDF, CSV, TXT or Excel workbook.' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      onStatus?.({ phase: 'failed', filename: file.name, message: 'Documents must be 25 MB or smaller.' });
      return;
    }
    setBusy(true);
    setProgress(0);
    onStatus?.({ phase: 'uploading', filename: file.name, progress: 0, message: 'Uploading document' });
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', client.id);
    form.set('clientName', client.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const next = Math.round((event.loaded / event.total) * 100);
      setProgress(next);
      onStatus?.({ phase: 'uploading', filename: file.name, progress: next, message: `Uploading ${next}%` });
    };
    xhr.onerror = () => { setBusy(false); onStatus?.({ phase: 'failed', filename: file.name, message: 'The upload connection failed.' }); };
    xhr.onload = () => {
      let result: { document?: AssistantScan; error?: string } = {};
      try { result = JSON.parse(xhr.responseText); } catch { result = { error: 'The scan service returned an invalid response.' }; }
      setBusy(false);
      if (xhr.status >= 200 && xhr.status < 300 && result.document) {
        onStatus?.({ phase: 'complete', filename: result.document.filename, progress: 100, message: result.document.status });
        onScan(result.document);
      } else {
        onStatus?.({ phase: 'failed', filename: file.name, message: result.error ?? 'The document could not be scanned.' });
      }
    };
    xhr.send(form);
  };

  return (
    <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearch size={14} className="text-teal-700" />
        <span className="text-[11px] font-semibold text-teal-800">Attach for review</span>
        <select
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          disabled={busy}
          aria-label="Client for this document"
          className="h-7 border border-teal-100 bg-white px-2 text-[11px] text-slate-600 outline-none"
        >
          {clients.length ? clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="unassigned">No client</option>}
        </select>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.csv,.txt,.xlsx,.xls,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.currentTarget.value = ''; }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-teal-700 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
          {busy ? 'Processing…' : 'Attach document'}
        </button>
      </div>
      {busy && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] font-semibold text-teal-800">
            <span className="flex items-center gap-1"><ScanLine size={11} /> {progress < 100 ? 'Uploading securely' : 'Reading and calculating'}</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-teal-100">
            <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
        </div>
      )}
      {!busy && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-teal-700">
          <UploadCloud size={11} /> PDF, Excel, CSV and TXT · figures calculated on the server
        </div>
      )}
    </div>
  );
}
