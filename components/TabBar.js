import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, spacing } from '../theme/theme';

// The four main sections of CarpoolBoard, in tab-bar order.
export const TABS = [
  { key: 'home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { key: 'map', label: 'Map', icon: 'map-outline', activeIcon: 'map' },
  { key: 'requests', label: 'Requests', icon: 'file-tray-full-outline', activeIcon: 'file-tray-full' },
  { key: 'profile', label: 'Profile', icon: 'person-outline', activeIcon: 'person' },
];

// Compact white bottom navigation. The active tab gets a filled icon, the
// primary blue, and a short bar above its icon. Bottom padding follows the device's
// safe area so it clears the iPhone home indicator.
export default function TabBar({ activeTab, onTabPress, badges = {} }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        const tint = isActive ? colors.primary : colors.textFaint;
        const badgeCount = badges[tab.key] || 0;
        return (
          <Pressable
            key={tab.key}
            style={styles.tab}
            onPress={() => onTabPress(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            hitSlop={4}
          >
            {({ pressed }) => (
              <View style={[styles.tabInner, pressed && styles.tabPressed]}>
                <View style={[styles.indicator, isActive && styles.indicatorActive]} />
                <View>
                  <Ionicons name={isActive ? tab.activeIcon : tab.icon} size={23} color={tint} />
                  {badgeCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.label, { color: tint }, isActive && styles.labelActive]}>
                  {tab.label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
  },
  tabInner: {
    alignItems: 'center',
  },
  tabPressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
  },
  labelActive: {
    fontWeight: '600',
  },
  indicator: {
    width: 28,
    height: 3,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: colors.primary,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textOnAccent,
  },
}));
