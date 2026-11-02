import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import AppButton from '../components/AppButton';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import ModeToggle from '../components/ModeToggle';
import Notice from '../components/Notice';
import ScreenHeader from '../components/ScreenHeader';
import SectionHeader from '../components/SectionHeader';
import StarRating from '../components/StarRating';
import { formatDeparture } from '../lib/format';
import { getReviewEligibility } from '../lib/reviews';
import { getPastRideLabel, isRideUpcoming, sortPastRides } from '../lib/rideStatus';
import { colors, createThemedStyles, gutter, radius, spacing, typography } from '../theme/theme';

// Requests tab: every request in one place, following the current mode.
//   Rider mode   the requests I've sent, grouped by status, with View Ride,
//                Withdraw (pending) and Leave Seat (confirmed). A confirmed
//                ride whose scheduled departure has arrived gets Rate Driver,
//                which opens its Ride Details at the review form.
//   Driver mode  the requests waiting on my rides, with Accept / Deny, and
//                each ride's confirmed passengers.
// Everything shown comes from the same Supabase load as the Home board, and
// every action is one of App.js's existing handlers, which reload the board
// afterwards so the statuses here are always what the server holds.
//
// Expiration: both modes split into upcoming and past. Only rides that
// haven't departed (lib/rideStatus.js, judged at `nowMs`) offer actions.
// Departed rides move to a Past section as history: a pending request there
// has Expired, an accepted one is Completed, and Rate Driver stays available.
// Nothing is changed in Supabase; these labels come from the departure time.

// The rider's sections, in display order. Denied and cancelled requests are
// final: they can't be sent again for that ride.
const RIDER_SECTIONS = [
  { status: 'pending', title: 'Pending', tone: 'pending', badge: 'Pending' },
  { status: 'accepted', title: 'Confirmed', tone: 'success', badge: 'Confirmed' },
  { status: 'denied', title: 'Denied', tone: 'danger', badge: 'Denied' },
  { status: 'cancelled', title: 'Cancelled', tone: 'muted', badge: 'Cancelled' },
];

// How a request on a departed ride is labeled in Past.
const PAST_REQUEST_BADGES = {
  pending: { label: 'Expired', tone: 'muted' },
  accepted: { label: 'Completed', tone: 'success' },
  denied: { label: 'Denied', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export default function RequestsScreen({
  currentUser,
  activeMode,
  handleSetMode,
  drivers,
  nowMs,
  myRequestRows,
  isBoardLoading,
  isRefreshing,
  boardError,
  requestNotice,
  handleRefresh,
  handleAcceptRequest,
  handleDenyRequest,
  handleWithdrawRequest,
  handleCancelConfirmedSeat,
  myReviewByRideId,
  reviewsLoaded,
  onOpenRide,
  onGoHome,
}) {
  const isDriver = activeMode === 'driver';
  const isFirstLoad = isBoardLoading && drivers.length === 0;

  function renderRiderView() {
    // Each of my requests, joined to its ride. A request whose ride isn't
    // on the board is skipped (cancelling a ride deletes its requests).
    const requests = myRequestRows
      .map((row) => ({ row, ride: drivers.find((driver) => driver.id === row.ride_id) }))
      .filter((entry) => entry.ride);
    const upcomingRequests = requests.filter((entry) => isRideUpcoming(entry.ride, nowMs));
    const pastRides = sortPastRides(
      requests.filter((entry) => !isRideUpcoming(entry.ride, nowMs)).map((entry) => entry.ride)
    );
    const pastRequests = pastRides.map((ride) => requests.find((entry) => entry.ride === ride));

    if (requests.length === 0) {
      return (
        <EmptyState
          icon="file-tray-outline"
          title="No ride requests yet"
          message="When you request a seat on a ride, it shows up here with its status."
          actionLabel="Browse Rides"
          onAction={onGoHome}
        />
      );
    }

    const upcomingSections = RIDER_SECTIONS.map((section) => {
      const entries = upcomingRequests.filter((entry) => entry.row.status === section.status);
      if (entries.length === 0) {
        return null;
      }
      return (
        <View key={section.status} style={styles.section}>
          <SectionHeader
            title={section.title}
            role="rider"
            right={<Badge label={String(entries.length)} tone={section.tone} />}
          />
          {entries.map(({ row, ride }) => (
            <Card key={row.id} style={styles.card}>
              <View style={styles.personRow}>
                <Avatar name={ride.name} role="driver" uri={ride.avatarUrl} size={40} />
                <View style={styles.personText}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {ride.name}
                  </Text>
                  <Text style={styles.personSub} numberOfLines={1}>
                    Driver
                  </Text>
                </View>
                <Badge label={section.badge} tone={section.tone} />
              </View>

              <RideFacts ride={ride} />

              {row.reason ? (
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonText} numberOfLines={3}>
                    “{row.reason}”
                  </Text>
                </View>
              ) : null}

              {(row.status === 'denied' || row.status === 'cancelled') && (
                <Text style={styles.finalText}>
                  This request can&apos;t be sent again for this ride.
                </Text>
              )}

              {reviewsLoaded && (
                <ReviewPrompt
                  eligibility={getReviewEligibility({
                    ride,
                    requestRow: row,
                    myReview: myReviewByRideId[ride.id] || null,
                    currentUserId: currentUser.id,
                  })}
                  onRate={() => onOpenRide(ride.id)}
                />
              )}

              <View style={styles.actions}>
                <AppButton
                  title="View Ride"
                  variant="secondary"
                  size="sm"
                  onPress={() => onOpenRide(ride.id)}
                  style={styles.flex}
                />
                {row.status === 'pending' && (
                  <AppButton
                    title="Withdraw"
                    icon="close"
                    variant="destructive"
                    size="sm"
                    onPress={() => handleWithdrawRequest(row.id)}
                    style={styles.flex}
                  />
                )}
                {row.status === 'accepted' && (
                  <AppButton
                    title="Leave Seat"
                    icon="exit-outline"
                    variant="destructive"
                    size="sm"
                    onPress={() => handleCancelConfirmedSeat(ride.id, currentUser.id)}
                    style={styles.flex}
                  />
                )}
              </View>
            </Card>
          ))}
        </View>
      );
    });

    return (
      <>
        {upcomingRequests.length === 0 ? (
          <EmptyState
            icon="file-tray-outline"
            title="No upcoming requests"
            message="Requests for rides that haven’t left yet show up here."
            actionLabel="Browse Rides"
            onAction={onGoHome}
            style={styles.section}
          />
        ) : (
          upcomingSections
        )}

        {pastRequests.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Past rides"
              subtitle="Departed rides, kept for your history and reviews"
              right={<Badge label={String(pastRequests.length)} tone="muted" />}
            />
            {pastRequests.map(({ row, ride }) => {
              const badge = PAST_REQUEST_BADGES[row.status] || PAST_REQUEST_BADGES.cancelled;
              return (
                <Card key={row.id} style={[styles.card, styles.pastCard]}>
                  <View style={styles.personRow}>
                    <Avatar name={ride.name} role="driver" uri={ride.avatarUrl} size={40} />
                    <View style={styles.personText}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {ride.name}
                      </Text>
                      <Text style={styles.personSub} numberOfLines={1}>
                        Driver
                      </Text>
                    </View>
                    <Badge label={badge.label} tone={badge.tone} />
                  </View>

                  <RideFacts ride={ride} />

                  {reviewsLoaded && (
                    <ReviewPrompt
                      eligibility={getReviewEligibility({
                        ride,
                        requestRow: row,
                        myReview: myReviewByRideId[ride.id] || null,
                        currentUserId: currentUser.id,
                        nowMs,
                      })}
                      onRate={() => onOpenRide(ride.id)}
                    />
                  )}

                  <AppButton
                    title="View Ride"
                    variant="secondary"
                    size="sm"
                    onPress={() => onOpenRide(ride.id)}
                    style={styles.actionsSingle}
                  />
                </Card>
              );
            })}
          </View>
        )}
      </>
    );
  }

  function renderDriverView() {
    const allMyRides = drivers.filter((driver) => driver.driverAccountId === currentUser.id);
    // Only upcoming rides can still take requests or passengers.
    const myRides = allMyRides.filter((ride) => isRideUpcoming(ride, nowMs));
    const myPastRides = sortPastRides(allMyRides.filter((ride) => !isRideUpcoming(ride, nowMs)));

    if (allMyRides.length === 0) {
      return (
        <EmptyState
          icon="car-sport-outline"
          title="No rides posted yet"
          message="Offer a ride from the Home tab. Requests from riders will show up here."
          actionLabel="Go to Home"
          onAction={onGoHome}
        />
      );
    }

    const ridesWithPending = myRides.filter((ride) => ride.pendingRequests.length > 0);
    const ridesWithPassengers = myRides.filter((ride) => ride.matchedRiders.length > 0);
    const pendingCount = ridesWithPending.reduce(
      (total, ride) => total + ride.pendingRequests.length,
      0
    );
    const passengerCount = ridesWithPassengers.reduce(
      (total, ride) => total + ride.matchedRiders.length,
      0
    );

    return (
      <>
        <View style={styles.section}>
          <SectionHeader
            title="Incoming requests"
            role="rider"
            right={<Badge label={String(pendingCount)} tone="pending" />}
          />
          {ridesWithPending.length === 0 ? (
            <Text style={styles.emptyText}>No requests are waiting for your answer.</Text>
          ) : (
            ridesWithPending.map((ride) => {
              const isFull = ride.seats === 0;
              return (
                <Card key={ride.id} style={styles.card}>
                  <RideHeading ride={ride} onOpenRide={onOpenRide} />
                  {ride.pendingRequests.map((request) => (
                    <View key={request.id} style={styles.requestBlock}>
                      <View style={styles.personRow}>
                        <Avatar name={request.name} role="rider" uri={request.avatarUrl} size={38} />
                        <View style={styles.personText}>
                          <Text style={styles.personName} numberOfLines={1}>
                            {request.name}
                          </Text>
                          <Badge label="Pending" tone="pending" style={styles.inlineBadge} />
                        </View>
                      </View>
                      {request.reason ? (
                        <View style={styles.reasonBox}>
                          <Text style={styles.reasonText} numberOfLines={3}>
                            “{request.reason}”
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.actions}>
                        {/* Never offer "Accept" on a request from the ride's
                            own driver: they can't be their own passenger. */}
                        {request.riderId !== ride.driverAccountId && (
                          <AppButton
                            title={isFull ? 'Full' : 'Accept'}
                            icon={isFull ? undefined : 'checkmark'}
                            size="sm"
                            disabled={isFull}
                            onPress={() => handleAcceptRequest(ride.id, request.id)}
                            style={styles.flex}
                          />
                        )}
                        <AppButton
                          title="Deny"
                          icon="close"
                          variant="destructive"
                          size="sm"
                          onPress={() => handleDenyRequest(ride.id, request.id)}
                          style={styles.flex}
                        />
                      </View>
                    </View>
                  ))}
                </Card>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <SectionHeader
            title="Confirmed passengers"
            role="driver"
            right={<Badge label={String(passengerCount)} tone="success" />}
          />
          {ridesWithPassengers.length === 0 ? (
            <Text style={styles.emptyText}>No confirmed passengers yet.</Text>
          ) : (
            ridesWithPassengers.map((ride) => (
              <Card key={ride.id} style={styles.card}>
                <RideHeading ride={ride} onOpenRide={onOpenRide} />
                {ride.matchedRiders.map((rider) => (
                  <View key={rider.id} style={[styles.personRow, styles.requestBlock]}>
                    <Avatar name={rider.name} role="rider" uri={rider.avatarUrl} size={38} />
                    <View style={styles.personText}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {rider.name}
                      </Text>
                    </View>
                    <Badge label="Confirmed" tone="success" />
                  </View>
                ))}
              </Card>
            ))
          )}
        </View>

        {myPastRides.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Past rides"
              subtitle="Departed rides, kept for your history and reviews"
              right={<Badge label={String(myPastRides.length)} tone="muted" />}
            />
            {myPastRides.map((ride) => (
              <Card key={ride.id} style={[styles.card, styles.pastCard]}>
                <RideHeading ride={ride} onOpenRide={onOpenRide} isPast />
                <Text style={styles.pastSummary}>
                  {ride.matchedRiders.length === 0
                    ? 'No confirmed passengers'
                    : `${ride.matchedRiders.length} confirmed passenger${
                        ride.matchedRiders.length === 1 ? '' : 's'
                      }: ${ride.matchedRiders.map((rider) => rider.name).join(', ')}`}
                  {ride.pendingRequests.length > 0
                    ? ` · ${ride.pendingRequests.length} request${
                        ride.pendingRequests.length === 1 ? '' : 's'
                      } expired`
                    : ''}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
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
      <ScreenHeader
        title="Requests"
        subtitle={isDriver ? 'Requests for the rides you posted' : 'The ride requests you sent'}
      />

      <View style={styles.body}>
        {/* Which requests show here follows the mode, so switch right here */}
        <ModeToggle activeMode={activeMode} onChange={handleSetMode} style={styles.modeToggle} />

        {boardError !== '' && <Notice message={boardError} tone="danger" />}
        {requestNotice !== '' && <Notice message={requestNotice} />}

        {isFirstLoad ? (
          <LoadingState label="Loading requests…" />
        ) : drivers.length === 0 && boardError !== '' ? (
          <EmptyState
            icon="cloud-offline-outline"
            tone="danger"
            title="Requests couldn’t be loaded"
            message="Check your connection, then try again."
            actionLabel="Refresh"
            onAction={handleRefresh}
          />
        ) : isDriver ? (
          renderDriverView()
        ) : (
          renderRiderView()
        )}
      </View>
    </ScrollView>
  );
}

// Rate Driver for a ride the rider can review now, their rating once they
// have, or when reviews open. Nothing for any other request.
function ReviewPrompt({ eligibility, onRate }) {
  if (eligibility.status === 'eligible') {
    return (
      <AppButton
        title="Rate Driver"
        icon="star-outline"
        variant="rider"
        size="sm"
        onPress={onRate}
        style={styles.rateButton}
      />
    );
  }
  if (eligibility.status === 'reviewed') {
    return (
      <View style={styles.reviewedRow}>
        <StarRating value={eligibility.review.rating} size={14} />
        <Text style={styles.reviewedText}>You rated this driver</Text>
      </View>
    );
  }
  if (eligibility.status === 'too_early') {
    return (
      <Text style={styles.finalText}>
        You can rate this driver at departure time, {formatDeparture(eligibility.opensAt)}.
      </Text>
    );
  }
  return null;
}

// Destination, pickup spot (when the ride has one) and departure time.
function RideFacts({ ride }) {
  return (
    <View style={styles.facts}>
      <Fact icon="flag-outline" text={ride.destination} strong />
      {ride.pickup ? <Fact icon="location-outline" text={`Pickup: ${ride.pickup.label}`} /> : null}
      <Fact icon="time-outline" text={ride.departureTime} />
    </View>
  );
}

function Fact({ icon, text, strong = false }) {
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={15} color={colors.textMuted} style={styles.factIcon} />
      <Text style={strong ? styles.factStrong : styles.factText} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

// The ride a group of requests belongs to, in Driver mode. A past ride
// shows Completed/Departed instead of its seats.
function RideHeading({ ride, onOpenRide, isPast = false }) {
  let badge;
  if (isPast) {
    badge = <Badge label={getPastRideLabel(ride)} tone="muted" />;
  } else if (ride.seats === 0) {
    badge = <Badge label="Full" tone="danger" />;
  } else {
    badge = <Badge label={`${ride.seats} seat${ride.seats === 1 ? '' : 's'} left`} tone="success" />;
  }
  return (
    <View>
      <View style={styles.headingRow}>
        <View style={styles.flex}>
          <RideFacts ride={ride} />
        </View>
        {badge}
      </View>
      <AppButton
        title="View Ride"
        variant="secondary"
        size="sm"
        onPress={() => onOpenRide(ride.id)}
        style={styles.headingButton}
      />
    </View>
  );
}

const styles = createThemedStyles(() => ({
  content: {
    paddingBottom: spacing.xxxl,
  },
  body: {
    paddingHorizontal: gutter,
  },
  modeToggle: {
    marginBottom: spacing.lg,
  },
  flex: {
    flex: 1,
  },
  section: {
    marginBottom: spacing.lg,
  },
  card: {
    marginBottom: spacing.md,
  },
  pastCard: {
    backgroundColor: colors.surfaceRaised,
  },
  pastSummary: {
    ...typography.label,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: spacing.md,
  },
  actionsSingle: {
    marginTop: spacing.md,
  },
  emptyText: {
    ...typography.label,
    color: colors.textFaint,
    marginBottom: spacing.md,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  personText: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  personName: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  personSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  inlineBadge: {
    marginTop: 4,
  },
  facts: {
    marginTop: spacing.md,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  factIcon: {
    marginRight: spacing.sm,
    marginTop: 2,
  },
  factText: {
    ...typography.label,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 19,
  },
  factStrong: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: -spacing.md,
  },
  headingButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  requestBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  reasonBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  reasonText: {
    ...typography.label,
    fontStyle: 'italic',
    color: colors.textMuted,
    lineHeight: 19,
  },
  finalText: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rateButton: {
    marginTop: spacing.md,
  },
  reviewedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  reviewedText: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
}));
