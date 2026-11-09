-- =====================================================================
-- CarpoolBoard Prototype 9 — Private Driver/Rider Messaging,
-- step 0: inspect (READ-ONLY)
-- =====================================================================
--
-- Every query here is a single SELECT. Nothing is created, changed or
-- deleted, no function with side effects is called, and no personal data
-- (names, emails, message text) is returned — only structure and counts.
--
-- Run them ONE AT A TIME in the SQL Editor (it only shows the last
-- result of a run) and send back the output of each, labelled M0, M1, ...
--
-- What they answer before the messaging migration is written:
--   M0        one-row summary: the quick go / no-go
--   M1-M4     columns, constraints, foreign keys (ON DELETE) and indexes
--             of profiles, rides, ride_requests, driver_reviews
--   M5-M6     request status values and data-integrity counts
--   M7-M9     RLS on/off, every policy, table and column privileges
--   M10-M11   existing functions (SECURITY DEFINER, search_path, grants)
--             and triggers on the board tables
--   M12       UUID-generation functions and extensions
--   M13       name conflicts with the proposed tables / RPCs / policies
--   M14       can conversations survive a ride cancellation?
--   M15       Realtime publication (information only; not used in MVP)
--   M16       server clock / time zone (for the 2-hour grace period)
--
-- Proposed names checked for conflicts (Phase 1, NOT created here):
--   tables     public.ride_conversations, public.ride_messages
--   functions  public.open_my_ride_conversation,
--              public.send_my_ride_message,
--              public.list_my_ride_conversations,
--              public.ride_conversation_state
--   policies   "messaging: %"
-- =====================================================================


-- M0. One-row summary. If any table_* column is false, stop and send it.
select
  to_regclass('public.profiles')       is not null as table_profiles,
  to_regclass('public.rides')          is not null as table_rides,
  to_regclass('public.ride_requests')  is not null as table_ride_requests,
  to_regclass('public.driver_reviews') is not null as table_driver_reviews,
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'rides'
      and column_name = 'id')                                   as rides_id_type,
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'ride_requests'
      and column_name = 'id')                                   as ride_requests_id_type,
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'id')                                   as profiles_id_type,
  (select case c.confdeltype
            when 'c' then 'CASCADE' when 'n' then 'SET NULL'
            when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
            when 'd' then 'SET DEFAULT' end
     from pg_constraint c
    where c.contype = 'f'
      and c.conrelid = to_regclass('public.ride_requests')
      and c.confrelid = to_regclass('public.rides')
    limit 1)                                                    as ride_requests_to_rides_on_delete,
  exists (select 1 from pg_proc
           where proname = 'gen_random_uuid')                   as gen_random_uuid_available,
  exists (select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'auth' and p.proname = 'uid')      as auth_uid_available,
  exists (select 1 from pg_proc
           where pronamespace = 'public'::regnamespace
             and proname = 'accept_my_ride_request')            as accept_my_ride_request_present,
  exists (select 1 from pg_policies
           where schemaname = 'public' and policyname like 'auth: %') as auth2_lockdown_applied,
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ride_conversations', 'ride_messages'))  as conflicting_tables,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('open_my_ride_conversation', 'send_my_ride_message',
                      'list_my_ride_conversations', 'ride_conversation_state'))
                                                                as conflicting_functions,
  (select count(*) from public.ride_requests
    where status = 'accepted')                                  as accepted_requests,
  version()                                                     as postgres_version;



-- M1. Columns of the board tables (type, NULL allowed, default).
select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
order by table_name, ordinal_position;



-- M2. Every constraint on those tables (primary key, unique, check,
--     foreign key) with its full definition.
select conrelid::regclass as table_name,
       conname,
       case contype when 'p' then 'PRIMARY KEY' when 'u' then 'UNIQUE'
                    when 'c' then 'CHECK' when 'f' then 'FOREIGN KEY'
                    when 'x' then 'EXCLUDE' else contype::text end as kind,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (to_regclass('public.profiles'), to_regclass('public.rides'),
                   to_regclass('public.ride_requests'), to_regclass('public.driver_reviews'))
order by conrelid::regclass::text, contype, conname;



-- M3. Every foreign key INTO or OUT OF the board tables, with its
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



-- M4. Indexes on the board tables (the unique (ride_id, rider_id) rule
--     the conversation lookup relies on should appear here).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
order by tablename, indexname;



-- M5. ride_requests.status: the values actually stored (counts only),
--     plus the allowed values if status is an enum type.
select 'stored value' as source, status::text as value, count(*) as rows
from public.ride_requests
group by status
union all
select 'enum label', e.enumlabel, null
from information_schema.columns c
join pg_type t on t.typname = c.udt_name
join pg_enum e on e.enumtypid = t.oid
where c.table_schema = 'public' and c.table_name = 'ride_requests'
  and c.column_name = 'status'
order by source, value;



-- M6. Data-integrity counts the messaging rules depend on. Every
--     "should_be_0" column should be 0; the others are information.
select
  (select count(*) from public.ride_requests q
    where not exists (select 1 from public.rides r where r.id = q.ride_id))
                                                         as requests_without_ride_should_be_0,
  (select count(*) from public.ride_requests q
     join public.rides r on r.id = q.ride_id
    where q.rider_id = r.driver_id)                      as self_requests_should_be_0,
  (select count(*) from (select ride_id, rider_id from public.ride_requests
                          group by ride_id, rider_id having count(*) > 1) d)
                                                         as duplicate_ride_rider_should_be_0,
  (select count(*) from public.rides
    where departure_at is null)                          as rides_without_departure_should_be_0,
  (select count(*) from public.rides
    where driver_id is null)                             as rides_without_driver_should_be_0,
  (select count(*) from public.ride_requests q
     join public.rides r on r.id = q.ride_id
    where q.status = 'accepted'
      and r.departure_at + interval '2 hours' > now())   as accepted_chat_would_be_open,
  (select count(*) from public.ride_requests q
     join public.rides r on r.id = q.ride_id
    where q.status = 'accepted'
      and r.departure_at + interval '2 hours' <= now())  as accepted_chat_would_be_read_only,
  (select count(*) from public.rides)                    as rides_total,
  (select count(*) from public.ride_requests)            as requests_total;



-- M7. Row Level Security on/off (and forced) for every public table.
select c.relname as table_name,
       c.relrowsecurity      as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
order by c.relname;



-- M8. Every RLS policy on the board tables (the messaging policies will
--     join against rides / ride_requests, so these must be known).
select tablename, policyname, permissive, roles, cmd,
       qual       as using_expression,
       with_check as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
order by tablename, cmd, policyname;



-- M9. What anon / authenticated / PUBLIC may do: table-level grants,
--     then column-level grants (profiles and ride_requests use them).
select 'table' as level, table_name, null::text as column_name,
       grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles', 'rides', 'ride_requests', 'driver_reviews',
                     'driver_rating_summary')
  and grantee in ('anon', 'authenticated', 'PUBLIC')
group by table_name, grantee
union all
select 'column', table_name, column_name,
       grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'ride_requests')
  and grantee in ('anon', 'authenticated', 'PUBLIC')
group by table_name, column_name, grantee
order by level desc, table_name, column_name nulls first, grantee;



-- M10. Every function in the public schema: arguments, SECURITY
--      DEFINER, search_path setting, and who may execute it.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid)             as returns,
       p.prosecdef                               as security_definer,
       p.proconfig                               as settings,
       has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by p.proname, arguments;



-- M11. Triggers on the board tables (a trigger on rides DELETE could
--      affect how a cancelled ride's conversation behaves).
select event_object_table as table_name, trigger_name,
       action_timing, string_agg(event_manipulation, ', ') as events,
       action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('profiles', 'rides', 'ride_requests', 'driver_reviews')
group by event_object_table, trigger_name, action_timing, action_statement
order by table_name, trigger_name;



-- M12. UUID generation: where gen_random_uuid / uuid_generate_v4 live,
--      and which extensions are installed.
select 'function' as kind, n.nspname as schema, p.proname as name,
       null::text as version
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('gen_random_uuid', 'uuid_generate_v4')
union all
select 'extension', n.nspname, e.extname, e.extversion
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname in ('pgcrypto', 'uuid-ossp')
order by kind, name, schema;



-- M13. Name conflicts: anything in any non-system schema whose name
--      matches or resembles the proposed messaging objects. An empty
--      result means the proposed names are free.
select 'relation' as kind, n.nspname as schema, c.relname as name,
       c.relkind::text as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and (c.relname in ('ride_conversations', 'ride_messages')
       or (n.nspname = 'public'
           and (c.relname ilike '%conversation%' or c.relname ilike '%message%'
                or c.relname ilike '%chat%')))
union all
select 'function', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname in ('open_my_ride_conversation', 'send_my_ride_message',
                     'list_my_ride_conversations', 'ride_conversation_state')
       or p.proname ilike '%conversation%' or p.proname ilike '%message%'
       or p.proname ilike '%chat%')
union all
select 'type', n.nspname, t.typname, null
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typtype in ('e', 'd', 'c')
  and (t.typname ilike '%conversation%' or t.typname ilike '%message%')
union all
select 'policy', schemaname, policyname, tablename
from pg_policies
where policyname ilike 'messaging:%'
order by kind, schema, name;



-- M14. Ride cancellation compatibility. The app cancels a ride by
--      DELETING its rides row. The proposed conversations reference
--      rides / ride_requests with ON DELETE SET NULL so the chat history
--      survives as read-only. This checks the pieces that plan relies on.
select
  (select string_agg(conrelid::regclass::text || ' -> ' ||
            case confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                             when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                             when 'd' then 'SET DEFAULT' end, '; ')
     from pg_constraint
    where contype = 'f' and confrelid = to_regclass('public.rides'))
                                                       as fks_into_rides_on_delete,
  (select string_agg(conrelid::regclass::text || ' -> ' ||
            case confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                             when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
                             when 'd' then 'SET DEFAULT' end, '; ')
     from pg_constraint
    where contype = 'f' and confrelid = to_regclass('public.ride_requests'))
                                                       as fks_into_ride_requests_on_delete,
  (select count(*) from information_schema.triggers
    where event_object_schema = 'public'
      and event_object_table in ('rides', 'ride_requests')
      and event_manipulation = 'DELETE')               as delete_triggers_on_rides_or_requests,
  (select string_agg(column_name, ', ') from information_schema.columns
    where table_schema = 'public' and table_name = 'rides'
      and (column_name ilike '%status%' or column_name ilike '%cancel%'
           or column_name ilike '%deleted%'))          as rides_status_like_columns,
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'rides'
             and cmd = 'DELETE')                       as rides_delete_policy_exists,
  exists (select 1 from pg_constraint
           where contype in ('p', 'u')
             and conrelid = to_regclass('public.rides')
             and pg_get_constraintdef(oid) ilike '%(id)%') as rides_id_is_referenceable,
  exists (select 1 from pg_constraint
           where contype in ('p', 'u')
             and conrelid = to_regclass('public.ride_requests')
             and pg_get_constraintdef(oid) ilike '%(id)%') as ride_requests_id_is_referenceable,
  exists (select 1 from pg_constraint
           where contype in ('p', 'u')
             and conrelid = to_regclass('public.profiles')
             and pg_get_constraintdef(oid) ilike '%(id)%') as profiles_id_is_referenceable;



-- M15. Realtime (information only; the MVP uses refresh/polling and
--      does NOT add tables to any publication).
select p.pubname, p.puballtables,
       (select string_agg(schemaname || '.' || tablename, ', ')
          from pg_publication_tables pt where pt.pubname = p.pubname) as tables
from pg_publication p
order by p.pubname;



-- M16. Server clock and time zone, so the 2-hour grace period
--      (departure_at + interval '2 hours' compared with now()) is
--      computed as expected. departure_at should be timestamptz (M1).
select now()                          as server_now,
       current_setting('TimeZone')    as server_time_zone,
       (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'rides'
           and column_name = 'departure_at') as departure_at_type;
