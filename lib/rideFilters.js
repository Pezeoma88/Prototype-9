// Rider-mode search, filters, and sorting for Available Rides (Prototype 8).
//
// Everything here works on the rides array App passes in and returns a new
// array: nothing is written back to the database and the original array is
// never reordered. App passes only upcoming rides (lib/rideStatus.js), so
// search and filters never surface a ride that has already departed.
//
// getDepartureMs returns null for a missing or invalid date, so bad data is
// skipped by the date filter and sorted last instead of breaking the
// comparison.
import { getDepartureMs } from './rideStatus';

// Filter state when nothing is applied.
//   query     destination text, matched case-insensitively ('' = any)
//   date      a Date for the departure day to show, or null for any day
//   minSeats  minimum seats still available (0 = any)
//   sort      one of RIDER_SORT_OPTIONS' keys
export const DEFAULT_RIDE_FILTERS = {
  query: '',
  date: null,
  minSeats: 0,
  sort: 'default',
};

// Minimum available seats a ride must have.
export const SEAT_FILTER_OPTIONS = [
  { key: 0, label: 'Any' },
  { key: 1, label: '1+' },
  { key: 2, label: '2+' },
  { key: 3, label: '3+' },
  { key: 4, label: '4+' },
];

// Rider-mode orderings. Default is posting order and A–Z keeps the existing
// destination sort available to riders.
export const RIDER_SORT_OPTIONS = [
  { key: 'default', label: 'Default' },
  { key: 'earliest', label: 'Earliest' },
  { key: 'latest', label: 'Latest' },
  { key: 'destination', label: 'A–Z' },
];


// True when two Dates fall on the same calendar day on this device.
function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

// How many of the panel filters (date, seats, sort) differ from the default.
// The search text isn't counted: it's always visible in its own field.
export function countPanelFilters(filters) {
  let count = 0;
  if (filters.date !== null) count += 1;
  if (filters.minSeats > 0) count += 1;
  if (filters.sort !== DEFAULT_RIDE_FILTERS.sort) count += 1;
  return count;
}

// True when anything (search text included) differs from the default.
export function hasActiveRideFilters(filters) {
  return filters.query.trim() !== '' || countPanelFilters(filters) > 0;
}

// The rides that match `filters`, in the chosen order.
export function filterAndSortRides(rides, filters) {
  const query = filters.query.trim().toLowerCase();
  const date = filters.date instanceof Date && !Number.isNaN(filters.date.getTime()) ? filters.date : null;

  const matches = rides.filter((ride) => {
    if (query !== '') {
      // The typed destination, plus the mapped destination's name when the
      // driver picked one, so "Galleria" finds a ride labeled either way.
      const destination = (ride.destination || '').toLowerCase();
      const mappedLabel = (ride.destinationPoint?.label || '').toLowerCase();
      if (!destination.includes(query) && !mappedLabel.includes(query)) {
        return false;
      }
    }
    if (date !== null) {
      const departureMs = getDepartureMs(ride);
      if (departureMs === null || !isSameLocalDay(new Date(departureMs), date)) {
        return false;
      }
    }
    if (filters.minSeats > 0 && !(ride.seats >= filters.minSeats)) {
      return false;
    }
    return true;
  });

  if (filters.sort === 'earliest' || filters.sort === 'latest') {
    const direction = filters.sort === 'earliest' ? 1 : -1;
    return matches.sort((a, b) => {
      const aMs = getDepartureMs(a);
      const bMs = getDepartureMs(b);
      if (aMs === null || bMs === null) {
        // Rides without a usable departure always go last.
        return (aMs === null) - (bMs === null);
      }
      return (aMs - bMs) * direction;
    });
  }
  if (filters.sort === 'destination') {
    return matches.sort((a, b) =>
      (a.destination || '').localeCompare(b.destination || '', undefined, { sensitivity: 'base' })
    );
  }
  return matches;
}
