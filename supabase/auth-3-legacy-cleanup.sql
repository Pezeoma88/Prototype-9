-- =====================================================================
-- CarpoolBoard Prototype 8 — Feature 3, step 3: old login account cleanup
-- =====================================================================
--
-- PART 1 is READ-ONLY: run it and review the output.
-- PART 2 and PART 3 are COMMENTED OUT on purpose. Nothing in them runs
-- until you have approved a specific list of profile ids, and they are
-- then run by hand, one section at a time.
--
-- WHAT COUNTS AS AN "OLD LOGIN" PROFILE
--   The old email-and-name login inserted rows straight into profiles. It
--   never created a Supabase Auth user. So a legacy profile is one with
--   NO auth.users row of the same id. (Before Feature 3 auth.users should
--   be empty, which means EVERY current profile is legacy — including your
--   own test accounts. That is a statement about how they were created,
--   not proof they are disposable.)
--
-- WHAT DELETING A PROFILE TOUCHES (known from the repo; confirm the
-- unknown ones with auth-0 queries A3 and A4):
--   driver_reviews.driver_id / rider_id  ON DELETE CASCADE  (known)
--       -> deleting a profile silently deletes every review it wrote AND
--          every review written about it, which changes other drivers'
--          ratings.
--   driver_reviews.ride_id               ON DELETE SET NULL (known)
--       -> deleting a ride keeps its reviews, unlinked.
--   rides.driver_id                      UNKNOWN (not in repo) -> A3
--   ride_requests.rider_id               UNKNOWN (not in repo) -> A3
--   ride_requests.ride_id                CASCADE (the app relies on it
--                                        when a driver cancels a ride) -> A4
--   avatars bucket files                 NOT deleted by any of this; they
--                                        stay as public files until removed
--                                        in Storage (dashboard).
--   If A3 shows RESTRICT / NO ACTION, deleting a profile that still has
--   rides or requests fails instead of cascading. Either way, PART 3
--   deletes children explicitly first, so nothing depends on cascades.
--
-- AFTER auth-2 IS APPLIED, legacy profiles:
--   * can't be signed into (no password, no auth user, no username);
--   * still show their name/photo on old rides and reviews;
--   * their UPCOMING rides would still be listed as bookable, but nobody
--     can accept requests on them — these are the most important rows to
--     resolve (PART 1, query P4).
--   * their emails are no longer readable through the API (auth-2 removes
--     column access), but they are still stored until PART 3 runs.
-- =====================================================================


-- =====================================================================
-- PART 1 — READ-ONLY PREVIEW
-- =====================================================================
-- Each query below lists, for every legacy profile, exactly which rows a
-- cleanup would touch. Run them one at a time.

-- P1. The legacy profiles and their activity (same as auth-0 C3, legacy only).
select p.id, p.name,
       regexp_replace(p.email, '(^.).*(@.*$)', '\1***\2') as email_masked,
       (select count(*) from public.rides r where r.driver_id = p.id) as rides_driven,
       (select count(*) from public.ride_requests q where q.rider_id = p.id) as requests_sent,
       (select count(*) from public.driver_reviews d where d.driver_id = p.id) as reviews_about,
       (select count(*) from public.driver_reviews d where d.rider_id = p.id) as reviews_written,
       p.avatar_path
from public.profiles p
where not exists (select 1 from auth.users u where u.id = p.id)
order by p.name;

-- P2. Rides that would be removed (driven by a legacy profile), with how
--     many requests and reviews hang off each one.
select r.id as ride_id, p.name as driver, r.destination, r.departure_at,
       r.departure_at > now() as is_upcoming,
       (select count(*) from public.ride_requests q where q.ride_id = r.id) as requests,
       (select count(*) from public.driver_reviews d where d.ride_id = r.id) as reviews
from public.rides r
join public.profiles p on p.id = r.driver_id
where not exists (select 1 from auth.users u where u.id = r.driver_id)
order by r.departure_at;

-- P3. Ride requests that would be removed: sent BY a legacy profile, or
--     sent to a legacy driver's ride. involves_auth_account = true means a
--     real (new) account's data is affected — expect none before launch.
select q.id as request_id, q.status, q.created_at,
       rp.name as rider, dp.name as driver, r.destination,
       (exists (select 1 from auth.users u where u.id = q.rider_id)
        or exists (select 1 from auth.users u where u.id = r.driver_id)) as involves_auth_account
from public.ride_requests q
join public.rides r on r.id = q.ride_id
join public.profiles rp on rp.id = q.rider_id
join public.profiles dp on dp.id = r.driver_id
where not exists (select 1 from auth.users u where u.id = q.rider_id)
   or not exists (select 1 from auth.users u where u.id = r.driver_id)
order by q.created_at;

-- P4. UPCOMING rides by legacy drivers (would stay bookable but
--     un-manageable after auth-2).
select r.id, p.name as driver, r.destination, r.departure_at, r.seat_count
from public.rides r
join public.profiles p on p.id = r.driver_id
where r.departure_at > now()
  and not exists (select 1 from auth.users u where u.id = r.driver_id)
order by r.departure_at;

-- P5. Reviews that deleting legacy profiles would delete (written by or
--     about one), and the rating change it would cause for each driver.
select d.id as review_id, dp.name as driver, rp.name as reviewer, d.rating,
       d.ride_destination, d.created_at
from public.driver_reviews d
join public.profiles dp on dp.id = d.driver_id
join public.profiles rp on rp.id = d.rider_id
where not exists (select 1 from auth.users u where u.id = d.driver_id)
   or not exists (select 1 from auth.users u where u.id = d.rider_id)
order by d.created_at;

-- P6. Profile photo files belonging to legacy profiles (remove these in
--     Storage -> avatars after approval; SQL doesn't delete Storage files).
select o.name as file_path, o.created_at,
       (o.name = p.avatar_path) as is_current_photo
from storage.objects o
join public.profiles p on p.id::text = (storage.foldername(o.name))[1]
where o.bucket_id = 'avatars'
  and not exists (select 1 from auth.users u where u.id = p.id)
order by p.id, o.created_at;


-- =====================================================================
-- PART 2 — ARCHIVE (proposed; run only after approval)
-- =====================================================================
-- Copies everything about the chosen profiles into a separate, non-API
-- schema before anything is changed, so a mistake can be undone by hand.
-- Replace the id list in BOTH places with the ids you approved from P1.
--
-- begin;
-- create schema if not exists legacy_archive;
-- revoke all on schema legacy_archive from public, anon, authenticated;
--
-- create table legacy_archive.profiles as
--   select *, now() as archived_at from public.profiles
--   where id in ('00000000-0000-0000-0000-000000000000' /* approved ids */);
-- create table legacy_archive.rides as
--   select * from public.rides where driver_id in (select id from legacy_archive.profiles);
-- create table legacy_archive.ride_requests as
--   select * from public.ride_requests
--   where rider_id in (select id from legacy_archive.profiles)
--      or ride_id in (select id from legacy_archive.rides);
-- create table legacy_archive.driver_reviews as
--   select * from public.driver_reviews
--   where driver_id in (select id from legacy_archive.profiles)
--      or rider_id in (select id from legacy_archive.profiles);
--
-- -- Check the counts match P1-P5 before committing:
-- select (select count(*) from legacy_archive.profiles) as profiles,
--        (select count(*) from legacy_archive.rides) as rides,
--        (select count(*) from legacy_archive.ride_requests) as requests,
--        (select count(*) from legacy_archive.driver_reviews) as reviews;
-- commit;


-- =====================================================================
-- PART 3 — CLEANUP (proposed; pick ONE option per profile, after approval)
-- =====================================================================
-- Both options work from legacy_archive.profiles (PART 2), so they only
-- ever touch the approved ids, and both refuse to touch a profile that has
-- a Supabase Auth account.

-- ---- Option A: DELETE the approved test profiles and their data --------
-- For throwaway test accounts. Children are deleted explicitly, in order,
-- so the result doesn't depend on the cascade rules.
--
-- begin;
-- do $$
-- begin
--   if exists (select 1 from legacy_archive.profiles a join auth.users u on u.id = a.id) then
--     raise exception 'Stopped: an approved id belongs to a Supabase Auth account.';
--   end if;
-- end $$;
-- delete from public.driver_reviews
--  where driver_id in (select id from legacy_archive.profiles)
--     or rider_id in (select id from legacy_archive.profiles);
-- delete from public.ride_requests
--  where rider_id in (select id from legacy_archive.profiles)
--     or ride_id in (select id from public.rides
--                    where driver_id in (select id from legacy_archive.profiles));
-- delete from public.rides
--  where driver_id in (select id from legacy_archive.profiles);
-- delete from public.profiles
--  where id in (select id from legacy_archive.profiles);
-- -- Expect 0 rows left for the approved ids:
-- select count(*) from public.profiles where id in (select id from legacy_archive.profiles);
-- commit;
-- -- Then: Storage -> avatars -> delete each folder named by an approved id (P6).

-- ---- Option B: KEEP as history, but remove the email and retire it ----
-- For profiles whose rides/reviews involve other people and should stay
-- visible. The email address is removed (it was never verified and is no
-- longer needed), the name/photo/reviews stay, and upcoming rides are
-- removed so nobody requests a seat from a driver who can't sign in.
--
-- begin;
-- do $$
-- begin
--   if exists (select 1 from legacy_archive.profiles a join auth.users u on u.id = a.id) then
--     raise exception 'Stopped: an approved id belongs to a Supabase Auth account.';
--   end if;
-- end $$;
-- delete from public.ride_requests
--  where ride_id in (select id from public.rides
--                    where driver_id in (select id from legacy_archive.profiles)
--                      and departure_at > now());
-- delete from public.rides
--  where driver_id in (select id from legacy_archive.profiles)
--    and departure_at > now();
-- update public.ride_requests set status = 'cancelled'
--  where rider_id in (select id from legacy_archive.profiles)
--    and status = 'pending';
-- update public.profiles set email = null
--  where id in (select id from legacy_archive.profiles);
-- commit;


-- =====================================================================
-- VERIFICATION after PART 3 (read-only)
-- =====================================================================
-- select (select count(*) from public.profiles) as profiles,
--        (select count(*) from public.profiles where email is not null) as with_email,
--        (select count(*) from public.profiles p
--          where not exists (select 1 from auth.users u where u.id = p.id)) as legacy_left,
--        (select count(*) from public.rides) as rides,
--        (select count(*) from public.ride_requests) as requests,
--        (select count(*) from public.driver_reviews) as reviews;
