import { Pressable, View } from 'react-native';
import { colors, createThemedStyles, radius, shadow, spacing } from '../theme/theme';

// White card with a thin gray border and a very soft shadow. Pass onPress to
// make the whole card tappable (it tints slightly while pressed).
export default function Card({ children, onPress, style }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = createThemedStyles(() => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  pressed: {
    backgroundColor: colors.surfaceRaised,
  },
}));
