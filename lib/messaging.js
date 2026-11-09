import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { checkMessageBody, compareMessages } from './messageText';

// The text rules live in lib/messageText.js (shared with the conversation
// screen); re-exported here so callers can use either file.
export {
  MESSAGE_MAX_LENGTH,
  checkMessageBody,
  compareMessages,
  messageLength,
} from './messageText';

// Private driver/rider messaging (Prototype 9): the data layer.
//
// Everything here talks to the database objects in
// supabase/messaging-1-tables.sql, using their real names:
//   open_my_ride_conversation(p_ride_id, p_rider_id default null)
//   list_my_ride_conversations(p_conversation_id default null)
//   send_my_ride_message(p_conversation_id, p_client_message_id, p_body)
//   ride_messages: no read RPC exists; participants read the table
//     directly, and Row Level Security limits rows to their own chats.
//
// Those objects have only been applied to a LOCAL database. Production may
// not have them, so a "doesn't exist" answer is reported as `unavailable`
// rather than as an error, and nothing here is reached unless the off
// switch below is on (App.js checks it before showing any messaging UI).
//
// The rule these helpers follow (as in lib/rideRequests.js): the phone only
// reports what the SERVER has said. Whether a chat is open (`state`) and
// whether a message may be sent (`can_send`) always come from the server and
// are passed through unchanged; the app never decides them itself.
//
// Only the shared client from lib/supabase.js is used, which holds the
// publishable key. RLS and the SECURITY DEFINER functions check the
// signed-in user, and the server takes the user from the session, never
// from the app.
//
// Every function resolves (never throws) with one of:
//   { kind: 'ok', ... }                  the server answered
//   { kind: 'refused', message }         a rule the database enforces said
//                                        no (P0001); message is for users
//   { kind: 'retry', message }           try again: the row was busy
//                                        (55P03) or no answer arrived
//                                        (network failure / timeout)
//   { kind: 'unavailable', message }     messaging isn't installed on this
//                                        server (e.g. production today)
//   { kind: 'error', message }           anything else
//   { kind: 'invalid', message }         sendRideMessage only: the text was
//                                        refused on the phone, nothing sent

// --- Off switch ---------------------------------------------------------------

// Messaging is on only when EXPO_PUBLIC_MESSAGING_ENABLED is exactly 'true'.
// Missing, empty, 'false', '1', 'TRUE' or anything else means off.
//
// The variable must be read with this exact dot notation: Expo only inlines
// EXPO_PUBLIC_* values written as process.env.EXPO_PUBLIC_NAME (bracket
// access or destructuring is silently left undefined). It is read each time
// the function is called rather than once when the file loads; in a build
// the value is inlined anyway, and in Jest this lets each test choose it.
//
// The flag isn't hidden: EXPO_PUBLIC_* values are visible in the built app.
export function isMessagingEnabled() {
  return process.env.EXPO_PUBLIC_MESSAGING_ENABLED === 'true';
}

// --- Limits and messages --------------------------------------------------------

// How long a send may wait for its answer. A send that times out may still
// have been saved; retrying with the same client id is safe because the
// server returns the saved message instead of storing a second copy.
const SEND_TIMEOUT_MS = 12000;
// How long a read (conversation or messages) may take.
const READ_TIMEOUT_MS = 8000;
// The most messages one read returns: the newest ones.
const MESSAGE_PAGE_SIZE = 200;

const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, client_message_id, body, created_at';

const UNAVAILABLE_MESSAGE = "Messaging isn't available yet.";
const NETWORK_MESSAGE = "Couldn't reach CarpoolBoard. Check your connection and try again.";
const BUSY_MESSAGE = 'This ride is being updated. Please try again in a moment.';
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

// Error codes that mean the messaging tables or functions don't exist on
// this server: PostgREST's "function / table not in the schema cache", and
// Postgres's "undefined function / undefined table".
const UNAVAILABLE_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

// --- Message ids ---------------------------------------------------------------

// A new id for a message, chosen once when it is first sent and reused on
// every retry of that same message (send_my_ride_message is idempotent per
// sender and client id).
export function newClientMessageId() {
  return Crypto.randomUUID();
}

// --- Shapes ---------------------------------------------------------------------

// A conversation row from open_my_ride_conversation or
// list_my_ride_conversations, as the app uses it. state and can_send are
// the server's; a missing can_send never counts as permission to send.
function toConversation(row) {
  return {
    id: row.conversation_id,
    // null once the ride is cancelled (deleted): the chat is archived.
    rideId: row.ride_id ?? null,
    driverId: row.driver_id,
    riderId: row.rider_id,
    myRole: row.my_role,
    rideDestination: row.ride_destination,
    rideDepartureAt: row.ride_departure_at ? new Date(row.ride_departure_at) : null,
    state: row.state,
    canSend: row.can_send === true,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at ?? null,
  };
}

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

// --- Errors ---------------------------------------------------------------------

// Turns a Supabase error into a result the screens can show.
function toFailure(error, status) {
  const code = error?.code;
  if (code === 'P0001' && error.message) {
    // Raised on purpose by the messaging functions; written for users.
    return { kind: 'refused', message: error.message };
  }
  if (code === '55P03') {
    // The ride or request row was busy (see messaging-1-tables.sql,
    // "Concurrency"). Nothing was saved, so trying again is safe.
    return { kind: 'retry', message: error.message || BUSY_MESSAGE };
  }
  if (UNAVAILABLE_CODES.has(code)) {
    return { kind: 'unavailable', message: UNAVAILABLE_MESSAGE };
  }
  if (!status) {
    // supabase-js reports a failed or aborted fetch as status 0 with an
    // empty code: no answer arrived, so the request may or may not have
    // reached the server.
    return { kind: 'retry', message: NETWORK_MESSAGE };
  }
  console.warn('CarpoolBoard: messaging request failed', error);
  return { kind: 'error', message: GENERIC_MESSAGE };
}

function networkFailure(error) {
  console.warn('CarpoolBoard: messaging request got no answer', error);
  return { kind: 'retry', message: NETWORK_MESSAGE };
}

// Runs one Supabase request with a time limit. Resolves with
// { data, error, status } exactly as supabase-js does, or with a status-0
// error when the request threw (which supabase-js normally avoids).
// retry(false): the app decides when to try again, never the client.
async function request(makeQuery, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await makeQuery().abortSignal(controller.signal).retry(false);
  } finally {
    clearTimeout(timer);
  }
}

// Calls one of the messaging RPCs and hands the rows to `onRows`.
async function callRpc(name, args, onRows, timeoutMs = READ_TIMEOUT_MS) {
  try {
    const { data, error, status } = await request(
      () => (args === undefined ? supabase.rpc(name) : supabase.rpc(name, args)),
      timeoutMs
    );
    if (error) {
      return toFailure(error, status);
    }
    return onRows(Array.isArray(data) ? data : data == null ? [] : [data]);
  } catch (error) {
    return networkFailure(error);
  }
}

// --- Conversations --------------------------------------------------------------

// Finds or starts the conversation for one ride.
//   Rider:  openRideConversation({ rideId })            their own chat
//   Driver: openRideConversation({ rideId, riderId })   chat with that rider
// The rider never names a rider: the server takes them from the session.
// The server only STARTS a conversation for an accepted request on a ride
// that hasn't ended, and refuses everyone else with the same P0001 message.
// An existing conversation is returned in any state, so read-only history
// can be reopened. A cancelled ride's chat is opened by id instead
// (getRideConversation), since its ride no longer exists.
// Resolves with { kind: 'ok', conversation } or a failure.
export function openRideConversation({ rideId, riderId = null }) {
  const args = { p_ride_id: rideId };
  if (riderId) {
    args.p_rider_id = riderId;
  }
  return callRpc('open_my_ride_conversation', args, (rows) =>
    rows[0]
      ? { kind: 'ok', conversation: toConversation(rows[0]) }
      : { kind: 'error', message: GENERIC_MESSAGE }
  );
}

// Every conversation the signed-in person is in (as driver or rider),
// newest activity first, as the server orders them, including archived ones.
// Resolves with { kind: 'ok', conversations } or a failure.
export function listRideConversations() {
  return callRpc('list_my_ride_conversations', undefined, (rows) => ({
    kind: 'ok',
    conversations: rows.map(toConversation),
  }));
}

// One conversation by id, with its live state. conversation is null when
// the signed-in person isn't in it (or it doesn't exist): the server shows
// each person only their own chats.
// Resolves with { kind: 'ok', conversation } or a failure.
export function getRideConversation(conversationId) {
  return callRpc('list_my_ride_conversations', { p_conversation_id: conversationId }, (rows) => ({
    kind: 'ok',
    conversation: rows[0] ? toConversation(rows[0]) : null,
  }));
}

// --- Messages ---------------------------------------------------------------------

// Sends one message as the signed-in person. clientMessageId comes from
// newClientMessageId() when the message is first sent, and the SAME id must
// be passed on every retry of it: the server then returns the copy it
// already saved instead of storing a second one, even if the first answer
// was lost. This function never makes up an id itself.
// The text is checked here first (1 to 1,000 characters after trimming);
// the server checks again and has the final say (read-only chats, rate
// limit).
// Resolves with { kind: 'ok', message }, { kind: 'invalid', message }, or a
// failure. A `retry` result means the message may or may not have been
// saved: retry with the same id to find out safely.
export async function sendRideMessage({ conversationId, clientMessageId, body }) {
  const checked = checkMessageBody(body);
  if (!checked.ok) {
    return { kind: 'invalid', message: checked.message };
  }
  return callRpc(
    'send_my_ride_message',
    {
      p_conversation_id: conversationId,
      p_client_message_id: clientMessageId,
      p_body: checked.body,
    },
    (rows) =>
      rows[0] && rows[0].id
        ? { kind: 'ok', message: toMessage(rows[0]) }
        : { kind: 'error', message: GENERIC_MESSAGE },
    SEND_TIMEOUT_MS
  );
}

// Reads a conversation's messages, oldest first. Without `since`, the
// newest MESSAGE_PAGE_SIZE messages; with `since` (a timestamp string),
// only messages created at or after it, for polling. Callers should pass a
// `since` a little earlier than the newest message they hold:
// created_at is when the sender's transaction STARTED, so a message can be
// saved just after a newer one.
// Resolves with { kind: 'ok', messages } or a failure.
export async function loadMessages({ conversationId, since = null }) {
  try {
    const { data, error, status } = await request(() => {
      let query = supabase
        .from('ride_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId);
      if (since) {
        query = query.gte('created_at', since);
      }
      return query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);
    }, READ_TIMEOUT_MS);
    if (error) {
      return toFailure(error, status);
    }
    const messages = (Array.isArray(data) ? data : []).map(toMessage).sort(compareMessages);
    return { kind: 'ok', messages };
  } catch (error) {
    return networkFailure(error);
  }
}
