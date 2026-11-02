import { Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles } from '../theme/theme';

// One to five stars.
//   Display:  <StarRating value={4.3} />  — rounded to the nearest half star.
//   Input:    <StarRating value={rating} onChange={setRating} size={34} />
//             — each star is a button; tapping the third sets 3.
// Stars use the theme's amber star color.
export default function StarRating({ value = 0, onChange, size = 16, disabled = false, style }) {
  const isInput = typeof onChange === 'function';
  const shown = Math.round(Math.max(0, Math.min(5, value)) * 2) / 2;

  if (!isInput) {
    return (
      <View
        style={[styles.row, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${shown} out of 5 stars`}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={shown >= star ? 'star' : shown >= star - 0.5 ? 'star-half' : 'star-outline'}
            size={size}
            color={colors.star}
            style={styles.gap}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.row, style]}>
      {[1, 2, 3, 4, 5].map((star) => {
        const isOn = value >= star;
        return (
          <Pressable
            key={star}
            onPress={() => onChange(star)}
            disabled={disabled}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
            accessibilityState={{ selected: value === star, disabled }}
            style={({ pressed }) => [styles.inputStar, pressed && styles.pressed]}
          >
            <Ionicons
              name={isOn ? 'star' : 'star-outline'}
              size={size}
              color={isOn ? colors.star : colors.borderStrong}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gap: {
    marginRight: 1,
  },
  inputStar: {
    paddingHorizontal: 4,
  },
  pressed: {
    opacity: 0.6,
  },
}));
