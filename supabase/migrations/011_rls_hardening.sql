-- 011_rls_hardening.sql — re-key policies to the granular catalogue, close the
-- broad permissive policies left by 005, and enforce participant-only
-- messaging, own-record attendance and confidential-document separation.
-- Additive and idempotent. App traffic continues through the service role with
-- server-side permission checks; these policies govern direct PostgREST
-- access with user tokens.

-- Confidential-document flag (storage buckets are not used; documents are
-- metadata records, so the flag lives here).
alter table public.documents add column if not exists is_confidential boolean not null default false;
alter table public.documents add column if not exists updated_at timestamptz not null default now();

-- Helper: engagement membership check used by task/document scoping.
create or replace function public.current_user_in_engagement(target_engagement_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select target_engagement_id is not null and exists (
    select 1 from public.engagement_members em
    where em.engagement_id = target_engagement_id and em.profile_id = auth.uid()
  );
$$;
revoke all on function public.current_user_in_engagement(uuid) from public;
grant execute on function public.current_user_in_engagement(uuid) to authenticated, service_role;

-- 1. Internal messages: only the sender, the recipient, or broadcasts. ------
drop policy if exists "authenticated users can read internal messages" on public.internal_messages;
drop policy if exists "authenticated users can send internal messages" on public.internal_messages;
create policy "participants read internal messages" on public.internal_messages
  for select to authenticated using (
    sender_id = auth.uid()::text or recipient_id = auth.uid()::text or (recipient_id = 'all' and public.current_user_is_active())
  );
create policy "users send internal messages as themselves" on public.internal_messages
  for insert to authenticated with check (
    sender_id = auth.uid()::text
    and (recipient_id <> 'all' or public.current_user_has_permission('post_announcements'))
  );

-- 2. Attendance: own records always; team records only with permission. -----
drop policy if exists "permissioned users can read attendance" on public.attendance_records;
create policy "own attendance is visible" on public.attendance_records
  for select to authenticated using (
    staff_id = auth.uid()
    or public.current_user_has_permission('view_team_attendance')
    or public.current_user_has_permission('manage_attendance')
    or public.current_user_has_permission('view_hr_reports')
  );
drop policy if exists "attendance writes" on public.attendance_records;
create policy "own attendance writes" on public.attendance_records
  for insert to authenticated with check (
    staff_id = auth.uid() or public.current_user_has_permission('manage_attendance')
  );
create policy "attendance corrections" on public.attendance_records
  for update to authenticated using (
    staff_id = auth.uid() or public.current_user_has_permission('manage_attendance')
  );

-- 3. Tasks and comments: assigned, engagement team, or team-task permission. -
drop policy if exists "permissioned users can read tasks" on public.tasks;
create policy "task visibility" on public.tasks
  for select to authenticated using (
    assigned_to = auth.uid()
    or public.current_user_in_engagement(engagement_id)
    or public.current_user_has_permission('edit_team_tasks')
    or public.current_user_has_permission('manage_tasks')
    or public.current_user_has_permission('assign_tasks')
    or public.current_user_is_admin()
  );
drop policy if exists "permissioned users can read task comments" on public.task_comments;
create policy "task comment visibility" on public.task_comments
  for select to authenticated using (
    author_id = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_comments.task_id and (t.assigned_to = auth.uid() or public.current_user_in_engagement(t.engagement_id)))
    or public.current_user_has_permission('edit_team_tasks')
    or public.current_user_has_permission('manage_tasks')
  );

-- 4. Documents: permitted readers; confidential needs explicit permission. --
drop policy if exists "permissioned users can read documents" on public.documents;
create policy "document visibility" on public.documents
  for select to authenticated using (
    (uploaded_by = auth.uid() and public.current_user_has_permission('view_documents'))
    or (not is_confidential and (public.current_user_has_permission('view_documents') or public.current_user_has_permission('manage_documents')))
    or (is_confidential and public.current_user_has_permission('view_confidential_documents'))
    or public.current_user_can_access_resource('document', id, 'view')
    or public.current_user_in_engagement(engagement_id)
  );

-- 5. Activity and audit: own activity or audit-log permission. --------------
drop policy if exists "permissioned users can read activity" on public.activity_logs;
create policy "own activity visible" on public.activity_logs
  for select to authenticated using (
    actor_id = auth.uid()
    or public.current_user_has_permission('view_audit_logs')
    or public.current_user_is_admin()
  );

-- 6. Clients and engagements stay internal (accounting/audit/advisory). ----
drop policy if exists "permissioned users can read workspace records" on public.clients;
create policy "engagement readers see clients" on public.clients
  for select to authenticated using (
    public.current_user_has_permission('view_engagements')
    or public.current_user_has_permission('manage_engagements')
    or public.current_user_has_permission('manage_clients')
  );
drop policy if exists "permissioned users can read engagements" on public.engagements;
create policy "engagement visibility" on public.engagements
  for select to authenticated using (
    public.current_user_has_permission('view_engagements')
    or public.current_user_has_permission('manage_engagements')
    or public.current_user_has_permission('manage_clients')
    or public.current_user_in_engagement(id)
  );

-- 7. Profiles: users may update their own non-privileged fields. ------------
drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 8. Roles and user_permissions: only permission managers write. ------------
drop policy if exists "administrators can manage roles" on public.roles;
create policy "administrators can manage roles" on public.roles
  for all to authenticated using (public.current_user_has_permission('manage_roles'))
  with check (public.current_user_has_permission('manage_roles'));

-- 9. Financial records: finance permission plus SoD on approval paths. ------
-- (journal_entries_sod_guard from 009 enforces creator-distinct approval.)
drop policy if exists "permissioned users can read journal entries" on public.journal_entries;
create policy "finance readers see journal entries" on public.journal_entries
  for select to authenticated using (public.current_user_has_permission('view_finance') or public.current_user_has_permission('view_financial_reports'));
drop policy if exists "permissioned users can read journal lines" on public.journal_entry_lines;
create policy "finance readers see journal lines" on public.journal_entry_lines
  for select to authenticated using (public.current_user_has_permission('view_finance') or public.current_user_has_permission('view_financial_reports'));

-- 10. Enable RLS on the communication triage tables. ------------------------
alter table public.bkm_triage_cases enable row level security;
alter table public.bkm_triage_drafts enable row level security;
alter table public.bkm_triage_events enable row level security;
drop policy if exists "communication managers read triage" on public.bkm_triage_cases;
create policy "communication managers read triage" on public.bkm_triage_cases
  for select to authenticated using (
    public.current_user_has_permission('manage_communication_settings')
    or public.current_user_has_permission('post_announcements')
    or public.current_user_is_admin()
  );
drop policy if exists "communication managers read drafts" on public.bkm_triage_drafts;
create policy "communication managers read drafts" on public.bkm_triage_drafts
  for select to authenticated using (
    public.current_user_has_permission('manage_communication_settings')
    or public.current_user_has_permission('post_announcements')
    or public.current_user_is_admin()
  );
drop policy if exists "communication managers read triage events" on public.bkm_triage_events;
create policy "communication managers read triage events" on public.bkm_triage_events
  for select to authenticated using (
    public.current_user_has_permission('manage_communication_settings')
    or public.current_user_is_admin()
  );
