import { Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

// One label/value line inside a details card, with an optional icon. Pass
// `right` instead of `value` to show a badge or button on the right side.
export default function InfoRow({ icon, label, value, right, muted = false, divider = false }) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      {icon ? <Ionicons name={icon} size={17} color={colors.textMuted} style={styles.icon} /> : null}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {right ? (
        right
      ) : (
        <Text style={[styles.value, muted && styles.valueMuted]} numberOfLines={2}>
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  icon: {
    marginRight: 10,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginRight: spacing.md,
  },
  value: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
  valueMuted: {
    color: colors.textFaint,
    fontWeight: '500',
  },
}));
