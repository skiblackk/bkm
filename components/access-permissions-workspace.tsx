'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, KeyRound, Plus, Search, ShieldCheck, Trash2, UserCog, UsersRound, X } from 'lucide-react';

interface CatalogueEntry { key: string; workspace: string; action: string; description: string; sensitive: boolean; legacy: boolean }
interface UserRow { account: string; name: string; email: string; role: string; isAdmin: boolean; active: boolean; approvalStatus: string }
interface Effective { userId: string; isAdmin: boolean; isActive: boolean; roleNames: string[]; permissions: string[]; userGrants: Array<{ permissionKey: string; effect: 'allow' | 'deny'; reason: string | null; expiresAt: string | null }>; roleGrants: string[] }
interface RoleRow { id: string; name: string; description: string; is_system_role: boolean; is_active: boolean }
interface RequestRow { id: string; request_type: string; resource_type: string; reason: string; status: string; requested_by: string; created_at: string }

export default function AccessPermissionsWorkspace() {
  const [tab, setTab] = useState<'employees' | 'roles' | 'requests'>('employees');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [roleGrants, setRoleGrants] = useState<Array<{ role: string; permission_key: string }>>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [effective, setEffective] = useState<Effective | null>(null);
  const [search, setSearch] = useState('');
  const [grantKey, setGrantKey] = useState('');
  const [grantEffect, setGrantEffect] = useState<'allow' | 'deny'>('allow');
  const [grantReason, setGrantReason] = useState('');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [roleDraft, setRoleDraft] = useState<string[]>([]);
  const [roleTarget, setRoleTarget] = useState<string>('');
  const [newRoleName, setNewRoleName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [usersRes, permRes, reqRes] = await Promise.all([
      fetch('/api/admin/users', { cache: 'no-store' }),
      fetch('/api/permissions', { cache: 'no-store' }),
      fetch('/api/approvals', { cache: 'no-store' }),
    ]);
    const usersPayload = await usersRes.json();
    const permPayload = await permRes.json();
    const reqPayload = await reqRes.json();
    if (usersRes.ok) setUsers((usersPayload.users ?? []).map((u: { account?: string; id?: string; name?: string; full_name?: string; email?: string; role?: string; roles?: { name?: string } | null; isAdmin?: boolean; is_admin?: boolean; active?: boolean; approvalStatus?: string; approval_status?: string }) => ({ account: u.account ?? u.id ?? '', name: u.name ?? u.full_name ?? '', email: u.email ?? '', role: u.role ?? (Array.isArray(u.roles) ? u.roles[0]?.name : u.roles?.name) ?? 'Staff', isAdmin: Boolean(u.isAdmin ?? u.is_admin), active: Boolean(u.active), approvalStatus: u.approvalStatus ?? u.approval_status ?? 'approved' })));
    if (permRes.ok) { setCatalogue(permPayload.catalogue ?? []); setRoles(permPayload.roles ?? []); setRoleGrants(permPayload.roleGrants ?? []); }
    if (reqRes.ok) setRequests((reqPayload.requests ?? []).filter((r: RequestRow) => r.status === 'Pending'));
  }, []);

  useEffect(() => { void load().catch(() => setError('Unable to load the access workspace.')); }, [load]);

  const loadEffective = useCallback(async (userId: string) => {
    setSelected(userId);
    setEffective(null);
    if (!userId) return;
    const res = await fetch(`/api/permissions?userId=${userId}`, { cache: 'no-store' });
    const payload = await res.json();
    if (res.ok) setEffective(payload.effective);
    else setError(payload.error ?? 'Unable to load effective permissions.');
  }, []);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Action failed.');
      setMessage(payload.message ?? 'Saved.');
      await load();
      if (selected) await loadEffective(selected);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Action failed.'); }
    finally { setBusy(false); }
  };

  const saveRole = async (roleId: string, perms: string[], description: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/permissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-role', roleId, permissions: perms, description }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Save failed.');
      setMessage('Role updated.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  const createRole = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/permissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-role', name: newRoleName, description: 'Custom role', permissions: roleDraft }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Create failed.');
      setMessage(`Role ${newRoleName} created.`);
      setNewRoleName(''); setRoleDraft([]);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Create failed.'); }
    finally { setBusy(false); }
  };

  const decideRequest = async (id: string, decision: 'Approved' | 'Rejected') => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'decide', id, decision, note: `${decision} from the access workspace` }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Decision failed.');
      setMessage(`Request ${decision.toLowerCase()}.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Decision failed.'); }
    finally { setBusy(false); }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogueEntry[]>();
    for (const entry of catalogue) {
      const list = map.get(entry.workspace) ?? [];
      list.push(entry);
      map.set(entry.workspace, list);
    }
    return Array.from(map.entries());
  }, [catalogue]);

  const filteredUsers = users.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase()));
  const rolePermsFor = (roleName: string) => roleGrants.filter((g) => g.role === roleName).map((g) => g.permission_key);
  const grantDescription = (key: string) => catalogue.find((c) => c.key === key)?.description ?? '';

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-navy/15 bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Access governance</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">Access &amp; permissions management</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Role templates, individual grants, restrictions and temporary access — stored in the database and enforced by every API and every row-level policy.</p>
          </div>
          <div className="flex gap-2">
            {(['employees', 'roles', 'requests'] as const).map((id) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold ${tab === id ? 'bg-navy text-white' : 'border border-line text-slate-600 hover:border-gold'}`}>
                {id === 'employees' ? 'Employees' : id === 'roles' ? 'Role templates' : `Access requests${requests.length ? ` (${requests.length})` : ''}`}
              </button>
            ))}
          </div>
        </div>
        {message && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{message}</div>}
        {error && <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><span>{error}</span><button type="button" onClick={() => setError('')}><X size={13} /></button></div>}
      </div>

      {tab === 'employees' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><UsersRound size={13} /> Employees</div>
              <div className="flex h-9 items-center gap-2 rounded-lg border border-line px-2.5"><Search size={13} className="text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-36 bg-transparent text-xs outline-none" /></div>
            </div>
            <div className="mt-3 divide-y divide-line">
              {filteredUsers.map((u) => (
                <button key={u.account} type="button" onClick={() => void loadEffective(u.account)} className={`flex w-full items-center gap-3 px-2 py-2.5 text-left ${selected === u.account ? 'rounded-lg bg-gold/10' : 'hover:bg-canvas'}`}>
                  <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-navy">{u.name}</div><div className="truncate text-[11px] text-slate-500">{u.email} · {u.role}</div></div>
                  <span className={`text-[10px] font-bold ${u.approvalStatus === 'pending' ? 'text-amber-700' : u.active ? 'text-emerald-700' : 'text-red-700'}`}>{u.approvalStatus === 'pending' ? 'Pending' : u.active ? 'Active' : 'Suspended'}</span>
                </button>
              ))}
              {filteredUsers.length === 0 && <div className="px-2 py-6 text-xs text-slate-500">No employees match.</div>}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
            {!selected || !effective ? (
              <div className="py-10 text-center text-xs text-slate-500"><UserCog size={20} className="mx-auto mb-2 text-slate-300" /> Select an employee to see their effective access, inherited permissions, grants and restrictions.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="h-9 rounded-lg border border-line px-2 text-xs" value={users.find((u) => u.account === selected)?.role ?? ''} onChange={(e) => void act({ action: 'set-role', account: selected, role: e.target.value })}>
                    {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                  <button type="button" disabled={busy} onClick={() => void act({ action: users.find((u) => u.account === selected)?.active ? 'suspend-user' : 'reactivate-user', account: selected })} className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${users.find((u) => u.account === selected)?.active ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                    {users.find((u) => u.account === selected)?.active ? 'Suspend account' : 'Reactivate account'}
                  </button>
                  {effective.isAdmin && <span className="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-[10px] font-bold text-white"><ShieldCheck size={11} /> Administrator</span>}
                </div>
                <div className="text-[11px] text-slate-500">Role <strong>{effective.roleNames.join(', ') || 'none'}</strong> grants {effective.roleGrants.length} permissions · {effective.userGrants.length} individual grant(s) · {effective.permissions.length} effective in total. Payroll and confidential documents are never inherited automatically.</div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Effective permissions by workspace</div>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                    {grouped.map(([workspace, entries]) => {
                      const held = entries.filter((entry) => effective.permissions.includes(entry.key));
                      if (!held.length) return null;
                      return (
                        <div key={workspace}>
                          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-teal-700">{workspace}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {held.map((entry) => (
                              <span key={entry.key} title={entry.description} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.sensitive ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{entry.key}</span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Individual grants &amp; restrictions</div>
                  <div className="mt-2 space-y-1">
                    {effective.userGrants.map((g) => (
                      <div key={`${g.permissionKey}-${g.effect}`} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${g.effect === 'deny' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{g.effect}</span>
                        <span className="flex-1 font-semibold text-slate-700">{g.permissionKey}</span>
                        {g.expiresAt && <span className="text-amber-700">expires {g.expiresAt.slice(0, 10)}</span>}
                        <button type="button" disabled={busy} title={`Revoke — affects the ${catalogue.find((c) => c.key === g.permissionKey)?.workspace ?? ''} workspace: ${grantDescription(g.permissionKey)}`} onClick={() => void act({ action: 'set-permission', account: selected, permission: g.permissionKey, revoke: true })} className="text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                      </div>
                    ))}
                    {effective.userGrants.length === 0 && <div className="text-[11px] text-slate-400">No individual grants — access comes entirely from the role template.</div>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <select className="h-9 max-w-[220px] rounded-lg border border-line px-2 text-xs" value={grantKey} onChange={(e) => setGrantKey(e.target.value)}>
                      <option value="">Choose permission…</option>
                      {grouped.map(([ws, entries]) => (
                        <optgroup key={ws} label={ws}>{entries.map((entry) => <option key={entry.key} value={entry.key}>{entry.key}{entry.sensitive ? ' (sensitive)' : ''}</option>)}</optgroup>
                      ))}
                    </select>
                    <select className="h-9 rounded-lg border border-line px-2 text-xs" value={grantEffect} onChange={(e) => setGrantEffect(e.target.value as 'allow' | 'deny')}><option value="allow">Allow</option><option value="deny">Deny (overrides role)</option></select>
                    <input className="h-9 rounded-lg border border-line px-2 text-xs" placeholder="Reason" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} />
                    <input type="date" className="h-9 rounded-lg border border-line px-2 text-xs" title="Expiry (optional)" value={grantExpiry} onChange={(e) => setGrantExpiry(e.target.value)} />
                    <button type="button" disabled={busy || !grantKey} onClick={() => { void act({ action: 'set-permission', account: selected, permission: grantKey, effect: grantEffect, reason: grantReason, expiresAt: grantExpiry || undefined }); setGrantKey(''); setGrantReason(''); setGrantExpiry(''); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"><KeyRound size={12} /> Grant</button>
                  </div>
                  {grantKey && <div className="mt-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-[11px] leading-5 text-slate-600"><strong>{grantKey}</strong> — {grantDescription(grantKey)}</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Role templates</div>
            <div className="mt-3 space-y-1">
              {roles.map((r) => (
                <button key={r.id} type="button" onClick={() => { setRoleTarget(r.id); setRoleDraft(rolePermsFor(r.name)); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${roleTarget === r.id ? 'bg-gold/10' : 'hover:bg-canvas'}`}>
                  <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-navy">{r.name}{r.is_system_role && <span className="ml-2 rounded-full bg-navy px-1.5 py-0.5 text-[9px] font-bold text-white">system</span>}</div><div className="truncate text-[11px] text-slate-500">{r.description}</div></div>
                  <span className="text-[10px] font-bold text-slate-500">{rolePermsFor(r.name).length} perms</span>
                </button>
              ))}
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Create a custom role</div>
              <div className="mt-2 flex gap-2">
                <input className="h-9 flex-1 rounded-lg border border-line px-2 text-xs" placeholder="Role name" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} />
                <button type="button" disabled={busy || !newRoleName} onClick={() => void createRole()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"><Plus size={12} /> Create</button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
            {!roleTarget ? (
              <div className="py-10 text-center text-xs text-slate-500">Select a role template to review and customise its permissions.</div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Permissions in this role · {roleDraft.length} selected</div>
                  <button type="button" disabled={busy} onClick={() => saveRole(roleTarget, roleDraft, roles.find((r) => r.id === roleTarget)?.description ?? '')} className="rounded-lg bg-navy px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40">Save role</button>
                </div>
                <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {grouped.map(([ws, entries]) => (
                    <div key={ws}>
                      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-teal-700">{ws}</div>
                      <div className="mt-1 space-y-0.5">
                        {entries.map((entry) => (
                          <label key={entry.key} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-canvas">
                            <input type="checkbox" className="mt-0.5" checked={roleDraft.includes(entry.key)} onChange={(e) => setRoleDraft((draft) => e.target.checked ? [...draft, entry.key] : draft.filter((k) => k !== entry.key))} />
                            <span className="text-[11px] leading-4"><span className="font-semibold text-slate-700">{entry.key}</span>{entry.sensitive && <span className="ml-1 rounded bg-amber-50 px-1 text-[9px] font-bold text-amber-700">sensitive</span>}<span className="block text-slate-500">{entry.description}</span></span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Removing a permission affects the workflows named above — employees lose those actions immediately. System roles cannot be deleted.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Pending access requests</div>
          <div className="mt-3 divide-y divide-line">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-navy">{r.request_type.replace(/_/g, ' ')} · {r.resource_type}</div>
                  <div className="text-[11px] text-slate-500">{r.reason || 'No reason given.'} · requested {new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
                </div>
                <button type="button" disabled={busy} onClick={() => void decideRequest(r.id, 'Approved')} className="inline-flex items-center gap-1 rounded-md bg-navy px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40"><Check size={12} /> Approve</button>
                <button type="button" disabled={busy} onClick={() => void decideRequest(r.id, 'Rejected')} className="rounded-md border border-red-200 px-3 py-2 text-[11px] font-bold text-red-700 disabled:opacity-40">Reject</button>
              </div>
            ))}
            {requests.length === 0 && <div className="py-8 text-xs text-slate-500">No pending requests. Employees can request extra access from their own workspace.</div>}
          </div>
        </div>
      )}
    </section>
  );
}
