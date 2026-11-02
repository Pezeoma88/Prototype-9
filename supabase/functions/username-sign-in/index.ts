// CarpoolBoard — username-sign-in Edge Function (Feature 3)
//
// Signs a user in with USERNAME + password without ever sending their
// email address to the phone.
//
// Supabase Auth only signs in by email (or phone), and emails are private:
// they live in auth.users, which the app can't read. So this function,
// running on Supabase's servers:
//   1. looks the username up in profiles (service role),
//   2. reads that user's email from Supabase Auth (service role),
//   3. asks Supabase Auth to check the password (a normal password
//      sign-in with the public key — Supabase compares it to the bcrypt
//      hash; nothing here sees or stores a hash),
//   4. returns only the resulting session tokens.
// The app then calls supabase.auth.setSession() with them.
//
// Unknown username and wrong password get the SAME answer, so the
// response never says which usernames exist with which passwords.
//
// Throttle (sign_in_attempts table, failures in the last WINDOW_MINUTES):
//   * MAX_FAILURES_PER_CLIENT_USERNAME for one username from one client:
//     that client waits. This is the limit a guesser normally hits, and it
//     doesn't lock the real owner out from their own phone.
//   * MAX_FAILURES_PER_USERNAME for one username from all clients:
//     everyone waits. A backstop against guessing from many clients;
//     reaching it takes 4x more attempts than the old single limit.
//   * MAX_FAILURES_PER_CLIENT across all usernames: that client waits.
//     Slows one password tried against many usernames. Set high because a
//     whole class can share one campus IP.
// A "client" is the caller's IP, stored only as an HMAC (see clientKeyFor).
// When the IP is unavailable only the per-username backstop applies.
// Supabase Auth's own rate limit is passed on as "too many attempts" and
// is NOT counted as a wrong password. Every 429 has the same message.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// are provided to every Edge Function by Supabase automatically. The
// service-role key exists ONLY here, never in the mobile app.
//
// Needs: auth-1-accounts.sql and auth-1b-sign-in-throttle.sql.
// Deploy with JWT verification OFF (people calling this are signed out):
//   supabase functions deploy username-sign-in --no-verify-jwt

// Pinned to the same version as the app, so a new release can't change
// this function's behaviour without a redeploy.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const MAX_PASSWORD_LENGTH = 72; // bcrypt only uses the first 72 bytes
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_CLIENT_USERNAME = 5;
const MAX_FAILURES_PER_USERNAME = 20;
const MAX_FAILURES_PER_CLIENT = 50;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const invalidCredentials = () =>
  reply(401, { error: 'invalid_credentials', message: 'Incorrect username or password.' });

const tooManyAttempts = () =>
  reply(429, { error: 'too_many_attempts', message: 'Too many attempts. Please wait and try again.' });

const serverError = () => reply(500, { error: 'server_error' });

// The caller's IP as an HMAC-SHA256 keyed with the service-role key, so
// sign_in_attempts never holds a raw IP. Supabase's gateway puts the
// caller's IP first in x-forwarded-for. A caller who forges that header
// only escapes the per-client limits; the per-username backstop still
// applies. Returns null when there's no IP.
async function clientKeyFor(req: Request): Promise<string | null> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SERVICE_ROLE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(ip)));
  return Array.from(mac.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  // Missing keys (e.g. legacy API keys disabled in the project) must fail
  // loudly, not as a confusing "Incorrect username or password".
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error('username-sign-in: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not set');
    return serverError();
  }
  if (req.method !== 'POST') {
    return reply(405, { error: 'method_not_allowed' });
  }

  let username = '';
  let password = '';
  try {
    const body = await req.json();
    username = String(body?.username ?? '').trim().toLowerCase();
    password = String(body?.password ?? '');
  } catch {
    return reply(400, { error: 'bad_request', message: 'Enter your username and password.' });
  }
  if (!USERNAME_PATTERN.test(username) || password === '' || password.length > MAX_PASSWORD_LENGTH) {
    return invalidCredentials();
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const clientKey = await clientKeyFor(req);

  // Throttle: count recent failures. Counted the same way whether or not
  // the username exists, so a 429 doesn't reveal that either.
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const recentFailures = () =>
    admin
      .from('sign_in_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('succeeded', false)
      .gte('created_at', since);
  const [byUsername, byClientUsername, byClient] = await Promise.all([
    recentFailures().eq('username', username),
    clientKey ? recentFailures().eq('username', username).eq('client_key', clientKey) : null,
    clientKey ? recentFailures().eq('client_key', clientKey) : null,
  ]);
  const countError = byUsername.error || byClientUsername?.error || byClient?.error;
  if (countError) {
    console.error('sign_in_attempts count failed', countError);
    return serverError();
  }
  if (
    (byUsername.count ?? 0) >= MAX_FAILURES_PER_USERNAME ||
    (byClientUsername?.count ?? 0) >= MAX_FAILURES_PER_CLIENT_USERNAME ||
    (byClient?.count ?? 0) >= MAX_FAILURES_PER_CLIENT
  ) {
    return tooManyAttempts();
  }

  const recordAttempt = (succeeded: boolean) =>
    admin
      .from('sign_in_attempts')
      .insert({ username, succeeded, client_key: clientKey })
      .then(({ error }) => {
        if (error) console.error('sign_in_attempts insert failed', error);
      });

  // 1. username -> profile id (= auth user id)
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (profileError) {
    console.error('profile lookup failed', profileError);
    return serverError();
  }
  if (!profile) {
    await recordAttempt(false);
    return invalidCredentials();
  }

  // 2. auth user id -> private email
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
  if (userError && (userError.status === undefined || userError.status === 0 || userError.status >= 500)) {
    console.error('auth user lookup failed', userError);
    return serverError();
  }
  const email = userData?.user?.email;
  if (!email) {
    await recordAttempt(false);
    return invalidCredentials();
  }

  // 3. Supabase Auth checks the password.
  const publicClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await publicClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    // Supabase Auth's own rate limit. Every sign-in reaches Auth from this
    // function's servers, so this can hit innocent users: not their fault,
    // so it doesn't count towards their username's limit.
    if (signInError.status === 429 || signInError.code === 'over_request_rate_limit') {
      console.warn('Supabase Auth rate limit reached');
      return tooManyAttempts();
    }
    // Supabase only reports an unconfirmed email AFTER the password
    // matched, so it's safe to hand the email back here: the caller has
    // proven they own the account, and the app needs the address to
    // resend the confirmation code.
    if (signInError.code === 'email_not_confirmed') {
      await recordAttempt(true);
      return reply(403, {
        error: 'email_not_confirmed',
        message: 'Please confirm your email address first.',
        email,
      });
    }
    // Auth unreachable or failing: not a wrong password either.
    if (signInError.status === undefined || signInError.status === 0 || signInError.status >= 500) {
      console.error('password sign-in failed', signInError);
      return serverError();
    }
    await recordAttempt(false);
    return invalidCredentials();
  }
  if (!signIn.session) {
    console.error('password sign-in returned no session');
    return serverError();
  }

  await recordAttempt(true);
  return reply(200, {
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
  });
});
