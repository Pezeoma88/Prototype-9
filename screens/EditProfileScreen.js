import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import AppButton from '../components/AppButton';
import BackHeader from '../components/BackHeader';
import FormSection from '../components/FormSection';
import Notice from '../components/Notice';
import ProfilePhotoField from '../components/ProfilePhotoField';
import TextField from '../components/TextField';
import { BIO_MAX_LENGTH, NAME_MAX_LENGTH, VEHICLE_MAX_LENGTH } from '../lib/format';
import { colors, createThemedStyles, gutter, spacing, typography } from '../theme/theme';

// Edit Profile, opened from the Profile tab. One form for the whole person:
// General (name, bio) and the optional Driver information (vehicle
// make/model), which stays saved while the person uses Rider mode. State,
// validation, and saving stay in App.js; this screen only renders them.
//
// The profile photo is picked from the photo library (square crop) and
// previewed here; App uploads it to Supabase Storage only on Save Changes.
// License plates aren't collected at all in this prototype. Username and
// email aren't edited here: the username is the sign-in name, and the email
// is private to Supabase Auth (shown read-only on Profile).
export default function EditProfileScreen({
  activeMode,
  currentPhotoUri,
  profilePhotoDraft,
  profilePhotoError,
  isPickingPhoto,
  handlePickProfilePhoto,
  handleDiscardProfilePhoto,
  profileNameInput,
  setProfileNameInput,
  profileBioInput,
  setProfileBioInput,
  profileVehicleInput,
  setProfileVehicleInput,
  profileFormError,
  isSavingProfile,
  handleSaveProfile,
  resetProfileForm,
}) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BackHeader
          backLabel="Cancel"
          onBack={resetProfileForm}
          title="Edit Profile"
          subtitle="One profile for both Driver and Rider mode."
        />

        <ProfilePhotoField
          name={profileNameInput}
          role={activeMode}
          currentPhotoUri={currentPhotoUri}
          profilePhotoDraft={profilePhotoDraft}
          profilePhotoError={profilePhotoError}
          isPickingPhoto={isPickingPhoto}
          isSavingProfile={isSavingProfile}
          handlePickProfilePhoto={handlePickProfilePhoto}
          handleDiscardProfilePhoto={handleDiscardProfilePhoto}
          saveLabel="Save Changes"
        />

        <FormSection title="General" icon="person-circle-outline">
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
            style={styles.lastField}
          />
        </FormSection>

        <FormSection title="Driver information" icon="car-sport-outline" tint={colors.driver}>
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
            hint="Optional, and only needed for driving. It stays saved while you use Rider mode."
            style={styles.lastField}
          />
          <View style={styles.privacyRow}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
            <View style={styles.privacyText}>
              <Text style={styles.privacyTitle}>License plate</Text>
              <Text style={styles.privacyDetail}>
                Not collected. Sharing a plate only with confirmed riders needs secure sign-in, which
                this prototype doesn&apos;t have yet.
              </Text>
            </View>
          </View>
        </FormSection>

        {profileFormError !== '' && <Notice message={profileFormError} tone="danger" style={styles.error} />}

        <AppButton
          title="Save Changes"
          icon="checkmark-circle-outline"
          onPress={handleSaveProfile}
          loading={isSavingProfile}
          style={styles.submit}
        />
        <AppButton title="Cancel" variant="secondary" onPress={resetProfileForm} disabled={isSavingProfile} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = createThemedStyles(() => ({
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  lastField: {
    marginBottom: 0,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  privacyText: {
    flex: 1,
    marginLeft: 10,
  },
  privacyTitle: {
    ...typography.label,
    color: colors.text,
  },
  privacyDetail: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: 2,
    lineHeight: 17,
  },
  error: {
    marginTop: spacing.xs,
  },
  submit: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
}));
