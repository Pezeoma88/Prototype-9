// Automated tests for GPS and manual pickup selection.
// The test cases are defined in PROTOTYPE-9-TEST-PLAN.md.
//
// Real code under test: screens/RideForm.js, lib/currentLocation.js,
// lib/nearestPickup.js, lib/pickupLocations.js, and the form's components.
// Faked: expo-location, so each test gets the same GPS answer anywhere, and the
// icon font, so a notice's tone can be read from its icon name.
//
// Expected values are written out here rather than imported from the app, so
// the app's own data and logic cannot define what counts as correct. Nothing
// here talks to Supabase: RideForm does not import it and saving is a fake.

import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import RideForm from '../screens/RideForm';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  hasServicesEnabledAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => <Text testID={`icon-${name}`} />,
  };
});

// Spots as the form stores them: { latitude, longitude, label }.
const FONDREN = { latitude: 32.84454, longitude: -96.78343, label: 'Fondren Library' };
const HUGHES_TRIGG = { latitude: 32.84354, longitude: -96.7833, label: 'Hughes-Trigg Student Center' };
const MEADOWS = { latitude: 32.83843, longitude: -96.78437, label: 'Meadows Museum' };
const MOODY = { latitude: 32.8404, longitude: -96.78068, label: 'Moody Coliseum' };

// Phone positions, checked with a separate haversine calculation.
const NEAR_FONDREN = { coords: { latitude: 32.8446, longitude: -96.7836, accuracy: 50 } }; // ~17 m
const TOO_FAR_NORTH = { coords: { latitude: 32.8597, longitude: -96.7849, accuracy: 50 } }; // ~1,606 m

const INFO_ICON = 'icon-information-circle';
const WARNING_ICON = 'icon-alert-circle';

// App.js normally holds the form's values. This keeps just enough of them in
// state and records every pickup the form tries to set.
function FormHarness({ initialPickup, onSetPickup }) {
  const [pickupInput, setPickupInput] = useState(initialPickup);
  return (
    <RideForm
      currentUser={{ name: 'Test Driver' }}
      editingRideId={null}
      editingDriver={null}
      destinationInput=""
      setDestinationInput={jest.fn()}
      pickupInput={pickupInput}
      setPickupInput={(spot) => {
        onSetPickup(spot);
        setPickupInput(spot);
      }}
      destinationPointInput={null}
      setDestinationPointInput={jest.fn()}
      departureAtInput={null}
      departurePickerMode={null}
      setDeparturePickerMode={jest.fn()}
      departurePickerMinimumDate={new Date(0)}
      handleToggleDeparturePicker={jest.fn()}
      handleDeparturePicked={jest.fn()}
      seatsInput="1"
      setSeatsInput={jest.fn()}
      formError=""
      isSubmittingDriver={false}
      handleSaveDriver={jest.fn()}
      resetForm={jest.fn()}
      rideConfirmation={null}
      handleEditPostedRide={jest.fn()}
      handleFinishPostedRide={jest.fn()}
    />
  );
}

async function renderForm(initialPickup = null) {
  const onSetPickup = jest.fn();
  await render(<FormHarness initialPickup={initialPickup} onSetPickup={onSetPickup} />);
  return onSetPickup;
}

const pressUseMyLocation = () =>
  fireEvent.press(screen.getByRole('button', { name: 'Use My Location' }));

// Lets every promise already able to finish do so, then applies state updates.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function expectSelectedPickup(label) {
  expect(screen.getByRole('radio', { name: label, selected: true })).toBeOnTheScreen();
  expect(screen.getAllByRole('radio', { selected: true })).toHaveLength(1);
}

function expectLookupFinished() {
  expect(screen.getByRole('button', { name: 'Use My Location' })).toBeOnTheScreen();
  expect(screen.queryByText('Finding nearest landmark…')).toBeNull();
}

beforeEach(() => {
  jest.resetAllMocks();
  // The default for each test: location on, permission granted, no recent position.
  Location.hasServicesEnabledAsync.mockResolvedValue(true);
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  Location.getLastKnownPositionAsync.mockResolvedValue(null);
});

describe('GPS and manual pickup selection', () => {
  test('TC-01: a position near SMU selects the nearest landmark', async () => {
    Location.getCurrentPositionAsync.mockResolvedValue(NEAR_FONDREN);
    const onSetPickup = await renderForm(null);

    await pressUseMyLocation();
    await settle();

    // toEqual on the whole object also proves the phone's coordinates aren't stored.
    expect(onSetPickup).toHaveBeenCalledTimes(1);
    expect(onSetPickup).toHaveBeenCalledWith(FONDREN);
    expectSelectedPickup('Fondren Library');
    expect(
      screen.getByText(
        'Pickup set to Fondren Library, the closest SMU landmark to you. You can change it below.'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId(INFO_ICON)).toBeOnTheScreen();
    expectLookupFinished();
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  });

  describe('TC-02: permission denied while a pickup is selected', () => {
    const STILL_SELECTED =
      'Your pickup is still Hughes-Trigg Student Center, or you can choose another spot below.';

    async function denyAndTap(canAskAgain) {
      Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain });
      const onSetPickup = await renderForm(HUGHES_TRIGG);

      await pressUseMyLocation();
      await settle();

      expect(onSetPickup).not.toHaveBeenCalled();
      expectSelectedPickup('Hughes-Trigg Student Center');
      expect(screen.getByTestId(WARNING_ICON)).toBeOnTheScreen();
      expectLookupFinished();
      expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    }

    test('A: cannot ask again, so the form offers Settings', async () => {
      await denyAndTap(false);

      expect(
        screen.getByText(
          `Location access is off for this app. Turn it on in Settings, then try again. ${STILL_SELECTED}`
        )
      ).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
    });

    test('B: can ask again, so the form offers Try Again only', async () => {
      await denyAndTap(true);

      expect(screen.getByText(`Location access wasn’t allowed. ${STILL_SELECTED}`)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    });
  });

  test('TC-03: a late GPS answer cannot replace a manual choice', async () => {
    let releaseGps;
    Location.getCurrentPositionAsync.mockReturnValue(
      new Promise((resolve) => {
        releaseGps = resolve;
      })
    );
    const onSetPickup = await renderForm(null);

    // Step 1: the lookup is really waiting on the GPS before the chip is tapped.
    // fireEvent's promise includes the async press handler, which can't finish
    // until the GPS answers, so it is awaited only after step 3.
    const lookupFinished = pressUseMyLocation();
    await waitFor(() => expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Finding nearest landmark…')).toBeOnTheScreen();

    // Step 2: choose by hand. The form responds without waiting for the GPS.
    await fireEvent.press(screen.getByRole('radio', { name: 'Meadows Museum' }));
    expectSelectedPickup('Meadows Museum');
    expectLookupFinished();

    // Step 3: the GPS now answers with a different landmark.
    await act(async () => {
      releaseGps(NEAR_FONDREN);
      await lookupFinished;
    });
    await settle();

    expect(onSetPickup).toHaveBeenCalledTimes(1);
    expect(onSetPickup).toHaveBeenCalledWith(MEADOWS);
    expectSelectedPickup('Meadows Museum');
    expect(screen.queryByText(/Pickup set to/)).toBeNull();
    expect(screen.queryByTestId(INFO_ICON)).toBeNull();
    expect(screen.queryByTestId(WARNING_ICON)).toBeNull();
    expectLookupFinished();
  });

  test('TC-04: a position past the limit keeps the pickup and offers no retry', async () => {
    Location.getCurrentPositionAsync.mockResolvedValue(TOO_FAR_NORTH);
    const onSetPickup = await renderForm(MOODY);

    await pressUseMyLocation();
    await settle();

    expect(onSetPickup).not.toHaveBeenCalled();
    expectSelectedPickup('Moody Coliseum');
    expect(
      screen.getByText(
        'You’re more than about 1.5 km from the SMU pickup spots, so we can’t choose one automatically. Your pickup is still Moody Coliseum, or you can choose another spot below.'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId(WARNING_ICON)).toBeOnTheScreen();
    expectLookupFinished();
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  });
});
