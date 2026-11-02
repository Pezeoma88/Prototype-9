import { useRef, useState } from 'react';
import { Keyboard, Linking, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@react-native-vector-icons/ionicons';
import AppButton from '../components/AppButton';
import BackHeader from '../components/BackHeader';
import FormSection from '../components/FormSection';
import Notice from '../components/Notice';
import RidePostedCard from '../components/RidePostedCard';
import SearchableSelect from '../components/SearchableSelect';
import {
  DEPARTURE_MINUTE_INTERVAL,
  MAX_SEATS,
  MIN_SEATS,
  formatDepartureDate,
  formatDepartureTime,
} from '../lib/format';
import { locateNearestPickup } from '../lib/currentLocation';
import { DESTINATION_LOCATIONS } from '../lib/destinationLocations';
import { PICKUP_LOCATIONS, isSamePickup, isValidCoordinate } from '../lib/pickupLocations';
import { colors, createThemedStyles, getColorScheme, radius, spacing, typography } from '../theme/theme';

// The destination preset whose name matches the typed destination, if any.
function findDestinationPreset(text) {
  const wanted = text.trim().toLowerCase();
  return DESTINATION_LOCATIONS.find((spot) => spot.label.toLowerCase() === wanted) || null;
}

// A map point ({ latitude, longitude, label }) from a preset, or null when
// the preset is missing or has no usable coordinates, so a broken point can
// never reach the form state or Supabase.
function toPoint(spot) {
  if (!spot || !isValidCoordinate(spot.latitude, spot.longitude)) {
    return null;
  }
  return { latitude: spot.latitude, longitude: spot.longitude, label: spot.label };
}

// Offer a Ride / Edit Ride form for Drivers, grouped into Route, When, and
// Seats sections. State, validation, and saving stay in App.js; this
// component only renders them. Once Supabase confirms a save, the Ride
// posted screen is shown here instead of the form.
export default function RideForm({
  currentUser,
  editingRideId,
  editingDriver,
  destinationInput,
  setDestinationInput,
  pickupInput,
  setPickupInput,
  destinationPointInput,
  setDestinationPointInput,
  departureAtInput,
  departurePickerMode,
  setDeparturePickerMode,
  departurePickerMinimumDate,
  handleToggleDeparturePicker,
  handleDeparturePicked,
  seatsInput,
  setSeatsInput,
  formError,
  isSubmittingDriver,
  handleSaveDriver,
  resetForm,
  rideConfirmation,
  handleEditPostedRide,
  handleFinishPostedRide,
}) {
  const isEditing = editingRideId !== null;

  // Whether the mapped destination was filled in automatically from the
  // destination preset (true) or picked by the driver (false). Only an
  // automatic one follows later destination changes; a driver's own pick is
  // never overwritten. A saved ride whose map location matches its
  // destination preset counts as automatic.
  const [isPointAuto, setIsPointAuto] = useState(() => {
    const preset = findDestinationPreset(destinationInput);
    return preset !== null && destinationPointInput !== null && isSamePickup(preset, destinationPointInput);
  });

  // "Use My Location": whether a lookup is running, and the message about
  // its outcome ({ tone, message, showSettings } or null). A manual pick
  // bumps locateRequest so a lookup still in flight can't overwrite it.
  const [isLocating, setIsLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState(null);
  const locateRequest = useRef(0);

  if (rideConfirmation) {
    return (
      <RidePostedCard
        ride={rideConfirmation}
        onBackToHome={handleFinishPostedRide}
        onEdit={handleEditPostedRide}
      />
    );
  }

  function handlePickPickup(spot) {
    Keyboard.dismiss();
    setDeparturePickerMode(null);
    setPickupInput(spot);
    locateRequest.current += 1;
    setIsLocating(false);
    setLocationNotice(null);
  }

  // Picks the landmark nearest the phone. Only the landmark (its own name and
  // coordinates) goes into the form; the phone's position never leaves
  // locateNearestPickup.
  async function handleUseMyLocation() {
    if (isLocating) {
      return;
    }
    Keyboard.dismiss();
    setDeparturePickerMode(null);
    const request = ++locateRequest.current;
    setIsLocating(true);
    setLocationNotice(null);

    const result = await locateNearestPickup();
    if (request !== locateRequest.current) {
      return;
    }
    setIsLocating(false);

    if (result.spot) {
      setPickupInput(result.spot);
      setLocationNotice({
        tone: 'info',
        message: `Pickup set to ${result.spot.label}, the closest SMU landmark to you.`,
      });
    } else if (result.denied) {
      setLocationNotice({
        tone: 'warning',
        message: result.canAskAgain
          ? 'Location access wasn’t allowed. Choose a pickup spot below, or tap Use My Location to try again.'
          : 'Location access is off for CarpoolBoard. You can turn it on in Settings, or choose a pickup spot below.',
        showSettings: !result.canAskAgain,
      });
    } else if (result.servicesOff) {
      setLocationNotice({
        tone: 'warning',
        message:
          'Location Services are turned off on this phone. Turn them on in Settings › Privacy & Security, or choose a pickup spot below.',
      });
    } else if (result.tooFar) {
      setLocationNotice({
        tone: 'warning',
        message:
          'You’re more than about 1.5 km from the SMU pickup spots, so automatic selection isn’t available. Choose a pickup spot below.',
      });
    } else {
      setLocationNotice({
        tone: 'warning',
        message: 'We couldn’t get your location. Choose a pickup spot below.',
      });
    }
  }

  // Picking a destination preset also maps it, unless the driver already
  // chose a map location themselves. SearchableSelect hands back only
  // { key, label }, so the coordinates come from the preset list.
  function handleSelectDestination(option) {
    setDestinationInput(option.label);
    const point = toPoint(DESTINATION_LOCATIONS.find((spot) => spot.key === option.key));
    if (point !== null && (destinationPointInput === null || isPointAuto)) {
      setDestinationPointInput(point);
      setIsPointAuto(true);
    }
  }

  // Typing away from a preset drops the map location it filled in, so the
  // map never shows a place the destination no longer names.
  function handleChangeDestinationText(text) {
    setDestinationInput(text);
    if (isPointAuto && destinationPointInput !== null && text.trim() !== destinationPointInput.label) {
      setDestinationPointInput(null);
      setIsPointAuto(false);
    }
  }

  function handleClearDestination() {
    setDestinationInput('');
    if (isPointAuto) {
      setDestinationPointInput(null);
      setIsPointAuto(false);
    }
  }

  function handlePickDestinationPoint(spot) {
    setDeparturePickerMode(null);
    setDestinationPointInput(spot);
    setIsPointAuto(false);
    // Saves typing the same name twice. Text the driver already typed is
    // never replaced.
    if (spot !== null && destinationInput.trim() === '') {
      setDestinationInput(spot.label);
    }
  }

  const destinationOptions = DESTINATION_LOCATIONS.map((spot) => ({ key: spot.key, label: spot.label }));
  const selectedDestination = findDestinationPreset(destinationInput);

  // A ride being edited whose saved map location isn't one of the presets
  // keeps it as an extra choice, so opening the form never silently changes it.
  const savedPointIsCustom =
    destinationPointInput !== null &&
    !DESTINATION_LOCATIONS.some((spot) => isSamePickup(spot, destinationPointInput));
  const mapSpots = savedPointIsCustom
    ? [{ key: 'current', ...destinationPointInput }, ...DESTINATION_LOCATIONS]
    : DESTINATION_LOCATIONS;
  const selectedMapSpot =
    destinationPointInput === null
      ? null
      : mapSpots.find((spot) => isSamePickup(spot, destinationPointInput)) || null;

  // Seats: the driver isn't counted. When editing, total seats can't drop
  // below the riders already confirmed (App.js re-checks this on save).
  const confirmedRiders = editingDriver !== null ? editingDriver.matchedRiders.length : 0;
  const minSeats = Math.max(MIN_SEATS, confirmedRiders);
  const parsedSeats = parseInt(seatsInput, 10);
  const seats = Number.isNaN(parsedSeats) ? minSeats : parsedSeats;
  const canDecrease = seats > minSeats;
  const canIncrease = seats < MAX_SEATS;

  function changeSeats(delta) {
    Keyboard.dismiss();
    setDeparturePickerMode(null);
    const next = Math.min(MAX_SEATS, Math.max(minSeats, seats + delta));
    setSeatsInput(String(next));
  }

  return (
    <View>
      <BackHeader
        backLabel="Cancel"
        onBack={resetForm}
        title={isEditing ? 'Edit Ride' : 'Offer a Ride'}
        subtitle={`${isEditing ? 'Editing' : 'Posting'} as ${currentUser.name}`}
      />

      {/* Destination: one searchable field instead of a list of buttons.
          Presets are suggested as the driver types, but any text can still
          be used. The mapped destination below is optional and separate:
          it only ever comes from the preset places, never from typed text. */}
      <FormSection title="Route" icon="navigate">
        <SearchableSelect
          label="Where are you going?"
          icon="flag-outline"
          placeholder="Search destinations"
          value={destinationInput}
          options={destinationOptions}
          selectedKey={selectedDestination ? selectedDestination.key : null}
          onSelect={handleSelectDestination}
          onClear={handleClearDestination}
          freeText
          onChangeText={handleChangeDestinationText}
          emptyMessage="No matching destinations. You can still use what you typed."
          onFocus={() => setDeparturePickerMode(null)}
        />

        <SearchableSelect
          label="Destination on map (optional)"
          icon="map-outline"
          placeholder="No map location"
          value={destinationPointInput !== null ? destinationPointInput.label : ''}
          options={mapSpots.map((spot) => ({ key: spot.key, label: spot.label }))}
          selectedKey={selectedMapSpot ? selectedMapSpot.key : null}
          onSelect={(option) => {
            const point = toPoint(mapSpots.find((spot) => spot.key === option.key));
            if (point !== null) {
              handlePickDestinationPoint(point);
            }
          }}
          onClear={() => handlePickDestinationPoint(null)}
          noneLabel="None"
          onFocus={() => setDeparturePickerMode(null)}
          style={styles.mapField}
        />
        <Text style={styles.pickupHint}>
          {isPointAuto && destinationPointInput !== null
            ? 'Mapped from your destination. Change it if the place is different.'
            : 'With a pickup spot and a map location, riders can view the route on the Map tab.'}
        </Text>
      </FormSection>

      {/* Pickup is chosen from preset public landmarks rather than typed or
          pinned, so it always has a readable name and is never a private
          address. It's required to post or save a ride. */}
      <FormSection title="Pickup spot" icon="location">
        <AppButton
          title={isLocating ? 'Finding nearest landmark…' : 'Use My Location'}
          icon="navigate"
          variant="secondary"
          size="sm"
          onPress={handleUseMyLocation}
          loading={isLocating}
          style={styles.locateButton}
        />
        {locationNotice !== null && (
          <View accessibilityLiveRegion="polite">
            <Notice message={locationNotice.message} tone={locationNotice.tone} />
            {locationNotice.showSettings && (
              <Pressable
                onPress={() => Linking.openSettings()}
                accessibilityRole="link"
                style={styles.settingsLink}
              >
                <Text style={styles.settingsLinkText}>Open Settings</Text>
              </Pressable>
            )}
          </View>
        )}
        <SpotPicker
          value={pickupInput}
          presets={PICKUP_LOCATIONS}
          emptyLabel="No pickup spot"
          onPick={handlePickPickup}
        />
        <Text style={styles.pickupHint}>
          Test locations: public SMU landmarks. Riders see your ride on the Map tab at this spot.
        </Text>
      </FormSection>

      {/* Departure is picked on native scrolling wheels instead of typed:
          tapping the Date or Time tile opens one wheel, and the two picks
          combine into a single Date. On iPhone the wheels appear inline
          (spinner style); on Android the system date/time dialogs are used. */}
      <FormSection title="When are you leaving?" icon="calendar">
        <View style={styles.tiles}>
          {[
            {
              mode: 'date',
              label: 'Date',
              icon: 'calendar-outline',
              value: departureAtInput !== null ? formatDepartureDate(departureAtInput) : null,
            },
            {
              mode: 'time',
              label: 'Time',
              icon: 'time-outline',
              value: departureAtInput !== null ? formatDepartureTime(departureAtInput) : null,
            },
          ].map((tile) => {
            const isActive = departurePickerMode === tile.mode;
            return (
              <Pressable
                key={tile.mode}
                onPress={() => handleToggleDeparturePicker(tile.mode)}
                accessibilityRole="button"
                accessibilityLabel={`Departure ${tile.label.toLowerCase()}, ${tile.value ?? 'not chosen'}`}
                accessibilityHint={isActive ? 'Closes the picker' : 'Opens a picker to change it'}
                accessibilityState={{ expanded: isActive }}
                style={({ pressed }) => [
                  styles.tile,
                  isActive && styles.tileActive,
                  pressed && styles.pickerButtonPressed,
                ]}
              >
                <View style={styles.tileHeader}>
                  <Ionicons name={tile.icon} size={14} color={colors.primary} />
                  <Text style={styles.tileLabel}>{tile.label}</Text>
                  {isActive && <Text style={styles.tileDone}>Done</Text>}
                </View>
                <Text
                  style={tile.value !== null ? styles.tileValue : styles.tilePlaceholder}
                  numberOfLines={1}
                >
                  {tile.value ?? `Choose ${tile.label.toLowerCase()}`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {departurePickerMode !== null && departureAtInput !== null && (
          <View style={Platform.OS === 'ios' ? styles.pickerBox : null}>
            <DateTimePicker
              key={departurePickerMode}
              value={departureAtInput}
              mode={departurePickerMode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={departurePickerMinimumDate}
              minuteInterval={DEPARTURE_MINUTE_INTERVAL}
              themeVariant={getColorScheme()}
              textColor={colors.text}
              locale="en-US"
              onValueChange={(event, date) => handleDeparturePicked(date)}
              onDismiss={() => setDeparturePickerMode(null)}
            />
          </View>
        )}
      </FormSection>

      <FormSection title="Available seats" icon="people">
        <View style={styles.stepper}>
          <StepperButton
            icon="remove"
            label="Remove a seat"
            disabled={!canDecrease}
            onPress={() => changeSeats(-1)}
          />
          <View
            style={styles.stepperValue}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Available seats"
            accessibilityValue={{ min: minSeats, max: MAX_SEATS, now: seats, text: `${seats}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) =>
              changeSeats(event.nativeEvent.actionName === 'increment' ? 1 : -1)
            }
          >
            <Text style={styles.stepperCount}>{seats}</Text>
            <Text style={styles.stepperUnit}>{seats === 1 ? 'seat' : 'seats'}</Text>
          </View>
          <StepperButton
            icon="add"
            label="Add a seat"
            disabled={!canIncrease}
            onPress={() => changeSeats(1)}
          />
        </View>
        <Text style={styles.pickupHint}>
          {confirmedRiders > 0
            ? `${confirmedRiders} confirmed rider${confirmedRiders === 1 ? '' : 's'} — total seats can't go below that.`
            : `Between ${MIN_SEATS} and ${MAX_SEATS}, not counting yourself.`}
        </Text>
      </FormSection>

      {formError !== '' && <Notice message={formError} tone="danger" style={styles.error} />}

      <AppButton
        title={isEditing ? 'Save Changes' : 'Post Ride'}
        icon={isEditing ? 'checkmark-circle-outline' : 'car-sport'}
        onPress={handleSaveDriver}
        loading={isSubmittingDriver}
        style={styles.submit}
      />
      <AppButton title="Cancel" variant="secondary" onPress={resetForm} />
    </View>
  );
}

function StepperButton({ icon, label, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.stepperButton,
        disabled && styles.stepperButtonDisabled,
        pressed && !disabled && styles.stepperButtonPressed,
      ]}
    >
      <Ionicons name={icon} size={22} color={disabled ? colors.textFaint : colors.textOnAccent} />
    </Pressable>
  );
}

// The current choice plus a row of chips for picking a preset map spot (or
// none). `value` is { latitude, longitude, label } or null. A ride being
// edited whose saved spot isn't one of the presets keeps it as an extra
// choice, so opening the form never silently changes it.
function SpotPicker({ value, presets, emptyLabel, onPick }) {
  const options =
    value !== null && !presets.some((spot) => isSamePickup(spot, value))
      ? [{ key: 'current', ...value }, ...presets]
      : presets;

  return (
    <View>
      <View style={styles.pickupDisplay}>
        <Ionicons
          name={value !== null ? 'location' : 'location-outline'}
          size={18}
          color={value !== null ? colors.primary : colors.textFaint}
        />
        <Text
          style={value !== null ? styles.departureText : styles.departurePlaceholder}
          numberOfLines={1}
        >
          {value !== null ? value.label : emptyLabel}
        </Text>
      </View>
      <View style={styles.pickupChips}>
        {[null, ...options].map((spot) => {
          const isActive = spot === null ? value === null : isSamePickup(spot, value);
          return (
            <Pressable
              key={spot === null ? 'none' : spot.key}
              onPress={() =>
                onPick(
                  spot === null
                    ? null
                    : { latitude: spot.latitude, longitude: spot.longitude, label: spot.label }
                )
              }
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={spot === null ? emptyLabel : spot.label}
              style={({ pressed }) => [
                styles.pickupChip,
                isActive && styles.pickupChipActive,
                pressed && styles.pickerButtonPressed,
              ]}
            >
              <Text
                style={[styles.pickupChipText, isActive && styles.pickupChipTextActive]}
                numberOfLines={1}
              >
                {spot === null ? 'None' : spot.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  mapField: {
    marginTop: spacing.md,
  },
  pickupDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 50,
    gap: 10,
  },
  pickupChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pickupChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    maxWidth: '100%',
  },
  pickupChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pickupChipText: {
    ...typography.label,
    color: colors.text,
  },
  pickupChipTextActive: {
    color: colors.textOnAccent,
  },
  locateButton: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  settingsLink: {
    alignSelf: 'flex-start',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
  },
  settingsLinkText: {
    ...typography.label,
    color: colors.primary,
  },
  pickupHint: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  departureText: {
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.text,
    flex: 1,
  },
  departurePlaceholder: {
    fontSize: 16,
    color: colors.textFaint,
    flex: 1,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 60,
    justifyContent: 'center',
  },
  tileActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  tileLabel: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
  tileDone: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
  tileValue: {
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.text,
  },
  tilePlaceholder: {
    fontSize: 16,
    color: colors.textFaint,
  },
  pickerButtonPressed: {
    opacity: 0.7,
  },
  pickerBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  stepperButton: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  stepperButtonDisabled: {
    backgroundColor: colors.muted,
  },
  stepperValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
  },
  stepperCount: {
    ...typography.display,
    color: colors.text,
  },
  stepperUnit: {
    ...typography.body,
    color: colors.textMuted,
  },
  error: {
    marginTop: spacing.xs,
  },
  submit: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
}));
