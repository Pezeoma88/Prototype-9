-- =====================================================================
-- CarpoolBoard Prototype 9 — Private Driver/Rider Messaging,
-- step 2: verify (ALWAYS ROLLS BACK)
-- =====================================================================
--
-- Run AFTER messaging-1-tables.sql.
--
-- ROLLBACK OF DATABASE CHANGES (see "WHAT THE ROLLBACK DOES NOT UNDO")
--   Everything below is ONE SQL statement (a single DO block). The data
--   and schema changes of a statement that ends in an error are undone by
--   Postgres itself, however
--   the SQL Editor sends it (one implicit transaction, autocommit, or its
--   own BEGIN/COMMIT). This block ALWAYS ends in an error:
--     "MESSAGING VERIFY PASSED (N checks) ..."   every check passed
--     "MESSAGING VERIFY FAILED: <check> ..."     stopped at that check
--     "MESSAGING VERIFY STOPPED: ..."            a pre-check refused to start
--     any other error                            unexpected; also rolled back
--   so every test account, ride, request, conversation, message and the
--   session-private (pg_temp) helper functions it creates are discarded.
--   If you ever see "Success" instead of an error, tell me: that would
--   mean the file was changed.
--
-- HOW TO RUN IT SAFELY
--   1. SQL Editor -> New query. Make sure the editor's role selector is
--      the default "postgres" (NOT impersonating a user): the pre-check
--      refuses to run as anon/authenticated or with a user session set.
--   2. Paste the WHOLE file. Do not add BEGIN/COMMIT. Do not run a
--      selection of it (a partial DO block won't parse, which is harmless,
--      but proves nothing).
--   3. Run once. Send me the full error text (it lists every check).
--      Until the two md5 pins in section 0c are filled in, the run stops
--      at the pre-check before writing anything; send that message too.
--   Safest of all: run it first on a Supabase branch or local stack if you
--   have one; it is designed to be safe on production too.
--
-- WHAT IT TOUCHES
--   * Creates 6 throwaway accounts by inserting auth.users rows directly.
--     This does NOT go through Supabase Auth (GoTrue), so GoTrue itself
--     sends no email, writes no auth audit-log entry and calls no Auth
--     hook. Inside the database, the writes fire whatever triggers exist
--     on the tables written. Before writing anything, the pre-check:
--       0a. works out from the live catalog every table the run can write
--           to: the six it writes directly, plus every table a foreign-key
--           CASCADE / SET NULL / SET DEFAULT can reach from the rides,
--           requests and conversations it updates or deletes (e.g.
--           driver_reviews, through the Cancel Ride test). Any reachable
--           table other than the expected ones stops the run until it is
--           confirmed with Phase 0 query M3.
--       0b. stops if any of those tables has a trigger other than the
--           four allowed ones (e.g. a Database Webhook, which is a
--           trigger that calls pg_net).
--       0c. checks three of the allowed triggers against their reviewed
--           versions: exact trigger definition plus md5 of the whole
--           function definition. Any difference stops the run.
--     UNTIL on_auth_user_created_profile and rides_departure_in_future
--     have a pinned md5 in 0c (filled in only after their LIVE definitions
--     have been read), EVERY run stops at 0c before writing anything, and
--     the stop message prints those definitions for review.
--   * Creates throwaway rides / ride_requests for those accounts and
--     exercises the messaging RPCs and forbidden operations as each one.
--   * Never reads personal data, never updates or deletes a row it didn't
--     create, never disables a trigger or changes a setting beyond this
--     statement (role and request.jwt.claims are set LOCAL and restored).
--
-- WHAT THE ROLLBACK DOES NOT UNDO (limits of the guarantee above)
--   The rollback discards every row change, and any NOTIFY (including
--   PostgREST's schema-reload event trigger, which fires on the temporary
--   helper functions). Realtime / logical replication only publish
--   committed changes. But a rollback cannot undo:
--   * Anything non-transactional done by code the run invokes: the
--     whitelisted triggers, existing RLS policies (Leave Seat UPDATE,
--     Cancel Ride DELETE), the existing ride_requests / rides cascade, and
--     any function those call. If such code ever made an HTTP call
--     (pg_net / http extension), used dblink, wrote a file, or advanced a
--     sequence, that effect would remain. The trigger pre-check limits
--     this to reviewed triggers on every table the run can reach; it does
--     NOT inspect RLS policy expressions, rewrite rules (CREATE RULE), or
--     the bodies of functions they call, and it doesn't check whether a
--     trigger is enabled or disabled.
--   * Sequence counters (gaps only). The pre-check reports any identity /
--     serial column as a NOTE; Phase 0 showed uuid ids.
--   * Records outside the tables: WAL (and so backups / point-in-time
--     recovery / read replicas) contains the rolled-back test rows, and
--     Postgres logs, pg_stat statistics and any statement auditing record
--     that the run happened, with the throwaway test usernames and ids.
--   * Short-lived locks and load on the touched tables while it runs.
--   So: no external side effects are EXPECTED from the reviewed objects,
--   but this script cannot prove that for code it doesn't inspect. Run it
--   on a branch / local stack first when one is available.
--
-- NOT COVERED HERE (by design; see the appendix at the end):
--   * Expired-ride behaviour end to end. The existing
--     rides_departure_in_future trigger rightly refuses past departures and
--     this script will not disable it. The rule itself (2-hour grace,
--     exact boundary) is tested deterministically in section B, and A09
--     checks that every RPC uses that rule.
--   * Real concurrency (two sessions), including the 55P03 "try again"
--     path: inside one transaction a row lock never conflicts with itself,
--     so NOWAIT can't fail here. A10 only checks the code is present.
--     Recipes in the appendix (X3b, X6).
-- =====================================================================

do $verify$
declare
  v_log        text := '';
  v_admin      text := current_user;
  v_tag        text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_driver     uuid := gen_random_uuid();
  v_rider_a    uuid := gen_random_uuid();
  v_rider_b    uuid := gen_random_uuid();
  v_pending    uuid := gen_random_uuid();
  v_denied     uuid := gen_random_uuid();
  v_stranger   uuid := gen_random_uuid();
  v_ride1      uuid;
  v_ride2      uuid;
  v_req_b1     uuid;
  v_req_a2     uuid;
  v_conv_a1    uuid;
  v_conv_b1    uuid;
  v_conv_a2    uuid;
  v_k_a1       uuid := gen_random_uuid();
  v_k_a2       uuid := gen_random_uuid();
  v_k_b1       uuid := gen_random_uuid();
  v_k_d1       uuid := gen_random_uuid();
  v_msg_a1     text;
  v_msg_a2     text;
  v_msg_b1     text;
  v_r          text;
  v_r2         text;
  v_n          bigint;
  v_sent       integer := 0;
  v_existing   bigint;
  v_problem    text;
  v_trigger_def text;
  v_trigger_md5 text;
  v_function_def text;
  v_pin        record;
  v_pin_problems text;
  v_reach      oid[];
  v_tables     oid[];
  v_functions  oid[];
  -- RPC shorthands (format() fills in the values; results are flattened
  -- to 'a|b|c' text so nothing is cast before a check can report it).
  c_open       constant text := 'select conversation_id::text || ''|'' || state || ''|'' || can_send::text || ''|'' || my_role from public.open_my_ride_conversation(%L::uuid, %L::uuid)';
  c_send       constant text := 'select id::text || ''|'' || sender_id::text || ''|'' || body from public.send_my_ride_message(%L::uuid, %L::uuid, %L)';
  c_list_one   constant text := 'select state || ''|'' || can_send::text || ''|'' || ride_destination || ''|'' || coalesce(ride_id::text, ''no-ride'') from public.list_my_ride_conversations(%L::uuid)';
  c_whoami     constant text := 'select current_user::text || ''|'' || coalesce(auth.uid()::text, ''null'')';
  -- Expected refusal texts.
  e_unavail    constant text := 'ERROR: This conversation isn''t available.%';
  e_denied     constant text := 'ERROR: permission denied%';
  e_reused     constant text := 'ERROR: This message ID was already used%';
begin
  -- ===================================================================
  -- 0. Pre-checks (nothing has been written yet)
  -- ===================================================================
  if v_admin in ('anon', 'authenticated') or auth.uid() is not null then
    raise exception 'MESSAGING VERIFY STOPPED: run this as the default postgres role with no user impersonation (current_user=%, auth.uid()=%).',
      v_admin, auth.uid();
  end if;

  if to_regclass('public.ride_conversations') is null
     or to_regclass('public.ride_messages') is null then
    raise exception 'MESSAGING VERIFY STOPPED: messaging-1-tables.sql has not been applied.';
  end if;

  -- -------------------------------------------------------------------
  -- 0a. Every table this run can write to, directly or by cascade
  -- -------------------------------------------------------------------
  -- Directly: auth.users, public.profiles (via the sign-up trigger),
  -- rides, ride_requests, ride_conversations and ride_messages.
  --
  -- Indirectly: any table that a foreign-key ACTION (ON DELETE / ON UPDATE
  -- CASCADE, SET NULL or SET DEFAULT) can reach from a table this run
  -- updates or deletes rows in. Those starting tables are rides (H03 Cancel
  -- Ride), ride_requests (G02 Leave Seat, and the cascade from H03) and
  -- ride_conversations (open / send, and the SET NULL from H03). Rows are
  -- only INSERTed into auth.users, profiles and ride_messages, and an
  -- insert sets off no foreign-key action, so the walk doesn't start there.
  -- RESTRICT / NO ACTION keys only check and never write, so they are not
  -- followed. The walk follows actions on every column, not just the ones
  -- this run changes, so it can over-report but never under-report.
  --
  -- This matters even for a table where the run creates no rows: a cascade
  -- that matches zero rows still runs a statement on the child table, and
  -- a STATEMENT-level trigger there fires anyway (e.g. on driver_reviews).
  --
  -- The walk reads the live catalog, so it doesn't depend on this file
  -- knowing the schema. What it finds must then be a table this file was
  -- written for; anything else stops the run (fail closed).
  with recursive reach(rel) as (
    select unnest(array['public.rides'::regclass,
                        'public.ride_requests'::regclass,
                        'public.ride_conversations'::regclass])::oid
    union
    select con.conrelid
    from pg_constraint con
    join reach on con.confrelid = reach.rel
    where con.contype = 'f'
      and (con.confdeltype in ('c', 'n', 'd') or con.confupdtype in ('c', 'n', 'd'))
  )
  select array_agg(rel) into v_reach from reach;

  -- Expected, from this repo's SQL plus the Phase 0 report (NOT yet
  -- confirmed against the live database: Phase 0 query M3 lists the real
  -- foreign keys):
  --   rides              -> ride_requests       ON DELETE CASCADE (dashboard-created)
  --   rides              -> driver_reviews      ON DELETE SET NULL (prototype-6-reviews.sql)
  --   rides              -> ride_conversations  ON DELETE SET NULL (messaging-1)
  --   ride_requests      -> ride_conversations  ON DELETE SET NULL (messaging-1)
  --   ride_conversations -> ride_messages       ON DELETE CASCADE (messaging-1)
  -- Any other reachable table (e.g. one made in the dashboard) stops the
  -- run before anything is written. It is added here only once M3 and that
  -- table's triggers have been reviewed.
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by n.nspname, c.relname) into v_problem
  from unnest(v_reach) as r(rel)
  join pg_class c on c.oid = r.rel
  join pg_namespace n on n.oid = c.relnamespace
  where (n.nspname, c.relname) not in (('public', 'rides'), ('public', 'ride_requests'),
                                       ('public', 'ride_conversations'), ('public', 'ride_messages'),
                                       ('public', 'driver_reviews'));
  if v_problem is not null then
    raise exception E'MESSAGING VERIFY STOPPED before writing anything: the test ride deletion / request updates could also write, by foreign-key cascade, to table(s) this script was not reviewed for:\n    %\nRun Phase 0 query M3 (messaging-0-inspect.sql) and send its output plus these tables'' triggers; the script must be updated before it can run.', v_problem;
  end if;

  -- -------------------------------------------------------------------
  -- 0b. Only allowed triggers on any of those tables
  -- -------------------------------------------------------------------
  -- Any trigger not in this list stops the run, and the stop message
  -- prints its full definition so it can be reviewed. Being on this list
  -- is NOT enough by itself: three of the four are also checked against
  -- their reviewed versions in 0c. ride_messages_check_participant is
  -- created by messaging-1-tables.sql in this repo; it is allowed by name,
  -- and check E05 tests what it does.
  select string_agg(format('%I.%I: %s', n.nspname, c.relname, pg_get_triggerdef(t.oid)), E'\n    '
                    order by n.nspname, c.relname, t.tgname) into v_problem
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and (t.tgrelid = any (v_reach)
         or (n.nspname, c.relname) in (('auth', 'users'), ('public', 'profiles'), ('public', 'rides'),
                                       ('public', 'ride_requests'), ('public', 'ride_conversations'),
                                       ('public', 'ride_messages')))
    and (n.nspname, c.relname, t.tgname) not in (
          ('auth',   'users',         'on_auth_user_created_profile'),
          ('public', 'rides',         'rides_departure_in_future'),
          ('public', 'ride_requests', 'ride_requests_no_self_request'),
          ('public', 'ride_messages', 'ride_messages_check_participant'));
  if v_problem is not null then
    raise exception E'MESSAGING VERIFY STOPPED before writing anything: unreviewed trigger(s) that could have side effects:\n    %\nSend me this list and each trigger function''s pg_get_functiondef.', v_problem;
  end if;

  -- -------------------------------------------------------------------
  -- 0c. Allowed triggers must be the reviewed versions, not just the names
  -- -------------------------------------------------------------------
  -- For each pinned trigger:
  --   * it must exist (a missing trigger means this isn't the database
  --     that was reviewed);
  --   * pg_get_triggerdef must be exactly the expected text, which covers
  --     timing, events (incl. UPDATE OF columns), FOR EACH ROW/STATEMENT,
  --     WHEN condition, arguments and function name. The expected texts
  --     come from the CREATE TRIGGER statements in this repo (or the
  --     dashboard review). pg_get_triggerdef prints the function name
  --     without "public." when public is on the search_path, so both
  --     spellings are accepted;
  --   * md5(pg_get_functiondef(function)) must equal the pinned value.
  --     That covers the whole function: body, language, SECURITY
  --     DEFINER/INVOKER and SET options, independent of search_path.
  --
  -- A NULL md5 means "the live function has NOT been reviewed yet". The
  -- run then STOPS before writing anything and prints the live definition
  -- and its md5. Fill a NULL in only after that printed definition has
  -- been read and compared with the source named in the row. Never fill
  -- it in from the repo file alone: the live function may differ.
  --
  -- Reviewed (all three are pinned below):
  --   ride_requests_no_self_request (dashboard-created, reviewed 2026-11-07):
  --     BEFORE INSERT OR UPDATE, FOR EACH ROW, public.prevent_self_request():
  --     plpgsql, SECURITY INVOKER, reads public.rides and raises 'You
  --     cannot request your own ride.'; no writes, no external calls.
  --   on_auth_user_created_profile -> public.handle_new_auth_user()
  --     (reviewed 2026-11-08 from live P4 evidence): AFTER INSERT ON
  --     auth.users, FOR EACH ROW; trigger text matches; enabled; owner
  --     postgres. plpgsql, SECURITY DEFINER, SET search_path TO ''. Only
  --     INSERTs the new user's public.profiles row; raises on an invalid
  --     username. The live md5 also equals the md5 rebuilt from
  --     auth-1-accounts.sql section 3, so the live function is that source.
  --   rides_departure_in_future -> public.prevent_past_departure()
  --     (reviewed 2026-11-08 from live P4 evidence): BEFORE INSERT OR UPDATE
  --     OF departure_at ON public.rides, FOR EACH ROW; trigger text matches;
  --     enabled; owner postgres. plpgsql, SECURITY INVOKER, SET search_path
  --     TO ''. Reads no tables and writes nothing; raises when a new or
  --     changed departure_at is not in the future. The live md5 also equals
  --     the md5 rebuilt from auth-1-accounts.sql section 7.
  -- A pin covers the exact function text, comments and whitespace
  -- included. If any of these functions or triggers is changed or
  -- re-created (even by re-running its file), the run stops here; review
  -- the printed definition again and update the pin before running.
  v_pin_problems := '';
  for v_pin in
    select * from (values
      ('auth', 'users', 'on_auth_user_created_profile',
       array['CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user()',
             'CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()'],
       '9d71fed32a397361cce7cb58e07c3130'::text,  -- reviewed 2026-11-08 (live P4)
       'auth-1-accounts.sql section 3, public.handle_new_auth_user()'),
      ('public', 'rides', 'rides_departure_in_future',
       array['CREATE TRIGGER rides_departure_in_future BEFORE INSERT OR UPDATE OF departure_at ON public.rides FOR EACH ROW EXECUTE FUNCTION prevent_past_departure()',
             'CREATE TRIGGER rides_departure_in_future BEFORE INSERT OR UPDATE OF departure_at ON public.rides FOR EACH ROW EXECUTE FUNCTION public.prevent_past_departure()'],
       '7fe830bc9deff204074c903ece478233'::text,  -- reviewed 2026-11-08 (live P4)
       'auth-1-accounts.sql section 7, public.prevent_past_departure()'),
      ('public', 'ride_requests', 'ride_requests_no_self_request',
       array['CREATE TRIGGER ride_requests_no_self_request BEFORE INSERT OR UPDATE ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION prevent_self_request()',
             'CREATE TRIGGER ride_requests_no_self_request BEFORE INSERT OR UPDATE ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION public.prevent_self_request()'],
       '7c12243683a96cc100ceaf60e19a85bd',
       'dashboard-created, reviewed 2026-11-07')
    ) as p(sch, tbl, trg, defs, fn_md5, source)
  loop
    select pg_get_triggerdef(t.oid), pg_get_functiondef(t.tgfoid)
      into v_trigger_def, v_function_def
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = v_pin.sch and c.relname = v_pin.tbl
      and t.tgname = v_pin.trg and not t.tgisinternal;
    if not found then
      v_pin_problems := v_pin_problems || format(
        E'\n\n  * %s.%s.%s: trigger not found, so this is not the database that was reviewed (expected from %s).',
        v_pin.sch, v_pin.tbl, v_pin.trg, v_pin.source);
      continue;
    end if;
    v_trigger_md5 := md5(v_function_def);

    if not (v_trigger_def = any (v_pin.defs)) then
      v_problem := 'trigger definition differs from the reviewed one';
    elsif v_pin.fn_md5 is null then
      v_problem := 'function not reviewed yet (no pinned md5)';
    elsif v_trigger_md5 is distinct from v_pin.fn_md5 then
      v_problem := format('function differs from the reviewed version (reviewed md5: %s)', v_pin.fn_md5);
    else
      v_problem := null;
    end if;

    if v_problem is not null then
      v_pin_problems := v_pin_problems || format(
        E'\n\n  * %s.%s.%s: %s.\n    compare with: %s\n    trigger: %s\n    function md5: %s\n    function definition:\n%s',
        v_pin.sch, v_pin.tbl, v_pin.trg, v_problem, v_pin.source,
        v_trigger_def, v_trigger_md5, v_function_def);
    end if;
  end loop;
  if v_pin_problems <> '' then
    raise exception E'MESSAGING VERIFY STOPPED before writing anything: an allowed trigger is missing, unreviewed, or not the reviewed version.%\n\nSend me this whole message. An md5 is pinned in section 0c only after its printed definition has been reviewed.',
      v_pin_problems;
  end if;

  select string_agg(format('%I.%I.%I', table_schema, table_name, column_name), ', ') into v_problem
  from information_schema.columns
  where (table_schema, table_name) in (('auth', 'users'), ('public', 'profiles'), ('public', 'rides'),
                                       ('public', 'ride_requests'), ('public', 'ride_conversations'),
                                       ('public', 'ride_messages'))
    and (is_identity = 'YES' or column_default like 'nextval(%');
  if v_problem is not null then
    v_log := v_log || E'\n  NOTE  sequence counters will advance (gaps only, no rows kept): ' || v_problem;
  end if;

  -- Session-private helpers. Created inside this statement, so they are
  -- rolled back with it.
  execute $fn$
    create or replace function pg_temp.mt_as(p_uid uuid, p_sql text)
    returns text
    language plpgsql
    as $body$
    -- Runs p_sql as account p_uid (NULL = anon) exactly the way the Data
    -- API does (role + request.jwt.claims), returns the first column of
    -- the first row as text, or 'ERROR: <message>'. If the impersonation
    -- itself is wrong, it aborts the WHOLE run (SQLSTATE P0901) instead of
    -- returning an error a check might mistake for an expected refusal.
    declare
      v_orig     text := current_user;
      v_want     text := case when p_uid is null then 'anon' else 'authenticated' end;
      v_got_role text;
      v_got_uid  uuid;
      v_result   text;
    begin
      begin
        if p_uid is null then
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          set local role anon;
        else
          perform set_config('request.jwt.claims',
            json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;

        select current_user::text, auth.uid() into v_got_role, v_got_uid;
        if v_got_role is distinct from v_want or v_got_uid is distinct from p_uid then
          raise exception using errcode = 'P0901', message = format(
            'MESSAGING VERIFY FAILED: impersonation mismatch (wanted %s / %s, got %s / %s). Everything was rolled back.',
            v_want, coalesce(p_uid::text, 'null'), v_got_role, coalesce(v_got_uid::text, 'null'));
        end if;

        execute p_sql into v_result;

        execute format('set local role %I', v_orig);
        perform set_config('request.jwt.claims', '', true);
      exception
        when sqlstate 'P0901' then
          raise;
        when others then
          -- The failed subtransaction already undid the role/claims change.
          v_result := 'ERROR: ' || sqlerrm;
      end;
      return v_result;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function pg_temp.mt_ok(p_label text, p_ok boolean, p_got text default null)
    returns text
    language plpgsql
    as $body$
    begin
      if p_ok is not true then
        raise exception 'MESSAGING VERIFY FAILED: %  |  got: %  |  Everything was rolled back; nothing was saved.',
          p_label, coalesce(left(p_got, 400), '(null)');
      end if;
      return E'\n  PASS  ' || p_label;
    end;
    $body$
  $fn$;

  -- Text -> uuid without ever throwing (NULL if it isn't one).
  execute $fn$
    create or replace function pg_temp.mt_uuid(p text)
    returns uuid
    language sql
    immutable
    as $body$
      select case when p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then p::uuid end;
    $body$
  $fn$;

  v_tables := array['public.ride_conversations'::regclass::oid, 'public.ride_messages'::regclass::oid];
  v_functions := array[
    'public.open_my_ride_conversation(uuid, uuid)'::regprocedure::oid,          -- [1]
    'public.send_my_ride_message(uuid, uuid, text)'::regprocedure::oid,         -- [2]
    'public.list_my_ride_conversations(uuid)'::regprocedure::oid,               -- [3]
    'public.ride_conversation_state(boolean, text, timestamptz, timestamptz)'::regprocedure::oid,  -- [4]
    'public.ride_messages_check_participant()'::regprocedure::oid];             -- [5]

  -- ===================================================================
  -- Z. The impersonation itself is what we think it is
  -- ===================================================================
  v_r := pg_temp.mt_as(v_rider_a, c_whoami);
  v_log := v_log || pg_temp.mt_ok('Z01 simulated user: role authenticated, auth.uid() = that account',
    v_r = 'authenticated|' || v_rider_a::text, v_r);

  v_r := pg_temp.mt_as(null, c_whoami);
  v_log := v_log || pg_temp.mt_ok('Z02 simulated anon: role anon, auth.uid() is null',
    v_r = 'anon|null', v_r);

  v_log := v_log || pg_temp.mt_ok('Z03 after each simulated call we are back to the admin role with no user',
    current_user::text = v_admin and auth.uid() is null,
    current_user::text || ' / ' || coalesce(auth.uid()::text, 'null'));

  -- ===================================================================
  -- A. Migration in place and locked down (privileges counted the way
  --    Postgres enforces them: has_*_privilege includes PUBLIC grants and
  --    privileges inherited through role membership; column-level grants
  --    are checked with has_any_column_privilege and the raw ACLs)
  -- ===================================================================
  v_log := v_log || pg_temp.mt_ok('A01 RLS enabled on both tables',
    (select bool_and(relrowsecurity) from pg_class where oid = any (v_tables)));

  select string_agg(format('%s %s %s', r.rolname, t.t::regclass::text, p.p), ', ') into v_problem
  from unnest(v_tables) as t(t)
  cross join (values ('anon'::name), ('authenticated'::name)) as r(rolname)
  cross join (values ('INSERT'::text), ('UPDATE'), ('REFERENCES'), ('DELETE'), ('TRUNCATE'), ('TRIGGER')) as p(p)
  where case when p.p in ('INSERT', 'UPDATE', 'REFERENCES')
             then has_any_column_privilege(r.rolname, t.t, p.p)   -- table OR any column
             else has_table_privilege(r.rolname, t.t, p.p) end;
  v_log := v_log || pg_temp.mt_ok('A02 anon/authenticated hold no write privilege (table, column, PUBLIC or inherited)',
    v_problem is null, v_problem);

  v_log := v_log || pg_temp.mt_ok('A03 anon cannot SELECT any column; authenticated can SELECT',
    not has_any_column_privilege('anon', 'public.ride_conversations', 'SELECT')
    and not has_any_column_privilege('anon', 'public.ride_messages', 'SELECT')
    and has_table_privilege('authenticated', 'public.ride_conversations', 'SELECT')
    and has_table_privilege('authenticated', 'public.ride_messages', 'SELECT'));

  -- Raw ACLs: the only grant to anon/authenticated/PUBLIC is
  -- authenticated SELECT at table level, and there are no column grants.
  select string_agg(format('%s -> %s %s', c.relname,
                           case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end,
                           a.privilege_type), ', ') into v_problem
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where c.oid = any (v_tables)
    and (a.grantee = 0 or a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))
    and not (a.grantee = 'authenticated'::regrole::oid and a.privilege_type = 'SELECT');
  v_log := v_log || pg_temp.mt_ok('A04 table ACLs: only "authenticated SELECT" for client roles, nothing for PUBLIC',
    v_problem is null, v_problem);

  v_log := v_log || pg_temp.mt_ok('A05 no column-level grants on either table',
    not exists (select 1 from pg_attribute
                where attrelid = any (v_tables) and attnum > 0 and attacl is not null));

  -- Functions: no PUBLIC or anon EXECUTE in the effective ACL (a NULL ACL
  -- means the default, which includes PUBLIC, so it is expanded first).
  select string_agg(format('%s -> %s', p.oid::regprocedure::text,
                           case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end), ', ') into v_problem
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = any (v_functions)
    and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid
         or (a.grantee = 'authenticated'::regrole::oid and p.oid = v_functions[5]));
  v_log := v_log || pg_temp.mt_ok('A06 function ACLs: no PUBLIC/anon EXECUTE; trigger function not callable by clients',
    v_problem is null, v_problem);

  v_log := v_log || pg_temp.mt_ok('A07 effective EXECUTE: authenticated can run the 4 RPCs, anon none',
    (select bool_and(has_function_privilege('authenticated'::name, f, 'EXECUTE')
                     and not has_function_privilege('anon'::name, f, 'EXECUTE'))
       from unnest(v_functions[1:4]) as f));

  v_log := v_log || pg_temp.mt_ok('A08 open/send are SECURITY DEFINER, list is INVOKER, all pin search_path to empty',
    (select bool_and(case when p.oid = v_functions[3] then not p.prosecdef else true end
                     and case when p.oid in (v_functions[1], v_functions[2]) then p.prosecdef else true end
                     and p.proconfig @> array['search_path=""'])
       from pg_proc p where p.oid = any (v_functions[1:4])));

  v_log := v_log || pg_temp.mt_ok('A09 open, send and list all decide state with ride_conversation_state(... now())',
    pg_get_functiondef(v_functions[1]) like '%list_my_ride_conversations(%'
    and pg_get_functiondef(v_functions[1]) like '%public.ride_conversation_state(%now()%'
    and pg_get_functiondef(v_functions[2]) like '%public.ride_conversation_state(%now()%'
    and pg_get_functiondef(v_functions[3]) like '%public.ride_conversation_state(%now()%');

  -- The concurrency fixes are in the applied version (they can't be
  -- exercised inside one transaction; see appendix X3b / X6 / X9).
  v_log := v_log || pg_temp.mt_ok('A10 open and send lock the request FOR SHARE NOWAIT and map it to 55P03; send uses GREATEST',
    pg_get_functiondef(v_functions[1]) like '%for share nowait%exception when lock_not_available%errcode = ''lock_not_available''%'
    and pg_get_functiondef(v_functions[2]) like '%for share nowait%exception when lock_not_available%errcode = ''lock_not_available''%'
    and pg_get_functiondef(v_functions[2]) like '%last_message_at = greatest(c.last_message_at, v_msg.created_at)%'
    and pg_get_functiondef(v_functions[1]) not like '%for share;%'
    and pg_get_functiondef(v_functions[2]) not like '%for share;%');

  -- ===================================================================
  -- B. The open / read-only rule, deterministically (2-hour grace)
  -- ===================================================================
  v_log := v_log || pg_temp.mt_ok('B01 ride gone -> ride_cancelled',
    public.ride_conversation_state(false, 'accepted', now() + interval '1 day', now()) = 'ride_cancelled');
  v_log := v_log || pg_temp.mt_ok('B02 request cancelled -> seat_cancelled',
    public.ride_conversation_state(true, 'cancelled', now() + interval '1 day', now()) = 'seat_cancelled');
  v_log := v_log || pg_temp.mt_ok('B03 request pending / denied / missing -> not open',
    public.ride_conversation_state(true, 'pending', now() + interval '1 day', now()) = 'seat_cancelled'
    and public.ride_conversation_state(true, 'denied', now() + interval '1 day', now()) = 'seat_cancelled'
    and public.ride_conversation_state(true, null, now() + interval '1 day', now()) = 'seat_cancelled');
  v_log := v_log || pg_temp.mt_ok('B04 before departure -> open',
    public.ride_conversation_state(true, 'accepted', now() + interval '1 hour', now()) = 'open');
  v_log := v_log || pg_temp.mt_ok('B05 1h59m59s after departure -> open',
    public.ride_conversation_state(true, 'accepted', now() - interval '1 hour 59 minutes 59 seconds', now()) = 'open');
  v_log := v_log || pg_temp.mt_ok('B06 exactly 2h after departure -> completed',
    public.ride_conversation_state(true, 'accepted', now() - interval '2 hours', now()) = 'completed');
  v_log := v_log || pg_temp.mt_ok('B07 3h after departure -> completed',
    public.ride_conversation_state(true, 'accepted', now() - interval '3 hours', now()) = 'completed');
  v_log := v_log || pg_temp.mt_ok('B08 missing departure -> completed (fails closed)',
    public.ride_conversation_state(true, 'accepted', null, now()) = 'completed');

  -- ===================================================================
  -- Setup: throwaway accounts, rides and requests
  -- ===================================================================
  if exists (select 1 from public.profiles where username like 'zzmt\_' || v_tag || '\_%') then
    raise exception 'MESSAGING VERIFY STOPPED: test username prefix zzmt_% is taken. Run again.', v_tag;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
         'zzmt-' || v_tag || '-' || u.suffix || '@example.invalid',
         '{}'::jsonb,
         jsonb_build_object('username', 'zzmt_' || v_tag || '_' || u.suffix, 'role', u.role),
         now(), now()
  from (values (v_driver, 'drv', 'driver'), (v_rider_a, 'ra', 'rider'), (v_rider_b, 'rb', 'rider'),
               (v_pending, 'pnd', 'rider'), (v_denied, 'den', 'rider'), (v_stranger, 'str', 'rider'))
       as u(id, suffix, role);

  v_log := v_log || pg_temp.mt_ok('S01 six test profiles created by the sign-up trigger',
    (select count(*) from public.profiles
      where id in (v_driver, v_rider_a, v_rider_b, v_pending, v_denied, v_stranger)) = 6);

  insert into public.rides (driver_id, destination, departure_at, seat_count)
  values (v_driver, 'ZZ messaging test ride 1', now() + interval '1 day', 4)
  returning id into v_ride1;
  insert into public.rides (driver_id, destination, departure_at, seat_count)
  values (v_driver, 'ZZ messaging test ride 2', now() + interval '1 day', 4)
  returning id into v_ride2;

  insert into public.ride_requests (ride_id, rider_id, status) values (v_ride1, v_rider_a, 'accepted');
  insert into public.ride_requests (ride_id, rider_id, status) values (v_ride1, v_rider_b, 'accepted')
    returning id into v_req_b1;
  insert into public.ride_requests (ride_id, rider_id, status) values (v_ride1, v_pending, 'pending');
  insert into public.ride_requests (ride_id, rider_id, status) values (v_ride1, v_denied, 'denied');
  insert into public.ride_requests (ride_id, rider_id, status) values (v_ride2, v_rider_a, 'accepted')
    returning id into v_req_a2;

  -- ===================================================================
  -- C. Opening conversations: who may and who may not
  -- ===================================================================
  v_r := pg_temp.mt_as(v_rider_a, format(c_open, v_ride1, null));
  v_log := v_log || pg_temp.mt_ok('C01 accepted rider opens their chat (open, can send, role rider)',
    pg_temp.mt_uuid(split_part(v_r, '|', 1)) is not null
    and split_part(v_r, '|', 2) = 'open' and split_part(v_r, '|', 3) = 'true'
    and split_part(v_r, '|', 4) = 'rider', v_r);
  v_conv_a1 := pg_temp.mt_uuid(split_part(v_r, '|', 1));

  v_r := pg_temp.mt_as(v_driver, format(c_open, v_ride1, v_rider_a));
  v_log := v_log || pg_temp.mt_ok('C02 driver opening the same rider gets the SAME conversation (role driver)',
    split_part(v_r, '|', 1) = v_conv_a1::text and split_part(v_r, '|', 4) = 'driver', v_r);

  v_r := pg_temp.mt_as(v_driver, format(
    'select count(*)::text from public.open_my_ride_conversation(%L::uuid, %L::uuid)', v_ride1, v_rider_a));
  v_log := v_log || pg_temp.mt_ok('C03 open (DEFINER -> INVOKER list) returns exactly one row',
    v_r = '1', v_r);

  v_r := pg_temp.mt_as(v_rider_a, format(c_open, v_ride1, null));
  v_log := v_log || pg_temp.mt_ok('C04 opening again never creates a duplicate',
    split_part(v_r, '|', 1) = v_conv_a1::text
    and (select count(*) from public.ride_conversations
          where ride_id = v_ride1 and rider_id = v_rider_a) = 1, v_r);

  v_r := pg_temp.mt_as(v_driver, format(c_open, v_ride1, v_rider_b));
  v_log := v_log || pg_temp.mt_ok('C05 driver opens a separate chat with the second accepted rider',
    pg_temp.mt_uuid(split_part(v_r, '|', 1)) is not null
    and split_part(v_r, '|', 1) <> v_conv_a1::text, v_r);
  v_conv_b1 := pg_temp.mt_uuid(split_part(v_r, '|', 1));

  v_r  := pg_temp.mt_as(v_pending, format(c_open, v_ride1, null));
  v_r2 := pg_temp.mt_as(v_driver,  format(c_open, v_ride1, v_pending));
  v_log := v_log || pg_temp.mt_ok('C06 pending rider refused (by themselves and via the driver)',
    v_r like e_unavail and v_r2 like e_unavail
    and not exists (select 1 from public.ride_conversations where rider_id = v_pending), v_r || ' / ' || v_r2);

  v_r  := pg_temp.mt_as(v_denied, format(c_open, v_ride1, null));
  v_r2 := pg_temp.mt_as(v_driver, format(c_open, v_ride1, v_denied));
  v_log := v_log || pg_temp.mt_ok('C07 denied rider refused (by themselves and via the driver)',
    v_r like e_unavail and v_r2 like e_unavail
    and not exists (select 1 from public.ride_conversations where rider_id = v_denied), v_r || ' / ' || v_r2);

  v_r  := pg_temp.mt_as(v_stranger, format(c_open, v_ride1, null));
  v_r2 := pg_temp.mt_as(v_stranger, format(c_open, v_ride1, v_rider_a));
  v_log := v_log || pg_temp.mt_ok('C08 stranger refused, including when naming an accepted rider',
    v_r like e_unavail and v_r2 like e_unavail, v_r || ' / ' || v_r2);

  v_r := pg_temp.mt_as(v_rider_a, format(c_open, v_ride1, v_rider_b));
  v_log := v_log || pg_temp.mt_ok('C09 a rider cannot open another rider''s chat', v_r like e_unavail, v_r);

  v_r := pg_temp.mt_as(v_driver, format(c_open, v_ride1, v_driver));
  v_log := v_log || pg_temp.mt_ok('C10 driver cannot open a chat with themselves', v_r like e_unavail, v_r);

  v_r  := pg_temp.mt_as(null, format(c_open, v_ride1, null));
  v_r2 := pg_temp.mt_as(v_rider_a, format(c_open, gen_random_uuid(), null));
  v_log := v_log || pg_temp.mt_ok('C11 anon has no EXECUTE; unknown ride refused',
    v_r like e_denied and v_r2 like e_unavail, v_r || ' / ' || v_r2);

  -- ===================================================================
  -- D. Sending and retries
  -- ===================================================================
  v_msg_a1 := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a1, v_k_a1, E'  Hi, I''m at the gate \n'));
  v_log := v_log || pg_temp.mt_ok('D01 rider sends; sender is the caller; body is trimmed',
    pg_temp.mt_uuid(split_part(v_msg_a1, '|', 1)) is not null
    and split_part(v_msg_a1, '|', 2) = v_rider_a::text
    and split_part(v_msg_a1, '|', 3) = 'Hi, I''m at the gate', v_msg_a1);

  v_r := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a1, v_k_a1, 'Hi, I''m at the gate'));
  v_log := v_log || pg_temp.mt_ok('D02 exact retry returns the same message, no duplicate',
    split_part(v_r, '|', 1) = split_part(v_msg_a1, '|', 1)
    and (select count(*) from public.ride_messages where client_message_id = v_k_a1) = 1, v_r);

  v_r := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a1, v_k_a1, E'\n Hi, I''m at the gate   '));
  v_log := v_log || pg_temp.mt_ok('D03 retry differing only in outer whitespace is the same message',
    split_part(v_r, '|', 1) = split_part(v_msg_a1, '|', 1), v_r);

  v_r := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a1, v_k_a1, 'Something else entirely'));
  v_log := v_log || pg_temp.mt_ok('D04 reusing a client id with DIFFERENT text is refused, original kept',
    v_r like e_reused
    and (select body from public.ride_messages where sender_id = v_rider_a and client_message_id = v_k_a1)
        = 'Hi, I''m at the gate', v_r);

  v_r := pg_temp.mt_as(v_driver, format(c_send, v_conv_a1, v_k_d1, 'On my way'));
  v_log := v_log || pg_temp.mt_ok('D05 driver replies',
    split_part(v_r, '|', 2) = v_driver::text, v_r);

  v_r := pg_temp.mt_as(v_driver, format(c_send, v_conv_b1, v_k_d1, 'On my way'));
  v_log := v_log || pg_temp.mt_ok('D06 reusing a client id in ANOTHER conversation is refused',
    v_r like e_reused
    and not exists (select 1 from public.ride_messages where conversation_id = v_conv_b1), v_r);

  v_r  := pg_temp.mt_as(v_stranger, format(c_send, v_conv_a1, v_k_a1, 'Hi, I''m at the gate'));
  v_r2 := pg_temp.mt_as(v_rider_b,  format(c_send, v_conv_a1, v_k_a1, 'Hi, I''m at the gate'));
  v_log := v_log || pg_temp.mt_ok('D07 replaying someone else''s (conversation, client id, text) is refused',
    v_r like e_unavail and v_r2 like e_unavail, v_r || ' / ' || v_r2);

  v_r := pg_temp.mt_as(v_driver, format(c_send, v_conv_a1, v_k_a1, 'Hi, I''m at the gate'));
  v_log := v_log || pg_temp.mt_ok('D08 client ids are per sender: the driver using A''s id gets a NEW driver message, never A''s',
    split_part(v_r, '|', 2) = v_driver::text
    and split_part(v_r, '|', 1) <> split_part(v_msg_a1, '|', 1), v_r);

  v_r  := pg_temp.mt_as(v_rider_b,  format(c_send, v_conv_a1, gen_random_uuid(), 'Not my chat'));
  v_r2 := pg_temp.mt_as(v_stranger, format(c_send, v_conv_a1, gen_random_uuid(), 'Not my chat'));
  v_log := v_log || pg_temp.mt_ok('D09 another rider and a stranger cannot send into the chat',
    v_r like e_unavail and v_r2 like e_unavail, v_r || ' / ' || v_r2);

  v_r  := pg_temp.mt_as(v_pending, format(c_send, v_conv_a1, gen_random_uuid(), 'Pending'));
  v_r2 := pg_temp.mt_as(null,      format(c_send, v_conv_a1, gen_random_uuid(), 'Anon'));
  v_log := v_log || pg_temp.mt_ok('D10 pending rider refused; anon has no EXECUTE',
    v_r like e_unavail and v_r2 like e_denied, v_r || ' / ' || v_r2);

  v_r  := pg_temp.mt_as(v_driver, format(c_send, v_conv_a1, gen_random_uuid(), E'   \n\t  '));
  v_r2 := pg_temp.mt_as(v_driver, format(c_send, v_conv_a1, gen_random_uuid(), repeat('x', 1001)));
  v_log := v_log || pg_temp.mt_ok('D11 blank and 1001-character messages are refused',
    v_r like 'ERROR: Type a message first%' and v_r2 like 'ERROR: Messages can be at most 1000%',
    v_r || ' / ' || v_r2);

  v_r := pg_temp.mt_as(v_driver, format(c_send, v_conv_a1, gen_random_uuid(), repeat('y', 1000)));
  v_log := v_log || pg_temp.mt_ok('D12 a 1000-character message is accepted',
    split_part(v_r, '|', 2) = v_driver::text, v_r);

  -- ===================================================================
  -- E. No direct writes, no forged senders
  -- ===================================================================
  v_r := pg_temp.mt_as(v_rider_a, format(
    'insert into public.ride_messages (conversation_id, sender_id, client_message_id, body) values (%L, %L, %L, %L) returning id::text',
    v_conv_a1, v_rider_a, gen_random_uuid(), 'direct'));
  v_r2 := pg_temp.mt_as(v_rider_a, format(
    'insert into public.ride_messages (conversation_id, sender_id, client_message_id, body) values (%L, %L, %L, %L) returning id::text',
    v_conv_a1, v_driver, gen_random_uuid(), 'forged as driver'));
  v_log := v_log || pg_temp.mt_ok('E01 direct INSERT of a message (own or forged sender) is refused',
    v_r like e_denied and v_r2 like e_denied, v_r || ' / ' || v_r2);

  v_r := pg_temp.mt_as(v_stranger, format(
    'insert into public.ride_conversations (ride_id, driver_id, rider_id, ride_destination, ride_departure_at) values (%L, %L, %L, %L, now() + interval ''1 day'') returning id::text',
    v_ride1, v_driver, v_stranger, 'join'));
  v_log := v_log || pg_temp.mt_ok('E02 direct INSERT of a conversation (joining a ride) is refused',
    v_r like e_denied, v_r);

  v_r  := pg_temp.mt_as(v_rider_a, format(
    'update public.ride_messages set body = ''edited'' where conversation_id = %L returning id::text', v_conv_a1));
  v_r2 := pg_temp.mt_as(v_driver, format(
    'delete from public.ride_messages where conversation_id = %L returning id::text', v_conv_a1));
  v_log := v_log || pg_temp.mt_ok('E03 UPDATE and DELETE of messages are refused',
    v_r like e_denied and v_r2 like e_denied, v_r || ' / ' || v_r2);

  v_r  := pg_temp.mt_as(v_rider_a, format(
    'update public.ride_conversations set rider_id = %L where id = %L returning id::text', v_stranger, v_conv_a1));
  v_r2 := pg_temp.mt_as(v_driver, format(
    'delete from public.ride_conversations where id = %L returning id::text', v_conv_a1));
  v_log := v_log || pg_temp.mt_ok('E04 UPDATE and DELETE of conversations are refused',
    v_r like e_denied and v_r2 like e_denied, v_r || ' / ' || v_r2);

  -- Backstop trigger, with full database rights (grants don't apply).
  begin
    insert into public.ride_messages (conversation_id, sender_id, client_message_id, body)
    values (v_conv_a1, v_stranger, gen_random_uuid(), 'trigger test');
    v_r := 'inserted';
  exception when others then
    v_r := 'ERROR: ' || sqlerrm;
  end;
  v_log := v_log || pg_temp.mt_ok('E05 backstop trigger rejects a non-participant sender even for admins',
    v_r like 'ERROR: ride_messages: the sender is not part of this conversation%', v_r);

  -- ===================================================================
  -- F. Reads: participants only, in every execution context
  -- ===================================================================
  v_n := (select count(*) from public.ride_messages where conversation_id = v_conv_a1);

  v_r := pg_temp.mt_as(v_rider_a, 'select (select count(*) from public.ride_conversations)::text || ''|'' || (select count(*) from public.ride_messages)::text');
  v_log := v_log || pg_temp.mt_ok('F01 rider A sees exactly their 1 conversation and all its messages',
    v_r = '1|' || v_n::text, v_r);

  v_r := pg_temp.mt_as(v_rider_b, format(
    'select (select count(*) from public.ride_conversations)::text || ''|'' || (select count(*) from public.ride_messages where conversation_id = %L)::text || ''|'' || (select count(*) from public.list_my_ride_conversations(%L::uuid))::text',
    v_conv_a1, v_conv_a1));
  v_log := v_log || pg_temp.mt_ok('F02 rider B: only their own conversation; none of A''s messages, not even by id',
    v_r = '1|0|0', v_r);

  v_r := pg_temp.mt_as(v_stranger, 'select (select count(*) from public.ride_conversations)::text || ''|'' || (select count(*) from public.ride_messages)::text || ''|'' || (select count(*) from public.list_my_ride_conversations())::text')
      || ' ' || pg_temp.mt_as(v_pending, 'select (select count(*) from public.ride_conversations)::text || ''|'' || (select count(*) from public.ride_messages)::text')
      || ' ' || pg_temp.mt_as(v_denied,  'select (select count(*) from public.ride_conversations)::text || ''|'' || (select count(*) from public.ride_messages)::text');
  v_log := v_log || pg_temp.mt_ok('F03 stranger, pending and denied riders see nothing',
    v_r = '0|0|0 0|0 0|0', v_r);

  v_r := pg_temp.mt_as(v_driver, 'select (select count(*) from public.ride_conversations)::text || ''|'' || (select count(*) from public.ride_messages)::text');
  v_log := v_log || pg_temp.mt_ok('F04 driver sees both conversations and all their messages',
    v_r = '2|' || v_n::text, v_r);

  v_r := pg_temp.mt_as(null, 'select count(*)::text from public.ride_messages');
  v_log := v_log || pg_temp.mt_ok('F05 anon cannot read messages', v_r like e_denied, v_r);

  -- The context open_my_ride_conversation uses: owner rights (RLS NOT
  -- applied) with only the JWT claims set. The admin role here sees every
  -- row of the table, so anything list returns is limited by its own
  -- auth.uid() filter alone.
  v_log := v_log || pg_temp.mt_ok('F06a admin context really bypasses RLS (sees all test conversations)',
    (select count(*) from public.ride_conversations where driver_id = v_driver) = 2);

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  v_n := (select count(*) from public.list_my_ride_conversations());
  v_r := (select count(*) from public.list_my_ride_conversations(v_conv_a1))::text;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rider_a, 'role', 'authenticated')::text, true);
  v_r2 := (select count(*)::text || '|' || coalesce(bool_and(v_rider_a in (driver_id, rider_id)), true)::text
             from public.list_my_ride_conversations());
  perform set_config('request.jwt.claims', '', true);
  v_log := v_log || pg_temp.mt_ok('F06b without RLS, list still returns only the caller''s rows (stranger 0, A only A''s)',
    v_n = 0 and v_r = '0' and v_r2 = '1|true', v_n || ' / ' || v_r || ' / ' || v_r2);

  v_log := v_log || pg_temp.mt_ok('F06c without RLS and with no session, list returns nothing',
    auth.uid() is null and (select count(*) from public.list_my_ride_conversations()) = 0);

  -- ===================================================================
  -- G. Rider leaves their seat -> read-only for both, retries preserved
  -- ===================================================================
  v_msg_b1 := pg_temp.mt_as(v_rider_b, format(c_send, v_conv_b1, v_k_b1, 'See you at 8'));
  v_log := v_log || pg_temp.mt_ok('G01 rider B sends before leaving',
    split_part(v_msg_b1, '|', 2) = v_rider_b::text, v_msg_b1);

  -- The app's real Leave Seat path (existing RLS policy), as rider B.
  v_r := pg_temp.mt_as(v_rider_b, format(
    'update public.ride_requests set status = ''cancelled'' where id = %L and status = ''accepted'' returning id::text', v_req_b1));
  v_log := v_log || pg_temp.mt_ok('G02 rider B leaves the seat through the existing policy',
    v_r = v_req_b1::text, v_r);

  v_r  := pg_temp.mt_as(v_rider_b, format(c_send, v_conv_b1, gen_random_uuid(), 'After leaving'));
  v_r2 := pg_temp.mt_as(v_driver,  format(c_send, v_conv_b1, gen_random_uuid(), 'After leaving'));
  v_log := v_log || pg_temp.mt_ok('G03 neither side can send after the seat is cancelled',
    v_r like 'ERROR: This seat is no longer confirmed%' and v_r2 like 'ERROR: This seat is no longer confirmed%',
    v_r || ' / ' || v_r2);

  v_r := pg_temp.mt_as(v_rider_b, format(c_list_one, v_conv_b1));
  v_r2 := pg_temp.mt_as(v_rider_b, format('select count(*)::text from public.ride_messages where conversation_id = %L', v_conv_b1));
  v_log := v_log || pg_temp.mt_ok('G04 chat shows seat_cancelled / read-only; history still readable',
    split_part(v_r, '|', 1) = 'seat_cancelled' and split_part(v_r, '|', 2) = 'false' and v_r2 = '1',
    v_r || ' / ' || v_r2);

  v_r := pg_temp.mt_as(v_rider_b, format(c_send, v_conv_b1, v_k_b1, 'See you at 8'));
  v_log := v_log || pg_temp.mt_ok('G05 a valid retry of an already-saved message still succeeds after the seat is cancelled',
    split_part(v_r, '|', 1) = split_part(v_msg_b1, '|', 1), v_r);

  v_r := pg_temp.mt_as(v_rider_b, format(c_send, v_conv_b1, v_k_b1, 'Changed after leaving'));
  v_log := v_log || pg_temp.mt_ok('G06 a changed-text "retry" after the seat is cancelled is refused',
    v_r like e_reused, v_r);

  v_r := pg_temp.mt_as(v_rider_b, format(c_open, v_ride1, null));
  v_log := v_log || pg_temp.mt_ok('G07 reopening the archived chat works and stays read-only',
    split_part(v_r, '|', 1) = v_conv_b1::text and split_part(v_r, '|', 2) = 'seat_cancelled'
    and split_part(v_r, '|', 3) = 'false', v_r);

  -- ===================================================================
  -- H. Driver cancels (deletes) the ride -> history kept, read-only
  -- ===================================================================
  v_r := pg_temp.mt_as(v_rider_a, format(c_open, v_ride2, null));
  v_log := v_log || pg_temp.mt_ok('H01 rider A opens a chat on ride 2',
    pg_temp.mt_uuid(split_part(v_r, '|', 1)) is not null and split_part(v_r, '|', 2) = 'open', v_r);
  v_conv_a2 := pg_temp.mt_uuid(split_part(v_r, '|', 1));

  v_msg_a2 := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a2, v_k_a2, 'Ride 2 question'));
  v_log := v_log || pg_temp.mt_ok('H02 rider A sends on ride 2',
    split_part(v_msg_a2, '|', 2) = v_rider_a::text, v_msg_a2);

  -- The app's real Cancel Ride path (existing RLS policy), as the driver.
  v_r := pg_temp.mt_as(v_driver, format('delete from public.rides where id = %L returning id::text', v_ride2));
  v_log := v_log || pg_temp.mt_ok('H03 driver cancels ride 2 through the existing policy',
    v_r = v_ride2::text, v_r);

  v_log := v_log || pg_temp.mt_ok('H04 conversation and message survive; ride_id and request_id are NULL',
    exists (select 1 from public.ride_conversations
             where id = v_conv_a2 and ride_id is null and request_id is null
               and ride_destination = 'ZZ messaging test ride 2')
    and not exists (select 1 from public.ride_requests where id = v_req_a2)
    and (select count(*) from public.ride_messages where conversation_id = v_conv_a2) = 1);

  v_r := pg_temp.mt_as(v_rider_a, format(c_list_one, v_conv_a2));
  v_log := v_log || pg_temp.mt_ok('H05 chat shows ride_cancelled / read-only with the cached destination',
    v_r = 'ride_cancelled|false|ZZ messaging test ride 2|no-ride', v_r);

  v_r  := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a2, gen_random_uuid(), 'After cancel'));
  v_r2 := pg_temp.mt_as(v_driver,  format(c_send, v_conv_a2, gen_random_uuid(), 'After cancel'));
  v_log := v_log || pg_temp.mt_ok('H06 neither side can send after the ride is cancelled',
    v_r like 'ERROR: This ride was cancelled%' and v_r2 like 'ERROR: This ride was cancelled%',
    v_r || ' / ' || v_r2);

  v_r  := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a2, v_k_a2, 'Ride 2 question'));
  v_r2 := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a2, v_k_a2, 'Ride 2 question, edited'));
  v_log := v_log || pg_temp.mt_ok('H07 after the ride is cancelled: valid retry returns the saved message; changed text is refused',
    split_part(v_r, '|', 1) = split_part(v_msg_a2, '|', 1) and v_r2 like e_reused, v_r || ' / ' || v_r2);

  v_r  := pg_temp.mt_as(v_rider_a, format('select count(*)::text from public.ride_messages where conversation_id = %L', v_conv_a2));
  v_r2 := pg_temp.mt_as(v_driver,  format('select count(*)::text from public.ride_messages where conversation_id = %L', v_conv_a2));
  v_log := v_log || pg_temp.mt_ok('H08 both participants can still read the archived history',
    v_r = '1' and v_r2 = '1', v_r || ' / ' || v_r2);

  v_r := pg_temp.mt_as(v_rider_a, format(c_open, v_ride2, null));
  v_log := v_log || pg_temp.mt_ok('H09 opening by the deleted ride id is refused (archived chats reopen by conversation id)',
    v_r like e_unavail, v_r);

  -- ===================================================================
  -- J. Rate limit (last: it uses up rider A's allowance). Inside one
  --    statement now() doesn't move, so every message sent in this run
  --    counts as "within the last minute".
  -- ===================================================================
  v_existing := (select count(*) from public.ride_messages where sender_id = v_rider_a);
  for i in 1..25 loop
    v_r := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a1, gen_random_uuid(), 'Burst ' || i));
    exit when v_r like 'ERROR:%';
    v_sent := v_sent + 1;
  end loop;
  v_log := v_log || pg_temp.mt_ok('J01 the 21st message within a minute is refused',
    v_existing + v_sent = 20 and v_r like 'ERROR: You''re sending messages too quickly%',
    format('existing=%s sent=%s last=%s', v_existing, v_sent, v_r));

  v_r := pg_temp.mt_as(v_rider_a, format(c_send, v_conv_a1, v_k_a1, 'Hi, I''m at the gate'));
  v_log := v_log || pg_temp.mt_ok('J02 a valid retry of an already-saved message still succeeds while rate-limited',
    split_part(v_r, '|', 1) = split_part(v_msg_a1, '|', 1), v_r);

  v_log := v_log || pg_temp.mt_ok('Z04 still the admin role with no user at the end',
    current_user::text = v_admin and auth.uid() is null);

  -- ===================================================================
  -- Done: report, and roll the whole statement back.
  -- ===================================================================
  raise exception E'MESSAGING VERIFY PASSED (% checks). This error is intentional: it rolls back every test row, so nothing was saved.%',
    (length(v_log) - length(replace(v_log, 'PASS  ', ''))) / length('PASS  '),
    v_log;
end
$verify$;


-- =====================================================================
-- APPENDIX — DISPOSABLE ENVIRONMENT ONLY (Supabase branch / local stack)
-- =====================================================================
-- Everything below is commented out and must NEVER be run on production.
-- These tests need committed test data, two live sessions, or a ride in
-- the past, which the script above deliberately avoids.
--
-- Setup in the disposable project: apply messaging-1, sign up a driver and
-- two riders in the app, post a ride, request it with both riders, accept
-- both. Note the ride id, request ids, user ids and conversation ids.
-- To act as a user in psql (or two SQL Editor tabs):
--   begin;
--   select set_config('request.jwt.claims', '{"sub":"<user-id>","role":"authenticated"}', true);
--   set local role authenticated;
--
-- X1. Expired ride, end to end (2-hour grace)
--   -- as postgres, disposable env only: move the ride into the past
--   -- without touching any other trigger
--   alter table public.rides disable trigger rides_departure_in_future;
--   update public.rides set departure_at = now() - interval '1 hour 59 minutes' where id = '<ride>';
--   alter table public.rides enable trigger rides_departure_in_future;
--   -> app / send_my_ride_message: still open (inside grace)
--   (repeat with now() - interval '2 hours 1 minute')
--   -> chat shows read-only "This ride has ended"; send refused;
--      open_my_ride_conversation refuses to START a new chat for a rider
--      who never opened one, but reopens an existing one read-only.
--
-- X2. Cancel Ride vs. send (expect: no deadlock, consistent result)
--   S1 (rider):  begin; <act as rider>; select * from public.send_my_ride_message('<conv>', gen_random_uuid(), 'race 1');
--   S2 (driver): begin; <act as driver>; delete from public.rides where id = '<ride>';   -- BLOCKS
--   S1: commit;   -> S2 unblocks and deletes; S2: commit;
--   -> message saved, conversation archived (ride_cancelled).
--   Reverse order: S2 deletes first (no commit), S1 send BLOCKS, S2 commit
--   -> S1 returns "This ride was cancelled ...".
--
-- X3. Leave Seat vs. send (S2 = the rider)
--   a) send first:
--      S1 (rider): begin; <act as rider>; select * from public.send_my_ride_message('<conv>', gen_random_uuid(), 'race 3');
--      S2 (rider): begin; <act as rider>;
--          update public.ride_requests set status = 'cancelled' where id = '<request>';   -- BLOCKS
--      S1: commit; -> S2 unblocks; S2: commit;
--      -> message saved, then the chat becomes read-only (seat_cancelled).
--   b) Leave Seat first:
--      S2: begin; <act as rider>; update ... set status = 'cancelled' ...;   (no commit)
--      S1: send -> fails IMMEDIATELY (no waiting) with SQLSTATE 55P03,
--          "This message couldn't be sent yet. Please try again."
--      S2: commit; S1: rollback; S1 retries with the SAME client id
--      -> "This seat is no longer confirmed ...". No message row exists.
--
-- X4. Simultaneous open (new conversation)
--   S1 (rider):  begin; <act as rider>;  select * from public.open_my_ride_conversation('<ride2>');
--   S2 (driver): begin; <act as driver>; select * from public.open_my_ride_conversation('<ride2>', '<rider>');  -- BLOCKS
--   S1: commit;  -> S2 returns the SAME conversation_id; S2: commit;
--   -> exactly one ride_conversations row for (ride2, rider).
--   (S2 must block on the unique index, NOT fail with 55P03: the two
--   FOR SHARE locks on the request are compatible.)
--
-- X5. Same user, two devices, at the rate limit
--   Send 19 messages; then S1: begin; send #20 (no commit); S2: send #21 -> BLOCKS
--   on the advisory lock; S1 commit -> S2 returns "sending messages too quickly".
--
-- X6. Accept vs. open — the deadlock window (opposite lock order)
--   accept_ride_request locks the request, then the ride. Calling it
--   whole in S1 can't reproduce the window (S1 already holds both locks,
--   so S2 just waits), so S1 takes the same two locks by hand, as postgres,
--   in accept's order. Needs psql (the SQL Editor can't hold a transaction
--   open between statements). Use a PENDING request on a future ride.
--   S1 (postgres): begin;
--       select 1 from public.ride_requests where id = '<pending request>' for update;
--   S2 (that rider): begin; <act as rider>;
--       select * from public.open_my_ride_conversation('<ride>');
--   -> EXPECT: S2 fails at once with SQLSTATE 55P03 "This ride is being
--      updated. Please try again in a moment." S2: rollback.
--   S1: select 1 from public.rides where id = '<ride>' for update;  -> returns at once
--   S1: rollback;
--   Repeat with S2 = the driver: open_my_ride_conversation('<ride>', '<rider>').
--   Repeat with S2 = send on an existing conversation and S1 locking THAT
--   conversation's (accepted) request: send fails at once with 55P03.
--   FAIL if S2 blocks, or if either session reports "deadlock detected".
--   (Before the NOWAIT change, this sequence deadlocked: S2 held the ride
--   FOR KEY SHARE and waited for the request; S1 waited for the ride.)
--
-- X7. Accept (real function) vs. open, other order
--   S2 (rider): begin; <act as rider>; select * from public.open_my_ride_conversation('<ride>');
--       (on an already-accepted request, so the call succeeds; no commit)
--   S1 (driver): select public.accept_my_ride_request('<OTHER pending request on the same ride>');
--       -> BLOCKS on the ride row (FOR UPDATE vs. S2's FOR KEY SHARE)
--   S2: commit; -> S1 completes normally.
--   FAIL on "deadlock detected" or if S1 errors for any reason other than
--   its own normal checks (full, no longer pending).
--
-- X8. Repeated Accept of an already-accepted request vs. send
--   Always relevant: the live accept_ride_request (reviewed 2026-11-08,
--   Phase 0 P5) locks the request FOR UPDATE, then the ride FOR UPDATE,
--   and checks the status only after taking both locks. So a repeated
--   Accept takes the opposite lock order to messaging before it refuses.
--   S2 (rider): begin; <act as rider>; select * from public.send_my_ride_message('<conv>', gen_random_uuid(), 'race 8');
--       (S2 now holds the ride FOR KEY SHARE and the request FOR SHARE)
--   S1 (driver): select public.accept_my_ride_request('<that same request>');
--   -> S1 BLOCKS on the request row first: its FOR UPDATE conflicts with
--      S2's FOR SHARE. It never reaches the ride lock while S2 is open.
--   S2: commit; -> S1 gets the request, then the ride, sees the request is
--      already accepted, and fails with its "no longer pending" error.
--      Nothing is changed.
--   FAIL on "deadlock detected", or if S1 accepts the request a second time.
--
-- X9. last_message_at never moves backwards (GREATEST)
--   created_at = now() = the transaction's START time, so start S1 first
--   but let it send last:
--   S1 (rider):  begin; <act as rider>;          (S1's now() is fixed here: t1)
--   S2 (driver): begin; <act as driver>;
--                select * from public.send_my_ride_message('<conv>', gen_random_uuid(), 'newer');  (created_at t2 > t1)
--                commit;
--   S1:          select * from public.send_my_ride_message('<conv>', gen_random_uuid(), 'older');  (created_at t1)
--                commit;
--   select last_message_at = (select max(created_at) from public.ride_messages where conversation_id = '<conv>')
--   from public.ride_conversations where id = '<conv>';   -> true (= t2)
--   (Without GREATEST it would be t1: the value would have moved backwards.)
--
-- If any of X2–X9 behaves differently from what is written here, stop
-- and report it before Phase 2. Passing these recipes is evidence, not
-- proof, that no deadlock is possible.
-- =====================================================================
