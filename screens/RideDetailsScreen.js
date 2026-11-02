import { Keyboard, Text, View } from 'react-native';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Card from '../components/Card';
import AppButton from '../components/AppButton';
import BackHeader from '../components/BackHeader';
import DriverReviewSection from '../components/DriverReviewSection';
import FormSection from '../components/FormSection';
import InfoRow from '../components/InfoRow';
import Notice from '../components/Notice';
import PickupMapPreview from '../components/PickupMapPreview';
import RatingSummary from '../components/RatingSummary';
import RequestSubmissionPanel from '../components/RequestSubmissionPanel';
import ReviewList from '../components/ReviewList';
import RouteLine from '../components/RouteLine';
import SectionHeader from '../components/SectionHeader';
import TextField from '../components/TextField';
import { getPastRideLabel } from '../lib/rideStatus';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// Ride Details: shown after selecting a ride from Available Rides. Shows
// pending requests (with Accept/Deny for the ride's driver), confirmed
// passengers, and the rider's Request / Leave actions. All logic lives in
// App.js and arrives as props. Driver controls (Accept/Deny, Edit, Cancel)
// need the ride's own driver in Driver mode; Request needs Rider mode. Your
// own confirmed seat ("Leave") is yours in either mode.
//
// Reviews: the driver's average and reviews, and, for a rider with a
// confirmed seat once the ride's scheduled departure arrives, the review form
// (DriverReviewSection). Like your own seat, your review is yours in either
// mode. Who may review is decided by the database; `reviewEligibility` only
// picks what to show.
//
// Expiration: once the ride's departure time passes (`isDeparted`, from
// lib/rideStatus.js via App), the ride is history. It can't be requested,
// edited, cancelled or left, and its pending requests show as Expired. The
// details, passengers and reviews stay visible for reference, and the review
// form keeps working.
export default function RideDetailsScreen({
  detailsDriver,
  currentUser,
  activeMode,
  handleSwitchMode,
  requestNotice,
  requestSubmission,
  myRequestStatus,
  handleAbandonSubmission,
  handleRetrySubmission,
  handleCheckSubmissionAgain,
  handleDismissSubmission,
  handleWithdrawArrivedRequest,
  isOwnerDriver,
  isOwnDetailsRide,
  isDeparted,
  reservingDriverId,
  requestReasonInput,
  setRequestReasonInput,
  handleBackToAvailableRides,
  handleAcceptRequest,
  handleDenyRequest,
  handleCancelConfirmedSeat,
  handleBeginRequest,
  handleRequestRide,
  handleCancelReserve,
  handleStartEditRide,
  handleCancelRide,
  driverReviews,
  reviewEligibility,
  handleSubmitReview,
}) {
  const isFull = detailsDriver.seats === 0;
  // Driver controls only while the ride is still upcoming.
  const canManage = isOwnerDriver && !isDeparted;

  function renderRiderAction() {
    // Requesting is hidden entirely on your own ride, so nobody can request
    // a seat from themselves.
    if (activeMode !== 'rider' || isOwnDetailsRide) {
      return null;
    }

    // A departed ride can't be requested. An outcome panel that's already
    // showing (e.g. a request that just went through) is still shown so the
    // rider can read it; the departed banner explains the rest.
    if (isDeparted && !requestSubmission) {
      return null;
    }

    // A request for this ride is being sent, or its outcome is waiting to
    // be read. This replaces the form, so nothing can be edited or sent a
    // second time while the first is still in flight.
    if (requestSubmission) {
      return (
        <RequestSubmissionPanel
          submission={requestSubmission}
          driverName={detailsDriver.name}
          onAbandon={handleAbandonSubmission}
          onRetry={handleRetrySubmission}
          onCheckAgain={handleCheckSubmissionAgain}
          onDismiss={handleDismissSubmission}
          onWithdraw={handleWithdrawArrivedRequest}
        />
      );
    }

    if (reservingDriverId === detailsDriver.id) {
      // Rider Matching: the signed-in rider confirms their own request.
      return (
        <FormSection title={`Request ${detailsDriver.name}’s ride`} icon="hand-right" style={styles.block}>
          <Text style={styles.panelText}>
            Send this request as {currentUser.name}. The driver will accept or deny it.
          </Text>
          <TextField
            label="Message to the driver (optional)"
            icon="chatbubble-ellipses-outline"
            placeholder='e.g. "Going to campus"'
            value={requestReasonInput}
            onChangeText={setRequestReasonInput}
            multiline
            numberOfLines={2}
            maxLength={140}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
            hint={`${requestReasonInput.length}/140`}
          />
          <AppButton
            title="Confirm Request"
            icon="paper-plane"
            onPress={() => handleRequestRide(detailsDriver.id, currentUser.id, requestReasonInput)}
            style={styles.buttonGap}
          />
          <AppButton title="Cancel" variant="secondary" onPress={handleCancelReserve} />
        </FormSection>
      );
    }

    const alreadyConfirmed = detailsDriver.matchedRiders.some((r) => r.id === currentUser.id);
    const alreadyPending = detailsDriver.pendingRequests.some((req) => req.riderId === currentUser.id);

    // A denied or cancelled request is final: it can't be sent again.
    const isTerminal = myRequestStatus === 'denied' || myRequestStatus === 'cancelled';

    let reserveLabel = 'Request This Ride';
    if (isFull) {
      reserveLabel = 'Full';
    } else if (alreadyConfirmed) {
      reserveLabel = 'Already Confirmed';
    } else if (alreadyPending) {
      reserveLabel = 'Request Pending';
    } else if (myRequestStatus === 'denied') {
      reserveLabel = 'Request Denied';
    } else if (myRequestStatus === 'cancelled') {
      reserveLabel = 'Request Cancelled';
    }
    const reserveDisabled = isFull || alreadyConfirmed || alreadyPending || isTerminal;

    return (
      <View style={styles.block}>
        <AppButton
          title={reserveLabel}
          icon={reserveDisabled ? undefined : 'hand-right-outline'}
          onPress={() => handleBeginRequest(detailsDriver.id)}
          disabled={reserveDisabled}
        />
        {isTerminal && !alreadyConfirmed && !alreadyPending && (
          <Text style={styles.terminalText}>
            A denied or cancelled request can&apos;t be sent again for this ride.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View>
      <BackHeader backLabel="Available Rides" onBack={handleBackToAvailableRides} title="Ride Details" />

      {/* Driver + trip summary */}
      <Card style={styles.block}>
        <View style={styles.driverRow}>
          <Avatar name={detailsDriver.name} role="driver" uri={detailsDriver.avatarUrl} size={56} ring />
          <View style={styles.driverText}>
            <Text style={styles.driverName} numberOfLines={2}>
              {detailsDriver.name}
            </Text>
            <View style={styles.badgeRow}>
              <Badge label="Driver" tone="driver" />
              {isOwnDetailsRide && <Badge label="Your ride" tone="primary" />}
              {isDeparted && <Badge label={getPastRideLabel(detailsDriver)} tone="muted" />}
            </View>
            <RatingSummary rating={detailsDriver.driverRating} style={styles.ratingRow} />
          </View>
        </View>

        <View style={styles.route}>
          <RouteLine
            pickup={detailsDriver.pickup?.label}
            destination={detailsDriver.destination}
            tint={colors.driver}
          />
          <PickupMapPreview pickup={detailsDriver.pickup} />
        </View>

        <InfoRow
          icon="time-outline"
          label={isDeparted ? 'Departed' : 'Departs'}
          value={detailsDriver.departureTime}
          divider
        />
        <InfoRow
          icon="people-outline"
          label="Available seats"
          divider
          right={
            isFull && !isDeparted ? (
              <View style={styles.rightAlign}>
                <Badge label="Full" tone="danger" />
              </View>
            ) : (
              <Text style={styles.seatValue}>
                {detailsDriver.seats} <Text style={styles.seatTotal}>of {detailsDriver.totalSeats}</Text>
              </Text>
            )
          }
        />
      </Card>

      {isDeparted && (
        <Notice
          tone="warning"
          message={`This ride departed ${detailsDriver.departureTime}. It's no longer available to book and is kept here for history and reviews.`}
        />
      )}

      {requestNotice !== '' && <Notice message={requestNotice} />}

      {/* Rate the driver. Placed first so "Rate Driver" on the Requests tab
          lands right on the form. Keyed by ride so a message from one ride
          never shows on another. */}
      <DriverReviewSection
        key={detailsDriver.id}
        driverName={detailsDriver.name}
        eligibility={reviewEligibility}
        onSubmit={(rating, comment) => handleSubmitReview(detailsDriver.id, rating, comment)}
        style={styles.block}
      />

      {/* The rider's own action comes first so Request is visible right away. */}
      {renderRiderAction()}

      {/* Your own ride while in Rider mode: driver controls stay in Driver
          mode, so offer a one-tap switch instead of showing them here. */}
      {isOwnDetailsRide && activeMode === 'rider' && !isDeparted && (
        <FormSection title="This is your ride" icon="car-sport" tint={colors.driver} style={styles.block}>
          <Text style={styles.panelText}>
            You&apos;re in Rider mode. Switch to Driver to accept or deny requests, edit this ride,
            or cancel it.
          </Text>
          <AppButton
            title="Switch to Driver to Manage"
            icon="swap-horizontal"
            onPress={handleSwitchMode}
          />
        </FormSection>
      )}

      {/* Pending requests */}
      <SectionHeader
        title={isDeparted ? 'Expired requests' : 'Pending requests'}
        role="rider"
        right={
          <Badge
            label={String(detailsDriver.pendingRequests.length)}
            tone={isDeparted ? 'muted' : 'pending'}
          />
        }
      />
      {detailsDriver.pendingRequests.length === 0 ? (
        <Text style={styles.emptyText}>
          {isDeparted ? 'No requests were left unanswered.' : 'No pending requests.'}
        </Text>
      ) : (
        <View style={styles.block}>
          {detailsDriver.pendingRequests.map((request) => (
            <Card key={request.id} style={styles.personCard}>
              <View style={styles.personRow}>
                <Avatar name={request.name} role="rider" uri={request.avatarUrl} size={38} />
                <View style={styles.personText}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {request.name}
                  </Text>
                  <Badge
                    label={isDeparted ? 'Expired' : 'Pending'}
                    tone={isDeparted ? 'muted' : 'pending'}
                    style={styles.personBadge}
                  />
                </View>
              </View>
              {request.reason ? (
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonText} numberOfLines={3}>
                    “{request.reason}”
                  </Text>
                </View>
              ) : null}
              {canManage && (
                <View style={styles.personActions}>
                  {/* Never offer "Accept" on a request from the ride's own
                      driver: they can't be their own passenger. */}
                  {request.riderId !== detailsDriver.driverAccountId && (
                    <AppButton
                      title={isFull ? 'Full' : 'Accept'}
                      icon={isFull ? undefined : 'checkmark'}
                      size="sm"
                      disabled={isFull}
                      onPress={() => handleAcceptRequest(detailsDriver.id, request.id)}
                      style={styles.flex}
                    />
                  )}
                  <AppButton
                    title="Deny"
                    icon="close"
                    variant="destructive"
                    size="sm"
                    onPress={() => handleDenyRequest(detailsDriver.id, request.id)}
                    style={styles.flex}
                  />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}

      {/* Confirmed passengers */}
      <SectionHeader
        title="Confirmed passengers"
        role="driver"
        right={<Badge label={String(detailsDriver.matchedRiders.length)} tone="success" />}
      />
      {detailsDriver.matchedRiders.length === 0 ? (
        <Text style={styles.emptyText}>No confirmed passengers yet.</Text>
      ) : (
        <View style={styles.block}>
          {detailsDriver.matchedRiders.map((rider) => {
            // Your confirmed seat stays yours in either mode, so you can
            // always Leave it.
            const isSelf = rider.id === currentUser.id;
            return (
              <Card key={rider.id} style={styles.personCard}>
                <View style={styles.personRow}>
                  <Avatar name={rider.name} role="rider" uri={rider.avatarUrl} size={38} />
                  <View style={styles.personText}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {rider.name}
                      {isSelf ? <Text style={styles.you}>  (You)</Text> : null}
                    </Text>
                    <Badge label="Confirmed" tone="success" style={styles.personBadge} />
                  </View>
                  {isSelf && !isDeparted && (
                    <AppButton
                      title="Leave"
                      variant="destructive"
                      size="sm"
                      onPress={() => handleCancelConfirmedSeat(detailsDriver.id, rider.id)}
                    />
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* The driver's reviews from every ride, newest first */}
      <SectionHeader
        title={`Reviews of ${detailsDriver.name}`}
        role="driver"
        right={<RatingSummary rating={detailsDriver.driverRating} />}
      />
      <View style={styles.block}>
        <ReviewList
          reviews={driverReviews}
          currentUserId={currentUser.id}
          emptyText={`${detailsDriver.name} has no reviews yet.`}
        />
      </View>

      {canManage && (
        <View style={styles.ownerActions}>
          <AppButton
            title="Edit Ride"
            icon="create-outline"
            variant="secondary"
            onPress={() => handleStartEditRide(detailsDriver.id)}
            style={styles.buttonGap}
          />
          <AppButton
            title="Cancel Ride"
            icon="trash-outline"
            variant="destructive"
            onPress={() => handleCancelRide(detailsDriver.id)}
          />
        </View>
      )}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  block: {
    marginBottom: spacing.xl,
  },
  flex: {
    flex: 1,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  driverName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.text,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 6,
  },
  ratingRow: {
    marginTop: spacing.sm,
  },
  route: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  rightAlign: {
    flex: 1,
    alignItems: 'flex-end',
  },
  seatValue: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
  seatTotal: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  emptyText: {
    ...typography.label,
    color: colors.textFaint,
    marginBottom: spacing.xl,
  },
  personCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
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
  you: {
    ...typography.caption,
    color: colors.textMuted,
  },
  personBadge: {
    marginTop: 4,
  },
  reasonBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  reasonText: {
    ...typography.label,
    fontStyle: 'italic',
    color: colors.textMuted,
    lineHeight: 19,
  },
  personActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  panelText: {
    ...typography.label,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.lg,
  },
  buttonGap: {
    marginBottom: spacing.sm,
  },
  terminalText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  ownerActions: {
    marginTop: spacing.xs,
  },
}));
