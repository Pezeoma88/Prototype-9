import { formatDeparture } from './format';
import { getAvatarUrl } from './avatar';
import { isValidCoordinate } from './pickupLocations';

// The `profiles` columns loaded for the signed-in account. Never email:
// it's private to Supabase Auth and comes from the session instead.
export const ACCOUNT_COLUMNS = 'id, username, name, role, bio, vehicle_make_model, avatar_path';

// The `profiles` columns loaded for the other people on the board: just what
// their cards show (name + photo), never their email.
export const BOARD_PROFILE_COLUMNS = 'id, name, avatar_path';

// Converts a `profiles` row into the account shape the app already uses.
// `email` is the signed-in user's address from their Supabase Auth session
// (profiles doesn't expose it). profiles.role is only the role picked at sign-up (legacy/compatibility
// data), so it's exposed as `legacyRole`: what the person is doing right now
// is App's activeMode, never this field. bio and vehicleMakeModel are ''
// when unset (NULL in Supabase), so screens can treat them as plain text.
// avatarUrl is the photo's public URL, or null for the initials avatar; it
// belongs to the person, so it's the same in Driver and Rider mode.
export function profileToAccount(row, email) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: email || '',
    legacyRole: row.role,
    bio: row.bio || '',
    vehicleMakeModel: row.vehicle_make_model || '',
    avatarPath: row.avatar_path || null,
    avatarUrl: getAvatarUrl(row.avatar_path),
  };
}

// The photo URL for a profile id on the board, or null for initials.
export function getBoardAvatarUrl(profilesById, profileId) {
  return getAvatarUrl(profilesById[profileId]?.avatar_path);
}

// A ride's pickup spot as { latitude, longitude, label }, or null when the
// ride has none (or its saved coordinates aren't a real point). Rides
// without a pickup work everywhere except the Map tab, which skips them.
export function getRidePickup(ride) {
  if (!isValidCoordinate(ride.pickup_lat, ride.pickup_lng)) {
    return null;
  }
  return {
    latitude: ride.pickup_lat,
    longitude: ride.pickup_lng,
    label: ride.pickup_label || 'Pickup spot',
  };
}

// A ride's mapped destination as { latitude, longitude, label }, or null
// when the driver hasn't chosen one. Separate from ride.destination, the
// text the driver typed: a location is never worked out from that text. The
// label names the mapped point itself, so a point without one isn't used.
export function getRideDestinationPoint(ride) {
  const label = typeof ride.destination_label === 'string' ? ride.destination_label.trim() : '';
  if (label === '' || !isValidCoordinate(ride.destination_lat, ride.destination_lng)) {
    return null;
  }
  return {
    latitude: ride.destination_lat,
    longitude: ride.destination_lng,
    label,
  };
}

// Turns Supabase rows into the `drivers` state shape the UI already renders.
// Available seats are always derived as seat_count - accepted requests.
// `ratingSummaries` maps a driver id to { average, count } (lib/reviews.js),
// or is null when reviews couldn't be loaded. Each ride's driverRating is
// then { average, count }, null for a driver with no reviews yet, or
// undefined when it isn't known (so nothing is shown rather than a wrong
// "No ratings yet").
export function buildDriversFromRows(rideRows, requestRows, profilesById, ratingSummaries = null) {
  return rideRows.map((ride) => {
    const requests = requestRows.filter((req) => req.ride_id === ride.id);
    const matchedRiders = requests
      .filter((req) => req.status === 'accepted')
      .map((req) => ({
        id: req.rider_id,
        requestId: req.id,
        name: profilesById[req.rider_id]?.name || 'Unknown rider',
        avatarUrl: getBoardAvatarUrl(profilesById, req.rider_id),
      }));
    const pendingRequests = requests
      .filter((req) => req.status === 'pending')
      .map((req) => ({
        id: req.id,
        riderId: req.rider_id,
        name: profilesById[req.rider_id]?.name || 'Unknown rider',
        avatarUrl: getBoardAvatarUrl(profilesById, req.rider_id),
        reason: req.reason || '',
      }));
    const departureAt = new Date(ride.departure_at);
    return {
      id: ride.id,
      driverAccountId: ride.driver_id,
      name: profilesById[ride.driver_id]?.name || 'Unknown driver',
      avatarUrl: getBoardAvatarUrl(profilesById, ride.driver_id),
      driverRating: ratingSummaries ? ratingSummaries[ride.driver_id] || null : undefined,
      destination: ride.destination,
      pickup: getRidePickup(ride),
      destinationPoint: getRideDestinationPoint(ride),
      departureAt,
      departureTime: formatDeparture(departureAt),
      totalSeats: ride.seat_count,
      seats: Math.max(0, ride.seat_count - matchedRiders.length),
      matchedRiders,
      pendingRequests,
    };
  });
}
