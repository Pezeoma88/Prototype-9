import { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Card from '../components/Card';
import AppButton from '../components/AppButton';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import ModeToggle from '../components/ModeToggle';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import Notice from '../components/Notice';
import RideCard from '../components/RideCard';
import RiderCard from '../components/RiderCard';
import RideFilterPanel from '../components/RideFilterPanel';
import { RIDE_SORT_OPTIONS } from '../lib/format';
import { DEFAULT_RIDE_FILTERS } from '../lib/rideFilters';
import { colors, createThemedStyles, gutter, radius, shadow, spacing, typography } from '../theme/theme';

// "Good morning" / "Good afternoon" / "Good evening" from the device clock.
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Home tab: the shared CarpoolBoard. Shows a greeting, the Driver/Rider
// mode toggle, the role's main actions, then Upcoming Rides (Driver offers,
// blue), Riders Looking for a Ride (Rider requests, teal), and the signed-in
// person's own past rides.
//
// Ride expiration: `drivers` here is only the rides that haven't departed
// yet (App filters them with lib/rideStatus.js), so the board, its counts,
// search and filters never offer a ride that already left. `pastRides` are
// departed rides this person drove or requested, shown collapsed at the
// bottom as history (they keep their details and reviews).
//
// Ride Details and the Offer a Ride / Need a Ride forms open in place of the
// board (App passes them in as ready-made elements). State and Supabase
// logic stay in App.js.
//
// This screen applies its own top safe-area inset (instead of App doing it)
// so the KeyboardAvoidingView measures its position from the top of the
// screen and lifts forms the right amount above the keyboard.
export default function HomeScreen({
  currentUser,
  activeMode,
  handleSetMode,
  drivers,
  sortedDrivers,
  pastRides,
  nowMs,
  riders,
  myRequestStatusByRideId,
  isBoardLoading,
  isRefreshing,
  boardError,
  handleRefresh,
  rideSortOrder,
  setRideSortOrder,
  filteredRiderRides,
  rideFilters,
  setRideFilters,
  handleViewRideDetails,
  handleQuickRequest,
  handleLeaveWaitlist,
  isAddingDriver,
  isAddingRider,
  handleAddDriver,
  handleNeedRide,
  isCurrentUserWaiting,
  handleOpenProfile,
  matchConfirmation,
  handleDismissMatchConfirmation,
  scrollViewRef,
  detailsView,
  rideForm,
  riderForm,
}) {
  // The two board sections, so "Find a Ride" / "Find Riders" can scroll
  // straight to them. The Y positions from onLayout are a fallback; the
  // section is measured again when tapped, in case content above it moved.
  const ridesSectionRef = useRef(null);
  const ridersSectionRef = useRef(null);
  const ridesSectionY = useRef(0);
  const ridersSectionY = useRef(0);
  // Past rides start collapsed so the bookable board stays the focus.
  const [showPastRides, setShowPastRides] = useState(false);

  // Driver/Rider UI follows the session's activeMode, not profiles.role.
  const isDriver = activeMode === 'driver';
  const showRideForm = isDriver && isAddingDriver;
  const showRiderForm = !isDriver && isAddingRider;

  // Which view fills the screen. Used as the ScrollView key so switching
  // views (board ↔ details ↔ form) always starts at the top.
  let viewKey = 'board';
  if (matchConfirmation) viewKey = 'match';
  else if (detailsView) viewKey = 'details';
  else if (showRideForm) viewKey = 'rideForm';
  else if (showRiderForm) viewKey = 'riderForm';

  function scrollToY(y) {
    scrollViewRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
  }

  // Scrolls so the section's header (and, for Upcoming Rides, the search
  // bar and Filters button under it) sits at the top of the screen.
  function scrollToSection(sectionRef, fallbackY) {
    Keyboard.dismiss();
    const content = scrollViewRef.current?.getInnerViewRef?.();
    const section = sectionRef.current;
    if (!content || !section?.measureLayout) {
      scrollToY(fallbackY.current);
      return;
    }
    section.measureLayout(
      content,
      (_x, y) => scrollToY(y),
      () => scrollToY(fallbackY.current)
    );
  }

  const firstName = currentUser.name.trim().split(/\s+/)[0];

  // Rider mode searches/filters Available Rides; Driver mode keeps the plain
  // sort control.
  const visibleRides = isDriver ? sortedDrivers : filteredRiderRides;

  function handleChangeRideFilters(changes) {
    setRideFilters((current) => ({ ...current, ...changes }));
  }

  function handleClearRideFilters() {
    Keyboard.dismiss();
    setRideFilters(DEFAULT_RIDE_FILTERS);
  }

  function renderBoard() {
    return (
      <>
        {/* Greeting + avatar (tap → Profile tab) */}
        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.greetingName} numberOfLines={1}>
              {firstName}
            </Text>
          </View>
          <Pressable
            onPress={handleOpenProfile}
            accessibilityRole="button"
            accessibilityLabel="Open your profile"
            hitSlop={6}
          >
            <Avatar name={currentUser.name} role={activeMode} uri={currentUser.avatarUrl} size={44} />
          </Pressable>
        </View>

        {/* Which mode you're in, and the one-tap switch */}
        <ModeToggle activeMode={activeMode} onChange={handleSetMode} style={styles.modeToggle} />

        {/* What this mode is for, in one line */}
        <Text style={styles.heroText}>
          {isDriver
            ? 'Share your open seats with SMU students heading your way.'
            : 'Find a seat on an upcoming ride, or let drivers know you need one.'}
        </Text>

        {/* Main actions for this role */}
        <View style={styles.actionsRow}>
          {isDriver ? (
            <>
              <ActionTile
                icon="add-circle"
                title="Offer a Ride"
                subtitle="Share your open seats"
                filled
                onPress={handleAddDriver}
              />
              <ActionTile
                icon="people"
                title="Find Riders"
                subtitle={`${riders.length} looking now`}
                tint={colors.rider}
                onPress={() => scrollToSection(ridersSectionRef, ridersSectionY)}
              />
            </>
          ) : (
            <>
              <ActionTile
                icon="search"
                title="Find a Ride"
                subtitle={`${drivers.length} upcoming`}
                filled
                onPress={() => scrollToSection(ridesSectionRef, ridesSectionY)}
              />
              <ActionTile
                icon="hand-left"
                title="Need a Ride?"
                subtitle={isCurrentUserWaiting ? 'You’re on the list' : 'Tell drivers'}
                tint={colors.rider}
                onPress={handleNeedRide}
              />
            </>
          )}
        </View>

        {/* Available Rides: Driver offers */}
        <View ref={ridesSectionRef} onLayout={(event) => (ridesSectionY.current = event.nativeEvent.layout.y)}>
          <SectionHeader
            title="Upcoming Rides"
            subtitle="Rides that haven’t departed yet"
            right={<Badge label={String(drivers.length)} tone="primary" />}
          />

          {/* Always shown in Rider mode, even with zero upcoming rides, so
              Find a Ride lands on the search bar and Filters button. The
              empty states below explain when nothing is listed. */}
          {!isDriver && (
            <RideFilterPanel
              filters={rideFilters}
              onChange={handleChangeRideFilters}
              onClear={handleClearRideFilters}
              resultCount={visibleRides.length}
              totalCount={drivers.length}
              style={styles.filters}
            />
          )}

          {isDriver && drivers.length > 1 && (
            <SegmentedControl
              options={RIDE_SORT_OPTIONS}
              value={rideSortOrder}
              onChange={setRideSortOrder}
              style={styles.sort}
            />
          )}

          {/* A failed load keeps any rides already shown; this just explains
              why they may be out of date. */}
          {boardError !== '' && <Notice message={boardError} tone="danger" />}

          {drivers.length === 0 && isBoardLoading ? (
            <LoadingState label="Loading rides…" style={styles.sectionGap} />
          ) : drivers.length === 0 && boardError !== '' ? (
            <EmptyState
              icon="cloud-offline-outline"
              tone="danger"
              title="Rides couldn’t be loaded"
              message="Check your connection, then try again."
              actionLabel="Refresh"
              onAction={handleRefresh}
              style={styles.sectionGap}
            />
          ) : drivers.length === 0 ? (
            <EmptyState
              icon="car-outline"
              title="No upcoming rides yet"
              message={
                isDriver
                  ? 'Be the first to offer one, or pull down to refresh.'
                  : 'Pull down to refresh, or tap Need a Ride? so drivers know you’re looking.'
              }
              actionLabel="Refresh"
              onAction={handleRefresh}
              style={styles.sectionGap}
            />
          ) : visibleRides.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title="No rides match your search."
              message="Try another destination, date, or seat count."
              actionLabel="Clear Filters"
              onAction={handleClearRideFilters}
              style={styles.sectionGap}
            />
          ) : (
            <View style={styles.sectionGap}>
              {visibleRides.map((driver) => (
                <RideCard
                  key={driver.id}
                  ride={driver}
                  currentUser={currentUser}
                  activeMode={activeMode}
                  myRequestStatus={myRequestStatusByRideId[driver.id] || null}
                  nowMs={nowMs}
                  onView={() => handleViewRideDetails(driver.id)}
                  onRequest={() => handleQuickRequest(driver.id)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Riders Looking for a Ride: Rider requests */}
        <View ref={ridersSectionRef} onLayout={(event) => (ridersSectionY.current = event.nativeEvent.layout.y)}>
          <SectionHeader
            title="Riders Looking for a Ride"
            role="rider"
            right={<Badge label={String(riders.length)} tone="rider" />}
          />

          {riders.length === 0 ? (
            <EmptyState
              icon="walk-outline"
              title="No riders are looking right now"
              message={
                isDriver
                  ? 'When riders need transportation, they’ll show up here. Pull down to refresh.'
                  : 'Tap Need a Ride? to let drivers know you’re looking.'
              }
            />
          ) : (
            riders.map((rider) => (
              <RiderCard
                key={rider.id}
                rider={rider}
                // Your own waitlist entry stays yours in either mode, so you
                // can always take yourself off the list.
                isSelf={rider.id === currentUser.id}
                onRemove={() => handleLeaveWaitlist(rider.id)}
              />
            ))
          )}
        </View>

        {/* Your past rides: departed rides you drove or requested, kept for
            reference and reviews. Never bookable. */}
        {pastRides.length > 0 && (
          <View style={styles.pastSection}>
            <Pressable
              onPress={() => setShowPastRides((current) => !current)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showPastRides }}
              style={({ pressed }) => [styles.pastToggle, pressed && styles.pastTogglePressed]}
            >
              <View style={styles.pastToggleIcon}>
                <Ionicons name="time-outline" size={18} color={colors.textMuted} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.pastToggleTitle}>Your past rides</Text>
                <Text style={styles.pastToggleSubtitle}>
                  {pastRides.length} ride{pastRides.length === 1 ? '' : 's'} · departed rides can’t be booked
                </Text>
              </View>
              <Ionicons
                name={showPastRides ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
            {showPastRides &&
              pastRides.map((ride) => (
                <RideCard
                  key={ride.id}
                  ride={ride}
                  currentUser={currentUser}
                  activeMode={activeMode}
                  myRequestStatus={myRequestStatusByRideId[ride.id] || null}
                  nowMs={nowMs}
                  onView={() => handleViewRideDetails(ride.id)}
                  onRequest={() => {}}
                />
              ))}
          </View>
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            key={viewKey}
            ref={scrollViewRef}
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
                progressBackgroundColor={colors.surface}
              />
            }
          >
            {matchConfirmation ? (
              /* Match Confirmed screen: shown after a rider is matched to a driver */
              <Card style={styles.matchCard}>
                <View style={styles.matchIcon}>
                  <Ionicons name="checkmark" size={30} color={colors.textOnAccent} />
                </View>
                <Text style={styles.matchTitle}>Ride Matched!</Text>
                <Text style={styles.matchText}>
                  {matchConfirmation.riderName} has been matched with {matchConfirmation.driverName}
                  ’s ride to {matchConfirmation.destination}, departing {matchConfirmation.departureTime}.
                </Text>
                <AppButton title="Back to Rides" onPress={handleDismissMatchConfirmation} style={styles.matchButton} />
              </Card>
            ) : detailsView ? (
              detailsView
            ) : showRideForm ? (
              rideForm
            ) : showRiderForm ? (
              riderForm
            ) : (
              renderBoard()
            )}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Large tappable action on the Home screen. `filled` = the role's primary
// action (solid blue); otherwise a white bordered tile with a tinted icon.
function ActionTile({ icon, title, subtitle, tint = colors.primary, filled = false, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.tile,
        filled ? styles.tileFilled : styles.tileOutline,
        pressed && styles.tilePressed,
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: filled ? colors.onAccentSoft : `${tint}14` }]}>
        <Ionicons name={icon} size={20} color={filled ? colors.textOnAccent : tint} />
      </View>
      <Text style={[styles.tileTitle, filled && styles.tileTitleFilled]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[styles.tileSubtitle, filled && styles.tileSubtitleFilled]} numberOfLines={1}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

const styles = createThemedStyles(() => ({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },

  // Greeting
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  greetingText: {
    flex: 1,
    marginRight: spacing.md,
  },
  greeting: {
    ...typography.label,
    color: colors.textMuted,
  },
  greetingName: {
    ...typography.display,
    color: colors.text,
    marginTop: 2,
  },

  // Mode + intro
  modeToggle: {
    marginBottom: spacing.md,
  },
  heroText: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 21,
    marginBottom: spacing.xl,
  },

  // Action tiles
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xxl + spacing.xs,
  },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  tileFilled: {
    backgroundColor: colors.primary,
  },
  tileOutline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  tilePressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  tileTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  tileTitleFilled: {
    color: colors.textOnAccent,
  },
  tileSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  tileSubtitleFilled: {
    color: colors.textOnAccentMuted,
  },

  // Board sections
  sort: {
    marginBottom: spacing.md,
  },
  filters: {
    marginBottom: spacing.lg,
  },
  sectionGap: {
    marginBottom: spacing.xxl,
  },

  // Past rides
  pastSection: {
    marginTop: spacing.xxl,
  },
  pastToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pastTogglePressed: {
    backgroundColor: colors.surfaceSunken,
  },
  pastToggleIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  pastToggleTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  pastToggleSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Match confirmation
  matchCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  matchIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  matchTitle: {
    ...typography.heading,
    color: colors.text,
  },
  matchText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  matchButton: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
}));
