// Automated tests for the Map tab's zoom controls (Prototype 9, Step 2).
// The test cases and their expected results are defined in
// PROTOTYPE-9-TEST-PLAN.md ("Step 2 test cases: map zoom controls"), where
// they were recorded before this code was written.
//
// Real code under test: screens/MapScreen.js and lib/mapZoom.js.
// Faked: react-native-maps (a native map can't run in Jest; the fake records
// each animateToRegion / fitToCoordinates call and can report a region
// change), fetchDrivingRoute from lib/routing.js (so no network is used),
// and the icon font.
//
// Expected values are written out here rather than imported from the app, so
// the app's own constants cannot define what counts as correct.

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import MapScreen from '../screens/MapScreen';
import { zoomRegion } from '../lib/mapZoom';
import { fetchDrivingRoute } from '../lib/routing';

// --- Fake native map -------------------------------------------------------

// The methods MapScreen calls through its ref.
const mockMap = { animateToRegion: jest.fn(), fitToCoordinates: jest.fn() };
// false = the map provides no ref methods (the "map not ready" case, Z-07).
let mockProvideRef = true;
// The props of the most recent MapView render (used to report region changes).
let mockMapProps = null;
// Each pin's coordinate from the most recent render, by accessibility label.
let mockMarkerCoordinates = {};

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');

  // React 19 passes `ref` to function components as an ordinary prop.
  function MapView({ ref, children, ...props }) {
    mockMapProps = props;
    mockMarkerCoordinates = {};
    React.useImperativeHandle(mockProvideRef ? ref : null, () => mockMap);
    return <View testID="fake-map">{children}</View>;
  }

  function Marker({ coordinate, onPress, accessibilityLabel }) {
    mockMarkerCoordinates[accessibilityLabel] = coordinate;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => onPress?.({ nativeEvent: { action: 'marker-press' } })}
      />
    );
  }

  return { __esModule: true, default: MapView, Marker, Polyline: () => null };
});

jest.mock('../lib/routing', () => ({
  ...jest.requireActual('../lib/routing'),
  fetchDrivingRoute: jest.fn(),
}));

jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text testID={`icon-${name}`} />,
  };
});

// --- Test data -------------------------------------------------------------

// SMU_MAP_REGION, written out: the starting view of the Map tab.
const SMU = { latitude: 32.8413, longitude: -96.7805, delta: 0.018 };

const FONDREN = { latitude: 32.84454, longitude: -96.78343, label: 'Fondren Library' };
const HUGHES_TRIGG = { latitude: 32.84354, longitude: -96.7833, label: 'Hughes-Trigg Student Center' };
const MOODY = { latitude: 32.8404, longitude: -96.78068, label: 'Moody Coliseum' };

function makeRide(id, pickup, destinationPoint = null) {
  return {
    id,
    name: `Driver ${id}`,
    avatarUrl: null,
    destination: destinationPoint ? destinationPoint.label : 'Downtown Dallas',
    departureTime: 'Today, 5:00 PM',
    seats: 2,
    pickup,
    destinationPoint,
  };
}

const FONDREN_RIDE = makeRide('ride-fondren', FONDREN);
const MOODY_RIDE = makeRide('ride-moody', MOODY);
// Z-09: Hughes-Trigg -> Fondren Library, about 110 m.
const SHORT_ROUTE_RIDE = makeRide('ride-short', HUGHES_TRIGG, FONDREN);
const ROAD_COORDINATES = [
  { latitude: 32.84354, longitude: -96.7833 },
  { latitude: 32.844, longitude: -96.7834 },
  { latitude: 32.84454, longitude: -96.78343 },
];

// --- Helpers ---------------------------------------------------------------

async function renderMap(drivers = [FONDREN_RIDE]) {
  const onOpenRide = jest.fn();
  await render(
    <MapScreen
      drivers={drivers}
      isBoardLoading={false}
      isRefreshing={false}
      boardError=""
      handleRefresh={jest.fn()}
      onOpenRide={onOpenRide}
      onGoHome={jest.fn()}
    />
  );
  return { onOpenRide };
}

// fireEvent.press is async in Testing Library 14, so every press is awaited.
const press = (name) => fireEvent.press(screen.getByRole('button', { name }));

// The map reports that it finished moving, as after a pinch or pan.
const reportRegionChange = (region) =>
  act(async () => {
    mockMapProps.onRegionChangeComplete(region, { isGesture: true });
  });

// Lets every promise already able to finish do so, then applies state updates.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const regionCalls = () => mockMap.animateToRegion.mock.calls.map((call) => call[0]);

// Compared to 6 decimal places: halving and doubling decimals can leave tiny
// rounding differences.
function expectRegion(region, { latitude, longitude, delta }) {
  expect(region.latitude).toBeCloseTo(latitude, 6);
  expect(region.longitude).toBeCloseTo(longitude, 6);
  expect(region.latitudeDelta).toBeCloseTo(delta, 6);
  expect(region.longitudeDelta).toBeCloseTo(delta, 6);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockProvideRef = true;
  mockMapProps = null;
  mockMarkerCoordinates = {};
});

// --- Tests -----------------------------------------------------------------

describe('Map zoom controls', () => {
  test('Z-01: Zoom in from the starting view halves the deltas around the SMU center', async () => {
    await renderMap();
    await press('Zoom in');

    expect(regionCalls()).toHaveLength(1);
    expectRegion(regionCalls()[0], { latitude: SMU.latitude, longitude: SMU.longitude, delta: 0.009 });
  });

  test('Z-02: Zoom out from the starting view doubles the deltas around the SMU center', async () => {
    await renderMap();
    await press('Zoom out');

    expect(regionCalls()).toHaveLength(1);
    expectRegion(regionCalls()[0], { latitude: SMU.latitude, longitude: SMU.longitude, delta: 0.036 });
  });

  test('Z-03: zooming in stops at the closest limit, 0.002', async () => {
    await renderMap();
    for (let tap = 0; tap < 6; tap += 1) await press('Zoom in');

    const calls = regionCalls();
    const expected = [0.009, 0.0045, 0.00225, 0.002, 0.002, 0.002];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    calls.forEach((region, index) => {
      expectRegion(region, {
        latitude: SMU.latitude,
        longitude: SMU.longitude,
        delta: expected[index],
      });
      expect(region.latitudeDelta).toBeGreaterThanOrEqual(0.002 - 1e-9);
      expect(region.longitudeDelta).toBeGreaterThanOrEqual(0.002 - 1e-9);
    });
  });

  test('Z-04: zooming out stops at the farthest limit, 0.2', async () => {
    await renderMap();
    for (let tap = 0; tap < 6; tap += 1) await press('Zoom out');

    const calls = regionCalls();
    const expected = [0.036, 0.072, 0.144, 0.2, 0.2, 0.2];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    calls.forEach((region, index) => {
      expectRegion(region, {
        latitude: SMU.latitude,
        longitude: SMU.longitude,
        delta: expected[index],
      });
      expect(region.latitudeDelta).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(region.longitudeDelta).toBeLessThanOrEqual(0.2 + 1e-9);
    });
  });

  test('Z-05: zoom starts from where the user panned, not from the SMU center', async () => {
    await renderMap();
    await reportRegionChange({ latitude: 32.85, longitude: -96.79, latitudeDelta: 0.018, longitudeDelta: 0.018 });
    await press('Zoom in');

    expect(regionCalls()).toHaveLength(1);
    expectRegion(regionCalls()[0], { latitude: 32.85, longitude: -96.79, delta: 0.009 });
  });

  test('Z-06: Re-center after zooming and panning returns exactly to the SMU view', async () => {
    await renderMap();
    await press('Zoom in');
    await reportRegionChange({ latitude: 32.85, longitude: -96.79, latitudeDelta: 0.009, longitudeDelta: 0.009 });
    await press('Re-center map');

    const last = regionCalls().at(-1);
    expect(last).toEqual({
      latitude: SMU.latitude,
      longitude: SMU.longitude,
      latitudeDelta: SMU.delta,
      longitudeDelta: SMU.delta,
    });
  });

  test('Z-07: tapping the controls before the map is ready does nothing and does not crash', async () => {
    mockProvideRef = false;
    await renderMap();

    await expect(
      (async () => {
        await press('Zoom in');
        await press('Zoom out');
        await press('Re-center map');
      })()
    ).resolves.toBeUndefined();
    expect(mockMap.animateToRegion).not.toHaveBeenCalled();
    expect(mockMap.fitToCoordinates).not.toHaveBeenCalled();
    expect(screen.getByText('Map')).toBeOnTheScreen();
  });

  describe('Z-08: zoomRegion scales and limits each delta separately', () => {
    test('A: zoom out, longitude delta limited to 0.2', () => {
      const input = Object.freeze({
        latitude: 32.84,
        longitude: -96.78,
        latitudeDelta: 0.01,
        longitudeDelta: 0.3,
      });
      const result = zoomRegion(input, 2);

      expect(result.latitude).toBe(32.84);
      expect(result.longitude).toBe(-96.78);
      expect(result.latitudeDelta).toBeCloseTo(0.02, 6);
      expect(result.longitudeDelta).toBeCloseTo(0.2, 6);
      expect(input).toEqual({ latitude: 32.84, longitude: -96.78, latitudeDelta: 0.01, longitudeDelta: 0.3 });
    });

    test('B: zoom in, latitude delta limited to 0.002', () => {
      const input = Object.freeze({
        latitude: 32.84,
        longitude: -96.78,
        latitudeDelta: 0.003,
        longitudeDelta: 0.05,
      });
      const result = zoomRegion(input, 0.5);

      expect(result.latitude).toBe(32.84);
      expect(result.longitude).toBe(-96.78);
      expect(result.latitudeDelta).toBeCloseTo(0.002, 6);
      expect(result.longitudeDelta).toBeCloseTo(0.025, 6);
      expect(input).toEqual({ latitude: 32.84, longitude: -96.78, latitudeDelta: 0.003, longitudeDelta: 0.05 });
    });
  });

  test('Z-09: Re-center while a route is open re-frames the route instead of returning to SMU', async () => {
    fetchDrivingRoute.mockResolvedValue({
      coordinates: ROAD_COORDINATES,
      distanceMeters: 150,
      durationSeconds: 60,
    });
    await renderMap([SHORT_ROUTE_RIDE]);
    await press('Hughes-Trigg Student Center: 1 ride');
    await press('View Route');
    await settle();
    // The route has finished loading: it was framed on the road coordinates.
    expect(mockMap.fitToCoordinates).toHaveBeenLastCalledWith(ROAD_COORDINATES, expect.anything());

    mockMap.fitToCoordinates.mockClear();
    mockMap.animateToRegion.mockClear();
    await press('Re-center map');

    expect(mockMap.fitToCoordinates).toHaveBeenCalledTimes(1);
    expect(mockMap.fitToCoordinates).toHaveBeenCalledWith(ROAD_COORDINATES, {
      edgePadding: { top: 70, right: 50, bottom: expect.any(Number), left: 50 },
      animated: true,
    });
    expect(mockMap.animateToRegion).not.toHaveBeenCalled();
    expect(screen.getByText('Route')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Close Route' })).toBeOnTheScreen();
  });

  test('R-01: zooming and re-centering do not change the selected pickup or any ride', async () => {
    const drivers = [FONDREN_RIDE, MOODY_RIDE];
    const before = JSON.parse(JSON.stringify(drivers));
    const { onOpenRide } = await renderMap(drivers);

    await press('Fondren Library: 1 ride');
    expect(screen.getByText('Fondren Library')).toBeOnTheScreen();
    expect(screen.getByText('1 ride leaving from here')).toBeOnTheScreen();

    await press('Zoom in');
    await press('Zoom out');
    await press('Re-center map');

    expect(screen.getByText('Fondren Library')).toBeOnTheScreen();
    expect(screen.getByText('1 ride leaving from here')).toBeOnTheScreen();
    expect(screen.getByText(`To ${FONDREN_RIDE.destination}`)).toBeOnTheScreen();
    expect(screen.getByText(`Driver: ${FONDREN_RIDE.name}`)).toBeOnTheScreen();

    const fondrenPin = mockMarkerCoordinates['Fondren Library: 1 ride'];
    const moodyPin = mockMarkerCoordinates['Moody Coliseum: 1 ride'];
    expect([fondrenPin.latitude, fondrenPin.longitude]).toEqual([32.84454, -96.78343]);
    expect([moodyPin.latitude, moodyPin.longitude]).toEqual([32.8404, -96.78068]);

    expect(drivers).toEqual(before);
    expect(onOpenRide).not.toHaveBeenCalled();
  });
});
