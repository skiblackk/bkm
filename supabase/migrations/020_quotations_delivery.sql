-- 020_quotations_delivery.sql
-- Quotation lifecycle, immutable revisions, stored documents, sharing trail,
-- invoices and a transactional acceptance record.
--
-- Design rules, in the order they matter:
--   1. The quotation row keeps its identity and status. The *content* of what
--      was issued lives in quotation_revisions, so editing a quotation can
--      never rewrite what a client already received.
--   2. Every issued revision is rendered to a PDF and stored in a private
--      bucket. The bytes are a financial record: no UPDATE, no DELETE by any
--      authenticated role, including administrators (BKM-03's lesson).
--   3. Accepting a quotation and raising its invoice happen in one transaction
--      (quotation_accept), so a half-converted quotation cannot exist.
--   4. Uniqueness of the quotation number is enforced by the database, not by
--      the application, and the application retries on conflict.

-- ---------------------------------------------------------------------------
-- 0. Sequences for human-facing document numbers
-- ---------------------------------------------------------------------------
create sequence if not exists public.quotation_number_seq start 1001;
create sequence if not exists public.invoice_number_seq start 1001;

-- ---------------------------------------------------------------------------
-- 1. Extend quotations
-- ---------------------------------------------------------------------------
alter table public.quotations
  add column if not exists quotation_number text,
  add column if not exists status_enum text,
  add column if not exists issue_date date,
  add column if not exists valid_until date,
  add column if not exists currency text not null default 'KES',
  add column if not exists subtotal numeric(14,2) not null default 0,
  add column if not exists discount_total numeric(14,2) not null default 0,
  add column if not exists tax_label text not null default 'VAT',
  add column if not exists tax_rate numeric(5,2) not null default 0,
  add column if not exists tax_total numeric(14,2) not null default 0,
  add column if not exists total numeric(14,2) not null default 0,
  add column if not exists payment_terms text,
  add column if not exists notes text,
  add column if not exists acceptance_instructions text,
  add column if not exists contact_id uuid references public.client_contacts(id) on delete set null,
  add column if not exists revision integer not null default 1,
  add column if not exists sent_at timestamptz,
  add column if not exists viewed_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists expired_at timestamptz,
  add column if not exists decided_by_name text,
  add column if not exists decision_note text,
  add column if not exists accepted_by uuid references public.profiles(id) on delete set null,
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists share_url text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

-- One revision token per quotation, used by the public client view.
create unique index if not exists quotations_public_token_key on public.quotations (public_token);
create unique index if not exists quotations_number_key on public.quotations (quotation_number) where quotation_number is not null;
create index if not exists quotations_status_idx on public.quotations (status_enum, created_at desc);
create index if not exists quotations_client_idx on public.quotations (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Line items gain quantity, discount and tax columns
-- ---------------------------------------------------------------------------
alter table public.quotation_items
  add column if not exists sort_order integer not null default 0,
  add column if not exists discount_pct numeric(5,2) not null default 0,
  add column if not exists tax_rate numeric(5,2) not null default 0,
  add column if not exists line_subtotal numeric(14,2) not null default 0,
  add column if not exists line_discount numeric(14,2) not null default 0,
  add column if not exists line_tax numeric(14,2) not null default 0,
  add column if not exists line_total numeric(14,2) not null default 0;

create index if not exists quotation_items_quotation_idx on public.quotation_items (quotation_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Immutable revision snapshots (what the client actually received)
-- ---------------------------------------------------------------------------
create table if not exists public.quotation_revisions (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  revision integer not null,
  snapshot jsonb not null,
  subtotal numeric(14,2) not null,
  discount_total numeric(14,2) not null,
  tax_total numeric(14,2) not null,
  total numeric(14,2) not null,
  currency text not null default 'KES',
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (quotation_id, revision)
);

create or replace function public.quotation_revisions_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'An issued quotation revision cannot be changed. Create a new revision instead.';
end;
$$;

drop trigger if exists quotation_revisions_no_update on public.quotation_revisions;
create trigger quotation_revisions_no_update
  before update or delete on public.quotation_revisions
  for each row execute function public.quotation_revisions_immutable();

-- ---------------------------------------------------------------------------
-- 4. Stored PDF documents
-- ---------------------------------------------------------------------------
create table if not exists public.quotation_documents (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  revision integer not null,
  storage_path text not null,
  filename text not null,
  content_type text not null default 'application/pdf',
  byte_size integer not null default 0,
  sha256 text not null,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique (quotation_id, revision)
);

create index if not exists quotation_documents_quotation_idx on public.quotation_documents (quotation_id, revision desc);

-- ---------------------------------------------------------------------------
-- 5. Status history, sharing trail, invoices, invoices lines
-- ---------------------------------------------------------------------------
create table if not exists public.quotation_events (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  from_status text,
  to_status text not null,
  channel text not null default 'workspace',      -- workspace | whatsapp | email | link | client
  detail text,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  occurred_at timestamptz not null default now()
);

create index if not exists quotation_events_quotation_idx on public.quotation_events (quotation_id, occurred_at desc);

create table if not exists public.quotation_shares (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  revision integer not null,
  channel text not null,                           -- email | whatsapp | download | link
  recipient text,
  subject text,
  body text,
  reference text,                                  -- provider message id, if any
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists quotation_shares_quotation_idx on public.quotation_shares (quotation_id, created_at desc);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  client_id uuid not null references public.clients(id),
  quotation_id uuid references public.quotations(id) on delete set null,
  quotation_revision integer,
  currency text not null default 'KES',
  issue_date date not null default current_date,
  due_date date,
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_label text not null default 'VAT',
  tax_rate numeric(5,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  status text not null default 'Issued',           -- Issued | Partly paid | Paid | Void
  payment_terms text,
  notes text,
  contact_id uuid references public.client_contacts(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invoices_client_idx on public.invoices (client_id, issue_date desc);
create index if not exists invoices_quotation_idx on public.invoices (quotation_id);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sort_order integer not null default 0,
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  discount_pct numeric(5,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  line_subtotal numeric(14,2) not null default 0,
  line_discount numeric(14,2) not null default 0,
  line_tax numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, sort_order);

-- ---------------------------------------------------------------------------
-- 6. Private storage bucket for issued PDFs
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quotations', 'quotations', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists quotation_files_read on storage.objects;
create policy quotation_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'quotations');

drop policy if exists quotation_files_write on storage.objects;
create policy quotation_files_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'quotations');

-- No update and no delete policy: an issued document stays as issued.

-- ---------------------------------------------------------------------------
-- 7. Numbering helpers
-- ---------------------------------------------------------------------------
create or replace function public.next_quotation_number()
returns text language plpgsql as $$
declare
  candidate text;
begin
  loop
    candidate := 'QT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quotation_number_seq')::text, 4, '0');
    exit when not exists (select 1 from public.quotations where quotation_number = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.next_invoice_number()
returns text language plpgsql as $$
declare
  candidate text;
begin
  loop
    candidate := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
    exit when not exists (select 1 from public.invoices where invoice_number = candidate);
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Backfill the rows that predate this migration
-- ---------------------------------------------------------------------------
update public.quotations
set quotation_number = public.next_quotation_number(),
    status_enum = case
      when status in ('Draft', 'draft', 'Ready for review', 'ready for review') then 'Draft'
      when lower(status) in ('sent') then 'Sent'
      when lower(status) in ('viewed') then 'Viewed'
      when lower(status) in ('accepted') then 'Accepted'
      when lower(status) in ('rejected') then 'Rejected'
      when lower(status) in ('expired') then 'Expired'
      else 'Draft'
    end,
    issue_date = (created_at at time zone 'Africa/Nairobi')::date,
    valid_until = ((created_at at time zone 'Africa/Nairobi')::date + 30),
    payment_terms = coalesce(payment_terms, 'Payable within 30 days of invoice. Bank transfer or cheque in favour of BKM Associates.'),
    notes = coalesce(notes, 'All amounts are quoted in Kenyan Shillings. Fees exclude disbursements unless stated.'),
    acceptance_instructions = coalesce(acceptance_instructions, 'Accept online using the secure link sent with this quotation, or sign and return the acceptance strip on the PDF. Both record the date, time and name on our system.')
where quotation_number is null;

update public.quotations q
set subtotal = coalesce(lines.sum_subtotal, 0),
    total = coalesce(lines.sum_subtotal, 0)
from (
  select quotation_id, sum(quantity * unit_price) as sum_subtotal
  from public.quotation_items
  group by quotation_id
) as lines
where lines.quotation_id = q.id;

update public.quotation_items
set line_subtotal = quantity * unit_price,
    line_total = quantity * unit_price
where line_subtotal = 0;

update public.quotations
set status = 'Draft'
where status = 'Ready for review';

-- ---------------------------------------------------------------------------
-- 9. Transition rules — enforced in the database, mirrored in the app
-- ---------------------------------------------------------------------------
create or replace function public.quotation_status_guard()
returns trigger language plpgsql as $$
declare
  allowed boolean;
begin
  if NEW.status_enum is not distinct from OLD.status_enum then
    return NEW;
  end if;
  allowed := case OLD.status_enum
    when 'Draft'    then NEW.status_enum in ('Sent', 'Expired')
    when 'Sent'     then NEW.status_enum in ('Viewed', 'Accepted', 'Rejected', 'Expired')
    when 'Viewed'   then NEW.status_enum in ('Accepted', 'Rejected', 'Expired')
    when 'Expired'  then NEW.status_enum in ('Sent', 'Viewed', 'Accepted', 'Rejected')
    else false
  end;
  if not allowed then
    raise exception 'A quotation cannot move from % to %.', OLD.status_enum, NEW.status_enum;
  end if;
  return NEW;
end;
$$;

drop trigger if exists quotations_status_guard on public.quotations;
create trigger quotations_status_guard
  before update of status_enum on public.quotations
  for each row execute function public.quotation_status_guard();

-- Stamp the matching timestamp on the row itself.
create or replace function public.quotation_status_stamp()
returns trigger language plpgsql as $$
begin
  if NEW.status_enum is distinct from OLD.status_enum then
    NEW.sent_at     := case when NEW.status_enum = 'Sent'     then now() else NEW.sent_at end;
    NEW.viewed_at   := case when NEW.status_enum = 'Viewed'   then now() else NEW.viewed_at end;
    NEW.accepted_at := case when NEW.status_enum = 'Accepted' then now() else NEW.accepted_at end;
    NEW.rejected_at := case when NEW.status_enum = 'Rejected' then now() else NEW.rejected_at end;
    NEW.expired_at  := case when NEW.status_enum = 'Expired'  then now() else NEW.expired_at end;
  end if;
  return NEW;
end;
$$;

drop trigger if exists quotations_status_stamp on public.quotations;
create trigger quotations_status_stamp
  before update of status_enum on public.quotations
  for each row execute function public.quotation_status_stamp();

-- Every status change leaves a dated, timed trail behind it.
create or replace function public.quotation_status_log()
returns trigger language plpgsql as $$
begin
  if NEW.status_enum is distinct from OLD.status_enum then
    insert into public.quotation_events (quotation_id, from_status, to_status, channel, actor_id, detail)
    values (NEW.id, OLD.status_enum, NEW.status_enum, coalesce(current_setting('bkm.channel', true), 'workspace'),
            NEW.accepted_by, coalesce(current_setting('bkm.detail', true), null));
  end if;
  return NEW;
end;
$$;

drop trigger if exists quotations_status_log on public.quotations;
create trigger quotations_status_log
  after update of status_enum on public.quotations
  for each row execute function public.quotation_status_log();

-- ---------------------------------------------------------------------------
-- 10. Acceptance and conversion, in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.quotation_accept(
  p_quotation_id uuid,
  p_actor uuid default null,
  p_actor_name text default null,
  p_decided_by text default null,
  p_note text default null,
  p_create_invoice boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  q public.quotations%rowtype;
  inv public.invoices%rowtype;
  existing_invoice uuid;
  item record;
  v_invoice_number text;
begin
  select * into q from public.quotations where id = p_quotation_id and deleted_at is null for update;
  if q.id is null then
    raise exception 'Quotation not found.';
  end if;

  if q.status_enum in ('Expired') then
    raise exception 'This quotation expires on %. Reissue it as a new revision before it can be accepted.', to_char(q.valid_until, 'DD Mon YYYY');
  end if;

  if q.status_enum not in ('Sent', 'Viewed', 'Accepted') then
    raise exception 'A quotation must be issued (Sent) before it can be accepted. This one is %.', q.status_enum;
  end if;

  update public.quotations
  set status_enum = 'Accepted',
      status = 'Accepted',
      decided_by_name = coalesce(p_decided_by, p_actor_name, decided_by_name),
      decision_note = coalesce(p_note, decision_note),
      accepted_by = coalesce(p_actor, accepted_by)
  where id = q.id
  returning * into q;

  if p_create_invoice then
    select i.id into existing_invoice from public.invoices i where i.quotation_id = q.id limit 1;
    if existing_invoice is null then
      v_invoice_number := public.next_invoice_number();
      -- Helper variables are prefixed v_ so they never collide with the
      -- invoice columns inserted below (Postgres rejects an unqualified
      -- reference that matches both a variable and a target column).
      insert into public.invoices (
        invoice_number, client_id, quotation_id, quotation_revision, currency,
        issue_date, due_date, subtotal, discount_total, tax_label, tax_rate, tax_total,
        total, balance, status, payment_terms, notes, contact_id, created_by
      ) values (
        v_invoice_number, q.client_id, q.id, q.revision, q.currency,
        current_date,
        (current_date + 30),
        q.subtotal, q.discount_total, q.tax_label, q.tax_rate, q.tax_total,
        q.total, q.total, 'Issued', q.payment_terms, q.notes, q.contact_id, p_actor
      ) returning * into inv;

      for item in select * from public.quotation_items where quotation_id = q.id order by sort_order loop
        insert into public.invoice_items (
          invoice_id, sort_order, description, quantity, unit_price, discount_pct, tax_rate,
          line_subtotal, line_discount, line_tax, line_total
        ) values (
          inv.id, item.sort_order, item.description, item.quantity, item.unit_price, item.discount_pct, item.tax_rate,
          item.line_subtotal, item.line_discount, item.line_tax, item.line_total
        );
      end loop;

      insert into public.quotation_events (quotation_id, from_status, to_status, channel, actor_id, detail)
      values (q.id, 'Accepted', 'Accepted', 'workspace', p_actor, 'Invoice ' || v_invoice_number || ' raised from this quotation.');
    end if;
  end if;

  return jsonb_build_object(
    'quotation_id', q.id,
    'status', q.status_enum,
    'invoice_id', coalesce(inv.id, existing_invoice),
    'invoice_number', (select invoice_number from public.invoices where id = coalesce(inv.id, existing_invoice))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Row-level security
-- ---------------------------------------------------------------------------
alter table public.quotation_revisions enable row level security;
alter table public.quotation_documents enable row level security;
alter table public.quotation_events enable row level security;
alter table public.quotation_shares enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

-- The application reads quotations through the service role, which bypasses
-- RLS; these policies exist so that an authenticated browser client can never
-- read them directly.
do $$
declare t text;
begin
  foreach t in array array['quotation_revisions','quotation_documents','quotation_events','quotation_shares','invoices','invoice_items']
  loop
    execute format('drop policy if exists %I_deny_authenticated on public.%I', t, t);
    execute format('create policy %I_deny_authenticated on public.%I for all to authenticated using (false) with check (false)', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Permissions for the new capability
-- ---------------------------------------------------------------------------
insert into public.permissions (permission_key, workspace, action, description, is_sensitive, is_legacy) values
  ('create_quotations',    'engagements', 'create', 'Prepare client quotations',                false, false),
  ('edit_quotations',      'engagements', 'edit',   'Edit quotation drafts before issue',       false, false),
  ('issue_quotations',     'engagements', 'issue',  'Issue a quotation and generate its PDF',   true,  false),
  ('share_quotations',     'engagements', 'share',  'Send a quotation by email or WhatsApp',    true,  false),
  ('record_quotation_decisions', 'engagements', 'decide', 'Record a client acceptance or rejection', true, false),
  ('convert_quotations',   'finance',     'convert','Convert an accepted quotation to an invoice', true, false)
on conflict (permission_key) do update set
  workspace = excluded.workspace,
  action = excluded.action,
  description = excluded.description,
  is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('CEO / Managing Partner', 'create_quotations'),
  ('CEO / Managing Partner', 'edit_quotations'),
  ('CEO / Managing Partner', 'issue_quotations'),
  ('CEO / Managing Partner', 'share_quotations'),
  ('CEO / Managing Partner', 'record_quotation_decisions'),
  ('CEO / Managing Partner', 'convert_quotations'),
  ('System Administrator', 'create_quotations'),
  ('System Administrator', 'edit_quotations'),
  ('System Administrator', 'issue_quotations'),
  ('System Administrator', 'share_quotations'),
  ('System Administrator', 'record_quotation_decisions'),
  ('System Administrator', 'convert_quotations'),
  ('Operations Manager', 'create_quotations'),
  ('Operations Manager', 'edit_quotations'),
  ('Operations Manager', 'issue_quotations'),
  ('Operations Manager', 'share_quotations'),
  ('Operations Manager', 'record_quotation_decisions'),
  ('Operations Manager', 'convert_quotations'),
  ('Finance Lead', 'create_quotations'),
  ('Finance Lead', 'edit_quotations'),
  ('Finance Lead', 'issue_quotations'),
  ('Finance Lead', 'share_quotations'),
  ('Finance Lead', 'record_quotation_decisions'),
  ('Finance Lead', 'convert_quotations'),
  ('Audit Manager', 'create_quotations'),
  ('Audit Manager', 'edit_quotations'),
  ('Audit Manager', 'issue_quotations'),
  ('Audit Manager', 'share_quotations'),
  ('Audit Manager', 'record_quotation_decisions'),
  ('Senior Auditor', 'create_quotations'),
  ('Senior Auditor', 'edit_quotations')
) as seed(role_name, permission_key)
join public.roles r on r.name = seed.role_name
join public.permissions p on p.permission_key = seed.permission_key
on conflict do nothing;

-- Quotation draft creation was previously gated behind the legacy
-- manage_clients key; the new keys supersede that for the quotation workflow.
