import { useState } from 'react';
import { Pressable } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import TextField from './TextField';
import { colors, createThemedStyles } from '../theme/theme';

// A TextField for passwords: hidden by default, with an eye button to show
// or hide what's typed. `textContentType` lets iOS offer saved passwords
// ('password') or suggest a strong one ('newPassword').
export default function PasswordField({ textContentType = 'password', ...fieldProps }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <TextField
      icon="lock-closed-outline"
      {...fieldProps}
      secureTextEntry={!isVisible}
      textContentType={textContentType}
      autoComplete={textContentType === 'newPassword' ? 'new-password' : 'current-password'}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      right={
        <Pressable
          onPress={() => setIsVisible((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={isVisible ? 'Hide password' : 'Show password'}
          hitSlop={10}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Ionicons name={isVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
        </Pressable>
      }
    />
  );
}

const styles = createThemedStyles(() => ({
  toggle: {
    paddingLeft: 10,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.6,
  },
}));
