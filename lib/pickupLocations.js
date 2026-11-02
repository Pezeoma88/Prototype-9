// Preset pickup spots for CarpoolBoard Prototype 6.
//
// These are TEST locations: well-known public landmarks on and next to the
// SMU campus in Dallas. Drivers choose one from this list instead of
// dropping a pin, so a ride's pickup can never be someone's home address.
// "Use My Location" (lib/currentLocation.js) only reads the phone's position
// on demand to suggest the nearest landmark; only that landmark is saved.
//
// Coordinates were looked up in OpenStreetMap (Nominatim) and rounded to
// five decimal places (about one metre). They mark the landmark itself, not
// a specific door or curb.

// Where the Map tab opens: the SMU campus, wide enough to include
// SMU/Mockingbird Station to the south-east.
export const SMU_MAP_REGION = {
  latitude: 32.8413,
  longitude: -96.7805,
  latitudeDelta: 0.018,
  longitudeDelta: 0.018,
};

export const PICKUP_LOCATIONS = [
  { key: 'hughes-trigg', label: 'Hughes-Trigg Student Center', latitude: 32.84354, longitude: -96.7833 },
  { key: 'fondren-library', label: 'Fondren Library', latitude: 32.84454, longitude: -96.78343 },
  { key: 'dallas-hall', label: 'Dallas Hall', latitude: 32.84526, longitude: -96.78491 },
  { key: 'moody-coliseum', label: 'Moody Coliseum', latitude: 32.8404, longitude: -96.78068 },
  { key: 'ford-stadium', label: 'Gerald J. Ford Stadium', latitude: 32.83779, longitude: -96.78279 },
  { key: 'dedman-center', label: 'Dedman Center for Lifetime Sports', latitude: 32.83941, longitude: -96.78086 },
  { key: 'meadows-museum', label: 'Meadows Museum', latitude: 32.83843, longitude: -96.78437 },
  { key: 'bush-center', label: 'George W. Bush Presidential Center', latitude: 32.84093, longitude: -96.77787 },
  { key: 'mockingbird-station', label: 'SMU/Mockingbird Station', latitude: 32.83783, longitude: -96.77496 },
];

// True when the two numbers are a real point on the map. Matches the
// rides_pickup_coords_check constraint in supabase/prototype-6.sql.
export function isValidCoordinate(latitude, longitude) {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// Identifies a spot on the map. Rides leaving from the same place share a
// key, which is how the Map tab groups them under one marker.
export function pickupKey(pickup) {
  return `${pickup.latitude.toFixed(5)},${pickup.longitude.toFixed(5)}`;
}

// Whether two pickups ({ latitude, longitude, label } or null) are the same
// spot. A spot without valid coordinates never matches anything, rather than
// crashing pickupKey.
export function isSamePickup(a, b) {
  if (!a || !b) {
    return !a && !b;
  }
  if (!isValidCoordinate(a.latitude, a.longitude) || !isValidCoordinate(b.latitude, b.longitude)) {
    return false;
  }
  return pickupKey(a) === pickupKey(b);
}
