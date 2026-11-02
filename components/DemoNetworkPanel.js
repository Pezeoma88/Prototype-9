import { Pressable, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import Badge from './Badge';
import FormSection from './FormSection';
import {
  DEMO_NETWORK_AVAILABLE,
  DEMO_NETWORK_MODES,
  setDemoNetworkMode,
  useDemoNetworkMode,
} from '../lib/demoNetwork';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// DEVELOPMENT-ONLY controls for lib/demoNetwork.js. Both components render
// nothing outside development (`npx expo start`), so they never appear in a
// production build or published update.

// Mode picker, shown at the bottom of the Profile tab.
export default function DemoNetworkPanel() {
  const mode = useDemoNetworkMode();
  if (!DEMO_NETWORK_AVAILABLE) {
    return null;
  }

  return (
    <FormSection
      title="Developer demo tools"
      icon="construct-outline"
      tint={colors.danger}
      right={<Badge label="DEV ONLY" tone="danger" />}
    >
      <Text style={styles.intro}>
        Simulates network problems for Submit Ride Request only, to demonstrate waiting, success,
        failure, retry, and abandonment. Everything else uses the real network. Not included in
        production builds, and resets to Off when the app reloads.
      </Text>
      {DEMO_NETWORK_MODES.map((option) => {
        const selected = option.key === mode;
        return (
          <Pressable
            key={option.key}
            onPress={() => setDemoNetworkMode(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[styles.option, selected && styles.optionSelected]}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={selected ? colors.danger : colors.textMuted}
              style={styles.optionIcon}
            />
            <View style={styles.optionBody}>
              <Text style={styles.optionLabel}>{option.label}</Text>
              <Text style={styles.optionDetail}>{option.description}</Text>
            </View>
          </Pressable>
        );
      })}
    </FormSection>
  );
}

// One line for the "Sending your request" panel, naming the simulation that
// is acting on the request being waited on (nothing when it's Off).
export function DemoNetworkWaitingNote() {
  const mode = useDemoNetworkMode();
  if (!DEMO_NETWORK_AVAILABLE || mode === 'off') {
    return null;
  }
  const option = DEMO_NETWORK_MODES.find((m) => m.key === mode);

  return (
    <View style={styles.waitingNote}>
      <Ionicons name="construct" size={14} color={colors.danger} style={styles.optionIcon} />
      <Text style={styles.waitingNoteText}>
        <Text style={styles.waitingNoteLabel}>DEMO NETWORK · {option.label}. </Text>
        {option.description}
      </Text>
    </View>
  );
}

// Strip shown above the tab bar on every screen while a simulation is on,
// so it can't be left running by accident. Tapping it turns it off.
export function DemoNetworkBanner() {
  const mode = useDemoNetworkMode();
  if (!DEMO_NETWORK_AVAILABLE || mode === 'off') {
    return null;
  }
  const option = DEMO_NETWORK_MODES.find((m) => m.key === mode);

  return (
    <Pressable
      onPress={() => setDemoNetworkMode('off')}
      accessibilityRole="button"
      accessibilityLabel={`Demo network is on: ${option.label}. Tap to turn off.`}
      style={styles.banner}
    >
      <Ionicons name="construct" size={14} color={colors.textOnAccent} />
      <Text style={styles.bannerText} numberOfLines={1}>
        DEMO NETWORK · {option.label} · tap to turn off
      </Text>
    </Pressable>
  );
}

const styles = createThemedStyles(() => ({
  intro: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  optionIcon: {
    marginRight: spacing.sm,
    marginTop: 1,
  },
  optionBody: {
    flex: 1,
  },
  optionLabel: {
    ...typography.label,
    color: colors.text,
  },
  optionDetail: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: 2,
  },
  waitingNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  waitingNoteText: {
    ...typography.caption,
    color: colors.text,
    lineHeight: 17,
    flex: 1,
  },
  waitingNoteLabel: {
    fontWeight: '700',
    color: colors.danger,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  bannerText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textOnAccent,
    marginLeft: 6,
  },
}));
