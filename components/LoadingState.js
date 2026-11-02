import { ActivityIndicator, Text, View } from 'react-native';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// The one loading placeholder used while a screen's first load is running
// (e.g. "Loading rides…"). Same footprint as EmptyState, so the layout
// doesn't jump when the content or the empty/error state replaces it.
export default function LoadingState({ label = 'Loading…', style }) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xxl + spacing.xs,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
}));
