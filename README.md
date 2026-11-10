#CarpoolBoard — Prototype 9

**SMU Mobile App Development | Fall 2026**

CarpoolBoard is a mobile ridesharing application built with React Native and Expo. The app helps drivers offer rides and allows riders to find available transportation, request seats, and communicate with drivers.

Prototype 9 focuses on improving pickup locations, map navigation, and communication between drivers and riders.

## Features

### Ride Management
- Create rides with departure and destination information.
- Browse available rides.
- Request seats on available rides.
- Accept and manage ride requests.
- View ride details and request statuses.

### GPS and Pickup Locations
- Use GPS to help identify pickup locations.
- Enter pickup locations manually.
- View pickup information associated with rides.
- Improved pickup location handling and testing.

### Map Improvements
- Added map zoom controls.
- Improved map navigation and usability.
- Added regression tests to verify map functionality.

### 💬 Driver and Rider Messaging
- Private messaging between drivers and riders with accepted ride requests.
- Dedicated conversation screen with message bubbles.
- Send and receive messages.
- View previous messages in conversation history.
- Access conversations through ride details and requests.
- Supabase-backed messaging with database access controls.

## Technologies Used

| Technology | Purpose |
|---|---|
| React Native | Mobile application development |
| Expo | Development and testing |
| JavaScript | Application functionality |
| Supabase | Authentication, database, and messaging |
| PostgreSQL | Data storage |
| Git and GitHub | Version control |
| Jest | Automated testing |
| EAS | Android builds and application updates |

## Prototype 9 Development Progress

**GPS Pickup Improvements**

Improved GPS and manual pickup functionality and added automated regression tests to verify expected behavior.

**Map Zoom Controls**

Implemented additional map controls to improve navigation and documented test results.

**Secure Messaging**

Developed a messaging feature that allows drivers and riders to communicate after a ride request is accepted. Added conversation screens, message components, database functions, and security policies.

**Testing and Validation**

Tested messaging with separate driver and rider accounts in Expo Go. Verified that messages could be sent in both directions and that conversation history persisted.

Added automated tests and verified the messaging database migration.

**User Testing Links**

- Expo testing link:

https://expo.dev/preview/update?message=User+testing&updateRuntimeVersion=1.1.0&createdAt=2026-11-10T03%3A55%3A08.059Z&slug=exp&projectId=0e5d81b8-c9ef-4e3a-873f-83c78eb6d72c&group=d005eab8-8a98-4072-a1a6-8fa86ca98508

<img width="408" height="408" alt="image" src="https://github.com/user-attachments/assets/34b64ca8-0427-42eb-a064-600f4d7cd199" />

- Android APK:

https://expo.dev/accounts/smu-c3-mobile-fall-26/projects/CarpoolBoard/builds/484f20be-ce73-4b0c-ae79-d94a9a8de003

 <img width="620" height="620" alt="image" src="https://github.com/user-attachments/assets/76057aac-7b0f-4e23-b667-286275dc7bb9" />

## User Testing

Prototype 9 user testing focuses on:

1. Navigating the application and browsing available rides.
2. Creating rides and requesting seats.
3. Testing GPS and manual pickup locations.
4. Using the map zoom controls.
5. Accepting ride requests.
6. Sending and receiving messages between drivers and riders.
7. Checking whether conversation history is saved.



## Project Information

**Project:** CarpoolBoard  
**Prototype:** 9  
**Course:** Mobile App Development  
**University:** Southern Methodist University  
**Semester:** Fall 2026

**GitHub Repository:**  
https://github.com/Pezeoma88/Prototype-9
