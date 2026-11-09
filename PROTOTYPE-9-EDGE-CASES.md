# Prototype 9 — Edge-Case Audit

**Audit date:** 2026-11-05 · **Commit audited:** `fd63fc5` (working tree clean) · **Deadline:** 2026-11-10

## How this audit was done

- **Code inspection.** I read App.js, every file in `lib/`, the ride, map, and request screens, and every SQL file in `supabase/`.
- **One automated run.** On 2026-11-05 I ran `npx jest --ci`: 1 suite, **5/5 tests passed** (TC-01 to TC-04, GPS pickup only).
- **No device, network, or database testing.** Nothing in this report was run on a phone, against Supabase, or under real network failure. Every "Observed" line says whether it comes from **code reading** or **a test that was run**.
- **No application code, policies, or data were changed.**

### Two caveats that affect several findings

1. **The live database may not match the repo.** [supabase/AUTH-MIGRATION.md](supabase/AUTH-MIGRATION.md) says "Nothing in this runbook has been run yet." The app, however, calls `submit_my_ride_request`, `accept_my_ride_request`, and the `username-sign-in` function, all of which come from that runbook. So the doc is probably out of date. Still, I could not confirm which SQL is live. Every "handled by the server" claim below assumes `auth-1-accounts.sql` and `auth-2-lockdown.sql` were applied as written.
2. **`accept_ride_request(uuid)` is not in the repo.** It was created in the Supabase dashboard ([auth-0-inspect.sql](supabase/auth-0-inspect.sql) query B5). Comments in the repo say it locks the ride `FOR UPDATE` and refuses full rides, but I could not read the function to confirm this. **It is the only thing that prevents overbooking.**

---

## Summary

| # | Edge case | Handled? | Severity | Fix before 11/10? |
|---|---|---|---|---|
| 1 | Simultaneous seat reservations | Partly (depends on unverified server function); one plausible race | **High** | Verify first. Fix only if B5 shows a gap |
| 2 | Duplicate ride requests | Yes | Low | No. Test only |
| 3 | Zero available seats | Yes in app; server side only partly verifiable | Medium | No, unless B5 shows a gap |
| 4 | Driver reserving own ride | Yes (4 layers) | Low | No |
| 5 | Ride cancelled during pending requests | Partly: data stays consistent, but riders aren't told | Medium | Optional (small warning in the dialog) |
| 6 | Internet failure during ride creation | Partly: a lost response can cause a duplicate ride | **Medium–High** | **Recommended** |
| 7 | Repeated taps on Post Ride | Yes (small theoretical gap) | Low | No |
| 8 | Expired authentication session | Partly | Medium | Optional |
| 9 | Unauthorized changes to others' rides | Yes, if RLS is live; minor server-side gaps | **Critical if RLS isn't live**, otherwise Low–Medium | Verify. No fix expected |
| 10 | GPS errors and late location results | Yes (4 automated tests passing) | Low | No |
| 11 | Map zoom limits / unavailable route data | Route: yes. Zoom: no limits | Low | No |

---

## 1. Simultaneous seat reservations

**1. What could go wrong**
- **(a) Overbooking the last seat.** Two Accepts land on a ride's last seat at the same moment, from the same driver on two phones or two quick taps, and both succeed.
- **(b) One rider confirmed on two rides.** Two *different* drivers accept the *same* rider's pending requests (one on each driver's ride) at the same moment.
- **(c) Seat edit racing an Accept.** The driver lowers a ride's seat count at the same moment one of its requests is accepted.

**2. Already handled?** Partly.
- *Requests* never take a seat. Only Accept does, so two riders requesting the last seat at once is fine by design: both stay Pending.
- **Same-phone double tap on Accept:** blocked by `isBoardActionRunningRef` in `runBoardAction`. The second tap is silently ignored.
- **(a) Cross-device:** depends entirely on `accept_ride_request` locking the ride row and re-counting accepted seats. Repo comments say it does, but the source isn't in the repo (see caveat 2). **Unverified.**
- **(b) Plausible gap (from code reading).** `accept_my_ride_request` accepts the request, then runs `UPDATE … SET status='cancelled' WHERE rider_id = … AND status='pending'`. If two transactions each accept a different request for the same rider, each one's "cancel the others" update waits on the other's row lock. Under Postgres READ COMMITTED it then re-checks `status='pending'`, finds the row now `accepted`, and skips it. Both commit, so the rider ends up confirmed on two rides. Nothing in `accept_my_ride_request` checks whether the rider already holds an accepted seat. Whether `accept_ride_request` checks this is unknown.
- **(c) Gap.** The edit flow counts accepted riders in one request and saves `seat_count` in a separate request. This is a time-of-check/time-of-use race. The repo SQL has no server-side rule that `seat_count >= accepted`.

**3. Files / functions**
- [App.js](App.js): `handleAcceptRequest` (~L1587), `runBoardAction` (~L573), `handleSaveDriver` edit branch (~L1074–1107)
- [supabase/auth-1-accounts.sql](supabase/auth-1-accounts.sql): `accept_my_ride_request` (~L495), `submit_my_ride_request` "full" check (~L342)
- `public.accept_ride_request(uuid)`: dashboard only, not in repo

**4. How to reproduce**
- **First, without changing anything:** run auth-0 query **B5** (read-only) in the SQL Editor. Check that the function has `SELECT … FROM rides … FOR UPDATE`, counts accepted requests after taking that lock, and checks `status = 'pending'`.
- **(a)** Use a test ride with 1 seat and two pending requests from two test riders. Sign the driver in on two phones, open Requests on both, and tap Accept on different requests as close together as possible.
- **(b)** Use test driver accounts D1 and D2, each with an upcoming ride, and rider R with a pending request on both. On two phones, D1 and D2 tap Accept at the same time. Repeat about 10 times, because the timing window is small.
- **(c)** Use a 2-seat ride with 1 accepted and 1 pending request. Phone A opens Edit and sets seats to 1. Phone B taps Accept on the pending request. Tap Save on A and Accept on B together.

**5. Expected vs observed**
- **Expected:** (a) exactly one Accept succeeds and the other shows "full". (b) one Accept succeeds and the other fails with "no longer pending". (c) the end state never has `accepted > seat_count`.
- **Observed: NOT TESTED.** Code reading shows (b) and (c) can produce a bad state. Whether (a) can depends on B5.

**6. Severity: High.** Overbooking and double-booking corrupt the core promise of the app. The timing window is narrow, though, and only exposed under real concurrency.

**7. Fix before deadline?** Verify (a) with B5 now; that is a read-only query. (b) and (c) need a database migration, which is outside this audit's limits. For the deadline, I'd **document them as known limitations** unless B5 shows that (a) is also unprotected. In that case it's a must-fix.

---

## 2. Duplicate ride requests

**1. What could go wrong.** A double tap, Try Again after a timeout, or a retry after a lost response creates two request rows for the same rider and ride.

**2. Already handled?** **Yes**, at several layers:
- `submissionAbortRef` makes the app ignore a second Confirm while one submission is in flight.
- `submit_my_ride_request` returns an existing row unchanged, and its `INSERT … ON CONFLICT (ride_id, rider_id) DO NOTHING` relies on the unique index `ride_requests_ride_rider_key`. `auth-1` refuses to run unless that index exists.
- After a timeout or lost response, the app checks the server three times (`confirmRideRequestOutcome`) instead of guessing.
- A denied or cancelled request is final and is never reopened, enforced both in the app (`handleBeginRequest`, `handleRequestRide`) and on the server.

**3. Files / functions:** [lib/rideRequests.js](lib/rideRequests.js) `submitRideRequest`, `confirmRideRequestOutcome` · [App.js](App.js) `runRequestSubmission`, `handleRetrySubmission` · [supabase/auth-1-accounts.sql](supabase/auth-1-accounts.sql) `submit_my_ride_request` · [supabase/prototype-6.sql](supabase/prototype-6.sql) unique index

**4. How to reproduce:** In a dev build, open the Demo Network panel ([components/DemoNetworkPanel.js](components/DemoNetworkPanel.js)) and choose **Lost response**. Request a ride, then tap Try Again two or three times. Separately, try **Delay AFTER server saved** and abandon during the hold.

**5. Expected vs observed**
- **Expected:** exactly one Pending row. The panel reports "arrived" or "existing", never a second request.
- **Observed: NOT TESTED** on device. Code reading supports the expected behavior.

**6. Severity: Low** (well defended).

**7. Fix before deadline?** No. Worth a quick manual test, because the demo panel makes it easy to show.

---

## 3. Zero available seats

**1. What could go wrong.** A rider requests a full ride, a driver accepts onto a full ride, or a ride is saved with 0 or a negative number of seats.

**2. Already handled?** Mostly.
- **The app** disables Request and Accept when `seats === 0` and labels them "Full" (RideDetailsScreen L71/145/313, RequestsScreen L329). `handleRequestRide` and `handleAcceptRequest` also check `driver.seats < 1`.
- **The server:** `submit_my_ride_request` refuses when `accepted >= seat_count`. Accept relies on `accept_ride_request` (unverified, see caveat 2).
- **Seat count range:** `handleSaveDriver` enforces `MIN_SEATS`–`MAX_SEATS` (1–7). The repo SQL has **no `CHECK` on `rides.seat_count`** (the `rides` table DDL isn't in the repo), so a direct API call might save 0 or −1. Unverified.
- `seats` is clamped with `Math.max(0, …)` in `buildDriversFromRows`, so the UI never shows negative seats even if data is bad.

**3. Files / functions:** [lib/board.js](lib/board.js) `buildDriversFromRows` · [lib/format.js](lib/format.js) `MIN_SEATS`/`MAX_SEATS` · [App.js](App.js) `handleSaveDriver`, `handleRequestRide`, `handleAcceptRequest` · [screens/RideDetailsScreen.js](screens/RideDetailsScreen.js) · [screens/RequestsScreen.js](screens/RequestsScreen.js)

**4. How to reproduce**
- *UI:* fill a 1-seat test ride by accepting one rider. As a second rider, open it: expect "Full". As the driver, look at another pending request: expect a disabled "Full".
- *Stale screen:* rider B opens the ride while it still has 1 seat. The driver accepts rider A. Without refreshing, B taps Confirm Request. Expect the server's message "This ride is full…".
- *Server range (read-only):* check A2 in `auth-0-inspect.sql` for a `seat_count` check constraint.

**5. Expected vs observed**
- **Expected:** no request or accept succeeds on a full ride, and no ride can have fewer than 1 seat.
- **Observed: NOT TESTED.** Code reading confirms the app-side and `submit_my_ride_request` checks.

**6. Severity: Medium** (low if B5 and A2 come back clean).

**7. Fix before deadline?** No. Only if A2 or B5 reveal a missing server check, and that would be a migration (out of scope here).

---

## 4. Drivers reserving their own rides

**1. What could go wrong.** A driver switches to Rider mode and requests a seat on their own ride, or accepts themselves.

**2. Already handled?** **Yes, at four layers:**
1. The Request button is hidden when `isOwnDetailsRide`, which is true in any mode. Rider mode shows "Switch to Driver to manage" instead.
2. `handleRequestRide` returns early if `driver.driverAccountId === riderId`.
3. `submit_my_ride_request` raises "You can't request a seat on your own ride." It uses `auth.uid()` and never a rider id supplied by the app.
4. The `ride_requests_no_self_request` trigger blocks the insert. This trigger is dashboard-only and not in the repo.

`handleAcceptRequest` also refuses a self-request.

**3. Files / functions:** [App.js](App.js) `handleRequestRide` (~L1258), `handleAcceptRequest` (~L1602), `isOwnDetailsRide` (~L1879) · [screens/RideDetailsScreen.js](screens/RideDetailsScreen.js) L78, L254 · [supabase/auth-1-accounts.sql](supabase/auth-1-accounts.sql) L319

**4. How to reproduce:** Post a ride, switch to Rider mode, and open it from Available Rides and from the Map. Look for any Request button.

**5. Expected vs observed.** **Expected:** no Request button, only "Switch to Driver to manage". **Observed: NOT TESTED** on device; code reading supports it.

**6. Severity: Low.** **7. Fix?** No.

---

## 5. Ride cancellations during pending requests

**1. What could go wrong.** A driver cancels a ride while riders have pending or confirmed requests, or while a rider is in the middle of sending one.

**2. Already handled?** Partly. The **data stays consistent**; the **people aren't told**.
- **What works:** cancelling **deletes** the ride, and its `ride_requests` are removed by `ON DELETE CASCADE`.
  - A request sent after the delete gets the server message "This ride is no longer available…".
  - An Accept on a deleted request gets "This request no longer exists".
  - The Map route view and Ride Details close themselves when the ride disappears from `drivers`.
- **Gaps (code reading):**
  - **Riders are never notified.** A pending or *confirmed* request just vanishes from their Requests tab on the next reload, with no message and no history.
  - **The driver isn't warned about confirmed riders.** The confirm dialog says only "This removes your ride to X and can't be undone". It doesn't mention that N confirmed riders will lose their seats.
  - **A rider viewing Ride Details gets no explanation.** When the next reload removes the ride, the screen silently drops back to the board. The "ride is no longer available" outcome panel never shows, because `detailsSubmission` requires `detailsDriver` to exist.
  - **The server allows deleting departed rides.** The app blocks it (`isRideDeparted`), but the RLS delete policy has no time check. A direct API call could delete a departed ride and its request history. Reviews survive (`ride_id ON DELETE SET NULL`).

**3. Files / functions:** [App.js](App.js) `handleCancelRide` (~L1178), `detailsSubmission` (~L1918) · [supabase/auth-2-lockdown.sql](supabase/auth-2-lockdown.sql) "drivers cancel own rides" · [supabase/prototype-6-reviews.sql](supabase/prototype-6-reviews.sql) L201

**4. How to reproduce:** Use test driver D and test riders R1 (pending) and R2 (accepted) on one test ride. R1 stays on Ride Details for that ride. D cancels the ride. R1 pulls to refresh, and R2 opens the Requests tab.

**5. Expected vs observed**
- **Expected (ideal):** D is warned "2 riders will lose their request/seat", and R1 and R2 see a message that the ride was cancelled.
- **Observed: NOT TESTED.** Code reading predicts that D sees the generic warning, R1's screen returns to the board with no message, and R2's confirmed seat disappears with no message.

**6. Severity: Medium** (a UX and trust issue, not data corruption).

**7. Fix before deadline?** Optional. A small, safe improvement is to include the confirmed and pending counts in the `Alert` in `handleCancelRide` (app-only). Real notifications are post-deadline work.

---

## 6. Internet failures during ride creation

**1. What could go wrong.** The connection drops while Post Ride is in flight. The worst case is that the insert **reached the server** but the response was lost.

**2. Already handled?** Partly.
- **What works:**
  - The form keeps every value on error and shows "Couldn't post your ride. Check your connection and try again."
  - The Supabase client **never auto-retries POST/insert** (I confirmed this in `@supabase/postgrest-js` 2.117.2: `RETRYABLE_METHODS` covers only GET/HEAD/OPTIONS), so the client never creates a duplicate by itself.
  - A successful post turns the form into Edit mode for the saved row, so "Edit ride details" can't create a duplicate.
- **Gaps (code reading):**
  - **A lost response leads to a duplicate ride.** The app treats it as a failure, the driver taps Post Ride again, and a **second identical ride** is inserted. There's no idempotency key and no "check what the server has" step. The ride-request flow has exactly that step; the ride-creation flow doesn't.
  - **No timeout on the insert.** There's no `abortSignal`, so on a stalled connection the button can spin until the OS network timeout (often ~60 s on iOS, not verified) with no way to cancel. The Cancel button still works, but whether the ride was saved is then unknown.
  - **The edit path has the same pattern.** A lost response on Save Changes is harmless (an update is idempotent), but it shows a misleading error.

**3. Files / functions:** [App.js](App.js) `handleSaveDriver` (~L1001–1158), insert at ~L1109

**4. How to reproduce:** The Demo Network panel only affects `submit_my_ride_request`, so it **can't** simulate this. Use one of these instead:
- **iOS Network Link Conditioner** (Developer settings) with a "100% Loss" profile switched on right *after* tapping Post Ride. Timing is awkward.
- **A proxy** (Charles or Proxyman) with a breakpoint on `POST /rest/v1/rides` that lets the request through and then drops the response.
- **Simplest:** turn on Airplane Mode *before* tapping Post Ride. This only tests the "request never left" branch.

Then turn the network back on, tap Post Ride again, and count the rides on the board.

**5. Expected vs observed**
- **Expected:** exactly one ride, and the app reports success or "already saved".
- **Observed: NOT TESTED.** Code reading predicts that in the lost-response case the board shows **two identical rides** after the retry.

**6. Severity: Medium–High.** Duplicate listings confuse riders and can split requests across two copies of one ride. The driver can cancel the extra one, so nothing is permanently lost.

**7. Fix before deadline?** **Recommended.** This is app-only, needs no dependency, and is about 20 lines:
- Before showing the error, query `rides` for this driver with the same `departure_at` and `destination` created in the last couple of minutes, and treat a match as success.
- Or generate the ride `id` on the client once per form session and treat a unique-violation (`23505`) on retry as success.
- Add an `abortSignal` timeout either way.

---

## 7. Repeated taps on Post Ride

**1. What could go wrong.** A fast double tap sends two inserts.

**2. Already handled?** **Yes, with a small theoretical gap.**
- `handleSaveDriver` returns early if `isSubmittingDriver`, and `AppButton` is disabled while `loading={isSubmittingDriver}`.
- The guard is **React state**, not a ref (unlike `isBoardActionRunningRef` and `submissionAbortRef`). If two press events were handled before React re-rendered, both would read `false`. With React 19's synchronous handling of tap events this is unlikely, but the code doesn't rule it out. Not verified.
- After success, the form edits the saved row, so tapping Post or Save again updates instead of inserting.

**3. Files / functions:** [App.js](App.js) `handleSaveDriver` L1003, `isSubmittingDriver` (~L227) · [screens/RideForm.js](screens/RideForm.js) `handleSave`, AppButton L494 · [components/AppButton.js](components/AppButton.js)

**4. How to reproduce:** Fill a valid ride and tap Post Ride as fast as possible 3–5 times (two fingers helps). Pair this with a slow network (Network Link Conditioner "3G") so the window stays open longer.

**5. Expected vs observed.** **Expected:** one ride. **Observed: NOT TESTED.**

**6. Severity: Low.** **7. Fix?** No. If convenient, mirror the ref-based guard used elsewhere (a one-line pattern).

---

## 8. Expired authentication sessions

**1. What could go wrong.** The access token expires, or the refresh token is revoked, while the app is open, in the background, or mid-action.

**2. Already handled?** Partly.
- **What works:**
  - `autoRefreshToken: true`. Refresh pauses in the background and restarts on foreground (`AppState` listener in [lib/supabase.js](lib/supabase.js)).
  - supabase-js refreshes an expired token before a request when it can.
  - `onAuthStateChange` turns a failed or revoked session into `authUser = null`, and `clearSignedInState` resets per-user state and drops any in-flight request submission.
  - Every server function uses `auth.uid()` and refuses with "Please sign in again…" when it is null.
- **Gaps (code reading):**
  - **Unsaved work is wiped silently.** `clearSignedInState` calls `resetForm()` and `resetProfileForm()`, so a half-filled ride or profile form is lost. The sign-in screen gives no reason: `authNotice` is only set for a missing profile.
  - **Misleading error messages.** If the refresh fails because the phone is offline, the session stays but requests fail with 401. Most handlers then show "Check your connection…", which happens to be correct offline, but would mislead for a real auth failure (e.g. a revoked session while online).
  - **The 30-second clock reload runs when the app returns to the foreground.** If it runs before the token refresh finishes it may fail and show "Couldn't load rides…" until the next pull. Whether this happens wasn't verified; supabase-js usually refreshes first.

**3. Files / functions:** [lib/supabase.js](lib/supabase.js) · [lib/auth.js](lib/auth.js) `describeAuthError` · [App.js](App.js) `onAuthStateChange` effect (~L481), `clearSignedInState` (~L597), `loadBoard` · [lib/useNow.js](lib/useNow.js)

**4. How to reproduce**
- *Revoked session:* sign in on phone A and start filling the Offer a Ride form. In the Supabase dashboard → Authentication → Users, **sign out that user's sessions**. (This is a session action, not a data change, but do it on a test account.) Bring A to the foreground and tap Post Ride.
- *Expired token while backgrounded:* temporarily set the project's JWT expiry very low (dashboard setting). Background the app longer than that, then return.

**5. Expected vs observed**
- **Expected:** the user is told their session ended and, ideally, the form is kept.
- **Observed: NOT TESTED.** Code reading predicts a return to the sign-in screen with no explanation and the form cleared.

**6. Severity: Medium.**

**7. Fix before deadline?** Optional. The cheap app-only improvement is to set an `authNotice` ("Your session ended. Please sign in again.") when the auth listener sees a sign-out the user didn't start.

---

## 9. Unauthorized changes to other users' rides

**1. What could go wrong.** A signed-in user edits, deletes, or answers requests for someone else's ride, accepts their own request directly, or changes another person's profile, by calling the API directly with the public key and their own token.

**2. Already handled?** **Yes, as written in the repo**, by RLS plus column grants ([supabase/auth-2-lockdown.sql](supabase/auth-2-lockdown.sql)):

| Table | Allowed |
|---|---|
| `rides` | Insert, update, and delete only where `driver_id = auth.uid()`. The update policy's `WITH CHECK` stops reassigning `driver_id`. |
| `ride_requests` | No direct insert. Only `status` can be updated. A rider can only move their own pending/accepted request to `cancelled`. A driver can only move a pending request on their own ride to `denied`. |

I checked the permissive policies combined (they are OR'd) and found no combination that lets a rider self-accept or a driver touch accepted rows.
- **`profiles`:** a user can update only their own row, and only `name`, `bio`, `vehicle_make_model`, and `avatar_path` (which must be in their own folder).
- **Accept** goes through `accept_my_ride_request`, which checks the caller is the driver.
- The **retired** functions that trusted a rider id supplied by the app are revoked.
- The app adds its own checks too: every edit and delete adds `.eq('driver_id', currentUser.id)`, and every handler checks ownership.

**Gaps (code reading; none lets anyone touch *another* user's ride):**
- Whether these policies are **live** is unverified (caveat 1). If `auth-2` was not applied, this becomes **Critical**.
- **Departed rides can still be changed through the API.** A driver can delete them or change fields other than departure time. The app blocks both; the server doesn't.
- **`seat_count` isn't checked against confirmed riders on the server** (see #1c and #3).
- **A rider's `reason` text is readable by every signed-in user.** This is documented as a follow-up in auth-2; it is a privacy issue, not unauthorized modification.

**3. Files / functions:** [supabase/auth-2-lockdown.sql](supabase/auth-2-lockdown.sql) §3–5 · [supabase/auth-1-accounts.sql](supabase/auth-1-accounts.sql) §5 · [App.js](App.js) `handleSaveDriver`, `handleCancelRide`, `handleDenyRequest`, `handleAcceptRequest`

**4. How to reproduce** (two **test** accounts only. Each call should be *refused*, so no data changes if RLS works):
- **Read-only check first:** run `auth-0` B2, or `select * from pg_policies where schemaname='public'`, and compare with auth-2.
- As test user B, with a small supabase-js script or the REST API using B's access token, against test user A's test ride `X`:
  - `update rides set seat_count=7 where id=X` → expect **0 rows** returned
  - `delete from rides where id=X` → expect **0 rows**
  - `update ride_requests set status='accepted' where id=<B's own pending request>` → expect an RLS error or 0 rows
  - `insert into ride_requests …` → expect **permission denied**
  - `update profiles set name='x' where id=A` → expect **0 rows**

**5. Expected vs observed.** **Expected:** all refused. **Observed: NOT TESTED.**

**6. Severity: Critical if RLS isn't live; otherwise Low–Medium** for the server-side gaps.

**7. Fix before deadline?** Nothing to fix if the policies are live. **Verify** they are; this is the highest-value security check. Also update `AUTH-MIGRATION.md` so it no longer says nothing has been run, if that's out of date.

---

## 10. GPS errors and late location results

**1. What could go wrong**
- Permission is denied, Location Services are off, there's no fix (indoors), or the phone is far from campus.
- A slow GPS answer overwrites a spot the driver picked by hand, lands in a different ride's form, or changes the pickup after Post Ride is tapped.

**2. Already handled?** **Yes.**
- `locateNearestPickup` returns a distinct result for each failure: `servicesOff`, `denied` (+`canAskAgain`), `timedOut` (15 s), `error`, and `tooFar` (>1.5 km). Each gets its own message with Try Again and/or Open Settings.
- Coordinates are validated (`isValidCoordinate`), and a cached fix is used only if it is under 2 minutes old and accurate to 200 m.
- **Late results:** `locateRequest` is a counter ref that is bumped by a manual pick, by Post/Save (`handleSave` calls `cancelLocating()`), and by unmount. A stale answer is dropped.
- Post Ride and Use My Location disable each other while running.
- **Automated evidence (run on 2026-11-05, 5/5 passed):**
  - TC-01: nearest landmark
  - TC-02A/B: denied, with and without "ask again"
  - TC-03: a late GPS answer can't replace a manual choice
  - TC-04: too far keeps the existing pickup
- **Small gaps:**
  - `timedOut`, `servicesOff`, and `error` have **no automated tests**.
  - The timeout doesn't cancel the native location request, which keeps running in the background. That's harmless because its result is discarded.
  - The worst-case wait is about 17 s (2 s for the cached read plus 15 s for a fresh fix).

**3. Files / functions:** [lib/currentLocation.js](lib/currentLocation.js) `locateNearestPickup`, `withTimeout` · [lib/nearestPickup.js](lib/nearestPickup.js) · [screens/RideForm.js](screens/RideForm.js) `handleUseMyLocation`, `cancelLocating`, `handleSave`, unmount effect · [__tests__/pickup-selection-test.js](__tests__/pickup-selection-test.js)

**4. How to reproduce:** Run `npm test`. On a device, check each of these:
- deny permission
- turn Location Services off
- simulate a far location (Xcode › Debug › Simulate Location, or Android emulator extended controls)
- tap Use My Location, then pick a spot by hand before it answers
- tap Use My Location, then tap Post Ride immediately

**5. Expected vs observed**
- **Expected:** a clear message for each case, and a manual choice or saved ride never changed by a late fix.
- **Observed: TESTED (automated)** for TC-01 to TC-04, all passing. **NOT TESTED** on device, and the timeout, services-off, and error branches are untested.

**6. Severity: Low.** **7. Fix?** No. Optionally add Jest cases for `timedOut`, `servicesOff`, and `error`; the mocks already exist in the test file.

---

## 11. Map zoom limits and unavailable route data

**1. What could go wrong**
- The user zooms or pans far away and can't find the pins again.
- A route view zooms in extremely tight or fails to frame both points.
- The routing server (public OSRM demo) is down, slow, returns no route, or returns bad data.
- The phone is offline, so map tiles don't load.

**2. Already handled?**
- **Routes: yes.**
  - `fetchDrivingRoute` has an 8-second timeout and an abort signal. It rejects on a non-OK HTTP status, `code !== 'Ok'`, fewer than 2 points, or non-finite numbers.
  - MapScreen then draws a **dashed straight line clearly labeled "not driving directions"**, with Try Again.
  - Stale answers are dropped (an `isCurrent` flag plus abort on change or unmount).
  - Rides with no destination point, or with the same pickup and destination, show an explanation instead of a View Route button.
  - If a ride is cancelled while its route is showing, the route view closes.
- **Zoom: not limited.** `MapView` sets no `minZoomLevel`/`maxZoomLevel` and there's no Re-center button while browsing; the region is reset only by Close Route or by leaving and returning to the tab, which remounts the map. Very short routes (e.g. Hughes-Trigg → Fondren Library, roughly 110 m) will make `fitToCoordinates` zoom in very far. Offline map tiles aren't handled; that's platform behavior.
- **Ride Details preview:** gestures are off, so zoom can't break it. Invalid coordinates render nothing.

**3. Files / functions:** [lib/routing.js](lib/routing.js) `fetchDrivingRoute` · [screens/MapScreen.js](screens/MapScreen.js) route effect (~L106), `fitMapTo`, `handleCloseRoute` · [components/PickupMapPreview.js](components/PickupMapPreview.js) · [lib/pickupLocations.js](lib/pickupLocations.js) `SMU_MAP_REGION`

**4. How to reproduce**
- **Route unavailable:** open View Route with Airplane Mode on. Then turn the network back on and tap Try Again.
- **Zoom:** pinch out to continent level, pan to another city, and look for a way back.
- **Short route:** post a test ride from Hughes-Trigg to Fondren Library and open View Route.

**5. Expected vs observed**
- **Expected:** a labeled dashed fallback and a working Try Again; an easy way back to campus; a readable framing for short routes.
- **Observed: NOT TESTED.** Code reading supports the route fallback and confirms there are no zoom limits or Re-center control.

**6. Severity: Low.**

**7. Fix?** No. If time allows, add a "Re-center" button calling `animateToRegion(SMU_MAP_REGION)`, and/or a `maxZoomLevel` (iOS and Android both support it).

---

## Other observations (minor)

- **Stale comment.** [lib/rideStatus.js](lib/rideStatus.js) says "The database does not refuse requests for departed rides yet", but `submit_my_ride_request` and `accept_my_ride_request` in auth-1 do refuse them.
- **Out-of-date runbook status.** [supabase/AUTH-MIGRATION.md](supabase/AUTH-MIGRATION.md)'s "Nothing … has been run yet" appears to be out of date (see caveat 1).
- **Silently ignored taps.** A second tap during `runBoardAction` (Accept, Deny, Cancel) is dropped with no feedback. It's harmless, but the buttons don't show a loading state.

---

## Recommended next three tests

1. **Overbooking: confirm the server lock, then race it (#1).**
   - Run auth-0 **B5** (read-only) to see the real `accept_ride_request`.
   - Then do the two-phone last-seat Accept test, and the two-driver same-rider test (#1b).
   - This is the edge case most likely to corrupt core data, and today it rests on code nobody has read.
2. **Unauthorized changes via the API with a second test account (#9).**
   - Check `pg_policies` against auth-2, then run the five refused-call checks.
   - If RLS isn't live as written, every other protection is cosmetic.
3. **Lost response during Post Ride (#6).**
   - Use a proxy or Network Link Conditioner, retry, and count the rides.
   - This is the most likely real-world bug found in this audit, and the one most worth fixing before November 10 because the fix is app-only and small.
