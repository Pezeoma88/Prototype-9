import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { colors, createThemedStyles, roleColor } from '../theme/theme';
import { getInitial } from '../lib/format';

// Circular avatar. Shows the person's profile photo when `uri` is set;
// otherwise (or if the photo can't be loaded) an initial on the role's
// accent color.
export default function Avatar({ name, role = 'driver', uri, size = 44, ring = false }) {
  // The last photo URL that failed to load, so a broken/missing file falls
  // back to initials instead of an empty circle. A new uri is tried again.
  const [failedUri, setFailedUri] = useState(null);
  const showPhoto = Boolean(uri) && uri !== failedUri;

  const circle = { width: size, height: size, borderRadius: size / 2 };
  const inner = showPhoto ? (
    <Image
      source={{ uri }}
      style={[circle, styles.image]}
      onError={() => setFailedUri(uri)}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View style={[circle, styles.fallback, { backgroundColor: roleColor(role) }]}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.4) }]}>{getInitial(name)}</Text>
    </View>
  );

  if (!ring) {
    return inner;
  }
  const ringSize = size + 6;
  return (
    <View
      style={[
        styles.ring,
        { width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: roleColor(role) },
      ]}
    >
      {inner}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  image: {
    backgroundColor: colors.surfaceRaised,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: colors.textOnAccent,
    fontWeight: '700',
  },
  ring: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
