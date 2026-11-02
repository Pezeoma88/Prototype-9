import { ActivityIndicator, Text, View } from 'react-native';
import AppButton from './AppButton';
import FormSection from './FormSection';
import { DemoNetworkWaitingNote } from './DemoNetworkPanel';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

// Shows where a Submit Ride Request stands, on the ride it was sent to.
// `submission` is App's requestSubmission state; its `phase` is one of:
//   submitting   waiting for the server's answer (can be abandoned)
//   checking     no answer came back, so the app is asking the server what
//                it holds (after abandoning, a timeout, or a network error)
//   success      the server confirmed a Pending request
//   arrived      the rider stopped waiting, but the request had already
//                been saved: they choose to keep or withdraw it
//   existing     the rider already had a request here that isn't Pending
//                (accepted, denied, or cancelled); nothing was changed
//   refused      the server answered "no" and saved nothing
//   not_found    several checks found no request on the server
//   unknown      the server couldn't be reached to check
//   withdrawing  cancelling a request that had arrived
//
// The wording only ever states what the server confirmed. In particular it
// never says a request was cancelled just because the rider stopped waiting.
export default function RequestSubmissionPanel({
  submission,
  driverName,
  onAbandon,
  onRetry,
  onCheckAgain,
  onDismiss,
  onWithdraw,
}) {
  const view = describe(submission, driverName);

  return (
    <FormSection title={view.title} icon={view.icon} tint={view.tint} style={styles.block}>
      {/* Development only: which simulation is acting on this request. */}
      {submission.phase === 'submitting' && <DemoNetworkWaitingNote />}
      {view.busy && (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color={view.tint} />
          <Text style={styles.busyText}>{view.busy}</Text>
        </View>
      )}
      <Text style={styles.text}>{view.text}</Text>
      {view.note ? <Text style={styles.note}>{view.note}</Text> : null}

      {view.actions.includes('abandon') && (
        <AppButton title="Stop Waiting" icon="close-circle-outline" variant="secondary" onPress={onAbandon} />
      )}
      {view.actions.includes('retry') && (
        <AppButton title="Try Again" icon="refresh" onPress={onRetry} style={styles.buttonGap} />
      )}
      {view.actions.includes('check') && (
        <AppButton
          title="Check Again"
          icon="cloud-download-outline"
          variant="secondary"
          onPress={onCheckAgain}
          style={styles.buttonGap}
        />
      )}
      {view.actions.includes('keep') && (
        <AppButton title="Keep My Request" icon="checkmark" onPress={onDismiss} style={styles.buttonGap} />
      )}
      {view.actions.includes('withdraw') && (
        <AppButton title="Withdraw Request" icon="trash-outline" variant="destructive" onPress={onWithdraw} />
      )}
      {view.actions.includes('close') && (
        <AppButton title={view.closeLabel || 'Close'} variant="secondary" onPress={onDismiss} />
      )}
    </FormSection>
  );
}

// Why the app had to go and check, as the opening of a sentence.
function causeText(cause) {
  if (cause === 'abandoned') return 'You stopped waiting.';
  if (cause === 'timeout') return "The server didn't answer in time.";
  return 'The connection failed before an answer came back.';
}

const TERMINAL_NOTE = "A denied or cancelled request can't be sent again for this ride.";

function describe(submission, driverName) {
  const { phase, cause, row, message } = submission;

  switch (phase) {
    case 'submitting':
      return {
        title: 'Sending your request',
        icon: 'paper-plane',
        tint: colors.primary,
        busy: 'Waiting for the server to confirm…',
        text: `Your request to ${driverName} is on its way. It only counts once the server confirms it.`,
        note: "Stopping here doesn't cancel a request that already reached the server. CarpoolBoard will check and tell you which happened.",
        actions: ['abandon'],
      };
    case 'checking':
      return {
        title: 'Checking with the server',
        icon: 'cloud-download-outline',
        tint: colors.pending,
        busy: `Check ${submission.checkNumber || 1} of ${submission.checkTotal || 1}…`,
        text: `${causeText(cause)} CarpoolBoard is asking the server whether your request was saved.`,
        note: 'A request that was already on its way can still arrive, so this takes a few seconds.',
        actions: [],
      };
    case 'success':
      return {
        title: 'Request sent',
        icon: 'checkmark-circle',
        tint: colors.success,
        text:
          cause === 'submitted'
            ? `The server confirmed your request. It's Pending until ${driverName} accepts or denies it.`
            : `${causeText(cause)} The server has your request anyway: it's Pending until ${driverName} accepts or denies it.`,
        actions: ['close'],
        closeLabel: 'Done',
      };
    case 'arrived':
      return {
        title: 'Your request had already arrived',
        icon: 'alert-circle',
        tint: colors.pending,
        text: `You stopped waiting, but the server had already saved your request. It's Pending with ${driverName} right now.`,
        note: message || "Withdrawing is permanent: you won't be able to request this ride again.",
        actions: ['keep', 'withdraw'],
      };
    case 'withdrawing':
      return {
        title: 'Withdrawing your request',
        icon: 'trash-outline',
        tint: colors.pending,
        busy: 'Waiting for the server to confirm…',
        text: 'Your request stays Pending until the server confirms it was withdrawn.',
        actions: [],
      };
    case 'existing':
      if (row?.status === 'accepted') {
        return {
          title: 'You already have a seat',
          icon: 'checkmark-circle',
          tint: colors.success,
          text: `${driverName} already accepted you on this ride. Nothing was changed.`,
          actions: ['close'],
        };
      }
      if (row?.status === 'denied') {
        return {
          title: 'This request was denied',
          icon: 'close-circle',
          tint: colors.danger,
          text: `${driverName} denied your request for this ride. Nothing was changed.`,
          note: TERMINAL_NOTE,
          actions: ['close'],
        };
      }
      return {
        title: submission.withdrawn ? 'Request withdrawn' : 'This request was cancelled',
        icon: 'close-circle',
        tint: colors.textMuted,
        text: submission.withdrawn
          ? 'The server confirmed your request was withdrawn.'
          : 'Your earlier request for this ride was cancelled. Nothing was changed.',
        note: TERMINAL_NOTE,
        actions: ['close'],
      };
    case 'refused':
      return {
        title: 'Request not sent',
        icon: 'close-circle',
        tint: colors.danger,
        text: message,
        note: 'The server answered and did not save a request.',
        actions: submission.retryable ? ['retry', 'close'] : ['close'],
      };
    case 'not_found':
      return {
        title: 'No request found on the server',
        icon: 'help-circle',
        tint: colors.pending,
        text: `${causeText(cause)} CarpoolBoard checked ${submission.checks} times and the server has no request from you for this ride.`,
        note: "If one still arrives late, it will show up here as Pending. Trying again is safe: it can't create a second request.",
        actions: ['retry', 'check', 'close'],
      };
    case 'unknown':
    default:
      return {
        title: "Couldn't confirm what happened",
        icon: 'help-circle',
        tint: colors.danger,
        text: `${causeText(cause)} CarpoolBoard couldn't reach the server to check, so your request may or may not have been sent.`,
        note: "Check your connection, then check again. Trying again is also safe: it can't create a second request.",
        actions: ['check', 'retry', 'close'],
      };
  }
}

const styles = createThemedStyles(() => ({
  block: {
    marginBottom: spacing.xl,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  busyText: {
    ...typography.label,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  text: {
    ...typography.label,
    color: colors.text,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.lg,
  },
  buttonGap: {
    marginBottom: spacing.sm,
  },
}));
