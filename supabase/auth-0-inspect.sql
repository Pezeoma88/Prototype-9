-- =====================================================================
-- CarpoolBoard Prototype 8 — Feature 3 (secure auth): READ-ONLY inspection
-- =====================================================================
--
-- Run each query SEPARATELY in the Supabase SQL Editor and save the output
-- (copy it into a note, or use the editor's "Export CSV"). Nothing here
-- changes data: every statement is a SELECT.
--
-- Why this is needed: the original profiles / rides / ride_requests tables,
-- their RLS policies, accept_ride_request(), and the
-- ride_requests_no_self_request trigger were created in the dashboard and
-- are NOT in this repo. The auth migration (auth-1, auth-2) and the legacy
-- cleanup (auth-3) depend on what these queries show.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. Table shapes
-- ---------------------------------------------------------------------

-- A1. Every column of the four app tables (types, NOT NULL, defaults).
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
order by table_name, ordinal_position;

-- A2. Every constraint on those tables (checks, uniques, foreign keys).
select conrelid::regclass as table_name, conname, contype, convalidated,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.profiles'::regclass, 'public.rides'::regclass,
                   'public.ride_requests'::regclass, 'public.driver_reviews'::regclass)
order by 1, 2;

-- A3. FOREIGN KEYS THAT POINT AT profiles, with their ON DELETE rule.
--     This is what decides what deleting a profile would also delete:
--       c = CASCADE (deletes the child rows too)   n = SET NULL
--       r = RESTRICT / a = NO ACTION (the delete is refused)
select conrelid::regclass as child_table, conname,
       pg_get_constraintdef(oid) as definition,
       case confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                        when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                        when 'd' then 'SET DEFAULT' end as on_delete
from pg_constraint
where contype = 'f' and confrelid = 'public.profiles'::regclass
order by 1;

-- A4. Same, for foreign keys that point at rides (deleting a profile that
--     drives a ride can delete that ride, which then reaches these).
select conrelid::regclass as child_table, conname,
       case confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                        when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                        when 'd' then 'SET DEFAULT' end as on_delete
from pg_constraint
where contype = 'f' and confrelid = 'public.rides'::regclass
order by 1;

-- A5. Indexes (including the unique email rule).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
order by 1, 2;


-- A6. Unique rules on (ride_id, rider_id) — needed by ON CONFLICT in the
--     request and review functions. A2 only lists CONSTRAINTS; the
--     ride_requests rule was created as a plain unique INDEX
--     (prototype-6.sql: ride_requests_ride_rider_key), so it only shows here.
--     Expect one row for each table, with is_partial = false and
--     is_valid = true.
select c.relname as table_name, x.relname as index_name, i.indisunique as is_unique,
       i.indpred is not null as is_partial, i.indisvalid as is_valid,
       pg_get_indexdef(i.indexrelid) as definition
from pg_index i
join pg_class c on c.oid = i.indrelid
join pg_class x on x.oid = i.indexrelid
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('ride_requests', 'driver_reviews')
  and i.indisunique
order by 1, 2;

-- A7. Duplicate requests: riders with MORE THAN ONE request row for the
--     same ride. Expect 0 rows. Nothing is deleted or merged; if any rows
--     appear, we decide together which to keep.
select q.ride_id, q.rider_id, count(*) as rows,
       array_agg(q.status order by q.created_at) as statuses,
       array_agg(q.id order by q.created_at) as request_ids
from public.ride_requests q
group by q.ride_id, q.rider_id
having count(*) > 1;


-- ---------------------------------------------------------------------
-- B. Security as it is today
-- ---------------------------------------------------------------------

-- B1. Is RLS on for each table?
select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
order by 1;

-- B2. EVERY policy on the app tables and on Storage. Save this output:
--     auth-2 replaces these, and also copies them into a backup table.
select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
from pg_policies
where (schemaname = 'public'
       and tablename in ('profiles', 'rides', 'ride_requests', 'driver_reviews'))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

-- B3. Table privileges held by the app's roles (anon = signed out,
--     authenticated = signed in).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
  and table_name in ('profiles', 'rides', 'ride_requests', 'driver_reviews', 'driver_rating_summary')
group by 1, 2
order by 1, 2;

-- B4. Every function in public: SECURITY DEFINER or not, and who may run it.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security,
       p.proacl as execute_grants
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by 1, 2;

-- B5. The full source of accept_ride_request (not in the repo). auth-2
--     wraps it rather than rewriting it, but please keep a copy.
select pg_get_functiondef(p.oid)
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname = 'accept_ride_request';

-- B6. Triggers on the app tables (e.g. ride_requests_no_self_request).
select event_object_table as table_name, trigger_name, action_timing,
       string_agg(event_manipulation, ', ') as events, action_statement
from information_schema.triggers
where event_object_schema = 'public'
group by 1, 2, 3, 5
order by 1, 2;

-- B7. Triggers already on auth.users (auth-1 adds one; check there's no
--     older "handle_new_user" style trigger that would conflict).
select trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'auth' and event_object_table = 'users';


-- ---------------------------------------------------------------------
-- C. Accounts: who exists, and which login created them
-- ---------------------------------------------------------------------
-- These assume profiles has a created_at column (Supabase's Table Editor
-- adds one by default). If A1 shows it doesn't, delete the created_at
-- references from C2/C3 before running them.

-- C1. Supabase Auth users. Expected: 0 rows, because the app has never
--     called Supabase Auth. Any row here was made by hand in the dashboard.
select id, email, created_at, last_sign_in_at, email_confirmed_at
from auth.users
order by created_at;

-- C2. Every profile, classified. A profile whose id has no matching
--     auth.users row was created by the OLD email-and-name login (the app
--     inserted it straight into profiles). Emails are shown masked so this
--     output is safer to paste/share; remove the masking if you need to see
--     the full address.
select p.id,
       p.name,
       regexp_replace(p.email, '(^.).*(@.*$)', '\1***\2') as email_masked,
       p.role as signup_role,
       p.created_at,
       case when u.id is null then 'legacy (old email+name login)'
            else 'Supabase Auth account' end as origin
from public.profiles p
left join auth.users u on u.id = p.id
order by p.created_at;

-- C3. Per-profile activity: how much real data each profile owns. A
--     profile with zeros everywhere is very likely a throwaway test
--     account; one with rides/reviews involving OTHER people needs a
--     decision (see auth-3-legacy-cleanup.sql).
select p.id,
       p.name,
       p.created_at,
       (select count(*) from public.rides r where r.driver_id = p.id) as rides_driven,
       (select count(*) from public.rides r where r.driver_id = p.id and r.departure_at > now()) as upcoming_rides_driven,
       (select count(*) from public.ride_requests q where q.rider_id = p.id) as requests_sent,
       (select count(*) from public.ride_requests q
          join public.rides r on r.id = q.ride_id
         where r.driver_id = p.id and q.rider_id <> p.id) as requests_received_from_others,
       (select count(*) from public.driver_reviews d where d.driver_id = p.id) as reviews_about_them,
       (select count(*) from public.driver_reviews d where d.rider_id = p.id) as reviews_written,
       p.avatar_path is not null as has_photo
from public.profiles p
order by p.created_at;

-- C4. Totals, to compare before/after any change.
select (select count(*) from public.profiles) as profiles,
       (select count(*) from auth.users) as auth_users,
       (select count(*) from public.rides) as rides,
       (select count(*) from public.ride_requests) as requests,
       (select count(*) from public.driver_reviews) as reviews,
       (select count(*) from storage.objects where bucket_id = 'avatars') as avatar_files;

-- C5. Possible duplicate people: profiles that share a name (e.g. the same
--     tester signing up twice with different emails).
select lower(btrim(name)) as name, count(*), array_agg(id order by created_at) as profile_ids
from public.profiles
group by 1
having count(*) > 1;
