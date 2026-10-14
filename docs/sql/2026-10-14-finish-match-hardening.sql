-- =============================================================================
-- finish_match hardening + MMR inside the RPC
-- Run in the Supabase SQL editor, ONE STEP AT A TIME, in this order.
-- Written against the live definitions pasted by the project owner on 2026-10-14:
--   finish_match(uuid,uuid,uuid)                      old, no checks, mmr + 10, status 'finished'
--   finish_match(uuid,uuid,uuid,integer,integer)      current, called by countdown-server
-- Both were SECURITY DEFINER and executable by the public `anon` role.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 - close public access. Safe to run immediately: only the game server
-- (service_role) and the DB tests (service_role) call this function.
-- -----------------------------------------------------------------------------
revoke execute on function public.finish_match(uuid, uuid, uuid)                      from public, anon, authenticated;
revoke execute on function public.finish_match(uuid, uuid, uuid, integer, integer)    from public, anon, authenticated;

-- Verify: every row should list only postgres and service_role in `grants`.
select p.oid::regprocedure as signature, p.proacl as grants
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'finish_match' and n.nspname = 'public';


-- -----------------------------------------------------------------------------
-- STEP 2 - remove the old 3-argument function. DESTRUCTIVE (cannot be undone
-- except by recreating it from the old body listed under ROLLBACK below).
-- Nothing in the repository calls it.
-- -----------------------------------------------------------------------------
drop function public.finish_match(uuid, uuid, uuid);


-- -----------------------------------------------------------------------------
-- STEP 3 - move MMR into finish_match. RUN THIS ONLY AFTER the game server
-- version that no longer updates MMR itself is deployed. If both run, every
-- match changes MMR twice.
--   winner: +25      loser: -15, never below 0
-- Same signature and parameter names as before, so existing grants are kept.
-- Everything else (checks, early return when already completed, ended_at) is
-- unchanged. Adds a fixed search_path and schema-qualified table names.
-- -----------------------------------------------------------------------------
create or replace function public.finish_match(
  p_match_id     uuid,
  p_winner_id    uuid,
  p_loser_id     uuid,
  p_winner_score integer,
  p_loser_score  integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
begin
  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'finish_match: no match found with id %', p_match_id;
  end if;

  if v_match.status = 'completed' then
    return;
  end if;

  if not (
    (v_match.player1_id = p_winner_id and v_match.player2_id = p_loser_id)
    or (v_match.player1_id = p_loser_id and v_match.player2_id = p_winner_id)
  ) then
    raise exception 'finish_match: winner/loser ids do not match the players on match %', p_match_id;
  end if;

  update public.matches
  set
    status = 'completed',
    winner_id = p_winner_id,
    player1_total_points = case when player1_id = p_winner_id then p_winner_score else p_loser_score end,
    player2_total_points = case when player2_id = p_winner_id then p_winner_score else p_loser_score end,
    ended_at = now()
  where id = p_match_id;

  update public.profiles
  set
    wins = coalesce(wins, 0) + 1,
    matches_played = coalesce(matches_played, 0) + 1,
    mmr = coalesce(mmr, 1000) + 25
  where id = p_winner_id;

  update public.profiles
  set
    losses = coalesce(losses, 0) + 1,
    matches_played = coalesce(matches_played, 0) + 1,
    mmr = greatest(0, coalesce(mmr, 1000) - 15)
  where id = p_loser_id;
end;
$$;

-- Verify: still exactly one row, grants still only postgres + service_role,
-- security_definer = true, settings = {search_path=public}.
select p.oid::regprocedure as signature, p.prosecdef as security_definer,
       p.proconfig as settings, p.proacl as grants
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'finish_match' and n.nspname = 'public';


-- -----------------------------------------------------------------------------
-- ROLLBACK for STEP 3 (restores the previous behaviour: no MMR in the function).
-- Only use together with redeploying the previous server version, which then
-- updates MMR itself again.
-- -----------------------------------------------------------------------------
-- create or replace function public.finish_match(
--   p_match_id uuid, p_winner_id uuid, p_loser_id uuid, p_winner_score integer, p_loser_score integer)
-- returns void language plpgsql security definer
-- as $$
-- declare
--   v_match matches%rowtype;
-- begin
--   select * into v_match from matches where id = p_match_id for update;
--   if not found then
--     raise exception 'finish_match: no match found with id %', p_match_id;
--   end if;
--   if v_match.status = 'completed' then
--     return;
--   end if;
--   if not (
--     (v_match.player1_id = p_winner_id and v_match.player2_id = p_loser_id)
--     or (v_match.player1_id = p_loser_id and v_match.player2_id = p_winner_id)
--   ) then
--     raise exception 'finish_match: winner/loser ids do not match the players on match %', p_match_id;
--   end if;
--   update matches set status = 'completed', winner_id = p_winner_id,
--     player1_total_points = case when player1_id = p_winner_id then p_winner_score else p_loser_score end,
--     player2_total_points = case when player2_id = p_winner_id then p_winner_score else p_loser_score end,
--     ended_at = now()
--   where id = p_match_id;
--   update profiles set wins = coalesce(wins, 0) + 1, matches_played = coalesce(matches_played, 0) + 1
--   where id = p_winner_id;
--   update profiles set losses = coalesce(losses, 0) + 1, matches_played = coalesce(matches_played, 0) + 1
--   where id = p_loser_id;
-- end;
-- $$;
--
-- ROLLBACK for STEP 2 (recreates the old 3-argument function; do not do this
-- unless you really need it, it has no checks and must stay revoked from anon):
-- create or replace function public.finish_match(p_match_id uuid, p_winner_id uuid, p_loser_id uuid)
-- returns void language plpgsql security definer
-- as $$
-- begin
--   update matches set status = 'finished', winner_id = p_winner_id where id = p_match_id;
--   update profiles set wins = wins + 1, mmr = mmr + 10 where id = p_winner_id;
--   update profiles set losses = losses + 1 where id = p_loser_id;
-- end;
-- $$;
-- revoke execute on function public.finish_match(uuid, uuid, uuid) from public, anon, authenticated;
