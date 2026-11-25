-- Phase 5: conversations that survive leaving the screen, and a person index.
--
-- The complaint was that closing either assistant threw the conversation away.
-- ai_conversations and ai_messages already existed but only the management
-- copilot used them, and the work assistant and register agent kept everything
-- in React state — so navigating away really did destroy it.
--
-- This adds:
--   1. a surface column so one table can hold conversations from three
--      different assistants without them appearing in each other's history;
--   2. updated_at so the sidebar can order by "last spoken in", not by when the
--      conversation was first opened;
--   3. message metadata for the structured extras (a document scan result, a
--      pending proposal) that the panels render as cards rather than prose;
--   4. a client_id link on profiles, so a person who is also a client can be
--      recognised as one without matching on name alone.

alter table public.ai_conversations
  add column if not exists surface text not null default 'copilot';
alter table public.ai_conversations
  add column if not exists updated_at timestamptz not null default now();
alter table public.ai_conversations
  add column if not exists archived_at timestamptz;

alter table public.ai_messages
  add column if not exists metadata jsonb;

-- A conversation may be linked to the client record it is about, so the register
-- agent can pick up where it left off when the same organisation comes back.
alter table public.ai_conversations
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists ai_conversations_owner_surface_idx
  on public.ai_conversations (profile_id, surface, updated_at desc);

create index if not exists ai_messages_conversation_idx
  on public.ai_messages (conversation_id, created_at);

-- Keep updated_at honest when a message is appended, so the history list can be
-- ordered by real activity instead of by creation time.
create or replace function public.bkm_touch_ai_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists bkm_ai_message_touch on public.ai_messages;
create trigger bkm_ai_message_touch
  after insert on public.ai_messages
  for each row execute function public.bkm_touch_ai_conversation();

-- Row level security: a conversation belongs to the person who had it. Service
-- role writes bypass this; ordinary reads are limited to their own history.
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists ai_conversations_own on public.ai_conversations;
create policy ai_conversations_own on public.ai_conversations
  for select using (profile_id = auth.uid());

drop policy if exists ai_messages_own on public.ai_messages;
create policy ai_messages_own on public.ai_messages
  for select using (
    exists (
      select 1 from public.ai_conversations c
       where c.id = ai_messages.conversation_id
         and c.profile_id = auth.uid()
    )
  );

-- Profiles: which client record this person also is, when they are one.
alter table public.profiles
  add column if not exists client_id uuid references public.clients(id) on delete set null;
