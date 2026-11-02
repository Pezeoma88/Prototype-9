import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { EMAIL_PATTERN, normalizeEmail } from './format';

// Username + password accounts on Supabase Auth (Feature 3).
//
// * Sign up: username, email, password. Supabase Auth stores the password
//   as a bcrypt hash in auth.users — the app never stores it, and nothing
//   in the public tables ever holds it. A database trigger creates the
//   matching profile with the same id (supabase/auth-1-accounts.sql).
// * Email confirmation and password recovery use 6-digit codes emailed by
//   Supabase and typed into the app, so no links have to open the app.
// * Sign in: username + password through the username-sign-in Edge
//   Function, which looks up the private email on the server and returns
//   only session tokens (supabase/functions/username-sign-in).
// * The session is stored in the device's secure storage (lib/supabase.js).
//
// Every helper resolves (never throws) with a { kind, ... } result whose
// `message` is written for people, so screens can show it as-is.

// Same rule as profiles_username_format_check.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const USERNAME_MAX_LENGTH = 20;
// Matches the minimum set in Supabase Auth settings. 72 is bcrypt's limit.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

const NETWORK_MESSAGE = "Couldn't reach CarpoolBoard's server. Check your connection and try again.";

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

// '' when valid, otherwise what's wrong.
export function getUsernameProblem(username) {
  const normalized = normalizeUsername(username);
  if (normalized === '') return 'Please choose a username.';
  if (normalized.length < 3) return 'Usernames must be at least 3 characters.';
  if (normalized.length > USERNAME_MAX_LENGTH) {
    return `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Usernames can only use letters, numbers, and underscores (_).';
  }
  return '';
}

export function getPasswordProblem(password) {
  if (password === '') return 'Please enter a password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Passwords can be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Passwords need at least one letter and one number.';
  }
  return '';
}

export function getEmailProblem(email) {
  const normalized = normalizeEmail(email);
  if (normalized === '') return 'Please enter your email address.';
  if (!EMAIL_PATTERN.test(normalized)) return 'Please enter a valid email address.';
  return '';
}

export function getCodeProblem(code) {
  return /^[0-9]{6,10}$/.test(code.trim()) ? '' : 'Enter the code from the email (numbers only).';
}

// Turns a Supabase Auth error into a message for people.
function describeAuthError(error, fallback) {
  if (!error) return fallback;
  if (error.status === 0 || error.name === 'AuthRetryableFetchError') return NETWORK_MESSAGE;
  switch (error.code) {
    case 'weak_password':
      return 'That password is too weak. Use at least 8 characters with letters and numbers.';
    case 'email_address_invalid':
      return 'Please enter a valid email address.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'otp_expired':
      return 'That code is wrong or has expired. Check the latest email, or send a new code.';
    case 'same_password':
      return 'Your new password must be different from your old one.';
    case 'signup_disabled':
      return 'New accounts are turned off right now.';
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
      return 'Your session has ended. Please start again.';
    default:
      return fallback;
  }
}

// Whether a username is free. Resolves { kind: 'ok', available } or
// { kind: 'error', message }.
export async function checkUsernameAvailable(username) {
  const { data, error } = await supabase.rpc('is_username_available', {
    p_username: normalizeUsername(username),
  });
  if (error) {
    console.warn('CarpoolBoard: username check failed', error);
    return { kind: 'error', message: NETWORK_MESSAGE };
  }
  return { kind: 'ok', available: data === true };
}

// Creates the account. `role` is the starting Driver/Rider choice, kept as
// the profile's sign-up role. Resolves:
//   { kind: 'verify', email }  a confirmation code was emailed
//   { kind: 'signed_in' }      no confirmation needed (setting is off)
//   { kind: 'error', message }
export async function signUpWithUsername({ username, email, password, role }) {
  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: { data: { username: normalizeUsername(username), role } },
  });
  if (error) {
    console.warn('CarpoolBoard: sign-up failed', error);
    // The profile trigger refused the username (taken a moment ago, most
    // likely); Supabase reports that as a generic database error.
    if (error.code === 'unexpected_failure' || /database error/i.test(error.message || '')) {
      return { kind: 'error', message: 'That username was just taken. Please choose another.' };
    }
    return { kind: 'error', message: describeAuthError(error, "Couldn't create your account. Please try again.") };
  }
  if (data.session) {
    return { kind: 'signed_in' };
  }
  // Supabase answers the same way when the email is already registered
  // (so nobody can probe which emails have accounts); the confirmation
  // screen's wording covers both cases.
  return { kind: 'verify', email: normalizedEmail };
}

// Resolves { kind: 'signed_in' }, { kind: 'verify', email } (password was
// right but the email isn't confirmed yet), or { kind: 'error', message }.
export async function signInWithUsername({ username, password }) {
  const { data, error } = await supabase.functions.invoke('username-sign-in', {
    body: { username: normalizeUsername(username), password },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let body = null;
      try {
        body = await error.context.json();
      } catch {
        // Not JSON: fall through to the generic message.
      }
      if (body?.error === 'email_not_confirmed' && body.email) {
        return { kind: 'verify', email: body.email };
      }
      if (body?.message) {
        return { kind: 'error', message: body.message };
      }
    }
    console.warn('CarpoolBoard: sign-in failed', error);
    return { kind: 'error', message: NETWORK_MESSAGE };
  }
  if (!data?.access_token || !data?.refresh_token) {
    return { kind: 'error', message: NETWORK_MESSAGE };
  }
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) {
    console.warn('CarpoolBoard: storing the session failed', sessionError);
    return { kind: 'error', message: describeAuthError(sessionError, NETWORK_MESSAGE) };
  }
  return { kind: 'signed_in' };
}

// Confirms a new account's email with the emailed code; signs them in.
export async function verifySignUpCode({ email, code }) {
  const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'signup' });
  if (error) {
    return { kind: 'error', message: describeAuthError(error, 'That code didn’t work. Please try again.') };
  }
  return { kind: 'signed_in' };
}

export async function resendSignUpCode(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) {
    return { kind: 'error', message: describeAuthError(error, "Couldn't send a new code. Please try again.") };
  }
  return { kind: 'sent' };
}

// Emails a password-reset code. Supabase answers the same way whether or
// not the address has an account, so this can't be used to find accounts.
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email));
  if (error) {
    return { kind: 'error', message: describeAuthError(error, "Couldn't send the reset email. Please try again.") };
  }
  return { kind: 'sent' };
}

// Checks the reset code. On success the person holds a short-lived
// recovery session, used only to set the new password.
export async function verifyRecoveryCode({ email, code }) {
  const { error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token: code.trim(),
    type: 'recovery',
  });
  if (error) {
    return { kind: 'error', message: describeAuthError(error, 'That code didn’t work. Please try again.') };
  }
  return { kind: 'verified' };
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { kind: 'error', message: describeAuthError(error, "Couldn't change your password. Please try again.") };
  }
  return { kind: 'updated' };
}

// Signs out on this phone only (other devices stay signed in). Clears the
// stored session even if the server can't be reached.
export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    console.warn('CarpoolBoard: sign-out reported an error', error);
  }
}
