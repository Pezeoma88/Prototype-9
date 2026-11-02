import { Pressable, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

// Header for screens opened on top of a tab (Ride Details, Offer a Ride…):
// a back link, then the screen title and an optional subtitle.
export default function BackHeader({ backLabel = 'Back', onBack, title, subtitle }) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>{backLabel}</Text>
      </Pressable>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  wrap: {
    marginBottom: spacing.lg,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginLeft: -4,
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  backText: {
    ...typography.bodyStrong,
    color: colors.primary,
    marginLeft: 2,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
}));
