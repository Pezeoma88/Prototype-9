-- =====================================================================
-- CarpoolBoard Prototype 8 — Feature 3, step 2: Row Level Security lockdown
-- =====================================================================
--
-- Switches the database from "anyone holding the publishable key can do
-- anything" to "only signed-in users, and only to their own rows":
--
--   table            signed out (anon)   signed in (authenticated)
--   ---------------  ------------------  ---------------------------------
--   profiles         nothing             read public columns of everyone
--                                        (never email); update OWN name,
--                                        bio, vehicle, photo (photo path
--                                        must be in their own folder). No
--                                        insert (the auth trigger does
--                                        that), no delete.
--   rides            nothing             read all; insert/update/delete
--                                        only rides where driver = me
--   ride_requests    nothing             read all; NO direct insert (only
--                                        submit_my_ride_request creates
--                                        requests); rider may set OWN
--                                        request to 'cancelled';
--                                        driver may set a pending request
--                                        on THEIR ride to 'denied'; accept
--                                        only via accept_my_ride_request
--   driver_reviews   nothing             read all; write only via
--                                        submit_my_driver_review
--   avatars bucket   view public URLs    upload only into <my id>/
--
-- The old functions that trusted a caller-supplied rider id
-- (submit_ride_request, submit_driver_review) and accept_ride_request are
-- no longer executable by the app's roles. They are NOT dropped, so the
-- rollback below can restore them.
--
-- !! THIS STEP ENDS THE OLD EMAIL-AND-NAME LOGIN !!
-- After it runs, the current app build (no Supabase Auth) can no longer
-- read or write anything. Run it only when the new app build is ready,
-- after auth-1-accounts.sql, the Auth settings, and the username-sign-in
-- Edge Function are in place (see supabase/AUTH-MIGRATION.md).
--
-- Safety:
--   * No row in profiles, rides, ride_requests, driver_reviews or storage
--     is inserted, updated or deleted. Only policies and privileges change.
--   * Every existing policy on the four tables is first COPIED into
--     public.auth_migration_policy_backup, so it can be restored exactly.
--   * Step 0 checks that auth-1 ran. Idempotent. One transaction.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only)
-- ---------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.submit_my_ride_request(uuid, text)') is null
     or to_regprocedure('public.submit_my_driver_review(uuid, integer, text)') is null
     or to_regprocedure('public.accept_my_ride_request(uuid)') is null
     or to_regclass('public.sign_in_attempts') is null then
    raise exception 'auth-2 stopped: run supabase/auth-1-accounts.sql first. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles'
                   and column_name = 'username') then
    raise exception 'auth-2 stopped: profiles.username is missing (auth-1 not applied).';
  end if;
  -- This file removes direct INSERT on ride_requests, so the request
  -- function must run with its owner's rights (current auth-1).
  if not (select prosecdef from pg_proc
          where oid = 'public.submit_my_ride_request(uuid, text)'::regprocedure) then
    raise exception 'auth-2 stopped: submit_my_ride_request is not SECURITY DEFINER. Re-run the current auth-1-accounts.sql first.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. Back up the current policies (first run only)
-- ---------------------------------------------------------------------

create table if not exists public.auth_migration_policy_backup (
  schemaname name not null,
  tablename name not null,
  policyname name not null,
  permissive text not null,
  roles name[] not null,
  cmd text not null,
  qual text,
  with_check text,
  backed_up_at timestamptz not null default now(),
  primary key (schemaname, tablename, policyname)
);
alter table public.auth_migration_policy_backup enable row level security;
revoke all on table public.auth_migration_policy_backup from public, anon, authenticated;

insert into public.auth_migration_policy_backup
  (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public'
       and tablename in ('profiles', 'rides', 'ride_requests', 'driver_reviews'))
   or (schemaname = 'storage' and tablename = 'objects'
       and policyname = 'avatars: anon upload into existing profile folder')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Remove the old (anon) policies
-- ---------------------------------------------------------------------
-- Every policy on the four tables is dropped, except the ones this file
-- creates (so a re-run doesn't drop and re-create them needlessly). They
-- are all in the backup above. This includes the interim
-- "authenticated users can read own profile" policy added by hand during
-- testing: step 4 replaces it with "auth: signed-in users read profiles"
-- (every profile, which the board needs). Both happen in this one
-- transaction, so signed-in users never lose profile access.

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
      and policyname not like 'auth: %'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

drop policy if exists "avatars: anon upload into existing profile folder" on storage.objects;

-- ---------------------------------------------------------------------
-- 3. RLS on, and table privileges for signed-in users only
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.rides enable row level security;
alter table public.ride_requests enable row level security;
alter table public.driver_reviews enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.rides from public, anon, authenticated;
revoke all on table public.ride_requests from public, anon, authenticated;
revoke all on table public.driver_reviews from public, anon, authenticated;
revoke all on table public.driver_rating_summary from public, anon, authenticated;

-- profiles: column-level privileges. email (legacy only) is not readable
-- by anyone through the API, and username/role/id can't be changed.
grant select (id, username, name, role, bio, vehicle_make_model, avatar_path)
  on public.profiles to authenticated;
grant update (name, bio, vehicle_make_model, avatar_path)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.rides to authenticated;

-- ride_requests: rows are only created by submit_my_ride_request (SECURITY
-- DEFINER), so the app gets no INSERT at all and can't skip its checks.
-- Only the status can be changed directly.
grant select on public.ride_requests to authenticated;
grant update (status) on public.ride_requests to authenticated;

grant select on public.driver_reviews to authenticated;
grant select on public.driver_rating_summary to authenticated;

-- ---------------------------------------------------------------------
-- 4. New policies (all for signed-in users; "auth: " prefix)
-- ---------------------------------------------------------------------
-- (select auth.uid()) instead of auth.uid() lets Postgres evaluate it once
-- per query instead of once per row.

do $$
begin
  -- profiles -----------------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                 and policyname = 'auth: signed-in users read profiles') then
    create policy "auth: signed-in users read profiles"
      on public.profiles for select to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                 and policyname = 'auth: users update own profile') then
    -- A photo path must point into the person's own avatars folder, so
    -- nobody can show someone else's uploaded photo as their own.
    create policy "auth: users update own profile"
      on public.profiles for update to authenticated
      using (id = (select auth.uid()))
      with check (
        id = (select auth.uid())
        and (avatar_path is null or avatar_path like (select auth.uid())::text || '/%')
      );
  end if;

  -- rides --------------------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rides'
                 and policyname = 'auth: signed-in users read rides') then
    create policy "auth: signed-in users read rides"
      on public.rides for select to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rides'
                 and policyname = 'auth: drivers post own rides') then
    create policy "auth: drivers post own rides"
      on public.rides for insert to authenticated
      with check (driver_id = (select auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rides'
                 and policyname = 'auth: drivers edit own rides') then
    create policy "auth: drivers edit own rides"
      on public.rides for update to authenticated
      using (driver_id = (select auth.uid()))
      with check (driver_id = (select auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rides'
                 and policyname = 'auth: drivers cancel own rides') then
    create policy "auth: drivers cancel own rides"
      on public.rides for delete to authenticated
      using (driver_id = (select auth.uid()));
  end if;

  -- ride_requests ------------------------------------------------------
  -- Readable by every signed-in user, as today: the board's Looking for a
  -- Ride and confirmed-passenger lists are built from them. (Follow-up:
  -- limit `reason` to the rider and the ride's driver.)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ride_requests'
                 and policyname = 'auth: signed-in users read requests') then
    create policy "auth: signed-in users read requests"
      on public.ride_requests for select to authenticated
      using (true);
  end if;

  -- No INSERT policy on ride_requests: see the grants above.

  -- Rider: withdraw a pending request or give up a confirmed seat.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ride_requests'
                 and policyname = 'auth: riders cancel own requests') then
    create policy "auth: riders cancel own requests"
      on public.ride_requests for update to authenticated
      using (rider_id = (select auth.uid()) and status in ('pending', 'accepted'))
      with check (rider_id = (select auth.uid()) and status = 'cancelled');
  end if;

  -- Driver: deny a pending request on their own ride. (Accept goes through
  -- accept_my_ride_request, which also handles seats.)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ride_requests'
                 and policyname = 'auth: drivers deny requests on own rides') then
    create policy "auth: drivers deny requests on own rides"
      on public.ride_requests for update to authenticated
      using (
        status = 'pending'
        and exists (select 1 from public.rides r
                    where r.id = ride_id and r.driver_id = (select auth.uid()))
      )
      with check (
        status = 'denied'
        and exists (select 1 from public.rides r
                    where r.id = ride_id and r.driver_id = (select auth.uid()))
      );
  end if;

  -- driver_reviews -----------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'driver_reviews'
                 and policyname = 'auth: signed-in users read reviews') then
    create policy "auth: signed-in users read reviews"
      on public.driver_reviews for select to authenticated
      using (true);
  end if;

  -- avatars bucket -----------------------------------------------------
  -- Same path rule as before ('<uuid>/<13-digit ms>.jpg|jpeg|png'), but
  -- the folder must be the uploader's OWN id. Viewing stays public (the
  -- bucket is public); no list, overwrite or delete.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'avatars: users upload into own folder') then
    create policy "avatars: users upload into own folder"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{13}\.(jpg|jpeg|png)$'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 5. Lock away the functions that trusted a caller-supplied id
-- ---------------------------------------------------------------------

revoke all on function public.submit_ride_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.submit_driver_review(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.accept_ride_request(uuid) from public, anon, authenticated;

comment on function public.submit_ride_request(uuid, uuid, text) is
  'RETIRED (Feature 3): trusted a caller-supplied rider id. Not executable by the app; use submit_my_ride_request.';
comment on function public.submit_driver_review(uuid, uuid, integer, text) is
  'RETIRED (Feature 3): trusted a caller-supplied rider id. Not executable by the app; use submit_my_driver_review.';

commit;

notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the migration above
-- =====================================================================
--
-- -- a) The new policies (and no anon ones) on the app tables:
-- select tablename, policyname, cmd, roles from pg_policies
-- where schemaname = 'public'
--   and tablename in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
-- order by 1, 2;
--
-- -- b) anon has no table privileges left (expect 0 rows):
-- select table_name, privilege_type from information_schema.role_table_grants
-- where table_schema = 'public' and grantee = 'anon'
--   and table_name in ('profiles', 'rides', 'ride_requests', 'driver_reviews', 'driver_rating_summary');
--
-- -- c) Old functions not executable by the app roles (expect false x6):
-- select has_function_privilege('anon', 'public.submit_ride_request(uuid, uuid, text)', 'execute'),
--        has_function_privilege('authenticated', 'public.submit_ride_request(uuid, uuid, text)', 'execute'),
--        has_function_privilege('anon', 'public.submit_driver_review(uuid, uuid, integer, text)', 'execute'),
--        has_function_privilege('authenticated', 'public.submit_driver_review(uuid, uuid, integer, text)', 'execute'),
--        has_function_privilege('anon', 'public.accept_ride_request(uuid)', 'execute'),
--        has_function_privilege('authenticated', 'public.accept_ride_request(uuid)', 'execute');
--
-- -- c2) No way around the new functions (expect 0 rows). Lists every
-- --     public function the app's roles can still execute, other than the
-- --     ones meant for them, and every table/view anon can still use:
-- select 'function' as kind, p.oid::regprocedure::text as name,
--        has_function_privilege('anon', p.oid, 'execute') as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.prorettype <> 'trigger'::regtype
--   and (has_function_privilege('anon', p.oid, 'execute')
--        or has_function_privilege('authenticated', p.oid, 'execute'))
--   and p.oid::regprocedure::text not in (
--     'is_username_available(text)',
--     'submit_my_ride_request(uuid,text)',
--     'submit_my_driver_review(uuid,integer,text)',
--     'accept_my_ride_request(uuid)')
-- union all
-- select 'table', c.relname, true, null
-- from pg_class c
-- where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
--   and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
--        or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'));
--
-- -- c3) Signed-in users can't insert requests directly (expect false):
-- select has_table_privilege('authenticated', 'public.ride_requests', 'insert');
--
-- -- d) Data untouched (compare with auth-0 query C4):
-- select (select count(*) from public.profiles) as profiles,
--        (select count(*) from public.rides) as rides,
--        (select count(*) from public.ride_requests) as requests,
--        (select count(*) from public.driver_reviews) as reviews;
--
-- -- d2) A signed-in user can still read their own profile (and others').
-- --      Replace YOUR_USER_ID (both places) with your auth user id; expect
-- --      your row, then a count of all profiles. Rolled back, changes nothing.
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--        json_build_object('sub', 'YOUR_USER_ID', 'role', 'authenticated')::text, true);
-- select id, username, name, role from public.profiles where id = 'YOUR_USER_ID';
-- select count(*) from public.profiles;
-- rollback;
--
-- -- e) What was backed up:
-- select schemaname, tablename, policyname, cmd, roles from public.auth_migration_policy_backup;


-- =====================================================================
-- ROLLBACK — only to go back to the old anon access. Not run by default.
-- =====================================================================
-- Step R1 PRINTS the statements that re-create the backed-up policies;
-- review its output, then run it together with R2 in one transaction.
--
-- -- R1 (read-only): generate the old policies
-- select format(
--   'create policy %I on %I.%I as %s for %s to %s%s%s;',
--   policyname, schemaname, tablename, permissive, cmd,
--   array_to_string(roles, ', '),
--   case when qual is not null then ' using (' || qual || ')' else '' end,
--   case when with_check is not null then ' with check (' || with_check || ')' else '' end)
-- from public.auth_migration_policy_backup;
--
-- -- R2
-- begin;
-- drop policy if exists "auth: signed-in users read profiles" on public.profiles;
-- drop policy if exists "auth: users update own profile" on public.profiles;
-- drop policy if exists "auth: signed-in users read rides" on public.rides;
-- drop policy if exists "auth: drivers post own rides" on public.rides;
-- drop policy if exists "auth: drivers edit own rides" on public.rides;
-- drop policy if exists "auth: drivers cancel own rides" on public.rides;
-- drop policy if exists "auth: signed-in users read requests" on public.ride_requests;
-- drop policy if exists "auth: riders cancel own requests" on public.ride_requests;
-- drop policy if exists "auth: drivers deny requests on own rides" on public.ride_requests;
-- drop policy if exists "auth: signed-in users read reviews" on public.driver_reviews;
-- drop policy if exists "avatars: users upload into own folder" on storage.objects;
-- -- (paste R1's output here)
-- grant all on public.profiles, public.rides, public.ride_requests to anon, authenticated;
-- grant select on public.driver_reviews, public.driver_rating_summary to anon, authenticated;
-- grant execute on function public.submit_ride_request(uuid, uuid, text) to anon, authenticated;
-- grant execute on function public.submit_driver_review(uuid, uuid, integer, text) to anon, authenticated;
-- grant execute on function public.accept_ride_request(uuid) to anon, authenticated;
-- commit;
-- notify pgrst, 'reload schema';
