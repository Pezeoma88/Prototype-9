import * as Location from 'expo-location';
import { findNearestPickup } from './nearestPickup';
import { isValidCoordinate } from './pickupLocations';

// Longest we wait for a GPS fix before giving up and asking the user to
// pick a spot by hand.
const LOCATION_TIMEOUT_MS = 15000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Location request timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Finds the SMU pickup landmark nearest the phone. Only called when the user
// taps "Use My Location", so iOS asks for (foreground, "While Using the
// App") permission at that moment and never before.
//
// Privacy: the phone's coordinates stay inside this function. They are not
// returned, stored, or logged; callers only ever get a landmark's own
// coordinates and name. Resolves to one of:
//   { spot, distance }             nearest landmark within range
//   { denied: true, canAskAgain }  location permission was refused
//   { servicesOff: true }          Location Services are off on the device
//   { tooFar: true }               every landmark is more than ~1.5 km away
//   { error: true }                no fix (timeout, hardware error, …)
export async function locateNearestPickup() {
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return { servicesOff: true };
    }

    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return { denied: true, canAskAgain: permission.canAskAgain };
    }

    // Balanced (~100 m) is plenty to tell the landmarks apart and gets a fix
    // faster than High accuracy.
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      LOCATION_TIMEOUT_MS
    );
    const coords = position && position.coords;
    if (!coords || !isValidCoordinate(coords.latitude, coords.longitude)) {
      return { error: true };
    }
    const nearest = findNearestPickup(coords);
    return nearest !== null ? nearest : { tooFar: true };
  } catch {
    // Deliberately not logged: native error messages can include position
    // details, and the user gets a readable message from the caller anyway.
    return { error: true };
  }
}
