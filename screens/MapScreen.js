import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Ionicons from '@react-native-vector-icons/ionicons';
import AppButton from '../components/AppButton';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Notice from '../components/Notice';
import RouteLine from '../components/RouteLine';
import ScreenHeader from '../components/ScreenHeader';
import { SMU_MAP_REGION, isSamePickup, pickupKey } from '../lib/pickupLocations';
import {
  fetchDrivingRoute,
  formatDriveTime,
  formatMiles,
  straightLineMeters,
} from '../lib/routing';
import { colors, createThemedStyles, getColorScheme, gutter, radius, shadow, spacing, typography } from '../theme/theme';

// Map tab: the rides on the board, shown as pins at their pickup spots
// around the SMU campus. Rides leaving from the same spot share one pin;
// tapping it lists them, each with a button to open its Ride Details.
//
// The map only shows where RIDES leave from. It never asks for, or shows,
// the user's own location. A ride with no pickup spot isn't on the map (it
// is still on the Home board), and the note at the top says how many.
//
// Route view: a ride with both a pickup spot and a mapped destination has a
// View Route button. It shows just that ride's two pins and the driving
// route between them (from OSRM, see lib/routing.js). If the route can't be
// loaded, a dashed straight line is drawn instead and labeled as NOT being
// driving directions, with no drive time. Destinations are only ever the
// preset the driver picked: nothing is worked out from the typed text.

// How long the route card is assumed to be until it has been measured.
const ROUTE_CARD_HEIGHT_GUESS = 300;

export default function MapScreen({
  drivers,
  isBoardLoading,
  isRefreshing,
  boardError,
  handleRefresh,
  onOpenRide,
  onGoHome,
}) {
  // The key of the pickup spot whose rides are showing, or null.
  const [selectedSpotKey, setSelectedSpotKey] = useState(null);
  // The id of the ride whose route is showing, or null while browsing.
  const [routeRideId, setRouteRideId] = useState(null);
  // Goes up by one each time Try Again is tapped, to look the route up again.
  const [routeAttempt, setRouteAttempt] = useState(0);
  // The answer to the latest route lookup: { key, status: 'road', coordinates,
  // distanceMeters, durationSeconds } or { key, status: 'unavailable' }. `key`
  // says which lookup it answers, so an old answer is never shown for a
  // different ride.
  const [routeResult, setRouteResult] = useState(null);
  const mapRef = useRef(null);
  const routeCardHeightRef = useRef(ROUTE_CARD_HEIGHT_GUESS);

  // Group the rides that have a pickup into one entry per spot.
  const spots = [];
  for (const ride of drivers) {
    if (!ride.pickup) continue;
    const key = pickupKey(ride.pickup);
    let spot = spots.find((s) => s.key === key);
    if (!spot) {
      spot = { key, label: ride.pickup.label, coordinate: ride.pickup, rides: [] };
      spots.push(spot);
    }
    spot.rides.push(ride);
  }
  const offMapCount = drivers.filter((ride) => !ride.pickup).length;
  // null again if the selected spot's last ride was cancelled.
  const selectedSpot = spots.find((spot) => spot.key === selectedSpotKey) || null;
  const isFirstLoad = isBoardLoading && drivers.length === 0;

  // The ride whose route is showing. null again if it was cancelled, or
  // edited so that it no longer has both points.
  const routeRide = drivers.find((ride) => ride.id === routeRideId && hasRoute(ride)) || null;
  const fromLat = routeRide ? routeRide.pickup.latitude : null;
  const fromLng = routeRide ? routeRide.pickup.longitude : null;
  const toLat = routeRide ? routeRide.destinationPoint.latitude : null;
  const toLng = routeRide ? routeRide.destinationPoint.longitude : null;
  const routeKey = routeRide ? `${fromLat},${fromLng}|${toLat},${toLng}|${routeAttempt}` : null;
  // 'loading' until the lookup for exactly this route has answered.
  const route =
    routeResult !== null && routeResult.key === routeKey ? routeResult : { status: 'loading' };

  // Zooms the map so every coordinate is visible above the route card.
  function fitMapTo(coordinates) {
    if (!mapRef.current) return;
    mapRef.current.fitToCoordinates(coordinates, {
      edgePadding: {
        top: 70,
        right: 50,
        bottom: routeCardHeightRef.current + spacing.md + 40,
        left: 50,
      },
      animated: true,
    });
  }

  // Looks up the driving route whenever a route view opens (or Try Again is
  // tapped). Leaving the route view, or opening another, abandons it.
  useEffect(() => {
    if (routeKey === null) return undefined;
    const from = { latitude: fromLat, longitude: fromLng };
    const to = { latitude: toLat, longitude: toLng };
    const controller = new AbortController();
    let isCurrent = true;

    fitMapTo([from, to]);
    fetchDrivingRoute(from, to, controller.signal)
      .then((found) => {
        if (!isCurrent) return;
        setRouteResult({ key: routeKey, status: 'road', ...found });
        fitMapTo(found.coordinates);
      })
      .catch((error) => {
        if (!isCurrent) return;
        console.warn('CarpoolBoard: route lookup failed', error);
        setRouteResult({ key: routeKey, status: 'unavailable' });
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [routeKey, fromLat, fromLng, toLat, toLng]);

  function handleViewRoute(rideId) {
    // Start from "loading" even if this ride's route was looked up before.
    setRouteResult(null);
    setRouteAttempt(0);
    setRouteRideId(rideId);
  }

  // Back to browsing: the pin the route was opened from is still selected.
  function handleCloseRoute() {
    setRouteRideId(null);
    if (mapRef.current) {
      mapRef.current.animateToRegion(SMU_MAP_REGION, 400);
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Map"
        subtitle={
          routeRide ? 'Showing one ride’s route' : 'Tap a pin to see rides leaving from there'
        }
        right={
          <AppButton
            title="Refresh"
            icon="refresh"
            variant="secondary"
            size="sm"
            loading={isRefreshing}
            onPress={handleRefresh}
          />
        }
      />

      {boardError !== '' && (
        <View style={styles.padded}>
          <Notice message={boardError} tone="danger" />
        </View>
      )}

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={SMU_MAP_REGION}
          userInterfaceStyle={getColorScheme()}
          showsUserLocation={false}
          toolbarEnabled={false}
          onPress={(event) => {
            // Tapping the map itself (not a pin) closes the preview.
            // The route view is only closed with its own Close buttons.
            if (event.nativeEvent.action !== 'marker-press' && !routeRide) {
              setSelectedSpotKey(null);
            }
          }}
        >
          {/* Route view: only this ride's two pins and the line between
              them. The other pickup pins come back when it closes. */}
          {routeRide && (
            <Marker
              key="route-pickup"
              coordinate={routeRide.pickup}
              pinColor={colors.rider}
              title={routeRide.pickup.label}
              description="Pickup"
              accessibilityLabel={`Pickup: ${routeRide.pickup.label}`}
            />
          )}
          {routeRide && (
            <Marker
              key="route-destination"
              coordinate={routeRide.destinationPoint}
              pinColor={colors.success}
              title={routeRide.destinationPoint.label}
              description="Destination"
              accessibilityLabel={`Destination: ${routeRide.destinationPoint.label}`}
            />
          )}
          {routeRide && route.status === 'road' && (
            <Polyline
              coordinates={route.coordinates}
              strokeColor={colors.primary}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {/* Straight-line fallback: thin, pale and dashed so it can't be
              mistaken for the solid blue road route. */}
          {routeRide && route.status === 'unavailable' && (
            <Polyline
              coordinates={[routeRide.pickup, routeRide.destinationPoint]}
              strokeColor={colors.text}
              strokeWidth={3}
              lineDashPattern={[10, 10]}
            />
          )}

          {!routeRide && spots.map((spot) => {
            const isSelected = spot.key === selectedSpotKey;
            const allFull = spot.rides.every((ride) => ride.seats === 0);
            const pinColor = isSelected ? colors.rider : allFull ? colors.textFaint : colors.primary;
            return (
              <Marker
                // The color is part of the key so a pin is redrawn when it
                // changes (native pins don't always pick up a new color).
                key={`${spot.key}-${pinColor}`}
                coordinate={spot.coordinate}
                pinColor={pinColor}
                onPress={() => setSelectedSpotKey(spot.key)}
                accessibilityLabel={`${spot.label}: ${spot.rides.length} ride${
                  spot.rides.length === 1 ? '' : 's'
                }`}
              />
            );
          })}
        </MapView>

        {/* Status notes over the top of the map */}
        <View style={styles.topOverlay} pointerEvents="box-none">
          {routeRide ? null : isFirstLoad ? (
            <View style={styles.pill}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.pillText}>Loading rides…</Text>
            </View>
          ) : spots.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="map-outline" size={22} color={colors.primary} />
              <Text style={styles.emptyTitle}>No rides on the map yet</Text>
              <Text style={styles.emptyText}>
                {offMapCount > 0
                  ? `${offMapCount} ride${offMapCount === 1 ? ' has' : 's have'} no pickup spot. Drivers can add one by editing their ride.`
                  : 'Rides appear here once a driver posts one with a pickup spot.'}
              </Text>
              <AppButton
                title="Browse Rides on Home"
                variant="secondary"
                size="sm"
                onPress={onGoHome}
                style={styles.emptyButton}
              />
            </View>
          ) : offMapCount > 0 ? (
            <View style={styles.pill}>
              <Ionicons name="information-circle" size={16} color={colors.textMuted} />
              <Text style={styles.pillText}>
                {offMapCount} more ride{offMapCount === 1 ? '' : 's'} without a pickup spot on Home
              </Text>
            </View>
          ) : null}
        </View>

        {/* Ride preview for the tapped pin */}
        {selectedSpot && !routeRide && (
          <View style={styles.preview}>
            <View style={styles.previewHeader}>
              <Ionicons name="location" size={18} color={colors.rider} />
              <View style={styles.previewTitleCol}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {selectedSpot.label}
                </Text>
                <Text style={styles.previewSub}>
                  {selectedSpot.rides.length} ride{selectedSpot.rides.length === 1 ? '' : 's'} leaving
                  from here
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedSpotKey(null)}
                accessibilityRole="button"
                accessibilityLabel="Close ride preview"
                hitSlop={10}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={styles.previewList}>
              {selectedSpot.rides.map((ride) => (
                <View key={ride.id} style={styles.previewRide}>
                  <View style={styles.previewRideTop}>
                    <Avatar name={ride.name} role="driver" uri={ride.avatarUrl} size={36} />
                    <View style={styles.previewRideText}>
                      <Text style={styles.previewDestination} numberOfLines={1}>
                        To {ride.destination}
                      </Text>
                      <Text style={styles.previewMeta} numberOfLines={1}>
                        {ride.departureTime}
                      </Text>
                      <Text style={styles.previewMeta} numberOfLines={1}>
                        Driver: {ride.name}
                      </Text>
                    </View>
                    <Badge
                      label={
                        ride.seats === 0
                          ? 'Full'
                          : `${ride.seats} seat${ride.seats === 1 ? '' : 's'} left`
                      }
                      tone={ride.seats === 0 ? 'danger' : 'driver'}
                    />
                  </View>
                  <AppButton
                    title="Open Ride Details"
                    icon="arrow-forward"
                    size="sm"
                    onPress={() => onOpenRide(ride.id)}
                    style={styles.previewButton}
                  />
                  {hasRoute(ride) ? (
                    <AppButton
                      title="View Route"
                      icon="navigate-outline"
                      variant="secondary"
                      size="sm"
                      onPress={() => handleViewRoute(ride.id)}
                      style={styles.routeButton}
                    />
                  ) : (
                    <Text style={styles.noRouteText}>
                      {ride.destinationPoint
                        ? 'This ride’s pickup spot and destination are the same place, so there is no route to show.'
                        : 'No route to show: this ride’s destination has no map location yet. The driver can add one by editing the ride.'}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Route card for the ride whose route is showing */}
        {routeRide && (
          <View
            style={styles.preview}
            onLayout={(event) => {
              routeCardHeightRef.current = event.nativeEvent.layout.height;
            }}
          >
            <View style={styles.previewHeader}>
              <Ionicons name="navigate" size={18} color={colors.primary} />
              <View style={styles.previewTitleCol}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  Route
                </Text>
                <Text style={styles.previewSub} numberOfLines={1}>
                  {routeRide.name}’s ride · {routeRide.departureTime}
                </Text>
              </View>
              <Pressable
                onPress={handleCloseRoute}
                accessibilityRole="button"
                accessibilityLabel="Close route"
                hitSlop={10}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.routeStops}>
              <RouteLine
                pickup={routeRide.pickup.label}
                destination={routeRide.destinationPoint.label}
                compact
              />
              {/* The pin marks the preset place; what the driver typed may
                  be worded differently, so both are shown when they differ. */}
              {!isSameText(routeRide.destination, routeRide.destinationPoint.label) && (
                <Text style={styles.routeTyped} numberOfLines={2}>
                  Driver’s description: {routeRide.destination}
                </Text>
              )}
            </View>

            {route.status === 'loading' && (
              <View style={styles.routeLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.routeLoadingText}>Finding the driving route…</Text>
              </View>
            )}

            {route.status === 'road' && (
              <View>
                <View style={styles.routeFacts}>
                  <Ionicons name="car-sport" size={18} color={colors.primary} />
                  <Text style={styles.routeFactsText}>
                    {formatMiles(route.distanceMeters)} · about{' '}
                    {formatDriveTime(route.durationSeconds)} drive
                  </Text>
                </View>
                <Text style={styles.routeCredit}>
                  Drive time is an estimate and doesn’t include live traffic. Route data ©
                  OpenStreetMap contributors, routed by OSRM.
                </Text>
              </View>
            )}

            {route.status === 'unavailable' && (
              <View>
                <Notice
                  tone="warning"
                  message={`Driving route unavailable right now. The dashed line is a straight line between the two pins (${formatMiles(
                    straightLineMeters(routeRide.pickup, routeRide.destinationPoint)
                  )}), not driving directions.`}
                  style={styles.routeNotice}
                />
                <AppButton
                  title="Try Again"
                  icon="refresh"
                  variant="secondary"
                  size="sm"
                  onPress={() => setRouteAttempt((attempt) => attempt + 1)}
                />
              </View>
            )}

            <View style={styles.routeActions}>
              <AppButton
                title="Ride Details"
                icon="arrow-forward"
                size="sm"
                onPress={() => onOpenRide(routeRide.id)}
                style={styles.routeAction}
              />
              <AppButton
                title="Close Route"
                icon="close"
                variant="secondary"
                size="sm"
                onPress={handleCloseRoute}
                style={styles.routeAction}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

// Whether a ride has both ends of a route: a pickup spot and a mapped
// destination that aren't the same place.
function hasRoute(ride) {
  return (
    ride.pickup !== null &&
    ride.destinationPoint !== null &&
    !isSamePickup(ride.pickup, ride.destinationPoint)
  );
}

function isSameText(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const styles = createThemedStyles(() => ({
  screen: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: gutter,
  },
  mapWrap: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  topOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: gutter,
    right: gutter,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    ...shadow.card,
  },
  pillText: {
    ...typography.caption,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    ...shadow.card,
  },
  emptyTitle: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.sm,
  },
  emptyText: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  emptyButton: {
    marginTop: spacing.md,
  },
  preview: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    ...shadow.card,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewTitleCol: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  previewTitle: {
    ...typography.title,
    color: colors.text,
  },
  previewSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  previewList: {
    maxHeight: 250,
  },
  previewRide: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  previewRideTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewRideText: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  previewDestination: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  previewMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  previewButton: {
    marginTop: spacing.md,
  },
  routeButton: {
    marginTop: spacing.sm,
  },
  noRouteText: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  routeStops: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  routeTyped: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  routeLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  routeLoadingText: {
    ...typography.label,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  routeFacts: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  routeFactsText: {
    ...typography.bodyStrong,
    color: colors.text,
    marginLeft: spacing.sm,
    flex: 1,
  },
  routeCredit: {
    ...typography.caption,
    color: colors.textFaint,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  routeNotice: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  routeActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  routeAction: {
    flex: 1,
  },
}));
