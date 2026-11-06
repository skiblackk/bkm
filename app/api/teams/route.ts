import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { recordAudit } from '@/lib/data-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isProductionDataMode } from '@/lib/runtime-mode';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!isProductionDataMode) return NextResponse.json({ teams: [] });
  const admin = db();
  const { data: memberships } = await admin.from('team_members').select('team_id').eq('user_id', session.account);
  const teamIds = (memberships ?? []).map((row: { team_id: string }) => row.team_id);
  const { data: teams } = await admin.from('teams').select('*, team_members(user_id, team_role)').order('name');
  const visible = (teams ?? []).filter((team: { id: string; visibility: string }) => session.isAdmin || team.visibility === 'organisation' || teamIds.includes(team.id));
  return NextResponse.json({ teams: visible });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!isProductionDataMode) return NextResponse.json({ error: 'Teams are available in production mode.' }, { status: 400 });
  try {
    const input = await request.json();
    const admin = db();
    if (input.action === 'create') {
      if (!hasPermission(session, 'create_teams') && !hasPermission(session, 'manage_teams')) return NextResponse.json({ error: 'Permission required: create_teams.' }, { status: 403 });
      const visibility = ['private', 'team', 'organisation'].includes(input.visibility) ? input.visibility : 'team';
      if (visibility === 'organisation' && !hasPermission(session, 'manage_teams') && !session.isAdmin) return NextResponse.json({ error: 'Organisation-wide teams require the manage-teams permission.' }, { status: 403 });
      const { data: team, error } = await admin.from('teams').insert({ name: String(input.name ?? '').trim().slice(0, 120), description: String(input.description ?? '').slice(0, 1000), created_by: session.account, visibility }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await admin.from('team_members').insert({ team_id: team.id, user_id: session.account, team_role: 'team_owner' });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'create_team', targetType: 'Team', targetId: team.id, detail: `Team ${team.name} created (${visibility})`, severity: 'change' });
      return NextResponse.json({ team }, { status: 201 });
    }
    if (input.action === 'add-member' || input.action === 'remove-member') {
      const teamId = String(input.teamId ?? '');
      const userId = String(input.userId ?? '');
      const { data: membership } = await admin.from('team_members').select('team_role').eq('team_id', teamId).eq('user_id', session.account).maybeSingle();
      const isOwner = membership && ['team_owner', 'team_manager'].includes((membership as { team_role: string }).team_role);
      if (!isOwner && !hasPermission(session, 'manage_teams') && !session.isAdmin) return NextResponse.json({ error: 'Team owners and managers manage membership.' }, { status: 403 });
      if (input.action === 'add-member') {
        const teamRole = ['team_owner', 'team_manager'].includes(input.teamRole) && (hasPermission(session, 'manage_teams') || session.isAdmin) ? input.teamRole : 'team_member';
        const { error } = await admin.from('team_members').upsert({ team_id: teamId, user_id: userId, team_role: teamRole }, { onConflict: 'team_id,user_id' });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      } else {
        await admin.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
      }
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: input.action, targetType: 'Team', targetId: teamId, detail: `${input.action}: ${userId}`, severity: 'change' });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported teams action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Team action failed.' }, { status: 400 });
  }
}
