import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { recordAudit } from '@/lib/data-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  const admin = db();
  const { data: memberships } = await admin.from('project_members').select('project_id').eq('user_id', session.account);
  const projectIds = (memberships ?? []).map((row: { project_id: string }) => row.project_id);
  const { data: projects } = await admin.from('projects').select('*, project_members(user_id, project_role), teams(name)').order('created_at', { ascending: false });
  const visible = (projects ?? []).filter((project: { id: string; owner_id: string; visibility: string; team_id: string | null }) => {
    if (session.isAdmin || project.owner_id === session.account || projectIds.includes(project.id)) return true;
    return project.visibility === 'organisation';
  });
  return NextResponse.json({ projects: visible });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
 
  try {
    const input = await request.json();
    const admin = db();
    if (input.action === 'create') {
      if (!hasPermission(session, 'create_projects') && !hasPermission(session, 'manage_projects') && !session.isAdmin) return NextResponse.json({ error: 'Permission required: create_projects.' }, { status: 403 });
      const visibility = ['private', 'team', 'organisation'].includes(input.visibility) ? input.visibility : 'team';
      if (visibility === 'organisation' && !hasPermission(session, 'manage_projects') && !session.isAdmin) return NextResponse.json({ error: 'Organisation-wide projects require the manage-projects permission.' }, { status: 403 });
      const teamId = input.teamId ? String(input.teamId) : null;
      const { data: project, error } = await admin.from('projects').insert({
        name: String(input.name ?? '').trim().slice(0, 120), description: String(input.description ?? '').slice(0, 1000),
        owner_id: session.account, team_id: teamId, visibility,
      }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await admin.from('project_members').insert({ project_id: project.id, user_id: session.account, project_role: 'owner', added_by: session.account });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'create_project', targetType: 'Project', targetId: project.id, detail: `Project ${project.name} created (${visibility})`, severity: 'change' });
      return NextResponse.json({ project }, { status: 201 });
    }
    if (input.action === 'add-member' || input.action === 'remove-member') {
      const projectId = String(input.projectId ?? '');
      const userId = String(input.userId ?? '');
      const { data: membership } = await admin.from('project_members').select('project_role').eq('project_id', projectId).eq('user_id', session.account).maybeSingle();
      const { data: project } = await admin.from('projects').select('owner_id').eq('id', projectId).maybeSingle();
      const canManage = (project && (project as { owner_id: string }).owner_id === session.account) || (membership && ['owner', 'manager'].includes((membership as { project_role: string }).project_role)) || hasPermission(session, 'manage_project_members') || session.isAdmin;
      if (!canManage) return NextResponse.json({ error: 'Project owners and managers manage membership.' }, { status: 403 });
      if (input.action === 'add-member') {
        const projectRole = ['owner', 'manager'].includes(input.projectRole) && (hasPermission(session, 'manage_project_members') || session.isAdmin) ? input.projectRole : 'member';
        const { error } = await admin.from('project_members').upsert({ project_id: projectId, user_id: userId, project_role: projectRole, added_by: session.account }, { onConflict: 'project_id,user_id' });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      } else {
        await admin.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId);
      }
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: input.action, targetType: 'Project', targetId: projectId, detail: `${input.action}: ${userId}`, severity: 'change' });
      return NextResponse.json({ ok: true });
    }
    if (input.action === 'archive') {
      const projectId = String(input.projectId ?? '');
      const { data: project } = await admin.from('projects').select('owner_id, name').eq('id', projectId).maybeSingle();
      if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
      const canArchive = (project as { owner_id: string }).owner_id === session.account || hasPermission(session, 'manage_projects') || session.isAdmin;
      if (!canArchive) return NextResponse.json({ error: 'Project owners archive their projects.' }, { status: 403 });
      await admin.from('projects').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', projectId);
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'archive_project', targetType: 'Project', targetId: projectId, detail: `Project ${(project as { name: string }).name} archived`, severity: 'change' });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported projects action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Project action failed.' }, { status: 400 });
  }
}
