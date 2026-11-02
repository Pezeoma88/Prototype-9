import { Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// Inline message banner (e.g. "Your request is now Pending", or a load
// error). `tone` picks the accent: info (blue), warning (amber), danger (red).
// Built per render so the colors follow the Light/Dark setting.
function getTones() {
  return {
    info: { icon: 'information-circle', color: colors.primary, bg: colors.primarySoft },
    warning: { icon: 'alert-circle', color: colors.pending, bg: colors.pendingSoft },
    danger: { icon: 'close-circle', color: colors.danger, bg: colors.dangerSoft },
  };
}

export default function Notice({ message, tone = 'info', style }) {
  const tones = getTones();
  const t = tones[tone] || tones.info;
  return (
    <View style={[styles.box, { backgroundColor: t.bg, borderColor: `${t.color}40` }, style]}>
      <Ionicons name={t.icon} size={18} color={t.color} style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  icon: {
    marginRight: spacing.sm,
    marginTop: 1,
  },
  text: {
    ...typography.label,
    color: colors.text,
    flex: 1,
    lineHeight: 19,
  },
}));
