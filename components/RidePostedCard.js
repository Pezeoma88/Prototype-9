import { Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import AppButton from './AppButton';
import Card from './Card';
import InfoRow from './InfoRow';
import { formatDeparture } from '../lib/format';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// "Ride posted" screen shown after Supabase confirms a ride was saved
// (styled like the Ride Matched card on Home). `ride` is
// { destination, departureAt, seats, wasEdit, canEdit }.
export default function RidePostedCard({ ride, onBackToHome, onEdit }) {
  return (
    <View>
      <Card style={styles.card}>
        <View style={styles.icon}>
          <Ionicons name="checkmark" size={30} color={colors.textOnAccent} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {ride.wasEdit ? 'Ride Updated' : 'Ride Posted'}
        </Text>
        <Text style={styles.text}>
          {ride.wasEdit
            ? 'Your changes are saved. Riders see the updated details.'
            : 'Riders can now see your ride and request a seat.'}
        </Text>

        <View style={styles.details}>
          <InfoRow icon="flag-outline" label="Destination" value={ride.destination} />
          <InfoRow
            icon="time-outline"
            label="Departure"
            value={formatDeparture(ride.departureAt)}
            divider
          />
          <InfoRow
            icon="people-outline"
            label="Available seats"
            value={String(ride.seats)}
            divider
          />
        </View>
      </Card>

      <AppButton title="Back to Home" icon="home-outline" onPress={onBackToHome} style={styles.primary} />
      {ride.canEdit && (
        <AppButton
          title="Edit ride details"
          icon="create-outline"
          variant="secondary"
          onPress={onEdit}
        />
      )}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  card: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    marginBottom: spacing.lg,
  },
  icon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  text: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  details: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
  },
  primary: {
    marginBottom: spacing.sm,
  },
}));
