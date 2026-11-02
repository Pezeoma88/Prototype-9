import { Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import StarRating from './StarRating';
import { colors, createThemedStyles, typography } from '../theme/theme';

// A driver's average rating and review count, e.g. "★ 4.5 · 3 reviews".
// `rating` is { average, count }, null for a driver with no reviews yet
// ("No ratings yet"), or undefined when reviews couldn't be loaded, in
// which case nothing is shown rather than a wrong "No ratings yet".
// `stars` shows five stars instead of one, for larger spaces.
export default function RatingSummary({ rating, stars = false, style }) {
  if (rating === undefined) {
    return null;
  }
  if (rating === null) {
    return (
      <View style={[styles.row, style]}>
        <Ionicons name="star-outline" size={14} color={colors.textFaint} />
        <Text style={styles.empty}>No ratings yet</Text>
      </View>
    );
  }
  const reviewsLabel = `${rating.count} review${rating.count === 1 ? '' : 's'}`;
  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityLabel={`Rated ${rating.average.toFixed(1)} out of 5, ${reviewsLabel}`}
    >
      {stars ? (
        <StarRating value={rating.average} size={15} />
      ) : (
        <Ionicons name="star" size={14} color={colors.star} />
      )}
      <Text style={styles.average}>{rating.average.toFixed(1)}</Text>
      <Text style={styles.count}>· {reviewsLabel}</Text>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  average: {
    ...typography.label,
    color: colors.text,
    marginLeft: 5,
  },
  count: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: 4,
  },
  empty: {
    ...typography.caption,
    color: colors.textFaint,
    marginLeft: 5,
  },
}));
