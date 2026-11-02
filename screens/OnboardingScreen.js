import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import AppButton from '../components/AppButton';
import FormSection from '../components/FormSection';
import Notice from '../components/Notice';
import ProfilePhotoField from '../components/ProfilePhotoField';
import TextField from '../components/TextField';
import { BIO_MAX_LENGTH, NAME_MAX_LENGTH, VEHICLE_MAX_LENGTH } from '../lib/format';
import { colors, createThemedStyles, gutter, radius, roleColor, roleSoftColor, spacing, statusBarStyle, typography } from '../theme/theme';

const STEP_COUNT = 3;

// The welcome step's feature list: the three main actions, then two notes.
// `role` tints the icon (driver blue / rider teal); notes stay neutral.
const HIGHLIGHTS = [
  {
    icon: 'search',
    role: 'driver',
    title: 'Find a Ride',
    text: 'Search upcoming rides by destination, date, and seats, then request a seat.',
  },
  {
    icon: 'add-circle-outline',
    role: 'driver',
    title: 'Offer a Ride',
    text: 'Driving somewhere? Post your open seats and accept or decline requests.',
  },
  {
    icon: 'hand-left-outline',
    role: 'rider',
    title: 'Need a Ride?',
    text: 'No ride that fits? Join the list so drivers know you’re looking.',
  },
  { icon: 'location-outline', text: 'Pickups are at public SMU landmarks, never home addresses.' },
  { icon: 'star-outline', text: 'Rate your driver once a ride has left.' },
];

const MODE_OPTIONS = [
  {
    key: 'driver',
    title: 'Driver',
    summary: 'Offer rides and manage passenger requests.',
    icon: 'car-sport',
    points: ['Post a ride with a destination, time, and seats', 'Accept or decline seat requests'],
  },
  {
    key: 'rider',
    title: 'Rider',
    summary: 'Find rides and request seats.',
    icon: 'walk',
    points: ['Browse rides on the board and the map', 'Request a seat and follow it under Requests'],
  },
];

// First-time onboarding, shown after a new account's first sign-in (until
// it's finished or skipped), and again whenever someone opens "App intro"
// from Profile.
// Three steps: welcome, choose a starting mode, and an optional profile
// setup that reuses Edit Profile's form state and App's handleSaveProfile
// (so the same validation, photo upload, and update-by-id apply, and the
// fields start from the saved profile, never blank). onFinish(mode, save)
// is App's: it saves when `save` is true, then applies the mode and opens
// Home.
export default function OnboardingScreen({
  currentUser,
  initialMode,
  profileNameInput,
  setProfileNameInput,
  profileBioInput,
  setProfileBioInput,
  profileVehicleInput,
  setProfileVehicleInput,
  profilePhotoDraft,
  profilePhotoError,
  isPickingPhoto,
  handlePickProfilePhoto,
  handleDiscardProfilePhoto,
  profileFormError,
  isSavingProfile,
  onFinish,
}) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState(initialMode === 'rider' ? 'rider' : 'driver');

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Step ${step + 1} of ${STEP_COUNT}`);
  }, [step]);

  // Only save when something actually changed, so tapping Finish on an
  // untouched form doesn't rewrite the profile or show "Profile saved".
  const hasProfileChanges =
    profilePhotoDraft !== null ||
    profileNameInput.trim() !== currentUser.name ||
    profileBioInput.trim() !== currentUser.bio ||
    profileVehicleInput.trim() !== currentUser.vehicleMakeModel;

  function goTo(nextStep) {
    Keyboard.dismiss();
    setStep(nextStep);
  }

  function handleSkip() {
    Keyboard.dismiss();
    onFinish(mode, false);
  }

  function handleGetStarted() {
    Keyboard.dismiss();
    onFinish(mode, hasProfileChanges);
  }

  const firstName = currentUser.name.trim().split(/\s+/)[0];
  const tint = roleColor(mode);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={statusBarStyle()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Top bar: Back (after step 1), progress dots, and Skip. */}
        <View style={styles.topBar}>
          <View style={styles.topSide}>
            {step > 0 && (
              <Pressable
                onPress={() => goTo(step - 1)}
                disabled={isSavingProfile}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={({ pressed }) => [styles.topButton, pressed && styles.pressed]}
              >
                <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
                <Text style={styles.topButtonText}>Back</Text>
              </Pressable>
            )}
          </View>
          <View
            style={styles.dots}
            accessible
            accessibilityLabel={`Step ${step + 1} of ${STEP_COUNT}`}
          >
            {Array.from({ length: STEP_COUNT }, (_, index) => (
              <View
                key={index}
                style={[styles.dot, index === step && [styles.dotActive, { backgroundColor: tint }]]}
              />
            ))}
          </View>
          <View style={[styles.topSide, styles.topSideRight]}>
            {step < STEP_COUNT - 1 && (
              <Pressable
                onPress={handleSkip}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Skip intro"
                style={({ pressed }) => [styles.topButton, pressed && styles.pressed]}
              >
                <Text style={styles.topButtonText}>Skip</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Keyed by step so each step opens scrolled to the top. */}
        <ScrollView
          key={step}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {step === 0 && (
            <View>
              <View style={styles.logo}>
                <Ionicons name="car-sport" size={30} color={colors.textOnAccent} />
              </View>
              <Text style={styles.title} accessibilityRole="header">
                Welcome to CarpoolBoard{firstName ? `, ${firstName}` : ''}
              </Text>
              <Text style={styles.lead}>
                A student carpooling app for SMU. Share the seats you have, find a ride you need, and
                get there together.
              </Text>
              <View style={styles.highlights}>
                {HIGHLIGHTS.map((item) => (
                  <View key={item.icon} style={styles.highlight}>
                    <View
                      style={[
                        styles.highlightIcon,
                        { backgroundColor: item.role ? roleSoftColor(item.role) : colors.surfaceRaised },
                      ]}
                    >
                      <Ionicons
                        name={item.icon}
                        size={18}
                        color={item.role ? roleColor(item.role) : colors.textMuted}
                      />
                    </View>
                    <View style={styles.flex}>
                      {item.title && <Text style={styles.highlightTitle}>{item.title}</Text>}
                      <Text style={styles.highlightText}>{item.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {step === 1 && (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                How do you want to start?
              </Text>
              <Text style={styles.lead}>
                One account works in both modes. Pick where you&apos;d like to begin.
              </Text>
              <View accessibilityRole="radiogroup">
                {MODE_OPTIONS.map((option) => {
                  const isActive = mode === option.key;
                  const optionTint = roleColor(option.key);
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setMode(option.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={`${option.title}. ${option.summary}`}
                      style={({ pressed }) => [
                        styles.modeTile,
                        isActive && { borderColor: optionTint, backgroundColor: roleSoftColor(option.key) },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.modeTop}>
                        <View style={[styles.modeIcon, { backgroundColor: roleSoftColor(option.key) }]}>
                          <Ionicons name={option.icon} size={22} color={optionTint} />
                        </View>
                        <View style={styles.modeHeading}>
                          <Text style={styles.modeTitle}>{option.title}</Text>
                          <Text style={styles.modeSummary}>{option.summary}</Text>
                        </View>
                        <Ionicons
                          name={isActive ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={isActive ? optionTint : colors.textFaint}
                        />
                      </View>
                      {option.points.map((point) => (
                        <View key={point} style={styles.modePoint}>
                          <Ionicons name="checkmark" size={15} color={colors.textMuted} />
                          <Text style={styles.modePointText}>{point}</Text>
                        </View>
                      ))}
                    </Pressable>
                  );
                })}
              </View>
              <Notice message="You can switch anytime with the Driver/Rider toggle on Home or Profile." />
            </View>
          )}

          {step === 2 && (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                Set up your profile
              </Text>
              <Text style={styles.lead}>
                Optional. Riders and drivers see your name and photo on rides. You can change this
                later in Profile › Edit Profile.
              </Text>

              <ProfilePhotoField
                name={profileNameInput}
                role={mode}
                currentPhotoUri={currentUser.avatarUrl}
                profilePhotoDraft={profilePhotoDraft}
                profilePhotoError={profilePhotoError}
                isPickingPhoto={isPickingPhoto}
                isSavingProfile={isSavingProfile}
                handlePickProfilePhoto={handlePickProfilePhoto}
                handleDiscardProfilePhoto={handleDiscardProfilePhoto}
                saveLabel="Finish"
              />

              <FormSection title="About you" icon="person-circle-outline" tint={tint}>
                <TextField
                  label="Display name"
                  icon="person-outline"
                  placeholder="e.g. Jordan Smith"
                  value={profileNameInput}
                  onChangeText={setProfileNameInput}
                  maxLength={NAME_MAX_LENGTH}
                  autoCapitalize="words"
                  textContentType="name"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                <TextField
                  label="Bio"
                  icon="chatbubble-ellipses-outline"
                  placeholder="A line or two about you (e.g. major, usual routes)"
                  value={profileBioInput}
                  onChangeText={setProfileBioInput}
                  multiline
                  numberOfLines={3}
                  maxLength={BIO_MAX_LENGTH}
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={Keyboard.dismiss}
                  hint={`Optional · ${profileBioInput.length}/${BIO_MAX_LENGTH}`}
                  style={mode === 'driver' ? undefined : styles.lastField}
                />
                {/* Only asked in Driver mode; a saved vehicle is kept either way. */}
                {mode === 'driver' && (
                  <TextField
                    label="Vehicle make/model"
                    icon="car-outline"
                    placeholder="e.g. Honda Civic"
                    value={profileVehicleInput}
                    onChangeText={setProfileVehicleInput}
                    maxLength={VEHICLE_MAX_LENGTH}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    hint="Optional. Helps riders spot your car."
                    style={styles.lastField}
                  />
                )}
              </FormSection>

              {profileFormError !== '' && <Notice message={profileFormError} tone="danger" />}
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {step < STEP_COUNT - 1 ? (
            <AppButton
              title={step === 0 ? 'Get Started' : `Continue as ${mode === 'driver' ? 'Driver' : 'Rider'}`}
              icon="arrow-forward"
              variant={step === 1 && mode === 'rider' ? 'rider' : 'primary'}
              onPress={() => goTo(step + 1)}
            />
          ) : (
            <>
              <AppButton
                title="Finish"
                icon="arrow-forward"
                variant={mode === 'rider' ? 'rider' : 'primary'}
                onPress={handleGetStarted}
                loading={isSavingProfile}
                style={styles.primaryAction}
              />
              <AppButton
                title="Skip for now"
                variant="secondary"
                onPress={handleSkip}
                disabled={isSavingProfile}
              />
            </>
          )}
        </View>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: gutter,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  topSide: {
    flex: 1,
    flexDirection: 'row',
  },
  topSideRight: {
    justifyContent: 'flex-end',
  },
  topButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  topButtonText: {
    ...typography.bodyStrong,
    color: colors.textMuted,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.muted,
  },
  dotActive: {
    width: 22,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.display,
    color: colors.text,
  },
  lead: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  highlights: {
    gap: spacing.md,
  },
  highlight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  highlightIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  highlightTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    marginBottom: 2,
  },
  highlightText: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 20,
  },
  modeTile: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  modeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  modeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  modeHeading: {
    flex: 1,
    marginRight: spacing.sm,
  },
  modeTitle: {
    ...typography.title,
    color: colors.text,
  },
  modeSummary: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  modePoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingLeft: 56,
  },
  modePointText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 17,
  },
  lastField: {
    marginBottom: 0,
  },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  primaryAction: {
    marginBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
}));
