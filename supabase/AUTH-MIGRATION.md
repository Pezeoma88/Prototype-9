# Feature 3: Secure username/password authentication — runbook

Nothing in this runbook has been run yet. Each step under "Supabase" needs your approval first.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Sign up | App → `supabase.auth.signUp` | Creates the Supabase Auth user (email + bcrypt-hashed password). The `handle_new_auth_user` trigger creates the profile with **the same id** and the chosen username in the same transaction. |
| Email confirmation | Supabase email → 6-digit code typed into the app | Proves the person owns the email. No deep links needed. |
| Sign in | App → **`username-sign-in` Edge Function** | Looks up the private email for the username on the server, has Supabase Auth check the password, and returns **only session tokens**. The email never reaches the phone. |
| Session | `expo-secure-store` (Keychain), chunked | Keeps people signed in between launches. Auto-refreshes while the app is open. |
| Forgot password | Email → 6-digit code → new password | `resetPasswordForEmail` gives the same answer whether or not the email has an account. |
| Data access | RLS (`auth-2-lockdown.sql`) | Everything requires a signed-in user. Each user can only write their own rows. |

**Where passwords live:** only as bcrypt hashes in `auth.users`, managed by Supabase. Nothing in `public`, the app, or the Edge Function stores them.

**The service-role key:** only inside the Edge Function, where Supabase injects it automatically. The app only has the publishable key (`.env.local`). That key is safe to ship because of RLS.

## Order of operations

Steps 1–4 can happen while the current build is still in use. **Step 5 ends the old login**, so do it at the same time you start testing the new build.

### 1. Inspect (read-only)
Run each query in `auth-0-inspect.sql` in the SQL Editor and save the output. Send me:
- **A3/A4** (foreign key ON DELETE rules for rides/ride_requests). The cleanup plan depends on these.
- **B2** (current policies) and **B5** (`accept_ride_request` source).
- **C2/C3** (which profiles exist and how much data each has).

### 2. Database: `auth-1-accounts.sql` (additive; the old app keeps working)
SQL Editor → paste the whole file → Run. Then run its VERIFICATION queries.

### 3. Supabase Auth settings (Dashboard)

**Authentication → Sign In / Providers**
- Email provider: **Enabled**
- **Allow new users to sign up**: On
- **Confirm email**: **On**
- **Secure email change**: On
- **Minimum password length**: `8`
- **Password requirements**: "Letters and digits"
- **Leaked password protection** (Pro plan only): On, if available

**Authentication → Email Templates.** Replace the link with the code in two templates:

*Confirm signup*
```html
<h2>Confirm your CarpoolBoard account</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>If you didn't sign up for CarpoolBoard, you can ignore this email.</p>
```

*Reset Password*
```html
<h2>Reset your CarpoolBoard password</h2>
<p>Enter this code in the app to choose a new password:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>If you didn't ask for this, ignore this email. Your password won't change.</p>
```

**Authentication → Rate Limits.** The defaults are fine. Note that Supabase's built-in email sender only sends a few emails per hour. For class testing with several people, set up **Custom SMTP** (Authentication → Emails → SMTP Settings), or emails will stop arriving.

**Authentication → URL Configuration.** Nothing is needed. The app uses codes, not links.

### 4. Edge Function: `username-sign-in`
First run `auth-1b-sign-in-throttle.sql` (additive: one nullable `client_key` column on `sign_in_attempts`) and its verification queries. The function needs that column and returns a server error without it.

Using the Supabase CLI from the project folder:
```sh
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase functions deploy username-sign-in --no-verify-jwt
```
Or use the Dashboard: Edge Functions → Deploy a new function → name it `username-sign-in` → paste `functions/username-sign-in/index.ts` → **turn OFF "Verify JWT"** (callers are signed out) → Deploy.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically, so there are no secrets to set.

### 5. Database: `auth-2-lockdown.sql` (ends the old login)
Run it, then run its VERIFICATION queries. From this point the old build can't read or write. The new build works for signed-in users only.

### 6. Old account cleanup: `auth-3-legacy-cleanup.sql`
Run PART 1 (read-only) and review it together. PART 2 (archive) and PART 3 (Option A delete / Option B retire) stay commented out until you approve a specific list of profile ids.

## Test checklist (iPhone)
1. Sign up with a new username → email code arrives → enter it → onboarding opens.
2. Sign up again with the same username → "That username is taken".
3. Sign out → sign in with username + password → Home. Show/hide the password works.
4. Wrong password 5 times → "Too many attempts. Please wait and try again." The same username still works from a different network (e.g. cellular instead of Wi-Fi).
5. Force-quit the app and reopen → still signed in.
6. Forgot password → code → new password → signed in. The old password no longer works.
7. Driver: post, edit and cancel a ride. Accept and deny a request. Rider: request a seat, withdraw, leave a seat, and review after departure.
8. Change the profile photo (upload goes to your own folder).
9. Search/filter, past rides, map previews and Driver/Rider switching all work as before.

## Known limits and follow-ups
- `ride_requests.reason` is readable by any signed-in user (same as today). A follow-up could limit it to the rider and the driver.
- Changing an email isn't in the app yet. It would use `supabase.auth.updateUser({ email })`.
- `sign_in_attempts` grows over time. Prune rows older than 30 days occasionally.
- Sign-in throttle (see the function's header comment): 5 failures per username per client, 20 per username from all clients, 50 per client across usernames, all per 15 minutes. Reaching the 20-failure backstop still locks a username for everyone for 15 minutes; Forgot password still works then.
- Every sign-in reaches Supabase Auth from the Edge Function's servers, so Auth's per-IP sign-in limit is shared by all users. When it's hit, people see "Too many attempts" and it isn't counted against their username. Raise it under Authentication → Rate Limits if the class hits it.
