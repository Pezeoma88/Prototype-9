import { StyleSheet } from 'react-native';

// CarpoolBoard design tokens (Prototype 8: light redesign + dark mode).
//
// Every screen/component reads its colors, spacing, radii, and type sizes
// from here instead of hard-coding values, so the look stays consistent and
// can be tuned in one place.
//
// Light (the default) is a clean white interface: white screens, white cards
// with thin gray borders, one blue accent, and quiet gray secondary text.
// Driver stays blue (the primary accent); Rider uses a muted teal so the two
// modes are still easy to tell apart. Dark brings back the navy look of the
// earlier prototypes with the same layout.
//
// A few components build a translucent tint by appending a 2-digit hex alpha
// to a color (e.g. `${colors.rider}29`), so keep accent colors as 6-digit hex.
//
// How switching works: `colors` is one shared object whose values are
// swapped in place by applyColorScheme. Anything read during render (inline
// `colors.x`, roleColor, tone maps built in a function) picks up the new
// values on the next render, and createThemedStyles rebuilds each file's
// style sheet the first time it's used after a switch. App re-renders the
// whole tree when the scheme changes, so nothing needs a restart.

const lightColors = {
  // Surfaces
  bg: '#FFFFFF', // app background
  surface: '#FFFFFF', // cards (separated from the background by a border)
  surfaceRaised: '#F8FAFC', // inputs, chips, inset boxes, pressed cards
  surfaceSunken: '#F1F5F9', // tracks behind segmented controls
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',

  // Text
  text: '#111827',
  textMuted: '#64748B',
  textFaint: '#94A3B8', // placeholders, hints, disabled labels
  textOnAccent: '#FFFFFF',
  textOnAccentMuted: 'rgba(255, 255, 255, 0.85)',
  onAccentSoft: 'rgba(255, 255, 255, 0.2)', // icon chips on filled tiles

  // Brand / actions
  primary: '#2563EB',
  primaryPressed: '#1D4ED8',
  primarySoft: '#EFF6FF',
  accent: '#2563EB',

  // Role identity
  driver: '#2563EB',
  driverSoft: '#EFF6FF',
  rider: '#0D9488',
  riderSoft: '#F0FDFA',
  riderPressed: '#0F766E',
  riderBorder: '#99F6E4',

  // Status (text-safe shades for use on white and on their soft fills)
  success: '#16A34A',
  successSoft: '#F0FDF4',
  pending: '#B45309',
  pendingSoft: '#FFFBEB',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  dangerPressed: '#FEE2E2',
  muted: '#E5E7EB', // disabled button fill
  star: '#F59E0B', // rating stars
  mutedSoft: '#F1F5F9',
};

// Dark: deep navy backgrounds, slightly lighter navy cards, light text, and
// brighter blue/teal accents that stay readable on navy. The soft fills are
// opaque dark tints rather than pastel, so badges and notices don't glare.
const darkColors = {
  // Surfaces
  bg: '#0F172A',
  surface: '#16213E',
  surfaceRaised: '#1E2B4D',
  surfaceSunken: '#0B1222',
  border: '#2A3A5E',
  borderStrong: '#3B4D75',

  // Text
  text: '#F1F5F9',
  textMuted: '#A5B4CB',
  textFaint: '#7A8AA6',
  textOnAccent: '#FFFFFF',
  textOnAccentMuted: 'rgba(255, 255, 255, 0.85)',
  onAccentSoft: 'rgba(255, 255, 255, 0.2)',

  // Brand / actions
  primary: '#3B82F6',
  primaryPressed: '#2563EB',
  primarySoft: '#172B55',
  accent: '#3B82F6',

  // Role identity
  driver: '#3B82F6',
  driverSoft: '#172B55',
  rider: '#10A090',
  riderSoft: '#123A45',
  riderPressed: '#0D857A',
  riderBorder: '#1C6B66',

  // Status
  success: '#4ADE80',
  successSoft: '#123726',
  pending: '#FBBF24',
  pendingSoft: '#3A2F12',
  danger: '#F87171',
  dangerSoft: '#3D1C2A',
  dangerPressed: '#4A2233',
  muted: '#2A3A5E',
  star: '#FBBF24',
  mutedSoft: '#1E2B4D',
};

const PALETTES = { light: lightColors, dark: darkColors };

// The active palette. Its values change in place (see applyColorScheme), so
// always read `colors.x` at render time rather than copying it at load.
export const colors = { ...lightColors };

let colorScheme = 'light';
// Bumped on every switch so themed style sheets know to rebuild.
let schemeVersion = 0;

// 'light' or 'dark'. Also usable directly as a keyboardAppearance,
// DateTimePicker themeVariant, or MapView userInterfaceStyle.
export function getColorScheme() {
  return colorScheme;
}

// expo-status-bar style with readable icons on the active background.
export function statusBarStyle() {
  return colorScheme === 'dark' ? 'light' : 'dark';
}

// Switches the shared palette to 'light' or 'dark' (anything else is light).
// Callers re-render afterwards; App does this from its colorScheme state.
export function applyColorScheme(scheme) {
  const next = scheme === 'dark' ? 'dark' : 'light';
  if (next === colorScheme) {
    return;
  }
  colorScheme = next;
  schemeVersion += 1;
  Object.assign(colors, PALETTES[next]);
  gradients.primary = [colors.primary, colors.primaryPressed];
}

// A StyleSheet whose colors follow the active scheme. Use it like
// StyleSheet.create, but pass a function: `createThemedStyles(() => ({...}))`.
// The sheet is built on first use and again after each scheme switch.
export function createThemedStyles(build) {
  let sheet = null;
  let builtFor = -1;
  function current() {
    if (builtFor !== schemeVersion) {
      sheet = StyleSheet.create(build());
      builtFor = schemeVersion;
    }
    return sheet;
  }
  return new Proxy({}, { get: (_target, key) => current()[key] });
}

// Two-stop gradient for the occasional highlight (not for every surface).
export const gradients = {
  primary: [colors.primary, colors.primaryPressed],
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// Standard horizontal page gutter.
export const gutter = spacing.xl;

export const radius = {
  sm: 10,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const typography = {
  caption: { fontSize: 12, fontWeight: '500' },
  label: { fontSize: 13, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '600' },
  heading: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  display: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
};

// Very soft shadow for cards on white. iOS uses the shadow* props; Android
// uses elevation. The border does most of the separation work.
export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
};

// Accent color for a Driver/Rider role.
export function roleColor(role) {
  return role === 'rider' ? colors.rider : colors.driver;
}

export function roleSoftColor(role) {
  return role === 'rider' ? colors.riderSoft : colors.driverSoft;
}
