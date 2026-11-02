-- =====================================================================
-- CarpoolBoard Prototype 8 — Feature 3, step 1: Supabase Auth accounts
-- =====================================================================
--
-- Adds what username/password sign-in needs from the database:
--   1. profiles.username      unique, lowercase login name
--   2. profiles.email         may now be NULL: new accounts keep their
--                             email ONLY in auth.users (private), never in
--                             the publicly readable profiles table
--   3. handle_new_auth_user   trigger: every new Supabase Auth user gets a
--                             profile whose id IS the auth user id
--   4. is_username_available  sign-up form's "is this name taken?" check
--   5. submit_my_ride_request,
--      submit_my_driver_review,
--      accept_my_ride_request  versions of the existing functions that take
--                             the caller from auth.uid() instead of
--                             trusting a rider id sent by the app
--   6. sign_in_attempts       failed-login log the username-sign-in Edge
--                             Function uses to slow down password guessing
--   7. rides_departure_in_future  server-side rule: a ride can't be posted
--                             or moved to a departure time that has passed
--                             (the new request/accept functions above also
--                             refuse departed rides)
--
-- Run AFTER: auth-0-inspect.sql has been reviewed.
-- Run BEFORE: auth-2-lockdown.sql (which switches access over to signed-in
-- users and makes the old app build stop working).
--
-- Safety:
--   * Additive only: no DROP, DELETE, TRUNCATE, or UPDATE of existing rows.
--     Existing profiles keep their ids, names, emails and roles; their new
--     username column is NULL.
--   * The current (old) app keeps working after this file: no policy,
--     grant or existing function is changed. The new functions are only
--     executable by signed-in users, and nobody is signed in yet. The one
--     new rule that also applies to the old app (step 7) only refuses a
--     past departure time, which the app already refuses itself.
--   * No passwords are stored anywhere in public. Supabase Auth keeps a
--     bcrypt hash in auth.users; this file never reads or writes it.
--   * Step 0 checks the things this file assumes and stops with a clear
--     message if one is wrong. Nothing is ever "fixed" automatically.
--   * Idempotent: running the whole file again is a no-op.
--   * Wrapped in one transaction: if any step fails, nothing is applied.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only)
-- ---------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  -- Columns this file and the new app rely on.
  select string_agg(c.col, ', ') into v_missing
  from (values ('id'), ('name'), ('email'), ('role'), ('bio'),
               ('vehicle_make_model'), ('avatar_path')) as c (col)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = c.col
  );
  if v_missing is not null then
    raise exception 'auth-1 stopped: profiles is missing column(s) %. Nothing was changed.', v_missing;
  end if;

  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'id') <> 'uuid' then
    raise exception 'auth-1 stopped: profiles.id is not uuid, so it can''t equal auth.users.id.';
  end if;

  -- A new auth user's profile reuses the auth user's id. A legacy profile
  -- (one with an email, which new profiles never have) sharing an id with
  -- an auth user would mean someone linked them by hand; stop and look.
  if exists (select 1 from public.profiles p join auth.users u on u.id = p.id
             where p.email is not null) then
    raise exception 'auth-1 stopped: a legacy profile already shares its id with an auth user. Review auth-0 query C2 first.';
  end if;

  -- New profiles have a NULL email. Allowed by the existing unique email
  -- rule only if it treats NULLs as distinct (the Postgres default). A
  -- NULLS NOT DISTINCT rule would let just one profile have no email.
  if exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.profiles'::regclass
      and i.indisunique
      and i.indnullsnotdistinct
      and a.attname = 'email'
  ) then
    raise exception 'auth-1 stopped: the unique rule on profiles.email is NULLS NOT DISTINCT, so new accounts (no email in profiles) would collide.';
  end if;

  -- submit_my_ride_request and submit_my_driver_review both use
  -- ON CONFLICT (ride_id, rider_id), which needs a plain, non-partial unique
  -- index on exactly those two columns. prototype-6.sql created
  -- ride_requests_ride_rider_key as an INDEX (so it doesn't appear in
  -- pg_constraint / auth-0 A2); prototype-6-reviews.sql created
  -- driver_reviews_ride_rider_key as a constraint. If either is missing or
  -- not exactly equivalent, stop: auth-0 queries A6/A7 show the details and
  -- whether duplicates exist. Nothing is created or deduplicated here.
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.ride_requests'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indimmediate and i.indpred is null and i.indexprs is null
      and i.indnkeyatts = 2
      and (select array_agg(a.attname::text order by a.attname::text)
           from unnest(i.indkey::int2[]) with ordinality as k (attnum, position)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
           where k.position <= i.indnkeyatts) = array['ride_id', 'rider_id']::text[]
  ) then
    raise exception 'auth-1 stopped: ride_requests has no unique index on exactly (ride_id, rider_id). Run auth-0 queries A6 and A7 and send the results. Nothing was changed.';
  end if;
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.driver_reviews'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indimmediate and i.indpred is null and i.indexprs is null
      and i.indnkeyatts = 2
      and (select array_agg(a.attname::text order by a.attname::text)
           from unnest(i.indkey::int2[]) with ordinality as k (attnum, position)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
           where k.position <= i.indnkeyatts) = array['ride_id', 'rider_id']::text[]
  ) then
    raise exception 'auth-1 stopped: driver_reviews has no unique rule on exactly (ride_id, rider_id). Run auth-0 query A6 and send the result. Nothing was changed.';
  end if;

  -- accept_my_ride_request wraps the existing function.
  if to_regprocedure('public.accept_ride_request(uuid)') is null then
    raise exception 'auth-1 stopped: public.accept_ride_request(uuid) was not found. Send its definition (auth-0 query B5) before continuing.';
  end if;

  -- Another trigger that creates profiles for new auth users would clash
  -- with the one below (two inserts for one user).
  if exists (
    select 1 from information_schema.triggers
    where event_object_schema = 'auth' and event_object_table = 'users'
      and trigger_name <> 'on_auth_user_created_profile'
  ) then
    raise exception 'auth-1 stopped: auth.users already has a trigger (see auth-0 query B7). Review it before adding another.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. profiles.username
-- ---------------------------------------------------------------------
-- 3–20 characters: lowercase letters, digits, underscore. Stored lowercase
-- so "Jordan_S" and "jordan_s" are the same username; the app lowercases
-- what people type. NULL only on legacy profiles from the old login, which
-- can no longer be signed into.

alter table public.profiles
  add column if not exists username text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-z0-9_]{3,20}$');
  end if;
end
$$;

-- Unique. NULLs don't collide, so every legacy profile can stay NULL.
create unique index if not exists profiles_username_key
  on public.profiles (username);

comment on column public.profiles.username is
  'Login name: unique, 3-20 of a-z 0-9 _, stored lowercase. NULL = legacy profile from the old email+name login (cannot sign in).';

-- ---------------------------------------------------------------------
-- 2. profiles.email becomes optional
-- ---------------------------------------------------------------------
-- New accounts' emails live only in auth.users, which the app can't query.
-- Existing rows and their unique / lowercase / format checks are kept as
-- they are (a CHECK passes for NULL; a UNIQUE index allows many NULLs).

alter table public.profiles
  alter column email drop not null;

comment on column public.profiles.email is
  'LEGACY ONLY: email typed into the old email+name login. NULL for Supabase Auth accounts, whose email is private in auth.users.';

-- ---------------------------------------------------------------------
-- 3. A profile for every new Supabase Auth user
-- ---------------------------------------------------------------------
-- The app signs up with supabase.auth.signUp(email, password, data:
-- { username, role }). This trigger runs inside the same transaction as
-- the auth user insert, so if the username is invalid or already taken the
-- whole sign-up is rolled back: there is never an auth user without a
-- profile, or a profile without an auth user.
--
-- The profile id is the auth user id, so RLS can compare rows with
-- auth.uid() directly. The display name starts as the username; the
-- person can change it during onboarding or in Edit Profile.
--
-- NOTE: users created by hand in the dashboard must also be given
-- "username" metadata, or this trigger refuses them. Create accounts
-- through the app.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'rider');
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Usernames must be 3 to 20 characters: letters, numbers, or underscores.';
  end if;
  if v_role not in ('driver', 'rider') then
    v_role := 'rider';
  end if;

  -- A taken username fails here on profiles_username_key, which rolls
  -- back the auth user too.
  insert into public.profiles (id, username, name, role)
  values (new.id, v_username, v_username, v_role);
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Trigger on auth.users: creates the matching profile (same id) from the sign-up metadata. Refuses invalid or taken usernames, which cancels the sign-up.';

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- 4. is_username_available
-- ---------------------------------------------------------------------
-- Lets the sign-up form say "that username is taken" before submitting.
-- Reveals only whether a username exists, never whose it is or any email.
-- The trigger above is still the real guard (two people could check the
-- same free name at once).

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9_]{3,20}$'
     and not exists (
       select 1 from public.profiles
       where username = lower(btrim(p_username))
     );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Functions that use the signed-in identity
-- ---------------------------------------------------------------------
-- Same rules and messages as the existing versions, but the rider/driver
-- is auth.uid() — the verified user behind the session's JWT — never a
-- parameter. Only signed-in users may run them. The old versions are left
-- in place (for rollback) and are locked away in auth-2.

-- 5a. Send a ride request (replaces submit_ride_request(uuid, uuid, text)).
-- SECURITY DEFINER: after auth-2 the app has NO direct INSERT on
-- ride_requests, so this function is the only way a request is created and
-- its checks (departed, full, message length, own ride) can't be skipped.
-- The rider is always auth.uid(). The ride_requests_no_self_request
-- trigger still runs on its insert.
--
-- Simultaneous calls: the existence check and the insert aren't atomic on
-- their own, but ON CONFLICT DO NOTHING on the unique (ride_id, rider_id)
-- index makes a second concurrent insert wait for the first and then do
-- nothing, and the function then returns the first call's row. So a
-- double tap or two phones can never create two rows or an error. The
-- "full" check is a courtesy, not a lock: seats are only taken in
-- accept_ride_request, which locks the ride FOR UPDATE.
create or replace function public.submit_my_ride_request(
  p_ride_id uuid,
  p_reason text default null
)
returns public.ride_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rider_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
  v_accepted integer;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ride_gone constant text :=
    'This ride is no longer available. It may have been cancelled.';
begin
  if v_rider_id is null then
    raise exception 'Please sign in again to send a request.';
  end if;
  if p_ride_id is null then
    raise exception 'A ride is required to send a request.';
  end if;
  if char_length(v_reason) > 140 then
    raise exception 'Your message to the driver can be at most 140 characters.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if not found then
    raise exception '%', v_ride_gone;
  end if;
  if v_ride.driver_id = v_rider_id then
    raise exception 'You can''t request a seat on your own ride.';
  end if;
  if not exists (select 1 from public.profiles where id = v_rider_id) then
    raise exception 'Your account could not be found. Please sign in again.';
  end if;

  select * into v_request
  from public.ride_requests
  where ride_id = p_ride_id and rider_id = v_rider_id;
  if found then
    return v_request;
  end if;

  -- Checked after the existing-row lookup on purpose: a retry of a request
  -- that was saved before departure still gets its row back.
  if v_ride.departure_at <= now() then
    raise exception 'This ride has already departed, so it is no longer accepting requests.';
  end if;

  select count(*) into v_accepted
  from public.ride_requests
  where ride_id = p_ride_id and status = 'accepted';
  if v_accepted >= v_ride.seat_count then
    raise exception 'This ride is full, so it is not accepting requests.';
  end if;

  begin
    insert into public.ride_requests (ride_id, rider_id, reason, status)
    values (p_ride_id, v_rider_id, v_reason, 'pending')
    on conflict (ride_id, rider_id) do nothing
    returning * into v_request;
  exception
    when foreign_key_violation then
      raise exception '%', v_ride_gone;
  end;

  if v_request.id is null then
    select * into v_request
    from public.ride_requests
    where ride_id = p_ride_id and rider_id = v_rider_id;
    if not found then
      raise exception '%', v_ride_gone;
    end if;
  end if;

  return v_request;
end;
$$;

comment on function public.submit_my_ride_request(uuid, text) is
  'Creates the signed-in rider''s pending request for a ride if none exists, and returns the row (an existing row in any status is returned unchanged). Refuses rides that have departed. Rider = auth.uid(). Insert-only, safe to repeat.';

revoke all on function public.submit_my_ride_request(uuid, text) from public, anon;
grant execute on function public.submit_my_ride_request(uuid, text) to authenticated;

-- 5b. Review a driver (replaces submit_driver_review(uuid, uuid, int, text)).
-- Identical rules to supabase/prototype-6-reviews-open-at-departure.sql.
-- SECURITY DEFINER because nobody may write driver_reviews directly.
create or replace function public.submit_my_driver_review(
  p_ride_id uuid,
  p_rating integer,
  p_comment text default null
)
returns public.driver_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rider_id uuid := auth.uid();
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
  if v_rider_id is null then
    raise exception 'Please sign in again to leave a review.';
  end if;
  if p_ride_id is null then
    raise exception 'A ride is required to leave a review.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a rating from 1 to 5 stars.';
  end if;
  if char_length(v_comment) > 300 then
    raise exception 'Your review can be at most 300 characters.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for share;
  if not found then
    raise exception '%', v_ride_gone;
  end if;

  select * into v_review
  from public.driver_reviews
  where ride_id = p_ride_id and rider_id = v_rider_id;
  if found then
    if v_review.rating = p_rating and v_review.comment = v_comment then
      return v_review;
    end if;
    raise exception '%', v_already_reviewed;
  end if;

  if v_ride.driver_id = v_rider_id then
    raise exception 'You can''t review your own ride.';
  end if;
  if not exists (select 1 from public.profiles where id = v_rider_id) then
    raise exception '%', v_account_gone;
  end if;

  select * into v_request
  from public.ride_requests
  where ride_id = p_ride_id and rider_id = v_rider_id
  for share;
  if not found or v_request.status <> 'accepted' then
    raise exception 'Only riders with a confirmed seat on this ride can review it.';
  end if;
  if v_request.created_at > v_ride.departure_at then
    raise exception 'This seat was requested after the ride''s departure time, so the ride can''t be reviewed.';
  end if;
  if now() < v_ride.departure_at then
    raise exception 'You can review this ride once its scheduled departure time arrives.';
  end if;

  begin
    insert into public.driver_reviews
      (ride_id, driver_id, rider_id, rating, comment, ride_destination, ride_departure_at)
    values
      (v_ride.id, v_ride.driver_id, v_rider_id, p_rating, v_comment,
       v_ride.destination, v_ride.departure_at)
    on conflict (ride_id, rider_id) do nothing
    returning * into v_review;
  exception
    when foreign_key_violation then
      raise exception '%', v_account_gone;
  end;

  if v_review.id is null then
    select * into v_review
    from public.driver_reviews
    where ride_id = p_ride_id and rider_id = v_rider_id;
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

comment on function public.submit_my_driver_review(uuid, integer, text) is
  'Creates the signed-in rider''s review of a ride''s driver if eligible (confirmed seat, requested before departure, departure time reached, not their own ride). Rider = auth.uid(). Reviews are final; the same review sent again returns the existing row.';

revoke all on function public.submit_my_driver_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_my_driver_review(uuid, integer, text) to authenticated;

-- 5c. Accept a request (wraps accept_ride_request(uuid)).
-- The existing accept_ride_request keeps doing the seat/status work; this
-- wrapper first checks that the caller is the ride's driver. It also
-- withdraws the rider's other pending requests, which the app used to do
-- with a direct update — under auth-2's RLS a driver can no longer update
-- requests on other drivers' rides, so that step moves here.
create or replace function public.accept_my_ride_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.ride_requests%rowtype;
  v_driver_id uuid;
  v_departure_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again to answer requests.';
  end if;

  select * into v_request from public.ride_requests where id = p_request_id;
  if not found then
    raise exception 'This request no longer exists. Pull down to refresh.';
  end if;
  select driver_id, departure_at into v_driver_id, v_departure_at
  from public.rides where id = v_request.ride_id;
  if v_driver_id is distinct from auth.uid() then
    raise exception 'Only this ride''s driver can accept its requests.';
  end if;
  -- accept_ride_request doesn't look at the time (auth-0 B5).
  if v_departure_at <= now() then
    raise exception 'This ride has already departed, so its requests can no longer be accepted.';
  end if;

  -- Its own errors (ride full, no longer pending…) pass straight through.
  perform public.accept_ride_request(p_request_id);

  update public.ride_requests
     set status = 'cancelled'
   where rider_id = v_request.rider_id
     and status = 'pending'
     and id <> p_request_id;
end;
$$;

comment on function public.accept_my_ride_request(uuid) is
  'Accepts a pending request on one of the signed-in driver''s upcoming rides (via accept_ride_request), then withdraws that rider''s other pending requests.';

revoke all on function public.accept_my_ride_request(uuid) from public, anon;
grant execute on function public.accept_my_ride_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. sign_in_attempts (used only by the username-sign-in Edge Function)
-- ---------------------------------------------------------------------
-- One row per username sign-in attempt. The Edge Function refuses a
-- username for 15 minutes after 5 failures. Holds no passwords and no
-- emails. Only the service role (inside the Edge Function) can touch it:
-- RLS is on with no policies, and the app roles have no privileges.

create table if not exists public.sign_in_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists sign_in_attempts_username_created_idx
  on public.sign_in_attempts (username, created_at desc);

alter table public.sign_in_attempts enable row level security;
revoke all on table public.sign_in_attempts from public, anon, authenticated;
-- Explicit, rather than relying on the project's default privileges: the
-- Edge Function's service role needs exactly these. (service_role bypasses
-- RLS but still needs table privileges. An identity column's sequence is
-- normally used without a permission check; USAGE is granted anyway so the
-- insert can't fail on a project with unusual defaults.)
grant select, insert on table public.sign_in_attempts to service_role;
do $$
begin
  execute format('grant usage on sequence %s to service_role',
                 pg_get_serial_sequence('public.sign_in_attempts', 'id'));
end
$$;

-- The Edge Function also looks up profiles.id by username. auth-2 revokes
-- the app roles' privileges on profiles but never touches service_role;
-- this makes the lookup independent of the project's defaults.
grant select (id, username) on public.profiles to service_role;

comment on table public.sign_in_attempts is
  'Username sign-in attempts, written by the username-sign-in Edge Function (service role) to throttle password guessing. No passwords or emails.';

-- ---------------------------------------------------------------------
-- 7. No posting or rescheduling into the past
-- ---------------------------------------------------------------------
-- The app already refuses a past departure; this makes the server refuse
-- it too. Only a NEW departure time is checked: saving other changes to a
-- ride whose (unchanged) departure has passed still works, as the app
-- expects, and existing rides are never re-checked.

create or replace function public.prevent_past_departure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.departure_at is not distinct from old.departure_at then
    return new;
  end if;
  if new.departure_at <= now() then
    raise exception 'That departure time has already passed. Please pick a time in the future.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_past_departure() from public, anon, authenticated;

drop trigger if exists rides_departure_in_future on public.rides;
create trigger rides_departure_in_future
  before insert or update of departure_at on public.rides
  for each row execute function public.prevent_past_departure();

commit;

notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the migration above
-- =====================================================================
--
-- -- a) username column, unique index and check:
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'profiles' and indexname = 'profiles_username_key';
--
-- -- b) Existing profiles unchanged (same count; all usernames still NULL):
-- select count(*) as profiles, count(username) as with_username, count(email) as with_email
-- from public.profiles;
--
-- -- c) Trigger present:
-- select trigger_name from information_schema.triggers
-- where event_object_schema = 'auth' and event_object_table = 'users';
--
-- -- d) New functions and who can run them:
-- select proname, pg_get_function_identity_arguments(oid), prosecdef, proacl
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in ('handle_new_auth_user', 'is_username_available',
--                   'submit_my_ride_request', 'submit_my_driver_review',
--                   'accept_my_ride_request');
--
-- -- d2) Execute rights on the new functions (expect: anon false for all
-- --     three, authenticated true for all three):
-- select f, has_function_privilege('anon', f, 'execute') as anon,
--           has_function_privilege('authenticated', f, 'execute') as authenticated
-- from unnest(array['public.submit_my_ride_request(uuid, text)',
--                   'public.submit_my_driver_review(uuid, integer, text)',
--                   'public.accept_my_ride_request(uuid)']) as f;
--
-- -- d3) Edge Function privileges (expect true x4):
-- select has_table_privilege('service_role', 'public.sign_in_attempts', 'insert'),
--        has_table_privilege('service_role', 'public.sign_in_attempts', 'select'),
--        has_sequence_privilege('service_role', pg_get_serial_sequence('public.sign_in_attempts', 'id'), 'usage'),
--        has_column_privilege('service_role', 'public.profiles', 'username', 'select');
--
-- -- e2) Departure trigger present:
-- select tgname from pg_trigger
-- where tgrelid = 'public.rides'::regclass and tgname = 'rides_departure_in_future';
--
-- -- e) Username check works:
-- select public.is_username_available('jordan_s') as free,
--        public.is_username_available('no') as too_short;


-- =====================================================================
-- ROLLBACK — only to undo this file. Not run by default.
-- =====================================================================
-- Auth accounts created after this file ran keep their auth.users rows;
-- delete those first (Authentication → Users) if you roll back.
--
-- begin;
-- drop trigger if exists on_auth_user_created_profile on auth.users;
-- drop function if exists public.handle_new_auth_user();
-- drop function if exists public.is_username_available(text);
-- drop function if exists public.submit_my_ride_request(uuid, text);
-- drop function if exists public.submit_my_driver_review(uuid, integer, text);
-- drop function if exists public.accept_my_ride_request(uuid);
-- drop table if exists public.sign_in_attempts;
-- drop trigger if exists rides_departure_in_future on public.rides;
-- drop function if exists public.prevent_past_departure();
-- drop index if exists public.profiles_username_key;
-- alter table public.profiles drop constraint if exists profiles_username_format_check;
-- alter table public.profiles drop column if exists username;
-- -- Only if every profile still has an email:
-- -- alter table public.profiles alter column email set not null;
-- commit;
-- notify pgrst, 'reload schema';
