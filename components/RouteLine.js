import { Text, View } from 'react-native';
import { colors, createThemedStyles, spacing, typography } from '../theme/theme';

// Vertical pickup → destination route: a hollow dot for the start, a short
// connector line, and a filled dot for the end.
//
// A ride's pickup spot is optional, so `pickup` is too: without it only the
// destination stop is drawn, labeled "Going to". Nothing is invented.
export default function RouteLine({ pickup, destination, tint = colors.primary, compact = false }) {
  const stopStyle = compact ? styles.stopTextCompact : styles.stopText;

  if (!pickup) {
    return (
      <View style={styles.row}>
        <View style={styles.markerCol}>
          <View style={[styles.dotFilled, { backgroundColor: tint }]} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.caption}>Going to</Text>
          <Text style={stopStyle} numberOfLines={2}>
            {destination}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.markerCol}>
          <View style={[styles.dotHollow, { borderColor: tint }]} />
          <View style={styles.connector} />
        </View>
        <View style={[styles.textCol, styles.firstStop]}>
          <Text style={styles.caption}>Pickup</Text>
          <Text style={stopStyle} numberOfLines={1}>
            {pickup}
          </Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.markerCol}>
          <View style={[styles.dotFilled, { backgroundColor: tint }]} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.caption}>Destination</Text>
          <Text style={stopStyle} numberOfLines={2}>
            {destination}
          </Text>
        </View>
      </View>
    </View>
  );
}

const DOT = 12;

const styles = createThemedStyles(() => ({
  row: {
    flexDirection: 'row',
  },
  markerCol: {
    width: DOT,
    alignItems: 'center',
    marginRight: spacing.md,
    paddingTop: 4,
  },
  dotFilled: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  dotHollow: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2.5,
  },
  connector: {
    flex: 1,
    width: 2,
    marginVertical: 3,
    borderRadius: 1,
    backgroundColor: colors.borderStrong,
  },
  textCol: {
    flex: 1,
  },
  firstStop: {
    paddingBottom: spacing.md,
  },
  caption: {
    ...typography.caption,
    color: colors.textFaint,
  },
  stopText: {
    ...typography.title,
    color: colors.text,
    marginTop: 1,
  },
  stopTextCompact: {
    ...typography.bodyStrong,
    color: colors.text,
    marginTop: 1,
  },
}));
