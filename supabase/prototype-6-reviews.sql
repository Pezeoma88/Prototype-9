-- =====================================================================
-- CarpoolBoard Prototype 6 — Driver ratings and reviews: database migration
-- =====================================================================
--
-- Adds what driver ratings and reviews need from the database:
--   1. driver_reviews          one row per review a rider left for a driver
--   2. read-only access        the app can read reviews, and cannot insert,
--                              update or delete them directly
--   3. driver_rating_summary   each driver's review count and average
--   4. submit_driver_review()  the only way a review is created; it checks
--                              that the rider is eligible first
--
-- Run this AFTER supabase/prototype-6.sql (it relies on that file's rule of
-- one ride_requests row per ride and rider).
--
-- Safety:
--   * Additive only: no DROP, DELETE, TRUNCATE, or UPDATE of existing rows.
--   * profiles, rides and ride_requests are not altered: no new columns,
--     constraints, triggers, policies or grants on them. Existing functions
--     (submit_ride_request, accept_ride_request) are not touched.
--   * Step 0 checks the things this file assumes and stops with a clear
--     message if one is wrong. Nothing is ever "fixed" automatically.
--   * Idempotent: running the whole file again is a no-op.
--   * Wrapped in one transaction: if any step fails, nothing is applied.
--
-- THE ELIGIBILITY RULE (a prototype rule, not proof a ride happened)
-- A rider may review a ride when ALL of these are true at the moment they
-- submit, as judged by the database's own clock:
--   * the ride still exists (a cancelled ride is deleted, so it can't be
--     reviewed),
--   * the rider has a request on it whose status is 'accepted' right now
--     (a seat that was left, a denied request or a withdrawn one doesn't
--     count),
--   * that request was sent before the ride's scheduled departure,
--   * at least one hour has passed since the scheduled departure,
--   * the rider is not the ride's driver, and
--   * the rider has not already reviewed this ride.
-- CarpoolBoard has no record of whether a ride actually took place, who
-- showed up, or when it arrived. "Scheduled departure plus one hour, with a
-- confirmed seat" is a stand-in for "completed". A no-show rider, or a
-- rider on a ride that never left, can still leave a review.
--
-- Known gaps in that rule, left as they are on purpose:
--   * ride_requests has no "accepted at" time, so the database can't tell a
--     seat confirmed before departure from one a driver confirms afterwards.
--     Only the request's created_at is checked. Getting past this needs the
--     driver to accept a late request on their own ride.
--   * A driver can edit a ride's departure time. Moving it into the future
--     closes reviews on that ride until an hour after the new time. Reviews
--     already written are kept and are not changed.
--   * Reusing one ride row for a second trip (by editing its departure) does
--     not allow a second review: it is still one review per rider per ride.
--
-- WHY THIS FUNCTION IS SECURITY DEFINER (unlike submit_ride_request)
-- The app's role (anon) gets SELECT on driver_reviews and nothing else, so
-- it cannot write a review directly and skip the checks. The function
-- therefore has to run with its owner's rights to do the one INSERT. To
-- keep that safe it has a fixed empty search_path, names every table in
-- full, takes no SQL from the caller, and can only ever insert one row
-- into driver_reviews. It never updates or deletes anything.
--
-- PROTOTYPE SECURITY LIMITATION — rider ids are NOT authenticated.
-- CarpoolBoard does not use Supabase Auth, so the database has no way to
-- know who is calling. submit_driver_review takes the rider id as a plain
-- parameter (p_rider_id) and believes it, exactly like submit_ride_request.
-- Anyone holding the app's publishable key could call it with another
-- rider's profile id and leave a review in that person's name, provided
-- that rider really is eligible. The checks above stop reviews from people
-- with no confirmed seat; they do not prove who is typing. And because the
-- prototype's existing anon policies on rides and ride_requests are open,
-- someone with the key could also edit those rows first to make a rider
-- look eligible. This is acceptable for a class prototype and NOT for real
-- users. The real fix is Supabase Auth, with the function reading the rider
-- from auth.uid() instead of a parameter.
--
-- NOT included on purpose:
--   * editing or deleting a review (reviews are final)
--   * riders being reviewed by drivers
--   * any change to RLS policies on profiles, rides or ride_requests
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only; stop early instead of guessing)
-- ---------------------------------------------------------------------

do $$
declare
  v_problems text;
begin
  -- security_invoker views (step 3) need PostgreSQL 15 or newer.
  if current_setting('server_version_num')::integer < 150000 then
    raise exception
      'Reviews migration stopped: PostgreSQL 15 or newer is required (this is %). Nothing was changed.',
      current_setting('server_version');
  end if;

  -- Every column the function reads must exist with the type it expects.
  -- The two timestamps must carry a time zone: the one-hour rule compares
  -- them with now(), and a zone-less timestamp would be off by the server's
  -- UTC offset.
  select string_agg(
           expected.table_name || '.' || expected.column_name
             || coalesce(' should be ' || expected.data_type, ' should exist')
             || coalesce(' but is ' || c.data_type, ' but is missing'),
           '; '
         )
    into v_problems
  from (
    values
      ('profiles', 'id', 'uuid'),
      ('rides', 'id', 'uuid'),
      ('rides', 'driver_id', 'uuid'),
      ('rides', 'destination', 'text'),
      ('rides', 'departure_at', 'timestamp with time zone'),
      ('ride_requests', 'ride_id', 'uuid'),
      ('ride_requests', 'rider_id', 'uuid'),
      ('ride_requests', 'status', null),
      ('ride_requests', 'created_at', 'timestamp with time zone')
  ) as expected (table_name, column_name, data_type)
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = expected.table_name
   and c.column_name = expected.column_name
  where c.column_name is null
     or (expected.data_type is not null and c.data_type <> expected.data_type);
  if v_problems is not null then
    raise exception 'Reviews migration stopped: %. Nothing was changed.', v_problems;
  end if;

  -- The function looks up "the" request for a ride and rider, so there must
  -- be at most one. prototype-6.sql adds the rule that guarantees it.
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.ride_requests'::regclass
      and i.indisunique
      and i.indisvalid
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts = 2
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(i.indkey::int2[]) with ordinality as k (attnum, position)
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = k.attnum
        where k.position <= i.indnkeyatts
      ) = array['ride_id', 'rider_id']::text[]
  ) then
    raise exception
      'Reviews migration stopped: ride_requests has no unique rule on (ride_id, rider_id). Run supabase/prototype-6.sql first. Nothing was changed.';
  end if;

  -- submit_driver_review (step 4) runs as the role running this file, and
  -- reads profiles, rides and ride_requests with that role's rights. Those
  -- tables use Row Level Security, and their policies are written for the
  -- app's roles, not this one. Unless this role skips RLS on them (it owns
  -- them, or has BYPASSRLS), the function would find no rows and refuse
  -- every review with "This ride is no longer available". Stop now instead.
  select string_agg(c.relname, ', ' order by c.relname)
    into v_problems
  from pg_class c
  join pg_roles me on me.rolname = current_user
  where c.oid in (
      'public.profiles'::regclass,
      'public.rides'::regclass,
      'public.ride_requests'::regclass
    )
    and c.relrowsecurity
    and not me.rolsuper
    and not me.rolbypassrls
    and (c.relforcerowsecurity or not pg_has_role(current_user, c.relowner, 'USAGE'));
  if v_problems is not null then
    raise exception
      'Reviews migration stopped: role % would be limited by Row Level Security on % (it neither owns them nor bypasses RLS), so the review function could not read them. Run this file as the tables'' owner (postgres in the Supabase SQL Editor). Nothing was changed.',
      current_user, v_problems;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. driver_reviews
-- ---------------------------------------------------------------------
-- One row per review. Rows are only ever created by submit_driver_review
-- (step 4) and are never changed afterwards.
--
-- What happens when other rows are deleted:
--   * The ride is deleted (the driver cancels it): the review is KEPT and
--     its ride_id becomes NULL. A driver can't erase reviews by deleting the
--     ride. driver_id, ride_destination and ride_departure_at are stored on
--     the review itself so it still makes sense without the ride.
--   * The driver's or the rider's profile is deleted: the review goes with
--     it. The app has no way to delete a profile; this only matters for
--     manual clean-up in the Supabase dashboard.

create table if not exists public.driver_reviews (
  id uuid primary key default gen_random_uuid(),

  -- The ride being reviewed. NULL only after that ride was deleted.
  ride_id uuid references public.rides (id) on delete set null,

  -- Who was reviewed and who wrote it. Copied from the ride and the request
  -- by the function, never taken from the caller for the driver.
  driver_id uuid not null references public.profiles (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete cascade,

  -- 1 to 5 stars, whole numbers only.
  rating smallint not null,

  -- Optional written feedback. "No comment" is an empty string, never NULL.
  comment text not null default '',

  -- The ride as it was when the review was written, so the review history
  -- can still say "Ride to NorthPark, Oct 13" after the ride is gone.
  ride_destination text not null,
  ride_departure_at timestamptz not null,

  created_at timestamptz not null default now(),

  constraint driver_reviews_rating_check
    check (rating between 1 and 5),

  -- At most 300 characters, stored trimmed.
  constraint driver_reviews_comment_check
    check (char_length(comment) <= 300 and comment = btrim(comment)),

  -- Nobody reviews themselves. The function refuses this with a friendlier
  -- message first; this is the backstop.
  constraint driver_reviews_no_self_review
    check (rider_id <> driver_id),

  -- One review per rider per ride. Also what makes a repeated submission
  -- (a retry, a double tap) harmless. Rows whose ride was deleted have a
  -- NULL ride_id and are simply not compared, which is fine: a deleted ride
  -- can't be reviewed again anyway.
  constraint driver_reviews_ride_rider_key
    unique (ride_id, rider_id)
);

-- For "this driver's reviews, newest first" and for the summary view.
create index if not exists driver_reviews_driver_created_idx
  on public.driver_reviews (driver_id, created_at desc);

comment on table public.driver_reviews is
  'Reviews riders left for drivers. Created only by submit_driver_review(); final once written. PROTOTYPE: the rider id is not authenticated.';
comment on column public.driver_reviews.ride_id is
  'The reviewed ride. NULL after that ride was deleted; the review is kept.';
comment on column public.driver_reviews.rating is
  'Stars, a whole number from 1 to 5.';
comment on column public.driver_reviews.comment is
  'Optional written feedback, max 300 characters, trimmed. Empty string = none.';
comment on column public.driver_reviews.ride_destination is
  'The ride''s destination text when the review was written.';
comment on column public.driver_reviews.ride_departure_at is
  'The ride''s scheduled departure when the review was written.';

-- ---------------------------------------------------------------------
-- 2. Access: read-only for the app
-- ---------------------------------------------------------------------
-- Two layers, either of which is enough on its own to stop a direct write:
--   * Table privileges: anon and authenticated may SELECT and nothing else.
--   * Row Level Security: on, with one policy, and that policy only covers
--     SELECT. There is no INSERT, UPDATE or DELETE policy for anyone.
-- Reviews are public by design: any app user can read every review,
-- including who wrote it.
--
-- This affects driver_reviews only. No policy or grant on any other table
-- is changed.

alter table public.driver_reviews enable row level security;

-- Supabase gives anon and authenticated full rights on new public tables by
-- default. Take them away, then hand back SELECT alone.
revoke all on table public.driver_reviews from public, anon, authenticated;
grant select on table public.driver_reviews to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'driver_reviews'
      and policyname = 'driver_reviews: anyone can read'
  ) then
    create policy "driver_reviews: anyone can read"
      on public.driver_reviews
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. driver_rating_summary: review count and average per driver
-- ---------------------------------------------------------------------
-- A driver with no reviews has no row here (the app shows "No ratings
-- yet"), so an average is never invented.
--
-- security_invoker: the view reads driver_reviews as whoever is asking, so
-- it can never show more than that table's own read policy allows.

create or replace view public.driver_rating_summary
with (security_invoker = true)
as
select
  driver_id,
  count(*)::integer as review_count,
  round(avg(rating), 2) as average_rating
from public.driver_reviews
group by driver_id;

comment on view public.driver_rating_summary is
  'Review count and average star rating (2 decimals) per reviewed driver. Drivers with no reviews have no row.';

revoke all on table public.driver_rating_summary from public, anon, authenticated;
grant select on table public.driver_rating_summary to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. submit_driver_review: the only way a review is created
-- ---------------------------------------------------------------------
-- "If this rider is eligible and hasn't reviewed this ride, save their
-- review. If they already have, never change it."
--
-- Returns the rider's driver_reviews row for this ride:
--   * no review yet, rider eligible   -> inserts it and returns it
--   * already reviewed, and this call
--     sends the SAME rating and
--     comment                         -> the existing review is returned
--                                        unchanged. This is the safe retry
--                                        (a double tap, or a resend after a
--                                        lost response): the caller gets the
--                                        same answer as the first time.
--   * already reviewed, and this call
--     sends a DIFFERENT rating or
--     comment                         -> refused: "You've already reviewed
--                                        this ride. Reviews are final and
--                                        can't be changed." Nothing is
--                                        written, and the call is never
--                                        reported as a success.
--   * anything else                   -> refused with a message for the user
-- "Same comment" means the same text after trimming, which is how the
-- comment is stored.
--
-- The only write this function can make is one INSERT into driver_reviews.
-- The rules it applies are listed under "THE ELIGIBILITY RULE" at the top
-- of this file, and "now" is always the database's clock, never the phone's.
--
-- How it behaves alongside the rest of the app:
--   * Cancelling a ride deletes the ride and, by cascade, its requests. The
--     ride lookup then finds nothing and the review is refused.
--   * Leaving a confirmed seat, withdrawing, and a driver's Deny all change
--     the request's status away from 'accepted'. Only 'accepted' passes, so
--     none of them can make a rider eligible, and leaving a seat removes
--     eligibility. A review written earlier is kept.
--
-- Locking and concurrency:
--   * The ride row is locked FOR SHARE while the checks run, so the ride
--     can't be deleted or have its departure time changed between the
--     checks and the insert.
--   * The rider's ride_requests row is then locked FOR SHARE as well, so a
--     Leave Seat, a Deny or any other status change can't land between
--     "is it accepted?" and the insert. Such a change waits until this call
--     has finished, and one that finished first is seen here, because a
--     locking read always returns the row as it is after the wait.
--   * FOR SHARE is the lightest lock that does this. It blocks changes to
--     those two rows only, never reads, and two riders reviewing the same
--     ride don't block each other.
--   * Locks are always taken in the same order, ride first and then the
--     request, which is also the order a ride deletion reaches them
--     (the ride, then its requests by cascade). If some other code path
--     ever takes them the other way round, PostgreSQL detects the deadlock
--     and cancels one of the two calls with an error; nothing is half
--     written, and sending the review again is safe.
--   * Two submissions for the same ride and rider at the same instant can't
--     both insert: the unique rule lets one through and the other then
--     finds that review and is treated like any later call (same content:
--     returned; different content: refused).
--   * The function relies on the default READ COMMITTED isolation level,
--     which is what the Supabase API uses.
--
-- Permissions, reviewed:
--   * It runs as its owner, the role that runs this migration (postgres in
--     the Supabase SQL editor), which also owns driver_reviews. That is why
--     its INSERT is allowed although the app's roles have no INSERT right
--     and there is no INSERT policy. Don't change the function's or the
--     table's owner, and don't FORCE row level security on driver_reviews,
--     without revisiting this.
--   * search_path is empty and every table is named with its schema, so a
--     caller can't make the function pick up a look-alike table or
--     function. The only unqualified names are PostgreSQL built-ins.
--   * Its checks read rides, ride_requests and profiles with the owner's
--     rights, whatever policies those tables have. Step 0 makes sure that
--     is really so: the migration stops if the role running it would be
--     limited by RLS on those tables. What a caller can learn
--     from the refusal messages is whether a ride exists, whether a profile
--     exists, and whether a rider has a confirmed seat, all of which the
--     app's role can already read from those tables today. If those tables
--     are ever locked down, revisit the messages.
--   * EXECUTE is taken from PUBLIC and given to anon and authenticated.
--     Supabase's own service_role keeps its default access.
--
-- Unauthenticated: p_rider_id is whatever the caller sends. See "PROTOTYPE
-- SECURITY LIMITATION" at the top of this file.
--
-- Refusals use RAISE EXCEPTION (error code P0001), whose message is written
-- for users; the app already shows P0001 messages as-is.

create or replace function public.submit_driver_review(
  p_ride_id uuid,
  p_rider_id uuid,
  p_rating integer,
  p_comment text default null
)
returns public.driver_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
  v_review public.driver_reviews%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_ride_gone constant text :=
    'This ride is no longer available, so it can''t be reviewed. It may have been cancelled.';
  v_already_reviewed constant text :=
    'You''ve already reviewed this ride. Reviews are final and can''t be changed.';
  v_account_gone constant text :=
    'Your account could not be found. Please sign in again.';
begin
  if p_ride_id is null or p_rider_id is null then
    raise exception 'A ride and a rider are required to leave a review.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a rating from 1 to 5 stars.';
  end if;
  if char_length(v_comment) > 300 then
    raise exception 'Your review can be at most 300 characters.';
  end if;

  -- The ride must still exist. Locking it keeps it from being deleted or
  -- rescheduled until this call finishes.
  select * into v_ride from public.rides where id = p_ride_id for share;
  if not found then
    raise exception '%', v_ride_gone;
  end if;

  -- Already reviewed. Reviews are final: the same review sent again is
  -- answered with the one on file, and anything different is refused.
  select * into v_review
  from public.driver_reviews
  where ride_id = p_ride_id and rider_id = p_rider_id;
  if found then
    if v_review.rating = p_rating and v_review.comment = v_comment then
      return v_review;
    end if;
    raise exception '%', v_already_reviewed;
  end if;

  if v_ride.driver_id = p_rider_id then
    raise exception 'You can''t review your own ride.';
  end if;
  if not exists (select 1 from public.profiles where id = p_rider_id) then
    raise exception '%', v_account_gone;
  end if;

  -- The rider needs a confirmed seat on this ride right now. Locking the
  -- request keeps its status from changing (Leave Seat, Deny) until this
  -- call finishes. If such a change is already under way, this waits for
  -- it and then reads the status it left behind.
  select * into v_request
  from public.ride_requests
  where ride_id = p_ride_id and rider_id = p_rider_id
  for share;
  if not found or v_request.status <> 'accepted' then
    raise exception 'Only riders with a confirmed seat on this ride can review it.';
  end if;
  -- ...requested before the ride was due to leave.
  if v_request.created_at > v_ride.departure_at then
    raise exception 'This seat was requested after the ride''s departure time, so the ride can''t be reviewed.';
  end if;

  -- Prototype rule: reviews open one hour after the scheduled departure.
  if now() < v_ride.departure_at + interval '1 hour' then
    raise exception 'You can review this ride one hour after its scheduled departure.';
  end if;

  -- The one write. ON CONFLICT DO NOTHING relies on the unique rule on
  -- (ride_id, rider_id): if another call inserted this pair a moment ago,
  -- this insert waits for it, then does nothing instead of failing.
  begin
    insert into public.driver_reviews
      (ride_id, driver_id, rider_id, rating, comment, ride_destination, ride_departure_at)
    values
      (v_ride.id, v_ride.driver_id, p_rider_id, p_rating, v_comment,
       v_ride.destination, v_ride.departure_at)
    on conflict (ride_id, rider_id) do nothing
    returning * into v_review;
  exception
    -- The ride is locked and can't have gone, so the row that vanished
    -- between the checks and the insert is a profile (only possible through
    -- manual clean-up). Say so plainly instead of leaking a constraint name.
    when foreign_key_violation then
      raise exception '%', v_account_gone;
  end;

  -- Nothing inserted: another call for this ride and rider created the
  -- review a moment ago. Treat it exactly like a review that was already
  -- there: the same content is returned, different content is refused.
  if v_review.id is null then
    select * into v_review
    from public.driver_reviews
    where ride_id = p_ride_id and rider_id = p_rider_id;
    if not found then
      raise exception '%', v_ride_gone;
    end if;
    if v_review.rating <> p_rating or v_review.comment <> v_comment then
      raise exception '%', v_already_reviewed;
    end if;
  end if;

  return v_review;
end;
$$;

comment on function public.submit_driver_review(uuid, uuid, integer, text) is
  'Creates a rider''s review of a ride''s driver if the rider is eligible and has not reviewed it, and returns the row. Sending the same review again returns the existing row; sending a different one is refused, because reviews are final. Insert-only. SECURITY DEFINER because the app cannot write driver_reviews directly. PROTOTYPE: p_rider_id is caller-supplied and not authenticated.';

-- PostgreSQL lets everyone execute a new function by default. Remove that,
-- then allow exactly the roles the app uses.
revoke all on function public.submit_driver_review(uuid, uuid, integer, text) from public;
grant execute on function public.submit_driver_review(uuid, uuid, integer, text) to anon, authenticated;

commit;

-- Ask the Supabase API (PostgREST) to pick up the new table, view and function.
notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICATION (read-only unless noted) — run separately AFTER the migration
-- =====================================================================
--
-- -- a) The table's columns:
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'driver_reviews'
-- order by ordinal_position;
--
-- -- b) Its constraints: primary key, three foreign keys (ride_id SET NULL,
-- --    the two profile ids CASCADE), three checks, one unique:
-- select conname, contype, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.driver_reviews'::regclass
-- order by contype, conname;
--
-- -- c) Row Level Security is on (expect true) and there is exactly one
-- --    policy, for SELECT:
-- select relrowsecurity from pg_class where oid = 'public.driver_reviews'::regclass;
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'driver_reviews';
--
-- -- d) The app's roles can only SELECT (expect one SELECT row per role per
-- --    object, and no INSERT / UPDATE / DELETE / TRUNCATE rows):
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('driver_reviews', 'driver_rating_summary')
--   and grantee in ('anon', 'authenticated', 'PUBLIC')
-- order by table_name, grantee, privilege_type;
--
-- -- e) The function: prosecdef = true (SECURITY DEFINER), proconfig shows
-- --    search_path="" , and only the expected roles may execute it
-- --    (expect anon = true, authenticated = true):
-- select p.proname, p.prosecdef, p.proconfig,
--        pg_get_userbyid(p.proowner) as owner,
--        has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_driver_review';
--
-- -- e2) The function's owner can read the tables it checks, whatever their
-- --     policies (expect can_skip_rls = true on all four rows):
-- select c.relname, pg_get_userbyid(c.relowner) as table_owner,
--        c.relrowsecurity, c.relforcerowsecurity,
--        pg_get_userbyid(p.proowner) as function_owner,
--        (not c.relrowsecurity or r.rolsuper or r.rolbypassrls
--         or (pg_has_role(r.oid, c.relowner, 'USAGE') and not c.relforcerowsecurity)) as can_skip_rls
-- from pg_class c
-- cross join pg_proc p
-- join pg_roles r on r.oid = p.proowner
-- where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_driver_review'
--   and c.oid in ('public.profiles'::regclass, 'public.rides'::regclass,
--                 'public.ride_requests'::regclass, 'public.driver_reviews'::regclass)
-- order by c.relname;
--
-- -- f) The summary view runs as the caller (expect security_invoker=true):
-- select relname, reloptions from pg_class where oid = 'public.driver_rating_summary'::regclass;
--
-- -- g) Existing data unchanged: same counts as before, and no reviews yet:
-- select (select count(*) from public.profiles) as profiles,
--        (select count(*) from public.rides) as rides,
--        (select count(*) from public.ride_requests) as requests,
--        (select count(*) from public.driver_reviews) as reviews;
--
-- -- h) A direct write as the app's role is refused. This one is NOT
-- --    read-only in intent, but it is wrapped in a transaction that is
-- --    rolled back, and the insert is expected to fail with
-- --    "permission denied for table driver_reviews":
-- begin;
-- set local role anon;
-- insert into public.driver_reviews
--   (driver_id, rider_id, rating, ride_destination, ride_departure_at)
-- select id, id, 5, 'test', now() from public.profiles limit 1;
-- rollback;
--
-- -- i) The function refuses bad input without writing anything (expect the
-- --    error "Please choose a rating from 1 to 5 stars."):
-- select public.submit_driver_review(gen_random_uuid(), gen_random_uuid(), 6, null);
--
-- -- After a first real review exists (submitted from the app), the "final"
-- -- rule can be checked by calling the function again by hand with that
-- -- review's ride_id and rider_id:
-- --   * the same rating and comment  -> returns the same row, same id and
-- --                                     created_at, and the review count
-- --                                     does not go up
-- --   * a different rating or comment -> error "You've already reviewed
-- --                                     this ride. Reviews are final and
-- --                                     can't be changed."
-- -- Neither call changes any data.
--
-- -- j) Rides a rider could review right now (handy for picking a test ride):
-- select r.id as ride_id, q.rider_id, r.destination, r.departure_at
-- from public.rides r
-- join public.ride_requests q on q.ride_id = r.id
-- where q.status = 'accepted'
--   and q.created_at <= r.departure_at
--   and now() >= r.departure_at + interval '1 hour'
--   and not exists (
--     select 1 from public.driver_reviews v
--     where v.ride_id = r.id and v.rider_id = q.rider_id
--   );


-- =====================================================================
-- ROLLBACK — only if you want to undo this migration. Not run by default.
-- =====================================================================
-- Dropping the table permanently deletes every review.
--
-- begin;
-- drop function if exists public.submit_driver_review(uuid, uuid, integer, text);
-- drop view if exists public.driver_rating_summary;
-- drop table if exists public.driver_reviews;
-- commit;
-- notify pgrst, 'reload schema';
