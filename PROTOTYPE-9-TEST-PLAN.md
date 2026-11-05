# CarpoolBoard Prototype 9: Test Plan

**Behavior under test:** choosing a ride's pickup spot, either with GPS ("Use My Location") or by hand.

**Why this behavior is essential:** a driver cannot post a ride without a pickup spot, and riders use that spot to find the ride. A wrong or unexpectedly changed pickup can send people to the wrong place.

**Status:** planned. No tests have been run yet.

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
| **Actual result** | Baseline: Not Run. After Step 2: Not Run. |
| **Pass/fail status** | Baseline: Not Run. After Step 2: Not Run. |

### TC-02: GPS permission denied while a pickup is selected

| Field | Details |
| --- | --- |
| **Purpose** | Confirm that refusing location access does not change or remove a pickup the driver already chose. |
| **Starting conditions** | Form is open. **Hughes-Trigg Student Center** is selected. Location Services are on. Location permission is denied. |
| **Action/input** | Tap **Use My Location**. Check two versions of the denial: **A**, `canAskAgain: false`, and **B**, `canAskAgain: true`. |
| **Expected result** | **Both versions:** the pickup stays Hughes-Trigg Student Center, the message is a warning, the button returns to "Use My Location", and the app does not try to read a position.<br><br>**A:** "Location access is off for this app. Turn it on in Settings, then try again. Your pickup is still Hughes-Trigg Student Center, or you can choose another spot below." Shows Try Again and Open Settings.<br><br>**B:** "Location access wasn’t allowed. Your pickup is still Hughes-Trigg Student Center, or you can choose another spot below." Shows Try Again only. |
| **Why this is correct** | A failed GPS attempt says nothing about whether the driver's earlier choice is wrong, so that choice must remain. The app also must not read a location without permission. Open Settings appears only when the app can no longer ask for permission itself. |
| **Test method** | Automated component test for A and B. Repeat A manually on an iPhone by setting the app's location permission to Never. Expo's iOS code reports `canAskAgain: false` for a denied permission, so B is expected to need the automated test or Android. |
| **Actual result** | Baseline: Not Run. After Step 2: Not Run. |
| **Pass/fail status** | Baseline: Not Run. After Step 2: Not Run. |

### TC-03: Manual pickup selected while a GPS lookup is running

| Field | Details |
| --- | --- |
| **Purpose** | Confirm that a late GPS answer cannot replace a spot the driver has just chosen by hand. |
| **Starting conditions** | Form is open. No pickup is selected. Permission is granted. No recent position is available, and the new position is held back so the lookup keeps running. |
| **Action/input** | 1. Tap **Use My Location**.<br>2. While it shows "Finding nearest landmark…", tap the **Meadows Museum** chip.<br>3. Release the held GPS answer: `32.8446, -96.7836`, which is nearest Fondren Library. |
| **Expected result** | After step 2, the pickup is Meadows Museum and the button immediately returns to "Use My Location".<br><br>After step 3, the pickup is **still Meadows Museum**, and no "Pickup set to…" message or warning appears. |
| **Why this is correct** | The driver's latest deliberate choice is the best evidence of what they want. Tapping the chip increases `locateRequest`, so the older lookup's number no longer matches and its answer is ignored. |
| **Test method** | Automated component test using a fake GPS answer that the test releases on demand. This is the main method because a real fix can return too quickly to tap a chip in time, and the result cannot be controlled. |
| **Actual result** | Baseline: Not Run. After Step 2: Not Run. |
| **Pass/fail status** | Baseline: Not Run. After Step 2: Not Run. |

### TC-04: Too far from SMU while a pickup is selected (related prediction)

| Field | Details |
| --- | --- |
| **Purpose** | Test the 1,500 m limit just outside the allowed range and confirm that the existing pickup is kept. |
| **Starting conditions** | Form is open. **Moody Coliseum** is selected. Location Services are on and permission is granted. No recent position is available. |
| **Action/input** | Tap **Use My Location**. The new position is `32.8597, -96.7849`, north of campus. |
| **Expected result (prediction)** | The pickup stays Moody Coliseum. The warning reads: "You’re more than about 1.5 km from the SMU pickup spots, so we can’t choose one automatically. Your pickup is still Moody Coliseum, or you can choose another spot below." **No Try Again button appears.** |
| **Why this is correct** | The nearest landmark, Dallas Hall, is about 1,606 m away, which is over the limit. The GPS worked, so retrying would not help unless the driver moves. That is different from a timeout, where retrying may succeed. |
| **Test method** | Automated component test. Repeat manually in the iOS Simulator using a custom location. |
| **Actual result** | Baseline: Not Run. After Step 2: Not Run. |
| **Pass/fail status** | Baseline: Not Run. After Step 2: Not Run. |

**Questions to discuss with the professor:**

- Is keeping the pickup right if the driver has moved and the old spot may no longer make sense? I predict the app keeps it, and I think that is reasonable because the message clearly names the spot still selected.
- Should this boundary also be tested just inside the limit? A follow-up input is `32.8579, -96.7849`, about 1,405 m from Dallas Hall, which should select Dallas Hall.

## An important behavior these tests do not cover

**These tests do not show that the chosen pickup is saved correctly or reaches riders.**

They stop at the form's displayed pickup. They do not test `handleSaveDriver` in `App.js`, writing `pickup_lat`, `pickup_lng`, and `pickup_label` to Supabase, or displaying the ride on the Map tab. All four cases could pass while a saving bug still sends riders to the wrong place.

I am leaving this out for now because a real test would need a test database or a fake version of it, and this assignment must not change Supabase records.

Other gaps to keep in mind:

- **Real GPS hardware:** fake GPS answers test the app's decisions, not how accurate a real phone is. Fondren Library and Hughes-Trigg are only about 110 m apart, and Balanced accuracy is about 100 m, so a real phone standing between them could reasonably choose either one.
- **Recent positions:** because a position up to 2 minutes old can be used, a driver who just moved could get the previous nearby landmark.
- **Other results:** the timeout, Location Services off, and general error results are not among these four cases.
- **Step 2 itself:** these tests do not check that the map zoom controls work. Step 2 needs its own check.

## Making the tests repeatable

### Recommended approach

Use automated component tests with **Jest** and **React Native Testing Library**, the tools recommended in Expo's unit testing guide. Use a short manual check to confirm the behavior on a simulator or phone.

Fake only `expo-location`, the point where the app talks to the phone's location system. Keep `RideForm`, `lib/currentLocation.js`, and `lib/nearestPickup.js` real, so the tests exercise the actual decision logic. Each test then gets the same GPS answer every time, regardless of where the tester is standing.

### Files to keep in the repository

| File | Purpose |
| --- | --- |
| `__tests__/pickup-selection-test.js` | The automated versions of TC-01 to TC-04 |
| `package.json`, `package-lock.json` | Test tools, their versions, and the test command |
| `PROTOTYPE-9-TEST-PLAN.md` | Test cases, manual steps, and results |
| `test-results/*.txt` | Saved output from each run |

Save results as `.txt` files because `.gitignore` excludes `*.log`.

### Setup

Jest is not installed yet. These commands come from Expo's guide:

```sh
npx expo install jest-expo jest --dev
npx expo install @testing-library/react-native --dev
```

Then add this to `package.json`:

```json
{
  "scripts": { "test": "jest" },
  "jest": { "preset": "jest-expo" }
}
```

This setup has not been tried on this project yet. The icon or date-picker packages may need small fakes to load under Jest. Those fakes belong in the test setup and must not require changes to the app's behavior.

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
   npx jest --ci --verbose 2>&1 | tee test-results/baseline-$(git rev-parse --short HEAD).txt
   ```
5. **Make the change:** implement Step 2 and commit it.
6. **Confirm the tests are unchanged:** this should print nothing, where `<tests-commit>` is the commit from step 2:
   ```sh
   git diff <tests-commit> HEAD -- __tests__
   ```
7. **Rerun:** run the same command, saving the output as `test-results/after-step-2-<hash>.txt`, and compare the results.

### Rules for honest results

- If a test fails, record **Fail** and investigate. Do not change an expected result just to match what happened.
- If an expected result turns out to be wrong, explain why and record the change separately.
- Prove the tests can fail: temporarily remove the `request !== locateRequest.current` check in a scratch copy or uncommitted change, confirm that TC-03 fails, then restore the code with `git restore screens/RideForm.js`. Do not commit this change.

### What the rerun will and will not show

The current code suggests Step 2 will mainly affect the map files, `screens/MapScreen.js` and `components/PickupMapPreview.js`, while pickup selection is in `screens/RideForm.js`, which does not contain a map. If Step 2 leaves those pickup files alone, a passing rerun is a **regression check**: it shows that the map work did not break pickup selection. It does not show that the zoom controls work.

## Run log

| Run | Commit tested | App code compared with `2e175db` | Date | Method | Results | Output file |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline | Not Run | Not Run | Not Run | Not Run | Not Run | Not Run |
| After Step 2 | Not Run | Not Run | Not Run | Not Run | Not Run | Not Run |

## Comparison of results

| Test | Baseline | After Step 2 | Same result? | Notes |
| --- | --- | --- | --- | --- |
| TC-01 | Not Run | Not Run | Not Run | |
| TC-02 (A) | Not Run | Not Run | Not Run | |
| TC-02 (B) | Not Run | Not Run | Not Run | |
| TC-03 | Not Run | Not Run | Not Run | |
| TC-04 | Not Run | Not Run | Not Run | |
