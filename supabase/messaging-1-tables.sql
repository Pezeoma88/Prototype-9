-- =====================================================================
-- CarpoolBoard Prototype 9 — Private Driver/Rider Messaging,
-- step 1: tables, RLS and RPCs
-- =====================================================================
--
-- Adds a private, ride-specific conversation between a ride's driver and
-- each ACCEPTED rider, and the messages in it.
--
--   1. public.ride_conversations   one per (ride, accepted rider)
--   2. public.ride_messages        the messages; never edited or deleted
--                                  by the app
--   3. public.ride_messages_check_participant
--                                  trigger: a message's sender must be the
--                                  conversation's driver or rider (backstop)
--   4. public.ride_conversation_state
--                                  the one place the open / read-only rule
--                                  lives (incl. the 2-hour grace period)
--   5. public.list_my_ride_conversations   read the caller's conversations
--   6. public.open_my_ride_conversation    find or start a conversation
--   7. public.send_my_ride_message         send one message (safe to retry)
--   8. RLS + grants                participants may SELECT; nobody may
--                                  INSERT/UPDATE/DELETE directly
--
-- Run AFTER: messaging-0-inspect.sql was reviewed (Phase 0).
-- Run BEFORE: messaging-2-verify.sql.
--
-- Safety:
--   * Additive only. No existing table, column, policy, grant, function or
--     row is changed, dropped or deleted. rides / ride_requests / profiles
--     are only REFERENCED (foreign keys) and READ.
--   * The whole file is one transaction. Step 0 checks every assumption
--     first and stops with "Nothing was changed." if one doesn't hold, or
--     if any messaging object already exists (so it can't half-apply or
--     be applied twice).
--   * Nothing is added to the supabase_realtime publication.
--
-- How chat history survives cancellations:
--   The app cancels a ride by DELETING the rides row, which CASCADE-deletes
--   its ride_requests (confirmed in Phase 0). Conversations therefore point
--   at rides and ride_requests with nullable ON DELETE SET NULL foreign
--   keys (the same approach as driver_reviews.ride_id) and keep a copy of
--   the ride's destination and departure time. The conversation and its
--   messages stay; it just becomes read-only.
--
-- Open / read-only rule (ride_conversation_state):
--   ride row gone                          -> 'ride_cancelled'  read-only
--   request not 'accepted' (or gone)       -> 'seat_cancelled'  read-only
--   now() >= departure_at + 2 hours        -> 'completed'       read-only
--   otherwise                              -> 'open'            can send
--   Participants can always READ their conversation's history.
--
-- Who can see what, in every execution context:
--   auth.uid() reads the request's JWT claims (request.jwt.claims). It is
--   NOT changed by SECURITY DEFINER, so inside every function below it is
--   still the signed-in caller (NULL for anon / no session).
--   * Client reads tables directly  -> role authenticated, RLS applies.
--   * Client calls list_my_ride_conversations (SECURITY INVOKER)
--                                   -> role authenticated, RLS applies
--                                      AND the explicit auth.uid() filter.
--   * open_my_ride_conversation (SECURITY DEFINER) calls list_...
--                                   -> runs as the function OWNER, which
--                                      bypasses RLS. Here the explicit
--                                      "auth.uid() in (driver_id, rider_id)"
--                                      filter is what limits the output, so
--                                      that filter must never be removed.
--   driver_id and rider_id are NOT NULL and never change, so the same
--   filter also covers archived conversations (ride_id/request_id NULL).
--   With no session, auth.uid() is NULL and the filter matches nothing.
--
-- Concurrency
--   Lock order in open/send: (send only: per-sender advisory lock) ->
--   rides FOR KEY SHARE -> ride_requests FOR SHARE NOWAIT ->
--   ride_conversations (unique-index insert or NO KEY UPDATE).
--   Two rules make this order safe against BOTH existing orders:
--     - Cancel Ride locks ride (DELETE = FOR UPDATE) then requests and
--       conversations (cascade). Same order as ours, and the ride row is
--       the gate: while a messaging call holds it, the DELETE (and so the
--       whole cascade) can't start, and vice versa.
--     - accept_ride_request (pre-existing, dashboard-only) locks the
--       request FOR UPDATE, then the ride FOR UPDATE: the OPPOSITE order
--       (confirmed from its live definition on 2026-11-08). It checks the
--       request's status only AFTER taking both locks, so even a repeated
--       Accept of an already-accepted request takes this order.
--       FOR UPDATE on the ride conflicts with our FOR KEY SHARE, so if we
--       WAITED for its request lock while holding the ride, the two could
--       deadlock. We never wait there: the request lock is NOWAIT and, if
--       the row is busy, the call fails at once with SQLSTATE 55P03
--       (lock_not_available) and a "please try again" message. The app
--       treats 55P03 as retryable; send retries are idempotent.
--   Per operation:
--   * send/open vs. Cancel Ride: if the messaging call holds the ride
--     first, the DELETE waits until it commits (a sent message is then
--     archived with the chat). If the DELETE is first, the call waits on
--     the ride while holding no row locks, then finds the ride gone and
--     is refused.
--   * send/open vs. Leave Seat / deny / any request status UPDATE (FOR NO
--     KEY UPDATE, conflicts with FOR SHARE): if messaging locked the
--     request first, the UPDATE waits for it. If the UPDATE is mid-flight,
--     messaging fails fast with 55P03; the retry sees the committed
--     status. (These UPDATEs take no ride lock, so no cycle either way.)
--   * send/open vs. accept_my_ride_request: accept may wait for messaging
--     to release the ride; messaging never waits for accept's request
--     lock (NOWAIT). Confirmed from the live definitions (Phase 0 P5/P6,
--     2026-11-08):
--       - accept_my_ride_request (md5 18db5b9b2ff67b4c162eacdb93518b43,
--         identical to auth-1-accounts.sql) reads the request and ride
--         WITHOUT locks to check the caller is the driver and the ride
--         hasn't departed, calls accept_ride_request, then cancels the
--         rider's other pending requests.
--       - accept_ride_request (md5 417acdd5c892411d76c68e9dc56f9e7c,
--         SECURITY INVOKER, not executable by anon or authenticated) locks
--         the request FOR UPDATE, then the ride FOR UPDATE, checks pending
--         status and seat capacity, sets the request to accepted, cancels
--         the same rider's other pending requests, and clears
--         profiles.looking_since.
--     The cancellations are plain status UPDATEs (FOR NO KEY UPDATE) that
--     lock only rows still pending. Messaging never waits while holding a
--     pending request: send only locks its conversation's (accepted)
--     request, and open refuses a pending request straight after locking
--     it. So accept may wait briefly for messaging, never the reverse.
--     The profiles UPDATE changes only looking_since, which is in no
--     unique index (profiles' unique indexes are id, email and username).
--     So it takes FOR NO KEY UPDATE, which is compatible with the FOR KEY
--     SHARE our inserts take on profiles through their foreign keys.
--     If either function changes (its md5 differs), redo this reasoning.
--   * send/open vs. ride edits (destination/departure/seats): plain
--     UPDATEs are compatible with FOR KEY SHARE; the latest committed
--     values are read.
--   * two participants opening at once: FOR KEY SHARE and FOR SHARE are
--     compatible between them; the unique (ride_id, rider_id) rule makes
--     the second insert wait for the first (which then waits on nothing),
--     do nothing, and return the first one's row.
--   * two sends in one conversation: the foreign-key FOR KEY SHARE on the
--     conversation is compatible with the other send's NO KEY UPDATE; the
--     two last_message_at updates run one after the other and GREATEST
--     keeps the value from going backwards.
--   * one person sending from two devices: a per-sender advisory lock
--     handles their sends one at a time (exact retries and rate limit).
--     No other code uses that lock key.
--   This is reasoning from the Postgres lock rules, the repo's SQL and the
--   reviewed live definitions of the accept functions, NOT a proof: it has not been
--   tested under real concurrency. The two-session recipes are in the
--   "DISPOSABLE ENVIRONMENT ONLY" appendix of messaging-2-verify.sql.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only; stop early instead of guessing)
-- ---------------------------------------------------------------------
do $$
declare
  v_problem text;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.rides') is null
     or to_regclass('public.ride_requests') is null then
    raise exception 'messaging-1 stopped: profiles, rides or ride_requests is missing. Nothing was changed.';
  end if;

  -- Columns this file references, with the types Phase 0 reported.
  select string_agg(format('%s.%s', req.t, req.c), ', ') into v_problem
  from (values ('profiles',      'id',           'uuid'),
               ('rides',         'id',           'uuid'),
               ('rides',         'driver_id',    'uuid'),
               ('rides',         'departure_at', 'timestamp with time zone'),
               ('rides',         'destination',  null),
               ('ride_requests', 'id',           'uuid'),
               ('ride_requests', 'ride_id',      'uuid'),
               ('ride_requests', 'rider_id',     'uuid'),
               ('ride_requests', 'status',       null)) as req(t, c, typ)
  where not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = req.t
      and ic.column_name = req.c
      and (req.typ is null or ic.data_type = req.typ));
  if v_problem is not null then
    raise exception 'messaging-1 stopped: missing column or unexpected type: %. Nothing was changed.', v_problem;
  end if;

  -- Each foreign-key target needs a unique index on exactly (id).
  select string_agg(t, ', ') into v_problem
  from unnest(array['profiles', 'rides', 'ride_requests']) as t
  where not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = to_regclass('public.' || t)
      and i.indisunique and i.indpred is null and i.indnkeyatts = 1
      and a.attname = 'id');
  if v_problem is not null then
    raise exception 'messaging-1 stopped: no unique key on id for: %. Nothing was changed.', v_problem;
  end if;

  if to_regprocedure('auth.uid()') is null then
    raise exception 'messaging-1 stopped: auth.uid() is missing. Nothing was changed.';
  end if;
  if to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'messaging-1 stopped: gen_random_uuid() is not available. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'messaging-1 stopped: the anon/authenticated roles are missing. Nothing was changed.';
  end if;
  -- Messaging assumes the Feature 3 sign-in model is in force.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and policyname like 'auth: %') then
    raise exception 'messaging-1 stopped: auth-2-lockdown.sql does not appear to be applied. Nothing was changed.';
  end if;

  -- Nothing from this file may exist yet.
  if to_regclass('public.ride_conversations') is not null
     or to_regclass('public.ride_messages') is not null then
    raise exception 'messaging-1 stopped: ride_conversations or ride_messages already exists (already applied?). Nothing was changed.';
  end if;
  if exists (select 1 from pg_proc
             where pronamespace = 'public'::regnamespace
               and proname in ('ride_conversation_state', 'list_my_ride_conversations',
                               'open_my_ride_conversation', 'send_my_ride_message',
                               'ride_messages_check_participant')) then
    raise exception 'messaging-1 stopped: a messaging function already exists (already applied?). Nothing was changed.';
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 1. ride_conversations
-- ---------------------------------------------------------------------
create table public.ride_conversations (
  id                uuid primary key default gen_random_uuid(),
  -- NULL once the ride is cancelled (deleted). The conversation stays.
  ride_id           uuid references public.rides (id) on delete set null,
  -- The accepted request this conversation was opened for. NULL once the
  -- request is deleted (which happens when its ride is deleted).
  request_id        uuid references public.ride_requests (id) on delete set null,
  driver_id         uuid not null references public.profiles (id) on delete cascade,
  rider_id          uuid not null references public.profiles (id) on delete cascade,
  -- Copies of the ride's details, so a cancelled ride's chat still has a
  -- title and an end time. They are set when the conversation is created
  -- and refreshed only by open_my_ride_conversation, each time the chat is
  -- opened while its ride still exists. send_my_ride_message does NOT
  -- refresh them. While the ride exists, list_my_ride_conversations shows
  -- the live ride values; the copies are only shown once it is gone. So if
  -- a driver edits the ride and then cancels it before anyone reopens the
  -- chat, the archive shows the details as of the last open.
  ride_destination  text not null,
  ride_departure_at timestamptz not null,
  created_at        timestamptz not null default now(),
  last_message_at   timestamptz,
  constraint ride_conversations_distinct_people check (driver_id <> rider_id),
  -- One conversation per rider per ride. After a ride is deleted ride_id is
  -- NULL, and NULLs never collide, so archived chats can't block anything.
  constraint ride_conversations_ride_rider_key unique (ride_id, rider_id)
);

create index ride_conversations_request_idx on public.ride_conversations (request_id);
create index ride_conversations_driver_idx  on public.ride_conversations (driver_id, last_message_at desc);
create index ride_conversations_rider_idx   on public.ride_conversations (rider_id, last_message_at desc);

comment on table public.ride_conversations is
  'Private driver <-> accepted-rider conversation for one ride. Created only by open_my_ride_conversation. Survives ride/request deletion (ride_id/request_id become NULL) as a read-only archive.';


-- ---------------------------------------------------------------------
-- 2. ride_messages
-- ---------------------------------------------------------------------
create table public.ride_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.ride_conversations (id) on delete cascade,
  sender_id         uuid not null references public.profiles (id) on delete cascade,
  -- Chosen by the phone once per message and reused on every retry, so a
  -- retry after a lost reply can never create a second copy.
  client_message_id uuid not null,
  body              text not null,
  created_at        timestamptz not null default now(),
  constraint ride_messages_body_check
    check (char_length(body) between 1 and 1000
           and body = btrim(body, E' \t\r\n')),
  constraint ride_messages_sender_client_key unique (sender_id, client_message_id)
);

create index ride_messages_conversation_created_idx
  on public.ride_messages (conversation_id, created_at, id);
-- Used by the rate limit (recent messages per sender).
create index ride_messages_sender_created_idx
  on public.ride_messages (sender_id, created_at desc);

comment on table public.ride_messages is
  'Messages in a ride_conversations row. Inserted only by send_my_ride_message (sender = auth.uid()). No client may update or delete them.';


-- ---------------------------------------------------------------------
-- 3. Backstop: a message's sender must belong to its conversation
-- ---------------------------------------------------------------------
-- send_my_ride_message already guarantees this; the trigger makes it true
-- for any future code path too.
create function public.ride_messages_check_participant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ride_conversations c
    where c.id = new.conversation_id
      and new.sender_id in (c.driver_id, c.rider_id)
  ) then
    raise exception 'ride_messages: the sender is not part of this conversation.';
  end if;
  return new;
end;
$$;

revoke all on function public.ride_messages_check_participant() from public, anon, authenticated;

create trigger ride_messages_check_participant
  before insert or update of sender_id, conversation_id on public.ride_messages
  for each row execute function public.ride_messages_check_participant();


-- ---------------------------------------------------------------------
-- 4. The open / read-only rule
-- ---------------------------------------------------------------------
-- Pure function of its inputs (p_at is "now"), so the rule can be tested
-- at any time without waiting for a real ride to depart.
create function public.ride_conversation_state(
  p_ride_exists    boolean,
  p_request_status text,
  p_departure_at   timestamptz,
  p_at             timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_ride_exists is not true                         then 'ride_cancelled'
    when p_request_status is distinct from 'accepted'      then 'seat_cancelled'
    when p_departure_at is null
         or p_at >= p_departure_at + interval '2 hours'    then 'completed'
    else 'open'
  end;
$$;

comment on function public.ride_conversation_state(boolean, text, timestamptz, timestamptz) is
  'Messaging rule: ride_cancelled | seat_cancelled | completed (2 hours after departure) | open. Only ''open'' accepts new messages.';


-- ---------------------------------------------------------------------
-- 5. list_my_ride_conversations  (SECURITY INVOKER: runs under RLS)
-- ---------------------------------------------------------------------
-- The signed-in person's conversations (or just one, by id), newest
-- activity first, with the live state. It only reads, so it runs as the
-- caller: RLS on ride_conversations applies. The explicit auth.uid()
-- filter in the WHERE clause is REQUIRED, not decoration: when
-- open_my_ride_conversation (SECURITY DEFINER) calls this function it
-- runs as the owner, RLS does not apply, and that filter alone limits the
-- rows to the caller's own conversations (see the header).
create function public.list_my_ride_conversations(p_conversation_id uuid default null)
returns table (
  conversation_id   uuid,
  ride_id           uuid,
  driver_id         uuid,
  rider_id          uuid,
  my_role           text,
  ride_destination  text,
  ride_departure_at timestamptz,
  state             text,
  can_send          boolean,
  created_at        timestamptz,
  last_message_at   timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id,
         c.ride_id,
         c.driver_id,
         c.rider_id,
         case when c.driver_id = (select auth.uid()) then 'driver' else 'rider' end,
         coalesce(r.destination::text, c.ride_destination),
         coalesce(r.departure_at, c.ride_departure_at),
         s.state,
         s.state = 'open',
         c.created_at,
         c.last_message_at
  from public.ride_conversations c
  left join public.rides r on r.id = c.ride_id
  left join public.ride_requests q on q.id = c.request_id
  cross join lateral (
    select public.ride_conversation_state(
             r.id is not null,
             q.status::text,
             coalesce(r.departure_at, c.ride_departure_at),
             now()) as state
  ) s
  where (select auth.uid()) in (c.driver_id, c.rider_id)
    and (p_conversation_id is null or c.id = p_conversation_id)
  order by coalesce(c.last_message_at, c.created_at) desc, c.id;
$$;

comment on function public.list_my_ride_conversations(uuid) is
  'The signed-in user''s ride conversations (all, or one by id) with live state and can_send. SECURITY INVOKER; read-only.';


-- ---------------------------------------------------------------------
-- 6. open_my_ride_conversation  (SECURITY DEFINER)
-- ---------------------------------------------------------------------
-- Rider: open_my_ride_conversation(ride_id)            -> their own chat
-- Driver: open_my_ride_conversation(ride_id, rider_id) -> chat with that rider
--
-- Returns an existing conversation in ANY state (so read-only history can
-- be reopened). Creates one only when the rider's request is 'accepted'
-- and the ride hasn't passed the grace period. Everyone else, including
-- pending/denied riders and strangers, gets the same generic refusal so
-- nothing can be learned by probing.
--
-- Concurrency: the ride row is locked FOR KEY SHARE (blocks a concurrent
-- cancel/delete, not ordinary edits) and the request row FOR SHARE NOWAIT
-- (blocks a concurrent status change; if one is already in progress this
-- call fails at once with retryable SQLSTATE 55P03 instead of waiting)
-- until this call commits. Two participants
-- opening at the same time are resolved by the unique (ride_id, rider_id)
-- rule: the second insert does nothing and the existing row is returned.
create function public.open_my_ride_conversation(
  p_ride_id  uuid,
  p_rider_id uuid default null
)
returns table (
  conversation_id   uuid,
  ride_id           uuid,
  driver_id         uuid,
  rider_id          uuid,
  my_role           text,
  ride_destination  text,
  ride_departure_at timestamptz,
  state             text,
  can_send          boolean,
  created_at        timestamptz,
  last_message_at   timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_unavailable constant text := 'This conversation isn''t available.';
  v_uid             uuid := auth.uid();
  v_ride            record;
  v_request         record;
  v_rider_id        uuid;
  v_conversation_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again to use messages.';
  end if;
  if p_ride_id is null then
    raise exception '%', c_unavailable;
  end if;

  select r.id, r.driver_id, r.destination::text as destination, r.departure_at
    into v_ride
  from public.rides r
  where r.id = p_ride_id
  for key share;
  if not found then
    -- Ride never existed or was cancelled: an archived chat is reopened by
    -- id through list_my_ride_conversations instead.
    raise exception '%', c_unavailable;
  end if;

  -- Who is the rider in this conversation? Never trust the app for this:
  -- only the ride's driver may name a rider; anyone else is the rider.
  if v_ride.driver_id = v_uid then
    if p_rider_id is null or p_rider_id = v_uid then
      raise exception '%', c_unavailable;
    end if;
    v_rider_id := p_rider_id;
  elsif p_rider_id is null or p_rider_id = v_uid then
    v_rider_id := v_uid;
  else
    raise exception '%', c_unavailable;
  end if;

  -- NOWAIT: never wait for a ride_requests row lock while holding the ride
  -- lock. accept_ride_request takes these two locks in the opposite order
  -- (request FOR UPDATE, then ride FOR UPDATE), so waiting here could
  -- deadlock with an in-flight accept of this same request. See header.
  begin
    select q.id, q.status::text as status
      into v_request
    from public.ride_requests q
    where q.ride_id = p_ride_id and q.rider_id = v_rider_id
    for share nowait;
  exception when lock_not_available then
    raise exception 'This ride is being updated. Please try again in a moment.'
      using errcode = 'lock_not_available';
  end;

  select c.id into v_conversation_id
  from public.ride_conversations c
  where c.ride_id = p_ride_id and c.rider_id = v_rider_id;

  if v_conversation_id is null then
    if v_request.id is null or v_request.status is distinct from 'accepted' then
      raise exception '%', c_unavailable;
    end if;
    if public.ride_conversation_state(true, v_request.status, v_ride.departure_at, now()) <> 'open' then
      raise exception 'This ride has ended, so a new conversation can''t be started.';
    end if;

    insert into public.ride_conversations
      (ride_id, request_id, driver_id, rider_id, ride_destination, ride_departure_at)
    values
      (p_ride_id, v_request.id, v_ride.driver_id, v_rider_id, v_ride.destination, v_ride.departure_at)
    on conflict on constraint ride_conversations_ride_rider_key do nothing
    returning id into v_conversation_id;

    if v_conversation_id is null then
      -- The other participant created it a moment ago.
      select c.id into v_conversation_id
      from public.ride_conversations c
      where c.ride_id = p_ride_id and c.rider_id = v_rider_id;
    end if;
  else
    -- Keep the cached ride details current for when the ride is gone.
    -- (Lock order: ride and request above, then this conversation row.)
    update public.ride_conversations c
       set ride_destination  = v_ride.destination,
           ride_departure_at = v_ride.departure_at
     where c.id = v_conversation_id
       and (c.ride_destination is distinct from v_ride.destination
            or c.ride_departure_at is distinct from v_ride.departure_at);
  end if;

  -- By construction the caller is this conversation's driver or rider;
  -- check it explicitly anyway before returning anything.
  if not exists (select 1 from public.ride_conversations c
                 where c.id = v_conversation_id
                   and v_uid in (c.driver_id, c.rider_id)) then
    raise exception '%', c_unavailable;
  end if;

  -- Runs as this function's owner (RLS bypassed); its own auth.uid()
  -- filter limits the result to the caller's conversation.
  return query select * from public.list_my_ride_conversations(v_conversation_id);
end;
$$;

comment on function public.open_my_ride_conversation(uuid, uuid) is
  'Finds (any state) or creates (accepted + open only) the conversation between a ride''s driver and one rider. Caller = auth.uid(); only the driver may name p_rider_id.';


-- ---------------------------------------------------------------------
-- 7. send_my_ride_message  (SECURITY DEFINER)
-- ---------------------------------------------------------------------
-- Sender is always auth.uid(). Safe to retry: the same
-- (sender, p_client_message_id) with the same text (after trimming)
-- returns the already-saved message instead of sending a second one, even
-- if the chat has since become read-only or the rate limit has been
-- reached (the message really was sent). Reusing a client id for
-- DIFFERENT text, or in a different conversation, is refused. Only the
-- conversation's participants get this far, so a retry can never reveal
-- or replay someone else's message (client ids are per sender).
--
-- Rate limit: at most 20 messages per sender per rolling minute, across
-- all conversations. A per-sender transaction-level advisory lock makes
-- the count exact when the same person sends from two devices at once.
--
-- Concurrency with cancellation: the ride row is locked FOR KEY SHARE and
-- the request row FOR SHARE NOWAIT before the state is checked. A ride
-- cancel that got there first makes this send wait and then refuse it; a
-- Leave Seat (or accept) already in progress on the request makes it fail
-- at once with retryable SQLSTATE 55P03. Otherwise the cancel / Leave
-- Seat waits until this message is saved.
create function public.send_my_ride_message(
  p_conversation_id   uuid,
  p_client_message_id uuid,
  p_body              text
)
returns public.ride_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_unavailable constant text := 'This conversation isn''t available.';
  c_max_length  constant integer := 1000;
  c_per_minute  constant integer := 20;
  v_uid         uuid := auth.uid();
  v_body        text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_conv        public.ride_conversations%rowtype;
  v_msg         public.ride_messages%rowtype;
  v_ride_exists boolean := false;
  v_departure   timestamptz;
  v_status      text;
  v_state       text;
  v_recent      integer;
begin
  if v_uid is null then
    raise exception 'Please sign in again to use messages.';
  end if;
  if p_conversation_id is null or p_client_message_id is null then
    raise exception 'This message couldn''t be sent. Please try again.';
  end if;

  select * into v_conv
  from public.ride_conversations c
  where c.id = p_conversation_id;
  if not found or v_uid not in (v_conv.driver_id, v_conv.rider_id) then
    raise exception '%', c_unavailable;
  end if;

  -- One person's sends are handled one at a time (retries + rate limit).
  perform pg_advisory_xact_lock(
    hashtextextended('carpoolboard.ride_messages:' || v_uid::text, 0));

  -- A retry of a message that was already saved: return it, but only if
  -- it is really the same message (same conversation, same trimmed text).
  select * into v_msg
  from public.ride_messages m
  where m.sender_id = v_uid and m.client_message_id = p_client_message_id;
  if found then
    if v_msg.conversation_id <> p_conversation_id
       or v_msg.body is distinct from v_body then
      raise exception 'This message ID was already used for a different message.';
    end if;
    return v_msg;
  end if;

  if v_body = '' then
    raise exception 'Type a message first.';
  end if;
  if char_length(v_body) > c_max_length then
    raise exception 'Messages can be at most % characters.', c_max_length;
  end if;

  -- Live state, with the ride and request locked (see above).
  if v_conv.ride_id is not null then
    select r.departure_at into v_departure
    from public.rides r
    where r.id = v_conv.ride_id
    for key share;
    v_ride_exists := found;
  end if;
  if v_conv.request_id is not null then
    -- NOWAIT: never wait for a request lock while holding the ride lock
    -- (accept_ride_request locks in the opposite order; see header).
    -- Nothing has been saved yet, so retrying with the same client id is safe.
    begin
      select q.status::text into v_status
      from public.ride_requests q
      where q.id = v_conv.request_id
      for share nowait;
    exception when lock_not_available then
      raise exception 'This message couldn''t be sent yet. Please try again.'
        using errcode = 'lock_not_available';
    end;
  end if;

  v_state := public.ride_conversation_state(
    v_ride_exists, v_status, coalesce(v_departure, v_conv.ride_departure_at), now());
  if v_state = 'ride_cancelled' then
    raise exception 'This ride was cancelled, so this conversation is read-only.';
  elsif v_state = 'seat_cancelled' then
    raise exception 'This seat is no longer confirmed, so this conversation is read-only.';
  elsif v_state <> 'open' then
    raise exception 'This ride has ended, so this conversation is read-only.';
  end if;

  select count(*) into v_recent
  from public.ride_messages m
  where m.sender_id = v_uid
    and m.created_at > now() - interval '1 minute';
  if v_recent >= c_per_minute then
    raise exception 'You''re sending messages too quickly. Please wait a minute and try again.';
  end if;

  insert into public.ride_messages (conversation_id, sender_id, client_message_id, body)
  values (p_conversation_id, v_uid, p_client_message_id, v_body)
  returning * into v_msg;

  -- created_at is the transaction start time, so two overlapping sends can
  -- finish in either order; GREATEST keeps last_message_at from moving back.
  update public.ride_conversations c
     set last_message_at = greatest(c.last_message_at, v_msg.created_at)
   where c.id = p_conversation_id;

  return v_msg;
end;
$$;

comment on function public.send_my_ride_message(uuid, uuid, text) is
  'Sends a message as auth.uid() into one of their open conversations. Idempotent per (sender, client_message_id); 1-1000 chars; 20 per minute per sender.';


-- ---------------------------------------------------------------------
-- 8. Row Level Security and privileges
-- ---------------------------------------------------------------------
alter table public.ride_conversations enable row level security;
alter table public.ride_messages enable row level security;

-- Supabase's default privileges grant new tables/functions to anon and
-- authenticated; take all of that back, then grant only what's needed.
-- (service_role keeps Supabase's defaults: it is server-side only.)
revoke all on table public.ride_conversations from public, anon, authenticated;
revoke all on table public.ride_messages      from public, anon, authenticated;
grant select on table public.ride_conversations to authenticated;
grant select on table public.ride_messages      to authenticated;

create policy "messaging: participants read own conversations"
  on public.ride_conversations for select to authenticated
  using ((select auth.uid()) in (driver_id, rider_id));

create policy "messaging: participants read own messages"
  on public.ride_messages for select to authenticated
  using (exists (
    select 1 from public.ride_conversations c
    where c.id = conversation_id
      and (select auth.uid()) in (c.driver_id, c.rider_id)));

-- No INSERT / UPDATE / DELETE policy and no such grant on either table:
-- the only way in is through the two SECURITY DEFINER functions.

revoke all on function public.ride_conversation_state(boolean, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.list_my_ride_conversations(uuid)        from public, anon, authenticated;
revoke all on function public.open_my_ride_conversation(uuid, uuid)   from public, anon, authenticated;
revoke all on function public.send_my_ride_message(uuid, uuid, text)  from public, anon, authenticated;

-- ride_conversation_state is needed by list_my_ride_conversations, which
-- runs as the caller.
grant execute on function public.ride_conversation_state(boolean, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.list_my_ride_conversations(uuid)       to authenticated;
grant execute on function public.open_my_ride_conversation(uuid, uuid)  to authenticated;
grant execute on function public.send_my_ride_message(uuid, uuid, text) to authenticated;

-- Tell the Data API (PostgREST) to reload its schema cache so the new
-- RPCs are callable. This is INSIDE the transaction on purpose: NOTIFY is
-- transactional, so it is delivered only if the COMMIT below succeeds and
-- is discarded if anything above fails. (The earlier migrations put it
-- after COMMIT, where it runs as its own statement; either works.)
notify pgrst, 'reload schema';

commit;


-- =====================================================================
-- EMERGENCY UNDO (do NOT run unless asked). Deletes ALL messaging data.
-- =====================================================================
-- begin;
-- drop function if exists public.send_my_ride_message(uuid, uuid, text);
-- drop function if exists public.open_my_ride_conversation(uuid, uuid);
-- drop function if exists public.list_my_ride_conversations(uuid);
-- drop function if exists public.ride_conversation_state(boolean, text, timestamptz, timestamptz);
-- drop table if exists public.ride_messages;
-- drop table if exists public.ride_conversations;
-- drop function if exists public.ride_messages_check_participant();
-- commit;
-- notify pgrst, 'reload schema';
