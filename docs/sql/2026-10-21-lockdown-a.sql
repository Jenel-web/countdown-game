-- =============================================================================
-- LOCKDOWN STEP A  (2026-10-21)
-- Safe to run BEFORE any app change: the current web app and game server keep
-- working. Additive and safe to re-run. Undo with 2026-10-21-lockdown-a-ROLLBACK.sql.
--
-- Written against the live schema pasted on 2026-10-21 (docs/sql/inspect-security.sql).
-- Run it in the Supabase SQL editor, as one script. Then:
--   1. register a new username account and sign in with Google once (signup
--      still works after the handle_new_user change),
--   2. create and cancel a challenge in the lobby, play one match,
--   3. re-run scripts/db-attack-sim.ts: X6 X7 X8 X12 X14 should be BLOCKED and
--      L4 ALLOWED.
--
-- What it does:
--   A1  Remove privileges the browser roles never need (TRUNCATE, TRIGGER,
--       REFERENCES; every write by the logged-out role; writes to rounds).
--   A2  Drop the old "join as player2" policy: joining goes through the game
--       server (service role) only.
--   A3  New matches from the browser must be a clean 'pending' challenge.
--   A4  A player may delete their own unstarted challenge (makes the lobby's
--       Cancel button actually work; today it silently deletes nothing).
--   A5  At most 3 open challenges per player in any 30 minutes.
--   A6  delete_stale_pending_matches(): removes challenges nobody joined within
--       30 minutes. Only the game server (service role) may call it.
--   A7  handle_new_user: fixed search_path; browser roles may no longer call it.
--   A8  Usernames: set once, never changed afterwards, never a reserved name.
-- =============================================================================


-- All or nothing: if any statement fails, none of them is applied.
begin;


-- ── A1. Privileges the browser never needs ─────────────────────────────────
-- (TRUNCATE ignores Row Level Security entirely. Supabase's API cannot send it,
-- but there is no reason for anyone except the owner to hold it.)
revoke truncate, trigger, references on public.profiles, public.matches, public.rounds from anon, authenticated;

-- The logged-out role writes nothing.
revoke insert, update, delete on public.profiles, public.matches, public.rounds from anon;

-- Rounds are written by the game server only (it uses the service role).
revoke insert, update, delete on public.rounds from authenticated;


-- ── A2. No joining matches from the browser ────────────────────────────────
drop policy if exists "users can join an open match as player2" on public.matches;
revoke update (player2_id, status) on public.matches from authenticated;
revoke update on public.matches from authenticated;


-- ── A3. A new match from the browser is a clean, empty challenge ───────────
drop policy if exists "users can create their own pending match" on public.matches;
create policy "users can create their own pending match"
  on public.matches
  for insert
  to authenticated
  with check (
    auth.uid() = player1_id
    and player2_id is null
    and winner_id is null
    and status = 'pending'
    and player1_total_points = 0
    and player2_total_points = 0
    and ended_at is null
  );


-- ── A4. Cancel your own challenge ──────────────────────────────────────────
drop policy if exists "players can delete their own open challenge" on public.matches;
create policy "players can delete their own open challenge"
  on public.matches
  for delete
  to authenticated
  using (
    auth.uid() = player1_id
    and status = 'pending'
    and player2_id is null
  );


-- ── A5. At most 3 open challenges per player (counting the last 30 minutes) ─
-- Older ones don't count, so a crashed tab never blocks anyone: the sweeper
-- (A6) deletes them. The advisory lock makes the count exact even when the
-- same player sends several inserts at once.
create or replace function public.enforce_pending_match_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_open integer;
begin
  if new.status is distinct from 'pending' or new.player1_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pending_matches:' || new.player1_id::text, 0));

  select count(*) into v_open
  from public.matches
  where player1_id = new.player1_id
    and status = 'pending'
    and created_at > now() - interval '30 minutes';

  if v_open >= 3 then
    raise exception 'You already have 3 open challenges. Cancel one or wait a few minutes.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists matches_pending_limit on public.matches;
create trigger matches_pending_limit
  before insert on public.matches
  for each row execute function public.enforce_pending_match_limit();


-- ── A6. Sweeper for challenges nobody joined ───────────────────────────────
-- Called by the game server every 5 minutes. p_keep lists challenges whose host
-- is still waiting in a live room right now, so an open lobby is never deleted
-- from under its host. Never deletes a match that has rounds.
create or replace function public.delete_stale_pending_matches(
  p_older_than_minutes integer default 30,
  p_keep uuid[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_older_than_minutes is null or p_older_than_minutes < 5 then
    raise exception 'delete_stale_pending_matches: p_older_than_minutes must be at least 5';
  end if;

  delete from public.matches m
  where m.status = 'pending'
    and m.player2_id is null
    and m.winner_id is null
    and m.created_at < now() - make_interval(mins => p_older_than_minutes)
    and not (m.id = any (coalesce(p_keep, '{}'::uuid[])))
    and not exists (select 1 from public.rounds r where r.match_id = m.id);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.delete_stale_pending_matches(integer, uuid[]) from public, anon, authenticated;
grant execute on function public.delete_stale_pending_matches(integer, uuid[]) to service_role;


-- ── A7. handle_new_user (runs when an account is created) ──────────────────
-- A SECURITY DEFINER function without a fixed search_path can be steered into
-- someone else's objects. Pin it. The browser roles never call it directly
-- (it is a trigger function); the auth service keeps its explicit right to.
alter function public.handle_new_user() set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin, postgres, service_role;


-- ── A8. Usernames: set once, never reserved ────────────────────────────────
-- Keep this list identical to RESERVED_USERNAMES in lib/auth/username.ts
-- (lib/auth/reservedSync.test.ts fails if they drift).
-- Sessions running as postgres or service_role (the SQL editor, the server)
-- may still correct a name, e.g. for moderation.
create or replace function public.enforce_username_rules()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.username is not null
     and new.username is distinct from old.username then
    raise exception 'Usernames cannot be changed once set.' using errcode = 'P0001';
  end if;

  if new.username is not null and lower(new.username) = any (array[
    'admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'system',
    'root', 'countdown', 'countdownarena', 'arena', 'official', 'null',
    'undefined', 'guest', 'opponent', 'you'
  ]) then
    raise exception 'That username is reserved. Please choose another.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_username_rules on public.profiles;
create trigger profiles_username_rules
  before insert or update of username on public.profiles
  for each row execute function public.enforce_username_rules();


-- Tell the API layer (PostgREST) to reload its schema now, so the new
-- delete_stale_pending_matches() function is callable straight away instead of
-- failing with "not found in the schema cache". Delivered when this commits.
notify pgrst, 'reload schema';

commit;


-- ── Verify (should show the new policies and triggers) ─────────────────────
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'matches'
order by policyname;
