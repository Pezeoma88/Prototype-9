// Automated tests for the private conversation screen (chat bubbles,
// timestamps, history, composer, read-only states and polling).
// The test cases and their expected results are defined in
// PROTOTYPE-9-TEST-PLAN.md ("Messaging test cases"), where they were
// recorded before screens/ConversationScreen.js was written.
//
// Real code under test: screens/ConversationScreen.js and whatever it uses
// to load, poll and send (its hook and components).
// Faked: lib/messaging (the data layer, tested on its own in
// messaging-data-test.js; faking it here means no Supabase client exists
// at all), the icon font, AppState (so the test can move the app to the
// background), and the clock (Jest fake timers at a fixed "now").
//
// Times: the tests run in America/Chicago. "Now" is Sunday, November 8,
// 2026, 4:00 PM there (22:00 UTC). Expected labels are written out here, not
// produced by the app's own formatting code.

import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as messaging from '../lib/messaging';
import ConversationScreen from '../screens/ConversationScreen';

process.env.TZ = 'America/Chicago';

jest.mock('../lib/messaging', () => ({
  isMessagingEnabled: jest.fn(),
  getRideConversation: jest.fn(),
  loadMessages: jest.fn(),
  sendRideMessage: jest.fn(),
  newClientMessageId: jest.fn(),
}));

jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text testID={`icon-${name}`} />,
  };
});

// --- Test data -------------------------------------------------------------

const NOW = new Date('2026-11-08T22:00:00Z'); // 4:00 PM in Chicago
const POLL_MS = 5000;

const ME = { id: 'rider-a', name: 'Riley Rider' };
const OTHER_NAME = 'Dana Driver';

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
  createdAt: '2026-11-07T23:00:00.000Z',
  lastMessageAt: '2026-11-08T21:06:00.000Z',
};

const message = (id, senderId, body, createdAt, clientMessageId = `client-${id}`) => ({
  id,
  conversationId: 'conv-1',
  senderId,
  clientMessageId,
  body,
  createdAt,
});

const HISTORY = [
  message('m-1', 'driver-1', 'Pickup at Fondren?', '2026-11-07T23:30:00.000Z'), // yesterday 5:30 PM
  message('m-2', 'rider-a', 'Yes, see you there', '2026-11-08T21:05:00.000Z'), // today 3:05 PM
  message('m-3', 'driver-1', 'Running 5 min late', '2026-11-08T21:06:00.000Z'), // today 3:06 PM
];
const NEWEST_HISTORY_AT = '2026-11-08T21:06:00.000Z';

// The server's copy of a message the test sends ("On my way", 3:59 PM).
const SENT = message('m-4', 'rider-a', 'On my way', '2026-11-08T21:59:00.000Z', 'client-new-1');

// Expected user-facing text, written out here (see the test plan).
const READ_ONLY_TEXT = {
  ride_cancelled: 'This ride was cancelled, so this conversation is read-only.',
  seat_cancelled: 'This seat is no longer confirmed, so this conversation is read-only.',
  completed: 'This ride has ended, so this conversation is read-only.',
};
const GENERIC_READ_ONLY_TEXT = 'This conversation is read-only.';
const UNAVAILABLE_TEXT = "Messaging isn't available yet.";
const NOT_FOUND_TEXT = "This conversation isn't available.";
const NETWORK_TEXT = "Couldn't reach CarpoolBoard. Check your connection and try again.";
const TOO_LONG_TEXT = 'Messages can be at most 1000 characters.';

// --- Helpers ---------------------------------------------------------------

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A bubble's accessibility label: "<who>, <time>: <text>". Node writes the
// space before AM/PM as a narrow no-break space, so either space matches.
function bubble(who, time, body) {
  const timePattern = escape(time).replace(' ', '[\\s\\u202f]');
  return new RegExp(`^${escape(who)}, ${timePattern}: ${escape(body)}$`);
}

const flush = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });

const advance = (ms) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

let appStateListeners = [];

async function setAppState(state) {
  AppState.currentState = state;
  await act(async () => {
    appStateListeners.forEach((listener) => listener(state));
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function renderConversation() {
  const onBack = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ConversationScreen
        conversationId="conv-1"
        currentUser={ME}
        otherPersonName={OTHER_NAME}
        onBack={onBack}
      />
    </SafeAreaProvider>
  );
  await flush();
  return { onBack };
}

const composer = () => screen.queryByLabelText('Type a message');
const sendButton = () => screen.queryByRole('button', { name: 'Send' });

async function type(text) {
  await fireEvent.changeText(screen.getByLabelText('Type a message'), text);
}

function expectNoComposer() {
  expect(composer()).toBeNull();
  expect(sendButton()).toBeNull();
}

function expectComposer() {
  expect(composer()).toBeOnTheScreen();
  expect(sendButton()).toBeOnTheScreen();
}

// --- Setup -----------------------------------------------------------------

beforeAll(() => {
  // A wrong time zone would make every time label fail for reasons that
  // have nothing to do with the app. Stop early with a clear message.
  if (new Date('2026-11-08T21:05:00Z').getHours() !== 15) {
    throw new Error('Test setup problem: TZ=America/Chicago did not take effect.');
  }
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers({ now: NOW });

  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((l) => l !== listener);
      },
    };
  });
  AppState.currentState = 'active';

  messaging.isMessagingEnabled.mockReturnValue(true);
  messaging.getRideConversation.mockResolvedValue({ kind: 'ok', conversation: CONVERSATION_OPEN });
  messaging.loadMessages
    .mockResolvedValueOnce({ kind: 'ok', messages: HISTORY })
    .mockResolvedValue({ kind: 'ok', messages: [] });
  messaging.newClientMessageId.mockReturnValue('client-new-1');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// --- Tests -----------------------------------------------------------------

describe('Conversation screen', () => {
  test('MC-01: shows the history oldest first, my bubbles apart from theirs, with times and day labels', async () => {
    await renderConversation();

    expect(messaging.getRideConversation).toHaveBeenCalledWith('conv-1');
    expect(messaging.loadMessages).toHaveBeenCalledTimes(1);
    expect(messaging.loadMessages.mock.calls[0][0]).toMatchObject({ conversationId: 'conv-1' });

    const labels = screen
      .getAllByLabelText(/^(You|Dana Driver), /)
      .map((node) => node.props.accessibilityLabel ?? node.props['aria-label']);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(bubble('Dana Driver', '5:30 PM', 'Pickup at Fondren?'));
    expect(labels[1]).toMatch(bubble('You', '3:05 PM', 'Yes, see you there'));
    expect(labels[2]).toMatch(bubble('Dana Driver', '3:06 PM', 'Running 5 min late'));

    expect(screen.getByText('Yesterday')).toBeOnTheScreen();
    expect(screen.getByText('Today')).toBeOnTheScreen();
    expect(screen.getAllByText(OTHER_NAME).length).toBeGreaterThan(0);
    expect(screen.getByText(/Downtown Dallas/)).toBeOnTheScreen();
    expectComposer();
  });

  describe('MC-02: archived conversations are read-only but keep their history', () => {
    test.each(Object.entries(READ_ONLY_TEXT))('%s', async (state, text) => {
      messaging.getRideConversation.mockResolvedValue({
        kind: 'ok',
        conversation: { ...CONVERSATION_OPEN, state, canSend: false },
      });

      await renderConversation();

      expect(screen.getByText(text)).toBeOnTheScreen();
      expectNoComposer();
      expect(screen.getByLabelText(bubble('You', '3:05 PM', 'Yes, see you there'))).toBeOnTheScreen();
    });

    test('open: the composer is shown and no read-only notice', async () => {
      await renderConversation();

      expectComposer();
      for (const text of [...Object.values(READ_ONLY_TEXT), GENERIC_READ_ONLY_TEXT]) {
        expect(screen.queryByText(text)).toBeNull();
      }
    });
  });

  describe('MC-03: can_send from the server alone decides whether the composer is available', () => {
    test('A: state "open" but can_send false: no composer', async () => {
      messaging.getRideConversation.mockResolvedValue({
        kind: 'ok',
        conversation: { ...CONVERSATION_OPEN, state: 'open', canSend: false },
      });

      await renderConversation();

      expectNoComposer();
      expect(screen.getByText(GENERIC_READ_ONLY_TEXT)).toBeOnTheScreen();
    });

    test('B: can_send true: the composer is shown whatever the state says', async () => {
      messaging.getRideConversation.mockResolvedValue({
        kind: 'ok',
        conversation: { ...CONVERSATION_OPEN, state: 'completed', canSend: true },
      });

      await renderConversation();

      expectComposer();
    });
  });

  test('MC-04: sending shows the message at once, clears the composer, and confirms it with the server time', async () => {
    let resolveSend;
    messaging.sendRideMessage.mockImplementation(
      () => new Promise((resolve) => (resolveSend = resolve))
    );
    await renderConversation();

    await type('  On my way  ');
    // Awaited: in Testing Library 14 an un-awaited press overlaps the next
    // act() and breaks later tests (see T-2). The send itself stays pending.
    await fireEvent.press(sendButton());
    await flush();

    expect(messaging.sendRideMessage).toHaveBeenCalledTimes(1);
    expect(messaging.sendRideMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      clientMessageId: 'client-new-1',
      body: 'On my way',
    });
    expect(screen.getByLabelText('Type a message')).toHaveDisplayValue('');
    expect(screen.getByText('On my way')).toBeOnTheScreen();
    expect(screen.getByText('Sending…')).toBeOnTheScreen();

    resolveSend({ kind: 'ok', message: SENT });
    await flush();

    expect(screen.queryByText('Sending…')).toBeNull();
    expect(screen.getAllByText('On my way')).toHaveLength(1);
    expect(screen.getByLabelText(bubble('You', '3:59 PM', 'On my way'))).toBeOnTheScreen();
  });

  test('MC-05: an empty or blank message cannot be sent', async () => {
    await renderConversation();

    expect(sendButton()).toBeDisabled();
    await type('   \n  ');
    expect(sendButton()).toBeDisabled();
    await fireEvent.press(sendButton());

    expect(messaging.sendRideMessage).not.toHaveBeenCalled();
  });

  test('MC-06: 1,000 characters can be sent; 1,001 cannot, and the limit is explained', async () => {
    await renderConversation();

    await type('a'.repeat(1000));
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByText(TOO_LONG_TEXT)).toBeNull();

    await type('a'.repeat(1001));
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText(TOO_LONG_TEXT)).toBeOnTheScreen();
    await fireEvent.press(sendButton());
    expect(messaging.sendRideMessage).not.toHaveBeenCalled();
  });

  test('MC-07: Retry on a failed message reuses its original client_message_id', async () => {
    messaging.sendRideMessage
      .mockResolvedValueOnce({ kind: 'retry', message: NETWORK_TEXT })
      .mockResolvedValueOnce({ kind: 'ok', message: SENT });
    await renderConversation();

    await type('On my way');
    await fireEvent.press(sendButton());
    await flush();

    expect(screen.getByText('Not sent')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /Retry/ }));
    await flush();

    expect(messaging.sendRideMessage).toHaveBeenCalledTimes(2);
    expect(messaging.sendRideMessage.mock.calls[1][0]).toEqual({
      conversationId: 'conv-1',
      clientMessageId: 'client-new-1',
      body: 'On my way',
    });
    expect(messaging.newClientMessageId).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Not sent')).toBeNull();
    expect(screen.getAllByText('On my way')).toHaveLength(1);
    expect(screen.getByLabelText(bubble('You', '3:59 PM', 'On my way'))).toBeOnTheScreen();
  });

  describe('MC-08: duplicate sends never show or send a message twice', () => {
    test('A: a double tap on Send sends once', async () => {
      messaging.sendRideMessage.mockImplementation(() => new Promise(() => {}));
      await renderConversation();

      await type('On my way');
      // Two taps in a row while the first send is still pending. Each press
      // is awaited (see T-2): Testing Library 14 can't deliver two presses
      // inside one render without overlapping act() calls.
      await fireEvent.press(sendButton());
      await fireEvent.press(sendButton());
      await flush();

      expect(messaging.sendRideMessage).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('On my way')).toHaveLength(1);
    });

    test('B: the next poll returning the message just sent does not add a second bubble', async () => {
      messaging.sendRideMessage.mockResolvedValue({ kind: 'ok', message: SENT });
      messaging.loadMessages.mockReset();
      messaging.loadMessages
        .mockResolvedValueOnce({ kind: 'ok', messages: HISTORY })
        .mockResolvedValue({ kind: 'ok', messages: [SENT] });
      await renderConversation();

      await type('On my way');
      await fireEvent.press(sendButton());
      await flush();
      await advance(POLL_MS);

      expect(screen.getAllByText('On my way')).toHaveLength(1);
    });

    test('C: a "Not sent" message that the server did save is replaced by the saved one when a poll finds it', async () => {
      // The reply was lost, but the message reached the server.
      messaging.sendRideMessage.mockResolvedValue({ kind: 'retry', message: NETWORK_TEXT });
      messaging.loadMessages.mockReset();
      messaging.loadMessages
        .mockResolvedValueOnce({ kind: 'ok', messages: HISTORY })
        .mockResolvedValue({ kind: 'ok', messages: [SENT] });
      await renderConversation();

      await type('On my way');
      await fireEvent.press(sendButton());
      await flush();
      expect(screen.getByText('Not sent')).toBeOnTheScreen();

      await advance(POLL_MS);

      expect(screen.queryByText('Not sent')).toBeNull();
      expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
      expect(screen.getAllByText('On my way')).toHaveLength(1);
      expect(screen.getByLabelText(bubble('You', '3:59 PM', 'On my way'))).toBeOnTheScreen();
    });
  });

  test('MC-09: a refused send shows the server reason and re-checks the conversation at once', async () => {
    messaging.sendRideMessage.mockResolvedValue({ kind: 'refused', message: READ_ONLY_TEXT.ride_cancelled });
    messaging.getRideConversation
      .mockResolvedValueOnce({ kind: 'ok', conversation: CONVERSATION_OPEN })
      .mockResolvedValue({
        kind: 'ok',
        conversation: { ...CONVERSATION_OPEN, rideId: null, state: 'ride_cancelled', canSend: false },
      });
    await renderConversation();

    await type('On my way');
    await fireEvent.press(sendButton());
    await flush();

    // Re-checked straight away, not on the next poll.
    expect(messaging.getRideConversation).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(READ_ONLY_TEXT.ride_cancelled).length).toBeGreaterThan(0);
    expectNoComposer();
  });

  describe('MC-10: polling every 5 seconds while the screen is open and the app is active', () => {
    test('A: polls messages and the conversation state every 5 seconds', async () => {
      await renderConversation();
      expect(messaging.loadMessages).toHaveBeenCalledTimes(1);
      expect(messaging.getRideConversation).toHaveBeenCalledTimes(1);

      await advance(POLL_MS - 1);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(1);

      await advance(1);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(2);
      expect(messaging.getRideConversation).toHaveBeenCalledTimes(2);

      await advance(POLL_MS);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(3);
      expect(messaging.getRideConversation).toHaveBeenCalledTimes(3);
    });

    test('B: a poll asks from no later than the newest message it has, so a late-saved message is not skipped', async () => {
      await renderConversation();
      await advance(POLL_MS);

      const pollArgs = messaging.loadMessages.mock.calls[1][0];
      expect(pollArgs.conversationId).toBe('conv-1');
      expect(typeof pollArgs.since).toBe('string');
      expect(Date.parse(pollArgs.since)).toBeLessThanOrEqual(Date.parse(NEWEST_HISTORY_AT));
    });

    test('C: a new message from the other person appears after the next poll', async () => {
      messaging.loadMessages.mockReset();
      messaging.loadMessages
        .mockResolvedValueOnce({ kind: 'ok', messages: HISTORY })
        .mockResolvedValue({
          kind: 'ok',
          messages: [message('m-5', 'driver-1', "I'm here", '2026-11-08T21:58:00.000Z')],
        });
      await renderConversation();
      expect(screen.queryByText("I'm here")).toBeNull();

      await advance(POLL_MS);

      expect(screen.getByLabelText(bubble('Dana Driver', '3:58 PM', "I'm here"))).toBeOnTheScreen();
    });

    test('D: a poll that finds the seat cancelled turns the chat read-only without reopening it', async () => {
      messaging.getRideConversation
        .mockResolvedValueOnce({ kind: 'ok', conversation: CONVERSATION_OPEN })
        .mockResolvedValue({
          kind: 'ok',
          conversation: { ...CONVERSATION_OPEN, state: 'seat_cancelled', canSend: false },
        });
      await renderConversation();
      expectComposer();

      await advance(POLL_MS);

      expectNoComposer();
      expect(screen.getByText(READ_ONLY_TEXT.seat_cancelled)).toBeOnTheScreen();
      expect(screen.getByLabelText(bubble('You', '3:05 PM', 'Yes, see you there'))).toBeOnTheScreen();
    });

    test('E: no polling in the background; returning to the app checks at once, then every 5 seconds', async () => {
      await renderConversation();

      await setAppState('background');
      await advance(POLL_MS * 4);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(1);

      await setAppState('active');
      expect(messaging.loadMessages).toHaveBeenCalledTimes(2);

      await advance(POLL_MS);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(3);
    });

    test('F: leaving the screen stops polling and removes its app-state listener', async () => {
      await renderConversation();

      await act(async () => {
        screen.unmount();
      });
      await advance(POLL_MS * 4);

      expect(messaging.loadMessages).toHaveBeenCalledTimes(1);
      expect(messaging.getRideConversation).toHaveBeenCalledTimes(1);
      expect(appStateListeners).toHaveLength(0);
    });

    test('G: a slow poll is never overlapped by the next one', async () => {
      messaging.loadMessages.mockReset();
      messaging.loadMessages
        .mockResolvedValueOnce({ kind: 'ok', messages: HISTORY })
        .mockImplementation(() => new Promise(() => {})); // the 2nd poll never answers
      await renderConversation();

      await advance(POLL_MS);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(2);

      await advance(POLL_MS * 3);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(2);
    });

    test('H: a failed poll keeps the history on screen and polling continues', async () => {
      messaging.loadMessages.mockReset();
      messaging.loadMessages
        .mockResolvedValueOnce({ kind: 'ok', messages: HISTORY })
        .mockResolvedValueOnce({ kind: 'retry', message: NETWORK_TEXT })
        .mockResolvedValue({ kind: 'ok', messages: [] });
      await renderConversation();

      await advance(POLL_MS);
      expect(screen.getByLabelText(bubble('You', '3:05 PM', 'Yes, see you there'))).toBeOnTheScreen();

      await advance(POLL_MS);
      expect(messaging.loadMessages).toHaveBeenCalledTimes(3);
    });
  });

  describe('MC-11: messaging that is unavailable or a conversation the user cannot see', () => {
    test('A: messaging not set up on this server (e.g. production): explained, no composer', async () => {
      messaging.getRideConversation.mockResolvedValue({ kind: 'unavailable', message: UNAVAILABLE_TEXT });
      messaging.loadMessages.mockReset();
      messaging.loadMessages.mockResolvedValue({ kind: 'unavailable', message: UNAVAILABLE_TEXT });

      await renderConversation();

      expect(screen.getAllByText(UNAVAILABLE_TEXT).length).toBeGreaterThan(0);
      expectNoComposer();
    });

    test('B: no such conversation for this user: explained, no composer', async () => {
      messaging.getRideConversation.mockResolvedValue({ kind: 'ok', conversation: null });

      await renderConversation();

      expect(screen.getByText(NOT_FOUND_TEXT)).toBeOnTheScreen();
      expectNoComposer();
    });
  });

  test('MC-12: Back leaves the conversation', async () => {
    const { onBack } = await renderConversation();

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
