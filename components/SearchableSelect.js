import { useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, createThemedStyles, getColorScheme, radius, spacing, typography } from '../theme/theme';

// Compact search field with a suggestion list underneath, used in place of
// long rows of preset chips. Typing filters `options` ({ key, label }) and
// tapping one calls onSelect and closes the list.
//
// Two ways to use it:
//   freeText   the typed text IS the value (onChangeText fires as you type),
//              and a "Use “…”" row confirms text that matches no option.
//   otherwise  the value can only be an option. While the list is open the
//              field holds a search query; when it closes it shows `value`
//              again. Pass noneLabel to add a "None" row that calls onClear.
//
// The list renders inline (not as an overlay), so the form's ScrollView and
// KeyboardAvoidingView keep it on screen with the keyboard open. It is a
// plain nested ScrollView rather than a FlatList, which would warn inside
// the form's ScrollView.
export default function SearchableSelect({
  label,
  icon = 'search',
  placeholder,
  value,
  options,
  selectedKey = null,
  onSelect,
  onClear,
  freeText = false,
  onChangeText,
  noneLabel,
  emptyMessage = 'No matching places.',
  onFocus,
  style,
}) {
  const inputRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const searchText = (freeText ? value : query).trim().toLowerCase();
  // A field already showing one option's full name lists everything, so
  // tapping it again offers every choice instead of just that one.
  const showsExactMatch = options.some((option) => option.label.toLowerCase() === searchText);
  const matches =
    searchText === '' || showsExactMatch
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(searchText));
  const showCustomRow = freeText && searchText !== '' && !showsExactMatch;
  const showNoneRow = noneLabel !== undefined && searchText === '';

  function close() {
    setIsOpen(false);
    setQuery('');
    inputRef.current?.blur();
    Keyboard.dismiss();
  }

  function handlePick(option) {
    onSelect(option);
    close();
  }

  function handleClear() {
    onClear();
    setQuery('');
    if (freeText) {
      // Keep the keyboard up so the driver can type the replacement.
      inputRef.current?.focus();
    }
  }

  const inputValue = freeText ? value : isOpen ? query : value;
  const hasValue = value !== '';

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.box, isOpen && styles.boxOpen]}>
        <Ionicons
          name={icon}
          size={18}
          color={isOpen || hasValue ? colors.primary : colors.textMuted}
          style={styles.icon}
        />
        <TextInput
          ref={inputRef}
          value={inputValue}
          onChangeText={(text) => {
            if (freeText) {
              onChangeText(text);
            } else {
              setQuery(text);
            }
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            onFocus?.();
          }}
          onBlur={() => {
            setIsOpen(false);
            setQuery('');
          }}
          placeholder={isOpen && !freeText ? 'Search places' : placeholder}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          keyboardAppearance={getColorScheme()}
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={close}
          accessibilityLabel={label || placeholder}
          accessibilityHint="Type to filter, then pick a place from the list"
          style={styles.input}
        />
        {hasValue ? (
          <Pressable
            onPress={handleClear}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label || 'selection'}`}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textFaint}
            style={styles.chevron}
          />
        )}
      </View>

      {isOpen && (
        <View style={styles.list}>
          <ScrollView
            style={styles.listScroll}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {showNoneRow && (
              <SuggestionRow
                label={noneLabel}
                icon="close-outline"
                isSelected={selectedKey === null}
                onPress={() => {
                  onClear();
                  close();
                }}
              />
            )}
            {showCustomRow && (
              <SuggestionRow
                label={`Use “${value.trim()}”`}
                icon="create-outline"
                isSelected={false}
                onPress={close}
              />
            )}
            {matches.map((option) => (
              <SuggestionRow
                key={option.key}
                label={option.label}
                icon="location-outline"
                isSelected={option.key === selectedKey}
                onPress={() => handlePick(option)}
              />
            ))}
            {matches.length === 0 && (
              <Text style={styles.empty} accessibilityLiveRegion="polite">
                {emptyMessage}
              </Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function SuggestionRow({ label, icon, isSelected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Ionicons
        name={icon}
        size={17}
        color={isSelected ? colors.primary : colors.textMuted}
      />
      <Text style={[styles.rowText, isSelected && styles.rowTextSelected]} numberOfLines={1}>
        {label}
      </Text>
      {isSelected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
    </Pressable>
  );
}

const styles = createThemedStyles(() => ({
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  boxOpen: {
    borderColor: colors.primary,
  },
  icon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 12,
  },
  clear: {
    marginLeft: spacing.sm,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    marginLeft: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  list: {
    marginTop: spacing.xs,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  // About four and a half rows, so it's clear the list scrolls and it still
  // fits above the iPhone keyboard.
  listScroll: {
    maxHeight: 210,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.primarySoft,
  },
  rowText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  rowTextSelected: {
    fontWeight: '700',
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
}));
