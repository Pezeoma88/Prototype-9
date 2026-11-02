import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { isValidCoordinate, pickupKey } from '../lib/pickupLocations';
import { colors, createThemedStyles, getColorScheme, radius, spacing } from '../theme/theme';

// How much of the map shows around the pickup: the landmark and the
// buildings right around it.
const PREVIEW_DELTA = 0.0025;

// Small, static map of a ride's pickup spot for Ride Details. `pickup` is
// the ride's { latitude, longitude, label } (lib/board.js getRidePickup) or
// null. Without a valid point nothing is drawn. Gestures are off so the
// page's ScrollView keeps scrolling over it; the Map tab is for exploring.
//
// The map uses initialRegion, not a controlled region: on iOS a region set
// before the map has its size can be dropped, leaving a wide default view.
// Keying the map by the pickup spot remounts it when the pickup changes, and
// onMapReady re-applies the region in case the first one was missed.
export default function PickupMapPreview({ pickup, style }) {
  const mapRef = useRef(null);

  if (!pickup || !isValidCoordinate(pickup.latitude, pickup.longitude)) {
    return null;
  }

  const coordinate = { latitude: pickup.latitude, longitude: pickup.longitude };
  const region = { ...coordinate, latitudeDelta: PREVIEW_DELTA, longitudeDelta: PREVIEW_DELTA };

  return (
    <View
      style={[styles.wrap, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Map preview of pickup: ${pickup.label}`}
    >
      <MapView
        key={pickupKey(pickup)}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onMapReady={() => mapRef.current?.animateToRegion(region, 0)}
        userInterfaceStyle={getColorScheme()}
        showsUserLocation={false}
        toolbarEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Marker coordinate={coordinate} pinColor={colors.rider} title={pickup.label} description="Pickup" />
      </MapView>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  wrap: {
    height: 160,
    marginTop: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
}));
