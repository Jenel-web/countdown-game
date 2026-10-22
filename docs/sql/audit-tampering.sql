-- =============================================================================
-- READ-ONLY audit: has anyone already used the open profiles/matches policies?
-- Changes nothing. Returns ONE row with ONE JSON cell (the Supabase SQL editor
-- only shows the last statement's result). Run it before and after the
-- lockdown files in docs/sql/2026-10-21-*.sql.
--
-- How to read it:
--   impossible_mmr   - MMR above 1000 + 25 per recorded win. No legitimate
--                      history can produce that: almost certainly edited.
--   win_loss_mismatch - wins/losses differ from the player's completed matches.
--                      Can be legitimate for very old accounts (the dropped
--                      3-argument finish_match), otherwise suspicious.
--   reserved_usernames_in_use - names the app forbids that are already taken.
--   users_without_profile - auth accounts with no profiles row.
--   pending_matches   - open challenges per player and how many are stale.
--   status_values     - every matches.status value present, with counts.
-- =============================================================================

with wins_losses as (
  select
    p.id,
    p.username,
    p.mmr,
    p.wins,
    p.losses,
    p.matches_played,
    (select count(*) from public.matches m
      where m.winner_id = p.id and m.status in ('completed', 'finished')) as real_wins,
    (select count(*) from public.matches m
      where (m.player1_id = p.id or m.player2_id = p.id)
        and m.winner_id is not null and m.winner_id <> p.id
        and m.status in ('completed', 'finished')) as real_losses
  from public.profiles p
)
select json_build_object(

  'impossible_mmr', (
    select json_agg(json_build_object(
      'id', id, 'username', username, 'mmr', mmr, 'real_wins', real_wins,
      'max_possible_mmr', 1000 + 25 * real_wins
    ) order by mmr desc)
    from wins_losses
    where mmr > 1000 + 25 * real_wins
  ),

  'win_loss_mismatch', (
    select json_agg(json_build_object(
      'id', id, 'username', username,
      'wins', wins, 'real_wins', real_wins,
      'losses', losses, 'real_losses', real_losses,
      'matches_played', matches_played
    ) order by username)
    from wins_losses
    where wins <> real_wins or losses <> real_losses
  ),

  -- Keep this list identical to RESERVED_USERNAMES in lib/auth/username.ts
  -- (a test in lib/auth checks the lockdown SQL against it).
  'reserved_usernames_in_use', (
    select json_agg(json_build_object('id', id, 'username', username))
    from public.profiles
    where lower(username) in (
      'admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'system',
      'root', 'countdown', 'countdownarena', 'arena', 'official', 'null',
      'undefined', 'guest', 'opponent', 'you'
    )
  ),

  'users_without_profile', (
    select json_agg(json_build_object('id', u.id, 'created_at', u.created_at))
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
  ),

  'pending_matches', json_build_object(
    'total', (select count(*) from public.matches where status = 'pending'),
    'older_than_30_min', (select count(*) from public.matches
                          where status = 'pending' and created_at < now() - interval '30 minutes'),
    'top_players', (
      select json_agg(json_build_object('player1_id', player1_id, 'pending', n) order by n desc)
      from (
        select player1_id, count(*) as n
        from public.matches where status = 'pending'
        group by player1_id order by n desc limit 10
      ) t
    )
  ),

  'status_values', (
    select json_agg(json_build_object('status', status, 'count', n) order by n desc)
    from (select status, count(*) as n from public.matches group by status) t
  )

) as tampering_audit;
