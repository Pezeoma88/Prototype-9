import { Text, View } from 'react-native';
import AppButton from '../components/AppButton';
import BackHeader from '../components/BackHeader';
import FormSection from '../components/FormSection';
import Notice from '../components/Notice';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

const STEPS = [
  'Join Riders Looking for a Ride so drivers can see you need transportation.',
  'Browse Available Rides and tap Request Ride on one that fits.',
  'The driver accepts or denies. Accepted riders get a confirmed seat.',
];

// Rider "Need a Ride?" panel: joins the (session-only) Looking for a Ride
// list. Replaced by posted ride needs with a destination and time in a
// later phase.
export default function RiderWaitlistForm({
  currentUser,
  isCurrentUserWaiting,
  handleSaveRider,
  resetRiderForm,
}) {
  return (
    <View>
      <BackHeader
        backLabel="Home"
        onBack={resetRiderForm}
        title="Need a Ride?"
        subtitle="Let drivers know you’re looking for transportation."
      />

      {isCurrentUserWaiting ? (
        <Notice
          message={`You’re already listed in Riders Looking for a Ride as ${currentUser.name}. To ask for a seat, open a ride in Available Rides and tap Request Ride.`}
        />
      ) : null}

      <FormSection title="How it works" icon="walk" tint={colors.rider}>
        {STEPS.map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{index + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
        <Text style={styles.note}>
          Coming soon: post your destination, pickup area, and time so drivers can offer you a ride.
        </Text>
      </FormSection>

      {!isCurrentUserWaiting && (
        <AppButton
          title="Add Me to Looking for a Ride"
          icon="hand-left"
          variant="rider"
          onPress={handleSaveRider}
          style={styles.submit}
        />
      )}
      <AppButton
        title={isCurrentUserWaiting ? 'Back to Home' : 'Cancel'}
        variant="secondary"
        onPress={resetRiderForm}
      />
    </View>
  );
}

const styles = createThemedStyles(() => ({
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.riderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.rider,
  },
  stepText: {
    ...typography.label,
    color: colors.text,
    flex: 1,
    lineHeight: 19,
    marginTop: 2,
  },
  note: {
    ...typography.caption,
    color: colors.textFaint,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  submit: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
}));
