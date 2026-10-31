const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
async function client(account) {
  let cookie = '';
  async function request(path, options = {}) {
    const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) };
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { response, body };
  }
  const login = await request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ account }) });
  if (!login.response.ok) throw new Error(`${account} login failed`);
  return request;
}
const david = await client('david');
const benjamin = await client('benjamin');
const faith = await client('faith');
const clientMessageId = `focused-private-${Date.now()}`;
const sent = await david('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: 'benjamin', body: 'Focused private message test', clientMessageId }) });
if (sent.response.status !== 201 || sent.body.kind !== 'private') throw new Error('Private message send failed.');
const duplicate = await david('/api/messages', { method: 'POST', body: JSON.stringify({ recipientId: 'benjamin', body: 'Focused private message test', clientMessageId }) });
if (duplicate.body.message.id !== sent.body.message.id) throw new Error('Duplicate message prevention failed.');
const inbox = await benjamin('/api/messages');
const conversation = inbox.body.conversations.find((item) => item.id === sent.body.message.conversationId);
if (!conversation || conversation.unreadCount < 1) throw new Error('Recipient unread count failed.');
const notifications = await benjamin('/api/notifications?unread=true');
if (notifications.body.unreadCount < 1 || !notifications.body.notifications.some((item) => item.relatedId === conversation.id)) throw new Error('Recipient notification failed.');
const opened = await benjamin(`/api/messages?conversationId=${encodeURIComponent(conversation.id)}`);
if (opened.response.status !== 200 || opened.body.messages.length < 1) throw new Error('Participant conversation read failed.');
const marked = await benjamin('/api/messages', { method: 'PATCH', body: JSON.stringify({ conversationId: conversation.id }) });
if (!marked.response.ok) throw new Error('Conversation read-state update failed.');
const afterRead = await benjamin('/api/notifications?unread=true');
if (afterRead.body.notifications.some((item) => item.relatedId === conversation.id)) throw new Error('Notification remained unread after opening conversation.');
const forbidden = await faith(`/api/messages?conversationId=${encodeURIComponent(conversation.id)}`);
if (forbidden.response.status !== 403) throw new Error('Unrelated staff member accessed a private conversation.');
console.log('PASS: private messaging, notifications, read state, duplicate prevention, and participant isolation');
