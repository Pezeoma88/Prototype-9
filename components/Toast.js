import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, radius, shadow, spacing, typography } from '../theme/theme';

// How long a toast stays on screen before fading out.
const VISIBLE_MS = 3000;
const FADE_MS = 200;

// Built per render so the colors follow the Light/Dark setting.
function getTones() {
  return {
    success: { icon: 'checkmark-circle', color: colors.success, bg: colors.successSoft },
    info: { icon: 'information-circle', color: colors.primary, bg: colors.primarySoft },
    // Mode switches, in the role's own color.
    driver: { icon: 'car-sport', color: colors.driver, bg: colors.driverSoft },
    rider: { icon: 'walk', color: colors.rider, bg: colors.riderSoft },
  };
}

// Short floating confirmation (e.g. "Profile saved") that fades in near the
// bottom of the screen and hides itself after a few seconds, or when tapped.
// `toast` is { id, title, message, tone } or null; a new id restarts it, so
// the same message shown twice in a row still appears again. Screen readers
// announce it, since it may show up away from where focus is.
export default function Toast({ toast, onHide }) {
  const progress = useRef(new Animated.Value(0)).current;
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  const toastId = toast ? toast.id : null;
  useEffect(() => {
    if (toastId === null) {
      return undefined;
    }
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) onHideRef.current();
        }
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toastId, progress]);

  const announcement = toast ? [toast.title, toast.message].filter(Boolean).join('. ') : '';
  useEffect(() => {
    if (announcement !== '') {
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [toastId, announcement]);

  if (!toast) {
    return null;
  }

  const tones = getTones();
  const t = tones[toast.tone] || tones.success;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { opacity: progress, transform: [{ translateY }] }]}
    >
      <Pressable
        onPress={() => onHideRef.current()}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={announcement}
        accessibilityHint="Tap to dismiss"
        style={[styles.box, { borderColor: `${t.color}55` }]}
      >
        <View style={[styles.iconChip, { backgroundColor: t.bg }]}>
          <Ionicons name={t.icon} size={20} color={t.color} />
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.title}>{toast.title}</Text>
          {toast.message ? <Text style={styles.message}>{toast.message}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = createThemedStyles(() => ({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadow.raised,
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  textGroup: {
    flex: 1,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  message: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 17,
  },
}));
