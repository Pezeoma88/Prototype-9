import { PICKUP_LOCATIONS, isValidCoordinate } from './pickupLocations';

// Farthest a phone can be from its nearest landmark and still have one
// picked for it automatically. Beyond this the user isn't really "at" SMU,
// so the app asks them to choose a spot by hand instead.
export const MAX_AUTO_PICKUP_DISTANCE_M = 1500;

const EARTH_RADIUS_M = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// Straight-line (great-circle) distance in metres between two
// { latitude, longitude } points, using the haversine formula.
export function distanceMeters(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The pickup landmark closest to `coords`, as { spot, distance } where spot
// is { latitude, longitude, label } (the landmark's own coordinates, never
// the caller's). Returns null when coords aren't a real point or every
// landmark is farther than MAX_AUTO_PICKUP_DISTANCE_M.
export function findNearestPickup(coords, landmarks = PICKUP_LOCATIONS) {
  if (!coords || !isValidCoordinate(coords.latitude, coords.longitude)) {
    return null;
  }

  let nearest = null;
  for (const landmark of landmarks) {
    if (!isValidCoordinate(landmark.latitude, landmark.longitude)) {
      continue;
    }
    const distance = distanceMeters(coords, landmark);
    if (nearest === null || distance < nearest.distance) {
      nearest = { landmark, distance };
    }
  }

  if (nearest === null || nearest.distance > MAX_AUTO_PICKUP_DISTANCE_M) {
    return null;
  }
  const { latitude, longitude, label } = nearest.landmark;
  return { spot: { latitude, longitude, label }, distance: nearest.distance };
}
