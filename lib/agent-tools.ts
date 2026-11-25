/**
 * Client-register tools for the AI agent.
 *
 * The idea the user asked for: rather than a staff member filling in nine
 * fields by hand, the agent should *ask* for the information, work out whether
 * the organisation is serviced by BKM or paid by BKM, and then write the record
 * itself — and be able to repair and retire records afterwards.
 *
 * Design rules, in order of importance:
 *
 *   1. Read tools run freely; **write tools never execute from the model's
 *      instruction alone.** A write returns a `pending` proposal and the UI asks
 *      the human to confirm. The model can draft, but a person commits.
 *   2. Every write is permission-checked against the *calling session*, not the
 *      model. The model cannot grant itself anything.
 *   3. Deletes are soft. `delete_client` sets deleted_at; `restore_client`
 *      clears it. Nothing the agent does is unrecoverable in one step.
 *   4. Every executed write is logged to `agent_actions` with enough payload to
 *      reconstruct exactly what happened and undo it.
 */

import { createSupabaseAdminClient } from './supabase/admin';
import { hasPermission, type DemoSession } from './auth';

export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: string; description: string }>; required?: string[] };
}

export interface AgentToolResult {
  tool: string;
  ok: boolean;
  denied?: boolean;
  summary: string;
  data?: unknown;
  /** True when the tool did something to the database. */
  mutated?: boolean;
  /** True when the tool is proposing a write that a human must confirm. */
  pending?: boolean;
  proposal?: AgentProposal;
}

export interface AgentProposal {
  action: string;
  label: string;
  payload: Record<string, unknown>;
}

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

const deny = (tool: string, permissions: string[]): AgentToolResult => ({
  tool, ok: false, denied: true,
  summary: `You do not have permission for this (${permissions.join(' or ')} required). Nothing was changed.`,
});

const canManageClients = (session: DemoSession) =>
  session.isAdmin || hasPermission(session, 'manage_clients');

/* ------------------------------------------------------------------ specs */

export const AGENT_TOOL_SPECS: AgentToolSpec[] = [
  {
    name: 'lookup_person',
    description:
      'Look up a person by name across the whole system: staff accounts, client records and client contacts. Use whenever someone asks who a person is or whether a name is already known. Reports every role a person holds, so it never says "staff" and stops when the same person is also a client.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Person name, or part of it' } },
      required: ['name'],
    },
  },
  {
    name: 'find_client',
    description:
      'Search the client register by name, industry or contact. Use before creating anything, to avoid duplicates, and before editing or deleting, to get the exact id.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, industry or contact to search for. Use an empty string to list the register.' },
        include_deleted: { type: 'string', description: "'true' to include soft-deleted records" },
      },
    },
  },
  {
    name: 'client_health_report',
    description:
      'Find broken records: clients with no primary contact, no service charge, a payable record with no amount, documents that belong to no client, unassigned uploads, and duplicate-looking names. Use this when asked to check or fix the register.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'propose_create_client',
    description:
      'Propose a new client record. Does NOT save. Provide every field you have collected. The service type decides how billing behaves: "serviced" means BKM bills them, "vendor" means BKM pays them. Ask the user which one it is before proposing.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Organisation name' },
        industry: { type: 'string', description: 'Industry or sector' },
        location: { type: 'string', description: 'City and country' },
        contact_name: { type: 'string', description: 'Primary contact person' },
        contact_email: { type: 'string', description: 'Primary contact email' },
        contact_phone: { type: 'string', description: 'Phone number, may be empty' },
        description: { type: 'string', description: 'Short description of the relationship' },
        relationship: { type: 'string', description: "'serviced' or 'vendor'" },
        service_name: { type: 'string', description: 'The service BKM provides or buys' },
        amount: { type: 'string', description: 'Amount in KES, digits only, may be empty' },
        billing_frequency: { type: 'string', description: 'one-off, weekly, monthly, quarterly or annual' },
      },
      required: ['name'],
    },
  },
  {
    name: 'propose_update_client',
    description:
      'Propose a change to an existing client record. Does NOT save. Only include the fields that should change; omit the rest.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Exact id from find_client' },
        name: { type: 'string', description: 'New organisation name' },
        industry: { type: 'string', description: 'New industry' },
        location: { type: 'string', description: 'New location' },
        description: { type: 'string', description: 'New description' },
        status: { type: 'string', description: 'Active, On hold or Archived' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'propose_delete_client',
    description:
      'Propose removing a client record. Does NOT delete. Deletion is soft and reversible: the record is hidden from the register but can be restored.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Exact id from find_client' },
        reason: { type: 'string', description: 'Why it should be removed' },
      },
      required: ['client_id', 'reason'],
    },
  },
];

/* --------------------------------------------------------------- read tools */

interface ClientRow {
  id: string; name: string; industry: string; location: string; status: string;
  relationship_type: string; deleted_at: string | null; description?: string;
}

async function findClientRows(query: string, includeDeleted: boolean) {
  const admin = db();
  let request = admin
    .from('clients')
    .select('id, name, industry, location, status, relationship_type, deleted_at, description')
    .order('created_at', { ascending: true })
    .limit(100);
  if (!includeDeleted) request = request.is('deleted_at', null);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClientRow[];
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    `${row.name} ${row.industry} ${row.location}`.toLowerCase().includes(needle),
  );
}

async function healthFindings() {
  const admin = db();
  const [{ data: clients }, { data: charges }, { data: contacts }, { data: documents }] = await Promise.all([
    admin.from('clients').select('id, name, industry, status, relationship_type, deleted_at').is('deleted_at', null),
    admin.from('client_service_charges').select('id, client_id, service_name, amount, direction'),
    admin.from('client_contacts').select('client_id, full_name, email, is_primary'),
    admin.from('document_extractions').select('id, filename, extracted_json'),
  ]);

  const rows = (clients ?? []) as Array<{ id: string; name: string; industry: string; status: string; relationship_type: string }>;
  const chargeRows = (charges ?? []) as Array<{ id: string; client_id: string; service_name: string; amount: number; direction: string }>;
  const contactRows = (contacts ?? []) as Array<{ client_id: string; full_name: string; email: string; is_primary: boolean }>;
  const documentRows = (documents ?? []) as Array<{ id: string; filename: string; extracted_json: Record<string, unknown> }>;

  const hasPrimaryContact = new Set(contactRows.filter((c) => c.is_primary && c.email).map((c) => c.client_id));
  const hasCharge = new Set(chargeRows.map((c) => c.client_id));

  const noContact = rows.filter((r) => !hasPrimaryContact.has(r.id));
  const noCharge = rows.filter((r) => !hasCharge.has(r.id));
  const payableWithoutService = rows.filter((r) => r.relationship_type === 'vendor' && !hasCharge.has(r.id));

  // Duplicate-looking names: same first word, or one contains the other.
  const duplicates: Array<[string, string]> = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i].name.toLowerCase().trim();
      const b = rows[j].name.toLowerCase().trim();
      const firstA = a.split(/\s+/)[0];
      const firstB = b.split(/\s+/)[0];
      if (a === b || a.includes(b) || b.includes(a) || (firstA.length > 3 && firstA === firstB)) {
        duplicates.push([rows[i].name, rows[j].name]);
      }
    }
  }

  const unassignedDocs = documentRows.filter((d) => {
    const clientId = String(d.extracted_json?.clientId ?? '');
    return !clientId || clientId === 'unassigned';
  });
  // A document pointing at a client id that no longer exists is a broken link.
  const knownIds = new Set(rows.map((r) => r.id));
  const orphanedDocs = documentRows.filter((d) => {
    const clientId = String(d.extracted_json?.clientId ?? '');
    return clientId && clientId !== 'unassigned' && !knownIds.has(clientId);
  });

  return {
    totals: { clients: rows.length, charges: chargeRows.length, documents: documentRows.length },
    noContact: noContact.map((r) => ({ id: r.id, name: r.name })),
    noCharge: noCharge.map((r) => ({ id: r.id, name: r.name, relationship: r.relationship_type })),
    payableWithoutService: payableWithoutService.map((r) => ({ id: r.id, name: r.name })),
    duplicates,
    unassignedDocuments: unassignedDocs.length,
    orphanedDocuments: orphanedDocs.map((d) => ({ id: d.id, filename: d.filename })),
    chargeTotal: chargeRows.reduce((sum, c) => sum + Number(c.amount ?? 0), 0),
  };
}

/* --------------------------------------------------------------- executor */

export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  session: DemoSession,
): Promise<AgentToolResult> {
  const str = (key: string) => String(args[key] ?? '').trim();

  try {
    switch (name) {
      case 'lookup_person': {
        // A person in this system can be staff, a client contact, and the client
        // itself all at once. Answering from one table gives a true but useless
        // half-answer, so every source is checked and the roles are combined.
        if (!canManageClients(session)) return deny(name, ['manage_clients']);
        const person = str('name');
        if (person.length < 2) return { tool: name, ok: false, summary: 'Give me a name to look up.' };
        const admin = db();
        const like = `%${person.replace(/[%_]/g, '')}%`;
        const [{ data: staff }, { data: contacts }, { data: clientRows }] = await Promise.all([
          admin.from('profiles').select('id, full_name, email, is_admin, active, approval_status, roles(name)').ilike('full_name', like),
          admin.from('client_contacts').select('full_name, email, phone, is_primary, clients(id, name)').ilike('full_name', like),
          admin.from('clients').select('id, name, industry, location, status, relationship_type').ilike('name', like).is('deleted_at', null),
        ]);

        const groups = new Map<string, { name: string; roles: string[]; notes: string[] }>();
        const ensure = (fullName: string) => {
          const key = fullName.trim().toLowerCase();
          if (!groups.has(key)) groups.set(key, { name: fullName, roles: [], notes: [] });
          return groups.get(key)!;
        };
        for (const row of (staff ?? []) as Array<{ full_name: string; email: string; is_admin: boolean; active: boolean; approval_status: string; roles: { name?: string } | Array<{ name?: string }> | null }>) {
          const entry = ensure(row.full_name);
          const roleName = (Array.isArray(row.roles) ? row.roles[0]?.name : (row.roles as { name?: string } | null)?.name) ?? 'Staff';
          entry.roles.push(row.is_admin ? 'Administrator' : roleName);
          entry.notes.push(`${row.email}${row.active ? '' : ' (account inactive)'}${row.approval_status === 'pending' ? ' (awaiting approval)' : ''}`);
        }
        for (const row of (contacts ?? []) as Array<{ full_name: string; email: string; phone: string; is_primary: boolean; clients: { name: string } | Array<{ name: string }> | null }>) {
          const linked = Array.isArray(row.clients) ? row.clients[0] : row.clients;
          if (!linked) continue;
          const entry = ensure(row.full_name);
          if (!entry.roles.includes('Client contact')) entry.roles.push('Client contact');
          entry.notes.push(`${row.is_primary ? 'primary contact' : 'contact'} at ${linked.name}`);
        }
        for (const row of (clientRows ?? []) as Array<{ name: string; industry: string; location: string; status: string; relationship_type: string }>) {
          const entry = ensure(row.name);
          entry.roles.push(row.relationship_type === 'vendor' ? 'Supplier paid by BKM' : 'Client serviced by BKM');
          entry.notes.push(`${row.industry || 'no industry'} · ${row.location || 'no location'} · ${row.status}`);
        }

        const found = Array.from(groups.values());
        if (!found.length) {
          return {
            tool: name, ok: true,
            summary: `Nobody called "${person}" appears as staff, a client contact, or a client record. They are not in the system yet.`,
            data: { people: [] },
          };
        }
        const lines = found.map((entry) => {
          const roles = entry.roles.length ? entry.roles.join(' and ') : 'no role recorded';
          const notes = entry.notes.length ? ` — ${entry.notes.join('; ')}` : '';
          return `- ${entry.name}: ${roles}${notes}`;
        });
        const multiple = found.filter((entry) => entry.roles.length > 1).length;
        return {
          tool: name, ok: true,
          summary: `${found.length} match(es) for "${person}":\n${lines.join('\n')}${multiple ? `\n${multiple} of them hold more than one role.` : ''}`,
          data: { people: found },
        };
      }

      case 'find_client': {
        if (!canManageClients(session)) return deny(name, ['manage_clients']);
        const rows = await findClientRows(str('query'), str('include_deleted') === 'true');
        if (!rows.length) {
          return { tool: name, ok: true, summary: 'No client records match that search. The register may be empty.', data: [] };
        }
        const lines = rows.map((row) => {
          const bits = [`id ${row.id}`, row.industry, row.location, row.status];
          if (row.relationship_type === 'vendor') bits.push('paid by BKM');
          if (row.deleted_at) bits.push('DELETED');
          return `- ${row.name} (${bits.filter(Boolean).join(', ')})`;
        });
        return {
          tool: name, ok: true,
          summary: `${rows.length} record(s) found:\n${lines.join('\n')}`,
          data: rows,
        };
      }

      case 'client_health_report': {
        if (!canManageClients(session)) return deny(name, ['manage_clients']);
        const findings = await healthFindings();
        const problems =
          findings.noContact.length + findings.noCharge.length + findings.duplicates.length +
          findings.unassignedDocuments + findings.orphanedDocuments.length;
        const summary = problems === 0
          ? `The register looks healthy: ${findings.totals.clients} client(s), every one with a primary contact and a service charge, and no unassigned uploads.`
          : [
              `Found ${problems} thing(s) worth fixing across ${findings.totals.clients} client(s):`,
              findings.noContact.length ? `- ${findings.noContact.length} record(s) have no primary contact: ${findings.noContact.map((r) => r.name).join(', ')}` : '',
              findings.noCharge.length ? `- ${findings.noCharge.length} record(s) have no service charge recorded: ${findings.noCharge.map((r) => r.name).join(', ')}` : '',
              findings.payableWithoutService.length ? `- ${findings.payableWithoutService.length} record(s) are marked paid by BKM but have nothing to pay for: ${findings.payableWithoutService.map((r) => r.name).join(', ')}` : '',
              findings.duplicates.length ? `- ${findings.duplicates.length} possible duplicate pair(s): ${findings.duplicates.map(([a, b]) => `${a} / ${b}`).join('; ')}` : '',
              findings.orphanedDocuments.length ? `- ${findings.orphanedDocuments.length} document(s) point at a client record that no longer exists` : '',
              findings.unassignedDocuments ? `- ${findings.unassignedDocuments} uploaded document(s) belong to no client record` : '',
            ].filter(Boolean).join('\n');
        return { tool: name, ok: true, summary, data: findings };
      }

      case 'propose_create_client': {
        if (!canManageClients(session)) return deny(name, ['manage_clients']);
        const orgName = str('name');
        if (!orgName) return { tool: name, ok: false, summary: 'A name is required before a record can be proposed.' };

        // Refuse to propose a duplicate; the database would reject it anyway,
        // but saying so now saves the human a wasted confirmation.
        const existing = await findClientRows(orgName, true);
        const clash = existing.find((row) => row.name.toLowerCase() === orgName.toLowerCase());
        if (clash) {
          return {
            tool: name, ok: true,
            summary: `"${clash.name}" already exists (id ${clash.id}). I will not propose a duplicate — update the existing record instead.`,
            data: clash,
          };
        }

        const relationship = str('relationship') === 'vendor' ? 'vendor' : 'serviced';
        const amount = str('amount').replace(/[^0-9.]/g, '');
        const payload = {
          name: orgName,
          industry: str('industry'),
          location: str('location'),
          contactName: str('contact_name'),
          contactEmail: str('contact_email'),
          contactPhone: str('contact_phone'),
          description: str('description'),
          relationship,
          serviceName: str('service_name'),
          amount: amount ? Number(amount) : null,
          billingFrequency: str('billing_frequency') || 'monthly',
        };
        const missing = ['industry', 'location', 'contactName', 'contactEmail'].filter((key) => !payload[key as keyof typeof payload]);
        return {
          tool: name, ok: true, pending: true,
          summary: missing.length
            ? `Ready to propose "${orgName}", but I still need: ${missing.join(', ')}. Ask for these before confirming.`
            : `Proposed "${orgName}" as a ${relationship === 'vendor' ? 'supplier that BKM pays' : 'client that BKM services'}. Nothing has been saved — confirm to create it.`,
          proposal: { action: 'create_client', label: `Create ${orgName}`, payload: { ...payload, missing } },
        };
      }

      case 'propose_update_client': {
        if (!canManageClients(session)) return deny(name, ['manage_clients']);
        const clientId = str('client_id');
        const admin = db();
        const { data: row } = await admin.from('clients').select('id, name, industry, location, description, status').eq('id', clientId).maybeSingle();
        if (!row) return { tool: name, ok: false, summary: 'No client record has that id. Use find_client to get the right one.' };
        const patch: Record<string, string> = {};
        for (const key of ['name', 'industry', 'location', 'description', 'status'] as const) {
          const value = str(key);
          if (value && value !== String((row as Record<string, unknown>)[key] ?? '')) patch[key] = value;
        }
        if (!Object.keys(patch).length) {
          return { tool: name, ok: true, summary: `Nothing to change on "${row.name}" — the values you gave match the record.` };
        }
        return {
          tool: name, ok: true, pending: true,
          summary: `Proposed ${Object.keys(patch).length} change(s) to "${row.name}": ${Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(', ')}. Nothing saved yet.`,
          proposal: { action: 'update_client', label: `Update ${row.name}`, payload: { clientId, patch, current: row } },
        };
      }

      case 'propose_delete_client': {
        if (!canManageClients(session)) return deny(name, ['manage_clients']);
        const clientId = str('client_id');
        const admin = db();
        const { data: row } = await admin.from('clients').select('id, name, deleted_at').eq('id', clientId).maybeSingle();
        if (!row) return { tool: name, ok: false, summary: 'No client record has that id. Use find_client first.' };
        if (row.deleted_at) return { tool: name, ok: true, summary: `"${row.name}" is already removed. It can be restored.` };
        return {
          tool: name, ok: true, pending: true,
          summary: `Proposed removing "${row.name}". This is a soft delete: the record is hidden but recoverable. Nothing removed yet.`,
          proposal: { action: 'delete_client', label: `Remove ${row.name}`, payload: { clientId, name: row.name, reason: str('reason') } },
        };
      }

      default:
        return { tool: name, ok: false, summary: `Unknown tool: ${name}.` };
    }
  } catch (error) {
    return { tool: name, ok: false, summary: error instanceof Error ? error.message : 'The tool failed.' };
  }
}
