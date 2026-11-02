import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { DEMO_NETWORK_AVAILABLE, demoFetch } from './demoNetwork';
import { secureSessionStorage } from './secureSessionStorage';

// Supabase client for CarpoolBoard.
//
// Values come from .env.local (ignored by Git). Expo inlines EXPO_PUBLIC_*
// variables at build time, so they must be read with direct
// `process.env.EXPO_PUBLIC_...` references (no destructuring).
//
// Only the publishable key is used here — never a service_role/secret key.
// The publishable key is safe to ship: since Feature 3 every table is
// protected by Row Level Security that checks the signed-in user
// (supabase/auth-2-lockdown.sql), so the key alone can't read or change
// anything. The service-role key lives only in the username-sign-in Edge
// Function on Supabase's servers.
//
// Accounts use Supabase Auth (username + password; see lib/auth.js). The
// session is kept in the device's secure storage so people stay signed in
// between launches, and refreshed automatically while the app is open.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase config. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart Expo.'
  );
}

const clientOptions = {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureSessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No email links are opened in the app: confirmation and password
    // recovery use 6-digit codes typed into the app instead.
    detectSessionInUrl: false,
  },
};

// Development only: route requests through the demo network wrapper so the
// Submit Ride Request states can be shown on demand. It passes everything
// except the submit_my_ride_request RPC straight through, and production
// builds never install it.
if (DEMO_NETWORK_AVAILABLE) {
  clientOptions.global = { fetch: demoFetch };
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, clientOptions);

// Refresh the session only while the app is in the foreground (Supabase's
// recommended setup for React Native): a backgrounded app can't run timers
// reliably, and the session is refreshed on return if it has expired.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
