import { Text, View } from 'react-native';
import { colors, createThemedStyles, roleColor, spacing, typography } from '../theme/theme';

// Section title with an optional subtitle and an optional element on the
// right (usually a count Badge). `role` adds a small dot in the role's
// color (blue = Driver offers, teal = Rider needs).
export default function SectionHeader({ title, subtitle, role, right, style }) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.textGroup}>
        <View style={styles.titleRow}>
          {role ? <View style={[styles.dot, { backgroundColor: roleColor(role) }]} /> : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  textGroup: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  title: {
    ...typography.title,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  right: {
    marginLeft: spacing.sm,
  },
}));
