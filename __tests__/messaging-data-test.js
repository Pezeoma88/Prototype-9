// Automated tests for the private driver/rider messaging data layer.
// The test cases and their expected results are defined in
// PROTOTYPE-9-TEST-PLAN.md ("Messaging test cases"), where they were
// recorded before lib/messaging.js was written.
//
// Real code under test: lib/messaging.js.
// Faked: lib/supabase (a fake client that records every rpc / from call and
// answers with a scripted result, so nothing can reach any Supabase project,
// local or production), and expo-crypto (not installed yet; the fake hands
// out predictable ids).
//
// The RPC names, argument names and result columns are copied by hand from
// supabase/messaging-1-tables.sql, NOT imported from the app, so the app's
// own code cannot define what counts as correct:
//   open_my_ride_conversation(p_ride_id uuid, p_rider_id uuid default null)
//   list_my_ride_conversations(p_conversation_id uuid default null)
//   send_my_ride_message(p_conversation_id uuid, p_client_message_id uuid, p_body text)
//   ride_messages (id, conversation_id, sender_id, client_message_id, body, created_at)
//     has no read RPC; participants read it directly under RLS.

import fs from 'fs';
import path from 'path';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import {
  getRideConversation,
  listRideConversations,
  loadMessages,
  newClientMessageId,
  openRideConversation,
  sendRideMessage,
} from '../lib/messaging';

jest.mock('../lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

// virtual: expo-crypto is not installed until the data layer is written.
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }), { virtual: true });

// --- No real network -------------------------------------------------------

// Every request the app could make goes through fetch. Counting calls here
// (outside jest.fn, so resetAllMocks can't clear it) proves at the end of
// the file that no test reached a real server.
let networkRequests = 0;
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = () => {
    networkRequests += 1;
    return Promise.reject(new Error('Network is disabled in the messaging tests'));
  };
});
afterAll(() => {
  global.fetch = realFetch;
});

// --- Fake Supabase query builder ------------------------------------------

// The query-builder methods the data layer may chain. Each call is recorded
// as [method, ...args] and returns the same builder; awaiting the builder
// gives the scripted outcome. An Error outcome makes the await reject, like
// a fetch that throws.
const QUERY_METHODS = [
  'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'filter', 'match',
  'order', 'limit', 'range', 'single', 'maybeSingle',
  'abortSignal', 'retry', 'throwOnError', 'returns', 'overrideTypes',
];

let queries = [];

function fakeQuery(outcome) {
  const builder = { calls: [] };
  for (const method of QUERY_METHODS) {
    builder[method] = (...args) => {
      builder.calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (onFulfilled, onRejected) => {
    const settled = outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    return settled.then(onFulfilled, onRejected);
  };
  queries.push(builder);
  return builder;
}

function rpcAnswers(...outcomes) {
  let i = 0;
  supabase.rpc.mockImplementation(() => fakeQuery(outcomes[Math.min(i++, outcomes.length - 1)]));
}

function fromAnswers(outcome) {
  supabase.from.mockImplementation(() => fakeQuery(outcome));
}

const ok = (data) => ({ data, error: null, status: 200, statusText: 'OK' });
const failure = (code, message, status) => ({
  data: null,
  error: { code, message, details: null, hint: null },
  status,
  statusText: '',
});
// What supabase-js 2.117 resolves with when fetch itself fails: it does not
// throw, it returns status 0 and an empty error code.
const NETWORK_FAILURE = {
  data: null,
  error: { code: '', message: 'TypeError: Network request failed', details: '', hint: '' },
  status: 0,
  statusText: '',
};

// --- Test data (server shapes, as PostgREST returns them) ------------------

const ROW_OPEN = {
  conversation_id: 'conv-1',
  ride_id: 'ride-1',
  driver_id: 'driver-1',
  rider_id: 'rider-a',
  my_role: 'rider',
  ride_destination: 'Downtown Dallas',
  ride_departure_at: '2026-11-09T23:00:00+00:00',
  state: 'open',
  can_send: true,
  created_at: '2026-11-08T20:00:00+00:00',
  last_message_at: '2026-11-08T21:06:00+00:00',
};
const CONVERSATION_OPEN = {
  id: 'conv-1',
  rideId: 'ride-1',
  driverId: 'driver-1',
  riderId: 'rider-a',
  myRole: 'rider',
  rideDestination: 'Downtown Dallas',
  rideDepartureAt: new Date('2026-11-09T23:00:00Z'),
  state: 'open',
  canSend: true,
  createdAt: '2026-11-08T20:00:00+00:00',
  lastMessageAt: '2026-11-08T21:06:00+00:00',
};
// A cancelled ride's archived chat: the ride row is gone, so ride_id is NULL.
const ROW_ARCHIVED = {
  ...ROW_OPEN,
  conversation_id: 'conv-2',
  ride_id: null,
  my_role: 'driver',
  ride_destination: 'Love Field',
  state: 'ride_cancelled',
  can_send: false,
  last_message_at: null,
};
const CONVERSATION_ARCHIVED = {
  ...CONVERSATION_OPEN,
  id: 'conv-2',
  rideId: null,
  myRole: 'driver',
  rideDestination: 'Love Field',
  state: 'ride_cancelled',
  canSend: false,
  lastMessageAt: null,
};

const MESSAGE_ROW = {
  id: 'msg-9',
  conversation_id: 'conv-1',
  sender_id: 'rider-a',
  client_message_id: 'client-1',
  body: 'On my way',
  created_at: '2026-11-08T21:05:00+00:00',
};
const MESSAGE = {
  id: 'msg-9',
  conversationId: 'conv-1',
  senderId: 'rider-a',
  clientMessageId: 'client-1',
  body: 'On my way',
  createdAt: '2026-11-08T21:05:00+00:00',
};

// Expected user-facing text, written out here (see the test plan).
const UNAVAILABLE_TEXT = "Messaging isn't available yet.";
const NETWORK_TEXT = "Couldn't reach CarpoolBoard. Check your connection and try again.";
const GENERIC_TEXT = 'Something went wrong. Please try again.';
const EMPTY_TEXT = 'Type a message first.';
const TOO_LONG_TEXT = 'Messages can be at most 1000 characters.';

// --- Helpers ---------------------------------------------------------------

function onlyRpcCall() {
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  const [name, args] = supabase.rpc.mock.calls[0];
  return { name, args: args ?? {} };
}

function callsOf(query, method) {
  return query.calls.filter((call) => call[0] === method);
}

const longText = (n) => 'a'.repeat(n);

beforeEach(() => {
  jest.resetAllMocks();
  queries = [];
});

describe('Messaging data layer', () => {
  test('MD-01: a rider opens their conversation with only p_ride_id', async () => {
    rpcAnswers(ok([ROW_OPEN]));

    const result = await openRideConversation({ rideId: 'ride-1' });

    const { name, args } = onlyRpcCall();
    expect(name).toBe('open_my_ride_conversation');
    expect(args.p_ride_id).toBe('ride-1');
    // The server works out the rider from the session; the app never names one.
    expect(args.p_rider_id == null).toBe(true);
    expect(Object.keys(args).every((key) => ['p_ride_id', 'p_rider_id'].includes(key))).toBe(true);
    expect(result).toEqual({ kind: 'ok', conversation: CONVERSATION_OPEN });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('MD-02: a driver opens the conversation with one rider using p_ride_id and p_rider_id', async () => {
    rpcAnswers(ok([{ ...ROW_OPEN, my_role: 'driver' }]));

    const result = await openRideConversation({ rideId: 'ride-1', riderId: 'rider-a' });

    const { name, args } = onlyRpcCall();
    expect(name).toBe('open_my_ride_conversation');
    expect(args).toEqual({ p_ride_id: 'ride-1', p_rider_id: 'rider-a' });
    expect(result).toEqual({ kind: 'ok', conversation: { ...CONVERSATION_OPEN, myRole: 'driver' } });
  });

  test('MD-03: listing all conversations calls list_my_ride_conversations with no arguments and keeps the server order', async () => {
    rpcAnswers(ok([ROW_OPEN, ROW_ARCHIVED]));

    const result = await listRideConversations();

    const { name, args } = onlyRpcCall();
    expect(name).toBe('list_my_ride_conversations');
    expect(args).toEqual({});
    expect(result).toEqual({ kind: 'ok', conversations: [CONVERSATION_OPEN, CONVERSATION_ARCHIVED] });
  });

  describe('MD-04: reading one conversation by id', () => {
    test('A: a conversation the caller belongs to is returned', async () => {
      rpcAnswers(ok([ROW_ARCHIVED]));

      const result = await getRideConversation('conv-2');

      const { name, args } = onlyRpcCall();
      expect(name).toBe('list_my_ride_conversations');
      expect(args).toEqual({ p_conversation_id: 'conv-2' });
      expect(result).toEqual({ kind: 'ok', conversation: CONVERSATION_ARCHIVED });
    });

    test('B: no row (not a participant, or no such id) gives conversation null', async () => {
      rpcAnswers(ok([]));

      const result = await getRideConversation('conv-404');

      expect(result).toEqual({ kind: 'ok', conversation: null });
    });
  });

  describe('MD-05: sending a message', () => {
    test('A: calls send_my_ride_message with the three named arguments and the trimmed body', async () => {
      rpcAnswers(ok(MESSAGE_ROW));

      const result = await sendRideMessage({
        conversationId: 'conv-1',
        clientMessageId: 'client-1',
        body: '  On my way \n',
      });

      const { name, args } = onlyRpcCall();
      expect(name).toBe('send_my_ride_message');
      expect(args).toEqual({
        p_conversation_id: 'conv-1',
        p_client_message_id: 'client-1',
        p_body: 'On my way',
      });
      expect(result).toEqual({ kind: 'ok', message: MESSAGE });
    });

    test('B: a one-row array answer is read the same way as a single object', async () => {
      rpcAnswers(ok([MESSAGE_ROW]));

      const result = await sendRideMessage({ conversationId: 'conv-1', clientMessageId: 'client-1', body: 'On my way' });

      expect(result).toEqual({ kind: 'ok', message: MESSAGE });
    });
  });

  describe('MD-06: reading message history', () => {
    test('A: reads ride_messages for one conversation (no RPC) and returns them oldest first', async () => {
      // The server answers newest first; two messages share a timestamp.
      fromAnswers(
        ok([
          { ...MESSAGE_ROW, id: 'msg-3', created_at: '2026-11-08T21:07:00+00:00', body: 'Third' },
          { ...MESSAGE_ROW, id: 'msg-2b', created_at: '2026-11-08T21:06:00+00:00', body: 'Second B' },
          { ...MESSAGE_ROW, id: 'msg-2a', created_at: '2026-11-08T21:06:00+00:00', body: 'Second A' },
          { ...MESSAGE_ROW, id: 'msg-1', created_at: '2026-11-08T21:05:00+00:00', body: 'First' },
        ])
      );

      const result = await loadMessages({ conversationId: 'conv-1' });

      expect(supabase.from).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledWith('ride_messages');
      expect(supabase.rpc).not.toHaveBeenCalled();
      const query = queries[0];
      const [select] = callsOf(query, 'select');
      for (const column of ['id', 'conversation_id', 'sender_id', 'client_message_id', 'body', 'created_at']) {
        expect(select[1]).toMatch(new RegExp(`\\b${column}\\b`));
      }
      expect(callsOf(query, 'eq')).toContainEqual(['eq', 'conversation_id', 'conv-1']);
      expect(result.kind).toBe('ok');
      expect(result.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2a', 'msg-2b', 'msg-3']);
      expect(result.messages[0]).toEqual({ ...MESSAGE, id: 'msg-1', body: 'First' });
    });

    test('B: a poll with `since` asks only for messages at or after that time', async () => {
      fromAnswers(ok([]));

      await loadMessages({ conversationId: 'conv-1', since: '2026-11-08T21:04:00.000Z' });

      const query = queries[0];
      expect(callsOf(query, 'eq')).toContainEqual(['eq', 'conversation_id', 'conv-1']);
      expect(callsOf(query, 'gte')).toEqual([['gte', 'created_at', '2026-11-08T21:04:00.000Z']]);
    });
  });

  describe('MD-07: conversation states and can_send come from the server unchanged', () => {
    test.each([
      ['open', true],
      ['ride_cancelled', false],
      ['seat_cancelled', false],
      ['completed', false],
    ])('%s with can_send %s', async (state, canSend) => {
      rpcAnswers(ok([{ ...ROW_OPEN, state, can_send: canSend }]));

      const result = await getRideConversation('conv-1');

      expect(result.conversation.state).toBe(state);
      expect(result.conversation.canSend).toBe(canSend);
    });

    test('a missing can_send is treated as false (never as "may send")', async () => {
      rpcAnswers(ok([{ ...ROW_OPEN, can_send: null }]));

      const result = await getRideConversation('conv-1');

      expect(result.conversation.canSend).toBe(false);
    });

    // Added in Messaging Step 3 (see the test plan): the four cases above
    // all have a state that agrees with can_send, so they can't tell
    // whether canSend really comes from can_send.
    test('state "open" with can_send false stays false (can_send is never re-derived from state)', async () => {
      rpcAnswers(ok([{ ...ROW_OPEN, state: 'open', can_send: false }]));

      const result = await getRideConversation('conv-1');

      expect(result.conversation.state).toBe('open');
      expect(result.conversation.canSend).toBe(false);
    });
  });

  describe('MD-08: every failure resolves to a result the screen can show (never throws)', () => {
    const RPC_OPERATIONS = [
      ['openRideConversation', () => openRideConversation({ rideId: 'ride-1' })],
      ['listRideConversations', () => listRideConversations()],
      ['getRideConversation', () => getRideConversation('conv-1')],
      [
        'sendRideMessage',
        () => sendRideMessage({ conversationId: 'conv-1', clientMessageId: 'client-1', body: 'Hi' }),
      ],
    ];
    const CASES = [
      [
        'P0001 (a rule the database enforces) shows the server message',
        failure('P0001', 'This ride was cancelled, so this conversation is read-only.', 400),
        { kind: 'refused', message: 'This ride was cancelled, so this conversation is read-only.' },
      ],
      [
        '55P03 (row busy) is retryable and shows the server message',
        failure('55P03', 'This ride is being updated. Please try again in a moment.', 409),
        { kind: 'retry', message: 'This ride is being updated. Please try again in a moment.' },
      ],
      [
        'PGRST202 (function missing, e.g. production) is unavailable',
        failure('PGRST202', 'Could not find the function public.open_my_ride_conversation', 404),
        { kind: 'unavailable', message: UNAVAILABLE_TEXT },
      ],
      [
        'PGRST205 (table missing) is unavailable',
        failure('PGRST205', "Could not find the table 'public.ride_conversations'", 404),
        { kind: 'unavailable', message: UNAVAILABLE_TEXT },
      ],
      [
        '42883 (undefined function) is unavailable',
        failure('42883', 'function public.ride_conversation_state does not exist', 404),
        { kind: 'unavailable', message: UNAVAILABLE_TEXT },
      ],
      [
        '42P01 (undefined table) is unavailable',
        failure('42P01', 'relation "public.ride_conversations" does not exist', 404),
        { kind: 'unavailable', message: UNAVAILABLE_TEXT },
      ],
      ['a network failure (status 0) is retryable', NETWORK_FAILURE, { kind: 'retry', message: NETWORK_TEXT }],
      [
        'a thrown fetch error is retryable',
        new TypeError('Network request failed'),
        { kind: 'retry', message: NETWORK_TEXT },
      ],
      [
        'any other error gets the generic message',
        failure('42501', 'permission denied for function open_my_ride_conversation', 403),
        { kind: 'error', message: GENERIC_TEXT },
      ],
    ];

    describe.each(RPC_OPERATIONS)('%s', (_name, run) => {
      test.each(CASES)('%s', async (_label, outcome, expected) => {
        rpcAnswers(outcome);

        const result = await run();

        expect(result).toMatchObject(expected);
      });
    });

    describe('loadMessages', () => {
      // A plain table read can't raise P0001 or 55P03, so only the cases a
      // SELECT can produce are checked.
      test.each(CASES.filter(([label]) => !/P0001|55P03|PGRST202|42883/.test(label)))(
        '%s',
        async (_label, outcome, expected) => {
          fromAnswers(outcome);

          const result = await loadMessages({ conversationId: 'conv-1' });

          expect(result).toMatchObject(expected);
        }
      );
    });
  });

  describe('MD-09: message length and empty messages are checked before anything is sent', () => {
    test.each([
      ['A: an empty message', '', EMPTY_TEXT],
      ['B: only spaces, tabs and newlines', '  \t\n  ', EMPTY_TEXT],
      ['C: 1,001 characters', longText(1001), TOO_LONG_TEXT],
      ['D: a missing body', null, EMPTY_TEXT],
    ])('%s is refused on the phone with no server call', async (_label, body, message) => {
      const result = await sendRideMessage({ conversationId: 'conv-1', clientMessageId: 'client-1', body });

      expect(result).toEqual({ kind: 'invalid', message });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    test('E: exactly 1,000 characters is sent', async () => {
      rpcAnswers(ok(MESSAGE_ROW));

      const result = await sendRideMessage({ conversationId: 'conv-1', clientMessageId: 'client-1', body: longText(1000) });

      expect(onlyRpcCall().args.p_body).toBe(longText(1000));
      expect(result.kind).toBe('ok');
    });

    test('F: 1,000 emoji are sent (the server counts characters, not UTF-16 units)', async () => {
      rpcAnswers(ok(MESSAGE_ROW));
      const emoji = '😀'.repeat(1000); // 2,000 UTF-16 units, 1,000 characters

      const result = await sendRideMessage({ conversationId: 'conv-1', clientMessageId: 'client-1', body: emoji });

      expect(onlyRpcCall().args.p_body).toBe(emoji);
      expect(result.kind).toBe('ok');
    });

    test('G: 1,000 characters with spaces around them is sent, trimmed', async () => {
      rpcAnswers(ok(MESSAGE_ROW));

      await sendRideMessage({ conversationId: 'conv-1', clientMessageId: 'client-1', body: `  ${longText(1000)}\n` });

      expect(onlyRpcCall().args.p_body).toBe(longText(1000));
    });
  });

  describe('MD-10: retries reuse the original client_message_id', () => {
    test('A: a retry sends exactly the same arguments, and the data layer never makes up its own id', async () => {
      rpcAnswers(NETWORK_FAILURE, ok(MESSAGE_ROW));
      const message = { conversationId: 'conv-1', clientMessageId: 'client-1', body: 'On my way' };

      const first = await sendRideMessage(message);
      const second = await sendRideMessage(message);

      expect(first.kind).toBe('retry');
      expect(second).toEqual({ kind: 'ok', message: MESSAGE });
      expect(supabase.rpc).toHaveBeenCalledTimes(2);
      expect(supabase.rpc.mock.calls[1]).toEqual(supabase.rpc.mock.calls[0]);
      expect(supabase.rpc.mock.calls[0][1].p_client_message_id).toBe('client-1');
      expect(Crypto.randomUUID).not.toHaveBeenCalled();
    });

    test('B: newClientMessageId returns a fresh expo-crypto UUID each time', () => {
      Crypto.randomUUID
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');

      expect(newClientMessageId()).toBe('11111111-1111-4111-8111-111111111111');
      expect(newClientMessageId()).toBe('22222222-2222-4222-8222-222222222222');
      expect(Crypto.randomUUID).toHaveBeenCalledTimes(2);
    });
  });

  test('MD-11: a pending or denied rider is refused by the server and gets no conversation', async () => {
    // open_my_ride_conversation gives everyone who isn't the driver or an
    // accepted rider the same generic refusal.
    rpcAnswers(failure('P0001', "This conversation isn't available.", 400));

    const result = await openRideConversation({ rideId: 'ride-1' });

    expect(result).toMatchObject({ kind: 'refused', message: "This conversation isn't available." });
    expect(result.conversation).toBeUndefined();
  });

  describe('MD-12: the feature flag is off unless EXPO_PUBLIC_MESSAGING_ENABLED is exactly "true"', () => {
    const saved = process.env.EXPO_PUBLIC_MESSAGING_ENABLED;
    afterEach(() => {
      if (saved === undefined) delete process.env.EXPO_PUBLIC_MESSAGING_ENABLED;
      else process.env.EXPO_PUBLIC_MESSAGING_ENABLED = saved;
    });

    test.each([
      ['not set', undefined, false],
      ['empty', '', false],
      ['"false"', 'false', false],
      ['"1"', '1', false],
      ['"TRUE"', 'TRUE', false],
      ['"true"', 'true', true],
    ])('%s (value %p) gives enabled = %p', (_label, value, expected) => {
      if (value === undefined) delete process.env.EXPO_PUBLIC_MESSAGING_ENABLED;
      else process.env.EXPO_PUBLIC_MESSAGING_ENABLED = value;

      // A fresh copy of the module, in case it reads the flag when loaded.
      let enabled;
      jest.isolateModules(() => {
        enabled = require('../lib/messaging').isMessagingEnabled();
      });

      expect(enabled).toBe(expected);
    });
  });

  describe('MD-13: safety', () => {
    test('A: lib/messaging.js uses the shared publishable-key client and no secret key', () => {
      const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'messaging.js'), 'utf8');

      expect(source).toMatch(/from ['"]\.\/supabase['"]/);
      expect(source).not.toMatch(/createClient/);
      expect(source).not.toMatch(/service[_-]?role|secret/i);
    });

    // Runs last in this file (Jest keeps file order).
    test('B: no test in this file made a real network request', () => {
      expect(networkRequests).toBe(0);
    });
  });
});
