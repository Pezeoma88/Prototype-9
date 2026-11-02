import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@react-native-vector-icons/ionicons';
import TextField from './TextField';
import SegmentedControl from './SegmentedControl';
import { RIDER_SORT_OPTIONS, SEAT_FILTER_OPTIONS, countPanelFilters, hasActiveRideFilters } from '../lib/rideFilters';
import { formatDepartureDate } from '../lib/format';
import { colors, createThemedStyles, getColorScheme, radius, spacing, typography } from '../theme/theme';

// Rider-mode search and filters above Available Rides: a destination search
// field that filters as you type, a Filters button that opens departure
// date, minimum seats, and sort options, and a "Showing X of Y" line with
// Clear Filters whenever anything is applied.
//
// `filters` is App's rideFilters state (lib/rideFilters.js); `onChange`
// takes the fields to update. Only how the list is shown changes: the rides
// themselves are never touched.
export default function RideFilterPanel({ filters, onChange, onClear, resultCount, totalCount, style }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  // Clear Filters (here or in the empty state) also closes the date wheel.
  useEffect(() => {
    if (filters.date === null) {
      setIsDatePickerOpen(false);
    }
  }, [filters.date]);

  const panelCount = countPanelFilters(filters);
  const isFiltering = hasActiveRideFilters(filters);

  function handleToggleDatePicker() {
    // The iPhone wheel shows today straight away, so start the filter there
    // too; otherwise leaving it on today wouldn't apply anything.
    if (!isDatePickerOpen && filters.date === null && Platform.OS === 'ios') {
      onChange({ date: startOfToday() });
    }
    setIsDatePickerOpen((open) => !open);
  }

  function handleDatePicked(pickedDate) {
    if (pickedDate instanceof Date && !Number.isNaN(pickedDate.getTime())) {
      const day = new Date(pickedDate);
      day.setHours(0, 0, 0, 0);
      onChange({ date: day });
    }
    // Android shows the picker as a one-shot dialog, so close it after a pick.
    if (Platform.OS !== 'ios') {
      setIsDatePickerOpen(false);
    }
  }

  return (
    <View style={style}>
      <View style={styles.searchRow}>
        <TextField
          icon="search"
          placeholder="Search by destination"
          value={filters.query}
          onChangeText={(text) => onChange({ query: text })}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search rides by destination"
          style={styles.searchField}
        />
        <Pressable
          onPress={() => setIsExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={panelCount > 0 ? `Filters, ${panelCount} applied` : 'Filters'}
          accessibilityState={{ expanded: isExpanded }}
          style={({ pressed }) => [
            styles.filterButton,
            (isExpanded || panelCount > 0) && styles.filterButtonActive,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={isExpanded || panelCount > 0 ? colors.primary : colors.textMuted}
          />
          {panelCount > 0 && (
            <View style={styles.countDot}>
              <Text style={styles.countText}>{panelCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {isExpanded && (
        <View style={styles.panel}>
          <Text style={styles.groupLabel}>Departure date</Text>
          <View style={styles.dateRow}>
            <Pressable
              onPress={handleToggleDatePicker}
              accessibilityRole="button"
              accessibilityLabel={`Departure date, ${filters.date ? formatDepartureDate(filters.date) : 'any date'}`}
              accessibilityHint={isDatePickerOpen ? 'Closes the date picker' : 'Opens a date picker'}
              accessibilityState={{ expanded: isDatePickerOpen }}
              style={({ pressed }) => [
                styles.dateTile,
                (isDatePickerOpen || filters.date !== null) && styles.dateTileActive,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="calendar-outline" size={16} color={colors.primary} />
              <Text
                style={filters.date !== null ? styles.dateValue : styles.datePlaceholder}
                numberOfLines={1}
              >
                {filters.date !== null ? formatDepartureDate(filters.date) : 'Any date'}
              </Text>
              {isDatePickerOpen && Platform.OS === 'ios' ? (
                <Text style={styles.dateDone}>Done</Text>
              ) : (
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              )}
            </Pressable>
            {filters.date !== null && (
              <Pressable
                onPress={() => onChange({ date: null })}
                accessibilityRole="button"
                accessibilityLabel="Remove date filter"
                hitSlop={6}
                style={({ pressed }) => [styles.dateClear, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {isDatePickerOpen && (
            <View style={Platform.OS === 'ios' ? styles.pickerBox : null}>
              <DateTimePicker
                value={filters.date || startOfToday()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant={getColorScheme()}
                textColor={colors.text}
                locale="en-US"
                onValueChange={(event, date) => handleDatePicked(date)}
                onDismiss={() => setIsDatePickerOpen(false)}
              />
            </View>
          )}

          <Text style={styles.groupLabel}>Available seats</Text>
          <SegmentedControl
            options={SEAT_FILTER_OPTIONS}
            value={filters.minSeats}
            onChange={(minSeats) => onChange({ minSeats })}
            style={styles.group}
          />

          <Text style={styles.groupLabel}>Sort by</Text>
          <SegmentedControl
            options={RIDER_SORT_OPTIONS}
            value={filters.sort}
            onChange={(sort) => onChange({ sort })}
          />
        </View>
      )}

      {isFiltering && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText} accessibilityLiveRegion="polite">
            Showing {resultCount} of {totalCount} ride{totalCount === 1 ? '' : 's'}
          </Text>
          <Pressable onPress={onClear} accessibilityRole="button" hitSlop={8}>
            {({ pressed }) => (
              <Text style={[styles.clearText, pressed && styles.pressed]}>Clear Filters</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

const styles = createThemedStyles(() => ({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchField: {
    flex: 1,
    marginBottom: 0,
  },
  filterButton: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  countDot: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textOnAccent,
  },
  pressed: {
    opacity: 0.7,
  },
  panel: {
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  group: {
    marginBottom: spacing.lg,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  dateTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateTileActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  dateValue: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  datePlaceholder: {
    ...typography.body,
    color: colors.textFaint,
    flex: 1,
  },
  dateDone: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
  dateClear: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  summaryText: {
    ...typography.label,
    color: colors.textMuted,
  },
  clearText: {
    ...typography.label,
    fontWeight: '700',
    color: colors.primary,
  },
}));
