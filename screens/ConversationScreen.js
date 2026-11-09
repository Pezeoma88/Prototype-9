import { useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import BackHeader from '../components/BackHeader';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import MessageBubble from '../components/MessageBubble';
import MessageComposer from '../components/MessageComposer';
import Notice from '../components/Notice';
import { formatDeparture } from '../lib/format';
import { checkMessageBody } from '../lib/messageText';
import { buildThreadItems } from '../lib/messageThread';
import { useNow } from '../lib/useNow';
import { useRideConversation } from '../lib/useRideConversation';
import { colors, createThemedStyles, gutter, spacing, typography } from '../theme/theme';

// A private conversation between a ride's driver and one accepted rider
// (Prototype 9 messaging). Opened full-screen by App.js, which hides the
// tab bar while it is showing, so this screen covers both safe areas.
//
// Props:
//   conversationId     the conversation to show (from the data layer)
//   currentUser        the signed-in account ({ id, name })
//   otherPersonName    the other participant's name, when App.js knows it
//   otherPersonAvatarUrl  their photo, optional
//   onBack             leave the conversation
//
// What the user can do comes only from the server: the composer is shown
// only while the conversation's can_send is true, and otherwise a notice
// explains why it is read-only (from its state). History always stays
// readable. Loading, polling and sending live in useRideConversation.

// Why a conversation is read-only, by the server's state. The wording
// matches the server's own refusals (send_my_ride_message).
const READ_ONLY_TEXT = {
  ride_cancelled: 'This ride was cancelled, so this conversation is read-only.',
  seat_cancelled: 'This seat is no longer confirmed, so this conversation is read-only.',
  completed: 'This ride has ended, so this conversation is read-only.',
};
const GENERIC_READ_ONLY_TEXT = 'This conversation is read-only.';

// How close to the bottom (in points) still counts as "at the bottom", so a
// new message scrolls into view only when the user wasn't reading history.
const NEAR_BOTTOM = 48;

// The clock only moves "Today"/"Yesterday" labels, so once a minute is enough.
const DAY_LABEL_CLOCK_MS = 60 * 1000;

export default function ConversationScreen({
  conversationId,
  currentUser,
  otherPersonName,
  otherPersonAvatarUrl,
  onBack,
}) {
  const {
    status,
    statusMessage,
    conversation,
    messages,
    outgoing,
    connectionNotice,
    sendNotice,
    send,
    retry,
    reload,
  } = useRideConversation({ conversationId, currentUserId: currentUser.id });
  const nowMs = useNow(DAY_LABEL_CLOCK_MS);

  // The draft is also kept in a ref so two very fast taps on Send read the
  // already-cleared text the second time and can't send it twice.
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const scrollRef = useRef(null);
  const isNearBottomRef = useRef(true);

  // The other person's role is the opposite of mine.
  const otherRole = conversation?.myRole === 'driver' ? 'rider' : 'driver';
  const otherName =
    otherPersonName || (conversation ? (otherRole === 'rider' ? 'Your rider' : 'Your driver') : 'Conversation');
  const canSend = conversation?.canSend === true;

  function handleChangeText(text) {
    draftRef.current = text;
    setDraft(text);
  }

  function handleSend() {
    const text = draftRef.current;
    if (!checkMessageBody(text).ok) return;
    draftRef.current = '';
    setDraft('');
    if (send(text)) {
      isNearBottomRef.current = true;
    } else {
      // Not accepted (e.g. the chat just became read-only): give it back.
      draftRef.current = text;
      setDraft(text);
    }
  }

  function handleScroll(event) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    isNearBottomRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM;
  }

  function handleContentSizeChange() {
    if (isNearBottomRef.current) {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    }
  }

  function renderHeader() {
    const departure = conversation?.rideDepartureAt;
    return (
      <View style={styles.header}>
        <BackHeader backLabel="Back" onBack={onBack} />
        <View style={styles.participantRow}>
          <Avatar name={otherName} role={otherRole} uri={otherPersonAvatarUrl} size={44} />
          <View style={styles.participantText}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
                {otherName}
              </Text>
              {conversation ? (
                <Badge
                  label={otherRole === 'rider' ? 'Rider' : 'Driver'}
                  tone={otherRole}
                  style={styles.roleBadge}
                />
              ) : null}
            </View>
            {conversation ? (
              <Text style={styles.rideLine} numberOfLines={2}>
                Ride to {conversation.rideDestination}
                {departure ? ` · ${formatDeparture(departure)}` : ''}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  function renderStatusBody() {
    if (status === 'loading') {
      return <LoadingState label="Loading conversation…" style={styles.stateBox} />;
    }
    if (status === 'unavailable') {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Messages are unavailable"
          message={statusMessage}
          style={styles.stateBox}
        />
      );
    }
    if (status === 'not_found') {
      return (
        <EmptyState
          icon="lock-closed-outline"
          title="Conversation not found"
          message="This conversation isn't available."
          style={styles.stateBox}
        />
      );
    }
    // status === 'error': the first load failed; polling keeps trying too.
    return (
      <EmptyState
        icon="cloud-offline-outline"
        tone="danger"
        title="Couldn’t load this conversation"
        message={statusMessage}
        actionLabel="Try Again"
        onAction={reload}
        style={styles.stateBox}
      />
    );
  }

  function renderThread() {
    const items = buildThreadItems({ messages, outgoing, currentUserId: currentUser.id, nowMs });
    return (
      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={[styles.threadContent, items.length === 0 && styles.threadEmpty]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={handleScroll}
        scrollEventThrottle={100}
        onContentSizeChange={handleContentSizeChange}
      >
        {items.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="No messages yet"
            message={
              canSend
                ? `Say hello to ${otherName} about the ride.`
                : 'No messages were sent in this conversation.'
            }
          />
        ) : (
          items.map((item) =>
            item.type === 'day' ? (
              <Text key={item.key} style={styles.dayLabel} accessibilityRole="header">
                {item.label}
              </Text>
            ) : (
              <MessageBubble
                key={item.key}
                body={item.message.body}
                mine={item.mine}
                who={item.mine ? 'You' : otherName}
                timeLabel={item.timeLabel}
                status={item.status}
                canRetry={canSend}
                onRetry={() => retry(item.message.clientMessageId)}
              />
            )
          )
        )}
      </ScrollView>
    );
  }

  function renderFooter() {
    const readOnlyText = READ_ONLY_TEXT[conversation?.state] || GENERIC_READ_ONLY_TEXT;
    return (
      <View style={styles.footer}>
        {connectionNotice !== '' && <Notice message={connectionNotice} tone="warning" style={styles.footerNotice} />}
        {canSend ? (
          <>
            {sendNotice !== '' && <Notice message={sendNotice} tone="danger" style={styles.footerNotice} />}
            <MessageComposer value={draft} onChangeText={handleChangeText} onSend={handleSend} />
          </>
        ) : (
          <Notice message={readOnlyText} tone="info" style={styles.footerNotice} />
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Expo apps are edge-to-edge on Android, so the window doesn't resize
          for the keyboard there either: 'padding' on both platforms. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {renderHeader()}
        {status === 'ready' ? (
          <>
            {renderThread()}
            {renderFooter()}
          </>
        ) : (
          <View style={styles.stateWrap}>{renderStatusBody()}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = createThemedStyles(() => ({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -spacing.sm,
  },
  participantText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    ...typography.title,
    color: colors.text,
    flexShrink: 1,
  },
  roleBadge: {
    marginLeft: spacing.sm,
    alignSelf: 'center',
  },
  rideLine: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  threadEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  dayLabel: {
    ...typography.caption,
    color: colors.textMuted,
    alignSelf: 'center',
    marginVertical: spacing.sm,
  },
  footer: {
    paddingHorizontal: gutter,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  footerNotice: {
    marginTop: spacing.sm,
    marginBottom: 0,
  },
  stateWrap: {
    flex: 1,
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
  },
  stateBox: {
    marginTop: spacing.sm,
  },
}));
