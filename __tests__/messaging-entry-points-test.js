// Automated tests for where messaging is reached from: the Message buttons
// on accepted rides (Ride Details and the Requests tab) and the Messages
// list at the top of the Requests tab, which also keeps archived chats
// reachable.
// The test cases and their expected results are defined in
// PROTOTYPE-9-TEST-PLAN.md ("Messaging test cases"), where they were
// recorded before any messaging code was written.
//
// Real code under test: screens/RideDetailsScreen.js and
// screens/RequestsScreen.js with their real components.
// Faked: lib/supabase (RequestsScreen imports lib/reviews, which imports
// the client; the fake means no client is created and nothing can reach a
// server), react-native-maps (Ride Details imports the pickup preview), and
// the icon font.
//
// New props these tests expect (see the test plan): `messagingEnabled`,
// `onMessage({ rideId, riderId })`, and on Ride Details `nowMs`; on the
// Requests tab also `conversations`, `conversationsError` and
// `onOpenConversation(conversationId)`. The screens get the flag as a prop
// from App.js, so leaving it out must mean "off".

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import RideDetailsScreen from '../screens/RideDetailsScreen';
import RequestsScreen from '../screens/RequestsScreen';

jest.mock('../lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View />, Marker: () => null, Polyline: () => null };
});

jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text testID={`icon-${name}`} />,
  };
});

// --- Test data -------------------------------------------------------------

const NOW_MS = Date.parse('2026-11-08T22:00:00Z');
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const DRIVER = { id: 'driver-1', name: 'Dana Driver' };
const RIDER_A = { id: 'rider-a', name: 'Riley Rider' };
const PENDING_RIDER = { id: 'rider-p', name: 'Pat Pending' };

function makeRide(overrides = {}) {
  return {
    id: 'ride-1',
    driverAccountId: 'driver-1',
    name: 'Dana Driver',
    avatarUrl: null,
    destination: 'Downtown Dallas',
    pickup: null,
    destinationPoint: null,
    departureAt: new Date(NOW_MS + 24 * HOUR),
    departureTime: 'Mon, Nov 9 · 4:00 PM',
    totalSeats: 3,
    seats: 1,
    driverRating: null,
    matchedRiders: [
      { id: 'rider-a', requestId: 'req-a', name: 'Riley Rider', avatarUrl: null },
      { id: 'rider-b', requestId: 'req-b', name: 'Bo Rider', avatarUrl: null },
    ],
    pendingRequests: [
      { id: 'req-p', riderId: 'rider-p', name: 'Pat Pending', reason: '', avatarUrl: null },
    ],
    ...overrides,
  };
}

// Conversations as App.js will pass them to the Requests tab: the data
// layer's shape plus the other person's name.
const CONVERSATIONS = [
  {
    id: 'conv-1',
    rideId: 'ride-1',
    driverId: 'driver-1',
    riderId: 'rider-a',
    myRole: 'rider',
    rideDestination: 'Downtown Dallas',
    rideDepartureAt: new Date(NOW_MS + 24 * HOUR),
    state: 'open',
    canSend: true,
    createdAt: '2026-11-08T20:00:00.000Z',
    lastMessageAt: '2026-11-08T21:06:00.000Z',
    otherPersonName: 'Dana Driver',
  },
  {
    id: 'conv-2',
    rideId: null,
    driverId: 'driver-9',
    riderId: 'rider-a',
    myRole: 'rider',
    rideDestination: 'Love Field',
    rideDepartureAt: new Date(NOW_MS - 3 * 24 * HOUR),
    state: 'ride_cancelled',
    canSend: false,
    createdAt: '2026-11-04T20:00:00.000Z',
    lastMessageAt: '2026-11-04T21:00:00.000Z',
    otherPersonName: 'Cass Driver',
  },
];

// --- Helpers ---------------------------------------------------------------

const MESSAGE_BUTTON = /^Message /;
const CONVERSATION_ROW = /^Conversation with /;

function rideDetailsProps(overrides = {}) {
  return {
    detailsDriver: makeRide(),
    currentUser: DRIVER,
    activeMode: 'driver',
    handleSwitchMode: jest.fn(),
    requestNotice: '',
    requestSubmission: null,
    myRequestStatus: null,
    handleAbandonSubmission: jest.fn(),
    handleRetrySubmission: jest.fn(),
    handleCheckSubmissionAgain: jest.fn(),
    handleDismissSubmission: jest.fn(),
    handleWithdrawArrivedRequest: jest.fn(),
    isOwnerDriver: true,
    isOwnDetailsRide: true,
    isDeparted: false,
    reservingDriverId: null,
    requestReasonInput: '',
    setRequestReasonInput: jest.fn(),
    handleBackToAvailableRides: jest.fn(),
    handleAcceptRequest: jest.fn(),
    handleDenyRequest: jest.fn(),
    handleCancelConfirmedSeat: jest.fn(),
    handleBeginRequest: jest.fn(),
    handleRequestRide: jest.fn(),
    handleCancelReserve: jest.fn(),
    handleStartEditRide: jest.fn(),
    handleCancelRide: jest.fn(),
    driverReviews: [],
    reviewEligibility: { status: 'not_eligible' },
    handleSubmitReview: jest.fn(),
    // New in messaging:
    messagingEnabled: true,
    nowMs: NOW_MS,
    onMessage: jest.fn(),
    ...overrides,
  };
}

// The same screen as seen by accepted rider Riley in Rider mode.
const RIDER_VIEW = {
  currentUser: RIDER_A,
  activeMode: 'rider',
  isOwnerDriver: false,
  isOwnDetailsRide: false,
  myRequestStatus: 'accepted',
};

function requestsProps(overrides = {}) {
  return {
    currentUser: RIDER_A,
    activeMode: 'rider',
    handleSetMode: jest.fn(),
    drivers: [],
    nowMs: NOW_MS,
    myRequestRows: [],
    isBoardLoading: false,
    isRefreshing: false,
    boardError: '',
    requestNotice: '',
    handleRefresh: jest.fn(),
    handleAcceptRequest: jest.fn(),
    handleDenyRequest: jest.fn(),
    handleWithdrawRequest: jest.fn(),
    handleCancelConfirmedSeat: jest.fn(),
    myReviewByRideId: {},
    reviewsLoaded: false,
    onOpenRide: jest.fn(),
    onGoHome: jest.fn(),
    // New in messaging:
    messagingEnabled: true,
    conversations: [],
    conversationsError: '',
    onMessage: jest.fn(),
    onOpenConversation: jest.fn(),
    ...overrides,
  };
}

// Rider Riley's Requests tab: one request in each status, each on a
// different driver's upcoming ride.
const RIDER_RIDES = [
  makeRide({ id: 'ride-1', driverAccountId: 'driver-1', name: 'Dana Driver' }),
  makeRide({ id: 'ride-2', driverAccountId: 'driver-2', name: 'Pete Driver', matchedRiders: [] }),
  makeRide({ id: 'ride-3', driverAccountId: 'driver-3', name: 'Dee Driver', matchedRiders: [] }),
  makeRide({ id: 'ride-4', driverAccountId: 'driver-4', name: 'Cass Driver', matchedRiders: [] }),
];
const RIDER_REQUEST_ROWS = [
  { id: 'req-a', ride_id: 'ride-1', rider_id: 'rider-a', reason: null, status: 'accepted' },
  { id: 'req-2', ride_id: 'ride-2', rider_id: 'rider-a', reason: null, status: 'pending' },
  { id: 'req-3', ride_id: 'ride-3', rider_id: 'rider-a', reason: null, status: 'denied' },
  { id: 'req-4', ride_id: 'ride-4', rider_id: 'rider-a', reason: null, status: 'cancelled' },
];
const RIDER_REQUESTS = { drivers: RIDER_RIDES, myRequestRows: RIDER_REQUEST_ROWS };
const DRIVER_REQUESTS = { currentUser: DRIVER, activeMode: 'driver', drivers: [makeRide()] };

// A button's accessible name: its label if it has one, else its text.
function textOf(node) {
  if (typeof node === 'string') return node;
  return (node.children || []).map(textOf).join('');
}
function accessibleName(node) {
  return node.props.accessibilityLabel ?? node.props['aria-label'] ?? textOf(node);
}

function messageButtonNames() {
  return screen.queryAllByRole('button', { name: MESSAGE_BUTTON }).map(accessibleName);
}

beforeEach(() => {
  jest.resetAllMocks();
});

// --- Tests -----------------------------------------------------------------

describe('Messaging entry points', () => {
  describe('ME-01: with the flag off (prop left out), nothing about messaging shows and existing controls stay', () => {
    const { messagingEnabled: _drop, ...driverDetails } = rideDetailsProps();

    test('A: Ride Details, driver', async () => {
      await render(<RideDetailsScreen {...driverDetails} />);

      expect(screen.queryAllByRole('button', { name: MESSAGE_BUTTON })).toHaveLength(0);
      expect(screen.getAllByRole('button', { name: 'Deny' })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Accept' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Edit Ride' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Cancel Ride' })).toBeOnTheScreen();
    });

    test('B: Ride Details, accepted rider', async () => {
      await render(<RideDetailsScreen {...driverDetails} {...RIDER_VIEW} />);

      expect(screen.queryAllByRole('button', { name: MESSAGE_BUTTON })).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Leave' })).toBeOnTheScreen();
    });

    test('C: Requests tab, rider, even when conversations are passed in', async () => {
      const { messagingEnabled: _off, ...props } = requestsProps({ ...RIDER_REQUESTS, conversations: CONVERSATIONS });
      await render(<RequestsScreen {...props} />);

      expect(screen.queryAllByRole('button', { name: MESSAGE_BUTTON })).toHaveLength(0);
      expect(screen.queryAllByRole('button', { name: CONVERSATION_ROW })).toHaveLength(0);
      expect(screen.queryByText('Messages')).toBeNull();
      expect(screen.getByRole('button', { name: 'Leave Seat' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Withdraw' })).toBeOnTheScreen();
    });

    test('D: Requests tab, driver', async () => {
      const { messagingEnabled: _off, ...props } = requestsProps({ ...DRIVER_REQUESTS, conversations: CONVERSATIONS });
      await render(<RequestsScreen {...props} />);

      expect(screen.queryAllByRole('button', { name: MESSAGE_BUTTON })).toHaveLength(0);
      expect(screen.queryByText('Messages')).toBeNull();
      expect(screen.getByRole('button', { name: 'Accept' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeOnTheScreen();
    });
  });

  test('ME-02: Ride Details, driver: one Message button per confirmed rider, opening that rider’s chat', async () => {
    const props = rideDetailsProps();
    await render(<RideDetailsScreen {...props} />);

    expect(messageButtonNames()).toEqual(['Message Riley Rider', 'Message Bo Rider']);
    await fireEvent.press(screen.getByRole('button', { name: 'Message Bo Rider' }));

    expect(props.onMessage).toHaveBeenCalledTimes(1);
    expect(props.onMessage).toHaveBeenCalledWith({ rideId: 'ride-1', riderId: 'rider-b' });
    // Existing driver controls are still there.
    expect(screen.getByRole('button', { name: 'Edit Ride' })).toBeOnTheScreen();
  });

  test('ME-03: Ride Details, accepted rider: one Message button for the driver, none for other passengers', async () => {
    const props = rideDetailsProps(RIDER_VIEW);
    await render(<RideDetailsScreen {...props} />);

    expect(messageButtonNames()).toEqual(['Message Dana Driver']);
    await fireEvent.press(screen.getByRole('button', { name: 'Message Dana Driver' }));

    // The rider never names a rider; the server takes it from the session.
    expect(props.onMessage).toHaveBeenCalledWith({ rideId: 'ride-1', riderId: null });
    expect(screen.getByRole('button', { name: 'Leave' })).toBeOnTheScreen();
  });

  describe('ME-04: pending and denied requests cannot open a conversation', () => {
    test('A: the driver gets no Message button for a pending request', async () => {
      await render(<RideDetailsScreen {...rideDetailsProps()} />);

      expect(messageButtonNames()).not.toContain('Message Pat Pending');
      expect(screen.getByRole('button', { name: 'Accept' })).toBeOnTheScreen();
    });

    test.each(['pending', 'denied', 'cancelled'])(
      'B: a rider whose request is %s sees no Message button on Ride Details',
      async (status) => {
        const ride = makeRide(
          status === 'pending'
            ? {}
            : { pendingRequests: [] } // a denied/cancelled request is in neither list
        );
        await render(
          <RideDetailsScreen
            {...rideDetailsProps({
              ...RIDER_VIEW,
              detailsDriver: ride,
              currentUser: PENDING_RIDER,
              myRequestStatus: status,
            })}
          />
        );

        expect(screen.queryAllByRole('button', { name: MESSAGE_BUTTON })).toHaveLength(0);
      }
    );
  });

  test('ME-05: Requests tab, rider: Message only on the Confirmed request; pending, denied and cancelled get none', async () => {
    const props = requestsProps(RIDER_REQUESTS);
    await render(<RequestsScreen {...props} />);

    expect(messageButtonNames()).toEqual(['Message Dana Driver']);
    await fireEvent.press(screen.getByRole('button', { name: 'Message Dana Driver' }));

    expect(props.onMessage).toHaveBeenCalledWith({ rideId: 'ride-1', riderId: null });
    // Existing controls are still there.
    expect(screen.getByRole('button', { name: 'Leave Seat' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeOnTheScreen();
  });

  test('ME-06: Requests tab, driver: Message on each confirmed passenger, none on incoming requests', async () => {
    const props = requestsProps(DRIVER_REQUESTS);
    await render(<RequestsScreen {...props} />);

    expect(messageButtonNames()).toEqual(['Message Riley Rider', 'Message Bo Rider']);
    await fireEvent.press(screen.getByRole('button', { name: 'Message Riley Rider' }));

    expect(props.onMessage).toHaveBeenCalledWith({ rideId: 'ride-1', riderId: 'rider-a' });
    expect(screen.getByRole('button', { name: 'Accept' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeOnTheScreen();
  });

  describe('ME-07: Message buttons stay until 2 hours after departure (the server’s grace period)', () => {
    test.each([
      ['1 h 59 min after departure', 2 * HOUR - MINUTE, ['Message Riley Rider', 'Message Bo Rider']],
      ['exactly 2 h after departure', 2 * HOUR, []],
      ['3 h after departure', 3 * HOUR, []],
    ])('%s', async (_label, sinceDeparture, expected) => {
      const ride = makeRide({ departureAt: new Date(NOW_MS - sinceDeparture) });
      await render(<RideDetailsScreen {...rideDetailsProps({ detailsDriver: ride, isDeparted: true })} />);

      expect(messageButtonNames()).toEqual(expected);
    });
  });

  describe('ME-08: the Messages list at the top of the Requests tab', () => {
    test('A: lists conversations above Confirmed; archived ones are marked read-only (with the reason) and still open', async () => {
      const props = requestsProps({ ...RIDER_REQUESTS, conversations: CONVERSATIONS });
      await render(<RequestsScreen {...props} />);

      const headings = screen.getAllByText(/^(Messages|Confirmed)$/).map((node) => node.props.children);
      expect(headings[0]).toBe('Messages');

      const rows = screen.getAllByRole('button', { name: CONVERSATION_ROW });
      expect(rows).toHaveLength(2);
      expect(accessibleName(rows[0])).toMatch(/^Conversation with Dana Driver/);
      expect(accessibleName(rows[1])).toMatch(/^Conversation with Cass Driver/);
      expect(accessibleName(rows[1])).toMatch(/read-only/);
      expect(within(rows[0]).getByText(/Downtown Dallas/)).toBeOnTheScreen();
      expect(within(rows[0]).queryByText('Ride cancelled')).toBeNull();
      expect(within(rows[1]).getByText('Ride cancelled')).toBeOnTheScreen();

      await fireEvent.press(rows[1]);
      expect(props.onOpenConversation).toHaveBeenCalledTimes(1);
      expect(props.onOpenConversation).toHaveBeenCalledWith('conv-2');
    });

    test('B: no conversations yet', async () => {
      await render(<RequestsScreen {...requestsProps(RIDER_REQUESTS)} />);

      expect(screen.getByText('Messages')).toBeOnTheScreen();
      expect(screen.getByText('No conversations yet.')).toBeOnTheScreen();
    });

    test('C: the list could not be loaded (e.g. messaging not set up on this server)', async () => {
      await render(
        <RequestsScreen
          {...requestsProps({ ...RIDER_REQUESTS, conversations: [], conversationsError: "Messaging isn't available yet." })}
        />
      );

      expect(screen.getByText("Messaging isn't available yet.")).toBeOnTheScreen();
    });
  });

  describe('ME-09: archived chats stay reachable when their ride or request is gone', () => {
    test('A: rider whose only ride was cancelled (no requests left)', async () => {
      const props = requestsProps({ drivers: [], myRequestRows: [], conversations: [CONVERSATIONS[1]] });
      await render(<RequestsScreen {...props} />);

      await fireEvent.press(screen.getByRole('button', { name: /^Conversation with Cass Driver/ }));
      expect(props.onOpenConversation).toHaveBeenCalledWith('conv-2');
      // The existing empty state is still shown below it.
      expect(screen.getByText('No ride requests yet')).toBeOnTheScreen();
    });

    test('B: driver with no rides left', async () => {
      const archived = { ...CONVERSATIONS[1], myRole: 'driver', otherPersonName: 'Riley Rider' };
      const props = requestsProps({ currentUser: DRIVER, activeMode: 'driver', drivers: [], conversations: [archived] });
      await render(<RequestsScreen {...props} />);

      await fireEvent.press(screen.getByRole('button', { name: /^Conversation with Riley Rider/ }));
      expect(props.onOpenConversation).toHaveBeenCalledWith('conv-2');
      expect(screen.getByText('No rides posted yet')).toBeOnTheScreen();
    });
  });

  // Departed rides move to the Requests tab's "Past rides" section. Their
  // Message buttons must stay there until 2 hours after departure, the
  // same window as Ride Details (ME-07). Tapping one still only calls
  // onMessage; App.js then asks the server (open_my_ride_conversation),
  // which alone decides whether the chat opens or accepts messages.
  describe('ME-10: Past rides on the Requests tab keep Message buttons until 2 hours after departure', () => {
    function riderPastRequests(sinceDeparture) {
      const departureAt = new Date(NOW_MS - sinceDeparture);
      return {
        drivers: [
          makeRide({ id: 'ride-1', driverAccountId: 'driver-1', name: 'Dana Driver', departureAt }),
          makeRide({ id: 'ride-2', driverAccountId: 'driver-2', name: 'Pete Driver', departureAt, matchedRiders: [] }),
          makeRide({ id: 'ride-4', driverAccountId: 'driver-4', name: 'Cass Driver', departureAt, matchedRiders: [] }),
        ],
        myRequestRows: [
          { id: 'req-a', ride_id: 'ride-1', rider_id: 'rider-a', reason: null, status: 'accepted' },
          { id: 'req-2', ride_id: 'ride-2', rider_id: 'rider-a', reason: null, status: 'pending' },
          { id: 'req-4', ride_id: 'ride-4', rider_id: 'rider-a', reason: null, status: 'cancelled' },
        ],
      };
    }
    function driverPastRequests(sinceDeparture) {
      return { ...DRIVER_REQUESTS, drivers: [makeRide({ departureAt: new Date(NOW_MS - sinceDeparture) })] };
    }

    test('A: rider, 1 h after departure: Message Driver on the confirmed past ride only, opening the rider’s own chat', async () => {
      const props = requestsProps(riderPastRequests(HOUR));
      await render(<RequestsScreen {...props} />);

      expect(screen.getByText('Past rides')).toBeOnTheScreen();
      expect(messageButtonNames()).toEqual(['Message Dana Driver']);
      await fireEvent.press(screen.getByRole('button', { name: 'Message Dana Driver' }));

      expect(props.onMessage).toHaveBeenCalledTimes(1);
      expect(props.onMessage).toHaveBeenCalledWith({ rideId: 'ride-1', riderId: null });
      // Existing past-ride controls are still there.
      expect(screen.getAllByRole('button', { name: 'View Ride' })).toHaveLength(3);
    });

    test('B: driver, 1 h after departure: Message on each confirmed passenger of the past ride, none for the expired request', async () => {
      const props = requestsProps(driverPastRequests(HOUR));
      await render(<RequestsScreen {...props} />);

      expect(screen.getByText('Past rides')).toBeOnTheScreen();
      expect(messageButtonNames()).toEqual(['Message Riley Rider', 'Message Bo Rider']);
      await fireEvent.press(screen.getByRole('button', { name: 'Message Bo Rider' }));

      expect(props.onMessage).toHaveBeenCalledTimes(1);
      expect(props.onMessage).toHaveBeenCalledWith({ rideId: 'ride-1', riderId: 'rider-b' });
      // The existing summary is unchanged.
      expect(screen.getByText(/2 confirmed passengers: Riley Rider, Bo Rider/)).toBeOnTheScreen();
    });

    describe.each([
      ['rider', riderPastRequests, ['Message Dana Driver']],
      ['driver', driverPastRequests, ['Message Riley Rider', 'Message Bo Rider']],
    ])('C: %s, at the edges of the window', (_mode, makeProps, expectedInside) => {
      test.each([
        ['1 h 59 min after departure', 2 * HOUR - MINUTE, expectedInside],
        ['exactly 2 h after departure', 2 * HOUR, []],
        ['3 h after departure', 3 * HOUR, []],
      ])('%s', async (_label, sinceDeparture, expected) => {
        await render(<RequestsScreen {...requestsProps(makeProps(sinceDeparture))} />);

        expect(screen.getByText('Past rides')).toBeOnTheScreen();
        expect(messageButtonNames()).toEqual(expected);
      });
    });

    test('D: with the flag off, past rides show no Message buttons', async () => {
      const { messagingEnabled: _off, ...props } = requestsProps(driverPastRequests(HOUR));
      await render(<RequestsScreen {...props} />);

      expect(screen.getByText('Past rides')).toBeOnTheScreen();
      expect(screen.queryAllByRole('button', { name: MESSAGE_BUTTON })).toHaveLength(0);
    });

    describe.each([
      ['rider', riderPastRequests, { myRole: 'rider', otherPersonName: 'Dana Driver' }],
      ['driver', driverPastRequests, { myRole: 'driver', riderId: 'rider-a', otherPersonName: 'Riley Rider' }],
    ])('E: %s, after the window', (_mode, makeProps, who) => {
      test('the existing chat is still reachable from Messages, as read-only', async () => {
        const ended = {
          ...CONVERSATIONS[0],
          ...who,
          rideDepartureAt: new Date(NOW_MS - 3 * HOUR),
          state: 'completed',
          canSend: false,
        };
        const props = requestsProps({ ...makeProps(3 * HOUR), conversations: [ended] });
        await render(<RequestsScreen {...props} />);

        expect(messageButtonNames()).toEqual([]);
        const readOnly = screen.getByTestId('messages-read-only');
        const row = within(readOnly).getByRole('button', {
          name: new RegExp(`^Conversation with ${who.otherPersonName}`),
        });
        expect(within(row).getByText('Ride ended')).toBeOnTheScreen();
        expect(screen.queryByTestId('messages-active')).toBeNull();

        await fireEvent.press(row);
        expect(props.onOpenConversation).toHaveBeenCalledWith('conv-1');
      });
    });
  });

  // The Messages list is split by the server's can_send: chats that accept
  // messages under "Active", the rest under "Read-only", each in the
  // server's order. There is no count badge: it read like an unread count,
  // and nothing tracks unread messages.
  describe('ME-11: the Messages list is split into Active and Read-only, with no count badge', () => {
    const OPEN_2 = {
      ...CONVERSATIONS[0],
      id: 'conv-3',
      rideId: 'ride-3',
      otherPersonName: 'Dee Driver',
      rideDestination: 'Fair Park',
    };
    const SEAT_GONE = {
      ...CONVERSATIONS[0],
      id: 'conv-4',
      rideId: 'ride-4',
      state: 'seat_cancelled',
      canSend: false,
      otherPersonName: 'Pete Driver',
    };
    const ENDED = {
      ...CONVERSATIONS[0],
      id: 'conv-5',
      rideId: 'ride-5',
      state: 'completed',
      canSend: false,
      otherPersonName: 'Lou Driver',
    };

    function rowNames(groupTestId) {
      return within(screen.getByTestId(groupTestId))
        .getAllByRole('button', { name: CONVERSATION_ROW })
        .map((row) => accessibleName(row).split(',')[0]);
    }
    function groupHeadings() {
      return screen
        .getAllByRole('header')
        .map(textOf)
        .filter((text) => text === 'Active' || text === 'Read-only');
    }

    test('A: mixed input order: Active comes first; each group keeps the server’s order', async () => {
      const conversations = [CONVERSATIONS[1], CONVERSATIONS[0], ENDED, OPEN_2, SEAT_GONE];
      await render(<RequestsScreen {...requestsProps({ ...RIDER_REQUESTS, conversations })} />);

      expect(groupHeadings()).toEqual(['Active', 'Read-only']);
      expect(rowNames('messages-active')).toEqual([
        'Conversation with Dana Driver',
        'Conversation with Dee Driver',
      ]);
      expect(rowNames('messages-read-only')).toEqual([
        'Conversation with Cass Driver',
        'Conversation with Lou Driver',
        'Conversation with Pete Driver',
      ]);
    });

    test('B: each read-only row says why, from the server’s state', async () => {
      const unknown = { ...CONVERSATIONS[0], id: 'conv-6', state: 'something_new', canSend: false, otherPersonName: 'Max Driver' };
      const conversations = [CONVERSATIONS[1], SEAT_GONE, ENDED, unknown];
      await render(<RequestsScreen {...requestsProps({ conversations })} />);

      const reasonFor = (name) =>
        within(screen.getByRole('button', { name: new RegExp(`^Conversation with ${name}`) }));
      expect(reasonFor('Cass Driver').getByText('Ride cancelled')).toBeOnTheScreen();
      expect(reasonFor('Pete Driver').getByText('Seat cancelled')).toBeOnTheScreen();
      expect(reasonFor('Lou Driver').getByText('Ride ended')).toBeOnTheScreen();
      expect(reasonFor('Max Driver').getByText('Read-only')).toBeOnTheScreen();
    });

    test('C: active rows have no read-only badge', async () => {
      await render(<RequestsScreen {...requestsProps({ conversations: [CONVERSATIONS[0], OPEN_2] })} />);

      for (const row of screen.getAllByRole('button', { name: CONVERSATION_ROW })) {
        expect(accessibleName(row)).not.toMatch(/read-only/);
        expect(within(row).queryByText(/^(Read-only|Ride cancelled|Seat cancelled|Ride ended)$/)).toBeNull();
      }
    });

    test('D: only active chats: no Read-only group; only read-only chats: no Active group', async () => {
      const { rerender } = await render(
        <RequestsScreen {...requestsProps({ conversations: [CONVERSATIONS[0], OPEN_2] })} />
      );
      expect(groupHeadings()).toEqual(['Active']);
      expect(screen.queryByTestId('messages-read-only')).toBeNull();

      await rerender(<RequestsScreen {...requestsProps({ conversations: [CONVERSATIONS[1], ENDED] })} />);
      expect(groupHeadings()).toEqual(['Read-only']);
      expect(screen.queryByTestId('messages-active')).toBeNull();
    });

    test('E: the Messages heading has no count badge', async () => {
      // No rides, so no other section's count badge is on screen either.
      await render(<RequestsScreen {...requestsProps({ conversations: [CONVERSATIONS[0], CONVERSATIONS[1], ENDED] })} />);

      expect(screen.getByText('Messages')).toBeOnTheScreen();
      expect(screen.queryByText('3')).toBeNull();
      expect(screen.queryByText('2')).toBeNull();
      expect(screen.queryByText('1')).toBeNull();
    });

    test('F: a missing can_send never counts as Active', async () => {
      const unsure = { ...CONVERSATIONS[0], canSend: undefined };
      await render(<RequestsScreen {...requestsProps({ conversations: [unsure] })} />);

      expect(screen.queryByTestId('messages-active')).toBeNull();
      expect(rowNames('messages-read-only')).toEqual(['Conversation with Dana Driver']);
    });

    test('G: tapping a row in either group opens that chat', async () => {
      const props = requestsProps({ conversations: [CONVERSATIONS[0], CONVERSATIONS[1]] });
      await render(<RequestsScreen {...props} />);

      await fireEvent.press(within(screen.getByTestId('messages-active')).getByRole('button', { name: CONVERSATION_ROW }));
      await fireEvent.press(within(screen.getByTestId('messages-read-only')).getByRole('button', { name: CONVERSATION_ROW }));
      expect(props.onOpenConversation.mock.calls).toEqual([['conv-1'], ['conv-2']]);
    });
  });
});
