-- =====================================================================
-- CarpoolBoard Prototype 5 — Profile photo Storage setup
-- =====================================================================
--
-- Creates the 'avatars' Storage bucket for profile photos and the ONE
-- policy the app needs to upload into it.
--
-- How photos are stored:
--   * Object path:  <profile id>/<unix ms timestamp>.jpg   (or .png)
--                   e.g. 3f1c…-…-…/1760000000000.jpg
--     Keyed by the profile id (which never changes), never by email
--     (which can be edited).
--   * profiles.avatar_path stores just that path (see profile-phase.sql);
--     the app derives the public URL from it.
--   * Every new photo gets a new timestamped path, so nothing is ever
--     overwritten, and phones never show a stale cached image.
--   * Replaced photos are NOT deleted: they stay in the bucket as orphaned
--     files. That's accepted for this prototype so no delete access exists.
--
-- What anonymous app clients (the publishable key) can do afterwards:
--   * VIEW any avatar through its public URL (public bucket).
--   * UPLOAD a new JPEG/PNG of at most 2 MB, only into a folder named after
--     an existing profile id, only with a <timestamp>.jpg/.png file name.
--   * NOT list the bucket's contents through the API (no SELECT policy).
--   * NOT overwrite/replace an existing file (no UPDATE policy).
--   * NOT delete any file (no DELETE policy).
--
-- PROTOTYPE-LEVEL SECURITY: CarpoolBoard does not use Supabase Auth, so
-- Storage cannot tell WHO is uploading. Anyone with the app's publishable
-- key who knows (or reads from the shared profiles table) a profile id can
-- upload a photo into that profile's folder. They can't replace or delete
-- an existing photo, and the photo only shows up on a profile once that
-- profile's avatar_path points to it — but profiles itself is still fully
-- writable under the prototype's anon policies. Real per-user upload rules
-- (e.g. folder = auth.uid()) need Supabase Auth, which is out of scope.
--
-- Safety:
--   * Touches only storage.buckets (the 'avatars' row) and adds one policy
--     on storage.objects. profiles, rides, ride_requests, and
--     profiles.role are not touched.
--   * No DROP, DELETE, or TRUNCATE.
--   * Idempotent: re-running re-applies the same bucket settings and skips
--     the policy if it already exists.
--   * One transaction: if any step fails, nothing is applied.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The 'avatars' bucket
-- ---------------------------------------------------------------------
-- public = true: avatars can be loaded with a plain public URL (no signed
--   URLs that expire), since they're shown on the shared board anyway.
-- file_size_limit = 2 MB (2 * 1024 * 1024 bytes), enforced by Storage.
-- allowed_mime_types: JPEG and PNG only, enforced by Storage.
-- If the bucket already exists, the same settings are re-applied, so its
-- limits always match this file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 2. Upload policy (INSERT only) for the app's anon role
-- ---------------------------------------------------------------------
-- An upload is allowed only when ALL of these hold:
--   a) it goes into the 'avatars' bucket;
--   b) the path is exactly '<uuid>/<13-digit ms timestamp>.jpg|.jpeg|.png'
--      (no sub-folders, no other names, no '..');
--   c) the folder is the id of a profile that actually exists.
-- The bucket settings above separately enforce JPEG/PNG and 2 MB.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'avatars: anon upload into existing profile folder'
  ) then
    create policy "avatars: anon upload into existing profile folder"
      on storage.objects
      for insert
      to anon
      with check (
        bucket_id = 'avatars'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{13}\.(jpg|jpeg|png)$'
        -- (storage.foldername(name))[1] stays OUTSIDE the subquery on
        -- purpose: inside it, `name` would mean profiles.name (the
        -- person's display name) instead of the object's path.
        and (storage.foldername(name))[1] in (
          select p.id::text from public.profiles p
        )
      );
  end if;
end
$$;

commit;


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the setup above
-- =====================================================================
--
-- -- a) The bucket exists with the right settings
-- --    (expect: avatars | true | 2097152 | {image/jpeg,image/png}):
-- select id, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id = 'avatars';
--
-- -- b) Exactly one avatars policy, INSERT for anon:
-- select policyname, cmd, roles, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname like 'avatars:%';
--
-- -- c) No UPDATE/DELETE/SELECT policies mention the avatars bucket
-- --    (expect 0 rows):
-- select policyname, cmd
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and cmd in ('UPDATE', 'DELETE', 'SELECT')
--   and (coalesce(qual, '') || coalesce(with_check, '')) like '%avatars%';
--
-- -- d) Nothing else changed: same profiles/rides/requests counts as before.
-- select (select count(*) from public.profiles) as profiles,
--        (select count(avatar_path) from public.profiles) as with_avatar,
--        (select count(*) from public.rides) as rides,
--        (select count(*) from public.ride_requests) as ride_requests;
--
-- -- e) Later, after testing uploads: list uploaded avatar files
-- --    (runs as the dashboard's admin role, not the app):
-- select name, metadata->>'mimetype' as type, metadata->>'size' as bytes, created_at
-- from storage.objects
-- where bucket_id = 'avatars'
-- order by created_at desc;
