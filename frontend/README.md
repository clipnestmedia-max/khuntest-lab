# KhunTest Lab Complete Website

This package contains a full working frontend prototype plus backend/API and MySQL schema scaffolding.

## Open Static Website
Open `index.html` in Chrome or use VS Code Live Server.

## Demo Admin Login
Email: `admin@khuntest.com`
Password: `admin123`

## Patient Login
Register from `patient-login.html`, then book with the same email to see bookings/reports.

## Included
- Public website: Home, About, Tests, Packages, Home Collection, Contact, Booking
- Patient portal: Register/Login, Dashboard, My Bookings, PDF Reports, Payment History, Profile
- Admin dashboard: Analytics, Manage Bookings, Upload Reports, Tests, Packages, Staff, Revenue, Notifications
- Database tables: users, patients, bookings, tests, packages, reports, payments, staff, notifications
- Backend scaffold: Node.js + Express + JWT + Multer + Razorpay dependency

## Production Stack Suggested
Frontend: Next.js + Tailwind CSS
Backend: Node.js + Express
Database: MySQL
Authentication: JWT
Storage: AWS S3 / Cloudinary
Payments: Razorpay
WhatsApp: Meta WhatsApp API

## WhatsApp Reports
Report sharing uses safe manual `wa.me` links from the admin dashboard and report page.
Automatic WhatsApp Cloud API sending requires a backend or Firebase Cloud Functions because the WhatsApp token is secret and must not be stored in frontend code.


## Latest Admin Panel Update
- Added Patient Entry Form similar to reference lab software.
- Added Bill No, Remote No, Rate Type, Doctor, Field Boy, Test Search, Add Test/Add Package, Gross/Cash/Card/Discount/Balance.
- Added Report Generate / Patient Finding screen with Normal Value, Finding, Unit, Comment, Status, History, Preview and Release Report.
- Released report includes all patient data, billing data and all test finding values.


## New Admin Finding Popup
Report Generate now has an Open-Attach-table button for each test. It opens detailed parameter value tables like CBC, LFT, KFT, Thyroid, Lipid, Vitamin and other tests. Saved values are included in the released report.
