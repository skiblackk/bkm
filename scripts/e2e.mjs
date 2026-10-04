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
const before = await request('/api/admin'); assert(before.response.ok && Array.isArray(before.body.audit), 'Admin audit payload missing');
const created = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'create-user', name: 'E2E User', email: 'e2e@example.com', role: 'Viewer', permissions: ['view_dashboard', 'send_messages'] }) }); assert(created.response.ok && created.body.user.role === 'Viewer', 'User provisioning failed');
const task = created.body.snapshot.tasks.find((item) => item.assignedTo !== created.body.user.staffId); const assigned = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'assign-task', taskId: task.id, staffId: created.body.user.staffId }) }); assert(assigned.response.ok, 'Task assignment failed');
const message = await request('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: created.body.user.staffId, body: 'E2E message' }) }); assert(message.response.ok, 'Direct chat message failed');
const accounts = await fetch(`${base}/api/auth/accounts`).then((r) => r.json()); const provisioned = accounts.accounts.find((item) => item.email === 'e2e@example.com'); assert(provisioned, 'Provisioned user is not discoverable');
const userLogin = await request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ account: provisioned.account }) }); assert(userLogin.response.ok && !userLogin.body.session.isAdmin, 'Provisioned user login failed');
const userData = await request('/api/data'); assert(userData.response.ok && !userData.body.attendance.checkIn, 'New user should start unchecked-in');
const checkIn = await request('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'attendance', mode: 'check-in', staffId: provisioned.staffId }) }); assert(checkIn.response.ok, 'User check-in failed');
const userMessage = await request('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: 'benjamin', body: 'I have checked in.' }) }); assert(userMessage.response.ok, 'User direct message failed');
const broadcast = await request('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: 'all', body: 'Not allowed' }) }); assert(broadcast.response.status === 403, 'Normal user broadcast should be blocked');
console.log('E2E PASS: Benjamin login, user provisioning, check-in, task assignment, direct chat and broadcast protection');
