-- =====================================================================
-- CarpoolBoard Prototype 6 — Map + safe ride requests: database migration
-- =====================================================================
--
-- Adds what Prototype 6 needs from the database:
--   1. rides.pickup_lat / pickup_lng / pickup_label  (where a ride leaves
--      from, so it can be shown as a marker on the Map tab)
--   2. a unique rule: one ride_requests row per (ride, rider)
--   3. submit_ride_request(): sends a ride request in one atomic step that
--      is safe to call again (retry): it never creates a duplicate row and
--      never changes the status of a request that already exists
--
-- Safety:
--   * Additive only: no DROP, DELETE, TRUNCATE, or UPDATE of existing rows.
--   * New columns are nullable with no default, so every existing ride stays
--     valid. A ride with no pickup simply isn't shown on the map.
--   * profiles is not touched. accept_ride_request and the
--     ride_requests_no_self_request trigger are not touched.
--   * submit_ride_request only ever INSERTs a new 'pending' row. It never
--     updates or deletes a request, so it can't undo a driver's Accept or
--     Deny, or a cancellation.
--   * Step 0 checks the things this file assumes and stops with a clear
--     message if one is wrong. Nothing is ever "fixed" automatically.
--   * Idempotent: running the whole file again is a no-op.
--   * Wrapped in one transaction: if any step fails, nothing is applied.
--
-- NOT included on purpose:
--   * destination coordinates / routes (later phase)
--   * any change to RLS policies or Supabase Auth
--   * re-sending a request that was denied or cancelled (see "Future:
--     explicit resubmission" in step 3)
--
-- PROTOTYPE SECURITY LIMITATION — rider ids are NOT authenticated.
-- CarpoolBoard does not use Supabase Auth, so the database has no way to
-- know who is calling. submit_ride_request takes the rider id as a plain
-- parameter (p_rider_id) and believes it. Anyone holding the app's
-- publishable key could call it with someone else's profile id and send a
-- request in that person's name. This is the same trust the app's current
-- direct insert into ride_requests already has, not a new hole: the
-- function runs with the caller's own permissions (SECURITY INVOKER) and
-- can do nothing the publishable key can't already do. It is acceptable
-- for a class prototype and NOT for real users. The real fix is Supabase
-- Auth, with the function reading the rider from auth.uid() instead of a
-- parameter and RLS limiting each person to their own rows.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only; stop early instead of guessing)
-- ---------------------------------------------------------------------

do $$
declare
  v_wrong_types text;
  v_duplicates integer;
begin
  -- submit_ride_request below declares its id parameters as uuid.
  select string_agg(table_name || '.' || column_name || ' is ' || data_type, ', ')
    into v_wrong_types
  from information_schema.columns
  where table_schema = 'public'
    and (table_name, column_name) in (
      ('rides', 'id'),
      ('profiles', 'id'),
      ('ride_requests', 'ride_id'),
      ('ride_requests', 'rider_id')
    )
    and data_type <> 'uuid';
  if v_wrong_types is not null then
    raise exception 'Prototype 6 migration stopped: expected uuid ids, but %.', v_wrong_types;
  end if;

  -- The unique rule in step 2 can't be added while a rider has two rows
  -- for the same ride. Those rows are NOT deleted here: look at them and
  -- decide which to keep (see verification query (d) at the bottom).
  select count(*) into v_duplicates
  from (
    select 1
    from public.ride_requests
    group by ride_id, rider_id
    having count(*) > 1
  ) as dup;
  if v_duplicates > 0 then
    raise exception
      'Prototype 6 migration stopped: % (ride, rider) pair(s) have more than one ride_requests row. Nothing was changed.',
      v_duplicates;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. Pickup location on rides (nullable; NULL means "no pickup set")
-- ---------------------------------------------------------------------

-- Where the ride leaves from, as map coordinates (WGS 84, the same numbers
-- a phone map uses). Set when the driver drops a pin in the ride form.
alter table public.rides
  add column if not exists pickup_lat double precision;
alter table public.rides
  add column if not exists pickup_lng double precision;

-- A short name for the pickup spot, e.g. "Hughes-Trigg Student Center".
alter table public.rides
  add column if not exists pickup_label text;

do $$
begin
  -- Latitude and longitude are set together or not at all, and are real
  -- coordinates. A half-set pickup could never be drawn on the map.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rides'::regclass
      and conname = 'rides_pickup_coords_check'
  ) then
    alter table public.rides
      add constraint rides_pickup_coords_check
      check (
        (pickup_lat is null and pickup_lng is null)
        or (
          pickup_lat is not null and pickup_lng is not null
          and pickup_lat between -90 and 90
          and pickup_lng between -180 and 180
        )
      );
  end if;

  -- Label: at most 80 characters, never blank (the app saves an empty
  -- label as NULL), and only alongside coordinates.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rides'::regclass
      and conname = 'rides_pickup_label_check'
  ) then
    alter table public.rides
      add constraint rides_pickup_label_check
      check (
        pickup_label is null
        or (
          char_length(pickup_label) <= 80
          and btrim(pickup_label) <> ''
          and pickup_lat is not null
        )
      );
  end if;
end
$$;

comment on column public.rides.pickup_lat is
  'Optional pickup latitude (WGS 84). NULL = no pickup set; the ride is not shown on the map.';
comment on column public.rides.pickup_lng is
  'Optional pickup longitude (WGS 84). Set together with pickup_lat.';
comment on column public.rides.pickup_label is
  'Optional short name of the pickup spot, max 80 characters. Only set when coordinates are.';

-- ---------------------------------------------------------------------
-- 2. One request row per (ride, rider)
-- ---------------------------------------------------------------------
-- The database now enforces that a rider has at most one request row per
-- ride, so two submissions that race (a double tap, or a retry after a
-- lost response) can never both insert.
--
-- Skipped only if an EXACTLY equivalent unique rule already exists under
-- another name. "Exactly equivalent" means all of:
--   * unique, valid, ready and live (not a half-built or failed index)
--   * immediate, not deferrable (ON CONFLICT can't use a deferrable rule)
--   * no WHERE clause (a partial index only covers some rows)
--   * no expression columns such as lower(...)
--   * exactly two KEY columns, and they are ride_id and rider_id
-- A unique index on (ride_id, rider_id, status) therefore does NOT count:
-- it has three key columns and would still allow two rows per pair.
-- Extra INCLUDE columns are fine: they're stored in the index but aren't
-- part of what must be unique, and aren't counted as key columns.

do $$
begin
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.ride_requests'::regclass
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indislive
      and i.indimmediate
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts = 2
      and (
        -- indkey lists key columns first, then INCLUDE columns, so only
        -- the first indnkeyatts entries are compared.
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(i.indkey::int2[]) with ordinality as k (attnum, position)
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = k.attnum
        where k.position <= i.indnkeyatts
      ) = array['ride_id', 'rider_id']::text[]
  ) then
    create unique index ride_requests_ride_rider_key
      on public.ride_requests (ride_id, rider_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. submit_ride_request: send a request, safely repeatable
-- ---------------------------------------------------------------------
-- "If this rider has no request on this ride yet, create one as Pending.
-- Otherwise change nothing and report what's already there."
--
-- Returns the rider's ride_requests row for this ride. The caller reads
-- the row's status to know what happened:
--   * no row yet           -> inserts one as 'pending' and returns it
--   * already 'pending'    -> returned unchanged (this is the safe retry)
--   * already 'accepted'   -> returned unchanged (app: "already confirmed")
--   * already 'denied'     -> returned unchanged (app: "request was denied")
--   * already 'cancelled'  -> returned unchanged (app: "request was
--                             cancelled")
--
-- The only write this function can make is one INSERT. It never UPDATEs,
-- so calling it any number of times can never flip a denied, cancelled
-- or accepted request back to pending.
--
-- Unauthenticated: p_rider_id is whatever the caller sends. See
-- "PROTOTYPE SECURITY LIMITATION" at the top of this file.
--
-- Why abandonment can be reported honestly: the whole call is a single
-- transaction, so it takes effect completely or not at all. After a
-- rider abandons a submission, the app can look the row up: either it is
-- there or it isn't. Abandoning on the phone does not cancel the call on
-- the server.
--
-- Refusals use RAISE EXCEPTION (error code P0001), whose message is
-- written for users; the app already shows P0001 messages as-is.
--
-- Works alongside the existing database logic:
--   * accept_ride_request only changes the status of existing rows; it
--     never inserts. This function only inserts; it never changes a
--     status. So neither can undo the other's work, and the unique rule
--     in step 2 is never at risk from an Accept.
--   * When accept_ride_request cancels a rider's other pending requests,
--     those rows stay 'cancelled'. This function will not reopen them.
--   * ride_requests_no_self_request still guards every insert. The
--     own-ride check below runs first only to give a friendlier message;
--     if the trigger ever fires instead, its error is passed through
--     untouched.
--   * The "ride is full" check is a courtesy so riders get a clear
--     answer. It is not a lock: overbooking is still prevented by
--     accept_ride_request, which is the only place a seat is taken.
--
-- Future: explicit resubmission (NOT implemented here)
--   Re-sending after a denial or cancellation should be something the
--   rider clearly asks for (a "Request again" button), never a side
--   effect of a retry. It would be its own function, for example
--   resubmit_ride_request(p_request_id, p_rider_id, p_reason), doing one
--   guarded update:
--       update public.ride_requests
--          set status = 'pending', reason = ..., updated_at = now()
--        where id = p_request_id
--          and rider_id = p_rider_id
--          and status = 'cancelled'      -- the status the rider saw
--   Because the update only matches the old status, a repeat of the same
--   call finds nothing to change and just returns the row, so it is
--   retry-safe too. Decisions to make then: whether a 'denied' request
--   may be re-sent at all (the driver already said no) or only a
--   'cancelled' one, whether to limit how many times, and re-running the
--   full-ride check.

create or replace function public.submit_ride_request(
  p_ride_id uuid,
  p_rider_id uuid,
  p_reason text default null
)
returns public.ride_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
  v_accepted integer;
  -- The message is optional. ride_requests.reason is NOT NULL with a
  -- default of '', so "no message" (NULL, blank, or only spaces) is saved
  -- as an empty string, never as NULL.
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ride_gone constant text :=
    'This ride is no longer available. It may have been cancelled.';
begin
  if p_ride_id is null or p_rider_id is null then
    raise exception 'A ride and a rider are required to send a request.';
  end if;
  if char_length(v_reason) > 140 then
    raise exception 'Your message to the driver can be at most 140 characters.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if not found then
    raise exception '%', v_ride_gone;
  end if;
  if v_ride.driver_id = p_rider_id then
    raise exception 'You can''t request a seat on your own ride.';
  end if;
  if not exists (select 1 from public.profiles where id = p_rider_id) then
    raise exception 'Your account could not be found. Please sign in again.';
  end if;

  -- A request already exists, in any status: return it exactly as it is.
  -- This covers a retry, a double tap, a second phone, and a request the
  -- driver has since answered.
  select * into v_request
  from public.ride_requests
  where ride_id = p_ride_id and rider_id = p_rider_id;
  if found then
    return v_request;
  end if;

  select count(*) into v_accepted
  from public.ride_requests
  where ride_id = p_ride_id and status = 'accepted';
  if v_accepted >= v_ride.seat_count then
    raise exception 'This ride is full, so it is not accepting requests.';
  end if;

  -- The one write. ON CONFLICT DO NOTHING relies on the unique rule from
  -- step 2: if another call inserted this pair a moment ago, this insert
  -- waits for it, then does nothing instead of failing or duplicating.
  begin
    insert into public.ride_requests (ride_id, rider_id, reason, status)
    values (p_ride_id, p_rider_id, v_reason, 'pending')
    on conflict (ride_id, rider_id) do nothing
    returning * into v_request;
  exception
    -- The ride (or the profile) was deleted between the checks above and
    -- the insert. Say so plainly instead of leaking a constraint name.
    when foreign_key_violation then
      raise exception '%', v_ride_gone;
  end;

  -- Nothing inserted: another call created the row first. Return theirs.
  if v_request.id is null then
    select * into v_request
    from public.ride_requests
    where ride_id = p_ride_id and rider_id = p_rider_id;
    -- ...unless it's already gone again (the ride was cancelled, which
    -- deletes its requests). Never return an empty row as if it worked.
    if not found then
      raise exception '%', v_ride_gone;
    end if;
  end if;

  return v_request;
end;
$$;

comment on function public.submit_ride_request(uuid, uuid, text) is
  'Creates a rider''s pending request for a ride if none exists, and returns the row. If a row already exists in any status it is returned unchanged. Insert-only and safe to call repeatedly. PROTOTYPE: p_rider_id is caller-supplied and not authenticated.';

-- The app calls this with the publishable (anon) key, like accept_ride_request.
grant execute on function public.submit_ride_request(uuid, uuid, text) to anon, authenticated;

commit;

-- Ask the Supabase API (PostgREST) to pick up the new columns and function.
notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the migration above
-- =====================================================================
--
-- -- a) The three pickup columns exist and are nullable:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'rides'
-- order by ordinal_position;
--
-- -- b) The two pickup checks exist:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.rides'::regclass and conname like 'rides_pickup%';
--
-- -- c) A unique rule covers (ride_id, rider_id):
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public' and tablename = 'ride_requests';
--
-- -- d) No rider has two rows for one ride (expect 0 rows). If the
-- --    migration stopped in step 0, this is the query that shows why:
-- select ride_id, rider_id, count(*), array_agg(status order by created_at)
-- from public.ride_requests
-- group by ride_id, rider_id
-- having count(*) > 1;
--
-- -- e) Existing data unchanged: same ride and request counts as before,
-- --    and no ride has a pickup yet:
-- select (select count(*) from public.rides) as rides,
--        (select count(pickup_lat) from public.rides) as rides_with_pickup,
--        (select count(*) from public.ride_requests) as requests;
--
-- -- f) The function exists:
-- select proname, pg_get_function_identity_arguments(oid)
-- from pg_proc
-- where pronamespace = 'public'::regnamespace and proname = 'submit_ride_request';


-- =====================================================================
-- ROLLBACK — only if you want to undo this migration. Not run by default.
-- =====================================================================
-- Dropping the pickup columns deletes any pickup locations saved since.
--
-- begin;
-- drop function if exists public.submit_ride_request(uuid, uuid, text);
-- drop index if exists public.ride_requests_ride_rider_key;
-- alter table public.rides
--   drop constraint if exists rides_pickup_label_check,
--   drop constraint if exists rides_pickup_coords_check,
--   drop column if exists pickup_label,
--   drop column if exists pickup_lng,
--   drop column if exists pickup_lat;
-- commit;
-- notify pgrst, 'reload schema';
