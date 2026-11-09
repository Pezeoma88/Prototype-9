-- =====================================================================
-- CarpoolBoard Prototype 9 — Private Messaging, Phase 0 evidence
-- (READ-ONLY; run BEFORE messaging-1-tables.sql)
-- =====================================================================
--
-- Six plain SELECT statements. No DDL, no DML, no DO blocks, no
-- transaction or session changes, no policy or grant changes, and no
-- function that writes anything. They read only the system catalog
-- (pg_catalog / information_schema) and return structure and function
-- source code, never user rows or personal data.
--
-- Run them ONE AT A TIME in the SQL Editor (it shows only the last
-- result), as the default "postgres" role, and send back each result
-- labelled P1 ... P6. For P4 and P5, please copy the FULL text of the
-- function_definition cells (or use "Export CSV"): a truncated
-- definition can't be reviewed.
--
--   P1  = messaging-0 M3, unchanged: every foreign key into / out of the
--         board tables and its ON DELETE / ON UPDATE rule
--   P2  = the exact cascade walk that messaging-2-verify.sql section 0a
--         does, with the path it took and whether 0a expects each table
--   P3  = every trigger that verify section 0b looks at, with whether 0b
--         allows it, row/statement level, and enabled/disabled
--   P4  = the three triggers verify section 0c pins: trigger text, whether
--         it matches 0c, function attributes, md5 and FULL source
--   P5  = auth-0 B5 (accept_ride_request source) extended with attributes
--         and md5, plus the live accept_my_ride_request for comparison
--   P6  = unique indexes on profiles (decides whether an accept that
--         updates profiles could conflict with messaging's locks)
-- =====================================================================


-- P1. (= messaging-0-inspect.sql M3, copied unchanged)
--     Every foreign key INTO or OUT OF the board tables, with its
--     ON DELETE / ON UPDATE rule. Shows what deleting a ride or a
--     profile cascades to.
select conrelid::regclass  as child_table,
       conname,
       confrelid::regclass as parent_table,
       pg_get_constraintdef(oid) as definition,
       case confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                        when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                        when 'd' then 'SET DEFAULT' end as on_delete,
       case confupdtype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                        when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                        when 'd' then 'SET DEFAULT' end as on_update
from pg_constraint
where contype = 'f'
  and (confrelid in (to_regclass('public.profiles'), to_regclass('public.rides'),
                     to_regclass('public.ride_requests'), to_regclass('public.driver_reviews'))
       or conrelid in (to_regclass('public.profiles'), to_regclass('public.rides'),
                       to_regclass('public.ride_requests'), to_regclass('public.driver_reviews')))
order by 3, 1, 2;



-- P2. Cascade reach, exactly as verify section 0a computes it: start at
--     rides, ride_requests and ride_conversations (the last one doesn't
--     exist yet before messaging-1, so it is skipped), and follow every
--     foreign key whose ON DELETE or ON UPDATE rule writes to the child
--     (CASCADE, SET NULL, SET DEFAULT). One row per path step; rows with
--     expected_by_verify_0a = false are listed FIRST.
select n.nspname || '.' || c.relname as reached_table,
       case when r.parent is null then '(starting table)'
            else r.parent::regclass::text end as reached_from,
       r.conname as foreign_key,
       case r.deltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                      when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                      when 'd' then 'SET DEFAULT' end as on_delete,
       case r.updtype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                      when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                      when 'd' then 'SET DEFAULT' end as on_update,
       (n.nspname, c.relname) in (('public', 'rides'), ('public', 'ride_requests'),
                                  ('public', 'ride_conversations'), ('public', 'ride_messages'),
                                  ('public', 'driver_reviews')) as expected_by_verify_0a
from (
  with recursive reach(rel, parent, conname, deltype, updtype, visited) as (
    select s.rel, null::oid, null::name, null::"char", null::"char", array[s.rel]
    from (select to_regclass(x)::oid as rel
          from unnest(array['public.rides', 'public.ride_requests',
                            'public.ride_conversations']) as x) s
    where s.rel is not null
    union all
    select con.conrelid, con.confrelid, con.conname, con.confdeltype, con.confupdtype,
           w.visited || con.conrelid
    from reach w
    join pg_constraint con on con.confrelid = w.rel
    where con.contype = 'f'
      and (con.confdeltype in ('c', 'n', 'd') or con.confupdtype in ('c', 'n', 'd'))
      and con.conrelid <> all (w.visited)   -- never loop on a cycle
  )
  select * from reach
) r
join pg_class c on c.oid = r.rel
join pg_namespace n on n.oid = c.relnamespace
order by expected_by_verify_0a, reached_table, reached_from;



-- P3. Every non-internal trigger that verify section 0b checks: on the
--     six tables the run writes directly, plus every table P2 reaches.
--     Rows with allowed_by_verify_0b = false are listed FIRST; any such
--     row would stop the verify run.
with recursive reach(rel) as (
  select to_regclass(x)::oid
  from unnest(array['public.rides', 'public.ride_requests',
                    'public.ride_conversations']) as x
  where to_regclass(x) is not null
  union
  select con.conrelid
  from pg_constraint con
  join reach on con.confrelid = reach.rel
  where con.contype = 'f'
    and (con.confdeltype in ('c', 'n', 'd') or con.confupdtype in ('c', 'n', 'd'))
)
select n.nspname || '.' || c.relname as table_name,
       t.tgname as trigger_name,
       (n.nspname, c.relname, t.tgname) in (
         ('auth',   'users',         'on_auth_user_created_profile'),
         ('public', 'rides',         'rides_departure_in_future'),
         ('public', 'ride_requests', 'ride_requests_no_self_request'),
         ('public', 'ride_messages', 'ride_messages_check_participant')) as allowed_by_verify_0b,
       case when (t.tgtype::int & 1) = 1 then 'ROW' else 'STATEMENT' end as level,
       case t.tgenabled when 'O' then 'enabled' when 'D' then 'DISABLED'
                        when 'R' then 'replica only' when 'A' then 'always' end as enabled,
       t.tgfoid::regprocedure::text as function,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and (t.tgrelid in (select rel from reach)
       or (n.nspname, c.relname) in (('auth', 'users'), ('public', 'profiles'), ('public', 'rides'),
                                     ('public', 'ride_requests'), ('public', 'ride_conversations'),
                                     ('public', 'ride_messages')))
order by allowed_by_verify_0b, table_name, trigger_name;



-- P4. The three triggers pinned in verify section 0c. Always 3 rows; a
--     row with NULL trigger_definition means that trigger is MISSING.
--     trigger_text_matches_0c and md5_matches_pin use the same expected
--     values as the verify script. All three functions are pinned (the
--     two auth-1 functions since the 2026-11-08 review); if a pinned
--     function changes, md5_matches_pin turns false and the pin must be
--     reviewed again. function_md5 is computed exactly as 0c does:
--     md5(pg_get_functiondef(trigger function)).
select w.sch || '.' || w.tbl as table_name,
       w.trg as trigger_name,
       pg_get_triggerdef(t.oid) as trigger_definition,
       pg_get_triggerdef(t.oid) = any (w.expected_defs) as trigger_text_matches_0c,
       p.oid::regprocedure::text as function,
       l.lanname as language,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       pg_get_userbyid(p.proowner) as owner,
       case t.tgenabled when 'O' then 'enabled' when 'D' then 'DISABLED'
                        when 'R' then 'replica only' when 'A' then 'always' end as enabled,
       md5(pg_get_functiondef(t.tgfoid)) as function_md5,
       w.pinned_md5,
       md5(pg_get_functiondef(t.tgfoid)) = w.pinned_md5 as md5_matches_pin,
       pg_get_functiondef(t.tgfoid) as function_definition
from (values
  ('auth', 'users', 'on_auth_user_created_profile',
   array['CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user()',
         'CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()'],
   '9d71fed32a397361cce7cb58e07c3130'::text),
  ('public', 'rides', 'rides_departure_in_future',
   array['CREATE TRIGGER rides_departure_in_future BEFORE INSERT OR UPDATE OF departure_at ON public.rides FOR EACH ROW EXECUTE FUNCTION prevent_past_departure()',
         'CREATE TRIGGER rides_departure_in_future BEFORE INSERT OR UPDATE OF departure_at ON public.rides FOR EACH ROW EXECUTE FUNCTION public.prevent_past_departure()'],
   '7fe830bc9deff204074c903ece478233'::text),
  ('public', 'ride_requests', 'ride_requests_no_self_request',
   array['CREATE TRIGGER ride_requests_no_self_request BEFORE INSERT OR UPDATE ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION prevent_self_request()',
         'CREATE TRIGGER ride_requests_no_self_request BEFORE INSERT OR UPDATE ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION public.prevent_self_request()'],
   '7c12243683a96cc100ceaf60e19a85bd')
) as w(sch, tbl, trg, expected_defs, pinned_md5)
left join pg_namespace n on n.nspname = w.sch
left join pg_class c on c.relnamespace = n.oid and c.relname = w.tbl
left join pg_trigger t on t.tgrelid = c.oid and t.tgname = w.trg and not t.tgisinternal
left join pg_proc p on p.oid = t.tgfoid
left join pg_language l on l.oid = p.prolang
order by table_name, trigger_name;



-- P5. (= auth-0-inspect.sql B5, extended) The live source of
--     accept_ride_request (dashboard-created, NOT in the repo) and of
--     accept_my_ride_request (in auth-1-accounts.sql, shown here to check
--     the live copy matches). One row per function and overload.
select p.oid::regprocedure::text as function,
       l.lanname as language,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       pg_get_userbyid(p.proowner) as owner,
       md5(pg_get_functiondef(p.oid)) as function_md5,
       pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_language l on l.oid = p.prolang
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('accept_ride_request', 'accept_my_ride_request')
order by p.proname, function;



-- P6. Unique indexes on profiles. An UPDATE that changes a column in one
--     of these (non-partial, non-expression) takes FOR UPDATE on the row,
--     which conflicts with the FOR KEY SHARE that messaging's inserts take
--     on profiles through their foreign keys. Only matters if P5 shows
--     accept_ride_request updating profiles.
select i.indexrelid::regclass::text as index_name,
       i.indisprimary as is_primary_key,
       i.indpred is not null as is_partial,
       i.indexprs is not null as has_expressions,
       pg_get_indexdef(i.indexrelid) as definition
from pg_index i
where i.indrelid = to_regclass('public.profiles')
  and i.indisunique
order by index_name;
