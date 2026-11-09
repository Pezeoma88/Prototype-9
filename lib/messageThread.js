import { formatDepartureTime } from './format';
import { compareMessages, toMessageDate } from './messageText';

// Private driver/rider messaging: pure helpers for the conversation screen's
// message list (merging what the server returns, where the next poll should
// start reading, and day labels). No Supabase, no React.

// How often an open conversation asks the server for new messages and its
// current state (only while the screen is open and the app is active).
export const POLL_INTERVAL_MS = 5000;

// Each poll re-reads this much before the newest message already on screen.
// created_at is when the sender's transaction STARTED, so a message can be
// saved a moment after a newer one; re-reading a short overlap means it is
// never skipped. Messages already on screen are matched by id, so the
// overlap never shows anything twice.
export const POLL_OVERLAP_MS = 60 * 1000;

// Adds server messages to the list, replacing any with the same id, oldest
// first. Returns the same array when nothing changed, so React can skip
// re-rendering.
export function mergeMessages(current, incoming) {
  if (!incoming || incoming.length === 0) {
    return current;
  }
  const byId = new Map(current.map((message) => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (!existing || existing.body !== message.body || existing.createdAt !== message.createdAt) {
      byId.set(message.id, message);
      changed = true;
    }
  }
  return changed ? Array.from(byId.values()).sort(compareMessages) : current;
}

// Removes the phone's own not-yet-confirmed messages that the server turns
// out to have saved (matched by client id, which is unique per sender). This
// is how a "Not sent" message whose reply was lost turns into the real one.
export function dropConfirmed(outgoing, serverMessages, currentUserId) {
  if (outgoing.length === 0 || !serverMessages || serverMessages.length === 0) {
    return outgoing;
  }
  const saved = new Set(
    serverMessages
      .filter((message) => message.senderId === currentUserId)
      .map((message) => message.clientMessageId)
  );
  const remaining = outgoing.filter((entry) => !saved.has(entry.clientMessageId));
  return remaining.length === outgoing.length ? outgoing : remaining;
}

// Where the next poll should start reading: POLL_OVERLAP_MS before the
// newest message on screen, or null (the newest page) when there are none.
export function pollSince(messages) {
  const newest = messages[messages.length - 1];
  const date = newest ? toMessageDate(newest.createdAt) : null;
  return date ? new Date(date.getTime() - POLL_OVERLAP_MS).toISOString() : null;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// "Today", "Yesterday", or a date like "Fri, Nov 6" (with the year when it
// isn't this year), in the phone's time zone.
export function formatDayLabel(date, nowMs) {
  const now = new Date(nowMs);
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString('en-US', options);
}

// The rows the conversation screen draws, in order: a day label before the
// first message of each day, then each message. Server messages come first
// (oldest to newest), then the phone's own messages that are still sending
// or failed, in the order they were written.
//   { type: 'day', key, label }
//   { type: 'message', key, message, mine, status, timeLabel }
//     status: 'sent' | 'sending' | 'failed'
export function buildThreadItems({ messages, outgoing, currentUserId, nowMs }) {
  const rows = [
    ...messages.map((message) => ({
      key: `m:${message.id}`,
      date: toMessageDate(message.createdAt),
      message,
      mine: message.senderId === currentUserId,
      status: 'sent',
    })),
    ...outgoing.map((entry) => ({
      key: `c:${entry.clientMessageId}`,
      date: new Date(entry.createdAtMs),
      message: { body: entry.body, clientMessageId: entry.clientMessageId, error: entry.error },
      mine: true,
      status: entry.status,
    })),
  ];

  const items = [];
  let lastDay = null;
  for (const row of rows) {
    const date = row.date || new Date(nowMs);
    const day = startOfLocalDay(date);
    if (day !== lastDay) {
      items.push({ type: 'day', key: `d:${day}`, label: formatDayLabel(date, nowMs) });
      lastDay = day;
    }
    items.push({
      type: 'message',
      key: row.key,
      message: row.message,
      mine: row.mine,
      status: row.status,
      timeLabel: formatDepartureTime(date),
    });
  }
  return items;
}
