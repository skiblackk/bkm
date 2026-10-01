create table if not exists public.attendance_records (id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.profiles(id), attendance_date date not null, status text not null, check_in time, check_out time, note text, duration_minutes integer, created_at timestamptz not null default now(), unique (staff_id, attendance_date));
create table if not exists public.attendance_settings (id uuid primary key default gen_random_uuid(), expected_check_in time not null default '08:00', grace_minutes integer not null default 15, working_days jsonb not null default '["Mon","Tue","Wed","Thu","Fri"]'::jsonb, updated_at timestamptz not null default now());
create table if not exists public.accounting_accounts (id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, account_type text not null, is_active boolean not null default true, created_at timestamptz not null default now());
create table if not exists public.accounting_periods (id uuid primary key default gen_random_uuid(), name text not null, starts_on date not null, ends_on date not null, status text not null, created_at timestamptz not null default now());
create table if not exists public.journal_entries (id uuid primary key default gen_random_uuid(), period_id uuid references public.accounting_periods(id), entry_date date not null, description text not null, reference text not null unique, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table if not exists public.journal_entry_lines (id uuid primary key default gen_random_uuid(), journal_entry_id uuid not null references public.journal_entries(id) on delete cascade, account_id uuid not null references public.accounting_accounts(id), debit numeric(14,2) not null default 0, credit numeric(14,2) not null default 0, check ((debit = 0 and credit >= 0) or (credit = 0 and debit >= 0)));
create table if not exists public.document_extractions (id uuid primary key default gen_random_uuid(), document_id uuid references public.documents(id), filename text not null, status text not null, summary text not null, extracted_json jsonb not null, approved_by uuid references public.profiles(id), approved_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), category text not null, priority text not null, title text not null, body text not null, link_path text, is_read boolean not null default false, created_at timestamptz not null default now());

alter table public.attendance_records enable row level security;
alter table public.attendance_settings enable row level security;
alter table public.accounting_accounts enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.document_extractions enable row level security;
alter table public.notifications enable row level security;

create policy "authenticated users can read attendance" on public.attendance_records for select to authenticated using (true);
create policy "authenticated users can read attendance settings" on public.attendance_settings for select to authenticated using (true);
create policy "authenticated users can read accounting records" on public.accounting_accounts for select to authenticated using (true);
create policy "authenticated users can read accounting periods" on public.accounting_periods for select to authenticated using (true);
create policy "authenticated users can read journal entries" on public.journal_entries for select to authenticated using (true);
create policy "authenticated users can read journal lines" on public.journal_entry_lines for select to authenticated using (true);
create policy "authenticated users can read document extractions" on public.document_extractions for select to authenticated using (true);
create policy "authenticated users can read notifications" on public.notifications for select to authenticated using (true);
