## Bug 1 — Returning Users Are Locked to Their Original Role

### Symptom
A returning user could not choose whether to use CarpoolBoard as a Driver or Rider.

For example, my account was originally created as a Driver. When I entered the same email on the login screen, CarpoolBoard recognized the account and automatically restored the Driver role. This prevented me from using the same account as a Rider.

### Evidence
Testing the app on my iPhone showed that returning-user login was based on the `role` value already stored in the user's profile.

I traced the login and profile logic and found that CarpoolBoard treated `profiles.role` as the user's permanent active role. The app did not separate the user's account identity from how they wanted to use CarpoolBoard during the current session.

### Fix
I separated the user's account identity from their active Driver/Rider mode.

The app now uses an `activeMode` state to determine whether the user is currently using CarpoolBoard as a Driver or Rider. The existing `profiles.role` value remains as the user's original signup role and is no longer used to permanently lock the user into that mode.

Returning users can now choose Driver or Rider when signing in. I also added a mode switch to the Profile screen so the user can switch between Driver and Rider without creating another account.

I tested the fix on my iPhone by switching the same account between Driver and Rider. The account information remained the same while the available actions changed correctly for each mode.


## Bug 2 — Uppercase Letters in Email Caused Supabase Error

### Symptom
When testing account creation and login, entering an email address with an uppercase letter caused CarpoolBoard to fail instead of creating or finding the account.

For example, an email entered with a capital letter was rejected even though the email address itself was valid.

### Evidence
During testing, Supabase returned an error because the `profiles` table requires stored emails to be lowercase.

The database has a constraint that checks that the email matches its lowercase and trimmed version. CarpoolBoard was sending the email exactly as the user typed it, so an uppercase letter could violate that constraint.

### Fix
I normalized email addresses before sending them to Supabase by trimming whitespace and converting the email to lowercase with:

`email.trim().toLowerCase()`

I tested the fix by entering an email with a capital letter. CarpoolBoard successfully processed the email and stored/used the lowercase version instead of producing the database error.

## Bug 3 — Ride Seat Count Could Conflict With Confirmed Riders

### Symptom
When editing an existing ride, the driver could potentially reduce the total number of seats below the number of already confirmed passengers.

For example, a ride with two confirmed riders should not be changed to only one total seat.

### Evidence
While implementing Supabase persistence in Prototype 4, I reviewed how CarpoolBoard stored confirmed riders.

Confirmed passengers were recorded in the `ride_requests` table with an `accepted` status. The ride-editing logic needed to account for those requests before updating the ride's seat count.

### Fix
I added validation that queries the number of accepted requests before saving changes to a ride.

If the new seat count is smaller than the number of confirmed riders, CarpoolBoard blocks the update and displays an error explaining the minimum required seats.

Available seats are calculated by subtracting accepted requests from the total seat count.

This prevents the app from saving a ride with fewer seats than confirmed passengers.