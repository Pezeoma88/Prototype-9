import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, radius, spacing } from '../theme/theme';

// The one button style system for CarpoolBoard:
//   primary     filled blue, for the main action on a screen
//   secondary   white with a gray border, for alternatives (Cancel, Details…)
//   destructive soft red, for cancelling a ride / leaving a seat
//   rider       filled teal, for Rider-specific primary actions
// Disabled buttons use a light gray fill regardless of variant.
// Built per render so the colors follow the Light/Dark setting.
function getVariants() {
  return {
    primary: { bg: colors.primary, pressedBg: colors.primaryPressed, text: colors.textOnAccent },
    secondary: { bg: colors.surface, pressedBg: colors.surfaceRaised, text: colors.text, border: colors.border },
    destructive: { bg: colors.dangerSoft, pressedBg: colors.dangerPressed, text: colors.danger },
    rider: { bg: colors.rider, pressedBg: colors.riderPressed, text: colors.textOnAccent },
  };
}

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  size = 'md',
  style,
}) {
  const variants = getVariants();
  const v = variants[variant] || variants.primary;
  const isDisabled = disabled || loading;
  const textColor = isDisabled ? colors.textFaint : v.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' && styles.small,
        { backgroundColor: isDisabled ? colors.surfaceSunken : pressed ? v.pressedBg : v.bg },
        v.border && !isDisabled && { borderWidth: 1, borderColor: v.border },
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} style={styles.icon} />
        ) : icon ? (
          <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={textColor} style={styles.icon} />
        ) : null}
        <Text style={[styles.text, size === 'sm' && styles.textSmall, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = createThemedStyles(() => ({
  base: {
    borderRadius: radius.md,
    minHeight: 50,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: {
    borderRadius: radius.pill,
    minHeight: 38,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: spacing.sm,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
  textSmall: {
    fontSize: 14,
  },
}));
