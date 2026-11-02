import { useEffect, useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import AppButton from './AppButton';
import FormSection from './FormSection';
import Notice from './Notice';
import StarRating from './StarRating';
import TextField from './TextField';
import { formatDeparture } from '../lib/format';
import { REVIEW_MAX_LENGTH } from '../lib/reviews';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

// Ride Details: the signed-in rider's review of this ride's driver.
// `eligibility` comes from getReviewEligibility (lib/reviews.js):
//   eligible   the review form (stars + optional comment)
//   reviewed   their review, read-only (reviews are final)
//   too_early  when reviews open for this ride (its scheduled departure)
//   otherwise  nothing
// `onSubmit(rating, comment)` is App's handleSubmitReview and resolves with
// submitDriverReview's result. The board reloads before it resolves, so a
// saved review comes back as `eligibility.status === 'reviewed'`, and this
// component stays mounted (App keys it by ride) to keep its message.
export default function DriverReviewSection({ driverName, eligibility, onSubmit, style }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // { tone, text } shown above the form or the saved review, or null.
  const [message, setMessage] = useState(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function handleSubmit() {
    if (isSubmitting) return;
    Keyboard.dismiss();
    if (rating < 1) {
      setMessage({ tone: 'warning', text: 'Choose from 1 to 5 stars first.' });
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    const result = await onSubmit(rating, comment);
    if (!isMountedRef.current) return;
    setIsSubmitting(false);
    if (result.kind === 'saved') {
      setMessage({ tone: 'info', text: `Thanks! Your review of ${driverName} is posted.` });
    } else if (result.kind === 'already_reviewed') {
      setMessage({ tone: 'warning', text: result.message });
    } else if (result.kind === 'refused') {
      setMessage({ tone: 'danger', text: result.message });
    } else {
      setMessage({
        tone: 'warning',
        text:
          "We couldn't confirm your review was saved. Check your connection and tap Submit " +
          'Review again. Sending the same review twice never posts it twice.',
      });
    }
  }

  const notice = message ? <Notice message={message.text} tone={message.tone} /> : null;

  if (eligibility.status === 'reviewed') {
    const review = eligibility.review;
    return (
      <FormSection title="Your review" icon="star" tint={colors.pending} style={style}>
        {notice}
        <StarRating value={review.rating} size={22} />
        {review.comment ? (
          <Text style={styles.savedComment}>“{review.comment}”</Text>
        ) : (
          <Text style={styles.hint}>No written review.</Text>
        )}
        <Text style={styles.hint}>Reviews are final and can&apos;t be changed.</Text>
      </FormSection>
    );
  }

  if (eligibility.status === 'too_early') {
    return (
      <FormSection title={`Rate ${driverName}`} icon="star-outline" tint={colors.pending} style={style}>
        <Text style={styles.body}>
          You can rate this ride once its scheduled departure time arrives (
          {formatDeparture(eligibility.opensAt)}).
        </Text>
      </FormSection>
    );
  }

  if (eligibility.status !== 'eligible') {
    // The review may have stopped being possible while the form was open
    // (for example the seat was left); keep the server's answer visible.
    return message ? <View style={style}>{notice}</View> : null;
  }

  return (
    <FormSection title={`Rate ${driverName}`} icon="star-outline" tint={colors.pending} style={style}>
      <Text style={styles.body}>How was your ride? Your review is public and final.</Text>
      {notice}
      <View style={styles.starsRow}>
        <StarRating value={rating} onChange={setRating} size={34} disabled={isSubmitting} />
        <Text style={styles.ratingWord}>{RATING_WORDS[rating] || 'Tap a star'}</Text>
      </View>
      <TextField
        label="Written review (optional)"
        icon="chatbubble-ellipses-outline"
        placeholder="What should other riders know?"
        value={comment}
        onChangeText={setComment}
        editable={!isSubmitting}
        multiline
        numberOfLines={3}
        maxLength={REVIEW_MAX_LENGTH}
        hint={`${comment.length}/${REVIEW_MAX_LENGTH}`}
      />
      <AppButton
        title={isSubmitting ? 'Submitting…' : 'Submit Review'}
        icon="send"
        variant="rider"
        loading={isSubmitting}
        onPress={handleSubmit}
      />
    </FormSection>
  );
}

const styles = createThemedStyles(() => ({
  body: {
    ...typography.label,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  starsRow: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  ratingWord: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  savedComment: {
    ...typography.body,
    color: colors.text,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  hint: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing.sm,
  },
}));
