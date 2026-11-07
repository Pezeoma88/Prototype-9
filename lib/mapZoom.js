// Zoom calculations for the Map tab's Zoom in / Zoom out buttons.
//
// A map region is { latitude, longitude, latitudeDelta, longitudeDelta }:
// the center, and how many degrees of latitude and longitude are visible.
// Zooming in shows less (smaller deltas); zooming out shows more.
//
// The buttons keep each delta between MIN_REGION_DELTA (the closest they
// can zoom in, a few campus buildings across) and MAX_REGION_DELTA (the
// farthest they can zoom out, central Dallas around SMU). These limits only
// apply to the buttons: pinching and route framing are limited separately
// by the map itself (see MAP_MAX_ZOOM_LEVEL).

export const MIN_REGION_DELTA = 0.002;
export const MAX_REGION_DELTA = 0.2;

// Factors for zoomRegion: in halves the visible area, out doubles it.
export const ZOOM_IN_FACTOR = 0.5;
export const ZOOM_OUT_FACTOR = 2;

// The map-level limit passed to MapView's maxZoomLevel, so that a short
// route framed with fitToCoordinates can't zoom in closer than the buttons
// can. Zoom level 18 is roughly a 0.002-degree-wide view on a phone. On
// Apple Maps (iOS) react-native-maps applies this after the map stops
// moving, by animating back to the limit, so a brief overshoot is possible.
export const MAP_MAX_ZOOM_LEVEL = 18;

function clampDelta(delta) {
  return Math.min(MAX_REGION_DELTA, Math.max(MIN_REGION_DELTA, delta));
}

// Returns a new region with the same center and each delta multiplied by
// `factor`, then kept within the limits. Each delta is scaled and limited
// on its own. The region passed in is never changed.
export function zoomRegion(region, factor) {
  return {
    latitude: region.latitude,
    longitude: region.longitude,
    latitudeDelta: clampDelta(region.latitudeDelta * factor),
    longitudeDelta: clampDelta(region.longitudeDelta * factor),
  };
}
