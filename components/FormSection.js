import { Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import Card from './Card';
import { colors, createThemedStyles, radius, spacing, typography } from '../theme/theme';

// A titled card that groups related form fields or details (e.g. "Route",
// "When", "Seats"), so long forms read as a few clear steps.
export default function FormSection({ title, icon, tint = colors.primary, right, children, style }) {
  return (
    <Card style={[styles.card, style]}>
      {title ? (
        <View style={styles.header}>
          {icon ? (
            <View style={[styles.iconWrap, { backgroundColor: `${tint}14` }]}>
              <Ionicons name={icon} size={15} color={tint} />
            </View>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      ) : null}
      {children}
    </Card>
  );
}

const styles = createThemedStyles(() => ({
  card: {
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  right: {
    marginLeft: spacing.sm,
  },
}));
