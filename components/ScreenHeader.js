import { Text, View } from 'react-native';
import { colors, createThemedStyles, gutter, spacing, typography } from '../theme/theme';

// Large title at the top of a tab screen, with optional subtitle and a right
// slot (e.g. an avatar or action).
export default function ScreenHeader({ title, subtitle, right }) {
  return (
    <View style={styles.row}>
      <View style={styles.textGroup}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
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
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  textGroup: {
    flex: 1,
  },
  title: {
    ...typography.display,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  right: {
    marginLeft: spacing.md,
  },
}));
