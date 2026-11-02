import * as SecureStore from 'expo-secure-store';

// Small on-device preferences, kept in expo-secure-store next to the
// session (lib/secureSessionStorage.js). None of this is a credential:
//   carpoolboard.appearance        'light' or 'dark' (the Light/Dark setting)
//   carpoolboard.intro.<user id>   'pending' while a new account hasn't
//                                  finished the app intro, 'done' after
// Nothing here is sent to Supabase. Every read/write is best effort: if
// storage fails the app just falls back to Light and to not showing the
// intro again, rather than blocking sign-in.

const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const APPEARANCE_KEY = 'carpoolboard.appearance';

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
function introKey(userId) {
  return `carpoolboard.intro.${String(userId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

// Read synchronously at launch so the first screen already uses the saved
// scheme (no flash of Light before Dark).
export function loadSavedColorScheme() {
  try {
    return SecureStore.getItem(APPEARANCE_KEY, OPTIONS) === 'dark' ? 'dark' : 'light';
  } catch (error) {
    console.warn('CarpoolBoard: reading the appearance setting failed', error);
    return 'light';
  }
}

export async function saveColorScheme(scheme) {
  try {
    await SecureStore.setItemAsync(APPEARANCE_KEY, scheme === 'dark' ? 'dark' : 'light', OPTIONS);
  } catch (error) {
    console.warn('CarpoolBoard: saving the appearance setting failed', error);
  }
}

// 'pending', 'done', or null when this account has no intro status on this
// phone.
export async function getIntroStatus(userId) {
  try {
    const value = await SecureStore.getItemAsync(introKey(userId), OPTIONS);
    return value === 'pending' || value === 'done' ? value : null;
  } catch (error) {
    console.warn('CarpoolBoard: reading the intro status failed', error);
    return null;
  }
}

export async function setIntroStatus(userId, status) {
  try {
    await SecureStore.setItemAsync(introKey(userId), status, OPTIONS);
  } catch (error) {
    console.warn('CarpoolBoard: saving the intro status failed', error);
  }
}
