-- =====================================================================
-- CarpoolBoard Prototype 8 — Feature 3: sign-in throttle by client
-- =====================================================================
--
-- Adds one nullable column to public.sign_in_attempts so the
-- username-sign-in Edge Function can count failures per CLIENT as well as
-- per username:
--   * 5 failures for one username from one client  -> that client waits
--   * 20 failures for one username from all clients -> everyone waits
--   * 50 failures from one client across usernames  -> that client waits
-- Before this, 5 failures from anyone locked a username for everyone, so
-- anyone who knew a username could lock its owner out.
--
-- client_key is NOT an IP address: the function stores an HMAC-SHA256 of
-- the caller's IP (keyed with a server-only secret), so the table never
-- holds raw IPs and a stored key can't be turned back into one.
--
-- Run AFTER: auth-1-accounts.sql. Run BEFORE: deploying the updated
-- username-sign-in function (it needs this column and fails closed with a
-- server error without it).
--
-- Safety:
--   * Additive only: one nullable column and one index. No row is changed
--     or deleted; existing rows get client_key = NULL.
--   * No privilege changes: the service role's existing table-level
--     SELECT/INSERT covers the new column; the app roles still have none.
--   * Idempotent. One transaction.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.sign_in_attempts') is null then
    raise exception 'auth-1b stopped: public.sign_in_attempts is missing. Run auth-1-accounts.sql first. Nothing was changed.';
  end if;
end
$$;

alter table public.sign_in_attempts
  add column if not exists client_key text;

create index if not exists sign_in_attempts_client_created_idx
  on public.sign_in_attempts (client_key, created_at desc)
  where client_key is not null;

comment on column public.sign_in_attempts.client_key is
  'HMAC-SHA256 of the caller''s IP (server-side secret), never the raw IP. NULL when the IP was unavailable.';

commit;


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the migration above
-- =====================================================================
--
-- -- a) The column and index exist (expect 1 row each):
-- select column_name, data_type, is_nullable from information_schema.columns
-- where table_schema = 'public' and table_name = 'sign_in_attempts' and column_name = 'client_key';
-- select indexname from pg_indexes
-- where schemaname = 'public' and indexname = 'sign_in_attempts_client_created_idx';
--
-- -- b) Privileges unchanged (expect true, true, false, false):
-- select has_column_privilege('service_role', 'public.sign_in_attempts', 'client_key', 'insert'),
--        has_column_privilege('service_role', 'public.sign_in_attempts', 'client_key', 'select'),
--        has_table_privilege('anon', 'public.sign_in_attempts', 'select'),
--        has_table_privilege('authenticated', 'public.sign_in_attempts', 'select');


-- =====================================================================
-- ROLLBACK — not run by default. Redeploy the previous function first.
-- =====================================================================
-- drop index if exists public.sign_in_attempts_client_created_idx;
-- alter table public.sign_in_attempts drop column if exists client_key;
