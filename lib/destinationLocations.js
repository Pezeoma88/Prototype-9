import { PICKUP_LOCATIONS } from './pickupLocations';

// Preset destinations a driver can pin to the map for CarpoolBoard
// Prototype 6: a few common places SMU students ride to, plus the SMU
// landmarks from the pickup list (a ride can end on campus too).
//
// A mapped destination is optional and separate from the destination the
// driver types. It is only ever chosen from this list: the app never turns
// typed text into coordinates.
//
// Coordinates were looked up in OpenStreetMap (Nominatim) on 2026-10-13 and
// rounded to five decimal places (about one metre). Each one is the centre
// of the named place as OpenStreetMap maps it (the airport, the mall, the
// campus, the downtown district), not a specific door, terminal or curb, so
// a driving route ends at the nearest road to that centre.
const OFF_CAMPUS_DESTINATIONS = [
  { key: 'love-field', label: 'Dallas Love Field', latitude: 32.84524, longitude: -96.84732 },
  { key: 'dfw-airport', label: 'DFW International Airport', latitude: 32.8962, longitude: -97.04585 },
  { key: 'northpark-center', label: 'NorthPark Center', latitude: 32.86848, longitude: -96.77365 },
  { key: 'downtown-dallas', label: 'Downtown Dallas', latitude: 32.77979, longitude: -96.79801 },
  { key: 'ut-dallas', label: 'University of Texas at Dallas', latitude: 32.98759, longitude: -96.74978 },
];

// SMU/Mockingbird Station is already one of the pickup landmarks, so it
// comes from that list rather than being repeated here.
export const DESTINATION_LOCATIONS = [...OFF_CAMPUS_DESTINATIONS, ...PICKUP_LOCATIONS];
