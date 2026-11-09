import { Pressable, Text, TextInput, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { MESSAGE_MAX_LENGTH, checkMessageBody, messageLength } from '../lib/messageText';
import { colors, createThemedStyles, getColorScheme, radius, spacing, typography } from '../theme/theme';

// The text box and Send button at the bottom of a conversation.
//
// Send is enabled only when the text passes checkMessageBody: 1 to 1,000
// characters after trimming, counted the way the server counts them (an
// emoji counts once). There is deliberately no maxLength on the input:
// React Native's maxLength counts UTF-16 units, so it would cut off emoji
// messages that the server accepts. Instead, a counter appears near the
// limit and the server's limit message shows when it is passed.
const COUNTER_FROM = MESSAGE_MAX_LENGTH - 100;

export default function MessageComposer({ value, onChangeText, onSend }) {
  const checked = checkMessageBody(value);
  const length = messageLength(value);
  const isTooLong = length > MESSAGE_MAX_LENGTH;

  return (
    <View style={styles.wrap}>
      {isTooLong ? (
        <Text style={styles.limitText} accessibilityLiveRegion="polite">
          {checked.message}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Message"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          keyboardAppearance={getColorScheme()}
          multiline
          accessibilityLabel="Type a message"
          style={styles.input}
        />
        <Pressable
          onPress={onSend}
          disabled={!checked.ok}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={({ pressed }) => [
            styles.send,
            !checked.ok && styles.sendDisabled,
            pressed && checked.ok && styles.sendPressed,
          ]}
        >
          <Ionicons
            name="send"
            size={18}
            color={checked.ok ? colors.textOnAccent : colors.textFaint}
          />
        </Pressable>
      </View>
      {length >= COUNTER_FROM ? (
        <Text style={[styles.counter, isTooLong && styles.counterOver]}>
          {length}/{MESSAGE_MAX_LENGTH}
        </Text>
      ) : null}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  wrap: {
    paddingTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  input: {
    ...typography.body,
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingTop: 11,
    paddingBottom: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDisabled: {
    backgroundColor: colors.surfaceSunken,
  },
  sendPressed: {
    backgroundColor: colors.primaryPressed,
  },
  limitText: {
    ...typography.label,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
    marginRight: 52,
  },
  counterOver: {
    color: colors.danger,
  },
}));
