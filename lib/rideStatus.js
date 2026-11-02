// Ride expiration (Prototype 8).
//
// A ride is "upcoming" until its scheduled departure time, and "departed"
// from then on. Departed rides stay in Supabase and in the app's `drivers`
// state (history, reviews and the Requests tab still need them), but they
// are never offered for booking: Available Rides, search and filters, the
// Map, and every Request button only ever see upcoming rides.
//
// Time zones: rides.departure_at is a timestamptz, so Supabase returns an
// exact instant (ISO 8601 with an offset) and `ride.departureAt` is a Date.
// Comparing getTime() values compares instants, which is correct whatever
// time zone the phone (or the driver who posted the ride) is in. Only the
// display (formatDeparture) uses the phone's local time zone.
//
// This is the app-side rule. The database does not refuse requests for
// departed rides yet; that server-side check is part of a later, approved
// migration.

// How often the app re-checks the clock so a ride that departs while the
// app is open drops off the board without a manual refresh.
export const RIDE_CLOCK_INTERVAL_MS = 30 * 1000;

// The ride's departure as milliseconds since the epoch, or null when it's
// missing or not a real date.
export function getDepartureMs(ride) {
  const date = ride?.departureAt;
  if (!(date instanceof Date)) {
    return null;
  }
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

// True while the ride can still be booked: its departure is strictly in the
// future. A ride without a usable departure time is treated as not
// bookable, so bad data never shows up as an open ride.
export function isRideUpcoming(ride, nowMs) {
  const departureMs = getDepartureMs(ride);
  return departureMs !== null && departureMs > nowMs;
}

export function isRideDeparted(ride, nowMs) {
  return !isRideUpcoming(ride, nowMs);
}

// Splits rides into { upcoming, past }, keeping the input order in each.
export function partitionRidesByTime(rides, nowMs) {
  const upcoming = [];
  const past = [];
  for (const ride of rides) {
    (isRideUpcoming(ride, nowMs) ? upcoming : past).push(ride);
  }
  return { upcoming, past };
}

// Past rides, most recent departure first (the order history is read in).
export function sortPastRides(rides) {
  return [...rides].sort((a, b) => (getDepartureMs(b) ?? 0) - (getDepartureMs(a) ?? 0));
}

// How a departed ride is labeled. A ride that had at least one confirmed
// passenger is "Completed"; one that never filled a seat simply "Departed".
// CarpoolBoard has no record of whether the trip actually happened, so this
// is a label from the schedule, not proof.
export function getPastRideLabel(ride) {
  return ride.matchedRiders && ride.matchedRiders.length > 0 ? 'Completed' : 'Departed';
}

// A short relative hint for an upcoming departure: "in 25 min", "in 3 hr",
// "Tomorrow", "in 4 days". null when the ride has already departed or the
// time is unknown.
export function formatTimeUntil(ride, nowMs) {
  const departureMs = getDepartureMs(ride);
  if (departureMs === null || departureMs <= nowMs) {
    return null;
  }
  const minutes = Math.round((departureMs - nowMs) / 60000);
  if (minutes < 1) return 'Leaving now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hr`;

  // Whole calendar days on this phone, so "Tomorrow" means the next date.
  const now = new Date(nowMs);
  const departure = new Date(departureMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDepartureDay = new Date(
    departure.getFullYear(),
    departure.getMonth(),
    departure.getDate()
  ).getTime();
  const days = Math.round((startOfDepartureDay - startOfToday) / 86400000);
  if (days <= 1) return 'Tomorrow';
  return `in ${days} days`;
}
