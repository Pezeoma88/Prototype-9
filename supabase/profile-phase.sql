-- =====================================================================
-- CarpoolBoard Prototype 5 — Editable Profile phase: database migration
-- =====================================================================
--
-- Adds the persisted profile fields used by Edit Profile:
--   * profiles.bio                 (up to 160 characters)
--   * profiles.vehicle_make_model  (up to 60 characters, Driver info)
--   * profiles.avatar_path         (reference to a future profile photo)
-- and a server-side email format check to back up email editing.
--
-- Safety:
--   * Additive only: no DROP, DELETE, TRUNCATE, or UPDATE of existing rows.
--   * New columns are nullable with no default, so the existing profiles
--     stay valid and their ids, names, emails, and roles are unchanged.
--   * profiles.role is kept (legacy sign-up role; the app's current
--     Driver/Rider mode is activeMode and is never stored here).
--   * rides and ride_requests are not touched.
--   * Idempotent: every step checks whether it already happened, so running
--     the whole file again is a no-op.
--   * Wrapped in one transaction: if any step fails, nothing is applied.
--
-- NOT included on purpose (out of scope for this phase):
--   * license plates (no private storage without real auth)
--   * Storage bucket / Storage policies for photos (photo phase)
--   * any change to RLS policies, Supabase Auth, or profiles.role
--
-- Prototype security note: CarpoolBoard does not use Supabase Auth, and the
-- prototype's anon RLS policies allow full access to profiles. These
-- columns are therefore as readable/writable as the rest of the profile.
-- Don't put anything sensitive in a bio.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. New columns (nullable; NULL means "not set yet")
-- ---------------------------------------------------------------------

-- Short "About" text shown on Profile. NULL = no bio (Profile shows the
-- "Add a bio" placeholder).
alter table public.profiles
  add column if not exists bio text;

-- The car this person drives, e.g. "Honda Civic". Belongs to the person,
-- so it stays saved while they use Rider mode. Intended to become visible
-- to riders. License plates are deliberately NOT stored.
alter table public.profiles
  add column if not exists vehicle_make_model text;

-- Path of the person's profile photo inside the future 'avatars' Storage
-- bucket, e.g. '<profile id>/1760000000000.jpg'. A path (not a full URL)
-- so the public URL can be derived by the app and isn't tied to a project
-- URL. NULL = no photo (the app shows the initials avatar). Unused until
-- the photo phase; nothing writes it yet.
alter table public.profiles
  add column if not exists avatar_path text;

-- ---------------------------------------------------------------------
-- 2. CHECK constraints (added only if they don't already exist)
-- ---------------------------------------------------------------------
-- Every check allows NULL, so the existing profiles (all NULL in the new
-- columns) satisfy them immediately.

do $$
begin
  -- Bio: at most 160 characters, and never blank/whitespace-only (the app
  -- saves an empty bio as NULL).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_bio_check'
  ) then
    alter table public.profiles
      add constraint profiles_bio_check
      check (bio is null or (char_length(bio) <= 160 and btrim(bio) <> ''));
  end if;

  -- Vehicle make/model: at most 60 characters, never blank.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_vehicle_make_model_check'
  ) then
    alter table public.profiles
      add constraint profiles_vehicle_make_model_check
      check (
        vehicle_make_model is null
        or (char_length(vehicle_make_model) <= 60 and btrim(vehicle_make_model) <> '')
      );
  end if;

  -- Avatar path: a short, non-blank relative path with no '..' segments.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_avatar_path_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_path_check
      check (
        avatar_path is null
        or (
          char_length(avatar_path) between 1 and 255
          and avatar_path !~ '(^/|\.\.)'
        )
      );
  end if;

  -- Email format: the same basic shape the app checks (EMAIL_PATTERN in
  -- lib/format.js): something@something.something, no spaces. This backs
  -- up email editing on the server. The existing unique-email and
  -- trim/lowercase constraints are left exactly as they are.
  --
  -- NOT VALID: existing rows are not re-checked when this is added, so the
  -- migration can't fail because of old data. New rows and any future
  -- update are checked. See the verification queries for VALIDATE.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_email_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_email_format_check
      check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
      not valid;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Column documentation (shown in the Supabase Table Editor)
-- ---------------------------------------------------------------------
-- COMMENT ON simply overwrites the description, so it's safe to re-run.

comment on column public.profiles.bio is
  'Optional About text, max 160 characters. NULL = no bio.';
comment on column public.profiles.vehicle_make_model is
  'Optional vehicle make/model (Driver info), max 60 characters. Kept while the person uses Rider mode. No license plates are stored.';
comment on column public.profiles.avatar_path is
  'Optional profile photo path inside the avatars Storage bucket (<profile id>/<file>). NULL = initials avatar.';
comment on column public.profiles.role is
  'Legacy: the role picked at sign-up. The app''s current Driver/Rider mode is session state (activeMode) and is not stored here.';

commit;

-- Ask the Supabase API (PostgREST) to pick up the new columns right away.
notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the migration above
-- =====================================================================
--
-- -- a) The three new columns exist and are nullable text:
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'profiles'
-- order by ordinal_position;
--
-- -- b) The four new constraints exist (convalidated = false is expected
-- --    for profiles_email_format_check until it's validated):
-- select conname, convalidated, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.profiles'::regclass
-- order by conname;
--
-- -- c) Existing data unchanged: still 7 profiles, same role split, and the
-- --    new columns empty on every existing row:
-- select count(*) as profiles,
--        count(*) filter (where role = 'driver') as role_driver,
--        count(*) filter (where role = 'rider')  as role_rider,
--        count(bio) as with_bio,
--        count(vehicle_make_model) as with_vehicle,
--        count(avatar_path) as with_avatar
-- from public.profiles;
--
-- -- d) Rides and requests untouched:
-- select (select count(*) from public.rides) as rides,
--        (select count(*) from public.ride_requests where status = 'accepted') as accepted,
--        (select count(*) from public.ride_requests where status = 'pending')  as pending;
--
-- -- e) Do any existing emails fail the new format check? (expect 0 rows)
-- select id from public.profiles
-- where email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
--
-- -- f) OPTIONAL, only if (e) returned 0 rows: mark the email format check
-- --    as fully validated for existing rows too. Safe to skip.
-- -- alter table public.profiles validate constraint profiles_email_format_check;
