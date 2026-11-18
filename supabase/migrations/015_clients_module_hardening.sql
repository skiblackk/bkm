-- 015_clients_module_hardening.sql
--
-- Fixes identified in the Clients module QA cycle:
--   * duplicate prevention moves from application code to the database
--   * client write path becomes atomic (one function, one transaction)
--   * client update / status / archive support
--   * uploaded documents can be deleted
--   * client document counts stay truthful

-- ---------------------------------------------------------------------------
-- 1. Database-level duplicate prevention.
--    The old check was a lowercase comparison over a cached in-memory row set,
--    so two concurrent requests could both pass and both insert.
-- ---------------------------------------------------------------------------
create unique index if not exists clients_name_unique
  on public.clients (lower(btrim(name)));

create unique index if not exists client_contacts_email_unique
  on public.client_contacts (lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- 2. Atomic client creation.
--    Previously the client + contact + activity rows committed, and then a
--    failing audit insert (actorId 'benjamin' into a uuid column) bubbled up as
--    an error, so the user was told the save failed while the row existed.
--    Everything now happens inside one function, so it all lands or none does.
-- ---------------------------------------------------------------------------
create or replace function public.bkm_create_client(
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_name text,
  p_industry text,
  p_location text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text default '',
  p_description text default null,
  p_manager_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_name text := btrim(p_name);
  v_email text := btrim(p_contact_email);
begin
  if coalesce(v_name, '') = '' or coalesce(btrim(p_industry), '') = ''
     or coalesce(btrim(p_location), '') = '' or coalesce(btrim(p_contact_name), '') = ''
     or coalesce(v_email, '') = '' then
    raise exception 'Name, industry, location, contact name and contact email are required.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.clients where lower(btrim(name)) = lower(v_name)) then
    raise exception 'A client with this name already exists. Open the existing record instead of creating a duplicate.'
      using errcode = '23505';
  end if;

  if exists (select 1 from public.client_contacts where lower(btrim(email)) = lower(v_email)) then
    raise exception 'A client contact with this email already exists. Check the existing client record before continuing.'
      using errcode = '23505';
  end if;

  insert into public.clients (name, industry, status, location, description, primary_manager_id, services, last_activity, document_count, outstanding_requests)
  values (v_name, btrim(p_industry), 'Active', btrim(p_location),
          coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'New client record created in BKM Operations Hub.'),
          p_manager_id, '["Audit & Assurance"]'::jsonb, 'Just now', 0, 0)
  returning id into v_client_id;

  insert into public.client_contacts (client_id, full_name, email, phone, is_primary)
  values (v_client_id, btrim(p_contact_name), v_email, coalesce(btrim(p_contact_phone), ''), true);

  insert into public.activity_logs (actor_id, actor_name, event_type, description, record_type, record_id)
  values (p_actor_id, p_actor_name, 'Client created', v_name || ' was added to the client portfolio', 'Client', v_client_id::text);

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity)
  values (p_actor_id, p_actor_name, p_actor_role, 'create_client', 'Client', v_client_id::text, 'Created client ' || v_name, 'change');

  return v_client_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Client update / status change / archive, also atomic.
-- ---------------------------------------------------------------------------
create or replace function public.bkm_update_client(
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_client_id uuid,
  p_name text default null,
  p_industry text default null,
  p_location text default null,
  p_description text default null,
  p_status text default null,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.clients%rowtype;
  v_status text := p_status;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_industry text := nullif(btrim(coalesce(p_industry, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
begin
  select * into v_before from public.clients where id = p_client_id;
  if not found then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;

  if v_status is not null and v_status not in ('Active', 'On hold', 'Archived') then
    raise exception 'Status must be Active, On hold or Archived.' using errcode = '22023';
  end if;

  if v_name is not null and exists (
    select 1 from public.clients
    where lower(btrim(name)) = lower(v_name) and id <> p_client_id
  ) then
    raise exception 'A client with this name already exists.' using errcode = '23505';
  end if;

  if v_email is not null and exists (
    select 1 from public.client_contacts c
    where lower(btrim(c.email)) = lower(v_email)
      and c.client_id <> p_client_id
  ) then
    raise exception 'A client contact with this email already exists.' using errcode = '23505';
  end if;

  update public.clients set
    name = coalesce(v_name, name),
    industry = coalesce(v_industry, industry),
    location = coalesce(v_location, location),
    description = coalesce(nullif(btrim(coalesce(p_description, '')), ''), description),
    status = coalesce(v_status, status),
    updated_at = now(),
    last_activity = 'Just now'
  where id = p_client_id;

  if v_email is not null and exists (select 1 from public.client_contacts where client_id = p_client_id and is_primary) then
    update public.client_contacts set
      full_name = coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), full_name),
      email = v_email,
      phone = coalesce(nullif(btrim(coalesce(p_contact_phone, '')), ''), phone)
    where client_id = p_client_id and is_primary;
  elsif v_email is not null then
    insert into public.client_contacts (client_id, full_name, email, phone, is_primary)
    values (p_client_id, coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), v_before.name), v_email,
            coalesce(btrim(p_contact_phone), ''), true);
  elsif p_contact_name is not null or p_contact_phone is not null then
    update public.client_contacts set
      full_name = coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), full_name),
      phone = coalesce(nullif(btrim(coalesce(p_contact_phone, '')), ''), phone)
    where client_id = p_client_id and is_primary;
  end if;

  insert into public.activity_logs (actor_id, actor_name, event_type, description, record_type, record_id)
  values (p_actor_id, p_actor_name,
          case when v_status is not null and v_status <> v_before.status then 'Client status changed' else 'Client updated' end,
          case when v_status is not null and v_status <> v_before.status
               then coalesce(v_name, v_before.name) || ' moved from ' || v_before.status || ' to ' || v_status
               else coalesce(v_name, v_before.name) || ' was updated in the client portfolio' end,
          'Client', p_client_id::text);

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity, previous_state, new_state)
  values (p_actor_id, p_actor_name, p_actor_role,
          case when v_status = 'Archived' and v_before.status <> 'Archived' then 'archive_client'
               when v_status is not null and v_status <> v_before.status then 'change_client_status'
               else 'update_client' end,
          'Client', p_client_id::text,
          coalesce(v_name, v_before.name) || ' updated',
          'change',
          jsonb_build_object('status', v_before.status, 'name', v_before.name),
          jsonb_build_object('status', coalesce(v_status, v_before.status), 'name', coalesce(v_name, v_before.name)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Keep clients.document_count honest.
--    The counter was never recalculated, so the client card showed 0 documents
--    while documents were listed underneath it.
-- ---------------------------------------------------------------------------
create or replace function public.bkm_refresh_client_document_count(p_client_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.clients set
    document_count = (
      select count(*) from public.document_extractions e
      where e.extracted_json->>'clientId' = p_client_id::text
    ),
    updated_at = now()
  where id = p_client_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. Uploaded documents must be deletable.
--    Nobody could remove a wrongly uploaded file; it stayed on the client
--    record for good. Deletion is owner-scoped in the API, and the client
--    counter is refreshed in the same breath.
-- ---------------------------------------------------------------------------
create or replace function public.bkm_delete_uploaded_document(
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_document_id uuid,
  p_is_admin boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.document_extractions%rowtype;
  v_owner uuid;
  v_client uuid;
begin
  select * into v_row from public.document_extractions where id = p_document_id;
  if not found then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  v_owner := nullif(v_row.extracted_json->>'ownerId', '')::uuid;
  if not p_is_admin and v_owner is distinct from p_actor_id then
    raise exception 'You can only delete documents you uploaded.' using errcode = '42501';
  end if;

  v_client := nullif(v_row.extracted_json->>'clientId', '')::uuid;

  delete from public.document_extractions where id = p_document_id;

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity, previous_state)
  values (p_actor_id, p_actor_name, p_actor_role, 'delete_document', 'Document', p_document_id::text,
          'Deleted uploaded document ' || v_row.filename, 'change',
          jsonb_build_object('filename', v_row.filename, 'clientId', v_client));

  if v_client is not null then
    perform public.bkm_refresh_client_document_count(v_client);
  end if;
end;
$$;

-- Only the server (service_role) calls these.
revoke all on function public.bkm_create_client(uuid, text, text, text, text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.bkm_update_client(uuid, text, text, uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.bkm_delete_uploaded_document(uuid, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.bkm_refresh_client_document_count(uuid) from public, anon, authenticated;

select '015_clients_module_hardening applied' as result;
