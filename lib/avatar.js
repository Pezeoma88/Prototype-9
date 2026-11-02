import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from './supabase';

// Profile photos (see supabase/avatar-storage.sql). Photos live in the
// public 'avatars' Storage bucket at <profile id>/<ms timestamp>.<jpg|png>,
// and profiles.avatar_path stores only that path. The path is keyed by the
// profile id (never the email, which can change), and every upload gets a
// new timestamped path, so nothing is overwritten and phones never show a
// stale cached photo. Replaced photos stay in the bucket (no delete access).
//
// Uploads need a signed-in session: Storage only accepts a file inside the
// uploader's own <auth user id>/ folder (supabase/auth-2-lockdown.sql).

export const AVATAR_BUCKET = 'avatars';

// Must match the bucket's limits: Storage rejects anything else anyway, but
// checking first gives a clear message instead of a failed upload.
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' };

// An error whose message is meant to be shown to the user as-is.
export class AvatarError extends Error {}

// The public URL for a stored avatar path, or null when there's no photo.
// This only builds the URL string; it doesn't contact Supabase.
export function getAvatarUrl(avatarPath) {
  if (!avatarPath) {
    return null;
  }
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath).data.publicUrl;
}

// Works out an asset's MIME type, falling back to its file extension when
// the picker doesn't report one.
function getMimeType(asset) {
  if (asset.mimeType) {
    return asset.mimeType.toLowerCase();
  }
  const extension = (asset.uri.split('.').pop() || '').toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return '';
}

// Asks for photo-library access, then opens the iPhone photo library with a
// square crop. Resolves to one of:
//   { image: { uri, mimeType } }  a usable JPEG/PNG was picked
//   { canceled: true }            the user backed out (nothing changes)
//   { denied: true, canAskAgain } photo access was refused
// Throws an AvatarError for a photo that can't be used (wrong type, too big).
export async function pickAvatarImage() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { denied: true, canAskAgain: permission.canAskAgain };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
    // Ask iOS for its most compatible format (JPEG) instead of HEIC.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { canceled: true };
  }

  const asset = result.assets[0];
  const mimeType = getMimeType(asset);
  if (!AVATAR_EXTENSIONS[mimeType]) {
    throw new AvatarError('That photo’s format isn’t supported. Please choose a JPEG or PNG photo.');
  }
  if (asset.fileSize && asset.fileSize > AVATAR_MAX_BYTES) {
    throw new AvatarError('That photo is larger than 2 MB. Please choose a smaller photo.');
  }
  return { image: { uri: asset.uri, mimeType } };
}

// Uploads a picked image for this profile and resolves to its new Storage
// path (what goes in profiles.avatar_path). Throws on any failure, so the
// caller never saves a path for a photo that didn't upload.
export async function uploadAvatar(profileId, image) {
  const extension = AVATAR_EXTENSIONS[image.mimeType];
  if (!extension) {
    throw new AvatarError('That photo’s format isn’t supported. Please choose a JPEG or PNG photo.');
  }

  const bytes = await new File(image.uri).arrayBuffer();
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    throw new AvatarError('That photo is larger than 2 MB. Please choose a smaller photo.');
  }

  // Date.now() is a 13-digit millisecond timestamp, as the upload policy expects.
  const path = `${profileId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: image.mimeType, upsert: false });
  if (error) {
    throw error;
  }
  return path;
}
