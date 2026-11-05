-- Production authorization hardening. Apply only after profiles and user_permissions are populated.
create or replace function public.current_profile_has_permission(permission_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.user_permissions up
    where up.user_id = auth.uid()
      and up.permission_key = current_profile_has_permission.permission_key
  );
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and r.name in ('CEO', 'Administrator', 'System Administrator')
  );
$$;

-- Remove the initial broad read policies before adding least-privilege replacements.
drop policy if exists "authenticated users can read workspace records" on public.clients;
drop policy if exists "authenticated users can read client contacts" on public.client_contacts;
drop policy if exists "authenticated users can read engagements" on public.engagements;
drop policy if exists "authenticated users can read engagement members" on public.engagement_members;
drop policy if exists "authenticated users can read tasks" on public.tasks;
drop policy if exists "authenticated users can read task comments" on public.task_comments;
drop policy if exists "authenticated users can read documents" on public.documents;
drop policy if exists "authenticated users can read quotations" on public.quotations;
drop policy if exists "authenticated users can read quotation items" on public.quotation_items;
drop policy if exists "authenticated users can read reports" on public.reports;
drop policy if exists "authenticated users can read activity" on public.activity_logs;
drop policy if exists "authenticated users can read attendance" on public.attendance_records;
drop policy if exists "authenticated users can read attendance settings" on public.attendance_settings;
drop policy if exists "authenticated users can read accounting records" on public.accounting_accounts;
drop policy if exists "authenticated users can read accounting periods" on public.accounting_periods;
drop policy if exists "authenticated users can read journal entries" on public.journal_entries;
drop policy if exists "authenticated users can read journal lines" on public.journal_entry_lines;
drop policy if exists "authenticated users can read document extractions" on public.document_extractions;
drop policy if exists "authenticated users can read notifications" on public.notifications;

create policy "permissioned users can read workspace records" on public.clients for select to authenticated using (public.current_profile_has_permission('view_dashboard'));
create policy "permissioned users can read client contacts" on public.client_contacts for select to authenticated using (public.current_profile_has_permission('manage_clients'));
create policy "permissioned users can read engagements" on public.engagements for select to authenticated using (public.current_profile_has_permission('view_dashboard'));
create policy "permissioned users can read engagement members" on public.engagement_members for select to authenticated using (public.current_profile_has_permission('view_dashboard'));
create policy "permissioned users can read tasks" on public.tasks for select to authenticated using (public.current_profile_has_permission('view_dashboard'));
create policy "permissioned users can read task comments" on public.task_comments for select to authenticated using (public.current_profile_has_permission('view_dashboard'));
create policy "permissioned users can read documents" on public.documents for select to authenticated using (public.current_profile_has_permission('manage_documents'));
create policy "permissioned users can read quotations" on public.quotations for select to authenticated using (public.current_profile_has_permission('manage_clients'));
create policy "permissioned users can read quotation items" on public.quotation_items for select to authenticated using (public.current_profile_has_permission('manage_clients'));
create policy "permissioned users can read reports" on public.reports for select to authenticated using (public.current_profile_has_permission('view_finance'));
create policy "permissioned users can read activity" on public.activity_logs for select to authenticated using (public.current_profile_has_permission('view_dashboard'));
create policy "permissioned users can read attendance" on public.attendance_records for select to authenticated using (public.current_profile_has_permission('view_dashboard'));
create policy "permissioned users can read attendance settings" on public.attendance_settings for select to authenticated using (public.current_profile_is_admin());
create policy "permissioned users can read accounting records" on public.accounting_accounts for select to authenticated using (public.current_profile_has_permission('view_finance'));
create policy "permissioned users can read accounting periods" on public.accounting_periods for select to authenticated using (public.current_profile_has_permission('view_finance'));
create policy "permissioned users can read journal entries" on public.journal_entries for select to authenticated using (public.current_profile_has_permission('view_finance'));
create policy "permissioned users can read journal lines" on public.journal_entry_lines for select to authenticated using (public.current_profile_has_permission('view_finance'));
create policy "permissioned users can read document extractions" on public.document_extractions for select to authenticated using (public.current_profile_has_permission('manage_documents'));
create policy "recipients can read notifications" on public.notifications for select to authenticated using (recipient_id = auth.uid());

create policy "administrators can manage user permissions" on public.user_permissions for all to authenticated using (public.current_profile_is_admin()) with check (public.current_profile_is_admin());
create policy "administrators can read audit events" on public.audit_events for select to authenticated using (public.current_profile_is_admin() or actor_id = auth.uid());
