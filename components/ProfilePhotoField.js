import { Pressable, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import AppButton from './AppButton';
import Avatar from './Avatar';
import Notice from './Notice';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

// Profile photo picker shared by Edit Profile and onboarding: tap the avatar
// (or the button) to pick from the library. A picked photo is only a preview
// until the screen's save button (named by `saveLabel`) uploads it.
export default function ProfilePhotoField({
  name,
  role,
  currentPhotoUri,
  profilePhotoDraft,
  profilePhotoError,
  isPickingPhoto,
  isSavingProfile,
  handlePickProfilePhoto,
  handleDiscardProfilePhoto,
  saveLabel,
}) {
  // The picked-but-unsaved photo, else the saved one, else initials.
  const previewUri = profilePhotoDraft ? profilePhotoDraft.uri : currentPhotoUri;

  return (
    <>
      <View style={styles.photoRow}>
        <Pressable
          onPress={handlePickProfilePhoto}
          disabled={isPickingPhoto || isSavingProfile}
          accessibilityRole="button"
          accessibilityLabel="Choose a profile photo"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Avatar name={name} role={role} uri={previewUri} size={72} ring />
          <View style={styles.photoBadge}>
            <Ionicons name="images" size={13} color={colors.textOnAccent} />
          </View>
        </Pressable>
        <View style={styles.photoText}>
          <Text style={styles.photoTitle}>Profile photo</Text>
          <Text style={styles.photoDetail}>
            {profilePhotoDraft
              ? `New photo selected. It uploads when you tap ${saveLabel}.`
              : 'Choose a JPEG or PNG from your photo library (up to 2 MB).'}
          </Text>
          <View style={styles.photoActions}>
            <AppButton
              title={previewUri ? 'Change Photo' : 'Choose Photo'}
              icon="images-outline"
              variant="secondary"
              size="sm"
              onPress={handlePickProfilePhoto}
              loading={isPickingPhoto}
              disabled={isSavingProfile}
            />
            {profilePhotoDraft && (
              <Pressable
                onPress={handleDiscardProfilePhoto}
                disabled={isSavingProfile}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => [styles.discard, pressed && styles.pressed]}
              >
                <Text style={styles.discardText}>Keep Current</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
      {profilePhotoError !== '' && (
        <Notice message={profilePhotoError} tone="danger" style={styles.photoError} />
      )}
    </>
  );
}

const styles = createThemedStyles(() => ({
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  photoText: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  photoTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  photoDetail: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: 2,
    lineHeight: 17,
  },
  photoBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  discard: {
    paddingVertical: spacing.xs,
  },
  discardText: {
    ...typography.label,
    color: colors.textMuted,
  },
  photoError: {
    marginBottom: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
}));
