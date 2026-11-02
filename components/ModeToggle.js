import { Pressable, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, radius, roleColor, shadow, spacing, typography } from '../theme/theme';

const MODES = [
  { key: 'driver', label: 'Driver', icon: 'car-sport', hint: 'Offer rides and manage requests for them' },
  { key: 'rider', label: 'Rider', icon: 'walk', hint: 'Browse rides and request a seat' },
];

// Driver | Rider switch for the session's activeMode, shown on Home,
// Requests, and Profile. iOS-style segmented switch: a light gray track
// with the active side raised as a white pill, its icon and label in the
// role's color (blue Driver, teal Rider). Tapping the side that's already
// active does nothing. Screen readers hear it as a two-option radio group
// ("Driver mode, selected").
export default function ModeToggle({ activeMode, onChange, style }) {
  return (
    <View style={[styles.track, style]} accessibilityRole="radiogroup" accessibilityLabel="Mode">
      {MODES.map((mode) => {
        const isActive = mode.key === activeMode;
        const tint = roleColor(mode.key);
        return (
          <Pressable
            key={mode.key}
            onPress={() => {
              if (!isActive) onChange(mode.key);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: isActive, selected: isActive }}
            accessibilityLabel={`${mode.label} mode`}
            accessibilityHint={isActive ? undefined : mode.hint}
            hitSlop={4}
            style={({ pressed }) => [
              styles.segment,
              isActive && styles.segmentActive,
              pressed && !isActive && styles.pressed,
            ]}
          >
            <Ionicons
              name={isActive ? mode.icon : `${mode.icon}-outline`}
              size={18}
              color={isActive ? tint : colors.textMuted}
            />
            <Text style={[styles.label, isActive && { color: tint }]} numberOfLines={1}>
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    ...shadow.card,
    shadowOpacity: 0.08,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
}));
