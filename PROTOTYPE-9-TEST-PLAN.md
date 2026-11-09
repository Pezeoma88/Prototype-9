# CarpoolBoard Prototype 9: Test Plan

**Behavior under test:** choosing a ride's pickup spot, either with GPS ("Use My Location") or by hand.

**Why this behavior is essential:** a driver cannot post a ride without a pickup spot, and riders use that spot to find the ride. A wrong or unexpectedly changed pickup can send people to the wrong place.

**Status:** official automated baseline run complete: 5 of 5 tests passed on November 4, 2026, at commit `0008c88`, which contains the committed tests. The official after-Step-2 automated run is also complete: 16 of 16 tests passed on November 7, 2026, at commit `71dfcd2` (the 5 original GPS tests plus 11 new Step 2 tests). The Step 2 manual checks MZ-1 to MZ-4 also passed (user-observed on a physical iPhone 11 with iOS 26, in Expo Go, November 7, 2026). Six additional GPS manual checks (GPS-1 to GPS-6, user-observed on the same iPhone) also passed. They are **not** the manual checks defined in the test cases. Of those, the TC-02 A manual check also passed on the same iPhone. The TC-01 and TC-04 Simulator manual checks are still Not Run. See [Additional GPS manual checks](#additional-gps-manual-checks-user-observed) and [Run log](#run-log).

**Step 2 (map zoom controls):** test cases and expected results recorded on November 7, 2026, **before** any Step 2 code was written. See [Step 2 test cases](#step-2-test-cases-map-zoom-controls). Step 2 was then implemented in commit `71dfcd2`. All automated Step 2 tests passed there. The manual checks MZ-1 to MZ-4 passed when checked by hand on a physical iPhone 11 (iOS 26, Expo Go) on November 7, 2026, against app code `71dfcd2`. These are user-observed results, not automated tests.

**Private driver/rider messaging:** test cases and expected results recorded on November 8, 2026, on branch `feature/ride-messaging`, **before** any messaging app code was written (Messaging Step 1). 119 new automated tests in 3 files. Before implementation: 10 pass, 10 fail, and 99 can't run because their files import messaging code that doesn't exist yet. Every failure is expected. **Messaging Step 3 (data layer):** `lib/messaging.js` was implemented and `expo-crypto` 58.0.7 installed. All 74 data-layer tests pass, including one added in Step 3 (see M-2), and the 16 earlier tests still pass. See [Run log](#run-log). **Messaging Step 4 (conversation screen):** `screens/ConversationScreen.js` was built as an isolated screen and is not yet connected to `App.js`. All 26 conversation-screen tests pass after two test-timing corrections (see T-2). One app bug was found and fixed outside the suite (see A-2). The 16 earlier tests still pass. See [Messaging test cases](#messaging-test-cases-private-driverrider-messaging).

| Deadline | Requirement |
| --- | --- |
| Thursday, November 5 | Record the test cases in the repository and discuss them in lab |
| Tuesday, November 10 | Run the tests, compare results, make a feature change or refactor, rerun the tests, and identify the commits tested |

## Baseline version

| Item | Value |
| --- | --- |
| Baseline commit | `2e175db9649ff0996d7650ad033ec38f1dc268d4` (short: `2e175db`) |
| Commit message | Prototype 9 Step 1 - Improve GPS and manual pickup |
| Branch | `main`, matching `origin/main` when this plan was written |
| Installed versions | Expo 58.0.17, expo-location 58.0.18, React Native 0.88.0, React 19.3.0 |

`2e175db` identifies the **app code** being tested. Committing this plan and the test scripts will create newer commits, so each test run must record the commit actually checked out. See [Run log](#run-log).

## Versions compared

| Version | Commit | What it contains |
| --- | --- | --- |
| Before Step 2 (official baseline run) | `0008c882df703c53caf1d291d4f0e733aaa22366` (short: `0008c88`) | App code identical to `2e175db`, plus the committed GPS tests |
| Step 2 expectations recorded | `dccdc7cdd0c9335089527a95bc08fda55efe9c17` (short: `dccdc7c`) | This plan's Step 2 test cases, committed before any Step 2 code |
| After Step 2 (official rerun) | `71dfcd275fa0454f2b14a89d2221186f347a9a6c` (short: `71dfcd2`) | Map zoom controls (`screens/MapScreen.js`, new `lib/mapZoom.js`) and the new tests (`__tests__/map-zoom-test.js`) |

## How pickup selection works now

### Using GPS

When the driver taps **Use My Location**, `handleUseMyLocation` in `screens/RideForm.js` shows "Finding nearest landmark…", clears any old message, and calls `locateNearestPickup` in `lib/currentLocation.js`. That function works through these steps:

1. **Are Location Services on?** If not, it returns `{ servicesOff: true }`.
2. **Is location permission granted?** If not, it returns `{ denied: true, canAskAgain }`. It does not try to read the location.
3. **Is there a recent position?** It uses the phone's last known position if that position is no more than 2 minutes old and accurate to 200 m. This read is limited to 2 seconds.
4. **If not, get a new position.** It requests a Balanced-accuracy fix and gives up after 15 seconds, returning `{ timedOut: true }`.
5. **Find the nearest landmark.** `findNearestPickup` in `lib/nearestPickup.js` compares the position with the 9 SMU landmarks. If the nearest is within 1,500 m, it returns that landmark. Otherwise it returns `{ tooFar: true }`.

Any other failure, or an invalid position, returns `{ error: true }`.

### What the form does with each result

| Result | Pickup | Tone | Message starts with | Buttons |
| --- | --- | --- | --- | --- |
| Landmark found | **Changes to the landmark** | Info | "Pickup set to …" | None |
| Permission denied, can ask again | Unchanged | Warning | "Location access wasn’t allowed." | Try Again |
| Permission denied, cannot ask again | Unchanged | Warning | "Location access is off for this app." | Try Again, Open Settings |
| Location Services off | Unchanged | Warning | "Location Services are off…" (iOS) or "Location is off…" (Android) | Try Again; Android also has Open Settings |
| Too far from SMU | Unchanged | Warning | "You’re more than about 1.5 km…" | None |
| Timed out | Unchanged | Warning | "Finding your location took too long…" | Try Again |
| Other error | Unchanged | Warning | "We couldn’t get your location." | Try Again |

Every warning also tells the driver what happens next: "Your pickup is still [name], or you can choose another spot below." If no pickup is selected, it says "You can choose a pickup spot below."

### Choosing by hand

Tapping a landmark chip or **None** calls `handlePickPickup`. It sets the pickup immediately, clears the location message, and cancels any running lookup.

### How a running lookup gets cancelled

Each lookup receives a number from the `locateRequest` counter. Choosing by hand, saving, or leaving the form increases that counter. When a lookup finishes, the form compares its number with the current counter. If they differ, the result is ignored.

This does not stop the phone's GPS request. It only guarantees that a late answer cannot change the form.

### Privacy

The phone's coordinates stay inside `locateNearestPickup`. The form receives only the landmark's own name and coordinates.

## Test cases

The coordinates below were checked with a separate haversine calculation written outside the app, so the expected results do not come from running the code under test.

### TC-01: Successful GPS pickup selection near SMU

| Field | Details |
| --- | --- |
| **Purpose** | Confirm that a valid position near SMU selects the nearest landmark. |
| **Starting conditions** | Offer a Ride form is open. No pickup is selected. Location Services are on and permission is granted. No recent position is available. |
| **Action/input** | Tap **Use My Location**. The new position is `32.8446, -96.7836`. |
| **Expected result** | The pickup becomes **Fondren Library** with the coordinates `32.84454, -96.78343`. Its chip is selected. The info message reads: "Pickup set to Fondren Library, the closest SMU landmark to you. You can change it below." The button returns to "Use My Location". No Try Again or Open Settings button appears. |
| **Why this is correct** | Fondren Library is about 17 m away. The next closest landmark, Hughes-Trigg, is about 121 m away, and both are within the 1,500 m limit. The form must store the landmark's coordinates, not the phone's, to meet the privacy rule. |
| **Test method** | Automated component test with a fake GPS answer. Repeat manually in the iOS Simulator using a custom location. |
| **Actual result** | Baseline (automated): Fondren Library was selected with the landmark's coordinates. The expected message, info tone, and button text appeared, with no Try Again or Open Settings button. Manual check: Not Run. After Step 2 (automated, `71dfcd2`): same result as the baseline. |
| **Pass/fail status** | Baseline (automated): Pass. Manual check: Not Run. After Step 2 (automated, `71dfcd2`): Pass. |

### TC-02: GPS permission denied while a pickup is selected

| Field | Details |
| --- | --- |
| **Purpose** | Confirm that refusing location access does not change or remove a pickup the driver already chose. |
| **Starting conditions** | Form is open. **Hughes-Trigg Student Center** is selected. Location Services are on. Location permission is denied. |
| **Action/input** | Tap **Use My Location**. Check two versions of the denial: **A**, `canAskAgain: false`, and **B**, `canAskAgain: true`. |
| **Expected result** | **Both versions:** the pickup stays Hughes-Trigg Student Center, the message is a warning, the button returns to "Use My Location", and the app does not try to read a position.<br><br>**A:** "Location access is off for this app. Turn it on in Settings, then try again. Your pickup is still Hughes-Trigg Student Center, or you can choose another spot below." Shows Try Again and Open Settings.<br><br>**B:** "Location access wasn’t allowed. Your pickup is still Hughes-Trigg Student Center, or you can choose another spot below." Shows Try Again only. |
| **Why this is correct** | A failed GPS attempt says nothing about whether the driver's earlier choice is wrong, so that choice must remain. The app also must not read a location without permission. Open Settings appears only when the app can no longer ask for permission itself. |
| **Test method** | Automated component test for A and B. Repeat A manually on an iPhone by setting the app's location permission to Never. Expo's iOS code reports `canAskAgain: false` for a denied permission, so B is expected to need the automated test or Android. |
| **Actual result** | Baseline (automated): in A and B, Hughes-Trigg stayed selected, the expected warning appeared, the button returned to "Use My Location", and no position was requested. A showed Try Again and Open Settings. B showed Try Again only. Manual check of A (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026, app code `71dfcd2`): with Hughes-Trigg selected and location permission denied, Hughes-Trigg remained selected, the warning matched the expected message exactly, and both Try Again and Open Settings were visible. The other two parts of the expected result (the button returning to "Use My Location" and no position being read) were not reported. After Step 2 (automated, `71dfcd2`): same results as the baseline. |
| **Pass/fail status** | Baseline (automated): A Pass, B Pass. Manual check of A (user-observed, physical iPhone 11, iOS 26): Pass. After Step 2 (automated, `71dfcd2`): A Pass, B Pass. |

### TC-03: Manual pickup selected while a GPS lookup is running

| Field | Details |
| --- | --- |
| **Purpose** | Confirm that a late GPS answer cannot replace a spot the driver has just chosen by hand. |
| **Starting conditions** | Form is open. No pickup is selected. Permission is granted. No recent position is available, and the new position is held back so the lookup keeps running. |
| **Action/input** | 1. Tap **Use My Location**.<br>2. While it shows "Finding nearest landmark…", tap the **Meadows Museum** chip.<br>3. Release the held GPS answer: `32.8446, -96.7836`, which is nearest Fondren Library. |
| **Expected result** | After step 2, the pickup is Meadows Museum and the button immediately returns to "Use My Location".<br><br>After step 3, the pickup is **still Meadows Museum**, and no "Pickup set to…" message or warning appears. |
| **Why this is correct** | The driver's latest deliberate choice is the best evidence of what they want. Tapping the chip increases `locateRequest`, so the older lookup's number no longer matches and its answer is ignored. |
| **Test method** | Automated component test using a fake GPS answer that the test releases on demand. This is the main method because a real fix can return too quickly to tap a chip in time, and the result cannot be controlled. |
| **Actual result** | Baseline (automated): after the chip tap, Meadows Museum was selected and the button returned immediately. After the GPS answer was released, Meadows Museum was still selected, with no GPS message and no second pickup change. After Step 2 (automated, `71dfcd2`): same result as the baseline. |
| **Pass/fail status** | Baseline (automated): Pass. After Step 2 (automated, `71dfcd2`): Pass. |

### TC-04: Too far from SMU while a pickup is selected (related prediction)

| Field | Details |
| --- | --- |
| **Purpose** | Test the 1,500 m limit just outside the allowed range and confirm that the existing pickup is kept. |
| **Starting conditions** | Form is open. **Moody Coliseum** is selected. Location Services are on and permission is granted. No recent position is available. |
| **Action/input** | Tap **Use My Location**. The new position is `32.8597, -96.7849`, north of campus. |
| **Expected result (prediction)** | The pickup stays Moody Coliseum. The warning reads: "You’re more than about 1.5 km from the SMU pickup spots, so we can’t choose one automatically. Your pickup is still Moody Coliseum, or you can choose another spot below." **No Try Again button appears.** |
| **Why this is correct** | The nearest landmark, Dallas Hall, is about 1,606 m away, which is over the limit. The GPS worked, so retrying would not help unless the driver moves. That is different from a timeout, where retrying may succeed. |
| **Test method** | Automated component test. Repeat manually in the iOS Simulator using a custom location. |
| **Actual result** | Baseline (automated): Moody Coliseum stayed selected, the expected warning appeared, and there was no Try Again or Open Settings button. The prediction matched. Manual check: Not Run. After Step 2 (automated, `71dfcd2`): same result as the baseline. |
| **Pass/fail status** | Baseline (automated): Pass. Manual check: Not Run. After Step 2 (automated, `71dfcd2`): Pass. |

**Questions to discuss with the professor:**

- Is keeping the pickup right if the driver has moved and the old spot may no longer make sense? I predict the app keeps it, and I think that is reasonable because the message clearly names the spot still selected.
- Should this boundary also be tested just inside the limit? A follow-up input is `32.8579, -96.7849`, about 1,405 m from Dallas Hall, which should select Dallas Hall.

## Additional GPS manual checks (user-observed)

These six checks were done by hand on November 7, 2026, **after** Step 2, on a physical iPhone 11 with iOS 26 in Expo Go. The application code tested was `71dfcd2`. HEAD was `a0b5352` during testing, a documentation-only commit with identical app code.

**How these differ from the test cases above:**

- **They are not the manual checks defined in TC-01, TC-02 A, and TC-04.** TC-02 A's own manual check was done separately and passed (see TC-02). TC-01 and TC-04 remain Not Run. See [Discrepancies](#discrepancies), D-1.
- **No expected results were recorded in advance.** The "Purpose" column describes what each check looked at, written from the tester's report.
- **They were not run at the baseline,** so they show the behavior at `71dfcd2` only. They are not a before-and-after comparison.
- **They are user-observed results, not automated tests.**

| ID | Purpose | Actual result | Status |
| --- | --- | --- | --- |
| GPS-1 | Use My Location sets a pickup shown in the pickup map preview | Current GPS location appeared correctly in the pickup map preview. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| GPS-2 | A pickup chosen by hand replaces a GPS-chosen pickup | Changing to a manually selected pickup updated the preview and replaced the GPS selection. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| GPS-3 | Using My Location again after a manual choice | Switching back to current location updated the preview correctly. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| GPS-4 | Location permission denied | Denying location permission was handled without crashing; manual pickup selection remained available. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| GPS-5 | A manual pickup survives leaving and returning to the ride form | Manually selected pickup remained selected after navigating away from the Create Ride form and returning. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| GPS-6 | A submitted ride keeps its pickup, and the Map tab shows it | A submitted ride retained the selected pickup location, and the Map tab displayed the correct pickup. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |

**Notes:**

- **GPS-1 and GPS-3:** by design, the form never stores or shows the phone's own position. It picks the nearest SMU landmark (see [Privacy](#privacy)). "Current GPS location" here means the landmark chosen from it. The [Manual test notes](#manual-test-notes) ask a real-iPhone tester to record where they stood and which landmark was chosen. Neither was recorded, so the chosen landmark can't be checked against the expected nearest one.
- **GPS-4:** this shows the app didn't crash and manual selection still worked. It doesn't check what TC-02 A specifies: that an already-selected pickup is kept, the exact warning text, and the Try Again and Open Settings buttons. Those were checked separately in TC-02 A's own manual check.
- **GPS-6:** this is a single manual observation of part of the [important behavior the automated tests don't cover](#an-important-behavior-these-tests-do-not-cover). It doesn't make that behavior covered by the repeatable tests.

## Step 2 test cases: map zoom controls

These cases were written on November 7, 2026, before any Step 2 code existed, so the expected results are predictions. None of them has been run. They test the **new** feature, so they have no baseline result: at `0008c88` the zoom controls do not exist.

### How map zoom will work (planned)

This is the design the expected results are based on. If the implementation has to differ, the difference will be recorded under [Discrepancies](#discrepancies), not hidden by editing these expectations.

- **Where:** the Map tab (`screens/MapScreen.js`). The pickup preview on Ride Details (`components/PickupMapPreview.js`) stays fixed, with gestures off, and gets no controls.
- **Buttons:** three buttons over the map, with these accessibility labels: **Zoom in**, **Zoom out**, and **Re-center map**.
- **Zoom in / Zoom out:** take the map's latest visible region and keep its center. Zoom in halves `latitudeDelta` and `longitudeDelta`. Zoom out doubles them. The map is moved with `animateToRegion`.
- **Latest region:** saved from the map's `onRegionChangeComplete`, so the buttons start from where the user has pinched or panned to, not from the starting view. Before any change it is `SMU_MAP_REGION` (`32.8413, -96.7805`, deltas `0.018`).
- **Limits:** each delta is kept between **0.002** (the closest the buttons can zoom in) and **0.2** (the farthest they can zoom out). Each delta is limited separately.
- **Re-center map while browsing:** returns to `SMU_MAP_REGION` exactly.
- **Re-center map while a route is open:** re-frames the route using the existing `fitMapTo` (the same framing used when the route opens), instead of returning to `SMU_MAP_REGION`. The route stays open.
- **Map not ready:** if the map's ref is not available yet, a button tap does nothing and does not crash.
- **Code:** the zoom calculation goes in a new file, `lib/mapZoom.js`, as a pure function `zoomRegion(region, factor)`, where factor `0.5` zooms in and `2` zooms out. The pickup files (`screens/RideForm.js`, `lib/currentLocation.js`, `lib/nearestPickup.js`, `lib/pickupLocations.js`) are not changed.

### Automated tests

**File:** `__tests__/map-zoom-test.js` (to be written in Step 2).

**Method:** component tests with Jest and React Native Testing Library, rendering the real `MapScreen` and the real `lib/mapZoom.js`. Only `react-native-maps` is replaced, with a fake `MapView` that records each `animateToRegion` and `fitToCoordinates` call and can report a region change. For Z-09, `fetchDrivingRoute` from `lib/routing.js` is also faked, so no network is used. Z-08 calls `zoomRegion` directly.

**Clarification recorded after implementation:** the test file also fakes the icon font (`@react-native-vector-icons/ionicons`), exactly as the GPS tests do, so the buttons' icons render in Jest. This was left out of the method above by mistake. It doesn't affect any expected result, because the tests find the buttons by their accessibility labels, not their icons. Expected values are written out in the test file, not imported from the app. Decimal values are compared to 6 decimal places, because halving and doubling decimals can leave tiny rounding differences.

| ID | Purpose | Starting conditions | Action/input | Expected result | Actual result | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Z-01 | Zoom in from the starting view | Map tab rendered, browsing, no region change reported | Tap **Zoom in** once | `animateToRegion` receives center `32.8413, -96.7805` with both deltas `0.009` | One `animateToRegion` call: center `32.8413, -96.7805`, both deltas `0.009` (automated, `71dfcd2`) | Pass |
| Z-02 | Zoom out from the starting view | Same as Z-01 | Tap **Zoom out** once | `animateToRegion` receives center `32.8413, -96.7805` with both deltas `0.036` | One `animateToRegion` call: center `32.8413, -96.7805`, both deltas `0.036` (automated, `71dfcd2`) | Pass |
| Z-03 | Edge case: closest zoom limit | Same as Z-01 | Tap **Zoom in** 6 times | Deltas go `0.009`, `0.0045`, `0.00225`, then `0.002` on the 4th tap (`0.001125` limited to `0.002`). Later taps leave both deltas at `0.002`. No call ever has a delta below `0.002`. The center never changes. | 6 calls with deltas `0.009`, `0.0045`, `0.00225`, `0.002`, `0.002`, `0.002`; none below `0.002`; center unchanged (automated, `71dfcd2`) | Pass |
| Z-04 | Edge case: farthest zoom limit | Same as Z-01 | Tap **Zoom out** 6 times | Deltas go `0.036`, `0.072`, `0.144`, then `0.2` on the 4th tap (`0.288` limited to `0.2`). Later taps leave both deltas at `0.2`. No call ever has a delta above `0.2`. The center never changes. | 6 calls with deltas `0.036`, `0.072`, `0.144`, `0.2`, `0.2`, `0.2`; none above `0.2`; center unchanged (automated, `71dfcd2`) | Pass |
| Z-05 | Edge case: zoom starts from where the user panned | Fake map reports a region change to center `32.85, -96.79`, deltas `0.018` | Tap **Zoom in** once | `animateToRegion` receives center `32.85, -96.79` with deltas `0.009`, **not** the SMU center | One call: center `32.85, -96.79`, deltas `0.009` (automated, `71dfcd2`) | Pass |
| Z-06 | Re-center after zooming and panning | Zoom in once, then the fake map reports a region change to center `32.85, -96.79`, deltas `0.009` | Tap **Re-center map** | `animateToRegion` receives exactly `32.8413, -96.7805`, deltas `0.018` | Last call exactly `32.8413, -96.7805`, deltas `0.018` (automated, `71dfcd2`) | Pass |
| Z-07 | Edge case: tap before the map is ready | The fake map provides no ref methods | Tap **Zoom in**, **Zoom out**, and **Re-center map** | No error is thrown, no map call is recorded, and the Map tab still shows its header | No error, no `animateToRegion` or `fitToCoordinates` call, header still shown (automated, `71dfcd2`) | Pass |
| Z-08 | Unit test: each delta is scaled and limited separately | Call `zoomRegion` directly | **A:** region `32.84, -96.78`, deltas lat `0.01`, lng `0.3`, factor `2`.<br>**B:** same center, deltas lat `0.003`, lng `0.05`, factor `0.5` | **A:** lat delta `0.02`, lng delta `0.2` (`0.6` limited).<br>**B:** lat delta `0.002` (`0.0015` limited), lng delta `0.025`.<br>Both keep center `32.84, -96.78`, and the input region object is not changed. | **A:** `0.02` / `0.2`. **B:** `0.002` / `0.025`. Center kept and the (frozen) input unchanged in both (automated, `71dfcd2`) | Pass |
| Z-09 | Re-center while a route is open re-frames the route | Map tab rendered with one ride: pickup **Hughes-Trigg Student Center** (`32.84354, -96.7833`), destination point **Fondren Library** (`32.84454, -96.78343`). `fetchDrivingRoute` is faked to return the road coordinates `32.84354, -96.7833` → `32.8440, -96.7834` → `32.84454, -96.78343`. The route has been opened with **View Route** and has finished loading. Earlier map calls are cleared. | Tap **Re-center map** | `fitToCoordinates` is called once with exactly those 3 road coordinates, `animated: true`, and edge padding top `70`, left `50`, right `50` (the bottom depends on the route card's measured height, as in `fitMapTo`). `animateToRegion` is **not** called, so the map does not return to `SMU_MAP_REGION`. The route card is still showing. | `fitToCoordinates` called once with the 3 road coordinates, `animated: true`, padding top `70`, left `50`, right `50`; no `animateToRegion` call; route card and **Close Route** still showing (automated, `71dfcd2`) | Pass |

### Regression check: zoom must not change the selected pickup

| Field | Details |
| --- | --- |
| **ID** | R-01 (automated, in `__tests__/map-zoom-test.js`) |
| **Purpose** | Confirm that zooming and re-centering only move the map. They must not change which pickup spot is selected, where any pickup pin is, or any ride's pickup data. |
| **Starting conditions** | Map tab rendered with two rides: one leaving from **Fondren Library** (`32.84454, -96.78343`) and one from **Moody Coliseum** (`32.8404, -96.78068`). Browsing, no route open. |
| **Action/input** | 1. Tap the Fondren Library pin.<br>2. Tap **Zoom in**, **Zoom out**, and **Re-center map**. |
| **Expected result** | After step 1, the preview shows **Fondren Library** and "1 ride leaving from here". After step 2: the preview still shows Fondren Library and the same ride; the Fondren and Moody pins are still at exactly the coordinates above; the rides passed to the Map tab are unchanged (compared with a copy made before step 1); and `onOpenRide` is not called. |
| **Why this is correct** | The zoom buttons sit over the map but are not map taps, so they must not close the preview the way tapping the map does. Pickup data comes from the ride and only the driver can change it, through the ride form. |
| **Actual result** | After Step 2 (automated, `71dfcd2`): after tapping the Fondren pin, the preview showed Fondren Library and "1 ride leaving from here". After Zoom in, Zoom out, and Re-center map, the preview still showed Fondren Library, its ride's destination, and its driver. Both pins kept their exact coordinates, the rides were equal to the copy made beforehand, and `onOpenRide` was not called. |
| **Status** | After Step 2 (automated, `71dfcd2`): Pass. Manual: not part of R-01. |

**Pickup selection itself** (choosing a spot in the ride form) is protected by rerunning TC-01 to TC-04 unchanged, and by confirming that Step 2 did not change the pickup files. See [Run order](#run-order).

### Manual checks

The automated tests use a fake map, so they show that the app **asks** the map to move, not that the real map does. These four checks use the real map in the iOS Simulator or on an iPhone, with at least one ride on the board that has a pickup spot.

| ID | Check | Steps | Expected result | Actual result | Status |
| --- | --- | --- | --- | --- | --- |
| MZ-1 | Extreme zoom and Re-center | On the Map tab, pinch out until the whole United States is visible, then pan to another city. Tap **Re-center map**. | The map returns to the SMU campus view, with the same pins as when the tab opened. | Re-center returned the map to SMU correctly. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| MZ-2 | Zoom limits: closest in and farthest out | **A (closest in):** from the campus view, tap **Zoom in** repeatedly until the map stops changing.<br>**B (farthest out):** tap **Re-center map**, then tap **Zoom out** repeatedly until the map stops changing. | **A:** the map stops at a close campus view (delta about `0.002`, a few buildings across). Further taps do nothing, and **Zoom out** still works.<br>**B:** the map stops at a wide view (delta about `0.2`, central Dallas around SMU). Further taps do nothing, and **Zoom in** still works.<br>Nothing breaks in either case. | **A and B:** both the closest-in and the farthest-out button limits worked, and zooming in the opposite direction still worked afterwards. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| MZ-3 | Short route framing: Hughes-Trigg to Fondren | Open the route for a ride from **Hughes-Trigg Student Center** to **Fondren Library** (about 110 m apart). | Both pins are visible above the route card, and the map does not zoom in tighter than the closest zoom limit. | The Hughes-Trigg to Fondren short route displayed correctly, with both endpoints visible. **Re-center map** also framed the route correctly (the on-device counterpart of Z-09). A brief native zoom past the limit was not independently checked, so strict `maxZoomLevel` enforcement remains unverified (see K-1). (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |
| MZ-4 | Buttons do not cover the map cards | 1. Tap a pin so the ride preview card appears.<br>2. Open a route so the route card appears.<br>Check on the smallest available iPhone screen. | The three buttons never cover the preview card, the route card, the top status notes, or the Refresh button. All buttons and cards can still be tapped. | The zoom buttons, the preview card, the route card, and the status notes displayed correctly, without overlap. (user-observed, physical iPhone 11, iOS 26, Expo Go, November 7, 2026) | Pass |

**Note on MZ-3:** the buttons' limits do not apply to `fitToCoordinates`, which frames a route automatically. Passing MZ-3 therefore depends on also setting a map-level zoom limit (`maxZoomLevel` on `MapView`). During implementation, the react-native-maps 1.29.11 documentation will be checked for whether `maxZoomLevel` is supported and enforced on our target platforms (iOS, and Android if tested). The expected result above stays as written. If the real map behaves differently, MZ-3 is recorded as Fail with an entry under [Discrepancies](#discrepancies), not by changing the expectation.

**What the documentation and source showed (November 7, 2026; not verified on a device):** `71dfcd2` sets `maxZoomLevel={18}`. Zoom level 18 is roughly a `0.002`-wide view on a phone, but the exact match depends on screen width. react-native-maps 1.29.11 lists `maxZoomLevel` as supported on iOS and Android, but marks it deprecated on Apple Maps, which our iOS map uses. In its iOS code, the limit is applied only **after** the map finishes moving, by animating back to the limit. So on iPhone, a short route may briefly zoom in further than the limit before settling. MZ-3 will show whether that happens and how it looks. See [Discrepancies](#discrepancies), K-1.

**How the manual results were obtained:** MZ-1 to MZ-4 were checked by hand on November 7, 2026, in Expo Go on iOS. **The application code tested was commit `71dfcd2`.** HEAD was `a0b5352` during testing, but that commit changed documentation only, so its app code is identical to `71dfcd2`. The results above are what the tester observed and reported. They are not automated test output. **Test environment:** a physical iPhone 11 running iOS 26, using Expo Go. These results apply to that one device. They don't show that every iPhone, screen size, or iOS version behaves the same way. In particular, MZ-4 asked for the smallest available iPhone screen. It was checked on the iPhone 11 (6.1-inch screen) only. Smaller screens, such as an iPhone SE, were not checked.

**Note on MZ-2 B:** a delta of `0.2` is the limit for the **buttons**. Pinching can still zoom out further unless a map-level limit is also set; MZ-1 relies on that being possible.

## Messaging test cases: private driver/rider messaging

These cases were written on November 8, 2026, on branch `feature/ride-messaging` (created from `main` at `8ad3533`), **before any messaging app code existed**. The expected results are predictions. They test a new feature, so they have no baseline result.

The database side is `supabase/messaging-1-tables.sql`, checked by `supabase/messaging-2-verify.sql`. It has been applied and tested **only on a local database**. It is **not** in production. These tests don't change or connect to any database, and no database file was changed.

### How messaging will work (planned)

This is the design the expected results are based on. If the implementation has to differ, the difference will be recorded under [Discrepancies](#discrepancies), not hidden by editing these expectations.

**Off switch.** Messaging is controlled by `EXPO_PUBLIC_MESSAGING_ENABLED`. It is on only when the value is exactly `"true"`. Anything else, including not set, means off.
- `isMessagingEnabled()` in `lib/messaging.js` reads the flag as `process.env.EXPO_PUBLIC_MESSAGING_ENABLED`, because Expo only inlines that dot-notation form.
- `App.js` passes the result to the screens as the `messagingEnabled` prop. A screen given no value treats messaging as off.
- When messaging is off, there are no Message buttons, no Messages list and no messaging requests.

**Data layer (`lib/messaging.js`).** It uses the existing shared client from `lib/supabase.js`, which holds only the publishable key. Its functions never throw; each resolves with a result object. The server calls are copied from `messaging-1-tables.sql`:

| Function | Server call | Success result |
| --- | --- | --- |
| `openRideConversation({ rideId, riderId })` | RPC `open_my_ride_conversation` with `p_ride_id`. `p_rider_id` is added only when a driver names the rider; a rider sends no rider id. | `{ kind: 'ok', conversation }` |
| `listRideConversations()` | RPC `list_my_ride_conversations` with no arguments | `{ kind: 'ok', conversations }`, in the server's order (newest activity first) |
| `getRideConversation(conversationId)` | RPC `list_my_ride_conversations` with `p_conversation_id` | `{ kind: 'ok', conversation }`, or `conversation: null` when no row comes back |
| `sendRideMessage({ conversationId, clientMessageId, body })` | RPC `send_my_ride_message` with `p_conversation_id`, `p_client_message_id` and `p_body` (trimmed) | `{ kind: 'ok', message }` |
| `loadMessages({ conversationId, since })` | There is no RPC for reading messages. It reads the `ride_messages` table, which RLS limits to the conversation's participants: `conversation_id` = the conversation, plus `created_at` ≥ `since` when `since` is given | `{ kind: 'ok', messages }`, oldest first (ties broken by id) |
| `newClientMessageId()` | None. It returns `Crypto.randomUUID()` from `expo-crypto`. | A UUID v4 string |

The app never calls `ride_conversation_state`; it is used inside the server.

- **Conversation shape:** `{ id, rideId, driverId, riderId, myRole, rideDestination, rideDepartureAt, state, canSend, createdAt, lastMessageAt }`, from the RPC's columns.
  - `rideDepartureAt` is a `Date`.
  - `canSend` is true only when `can_send` is true.
  - `rideId` is null for a cancelled ride's archived chat.
- **Message shape:** `{ id, conversationId, senderId, clientMessageId, body, createdAt }`.

**Failures.** Every failure resolves to a result the screen can show:

| What happened | Result `kind` | Message |
| --- | --- | --- |
| Error `P0001` (a rule the database enforces, such as a read-only chat or the rate limit) | `refused` | The server's own message, which is written for users |
| Error `55P03` (the ride is being updated) | `retry` | The server's own message |
| `PGRST202`, `PGRST205`, `42883` or `42P01` (messaging isn't installed on this server, as in production today) | `unavailable` | "Messaging isn't available yet." |
| Status 0 (how supabase-js 2.117 reports a network failure) or a thrown error | `retry` | "Couldn't reach CarpoolBoard. Check your connection and try again." |
| Anything else | `error` | "Something went wrong. Please try again." |
| Send: an empty message, or only spaces, tabs and newlines | `invalid` (nothing is sent) | "Type a message first." |
| Send: more than 1,000 characters | `invalid` (nothing is sent) | "Messages can be at most 1000 characters." |

Characters are counted the way the database counts them, so 1,000 emoji are allowed even though JavaScript counts them as 2,000.

**Retries.** A message gets its id from `newClientMessageId()` once, when it is first sent. Retry reuses that same id, and the data layer never creates its own. For a repeated id, the server returns the message it already saved instead of saving a second copy.

**Conversation screen (`screens/ConversationScreen.js`).** Its props are `conversationId`, `currentUser`, `otherPersonName` and `onBack`.

*Layout:*
- A **Back** button, and a header with the other person's name and the ride's destination.
- Bubbles, oldest first. Each bubble's accessibility label is "*You* or *name*, *time*: *text*", where the time looks like "3:05 PM". Day labels read "Today", "Yesterday", or the date.
- The composer (a text input labeled "Type a message" and a **Send** button) appears **only when `canSend` is true**. `canSend` comes from the server, so the server alone decides whether sending is allowed.
- **Send** is disabled when the message is blank or over 1,000 characters, and an over-length message shows the limit message.

*Read-only notices* replace the composer when `canSend` is false, and the history stays visible:
- `ride_cancelled`: "This ride was cancelled, so this conversation is read-only."
- `seat_cancelled`: "This seat is no longer confirmed, so this conversation is read-only."
- `completed`: "This ride has ended, so this conversation is read-only."
- Any other state: "This conversation is read-only."

These match the server's own wording.

*Sending:*
- The message appears at once marked "Sending…", and the composer clears.
- On success it is replaced by the server's copy.
- A `retry` or `error` result marks it "Not sent", with a **Retry** button.
- A `refused` result shows the server's reason and re-reads the conversation straight away, so the chat turns read-only without waiting for the next poll.
- A message is never shown twice, even if a poll and a send result both return it. Messages are matched by id, or by client id for the user's own messages.

*Polling:*
- Every 5 seconds while the screen is open **and** the app is active, it loads new messages and re-reads the conversation.
- Each poll asks for messages from no later than the newest message already shown. This matters because `created_at` is the time a transaction started, so a message can be saved after a newer one.
- There is no polling in the background. Returning to the app checks at once.
- Leaving the screen stops polling.
- A new poll never starts while the previous one is still running.
- A failed poll keeps the messages on screen.

*When there is no conversation to show:*
- An `unavailable` result shows "Messaging isn't available yet."
- A conversation that comes back `null` shows "This conversation isn't available."
- Neither case shows a composer.

**Message buttons.** These are new props on existing screens. Existing buttons and handlers don't change.

- **Ride Details, driver** (when `isOwnerDriver` is true): one button per confirmed rider, named "Message *rider*". It calls `onMessage({ rideId, riderId })`.
- **Ride Details, accepted rider:** one button on their own passenger row, named "Message *driver*". It calls `onMessage({ rideId, riderId: null })`. Other passengers' rows get no button.
- **Requests tab, rider:** on each Confirmed card. **Requests tab, driver:** on each confirmed passenger.
- **Never** for pending, denied or cancelled requests.
- Buttons are shown until **2 hours after departure** (while now < departure + 2 h), matching the server's grace period. After that, the chat is reached from the Messages list.
- `AppButton` gets an optional `accessibilityLabel` prop, so that each Message button has its own name.
- Ride Details also gets `nowMs`.

**Messages list.** It sits at the top of the Requests tab, in both modes, above everything else, including the existing empty states.
- It is titled "Messages".
- Each row is a button whose name starts "Conversation with *name*" and which shows the ride's destination.
- A conversation with `canSend` false shows "Read-only".
- Tapping a row calls `onOpenConversation(conversationId)`. This is how archived chats stay reachable after their ride is deleted or the rider leaves.
- With no conversations it shows "No conversations yet." If the list couldn't be loaded, it shows `conversationsError`.
- `App.js` loads the list with `listRideConversations()` and adds `otherPersonName` to each row.

### Automated tests

**Files:** `__tests__/messaging-data-test.js` (MD), `__tests__/messaging-conversation-test.js` (MC) and `__tests__/messaging-entry-points-test.js` (ME).

**Method:** Jest and React Native Testing Library, as for the earlier tests. Expected values are written out in the test files, not imported from the app. The RPC names, argument names and columns were copied by hand from `messaging-1-tables.sql`.

| File | Real code under test | Faked |
| --- | --- | --- |
| MD | `lib/messaging.js` | `lib/supabase`: a fake client that records each `rpc`/`from` call and returns a scripted result. Network failures use supabase-js's real shape (`status: 0`, empty code). `expo-crypto` is faked as a virtual module because it isn't installed yet. `fetch` is replaced by a counter that must stay at 0. |
| MC | `screens/ConversationScreen.js` and everything it uses | `lib/messaging` (tested separately in MD; faking it here means no Supabase client exists at all), the icon font, `AppState`, and the clock (Jest fake timers fixed at Sunday, November 8, 2026, 4:00 PM, with the tests running in `America/Chicago`) |
| ME | `screens/RideDetailsScreen.js` and `screens/RequestsScreen.js` | `lib/supabase` (RequestsScreen loads it through `lib/reviews`), `react-native-maps`, and the icon font |

No test can reach a Supabase project, local or production.

#### MD: data layer

| ID | Purpose | Setup and action | Expected result |
| --- | --- | --- | --- |
| MD-01 | A rider opens their chat | Fake server returns one conversation row. Call `openRideConversation({ rideId: 'ride-1' })`. | One RPC call: `open_my_ride_conversation` with `p_ride_id: 'ride-1'` and no rider id. Result is `ok` with the conversation in the shape above. No table read. |
| MD-02 | A driver opens the chat with one rider | `openRideConversation({ rideId: 'ride-1', riderId: 'rider-a' })` | Arguments are exactly `{ p_ride_id: 'ride-1', p_rider_id: 'rider-a' }`. Result is `ok`. |
| MD-03 | List all chats | Fake server returns an open row, then an archived row (`ride_id` null, `ride_cancelled`). Call `listRideConversations()`. | `list_my_ride_conversations` with no arguments. Both conversations, in the server's order, with `rideId` null on the archived one. |
| MD-04 | Read one chat by id | **A:** one row. **B:** no rows. | `list_my_ride_conversations` with `{ p_conversation_id }`. **A:** that conversation. **B:** `conversation: null`. |
| MD-05 | Send a message | **A:** body `"  On my way \n"`, single-object answer. **B:** a one-row array answer. | `send_my_ride_message` with exactly `p_conversation_id`, `p_client_message_id` and `p_body: 'On my way'`. The result is the message in the shape above, for both answers. |
| MD-06 | Read message history | **A:** the server returns 4 rows newest first, two with the same time. **B:** `since: '2026-11-08T21:04:00.000Z'`. | **A:** reads table `ride_messages` (no RPC), selecting all six columns, filtered by `conversation_id`. Result oldest first, with the tie broken by id: `msg-1`, `msg-2a`, `msg-2b`, `msg-3`. **B:** also filters `created_at` ≥ that time. |
| MD-07 | States and `can_send` passed through | Each of `open`/`true`, `ride_cancelled`/`false`, `seat_cancelled`/`false` and `completed`/`false`. Plus `can_send: null`. *Added in Step 3:* state `open` with `can_send: false`. | `state` and `canSend` match the server. A null `can_send` becomes `false`. *Added:* `canSend` stays `false` while `state` stays `open`. |
| MD-08 | Every failure becomes a result, never a throw | For each of the 4 RPC functions, the 9 failures in the [failures table](#how-messaging-will-work-planned) (`P0001`, `55P03`, `PGRST202`, `PGRST205`, `42883`, `42P01`, status 0, a thrown error, `42501`). For `loadMessages`, the 5 that a table read can produce. | The `kind` and message from the failures table (36 + 5 cases) |
| MD-09 | Length and empty checks happen on the phone | **A** `""`, **B** whitespace only, **C** 1,001 characters, **D** `null`: all refused. **E** exactly 1,000 characters, **F** 1,000 emoji, **G** 1,000 characters with spaces around them: all sent. | **A–D:** `invalid` with the matching message and **no** server call. **E–G:** sent, and G's body is trimmed to the 1,000 characters. |
| MD-10 | Retries reuse the client id | **A:** the same message is sent twice; the first attempt fails with a network error. **B:** `newClientMessageId()` called twice. | **A:** both RPC calls are identical, with `p_client_message_id: 'client-1'`. `randomUUID` is never called by `sendRideMessage`. **B:** each call returns the next fake UUID. |
| MD-11 | Pending or denied riders get no chat | The server refuses with `P0001` "This conversation isn't available." | `refused` with that message, and no conversation in the result |
| MD-12 | Flag is off unless exactly `"true"` | Unset, `""`, `"false"`, `"1"` and `"TRUE"`; then `"true"`. Each uses a fresh copy of the module. | Off for the first five, on only for `"true"` |
| MD-13 | Safety | **A:** read the source of `lib/messaging.js`. **B:** last test in the file. | **A:** it imports from `./supabase`, never calls `createClient`, and never mentions a service-role key or secret. **B:** no test made a network request. |

#### MC: conversation screen

| ID | Purpose | Setup and action | Expected result |
| --- | --- | --- | --- |
| MC-01 | History, bubbles, times | Open chat with 3 messages: Dana yesterday at 5:30 PM, me today at 3:05 PM, Dana today at 3:06 PM | Loads conversation `conv-1` and its messages. Bubble labels in order: "Dana Driver, 5:30 PM: …", "You, 3:05 PM: …", "Dana Driver, 3:06 PM: …". "Yesterday" and "Today" are shown, along with the name and "Downtown Dallas". The composer is shown. |
| MC-02 | Archived chats are read-only | `ride_cancelled`, `seat_cancelled` or `completed`, each with `canSend` false; then `open` | Each archived state shows its notice, has no input and no Send button, and keeps its history. `open` shows the composer and no notice. |
| MC-03 | `can_send` decides | **A:** state `open` with `canSend` false. **B:** state `completed` with `canSend` true. | **A:** no composer, and "This conversation is read-only." **B:** composer shown. |
| MC-04 | Sending | Type `"  On my way  "`, tap Send, and hold the server's answer | Sent once with `{ conversationId: 'conv-1', clientMessageId: 'client-new-1', body: 'On my way' }`. The input clears, and "On my way" plus "Sending…" show at once. After the answer: no "Sending…", one bubble, labeled "You, 3:59 PM: On my way". |
| MC-05 | Empty messages | Nothing typed; then only spaces and newlines | Send is disabled both times, and pressing it sends nothing |
| MC-06 | Length limit | 1,000 characters; then 1,001 | 1,000: Send enabled, no limit message. 1,001: Send disabled, the limit message shown, nothing sent. |
| MC-07 | Retry reuses the id | First send gets a network `retry`; Retry succeeds | "Not sent" and a Retry button appear. The second send is identical, including `client-new-1`. A new id was created only once. Afterward there is no "Not sent" and exactly one bubble. |
| MC-08 | No duplicate sends | **A:** two fast taps on Send. **B:** the next poll returns the message just sent. **C:** a "Not sent" message turns up in a poll (the reply was lost, but the server had saved it). | **A:** one send call and one bubble. **B:** still one bubble. **C:** "Not sent" and Retry disappear, leaving one bubble with the server's time. |
| MC-09 | Refused send | Send is refused because the ride was cancelled; re-reading the conversation returns `ride_cancelled` | The conversation is re-read at once, without waiting for a poll. The server's reason is shown and the composer disappears. |
| MC-10 | Polling lifecycle | **A:** timing. **B:** where a poll starts reading. **C:** a new incoming message. **D:** a poll finds the seat cancelled. **E:** background, then return. **F:** leave the screen. **G:** a poll that never answers. **H:** a failed poll. | **A:** nothing at 4,999 ms. At 5,000 ms messages and conversation are both re-read, and again 5 s later. **B:** `since` is no later than the newest message held. **C:** the new bubble appears. **D:** the chat turns read-only and keeps its history. **E:** no polls in 20 s of background; one poll at once on return, then every 5 s. **F:** no more polls, and the app-state listener is removed. **G:** no second poll starts while the first is running. **H:** history stays and polling continues. |
| MC-11 | Nothing to show | **A:** `unavailable`. **B:** `conversation: null`. | **A:** "Messaging isn't available yet." **B:** "This conversation isn't available." Neither has a composer. |
| MC-12 | Back | Tap **Back** | `onBack` is called once |

#### ME: entry points

| ID | Purpose | Setup and action | Expected result |
| --- | --- | --- | --- |
| ME-01 | Flag off (prop left out) | **A:** Ride Details as the driver. **B:** Ride Details as the accepted rider. **C:** the Requests tab as the rider, with conversations passed in. **D:** the Requests tab as the driver. | No Message button, no "Messages" heading and no conversation rows. Existing buttons are still there: Accept, Deny, Edit Ride, Cancel Ride, Leave, Leave Seat, Withdraw. |
| ME-02 | Driver, Ride Details | A ride with confirmed riders Riley and Bo, and pending rider Pat | Buttons "Message Riley Rider" and "Message Bo Rider", in that order. Bo's calls `onMessage({ rideId: 'ride-1', riderId: 'rider-b' })`. Edit Ride is still there. |
| ME-03 | Accepted rider, Ride Details | Riley in Rider mode | Only "Message Dana Driver", which calls `onMessage({ rideId: 'ride-1', riderId: null })`. Leave is still there. |
| ME-04 | Pending and denied riders can't message | **A:** the driver's view of pending Pat. **B:** Ride Details for a rider whose request is pending, denied or cancelled. | **A:** no "Message Pat Pending", and Accept is still there. **B:** no Message button. |
| ME-05 | Rider, Requests tab | One request in each status | Only "Message Dana Driver", on the Confirmed request, calling `onMessage({ rideId: 'ride-1', riderId: null })`. Leave Seat and Withdraw are still there. |
| ME-06 | Driver, Requests tab | Confirmed Riley and Bo, pending Pat | "Message Riley Rider" and "Message Bo Rider", with nothing on Pat. Riley's calls `onMessage({ rideId: 'ride-1', riderId: 'rider-a' })`. Accept and Deny are still there. |
| ME-07 | 2-hour window | Driver's Ride Details 1 h 59 min, exactly 2 h, and 3 h after departure | Both buttons at 1 h 59 min. None at exactly 2 h (the server counts that as `completed`). None at 3 h. |
| ME-08 | Messages list | **A:** an open chat with Dana and an archived chat with Cass. **B:** no conversations. **C:** a load error. | **A:** "Messages" comes before "Confirmed". The rows are in the order given, with names and destinations. Only Cass's row is read-only: its label says "read-only" and it shows the reason "Ride cancelled" (changed in Step 6 from the plain "Read-only" badge; see ME-11). Tapping it calls `onOpenConversation('conv-2')`. **B:** "No conversations yet." **C:** the error text. |
| ME-09 | Archived chats stay reachable | **A:** a rider with no requests left (the ride was cancelled). **B:** a driver with no rides. | The archived row is shown and opens `conv-2`. The existing empty state is still shown below it. |
| ME-10 | Past rides keep Message buttons until 2 hours after departure (added in Step 6) | Requests tab. Rider: departed rides with an accepted, a pending and a cancelled request. Driver: a departed ride with confirmed Riley and Bo and pending Pat. **A:** rider, 1 h after departure. **B:** driver, 1 h after departure. **C:** both modes at 1 h 59 min, exactly 2 h and 3 h. **D:** flag off. **E:** both modes 3 h after departure, with that ride's chat (`state: 'completed'`, `canSend: false`) passed in. | **A:** "Past rides" shows only "Message Dana Driver", calling `onMessage({ rideId: 'ride-1', riderId: null })`; the three View Ride buttons are still there. **B:** "Message Riley Rider" and "Message Bo Rider" on the past card, none for Pat; Bo's calls `onMessage({ rideId: 'ride-1', riderId: 'rider-b' })`; the passenger summary is unchanged. **C:** buttons at 1 h 59 min; none at exactly 2 h or 3 h. **D:** no Message buttons. **E:** no Message buttons; the chat is in the Read-only group with "Ride ended", there is no Active group, and tapping it calls `onOpenConversation('conv-1')`. |
| ME-11 | Messages list split into Active and Read-only, no count badge (added in Step 6) | **A:** five chats in mixed order (two `canSend: true`, three not). **B:** read-only chats with states `ride_cancelled`, `seat_cancelled`, `completed` and an unknown state. **C:** only active chats. **D:** only active, then only read-only. **E:** three chats and no rides. **F:** `canSend` missing. **G:** one chat in each group. | **A:** headings "Active" then "Read-only"; each group keeps the given order. **B:** "Ride cancelled", "Seat cancelled", "Ride ended", "Read-only". **C:** no read-only label or badge on any row. **D:** only the group that has chats is shown. **E:** "Messages" with no "3", "2" or "1" badge. **F:** the chat is under Read-only, never Active. **G:** each row opens its own chat (`conv-1`, then `conv-2`). |

### Manual checks (local Supabase only)

These need the app pointed at the **local** Supabase stack (`~/CarpoolBoard-LocalDB`, API at `127.0.0.1:54321`) by starting Expo with shell variables, which override `.env.local` without editing it:

```sh
EXPO_PUBLIC_SUPABASE_URL=http://<Mac IP or 127.0.0.1>:54321 \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local anon key from `supabase status`> \
EXPO_PUBLIC_MESSAGING_ENABLED=true npx expo start
```

They use two devices or simulators: a driver and an accepted rider. Departure times are moved **in the local database only**. All of them are Not Run.

| ID | Check | Expected result |
| --- | --- | --- |
| MM-1 | The driver and rider exchange messages | Each message appears on the other device within about 5 s, with the right side and time |
| MM-2 | The driver cancels the ride | Both chats turn read-only, and stay reachable from the Messages list |
| MM-3 | The rider leaves their seat | The chat turns read-only ("This seat is no longer confirmed…"), and the driver's Message button for that rider disappears |
| MM-4 | The ride's departure is moved to more than 2 h ago | Read-only ("This ride has ended…"); no Message buttons |
| MM-5 | A pending rider | No Message button anywhere |
| MM-6 | 21 messages within one minute | The 21st shows the server's "sending messages too quickly" message |
| MM-7 | Airplane mode on, send, then airplane mode off and Retry | The message is saved once (checked in the local database) and shown once |
| MM-8 | Production safety: the flag is unset and `.env.local` is unchanged | The app looks and behaves as before; no messaging request is made |

### Result before implementation (Messaging Step 1)

On November 8, 2026, the three messaging files were run on `feature/ride-messaging` at `8ad3533`, with the test files not yet committed and no messaging app code. Of the 119 tests, **10 passed, 10 failed, and 99 could not run** because their suites failed to load. Jest itself reports "10 failed, 26 passed, 36 total" for the full suite: the 26 passes are the 16 earlier tests plus 10 messaging tests, and tests in a suite that fails to load aren't counted. **Every failure was expected:**

| File | Result | Why |
| --- | --- | --- |
| MD (73 tests) | Suite didn't load | `Cannot find module '../lib/messaging'`: the file doesn't exist yet |
| MC (26 tests) | Suite didn't load | Same missing module (`lib/messaging`, and `screens/ConversationScreen` after it) |
| ME (20 tests) | 10 failed, 10 passed | The 10 failures are ME-02, ME-03, ME-05, ME-06, ME-07 (1 h 59 min), ME-08 A–C and ME-09 A–B. Each fails because a Message button or the Messages list isn't there yet. The 10 passes are ME-01 A–D, ME-04 A and B (×3), and ME-07 at exactly 2 h and at 3 h. They check that something is **absent**, which is already true today, and they must keep passing after the change. |

**Checking that the failures aren't test setup problems:** the MD and MC suites couldn't load, so their test bodies didn't run. Two checks were made from the scratchpad, outside the repository, with no messaging code:

1. **A probe** of the mechanics these suites rely on passed 4 of 4: the `America/Chicago` time zone, the time format, the virtual `expo-crypto` fake, faking `AppState`, and fake timers driving a polling screen with a disabled button.
2. **Empty stand-ins** for the two missing modules, mapped in for one run only. All 73 MD tests and all 26 MC tests then loaded and ran. Every failure was an assertion about missing behavior, not a setup error. Six MD tests passed against the empty stand-in: the five "flag off" cases (a stand-in that always says off) and MD-13 B (no network request was made).

The second check found one mistake in a test **title**: MD-12 printed the input value instead of the expected result. The title was fixed. No expected value changed.

The earlier tests were run separately, before and after the new files were added, and passed 16 of 16 both times.

## An important behavior these tests do not cover

**These tests do not show that the chosen pickup is saved correctly or reaches riders.**

They stop at the form's displayed pickup. They do not test `handleSaveDriver` in `App.js`, writing `pickup_lat`, `pickup_lng`, and `pickup_label` to Supabase, or displaying the ride on the Map tab. All four cases could pass while a saving bug still sends riders to the wrong place.

I am leaving this out for now because a real test would need a test database or a fake version of it, and this assignment must not change Supabase records.

**Partial manual observation (November 7, 2026):** in manual check GPS-6, one submitted ride kept its selected pickup, and the Map tab showed it correctly, on a physical iPhone 11 with iOS 26. That is one observation, not a repeatable test. The automated tests still don't cover this behavior, and the saved coordinates were not compared with the landmark's.

Other gaps to keep in mind:

- **Real GPS hardware:** fake GPS answers test the app's decisions, not how accurate a real phone is. Fondren Library and Hughes-Trigg are only about 110 m apart, and Balanced accuracy is about 100 m, so a real phone standing between them could reasonably choose either one.
- **Recent positions:** because a position up to 2 minutes old can be used, a driver who just moved could get the previous nearby landmark.
- **Other results:** the timeout, Location Services off, and general error results are not among these four cases.
- **Step 2 itself:** these tests do not check that the map zoom controls work. Step 2 needs its own check. Those checks are now listed under [Step 2 test cases](#step-2-test-cases-map-zoom-controls). Because they use a fake map, they cannot show that the real map visibly zooms or respects the limits. Only the manual checks MZ-1 to MZ-4 cover that, and only on the devices tried.

## Making the tests repeatable

### Recommended approach

Use automated component tests with **Jest** and **React Native Testing Library**, the tools recommended in Expo's unit testing guide. Use a short manual check to confirm the behavior on a simulator or phone.

Fake only `expo-location`, the point where the app talks to the phone's location system. Keep `RideForm`, `lib/currentLocation.js`, and `lib/nearestPickup.js` real, so the tests exercise the actual decision logic. Each test then gets the same GPS answer every time, regardless of where the tester is standing.

### Files to keep in the repository

| File | Purpose |
| --- | --- |
| `__tests__/pickup-selection-test.js` | The automated versions of TC-01 to TC-04 |
| `__tests__/map-zoom-test.js` | Step 2: the automated versions of Z-01 to Z-09 and R-01 (to be written in Step 2) |
| `__tests__/messaging-data-test.js` | Messaging: MD-01 to MD-13 (data layer, `lib/messaging.js`) |
| `__tests__/messaging-conversation-test.js` | Messaging: MC-01 to MC-12 (conversation screen and polling) |
| `__tests__/messaging-entry-points-test.js` | Messaging: ME-01 to ME-11 (Message buttons, including on Past rides, and the Messages list with its Active and Read-only groups) |
| `package.json`, `package-lock.json` | Test tools, their versions, and the test command |
| `PROTOTYPE-9-TEST-PLAN.md` | Test cases, manual steps, and results |
| `test-results/*.txt` | Saved output from each run |

Save results as `.txt` files because `.gitignore` excludes `*.log`.

### Setup

The test tools are installed as dev dependencies, so they are not part of the app itself:

| Package | Version | Why this version |
| --- | --- | --- |
| `jest-expo` | 58.0.14 | Matches Expo SDK 58 |
| `jest` | 30.5.2 | Expo's guide says `jest-expo` needs Jest 30 on SDK 58 and later |
| `@testing-library/react-native` | 14.1.0 | Current release; needs React 19 or later and React Native 0.78 or later |
| `test-renderer` | 1.3.1 | Required by Testing Library 14 |
| `@react-native/jest-preset` | 0.88.1 | Required by `jest-expo` 58 |

After cloning the repository, run `npm ci` to install them, then `npm test` to run the tests. `package.json` holds the test command and the `jest-expo` preset.

Only the icon font and `expo-location` are faked. No fake was needed for the date picker.

### How the test file should work

- **Test wrapper:** `App.js` normally holds the form's values, so use a small wrapper that holds `pickupInput` in state and renders the real `RideForm`.
- **Supabase:** pass a fake `handleSaveDriver`. `RideForm` does not import `lib/supabase`, so these tests have no reason to touch the database.
- **TC-03:** make `getCurrentPositionAsync` return a promise that the test resolves itself. That makes "the lookup is still running" happen reliably.
- **Finding elements:** use what the driver sees, such as button text and chip labels, so the app does not need changes for testing.
- **Recent positions:** return `null` from `getLastKnownPositionAsync` unless a test is about recent positions.

### Manual test notes

- Wait more than 2 minutes after changing a simulated location, or the app may reuse the previous position.
- For a real iPhone near SMU, record where you stood and which landmark was chosen. Do not expect an exact landmark if you are between two close ones.

### Run order

1. **By November 5:** commit this plan so the predictions are recorded before any test runs.
2. **Add the tests:** commit the test tools and test file, and record that commit.
3. **Confirm the app code is unchanged:** this command should print nothing:
   ```sh
   git diff 2e175db HEAD -- App.js index.js lib screens components theme
   ```
4. **Baseline run:** save the output, then fill in the results and run log.
   ```sh
   npm test -- --ci --verbose --reporters=default 2>&1 | tee test-results/baseline-$(git rev-parse --short HEAD).txt
   ```
   `--reporters=default` is needed here because `--verbose` alone did not list individual test names on this project.
5. **Make the change:** implement Step 2, together with `__tests__/map-zoom-test.js`, and commit it. Before committing, prove the new tests can fail (see [Rules for honest results](#rules-for-honest-results)).
6. **Confirm the GPS tests and pickup files are unchanged:** both commands should print nothing. The tests commit from step 2 is `0008c88`. (Step 2 adds a new test file, so only the original GPS test file is compared, not the whole `__tests__` folder.)
   ```sh
   git diff 0008c88 HEAD -- __tests__/pickup-selection-test.js
   git diff 0008c88 HEAD -- screens/RideForm.js lib/currentLocation.js lib/nearestPickup.js lib/pickupLocations.js
   ```
7. **Rerun:** run the same command, saving the output as `test-results/after-step-2-<hash>.txt`. This runs the original GPS tests and the new Step 2 tests together. Record the full and short hash of the Step 2 commit, then compare the results.
8. **Manual checks:** do MZ-1 to MZ-4 on the Step 2 commit and record the device, the iOS version, and the results.

### Rules for honest results

- If a test fails, record **Fail** and investigate. Do not change an expected result just to match what happened.
- If an expected result turns out to be wrong, explain why and record the change separately.
- Prove the tests can fail by breaking the app temporarily and restoring it afterward. This has been done once; see [Run log](#run-log).

### What the rerun will and will not show

The current code suggests Step 2 will mainly affect the map files, `screens/MapScreen.js` and `components/PickupMapPreview.js`, while pickup selection is in `screens/RideForm.js`, which does not contain a map. If Step 2 leaves those pickup files alone, a passing rerun is a **regression check**: it shows that the map work did not break pickup selection. It does not show that the zoom controls work.

## Run log

| Run | Commit tested | App code compared with `2e175db` | Date | Method | Results | Output file |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline, tests not yet committed | `d9ff1c06f644f16904627f0f990da544d3b3c22f` plus uncommitted `__tests__/`, `package.json`, and `package-lock.json` | Identical | November 4, 2026 | Automated | 5 passed, 0 failed | `test-results/baseline-d9ff1c0-uncommitted-tests.txt` |
| Baseline, tests committed (official) | `0008c882df703c53caf1d291d4f0e733aaa22366` (short: `0008c88`) | Identical | November 4, 2026 | Automated | 1 suite passed; 5 tests passed, 0 failed; 0.578 s | `test-results/baseline-0008c88.txt` |
| Manual check defined in TC-02 A | App code of `71dfcd2` (HEAD was `a0b5352`, a documentation-only commit with identical app code) | Changed only by Step 2 | November 7, 2026 | Manual, user-observed, Expo Go on a physical iPhone 11 with iOS 26, as TC-02's method specifies | Pass | None (manual; results recorded in this plan) |
| Manual checks defined in TC-01 and TC-04 (iOS Simulator) | Not Run | Not Run | Not Run | Not Run | Not Run | Not Run |
| After Step 2 (official; automated: TC-01 to TC-04, Z-01 to Z-09, R-01) | `71dfcd275fa0454f2b14a89d2221186f347a9a6c` (short: `71dfcd2`) | Changed only by Step 2: `screens/MapScreen.js` and new `lib/mapZoom.js`. Pickup files identical | November 7, 2026 | Automated | 2 suites passed; 16 tests passed, 0 failed; 0.772 s; exit status 0 | `test-results/after-step-2-71dfcd2.txt` |
| Additional GPS manual checks (GPS-1 to GPS-6) | App code of `71dfcd2` (HEAD was `a0b5352`, a documentation-only commit with identical app code) | Changed only by Step 2 | November 7, 2026 | Manual, user-observed, Expo Go on a physical iPhone 11 with iOS 26 | GPS-1 to GPS-6 Pass. No expected results recorded in advance | None (manual; results recorded in this plan) |
| Step 2 manual checks (MZ-1 to MZ-4) | App code of `71dfcd2` (HEAD was `a0b5352`, a documentation-only commit with identical app code) | Changed only by Step 2 | November 7, 2026 | Manual, user-observed, Expo Go on a physical iPhone 11 with iOS 26 | MZ-1 Pass, MZ-2 Pass, MZ-3 Pass, MZ-4 Pass | None (manual; results recorded in this plan) |
| Messaging baseline, before any messaging work (Messaging Step 0) | `8ad35330c2d7fc45c882917f3ad147b016e68273` (short: `8ad3533`) on `feature/ride-messaging` | App code identical to `71dfcd2` (8ad3533 added only SQL and documentation) | November 8, 2026 | Automated | 2 suites passed; 16 tests passed, 0 failed; exit status 0 | `test-results/baseline-8ad3533-ride-messaging.txt` |
| Messaging tests written, no messaging code (Messaging Step 1) | `8ad3533` plus the uncommitted messaging test files and this plan | Identical to `8ad3533` | November 8, 2026 | Automated, full suite | Jest: 2 suites passed, 3 failed; 26 tests passed, 10 failed; exit status 1. The 16 earlier tests passed. Messaging: 10 passed, 10 failed, and 99 didn't run (2 suites couldn't load). All failures were expected. See [Result before implementation](#result-before-implementation-messaging-step-1). | `test-results/messaging-step1-8ad3533-uncommitted-tests.txt` |
| Off switch only (Messaging Step 2): new `lib/messaging.js` containing only `isMessagingEnabled()`, not imported by the app | `8ad3533` plus uncommitted `lib/messaging.js`, the messaging tests and this plan | Identical to `8ad3533` apart from the new, unimported `lib/messaging.js` | November 8, 2026 | Automated, full suite | Jest: 2 suites passed, 3 failed; 33 tests passed, 76 failed; exit status 1. The 16 earlier tests passed. **MD-12 (all 6) passed.** The 66 MD failures were expected: 65 because data-layer functions are added in Step 3, and MD-13 A because the `./supabase` import also comes in Step 3. The MC suite still can't load (`screens/ConversationScreen`, Step 4). ME: unchanged from Step 1 (10 passed, 10 failed). | `test-results/messaging-step2-8ad3533-uncommitted.txt` |
| Data layer (Messaging Step 3): `lib/messaging.js` implemented; `expo-crypto` 58.0.7 installed with `npx expo install expo-crypto` | `8ad3533` plus uncommitted `lib/messaging.js`, `package.json`, `package-lock.json`, the messaging tests and this plan | Identical to `8ad3533` apart from the new `lib/messaging.js`, which the app still doesn't import | November 8, 2026 | Automated, full suite | Jest: 3 suites passed, 2 failed; 100 tests passed, 10 failed; exit status 1. The 16 earlier tests passed. **MD: 74 of 74 passed**, including MD-13 B (no network request). The 10 failures are the expected ME failures from Step 1 (Message buttons and the Messages list, Steps 4–5). The MC suite still can't load (`screens/ConversationScreen`, Step 4). | `test-results/messaging-step3-8ad3533-uncommitted.txt` |
| Conversation screen (Messaging Step 4): `screens/ConversationScreen.js`, `lib/useRideConversation.js`, `components/MessageBubble.js`, `components/MessageComposer.js`, `lib/messageThread.js`; the text rules moved to `lib/messageText.js` | `8ad3533` plus all uncommitted messaging files, `package.json`, `package-lock.json` and this plan | Identical to `8ad3533` apart from the new, unconnected messaging files (`App.js` and the existing screens and components are unchanged) | November 8, 2026 | Automated, full suite | Jest: 4 suites passed, 1 failed; 126 tests passed, 10 failed; exit status 1. The 16 earlier tests passed. **MD: 74 of 74. MC: 26 of 26.** The 10 failures are the expected ME failures (Message buttons and the Messages list, Step 5). No network request: MD-13 B passed, and the MC suite never loads `lib/supabase` (which throws without its environment variables). | `test-results/messaging-step4-8ad3533-uncommitted.txt` |
| Integration (Messaging Step 5): Message buttons and the Messages list connected; `ConversationScreen` opened from `App.js`. Changed: `App.js`, `screens/RequestsScreen.js`, `screens/RideDetailsScreen.js`, `components/AppButton.js` (optional `accessibilityLabel`), `lib/rideStatus.js` (`isMessagingWindowOpen`) | `8ad3533` plus all uncommitted messaging files, `package.json`, `package-lock.json` and this plan | Changed by Steps 1–5 only. `.env.local`, `eas.json`, `app.json` and `supabase/` unchanged | November 9, 2026 | Automated, full suite, `EXPO_PUBLIC_MESSAGING_ENABLED` unset | Jest: 5 suites passed; **136 tests passed, 0 failed**; exit status 0. **ME: 20 of 20** (the 10 expected failures from Steps 1–4 now pass; the 10 that check absence still pass). **MC: 26 of 26. MD: 74 of 74.** The 16 earlier tests passed. No network request: MD-13 B passed. No expected result was changed. | `test-results/messaging-step5-8ad3533-uncommitted.txt` |
| Fixes #1 and #2 tests written, before the app change (Messaging Step 6) | `8ad3533` plus all uncommitted messaging work; ME-08 A updated, ME-10 and ME-11 added | Same as Step 5 | November 9, 2026 | Automated, full suite, `EXPO_PUBLIC_MESSAGING_ENABLED` unset | Jest: 4 suites passed, 1 failed; 141 tests passed, **13 failed**; exit status 1. All 13 failures were expected and for the intended reason: ME-08 A ("Ride cancelled" not found), ME-10 A, B, C (1 h 59 min, both modes) and E (both modes) (no Message button on Past rides / no Read-only group), ME-11 A, B, D, E, F, G (no groups, or the "3" count badge). The new tests that check absence (ME-10 C at 2 h and 3 h, ME-10 D, ME-11 C) already passed. The 136 Step 5 tests other than ME-08 A passed. | `test-results/messaging-step6-8ad3533-uncommitted-tests.txt` |
| Fixes #1 and #2 (Messaging Step 6): Message buttons on Past-ride cards until 2 h after departure, both modes; Messages list split into Active / Read-only by `canSend`, count badge removed, read-only rows show the server state's reason. Changed: `screens/RequestsScreen.js` only | Same as the row above | Changed by Steps 1–6 only. `supabase/`, `.env.local`, `eas.json`, `app.json`, `lib/messaging.js` (flag) unchanged | November 9, 2026 | Automated, full suite, `EXPO_PUBLIC_MESSAGING_ENABLED` unset | Jest: 5 suites passed; **154 tests passed, 0 failed**; exit status 0. **ME: 38 of 38. MC: 26 of 26. MD: 74 of 74.** The 16 earlier tests passed. No network request: MD-13 B passed. | `test-results/messaging-step6-8ad3533-uncommitted.txt` |

The first row cannot name a single commit that contains the tests, because they were not committed when it ran. The saved output records the SHA-256 of the test file: `97fa4d1a1ef82da49bfc9bb303beec570861914c84f0eb5423d7f1d09db33d39`. The "tests committed" row is the one to use as the before-Step-2 comparison.

For the official baseline at `0008c88`, `git diff 2e175db HEAD -- App.js index.js lib screens components theme` printed nothing, confirming the app code is the same as `2e175db`. Individual results: TC-01 Pass, TC-02 A Pass, TC-02 B Pass, TC-03 Pass, TC-04 Pass.

For the after-Step-2 run at `71dfcd2`:

- These commands each printed nothing, confirming the original GPS tests and the pickup files are the same as at the baseline:
  - `git diff 0008c88 HEAD -- __tests__/pickup-selection-test.js`
  - `git diff 0008c88 HEAD -- screens/RideForm.js lib/currentLocation.js lib/nearestPickup.js lib/pickupLocations.js`
- The GPS test file's SHA-256 is still `97fa4d1a1ef82da49bfc9bb303beec570861914c84f0eb5423d7f1d09db33d39`, the same as at the baseline.
- `git diff --stat 2e175db HEAD -- App.js index.js lib screens components theme` listed only `lib/mapZoom.js` and `screens/MapScreen.js`.
- The command was run with `set -o pipefail`, so the recorded exit status (0) is the test command's own, not `tee`'s.
- Individual results: TC-01 Pass, TC-02 A Pass, TC-02 B Pass, TC-03 Pass, TC-04 Pass, Z-01 to Z-07 Pass, Z-08 A Pass, Z-08 B Pass, Z-09 Pass, R-01 Pass.
- Z-08 has two parts, so the 9 Z cases plus R-01 make 11 tests, the same way TC-02 counts as two.

### Problem found while setting up the tests

On the first run, TC-03 failed with a 5-second timeout while the other 4 tests passed. **The fault was in the test, not the app.** `fireEvent.press` waits for the press handler to finish, the handler was waiting for the GPS answer, and the test released that answer only after the press finished. The test now starts the press, performs the remaining steps, and then waits for it. The expected result did not change, and the app code was not touched.

### Proof that the tests can fail

On November 4, 2026, each change below was made temporarily to the app code, the tests were run, and the code was restored. Afterward, `git diff` showed no app code changes. None of these changes was committed.

| Temporary break | Failed tests | Passed tests |
| --- | --- | --- |
| Remove the check that ignores a cancelled lookup's late answer | TC-03 | TC-01, TC-02 A and B, TC-04 |
| Skip the permission-denied check | TC-02 A and B | TC-01, TC-03, TC-04 |
| Raise the distance limit from 1,500 m to 2,000 m | TC-04 | TC-01, TC-02 A and B, TC-03 |
| Store the phone's coordinates instead of the landmark's | TC-01 | TC-02 A and B, TC-03, TC-04 |

**Step 2 tests.** On November 7, 2026, before the Step 2 commit, each bug below was put into the Step 2 code temporarily and the full suite was run. The code was then restored from a saved copy, and `cmp` confirmed both files were byte-for-byte identical to the originals. After restoring, all 16 tests passed. The committed files at `71dfcd2` are those restored files. None of these bugs was committed.

| Temporary bug | Failed tests | Passed tests |
| --- | --- | --- |
| Remove the limits in `zoomRegion` | Z-03, Z-04, Z-08 A, Z-08 B | All others, including all 5 GPS tests |
| Always zoom from `SMU_MAP_REGION` instead of the latest region | Z-03, Z-04, Z-05 | All others, including all 5 GPS tests |
| Re-center ignores an open route | Z-09 | All others, including all 5 GPS tests |
| Remove the checks for a missing map ref | Z-07 | All others, including all 5 GPS tests |
| Zooming closes the pin preview | R-01 | All others, including all 5 GPS tests |

A first attempt at the missing-ref bug changed only the helper `readyMap()`. Each button handler still checked for a missing map itself, so no test failed. That attempt didn't actually break the app's behavior, so it was not counted. Removing the handlers' checks as well made Z-07 fail.

## Comparison of results

| Test | Baseline | After Step 2 | Same result? | Notes |
| --- | --- | --- | --- | --- |
| TC-01 | Pass (automated, official baseline `0008c88`) | Pass (automated, `71dfcd2`) | Yes | |
| TC-02 (A) | Pass (automated, official baseline `0008c88`) | Pass (automated, `71dfcd2`) | Yes | |
| TC-02 (B) | Pass (automated, official baseline `0008c88`) | Pass (automated, `71dfcd2`) | Yes | |
| TC-03 | Pass (automated, official baseline `0008c88`) | Pass (automated, `71dfcd2`) | Yes | Failed once because of a test bug, since fixed. See [Run log](#run-log). |
| TC-04 | Pass (automated, official baseline `0008c88`) | Pass (automated, `71dfcd2`) | Yes | |

**Summary:** all 5 original GPS tests gave the same result before and after Step 2 (Pass at `0008c88`, Pass at `71dfcd2`). This is a regression check: the map zoom work did not break pickup selection.

**Step 2 tests.** These test the new feature, so they have no baseline result: the zoom controls don't exist at `0008c88`.

| Test | Type | Baseline | After Step 2 | Notes |
| --- | --- | --- | --- | --- |
| Z-01 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| Z-02 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| Z-03 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| Z-04 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| Z-05 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| Z-06 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| Z-07 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| Z-08 | Automated (unit) | N/A (added in Step 2) | A Pass, B Pass (`71dfcd2`) | |
| Z-09 | Automated | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| R-01 | Automated (regression) | N/A (added in Step 2) | Pass (`71dfcd2`) | |
| MZ-1 | Manual | N/A | Pass (user-observed, iPhone 11, iOS 26) | |
| MZ-2 | Manual | N/A | Pass (user-observed, iPhone 11, iOS 26) | Both A and B |
| MZ-3 | Manual | N/A | Pass (user-observed, iPhone 11, iOS 26) | Depends on a map-level zoom limit; see the note under [Manual checks](#manual-checks) and K-1 under [Discrepancies](#discrepancies). |
| MZ-4 | Manual | N/A | Pass (user-observed, iPhone 11, iOS 26) | Checked on the iPhone 11's 6.1-inch screen only; smaller screens not checked |

**GPS manual checks defined in the test cases.** These were not run at the baseline.

| Check | Method specified | Baseline | After Step 2 | Notes |
| --- | --- | --- | --- | --- |
| TC-01 manual | iOS Simulator, custom location | Not Run | Not Run | |
| TC-02 A manual | iPhone, permission set to Never | Not Run | Pass (user-observed, physical iPhone 11, iOS 26) | The button state and "no position read" were not reported |
| TC-04 manual | iOS Simulator, custom location | Not Run | Not Run | |

**Additional GPS manual checks.** These were not defined before testing and were not run at the baseline, so there is no before-and-after comparison.

| Check | Type | Baseline | After Step 2 | Notes |
| --- | --- | --- | --- | --- |
| GPS-1 | Manual | Not run | Pass (user-observed, iPhone 11, iOS 26) | Chosen landmark and tester's position not recorded |
| GPS-2 | Manual | Not run | Pass (user-observed, iPhone 11, iOS 26) | |
| GPS-3 | Manual | Not run | Pass (user-observed, iPhone 11, iOS 26) | |
| GPS-4 | Manual | Not run | Pass (user-observed, iPhone 11, iOS 26) | Not the same as TC-02 A's manual check; see D-1 |
| GPS-5 | Manual | Not run | Pass (user-observed, iPhone 11, iOS 26) | |
| GPS-6 | Manual | Not run | Pass (user-observed, iPhone 11, iOS 26) | One observation of part of the uncovered behavior |

## Discrepancies

Each case where an actual result differs from its expected result gets an entry here: the test, what was expected, what happened, the cause, and whether the fault was in the app or the test. Expected results are never edited to match what happened.

**Official runs:** in the official after-Step-2 run at `71dfcd2`, every automated actual result matched its recorded expected result. No expected result was changed. The manual checks MZ-1 to MZ-4 also matched their expected results when checked by hand (user-observed on a physical iPhone 11 with iOS 26, in Expo Go). For MZ-3, strict `maxZoomLevel` enforcement remains unverified (K-1).

The items below are not mismatches in the official run. They are recorded so the full history is visible.

### D-1: The GPS manual checks performed don't match the ones the plan defined

| Field | Details |
| --- | --- |
| **What the plan defined** | Three manual repeats, each with an "Actual result" and a "Status" field (six "Not Run" entries in all):<br>**TC-01:** iOS Simulator, custom location `32.8446, -96.7836`. Expects Fondren Library, an exact info message, and no Try Again or Open Settings.<br>**TC-02 A:** iPhone, permission set to Never, with Hughes-Trigg already selected. Expects Hughes-Trigg kept, an exact warning, and Try Again plus Open Settings.<br>**TC-04:** iOS Simulator, custom location `32.8597, -96.7849`, with Moody Coliseum selected. Expects Moody kept, the "more than about 1.5 km" warning, and no Try Again. |
| **What was performed** | GPS-1 to GPS-6, on a physical iPhone 11 at the tester's real location, with no expected results recorded in advance. |
| **Mismatch** | No GPS check uses TC-01's or TC-04's simulated locations, or checks their exact landmark and message. GPS-4 is the closest to TC-02 A, but it checked only that the app didn't crash and that manual selection still worked. It didn't check that an existing pickup was kept, the warning text, or the buttons. |
| **How it is recorded** | The TC-01 and TC-04 manual checks stay **Not Run**, and their test cases are unchanged. TC-02 A's own manual check was later done as specified (on an iPhone) and passed. It is recorded in TC-02, not as GPS-4. GPS-1 to GPS-6 are recorded separately under [Additional GPS manual checks](#additional-gps-manual-checks-user-observed). |

### T-1: Six Step 2 tests failed on their first run because of a test bug

| Field | Details |
| --- | --- |
| **When** | November 7, 2026, during development, before the Step 2 commit (no commit contained this version of the test file) |
| **What happened** | 6 of the 11 new tests failed: Z-04, Z-05, Z-06, Z-07, Z-09, and R-01. The output showed "You seem to have overlapping act() calls" and "Unable to find an element with role: button, name: Zoom in". Z-01 to Z-03, Z-08 A and B, and all 5 GPS tests passed. |
| **Cause** | **The fault was in the test, not the app.** In React Native Testing Library 14, `fireEvent.press` is asynchronous. The test's `press` helper was called without `await`, so each test's presses overlapped with the next test's render, and later tests couldn't find the screen. This is the same kind of problem as the TC-03 setup issue in the [Run log](#run-log). |
| **Correction** | Every `press(...)` and region-change call in `__tests__/map-zoom-test.js` was awaited. Z-07's "does not throw" check was rewritten to await the presses. No expected value, app code, or GPS test was changed. |
| **Result after the correction** | 16 of 16 passed, then 16 of 16 again in the official run at `71dfcd2`. |

### M-1: Testing method clarification (icon font)

The Step 2 method description said only `react-native-maps` and `fetchDrivingRoute` would be faked. The test file also fakes the icon font, as the GPS tests do. This is a missing detail in the description, not a change in what is tested. See the clarification under [Automated tests](#automated-tests).

### K-1: Known limitation: the map-level zoom limit on iOS (not verified on a device)

| Field | Details |
| --- | --- |
| **Affects** | MZ-3 (short route framing), and the closest-in limit when pinching. The Zoom in button's own limit (Z-03) is not affected. |
| **What is known** | `71dfcd2` sets `maxZoomLevel={18}` on the Map tab's `MapView`. react-native-maps 1.29.11 marks `maxZoomLevel` as deprecated on Apple Maps. Its iOS code applies the limit only after the map stops moving, by animating back. Apple Maps is the iOS map this app uses. Level 18 matches the buttons' `0.002` limit only roughly, depending on screen width. |
| **Possible effect** | On iPhone, a route between two close points (such as Hughes-Trigg to Fondren) may briefly zoom in closer than the limit, then settle back to it. On a wide screen, the map's limit and the buttons' limit may not match exactly. |
| **Verified?** | **Partly.** The limitation itself comes from reading the library's documentation and source code. On November 7, 2026, MZ-3 passed when checked by hand on a physical iPhone 11 (iOS 26): the short route displayed correctly with both endpoints visible. A brief native zoom past the limit was not independently checked, so the result neither confirms nor rules out an overshoot, and strict `maxZoomLevel` enforcement remains unverified. It was checked on one device only: a physical iPhone 11 with iOS 26, in Expo Go. MZ-3's expected result is unchanged. |
| **Not used** | `cameraZoomRange` is a hard limit on iOS 13 and later, but react-native-maps does not support it on Android. It was not used, to keep to the planned design. |

### A-1: Messaging Step 3: MD-13 A failed on its first run because of an app comment

| Field | Details |
| --- | --- |
| **When** | November 8, 2026, during Messaging Step 3, before anything was committed |
| **What happened** | 72 of 73 data-layer tests passed. MD-13 A failed: its scan for secret-key references (`/service[_-]?role\|secret/i`) matched a comment in `lib/messaging.js` that read "This flag is not a secret". |
| **Cause** | **The fault was in the app file, not the test.** No key was present; the comment's wording tripped a deliberately strict check. |
| **Correction** | The comment was reworded ("The flag isn't hidden…"). The test was not changed. |
| **Result after the correction** | 73 of 73 passed (74 of 74 once M-2's case was added). |

### M-2: Messaging Step 3: one data-layer test added after the proof run

When the data-layer tests were checked for failing (see [Messaging Step 3: proof that the data-layer tests can fail](#messaging-step-3-proof-that-the-data-layer-tests-can-fail)), making `canSend` come from `state === 'open'` instead of `can_send` was caught by only one test: the `can_send: null` case. In MD-07's four main cases, the state always agrees with `can_send`. The requirement that the server's `can_send` is never re-derived on the phone deserved a direct check, so one MD-07 case was **added**: state `open` with `can_send: false` must give `canSend: false`. No existing expected result was changed. With the same temporary bug, both that case and the null case failed. With the real code, 74 of 74 passed.

### Messaging Step 3: proof that the data-layer tests can fail

On November 8, 2026, each bug below was put into `lib/messaging.js` temporarily and the data-layer tests were run. The file was then restored from a saved copy, and `cmp` confirmed it was byte-for-byte identical. None of these bugs was committed.

| Temporary bug | Failed tests | Passed tests |
| --- | --- | --- |
| `canSend` taken from `state === 'open'` instead of `can_send` | MD-07 (`can_send` null); after M-2, also MD-07 (`open` with `can_send` false) | All others |
| Length counted in UTF-16 units instead of characters | MD-09 F (1,000 emoji) | All others |
| `55P03` treated as an unknown error | MD-08 `55P03`, for all 4 RPC functions | All others |
| A rider's call sends a made-up `p_rider_id` | MD-01 | All others |
| Messages not sorted oldest first | MD-06 A | All others |

Sending `p_rider_id: null` for a rider was **not** used as a bug: the SQL defaults that argument to null, so it is allowed, and MD-01 deliberately accepts it.

**Request check against the real library (scratchpad only).** The data layer was also run against a real supabase-js 2.117 client whose `fetch` only recorded each request and answered locally, using the URL `https://example.invalid`. Nothing left the machine. The recorded requests matched `messaging-1-tables.sql`:
- POST `/rest/v1/rpc/open_my_ride_conversation` with `{"p_ride_id":…}`, and with `p_rider_id` added for a driver
- POST `/rest/v1/rpc/list_my_ride_conversations` with `{}`, and with `{"p_conversation_id":…}` for one conversation
- POST `/rest/v1/rpc/send_my_ride_message` with `p_conversation_id`, `p_client_message_id` and the trimmed `p_body`
- GET `/rest/v1/ride_messages` selecting the 6 columns, filtered by `conversation_id=eq.…` (plus `created_at=gte.…` when polling), ordered `created_at.desc,id.desc`, limited to 200

### T-2: Messaging Step 4: 18 conversation-screen tests failed on their first run because of a test bug

| Field | Details |
| --- | --- |
| **When** | November 8, 2026, during Messaging Step 4, before anything was committed |
| **What happened** | 8 of 26 passed. Every test that ran after MC-04 failed, including tests that never send. For example, MC-10 A saw `loadMessages` called 0 times after rendering. The output showed "You seem to have overlapping act() calls". |
| **Cause** | **The fault was in the test, not the app**, the same kind of problem as T-1. MC-04 started `fireEvent.press` without awaiting it and then awaited another `act()`. MC-08 A started two presses without awaiting either. In Testing Library 14 every `fireEvent` runs inside an awaited `act()`, so overlapping calls broke React's act scope for the rest of the file. The tests were written that way on the assumption that the press handler would wait for the server. It doesn't: it starts the send and returns. |
| **Correction** | MC-04 now awaits its press. The send is still held pending by the test, so the "Sending…" checks are unchanged. MC-08 A now makes two awaited taps in a row while the first send is still pending, and is retitled from "a fast double tap" to "a double tap". **No expected result was changed.** |
| **What MC-08 A no longer shows** | Testing Library 14 has no synchronous press, so two taps that both arrive before React re-renders can't be produced without the overlapping `act()` that caused this bug. The screen still guards against that case: the draft is read and cleared through a ref, so a second tap in the same frame finds empty text. That guard is covered by code review only. |
| **Result after the correction** | 26 of 26 passed, with no act() warnings. |

### A-2: Messaging Step 4: the first load didn't run with real timers (app bug, found outside the suite)

| Field | Details |
| --- | --- |
| **When** | November 8, 2026, during Messaging Step 4, after all 26 MC tests passed |
| **How it was found** | A scratchpad check rendered the screen in dark mode **without** the suite's fake timers and fake `AppState`. It stayed on "Loading conversation…". The hook on its own made 0 calls. |
| **Cause** | **The fault was in the app.** `isActiveState` treated only `null`, `undefined`, `'active'` and `'unknown'` as active. In Jest's React Native setup, `AppState.currentState` is a mock **function**, so the hook decided the app was in the background and skipped its first load. On a real phone `currentState` is a string (or `null` at launch, which the old check accepted), so this failure is specific to that environment. It still showed that anything unexpected made the screen silently wait forever. |
| **Correction** | Only `'background'` and `'inactive'` now count as not active. Anything else, including a non-string, counts as active. With real timers, the hook loads at once ("status ready, calls 1") and the dark-mode render passes. |
| **Why the suite missed it** | Every MC test sets `AppState.currentState = 'active'` before rendering, so none of them mounts the screen in any other state (see U-2). The MC-10 E bug check (ignoring the background) was re-run after the fix and still fails as it should. |

### U-2: Messaging Step 4: behavior not covered by the automated tests

- **Mounting while the app isn't marked active:** every MC test starts with `AppState.currentState = 'active'` (see A-2).
- **Same-frame double tap:** covered by code review only (see T-2).
- **Real keyboard and scrolling:** `KeyboardAvoidingView` (`behavior="padding"` on both platforms, as Expo's keyboard guide recommends for edge-to-edge Android), scrolling to the newest message, and the composer's growth are visual. The planned manual checks MM-1 to MM-8 need the screen connected to `App.js` (Step 5).
- **Dark mode:** checked once from the scratchpad. The bubbles, background and text used the dark tokens (`#0F172A` background, `#3B82F6` mine, `#1E2B4D` theirs, `#F1F5F9` text). It isn't part of the committed suite.

### Messaging Step 4: proof that the conversation-screen tests can fail

On November 8, 2026, each bug below was put into the screen, the hook or `lib/messageThread.js` temporarily, and the 26 MC tests were run. Each file was then restored from a saved copy, and `cmp` confirmed it was byte-for-byte identical. None of these bugs was committed.

| Temporary bug | Failed tests | Passed tests |
| --- | --- | --- |
| Composer shown when `state` is `open`, instead of when `can_send` is true | MC-03 A and B | All others |
| Retry makes a new client id | MC-07 | All others |
| Polling ignores the app going to the background | MC-10 E (re-checked after A-2's fix: still fails) | All others |
| No overlap guard: a fixed 5 s interval | MC-10 G | All others |
| The server's copy doesn't replace a "Not sent" message | MC-08 C | All others |
| A poll starts reading 1 s **after** the newest message | MC-10 B | All others |
| No re-check after a refused send | MC-09 | All others |
| Polling not stopped on leaving the screen | MC-10 F | All others |

### Messaging Step 5: proof that the entry-point tests can fail

On November 9, 2026, each bug below was put into the Step 5 code temporarily and the 20 ME tests were run. Each file was then restored from a saved copy, and `cmp` confirmed it was byte-for-byte identical. None of these bugs was committed.

| Temporary bug | Failed tests | Passed tests |
| --- | --- | --- |
| Requests tab, rider: Message on every request, not just accepted ones | ME-05 | All others |
| The 2-hour window counts exactly 2 h after departure as still open (`<=` instead of `<`) | ME-07 (exactly 2 h) | All others |
| The Messages list ignores the flag | ME-01 C and D | All others |
| Ride Details: Message on every passenger row that isn't mine, without checking that I'm the ride's driver | ME-03, ME-04 B (pending, denied, cancelled) | All others |
| Messages list rows never marked "Read-only" | ME-08 A | All others |

### Messaging Step 6: proof that the new entry-point tests can fail

On November 9, 2026, each bug below was put into `screens/RequestsScreen.js` temporarily and the 38 ME tests were run. The file was then restored from a saved copy, and `cmp` confirmed it was byte-for-byte identical. None of these bugs was committed.

| Temporary bug | Failed tests | Passed tests |
| --- | --- | --- |
| Message buttons on the Requests tab ignore the 2-hour window (both window checks removed) | ME-10 C (exactly 2 h and 3 h, both modes), ME-10 E (both modes) | All others |
| Only the shared button's window check removed (the driver's Past card keeps its own) | ME-10 C (rider, exactly 2 h and 3 h), ME-10 E (rider) | All others. The driver's Past card is still guarded by its own check, so this is expected |
| Groups split by `state === 'open'` instead of `canSend` | ME-11 F | All others |
| Read-only group shown before Active | ME-08 A, ME-11 A | All others |
| Count badge put back on "Messages" | ME-11 E | All others |

### S-1: Messaging Step 5: App.js wiring checked from the scratchpad (not part of the suite)

No committed test renders `App.js`, so the wiring was checked with a temporary test that rendered the real `App.js` with a fake `lib/supabase` client (every call recorded and answered locally) and `global.fetch` replaced by a spy that fails. The file was run from `__tests__/`, then moved to the scratchpad, so it is **not** in the repository or in the 136 tests above.

| Check | Result |
| --- | --- |
| Flag unset: Requests tab and Ride Details show no Messages list, no Message button and no conversation row; Leave Seat and Leave are still there; **zero** messaging calls (no RPC, no `ride_messages` read) | Pass |
| Flag `"TRUE"` (not exactly `"true"`): same as unset, zero messaging calls | Pass |
| Flag `"true"`: no messaging call while on Home. Opening the Requests tab calls `list_my_ride_conversations` once with no arguments. The row for Dana uses her board profile name; the archived row's driver isn't on the board, so it reads "Your driver" and is marked read-only. **Message Dana Driver** calls `open_my_ride_conversation` with exactly `{ p_ride_id: 'ride-1' }` and opens the chat with the tab bar hidden. **Back** shows the Requests tab and the tab bar again and reloads the list. The archived row opens with the "This ride was cancelled…" notice and no composer. Ending the session while a chat is open returns to sign-in with the chat gone; signing in again opens Home with no chat and no messaging call | Pass |
| `fetch` calls in all three | 0 |

To check that these checks can fail, three bugs were put into `App.js` temporarily (restored from a saved copy each time, confirmed with `cmp`): the tab bar never hidden (the "flag on" check failed); sign-out not closing the chat (the "flag on" check failed); the list loaded without checking the flag (both flag-off checks failed).

### N-1: Messaging Step 5: decisions the plan didn't spell out

These are additions, not changes to any expected result.

- **The Messages list isn't filtered by mode.** Both modes list every conversation the server returns (as driver and as rider), so an archived chat is always reachable. Each row shows the other person's role.
- **The other person's name** comes from the profiles the board already loads. A conversation whose ride was cancelled (deleted) usually has no profile on the board, so it shows "Your driver" or "Your rider". No extra profile query was added.
- **Requests-tab Message buttons appear only on upcoming rides**, because that is where the existing actions are (rider: Confirmed cards; driver: Confirmed passengers). Between departure and departure + 2 h, Ride Details still shows the buttons (ME-07), and an existing chat is in the Messages list.
- **Who sees which button on Ride Details:** the driver's buttons need Driver mode, like Accept and Deny. A rider's button for the driver is on their own row in either mode, like Leave.
- **The 2-hour window and the phone's clock.** The window decides only whether a button is *shown*. It never authorizes anything: `open_my_ride_conversation` refuses to start a chat outside the rules, and the conversation screen sends only while the server's `can_send` is true. A phone with a wrong clock can show or hide a button, but it can't get around the server.
- **Opening a chat:** while `open_my_ride_conversation` is running, the tapped button shows a spinner and other Message buttons are disabled (`openingMessage` prop), and a second tap is ignored. A refusal or failure shows the server's message in the screen's existing notice, and nothing opens.
- **While a chat is open** it covers the whole app, including the tab bar. The tabs underneath stay mounted but hidden from screen readers, so Back returns to the same tab, the same Ride Details and the same scroll position. Android's back button also closes the chat.
- **New optional props**, which default to off: `isConversationsLoading` (Requests tab, shows "Loading conversations…" before the first answer) and `openingMessage` (both screens).

### U-3: Messaging Step 5: not covered by the committed automated tests

- `App.js` itself (see S-1: checked once from the scratchpad).
- Android's hardware back button closing a chat.
- On-device layout: Message buttons on narrow screens, the overlay above the keyboard, and returning to the same scroll position. These are covered by the manual checks MM-1 to MM-8, which need the local Supabase database and the flag set to `true` (not run yet).

### Future improvement: older messages

`loadMessages` returns the newest 200 messages in a conversation (decided November 8, 2026). Older messages aren't shown. With the server's limit of 20 messages per minute and short ride windows, this is expected to be enough for now. A "Load earlier messages" control (reading messages before the oldest one shown) is a possible later step and is not planned yet.

### U-1: Behavior added but not covered by a test

When a route is still loading (no road route yet), **Re-center map** frames the route's two pins. The plan did not describe this state, and no automated test covers it. Z-09 covers only a route that has finished loading.
