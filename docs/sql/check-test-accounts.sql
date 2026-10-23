-- =============================================================================
-- READ-ONLY check of the two throwaway accounts used by scripts/db-attack-sim.ts
--   test_a_01   (account A: the script edits and restores its stats and username)
--   test_b_01   (account B)
-- Changes nothing. Returns ONE row with ONE JSON cell.
--
-- Run it (1) after registering both accounts, (2) before the exploit script and
-- (3) after it. Compare the two runs: mmr, wins, losses, matches_played and
-- username must be identical, because the script puts them back. The only
-- difference should be the match rows listed under "matches".
--
-- If you rename the accounts, change the two names in the list below.
-- Usernames can only contain letters, numbers and underscore (no hyphens).
-- =============================================================================

with test_names(username) as (
  values ('test_a_01'), ('test_b_01')
),
test_users as (
  select u.id, tn.username, u.email, u.created_at, u.email_confirmed_at
  from test_names tn
  left join auth.users u
    on lower(u.email) = lower(tn.username) || '@players.countdown.app'
)
select json_build_object(

  -- One entry per name. found = false means that account does not exist yet.
  'accounts', (
    select json_agg(json_build_object(
      'name', tu.username,
      'found', tu.id is not null,
      'id', tu.id,
      'email_confirmed', tu.email_confirmed_at is not null,
      'profile', (
        select json_build_object(
          'username', p.username, 'mmr', p.mmr, 'wins', p.wins,
          'losses', p.losses, 'matches_played', p.matches_played
        )
        from public.profiles p where p.id = tu.id
      )
    ) order by tu.username)
    from test_users tu
  ),

  -- Every match either account is part of, by status. After the exploit script
  -- and lockdown step A, "pending" and "completed" fake rows should be gone.
  'matches', (
    select json_agg(json_build_object('status', status, 'count', n) order by status)
    from (
      select m.status, count(*) as n
      from public.matches m
      where m.player1_id in (select id from test_users where id is not null)
         or m.player2_id in (select id from test_users where id is not null)
      group by m.status
    ) t
  ),

  -- Rounds belonging to those matches (the script must never leave any).
  'rounds_in_their_matches', (
    select count(*)
    from public.rounds r
    where r.match_id in (
      select m.id from public.matches m
      where m.player1_id in (select id from test_users where id is not null)
         or m.player2_id in (select id from test_users where id is not null)
    )
  )

) as test_accounts;
