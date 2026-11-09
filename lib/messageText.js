// Private driver/rider messaging: the pure rules for message text and order.
//
// No Supabase, no native modules: lib/messaging.js (the data layer) and the
// conversation screen both use these, so the phone checks a message exactly
// the way it is sent, and the screen orders messages exactly the way they
// are loaded.

// The server's limit (ride_messages_body_check / send_my_ride_message in
// supabase/messaging-1-tables.sql).
export const MESSAGE_MAX_LENGTH = 1000;

const EMPTY_MESSAGE = 'Type a message first.';
const TOO_LONG_MESSAGE = `Messages can be at most ${MESSAGE_MAX_LENGTH} characters.`;

// The server trims exactly these characters (btrim(body, E' \t\r\n')), so
// the phone trims the same ones. Using String.trim() would also remove
// other whitespace and could make a retry's text differ from the original.
const EDGE_WHITESPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

export function trimMessage(text) {
  return (typeof text === 'string' ? text : '').replace(EDGE_WHITESPACE, '');
}

// How many characters the server will count for this text once trimmed:
// Unicode code points, like Postgres's char_length, so an emoji counts once
// (JavaScript's .length would count most emoji twice).
export function messageLength(text) {
  return Array.from(trimMessage(text)).length;
}

// Checks a message the way the server will. Returns
//   { ok: true, body }      body is the trimmed text to send
//   { ok: false, message }  why it can't be sent (for the user)
export function checkMessageBody(text) {
  const body = trimMessage(text);
  if (body === '') {
    return { ok: false, message: EMPTY_MESSAGE };
  }
  if (Array.from(body).length > MESSAGE_MAX_LENGTH) {
    return { ok: false, message: TOO_LONG_MESSAGE };
  }
  return { ok: true, body };
}

// A timestamp as microseconds since the epoch, for sorting. Postgres keeps
// microseconds but Date only keeps milliseconds, so the extra digits are
// added back; otherwise two messages in the same millisecond could sort in
// the wrong order.
function timeKey(timestamp) {
  const text = String(timestamp ?? '');
  const fraction = /\.(\d+)/.exec(text);
  const ms = Date.parse(text.replace(/\.\d+/, ''));
  if (Number.isNaN(ms)) return 0;
  const micros = fraction ? Number(`${fraction[1]}000000`.slice(0, 6)) : 0;
  return ms * 1000 + micros;
}

// Message order: oldest first; ties (same timestamp) by id, as the table's
// index orders them.
export function compareMessages(a, b) {
  const byTime = timeKey(a.createdAt) - timeKey(b.createdAt);
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// A server timestamp as a Date. Postgres sends up to 6 fractional digits;
// only 3 are kept, because not every JavaScript engine parses more.
export function toMessageDate(timestamp) {
  const date = new Date(String(timestamp ?? '').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(date.getTime()) ? null : date;
}
