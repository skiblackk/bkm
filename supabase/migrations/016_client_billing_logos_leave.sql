-- 016_client_billing_logos_leave.sql
--
-- Closes the four Phase 3 reports:
--
--   1. "a staff member applies for leave, it doesn't reflect on the admin
--      dashboard"  -> requests existed but no admin surface ever asked for
--      them, and nothing notified an administrator. Fixed on both sides: the
--      read path is now opened to administrators in SQL, the write path
--      notifies, and 017 adds the queue to the dashboard.
--
--   2. "the documents upload can't be deleted" -> bkm_delete_uploaded_document
--      cast extracted_json->>'clientId' straight to uuid. Uploads made from the
--      assistant and from unassigned contexts store the string 'unassigned', so
--      the cast raised "invalid input syntax for type uuid" and the delete
--      aborted *before* the row was removed. Every one of the 14 documents in
--      production has clientId = 'unassigned', so delete failed for all of them.
--      The cast is now guarded.
--
--   3. "not all clients are to be serviced, some are there to be paid by BKM;
--      there should be service offered, how much BKM is paying them, and a
--      receipt that can be generated" -> relationship_type, service charges,
--      payments and numbered receipts.
--
--   4. "an option for staff to add logos of the client companies" ->
--      clients.logo_url, stored as a data URI so no storage bucket, signed URL
--      or new upload surface is needed.

-- ---------------------------------------------------------------------------
-- 1. Relationship type
--    Some organisations in the register are suppliers BKM pays, not clients BKM
--    bills. Both belong in one register; the distinction is stored, not guessed
--    from free text. Existing rows default to 'serviced', which is what they are.
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists relationship_type text not null default 'serviced';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_relationship_type_check') then
    alter table public.clients
      add constraint clients_relationship_type_check
      check (relationship_type in ('serviced', 'vendor'));
  end if;
end $$;

create index if not exists clients_relationship_idx
  on public.clients (relationship_type, status);

-- ---------------------------------------------------------------------------
-- 2. Client logo
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists logo_url text;

-- ---------------------------------------------------------------------------
-- 3. Service charges
--    One row per arrangement: the service, and what BKM pays (payable) or bills
--    (receivable).
-- ---------------------------------------------------------------------------
create table if not exists public.client_service_charges (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service_name text not null,
  description text not null default '',
  direction text not null check (direction in ('payable', 'receivable')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'KES',
  billing_frequency text not null default 'monthly'
    check (billing_frequency in ('one-off', 'weekly', 'monthly', 'quarterly', 'annual')),
  status text not null default 'Active' check (status in ('Active', 'Paused', 'Ended')),
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_service_charges_client_idx
  on public.client_service_charges (client_id, status);

-- ---------------------------------------------------------------------------
-- 4. Payments
--    Money that actually moved. Kept apart from the charge so the agreed rate
--    and the settled history never overwrite each other.
-- ---------------------------------------------------------------------------
create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid references public.client_service_charges(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'KES',
  paid_on date not null default current_date,
  method text not null default 'Bank transfer',
  reference text not null default '',
  notes text not null default '',
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists client_payments_client_idx
  on public.client_payments (client_id, paid_on desc);
create index if not exists client_payments_charge_idx
  on public.client_payments (charge_id);

-- ---------------------------------------------------------------------------
-- 5. Receipts
--    A receipt is issued for one payment, with a number staff can quote.
-- ---------------------------------------------------------------------------
create sequence if not exists public.client_receipt_seq start 1001;

create table if not exists public.client_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  payment_id uuid not null references public.client_payments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  amount numeric(14,2) not null,
  currency text not null default 'KES',
  issued_on date not null default current_date,
  issued_by uuid references public.profiles(id) on delete set null,
  issued_by_name text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists client_receipts_client_idx
  on public.client_receipts (client_id, issued_on desc);

-- ---------------------------------------------------------------------------
-- 6. RLS
--    Reads are permission-gated; every write goes through a security-definer
--    function called only by the server.
-- ---------------------------------------------------------------------------
alter table public.client_service_charges enable row level security;
alter table public.client_payments enable row level security;
alter table public.client_receipts enable row level security;

drop policy if exists "client charges readable" on public.client_service_charges;
create policy "client charges readable" on public.client_service_charges
  for select to authenticated using (public.current_user_has_permission('manage_clients'));

drop policy if exists "client payments readable" on public.client_payments;
create policy "client payments readable" on public.client_payments
  for select to authenticated using (public.current_user_has_permission('manage_clients'));

drop policy if exists "client receipts readable" on public.client_receipts;
create policy "client receipts readable" on public.client_receipts
  for select to authenticated using (public.current_user_has_permission('manage_clients'));

-- ---------------------------------------------------------------------------
-- 7. Atomic writes
-- ---------------------------------------------------------------------------

create or replace function public.bkm_add_service_charge(
  p_actor_id uuid, p_actor_name text, p_actor_role text,
  p_client_id uuid, p_service_name text, p_description text,
  p_direction text, p_amount numeric, p_currency text,
  p_billing_frequency text, p_effective_from date
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_service_name), '') = '' then
    raise exception 'A service name is required.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be greater than zero.' using errcode = '22023';
  end if;
  if p_direction is null or p_direction not in ('payable', 'receivable') then
    raise exception 'A charge is either payable by BKM or receivable by BKM.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;

  insert into public.client_service_charges
    (client_id, service_name, description, direction, amount, currency, billing_frequency, effective_from, created_by)
  values
    (p_client_id, btrim(p_service_name), coalesce(p_description, ''), p_direction, p_amount,
     coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'KES'),
     coalesce(nullif(p_billing_frequency, ''), 'monthly'),
     coalesce(p_effective_from, current_date), p_actor_id)
  returning id into v_id;

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity, new_state)
  values (p_actor_id, p_actor_name, p_actor_role, 'add_service_charge', 'Client', p_client_id::text,
          'Service charge added: ' || btrim(p_service_name), 'change',
          jsonb_build_object('chargeId', v_id, 'amount', p_amount, 'direction', p_direction));

  return v_id;
end;
$$;

create or replace function public.bkm_record_client_payment(
  p_actor_id uuid, p_actor_name text, p_actor_role text,
  p_client_id uuid, p_charge_id uuid, p_amount numeric, p_currency text,
  p_paid_on date, p_method text, p_reference text, p_notes text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The payment amount must be greater than zero.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  if p_charge_id is not null and not exists (
    select 1 from public.client_service_charges where id = p_charge_id and client_id = p_client_id
  ) then
    raise exception 'That service charge does not belong to this record.' using errcode = '22023';
  end if;

  insert into public.client_payments
    (charge_id, client_id, amount, currency, paid_on, method, reference, notes, recorded_by)
  values
    (p_charge_id, p_client_id, p_amount, coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'KES'),
     coalesce(p_paid_on, current_date), coalesce(nullif(btrim(coalesce(p_method, '')), ''), 'Bank transfer'),
     coalesce(p_reference, ''), coalesce(p_notes, ''), p_actor_id)
  returning id into v_id;

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity, new_state)
  values (p_actor_id, p_actor_name, p_actor_role, 'record_client_payment', 'Client', p_client_id::text,
          'Payment recorded', 'change',
          jsonb_build_object('paymentId', v_id, 'amount', p_amount));

  return v_id;
end;
$$;

-- One receipt per payment: re-issuing returns the existing receipt rather than
-- burning another number.
create or replace function public.bkm_issue_receipt(
  p_actor_id uuid, p_actor_name text, p_actor_role text,
  p_payment_id uuid, p_notes text default ''
) returns public.client_receipts
language plpgsql security definer set search_path = public
as $$
declare v_payment public.client_payments%rowtype; v_receipt public.client_receipts%rowtype; v_number text;
begin
  select * into v_payment from public.client_payments where id = p_payment_id;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;

  select * into v_receipt from public.client_receipts where payment_id = p_payment_id limit 1;
  if found then
    return v_receipt;
  end if;

  v_number := 'BKM-RCPT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.client_receipt_seq')::text, 5, '0');

  insert into public.client_receipts
    (receipt_number, payment_id, client_id, amount, currency, issued_on, issued_by, issued_by_name, notes)
  values
    (v_number, p_payment_id, v_payment.client_id, v_payment.amount, v_payment.currency,
     current_date, p_actor_id, coalesce(p_actor_name, ''), coalesce(p_notes, ''))
  returning * into v_receipt;

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity, new_state)
  values (p_actor_id, p_actor_name, p_actor_role, 'issue_receipt', 'Client', v_payment.client_id::text,
          'Receipt ' || v_number || ' issued', 'change',
          jsonb_build_object('receiptNumber', v_number, 'amount', v_payment.amount));

  return v_receipt;
end;
$$;

-- Set or clear a client logo. Size is checked here as well as in the API so a
-- future caller cannot stuff a megabyte into the row.
create or replace function public.bkm_set_client_logo(
  p_actor_id uuid, p_actor_name text, p_actor_role text,
  p_client_id uuid, p_logo_url text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  if p_logo_url is not null and length(p_logo_url) > 400000 then
    raise exception 'That logo is too large. Use an image under 200 KB.' using errcode = '22023';
  end if;
  if p_logo_url is not null and p_logo_url <> '' and p_logo_url not like 'data:image/%' then
    raise exception 'The logo must be an image file.' using errcode = '22023';
  end if;

  update public.clients
     set logo_url = nullif(p_logo_url, ''),
         updated_at = now()
   where id = p_client_id;

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity)
  values (p_actor_id, p_actor_name, p_actor_role,
          case when p_logo_url is null or p_logo_url = '' then 'remove_client_logo' else 'set_client_logo' end,
          'Client', p_client_id::text,
          case when p_logo_url is null or p_logo_url = '' then 'Client logo removed' else 'Client logo updated' end,
          'change');
end;
$$;

-- Set the relationship type (serviced / vendor). Kept out of bkm_update_client
-- so the existing edit path is untouched.
create or replace function public.bkm_set_client_relationship(
  p_actor_id uuid, p_actor_name text, p_actor_role text,
  p_client_id uuid, p_relationship_type text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_relationship_type not in ('serviced', 'vendor') then
    raise exception 'A record is either serviced by BKM or paid by BKM.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;

  update public.clients
     set relationship_type = p_relationship_type,
         updated_at = now()
   where id = p_client_id;

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity, new_state)
  values (p_actor_id, p_actor_name, p_actor_role, 'change_client_relationship', 'Client', p_client_id::text,
          'Relationship set to ' || p_relationship_type, 'change',
          jsonb_build_object('relationshipType', p_relationship_type));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Document deletion must not depend on a parseable client id.
--    This is the bug behind "the documents upload can't be deleted": the cast of
--    'unassigned' to uuid raised before the delete ran.
-- ---------------------------------------------------------------------------
create or replace function public.bkm_delete_uploaded_document(
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_document_id uuid,
  p_is_admin boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.document_extractions%rowtype;
  v_owner uuid;
  v_client_text text;
  v_client uuid;
begin
  select * into v_row from public.document_extractions where id = p_document_id;
  if not found then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  -- Legacy/unassigned rows may carry no owner at all. Those are removable by an
  -- administrator; an ordinary user still cannot delete someone else's upload.
  v_owner := nullif(v_row.extracted_json->>'ownerId', '')::uuid;
  if not p_is_admin and v_owner is not null and v_owner <> p_actor_id then
    raise exception 'You can only delete documents you uploaded.' using errcode = '42501';
  end if;
  if not p_is_admin and v_owner is null then
    raise exception 'This document has no owner recorded, so only an administrator can delete it.' using errcode = '42501';
  end if;

  -- The client reference is free text in the JSON payload: 'unassigned' is a
  -- normal value, not a uuid. Only refresh the counter when it really is one.
  v_client_text := nullif(btrim(coalesce(v_row.extracted_json->>'clientId', '')), '');
  if v_client_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_client := v_client_text::uuid;
  end if;

  delete from public.document_extractions where id = p_document_id;

  insert into public.audit_events (actor_id, actor_name, actor_role, action, target_type, target_id, detail, severity, previous_state)
  values (p_actor_id, p_actor_name, p_actor_role, 'delete_document', 'Document', p_document_id::text,
          'Deleted uploaded document ' || v_row.filename, 'change',
          jsonb_build_object('filename', v_row.filename, 'clientId', coalesce(v_client_text, '')));

  if v_client is not null then
    perform public.bkm_refresh_client_document_count(v_client);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Leave visibility for administrators.
--    Administrators already pass current_user_has_permission() for almost every
--    key, but the policy consulted it for three leave keys only. A profile with
--    is_admin = true but a role that does not grant approve_leave therefore saw
--    nothing — which is exactly the reported "it doesn't reflect on the admin
--    dashboard". Administrators always see the queue now.
-- ---------------------------------------------------------------------------
drop policy if exists "leave visibility" on public.leave_requests;
create policy "leave visibility" on public.leave_requests
  for select to authenticated using (
    user_id = auth.uid()
    or public.current_user_has_permission('approve_leave')
    or public.current_user_has_permission('manage_leave')
    or public.current_user_has_permission('view_team_attendance')
    or public.current_user_is_admin()
  );

-- Only the server calls these.
revoke all on function public.bkm_add_service_charge(uuid, text, text, uuid, text, text, text, numeric, text, text, date) from public, anon, authenticated;
revoke all on function public.bkm_record_client_payment(uuid, text, text, uuid, uuid, numeric, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.bkm_issue_receipt(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.bkm_set_client_logo(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.bkm_set_client_relationship(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.bkm_delete_uploaded_document(uuid, text, text, uuid, boolean) from public, anon, authenticated;

select '016_client_billing_logos_leave applied' as result;
