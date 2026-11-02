import * as SecureStore from 'expo-secure-store';

// Where Supabase Auth keeps the signed-in session between app launches: the
// iOS Keychain / Android Keystore via expo-secure-store, never plain
// AsyncStorage. The session holds tokens only (no password is ever stored).
//
// Some iOS versions reject Keychain values above ~2048 bytes, and a
// Supabase session is usually bigger, so each value is split into chunks:
//   <key>.count  how many chunks
//   <key>.0 …    the chunks themselves
//
// AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: readable in the background (so a
// token refresh doesn't fail while the phone is locked) and never copied
// to another device through a backup.

const CHUNK_SIZE = 1800;
const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
function safeKey(key) {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function removeChunks(base, count) {
  for (let i = 0; i < count; i += 1) {
    await SecureStore.deleteItemAsync(`${base}.${i}`, OPTIONS);
  }
}

export const secureSessionStorage = {
  async getItem(key) {
    const base = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${base}.count`, OPTIONS));
    if (!Number.isInteger(count) || count <= 0) {
      return null;
    }
    let value = '';
    for (let i = 0; i < count; i += 1) {
      const chunk = await SecureStore.getItemAsync(`${base}.${i}`, OPTIONS);
      // A missing chunk means a half-written value: treat it as signed out
      // rather than handing Supabase a broken session.
      if (chunk === null) {
        return null;
      }
      value += chunk;
    }
    return value;
  },

  async setItem(key, value) {
    const base = safeKey(key);
    const oldCount = Number(await SecureStore.getItemAsync(`${base}.count`, OPTIONS)) || 0;
    const chunks = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i += 1) {
      await SecureStore.setItemAsync(`${base}.${i}`, chunks[i], OPTIONS);
    }
    await SecureStore.setItemAsync(`${base}.count`, String(chunks.length), OPTIONS);
    // A shorter new value leaves old chunks behind; remove them.
    for (let i = chunks.length; i < oldCount; i += 1) {
      await SecureStore.deleteItemAsync(`${base}.${i}`, OPTIONS);
    }
  },

  async removeItem(key) {
    const base = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${base}.count`, OPTIONS)) || 0;
    await SecureStore.deleteItemAsync(`${base}.count`, OPTIONS);
    await removeChunks(base, count);
  },
};
