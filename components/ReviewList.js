import { Text, View } from 'react-native';
import Avatar from './Avatar';
import Card from './Card';
import StarRating from './StarRating';
import { formatReviewDate } from '../lib/reviews';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// A driver's reviews, newest first. `reviews` comes from toReviewDisplay
// in lib/reviews.js, or is null when reviews couldn't be loaded.
// `emptyText` is shown when the driver has none yet.
export default function ReviewList({ reviews, emptyText = 'No reviews yet.', currentUserId }) {
  if (reviews === null) {
    return (
      <Text style={styles.emptyText}>
        Reviews couldn&apos;t be loaded right now. Pull down on Home to refresh.
      </Text>
    );
  }
  if (reviews.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }
  return (
    <View>
      {reviews.map((review) => (
        <Card key={review.id} style={styles.card}>
          <View style={styles.headerRow}>
            <Avatar name={review.reviewerName} role="rider" uri={review.reviewerAvatarUrl} size={34} />
            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1}>
                {review.reviewerName}
                {review.reviewerId === currentUserId ? <Text style={styles.you}>  (You)</Text> : null}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                Ride to {review.rideDestination} · {formatReviewDate(review.createdAt)}
              </Text>
            </View>
          </View>
          <StarRating value={review.rating} size={15} style={styles.stars} />
          {review.comment !== '' ? <Text style={styles.comment}>{review.comment}</Text> : null}
        </Card>
      ))}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  card: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  you: {
    ...typography.caption,
    color: colors.textMuted,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  stars: {
    marginTop: spacing.md,
  },
  comment: {
    ...typography.label,
    color: colors.text,
    lineHeight: 19,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  emptyText: {
    ...typography.label,
    color: colors.textFaint,
    marginBottom: spacing.xl,
  },
}));
