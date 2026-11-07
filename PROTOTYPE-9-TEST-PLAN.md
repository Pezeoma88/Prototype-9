# CarpoolBoard Prototype 9: Test Plan

**Behavior under test:** choosing a ride's pickup spot, either with GPS ("Use My Location") or by hand.

**Why this behavior is essential:** a driver cannot post a ride without a pickup spot, and riders use that spot to find the ride. A wrong or unexpectedly changed pickup can send people to the wrong place.

**Status:** official automated baseline run complete: 5 of 5 tests passed on November 4, 2026, at commit `0008c88`, which contains the committed tests. The official after-Step-2 automated run is also complete: 16 of 16 tests passed on November 7, 2026, at commit `71dfcd2` (the 5 original GPS tests plus 11 new Step 2 tests). The Step 2 manual checks MZ-1 to MZ-4 also passed (user-observed on a physical iPhone 11 with iOS 26, in Expo Go, November 7, 2026). Six additional GPS manual checks (GPS-1 to GPS-6, user-observed on the same iPhone) also passed. They are **not** the manual checks defined in the test cases. Of those, the TC-02 A manual check also passed on the same iPhone. The TC-01 and TC-04 Simulator manual checks are still Not Run. See [Additional GPS manual checks](#additional-gps-manual-checks-user-observed) and [Run log](#run-log).

**Step 2 (map zoom controls):** test cases and expected results recorded on November 7, 2026, **before** any Step 2 code was written. See [Step 2 test cases](#step-2-test-cases-map-zoom-controls). Step 2 was then implemented in commit `71dfcd2`. All automated Step 2 tests passed there. The manual checks MZ-1 to MZ-4 passed when checked by hand on a physical iPhone 11 (iOS 26, Expo Go) on November 7, 2026, against app code `71dfcd2`. These are user-observed results, not automated tests.

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

### U-1: Behavior added but not covered by a test

When a route is still loading (no road route yet), **Re-center map** frames the route's two pins. The plan did not describe this state, and no automated test covers it. Z-09 covers only a route that has finished loading.
