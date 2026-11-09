import { Pressable, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// One chat message in a private driver/rider conversation. My messages sit
// on the right in the primary color; the other person's sit on the left on
// a raised surface. Built per render so colors follow Light/Dark.
//
// status:
//   'sent'     saved by the server: shows its time (and a check on mine)
//   'sending'  on its way: "Sending…"
//   'failed'   not saved (as far as the phone knows): "Not sent" + Retry
//
// The bubble is one accessibility element read as "You, 3:05 PM: text"
// (or "<name>, …"), so a screen reader hears who, when, and what together.
// Retry is a separate button below it.
export default function MessageBubble({ body, mine, who, timeLabel, status, onRetry, canRetry }) {
  let label;
  if (status === 'sending') {
    label = `${who}, sending: ${body}`;
  } else if (status === 'failed') {
    label = `${who}, not sent: ${body}`;
  } else {
    label = `${who}, ${timeLabel}: ${body}`;
  }

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        accessible
        accessibilityLabel={label}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          status === 'sending' && styles.bubbleSending,
          status === 'failed' && styles.bubbleFailed,
        ]}
      >
        <Text style={[styles.body, mine && status !== 'failed' ? styles.bodyMine : styles.bodyTheirs]} selectable>
          {body}
        </Text>
      </View>

      <View style={[styles.meta, mine ? styles.metaMine : styles.metaTheirs]}>
        {status === 'sent' && (
          <>
            <Text style={styles.metaText}>{timeLabel}</Text>
            {mine && <Ionicons name="checkmark" size={13} color={colors.textMuted} style={styles.metaIcon} />}
          </>
        )}
        {status === 'sending' && <Text style={styles.metaText}>Sending…</Text>}
        {status === 'failed' && (
          <>
            <Ionicons name="alert-circle" size={14} color={colors.danger} />
            <Text style={[styles.metaText, styles.failedText]}>Not sent</Text>
            {canRetry && (
              <Pressable
                onPress={onRetry}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Retry sending message"
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              >
                <Ionicons name="refresh" size={13} color={colors.primary} />
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  row: {
    marginBottom: spacing.sm,
    maxWidth: '82%',
  },
  rowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: radius.lg,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
  },
  bubbleSending: {
    opacity: 0.7,
  },
  bubbleFailed: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  body: {
    ...typography.body,
    lineHeight: 21,
  },
  bodyMine: {
    color: colors.textOnAccent,
  },
  bodyTheirs: {
    color: colors.text,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    paddingHorizontal: spacing.xs,
  },
  metaMine: {
    justifyContent: 'flex-end',
  },
  metaTheirs: {
    justifyContent: 'flex-start',
  },
  metaText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  metaIcon: {
    marginLeft: 3,
  },
  failedText: {
    color: colors.danger,
    marginLeft: 4,
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  retryText: {
    ...typography.label,
    color: colors.primary,
    marginLeft: 3,
  },
  pressed: {
    opacity: 0.6,
  },
}));
