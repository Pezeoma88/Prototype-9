import { Pressable, Text, View } from 'react-native';
import { colors, createThemedStyles, radius, shadow, spacing } from '../theme/theme';

// Pill-style segmented control, e.g. the Available Rides sort options.
// options: [{ key, label }]. The selected segment is a raised white pill
// whose label is drawn in `tint`.
export default function SegmentedControl({ options, value, onChange, tint = colors.primary, style }) {
  return (
    <View style={[styles.track, style]}>
      {options.map((option) => {
        const isActive = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={({ pressed }) => [
              styles.segment,
              isActive && styles.segmentActive,
              pressed && !isActive && styles.pressed,
            ]}
          >
            <Text style={[styles.text, isActive && { color: tint }]} numberOfLines={1}>
              {option.label}
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
    padding: 3,
  },
  segment: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.surface,
    ...shadow.card,
    shadowOpacity: 0.08,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
}));
