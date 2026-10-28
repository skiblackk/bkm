const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const failures = [];
async function client(account) {
  let cookie = '';
  async function request(path, options = {}) {
    const isForm = options.body instanceof FormData;
    const headers = { ...(options.body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) };
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { response, body };
  }
  const login = await request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ account }) });
  if (!login.response.ok) throw new Error(`${account} login failed`);
  return request;
}
async function check(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : error}`); console.log(`FAIL ${name}`); } }
const admin = await client('benjamin');
const user = await client('david');
await check('client create and duplicate rejection', async () => {
  const unique = Date.now(); const input = { action: 'createClient', name: `Acceptance Client ${unique}`, industry: 'Technology', location: 'Nairobi', contactName: 'Test Contact', contactEmail: `test-${unique}@example.com`, contactPhone: '0700000000', description: 'Acceptance' };
  const created = await admin('/api/actions', { method: 'POST', body: JSON.stringify(input) }); if (created.response.status !== 200) throw new Error(JSON.stringify(created.body));
  const duplicate = await admin('/api/actions', { method: 'POST', body: JSON.stringify(input) }); if (duplicate.response.status !== 400) throw new Error('duplicate was accepted');
});
await check('task create and update', async () => {
  const created = await admin('/api/actions', { method: 'POST', body: JSON.stringify({ action: 'createTask', title: `Acceptance Task ${Date.now()}`, description: 'Acceptance', clientId: 'client-abc', engagementId: 'eng-abc', assignedTo: 'staff-mary', priority: 'High', dueDate: '2026-10-08' }) });
  if (created.response.status !== 200) throw new Error(JSON.stringify(created.body)); const task = created.body.snapshot.tasks.at(-1);
  const updated = await admin('/api/actions', { method: 'POST', body: JSON.stringify({ action: 'updateTask', taskId: task.id, status: 'Completed' }) }); if (updated.response.status !== 200 || updated.body.snapshot.tasks.find((item) => item.id === task.id)?.status !== 'Completed') throw new Error(JSON.stringify(updated.body));
});
await check('quotation creation', async () => { const result = await admin('/api/actions', { method: 'POST', body: JSON.stringify({ action: 'createQuotation', clientId: 'client-abc', service: 'Audit & Assurance', description: 'Acceptance quotation', terms: '30 days', items: [{ id: `item-${Date.now()}`, description: 'Audit', quantity: 1, unitPrice: 1000 }] }) }); if (result.response.status !== 200 || !result.body.snapshot.quotations.length) throw new Error(JSON.stringify(result.body)); });
await check('report generation', async () => { const result = await admin('/api/actions', { method: 'POST', body: JSON.stringify({ action: 'createReport', clientId: 'client-abc', engagementId: 'eng-abc', reportType: 'Acceptance report' }) }); if (result.response.status !== 200 || !result.body.report) throw new Error(JSON.stringify(result.body)); });
await check('authenticated financial PDF and Excel exports', async () => { for (const format of ['pdf', 'xlsx']) { const result = await admin(`/api/exports/financial?format=${format}`); const type = result.response.headers.get('content-type') ?? ''; if (result.response.status !== 200 || !type.includes(format === 'pdf' ? 'application/pdf' : 'spreadsheet')) throw new Error(`${format}: ${result.response.status} ${type}`); } });
await check('document upload and scan', async () => { const form = new FormData(); form.set('clientId', 'client-abc'); form.set('clientName', 'Acceptance Client'); form.set('file', new Blob(['Date,Description,Amount\n2026-10-01,Test,1000'], { type: 'text/csv' }), 'acceptance.csv'); const result = await admin('/api/documents', { method: 'POST', body: form }); if (result.response.status !== 201 || !result.body.document?.summary || !result.body.document?.keyFields?.length) throw new Error(JSON.stringify(result.body)); });
await check('normal user cannot access admin API', async () => { const result = await user('/api/admin'); if (result.response.status !== 403) throw new Error(`status ${result.response.status}`); });
await check('Respond.io integration status route', async () => { const result = await admin('/api/integrations/respondio/gmail'); if (![200, 503].includes(result.response.status)) throw new Error(`status ${result.response.status}`); });
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); }
console.log('CORE ACCEPTANCE PASS');
