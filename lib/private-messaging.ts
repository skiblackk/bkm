import type { NotificationRecord, PrivateConversation, PrivateMessage } from './types';

const conversations: PrivateConversation[] = [];
const messages: PrivateMessage[] = [];
const notifications: NotificationRecord[] = [];

function conversationIdFor(a: string, b: string) {
  return `conversation-${[a, b].sort().join('--')}`;
}

export function listPrivateConversations(participantId: string) {
  return conversations
    .filter((conversation) => conversation.participantIds.includes(participantId))
    .map((conversation) => {
      const latest = messages.filter((message) => message.conversationId === conversation.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const unreadCount = messages.filter((message) => message.conversationId === conversation.id && message.recipientId === participantId && !message.readAt).length;
      return { ...conversation, latestMessage: latest ?? null, unreadCount };
    })
    .sort((a, b) => (b.latestMessage?.createdAt ?? '').localeCompare(a.latestMessage?.createdAt ?? ''));
}

export function getPrivateConversation(conversationId: string, participantId: string) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation || !conversation.participantIds.includes(participantId)) throw new Error('You are not a participant in this conversation.');
  return { conversation, messages: messages.filter((message) => message.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
}

export function sendPrivateMessage(input: { senderId: string; senderName: string; recipientId: string; recipientName: string; body: string; clientMessageId?: string }) {
  const body = input.body.trim();
  if (!body) throw new Error('Message cannot be empty.');
  if (body.length > 4000) throw new Error('Message must be 4,000 characters or fewer.');
  const conversationId = conversationIdFor(input.senderId, input.recipientId);
  let conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    conversation = { id: conversationId, participantIds: [input.senderId, input.recipientId], participantNames: { [input.senderId]: input.senderName, [input.recipientId]: input.recipientName }, createdAt: new Date().toISOString() };
    conversations.push(conversation);
  }
  if (input.clientMessageId) {
    const existing = messages.find((message) => message.clientMessageId === input.clientMessageId && message.senderId === input.senderId);
    if (existing) return existing;
  }
  const message: PrivateMessage = { id: `private-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, conversationId, senderId: input.senderId, senderName: input.senderName, recipientId: input.recipientId, recipientName: input.recipientName, body, createdAt: new Date().toISOString(), readAt: null, clientMessageId: input.clientMessageId };
  messages.push(message);
  const notificationKey = `private-message:${message.id}`;
  if (!notifications.some((notification) => notification.dedupeKey === notificationKey)) notifications.unshift({ id: `notification-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, recipientId: input.recipientId, category: 'Message', priority: 'Normal', title: `New message from ${input.senderName}`, body: body.length > 120 ? `${body.slice(0, 117)}…` : body, createdAt: message.createdAt, isRead: false, linkPath: `/messages?conversation=${conversationId}`, relatedType: 'Conversation', relatedId: conversationId, dedupeKey: notificationKey });
  return message;
}

export function markConversationRead(conversationId: string, participantId: string) {
  const result = getPrivateConversation(conversationId, participantId);
  const now = new Date().toISOString();
  result.messages.forEach((message) => { if (message.recipientId === participantId && !message.readAt) message.readAt = now; });
  notifications.forEach((notification) => { if (notification.recipientId === participantId && notification.relatedId === conversationId) notification.isRead = true; });
  return getPrivateConversation(conversationId, participantId);
}

export function listNotifications(recipientId: string, unreadOnly = false) {
  return notifications.filter((notification) => notification.recipientId === recipientId && (!unreadOnly || !notification.isRead)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export function setNotificationRead(notificationId: string, recipientId: string, isRead: boolean) {
  const notification = notifications.find((item) => item.id === notificationId && item.recipientId === recipientId);
  if (!notification) throw new Error('Notification was not found.');
  notification.isRead = isRead;
  return notification;
}

export function markAllNotificationsRead(recipientId: string) {
  notifications.forEach((notification) => { if (notification.recipientId === recipientId) notification.isRead = true; });
  return listNotifications(recipientId);
}
