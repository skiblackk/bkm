import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { listNotifications, markAllNotificationsRead, setNotificationRead } from '@/lib/private-messaging';

function recipientId(session: Awaited<ReturnType<typeof getDemoSession>>) { return session?.staffId ?? session?.account ?? ''; }

export async function GET(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  const unreadOnly = new URL(request.url).searchParams.get('unread') === 'true';
  const items = listNotifications(recipientId(session), unreadOnly);
  return NextResponse.json({ notifications: items, unreadCount: listNotifications(recipientId(session), true).length });
}

export async function PATCH(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  try {
    const input = await request.json() as { notificationId?: string; isRead?: boolean; markAllRead?: boolean };
    const id = recipientId(session);
    if (input.markAllRead) return NextResponse.json({ notifications: markAllNotificationsRead(id), unreadCount: 0 });
    if (!input.notificationId) return NextResponse.json({ error: 'A notification is required.' }, { status: 400 });
    const notification = setNotificationRead(input.notificationId, id, input.isRead !== false);
    return NextResponse.json({ notification, unreadCount: listNotifications(id, true).length });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Notification update failed.' }, { status: 403 }); }
}
