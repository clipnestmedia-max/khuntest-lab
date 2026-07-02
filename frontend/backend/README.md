# KHUNTEST LABS Backend

This is a working Node.js + Express + MySQL backend for KHUNTEST LABS.

## Features

- Admin login
- Patient register/login
- Test master and package master
- Online booking API
- Booking status update
- Report value entry
- PDF/image report upload
- Patient report download link
- WhatsApp report-ready message
- WhatsApp document sending using Meta WhatsApp Cloud API
- Razorpay order creation
- Payment record storage
- Revenue summary
- Staff management
- Notification logs

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create MySQL database

```sql
CREATE DATABASE khuntest_lab;
```

### 3. Import schema

```bash
mysql -u root -p khuntest_lab < database/schema.sql
```

### 4. Copy env file

```bash
cp .env.example .env
```

Edit `.env` and add your database, JWT, Razorpay and WhatsApp credentials.

### 5. Seed demo data

```bash
npm run db:seed
```

### 6. Run backend

```bash
npm run dev
```

Backend will run at:

```text
http://localhost:5000
```

## Demo Admin Login

```text
email: admin@khuntest.com
password: admin123
```

## Important WhatsApp Note

To send report PDF directly on WhatsApp, you need:
- Meta WhatsApp Cloud API token
- Phone Number ID
- Patient WhatsApp number with country code, for example `919876543210`
- Public report file URL, not local file path

This backend saves uploaded reports in `/uploads` and exposes them publicly using `PUBLIC_BASE_URL`.

## Main API Routes

### Auth
- `POST /api/auth/patient/register`
- `POST /api/auth/patient/login`
- `POST /api/auth/admin/login`

### Public
- `GET /api/tests`
- `GET /api/packages`
- `POST /api/bookings`

### Patient
- `GET /api/patient/bookings`
- `GET /api/patient/reports`
- `GET /api/patient/payments`

### Admin
- `GET /api/admin/bookings`
- `PUT /api/admin/bookings/:id/status`
- `POST /api/admin/bookings/:id/report-upload`
- `POST /api/admin/bookings/:id/report-values`
- `POST /api/admin/bookings/:id/send-whatsapp-report`
- `GET /api/admin/revenue-summary`
- `POST /api/admin/tests`
- `POST /api/admin/staff`

## Connect Frontend

In your frontend `app.js`, replace localStorage save/load with `fetch()` calls to this backend.
Example booking:

```js
fetch("http://localhost:5000/api/bookings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(bookingData)
});
```
