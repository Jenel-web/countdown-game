-- =============================================================================
-- READ-ONLY security snapshot of profiles / matches / rounds.
-- Changes nothing. Returns ONE row with ONE JSON cell, because the Supabase SQL
-- editor only displays the result of the last statement in a script.
--
-- Run it in the SQL editor, click the result cell, copy the whole JSON.
-- Re-run it after applying any lockdown SQL to verify the change.
-- =============================================================================

select json_build_object(

  -- Policies only apply when RLS is ON for the table.
  'rls_enabled', (
    select json_agg(json_build_object('table', c.relname, 'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('profiles', 'matches', 'rounds')
  ),

  'policies', (
    select json_agg(json_build_object(
      'table', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles,
      'permissive', permissive, 'using', qual, 'check', with_check
    ) order by tablename, policyname)
    from pg_policies
    where schemaname = 'public' and tablename in ('profiles', 'matches', 'rounds')
  ),

  -- Table-level grants for the roles the browser and server use.
  'table_grants', (
    select json_agg(json_build_object('table', table_name, 'role', grantee, 'privileges', privs) order by table_name, grantee)
    from (
      select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('profiles', 'matches', 'rounds')
        and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role')
      group by table_name, grantee
    ) t
  ),

  -- Which COLUMNS each browser role may read/write (answers "can a player update mmr?").
  'column_grants', (
    select json_agg(json_build_object('table', table_name, 'role', grantee, 'privilege', privilege_type, 'columns', cols)
                    order by table_name, grantee, privilege_type)
    from (
      select table_name, grantee, privilege_type, string_agg(column_name, ', ' order by column_name) as cols
      from information_schema.column_privileges
      where table_schema = 'public'
        and table_name in ('profiles', 'matches', 'rounds')
        and grantee in ('anon', 'authenticated', 'PUBLIC')
      group by table_name, grantee, privilege_type
    ) t
  ),

  'columns', (
    select json_agg(json_build_object(
      'table', table_name, 'column', column_name, 'type', data_type,
      'nullable', is_nullable, 'default', column_default
    ) order by table_name, ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name in ('profiles', 'matches', 'rounds')
  ),

  -- PK / FK / UNIQUE / CHECK with their full definitions.
  'constraints', (
    select json_agg(json_build_object(
      'table', conrelid::regclass::text, 'name', conname, 'type', contype, 'definition', pg_get_constraintdef(oid)
    ) order by conrelid::regclass::text, conname)
    from pg_constraint
    where conrelid in ('public.profiles'::regclass, 'public.matches'::regclass, 'public.rounds'::regclass)
  ),

  -- Includes expression indexes such as unique (lower(username)), which are not constraints.
  'indexes', (
    select json_agg(json_build_object('table', tablename, 'name', indexname, 'definition', indexdef) order by tablename, indexname)
    from pg_indexes
    where schemaname = 'public' and tablename in ('profiles', 'matches', 'rounds')
  ),

  -- User-defined triggers on the three tables AND on auth.users (where a
  -- signup trigger such as handle_new_user would be attached).
  'triggers', (
    select json_agg(json_build_object('table', tgrelid::regclass::text, 'name', tgname, 'definition', pg_get_triggerdef(oid))
                    order by tgrelid::regclass::text, tgname)
    from pg_trigger
    where not tgisinternal
      and tgrelid in ('public.profiles'::regclass, 'public.matches'::regclass, 'public.rounds'::regclass, 'auth.users'::regclass)
  ),

  -- Every function in public: who may execute it (acl), its settings
  -- (search_path!) and its full body.
  'functions', (
    select json_agg(json_build_object(
      'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'settings', p.proconfig,
      'execute_grants', p.proacl::text,
      'body', pg_get_functiondef(p.oid)
    ) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  ),

  -- Tables whose row changes are broadcast over Realtime (subject to RLS).
  'realtime_tables', (
    select json_agg(schemaname || '.' || tablename)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
  )

) as security_report;
