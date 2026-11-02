import { Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import Card from './Card';
import Avatar from './Avatar';
import Badge from './Badge';
import AppButton from './AppButton';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

// Riders Looking for a Ride card (a Rider's REQUEST for transportation, not
// a Driver's offer). Teal accent stripe, teal avatar, and a "Needs a
// ride" badge keep it visually distinct from blue Available Ride cards.
//
// Riders can't post a destination/time yet (that's the ride-needs phase), so
// the card says so instead of inventing route details.
export default function RiderCard({ rider, isSelf, onRemove }) {
  return (
    <Card style={styles.card}>
      <View style={styles.stripe} />
      <View style={styles.topRow}>
        <Avatar name={rider.name} role="rider" uri={rider.avatarUrl} size={44} />
        <View style={styles.nameCol}>
          <Text style={styles.name} numberOfLines={1}>
            {rider.name}
            {isSelf ? <Text style={styles.you}>  (You)</Text> : null}
          </Text>
          <View style={styles.subRow}>
            <Ionicons name="walk" size={13} color={colors.rider} />
            <Text style={styles.subText} numberOfLines={1}>
              Rider · looking for transportation
            </Text>
          </View>
        </View>
        <Badge label="Needs a ride" tone="rider" />
      </View>

      <View style={styles.needRow}>
        <Ionicons name="navigate-circle-outline" size={18} color={colors.textFaint} />
        <Text style={styles.needText}>Destination and time not posted yet</Text>
      </View>

      {isSelf && (
        <AppButton
          title="Stop Looking"
          icon="close-circle-outline"
          variant="destructive"
          size="sm"
          onPress={onRemove}
          style={styles.removeButton}
        />
      )}
    </Card>
  );
}

const styles = createThemedStyles(() => ({
  card: {
    marginBottom: spacing.md,
    paddingLeft: spacing.lg + 4,
    overflow: 'hidden',
    borderColor: colors.riderBorder,
  },
  stripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.rider,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameCol: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  name: {
    ...typography.title,
    color: colors.text,
  },
  you: {
    ...typography.label,
    color: colors.textMuted,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  subText: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: 5,
    flexShrink: 1,
  },
  needRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  needText: {
    ...typography.label,
    color: colors.textFaint,
    marginLeft: spacing.sm,
    flex: 1,
  },
  removeButton: {
    marginTop: spacing.md,
  },
}));
