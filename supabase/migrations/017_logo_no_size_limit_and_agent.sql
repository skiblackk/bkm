-- 017_logo_no_size_limit_and_agent.sql
--
-- Two follow-ups from the Phase 3 review:
--
--   1. The 200 KB logo ceiling was pushed onto the user ("your logo is too
--      big"). The browser now downscales before upload, so the database limit
--      only needs to defend against a malformed request, not police the user.
--   2. The AI agent needs a table to remember what it did, so a record it
--      created can be traced back to the conversation that created it.

-- ---------------------------------------------------------------------------
-- 1. Relax the logo ceiling.
--    The function raised 'That logo is too large. Use an image under 200 KB.'
--    at 400000 characters. The cap is now 8 MB of characters purely as a
--    sanity bound; the normal path never approaches it because images are
--    resized in the browser first.
-- ---------------------------------------------------------------------------
create or replace function public.bkm_set_client_logo(
  p_actor_id uuid, p_actor_name text, p_actor_role text, p_client_id uuid, p_logo_url text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  if p_logo_url is not null and length(p_logo_url) > 8000000 then
    raise exception 'That image is too large to store. Try a smaller file.' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- 2. Agent action log
--    Every write the agent performs is recorded here with the conversation it
--    came from and whether it can be undone. That is what makes "the agent
--    deleted a record" answerable after the fact.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  summary text not null default '',
  reversible boolean not null default false,
  undo_payload jsonb,
  undone_at timestamptz,
  undone_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists agent_actions_created_idx on public.agent_actions (created_at desc);
create index if not exists agent_actions_target_idx on public.agent_actions (target_type, target_id);

alter table public.agent_actions enable row level security;

drop policy if exists "agent actions readable" on public.agent_actions;
create policy "agent actions readable" on public.agent_actions
  for select to authenticated using (public.current_user_has_permission('manage_clients'));

-- Soft delete for clients, so the agent's deletions are never final in one hop.
alter table public.clients add column if not exists deleted_at timestamptz;
alter table public.clients add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
alter table public.clients add column if not exists deleted_reason text not null default '';

create index if not exists clients_deleted_idx on public.clients (deleted_at);

select '017 applied' as result;
