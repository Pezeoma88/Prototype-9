-- =====================================================================
-- CarpoolBoard Prototype 8 — Delete Account, step 0: inspect (READ-ONLY)
-- =====================================================================
--
-- Every query here only reads. Nothing is created, changed or deleted.
-- Run them ONE AT A TIME in the SQL Editor (it only shows the last
-- result of a run) and send me the output of each, labelled D1, D2, ...
--
-- What they answer before any deletion code is written:
--   D1        which Feature 3 steps (auth-1, auth-1b, auth-2) are applied
--   D2        every foreign key that deleting rides/profiles/auth users
--             could trigger, with its ON DELETE rule
--   D3-D4     the exact columns and rules the anonymized profile must fit
--   D5-D7     RLS on/off, every policy, and what each role may do
--   D8-D9     functions and triggers that the new checks must work with
--   D10-D12   the ratings view, Storage, and role attributes
--   D13       sizes, so the test account's changes can be spotted
-- =====================================================================


-- D1. Feature 3 status and current row counts (one row).
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles'
            and column_name = 'username')                         as auth1_username_column,
  exists (select 1 from pg_trigger
          where tgrelid = 'auth.users'::regclass
            and tgname = 'on_auth_user_created_profile')          as auth1_signup_trigger,
  exists (select 1 from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname = 'submit_my_ride_request')               as auth1_my_functions,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'sign_in_attempts'
            and column_name = 'client_key')                       as auth1b_throttle,
  exists (select 1 from pg_policies
          where schemaname = 'public' and policyname like 'auth: %') as auth2_policies,
  not has_table_privilege('anon', 'public.rides', 'select')       as auth2_anon_locked_out,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles'
            and column_name = 'deleted_at')                       as deleted_at_already_exists,
  (select count(*) from auth.users)                               as auth_users,
  (select count(*) from public.profiles)                          as profiles,
  (select count(*) from public.profiles p
   where exists (select 1 from auth.users u where u.id = p.id))   as profiles_with_login;



-- D2. Check foreign-key relationships and deletion rules.
-- READ ONLY: This query does not modify any data.

SELECT
    conrelid::regclass AS child_table,
    conname,
    confrelid::regclass AS parent_table,
    pg_get_constraintdef(oid) AS definition,
    CASE confdeltype
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'd' THEN 'SET DEFAULT'
    END AS on_delete
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN (
      'public.profiles'::regclass,
      'public.rides'::regclass,
      'public.ride_requests'::regclass,
      'public.driver_reviews'::regclass,
      'auth.users'::regclass
  )
  AND connamespace <> 'auth'::regnamespace
ORDER BY confrelid::regclass::text,
         conrelid::regclass::text;



-- D3. Columns of the tables the delete touches (type, NULL allowed,
--     default). Every personal column of profiles must be cleared.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'rides', 'ride_requests', 'driver_reviews',
                     'sign_in_attempts')
order by table_name, ordinal_position;


-- D4. Check, unique and primary-key rules on those tables, plus unique
--     indexes (the username rule may be an index, not a constraint).
--     "Deleted user" and a NULL username must pass all of them.
select conrelid::regclass as table_name, conname, contype::text as kind,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where contype in ('c', 'u', 'p')
  and conrelid in ('public.profiles'::regclass, 'public.rides'::regclass,
                   'public.ride_requests'::regclass, 'public.driver_reviews'::regclass)
union all
select indrelid::regclass, c.relname, 'index', pg_get_indexdef(i.indexrelid)
from pg_index i
join pg_class c on c.oid = i.indexrelid
where i.indisunique
  and i.indrelid in ('public.profiles'::regclass, 'public.ride_requests'::regclass,
                     'public.driver_reviews'::regclass)
order by 1, 2;


-- D5. Row Level Security switched on for every table the app can reach.
select n.nspname as schema, c.relname as table_name,
       c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
order by 1, 2;


-- D6. Every policy on public tables and storage.objects. The new
--     "deleted accounts can't write" rules are added next to these.
select schemaname, tablename, policyname, permissive, roles, cmd,
       qual as using_expr, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;


-- D7. What anon, authenticated and service_role may do on each table,
--     including column-level grants on profiles.
select 'table' as level, table_name, null as column_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
union all
select 'column', table_name, column_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.role_column_grants
where table_schema = 'public' and table_name = 'profiles'
  and grantee in ('anon', 'authenticated')
group by table_name, column_name, grantee
order by 1 desc, 2, 3 nulls first, 4;


-- D8. Functions in public: who owns them, whether they run as their
--     owner (SECURITY DEFINER), and who may call them. Any new function
--     must not be callable by anon/authenticated by default.
select p.oid::regprocedure as function,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as owner,
       p.proconfig as settings,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by 1;

-- D8b. Default privileges: does a NEW function in public become
--      executable by anon/authenticated automatically? (Supabase's default
--      is yes, which is why the new function must revoke explicitly.)
select pg_get_userbyid(defaclrole) as creator, defaclobjtype as object_type,
       defaclacl as default_grants
from pg_default_acl
where defaclnamespace = 'public'::regnamespace;


-- D9. Triggers on public tables and auth.users (not the internal FK
--     ones). The new write-check trigger must not clash with these.
select tgrelid::regclass as table_name, tgname, tgenabled,
       tgfoid::regprocedure as function,
       pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal
  and (tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
       or tgrelid = 'auth.users'::regclass)
order by 1, 2;

-- D9b. Source of the functions a deleted account could still call with
--      an old token, plus the sign-up trigger and username check. Shows
--      that they take the user from auth.uid().
select p.oid::regprocedure as function, pg_get_functiondef(p.oid) as source
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('submit_my_ride_request', 'submit_my_driver_review',
                    'accept_my_ride_request', 'handle_new_auth_user',
                    'is_username_available', 'prevent_past_departure')
order by 1;


-- D10. The ratings view: its definition, owner and whether it runs with
--      the caller's rights (security_invoker) or its owner's.
select c.relname as view_name, pg_get_userbyid(c.relowner) as owner,
       c.reloptions as options,
       pg_get_viewdef(c.oid, true) as definition
from pg_class c
where c.oid = 'public.driver_rating_summary'::regclass;


-- D11. Storage: bucket settings and how many files each holds.
select b.id, b.public, b.file_size_limit, b.allowed_mime_types,
       (select count(*) from storage.objects o where o.bucket_id = b.id) as files
from storage.buckets b
order by b.id;


-- D12. Role attributes. Tells whether service_role / postgres bypass RLS,
--      which decides how the delete function and new checks are written.
select rolname, rolsuper, rolbypassrls, rolinherit
from pg_roles
where rolname in ('postgres', 'service_role', 'authenticated', 'anon',
                  'authenticator', 'supabase_admin')
order by rolname;

-- D12b. How auth.uid() reads the caller (used by the new checks to tell
--       a signed-in user apart from the service role, which has no uid).
select pg_get_functiondef('auth.uid()'::regprocedure) as auth_uid_source;


-- D13. Sizes and status values, so the test account's effect is easy to
--      see afterwards.
select 'rides upcoming' as what, count(*) from public.rides where departure_at > now()
union all select 'rides departed', count(*) from public.rides where departure_at <= now()
union all select 'request status: ' || status, count(*) from public.ride_requests group by status
union all select 'reviews', count(*) from public.driver_reviews
union all select 'sign_in_attempts', count(*) from public.sign_in_attempts
order by 1;

-- Not SQL (Supabase Dashboard), please send these too:
--   * Project Settings → JWT Keys (or Authentication → Sessions):
--     access token expiry in seconds, and whether the project uses the
--     new JWT signing keys or the legacy JWT secret.
--   * Edge Functions: is username-sign-in deployed, and is "Verify JWT"
--     on or off for it?
--   * Project Settings → API Keys: publishable/secret keys (new style),
--     legacy anon/service_role keys, or both? (Names only, never the keys.)
