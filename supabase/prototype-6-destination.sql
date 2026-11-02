-- =====================================================================
-- CarpoolBoard Prototype 6 — Destination location: database migration
-- =====================================================================
--
-- Adds what the pickup-to-destination route view needs from the database:
--   1. rides.destination_lat / destination_lng / destination_label
--      (where a ride ends, so the Map tab can show a destination marker
--      and draw a route from the pickup spot)
--
-- Run this AFTER supabase/prototype-6.sql. It does not depend on the
-- pickup columns, but step 0 checks that the rides table looks the way
-- this file expects.
--
-- Safety:
--   * Additive only: no DROP, DELETE, TRUNCATE, or UPDATE of existing rows.
--   * New columns are nullable with no default, so every existing ride stays
--     valid and keeps its destination text exactly as it is. A ride with no
--     destination location simply has no route on the map.
--   * rides.destination (the free-text destination) is not touched: not its
--     type, not its NOT NULL rule, not its contents.
--   * The pickup columns and their checks are not touched.
--   * profiles and ride_requests are not touched. submit_ride_request,
--     accept_ride_request and the ride_requests_no_self_request trigger are
--     not touched.
--   * Step 0 checks the things this file assumes and stops with a clear
--     message if one is wrong. Nothing is ever "fixed" automatically.
--   * Idempotent: running the whole file again is a no-op.
--   * Wrapped in one transaction: if any step fails, nothing is applied.
--
-- NOT included on purpose:
--   * any change to RLS policies, grants, or Supabase Auth. The new columns
--     are read and written through the same table-level access the app
--     already has on rides.
--   * filling in coordinates for existing rides. Their destinations are
--     free text, and a location is never guessed from text. A driver adds
--     one by editing the ride and choosing a preset destination.
--   * the route itself. Routes are looked up by the app when a rider taps
--     View Route and are never stored.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only; stop early instead of guessing)
-- ---------------------------------------------------------------------

do $$
declare
  v_wrong_types text;
begin
  -- The table and its free-text destination column must already exist.
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      and column_name = 'destination'
  ) then
    raise exception
      'Destination migration stopped: public.rides.destination was not found. Nothing was changed.';
  end if;

  -- If a destination column already exists (from an earlier run or a manual
  -- edit), it must have the type this file would have created. "add column
  -- if not exists" would otherwise skip it silently and leave the wrong type.
  select string_agg(column_name || ' is ' || data_type, ', ')
    into v_wrong_types
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rides'
    and (
      (column_name in ('destination_lat', 'destination_lng') and data_type <> 'double precision')
      or (column_name = 'destination_label' and data_type <> 'text')
    );
  if v_wrong_types is not null then
    raise exception
      'Destination migration stopped: a destination column already exists with an unexpected type (%). Nothing was changed.',
      v_wrong_types;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. Destination location on rides (nullable; NULL means "not on the map")
-- ---------------------------------------------------------------------

-- Where the ride ends, as map coordinates (WGS 84, the same numbers a
-- phone map uses). Set when the driver chooses a preset destination in the
-- ride form.
alter table public.rides
  add column if not exists destination_lat double precision;
alter table public.rides
  add column if not exists destination_lng double precision;

-- The name of the mapped point, e.g. "Dallas Love Field". This is what the
-- destination marker shows. It is separate from rides.destination, which is
-- whatever the driver typed and may be worded differently.
alter table public.rides
  add column if not exists destination_label text;

do $$
begin
  -- Latitude and longitude are set together or not at all, and are real
  -- coordinates. A half-set destination could never be drawn on the map.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rides'::regclass
      and conname = 'rides_destination_coords_check'
  ) then
    alter table public.rides
      add constraint rides_destination_coords_check
      check (
        (destination_lat is null and destination_lng is null)
        or (
          destination_lat is not null and destination_lng is not null
          and destination_lat between -90 and 90
          and destination_lng between -180 and 180
        )
      );
  end if;

  -- Label: at most 80 characters, never blank, and present exactly when the
  -- coordinates are. This is stricter than the pickup label (which may be
  -- missing): a destination marker must always be able to say which place
  -- it marks, so a mapped destination without a name is not allowed.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rides'::regclass
      and conname = 'rides_destination_label_check'
  ) then
    alter table public.rides
      add constraint rides_destination_label_check
      check (
        (destination_label is null and destination_lat is null)
        or (
          destination_label is not null and destination_lat is not null
          and char_length(destination_label) <= 80
          and btrim(destination_label) <> ''
        )
      );
  end if;
end
$$;

comment on column public.rides.destination_lat is
  'Optional destination latitude (WGS 84). NULL = no mapped destination; the ride has no route on the map.';
comment on column public.rides.destination_lng is
  'Optional destination longitude (WGS 84). Set together with destination_lat.';
comment on column public.rides.destination_label is
  'Name of the mapped destination point, max 80 characters. Set exactly when the coordinates are. Separate from the free-text rides.destination.';

commit;

-- Ask the Supabase API (PostgREST) to pick up the new columns.
notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the migration above
-- =====================================================================
--
-- -- a) The three destination columns exist and are nullable:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'rides'
--   and column_name like 'destination%'
-- order by ordinal_position;
--
-- -- b) The two destination checks exist:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.rides'::regclass and conname like 'rides_destination%';
--
-- -- c) Existing data unchanged: same ride count as before, every ride
-- --    still has its destination text, and no ride has a mapped
-- --    destination yet:
-- select count(*) as rides,
--        count(destination) as rides_with_destination_text,
--        count(destination_lat) as rides_with_mapped_destination,
--        count(pickup_lat) as rides_with_pickup
-- from public.rides;


-- =====================================================================
-- ROLLBACK — only if you want to undo this migration. Not run by default.
-- =====================================================================
-- Dropping the columns deletes any destination locations saved since.
-- rides.destination (the free text) is not affected.
--
-- begin;
-- alter table public.rides
--   drop constraint if exists rides_destination_label_check,
--   drop constraint if exists rides_destination_coords_check,
--   drop column if exists destination_label,
--   drop column if exists destination_lng,
--   drop column if exists destination_lat;
-- commit;
-- notify pgrst, 'reload schema';
