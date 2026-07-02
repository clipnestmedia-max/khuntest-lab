# KHUNTEST LABS Firebase Migration

This frontend now uses Firebase Auth and Firestore directly from static HTML/JS modules.

## Setup

1. In Firebase Console, enable **Authentication > Sign-in method > Email/Password**.
2. Create **Cloud Firestore** in production mode.
3. Confirm `firebase-config.js` contains the KHUNTEST LABS Firebase config.
4. Deploy rules from this `frontend` folder:
   ```bash
   firebase deploy --only firestore:rules
   ```

## Hosting Deploy

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

Hosting is configured with `public: "."` because this folder is a multi-page static website. It does not rewrite every route to `index.html`.

## First Admin

Manual first admin profile:

1. Create the admin user in Firebase Authentication.
2. Copy the new Auth `uid`.
3. Create `users/{uid}` in Firestore:
   ```json
   {
     "uid": "AUTH_UID_HERE",
     "name": "Admin",
     "email": "admin@example.com",
     "phone": "",
     "role": "admin",
     "isActive": true
   }
   ```
4. Restore/deploy the final `firestore.rules` before using the site.

After one admin exists, use normal admin login. Admin users can manage bookings, save/release reports, download CSV files, and delete data older than two months.

## Patient Test Flow

1. Open `patient-login.html`.
2. Register a patient with name, email, phone, password, age, gender, and address.
3. Login as the patient.
4. Book from `booking.html` using the same email and phone.
5. Patient dashboard loads matching Firestore bookings and shows report links when released.

## Booking and Report Flow

1. Login at `admin-login.html`.
2. Open `admin-dashboard.html`.
3. Use **Patient Entry** or the public booking form to create a booking.
4. Open **Report Generate**, select the bill, enter findings, and click **RELEASE REPORT**.
5. Report persists in Firestore and opens as `report.html?bill=XXXXXX`.
6. Use the report page print button for A4 printing or PDF save.

## CSV and 2-Month Policy

Admin dashboard includes:

- **Download All CSV**
- **Download Last 2 Months CSV**
- **Delete Data Older Than 2 Months**

The delete action asks for browser confirmation before deleting old bookings/reports.

## Security Notes

- Firebase Hosting ignores `backend`, `node_modules`, `.env`, SQL, ZIP, and backup folders.
- Do not put WhatsApp Cloud API tokens in frontend code. Use Cloud Functions or keep a small backend/VPS service for WhatsApp sending.
- Custom OTP by email requires Firebase Cloud Functions or backend SMTP because SMTP password cannot be stored in frontend.
- Firestore rules are not fully public. Patients can read their own records by email, admins can manage all data, and public booking creation is limited to basic booking fields.
