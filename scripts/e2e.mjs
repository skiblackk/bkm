const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
let cookie = '';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function request(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(options.headers || {}) };
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}
const login = await request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ account: 'benjamin' }) }); assert(login.response.ok && login.body.session.isAdmin, 'Benjamin admin login failed');
const protectedDataBeforeLogin = await (async () => { const saved = cookie; cookie = ''; const result = await request('/api/data'); cookie = saved; return result; })(); assert(protectedDataBeforeLogin.response.status === 401, 'Unauthenticated data access should be blocked');
const assistantAnswer = await request('/api/assistant', { method: 'POST', body: JSON.stringify({ question: 'Who is late today?' }) }); assert(assistantAnswer.response.ok && assistantAnswer.body.answer.includes('Mary Wanjiku'), 'Assistant answer is not grounded in named attendance records');
assert(assistantAnswer.body.recordCount > 0, 'Assistant should return supporting records');
assert(beforeAccountingIsBalanced(await request('/api/data')), 'Accounting balance sheet should balance');
const before = await request('/api/admin'); assert(before.response.ok && Array.isArray(before.body.audit), 'Admin audit payload missing');
const created = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'create-user', name: 'E2E User', email: 'e2e@example.com', role: 'Viewer', permissions: ['view_dashboard', 'send_messages'] }) }); assert(created.response.ok && created.body.user.role === 'Viewer', 'User provisioning failed');
const task = created.body.snapshot.tasks.find((item) => item.assignedTo !== created.body.user.staffId); const assigned = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'assign-task', taskId: task.id, staffId: created.body.user.staffId }) }); assert(assigned.response.ok, 'Task assignment failed');
const message = await request('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: created.body.user.staffId, body: 'E2E message' }) }); assert(message.response.ok, 'Direct chat message failed');
const accounts = await fetch(`${base}/api/auth/accounts`).then((r) => r.json()); const provisioned = accounts.accounts.find((item) => item.email === 'e2e@example.com'); assert(provisioned, 'Provisioned user is not discoverable');
const userLogin = await request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ account: provisioned.account }) }); assert(userLogin.response.ok && !userLogin.body.session.isAdmin, 'Provisioned user login failed');
const userData = await request('/api/data'); assert(userData.response.ok && !userData.body.attendance.checkIn, 'New user should start unchecked-in');
const checkIn = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'attendance', mode: 'check-in', staffId: provisioned.staffId }) }); assert(checkIn.response.ok, 'User check-in failed');
const duplicateCheckIn = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'attendance', mode: 'check-in', staffId: provisioned.staffId }) }); assert(duplicateCheckIn.response.status === 400, 'Duplicate check-in should be rejected');
const checkOut = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'attendance', mode: 'check-out', staffId: provisioned.staffId }) }); assert(checkOut.response.ok, 'User check-out failed');
const duplicateCheckOut = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'attendance', mode: 'check-out', staffId: provisioned.staffId }) }); assert(duplicateCheckOut.response.status === 400, 'Duplicate check-out should be rejected');
const userMessage = await request('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: 'benjamin', body: 'I have checked in.' }) }); assert(userMessage.response.ok, 'User direct message failed');
const broadcast = await request('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: 'all', body: 'Not allowed' }) }); assert(broadcast.response.status === 403, 'Normal user broadcast should be blocked');
function beforeAccountingIsBalanced(result) { const accounting = result.body.accounting; return result.response.ok && accounting?.balanceSheet?.balanced && accounting.trialBalance.reduce((sum, item) => sum + item.debit, 0) === accounting.trialBalance.reduce((sum, item) => sum + item.credit, 0); }
console.log('E2E PASS: protected APIs, grounded assistant, accounting balance, provisioning, task assignment, duplicate attendance protection, direct chat and broadcast protection');
