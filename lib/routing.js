// Driving routes for the Map tab's route view.
//
// Routes come from the public OSRM demo server (project-osrm.org), which is
// free and needs no key or account. It is meant for light use and has no
// uptime guarantee, so every caller must be ready for it to fail: the Map
// tab then draws a dashed straight line, clearly labeled as not being
// driving directions.
//
// The route data is OpenStreetMap's (© OpenStreetMap contributors), which
// the Map tab credits wherever a route is shown. Durations are OSRM's
// estimate from road types and speed limits. They know nothing about live
// traffic.
//
// Only the two points' coordinates are sent. Both are preset public
// landmarks, and nothing about the user or the ride goes with them.

const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';
const ROUTE_TIMEOUT_MS = 8000;
const METERS_PER_MILE = 1609.344;

// Looks up the driving route between two { latitude, longitude } points.
// Resolves to { coordinates, distanceMeters, durationSeconds }, where
// coordinates is the road path as [{ latitude, longitude }, ...]. Rejects
// if the server can't be reached, takes too long, or returns anything that
// isn't a usable route. `signal` (optional) lets the caller abandon it.
export async function fetchDrivingRoute(from, to, signal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  const handleOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    signal.addEventListener('abort', handleOuterAbort);
  }

  try {
    // OSRM takes longitude first.
    const url =
      `${OSRM_ROUTE_URL}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
      '?overview=full&geometries=geojson';
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Routing server answered ${response.status}.`);
    }
    const body = await response.json();
    const route = body && body.code === 'Ok' && Array.isArray(body.routes) ? body.routes[0] : null;
    const points = route && route.geometry ? route.geometry.coordinates : null;
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error('Routing server returned no route.');
    }
    const coordinates = points.map((point) => ({ latitude: point[1], longitude: point[0] }));
    const isUsable =
      coordinates.every(
        (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      ) &&
      Number.isFinite(route.distance) &&
      Number.isFinite(route.duration);
    if (!isUsable) {
      throw new Error('Routing server returned an unreadable route.');
    }
    return { coordinates, distanceMeters: route.distance, durationSeconds: route.duration };
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', handleOuterAbort);
    }
  }
}

// Straight-line ("as the crow flies") distance between two points, in
// metres. Used only for the labeled straight-line fallback.
export function straightLineMeters(from, to) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}

// "5.5 mi", or "under 0.1 mi" for very short hops.
export function formatMiles(meters) {
  const miles = meters / METERS_PER_MILE;
  return miles < 0.1 ? 'under 0.1 mi' : `${miles.toFixed(1)} mi`;
}

// "15 min" or "1 hr 5 min". Never less than a minute.
export function formatDriveTime(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
