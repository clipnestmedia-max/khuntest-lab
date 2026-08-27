# Admin panel port — swatisofttechsolution → KhunTest

The KhunTest admin panel (`admin-dashboard.html`, ~4,800 lines, backed by
`firebase-service.js`) has been replaced with **swatisofttechsolution's modular
admin panel + medical engine**, wired into this app's existing single-tenant,
flat-collection Firebase project. Everything outside the admin panel — the
public site, the patient portal, `report.html`, `bill.html`, `firebase-service.js`,
`app.js`, the Firebase project — is unchanged.

## What was brought over

| Path | What |
|---|---|
| `core/` | Platform kernel + `core/data/*` (one module per entity) + **`core/medical/*`** (calculation + interpretation engine, Light's criteria, reference intervals) + `flags.js`, `report-templates.js`, `ui.js`, `format.js`, `audit.js`, `whatsapp.js`, `image-upload.js`, `qrcode.js`, `barcode.js`, `vendor/` |
| `admin/` | `admin.js` shell + `booking-screen`, `report-entry`, `medical-screen`, `settings-screen`, `report-share`, `receipt`, `machine-results-screen` |
| `admin-dashboard.html` | swati's 597-line shell (nav + empty panels; all logic in `admin/*.js`). Old monolith kept as `admin-dashboard.legacy.html` for one release. |
| `styles/platform.css` | The admin design system |
| `js/shared-report-logic.js` | swati's version (used by `report-share.js`) |

## How multi-tenancy was removed

swati's admin is built on a `/labs/{labId}/…` data model. This deployment is
one laboratory, so the kernel was neutralised — the admin screens then read and
write the **same flat collections the rest of the KhunTest app uses**:

| File | Change |
|---|---|
| `core/tenant.js` | `col("x")` → `collection(db, "x")`; `docRef`, `settingsDoc` flat; `withLabId()` is a no-op; `getLabId()` → `"khuntest"` |
| `core/session.js` | `requireStaff()` = Firebase Auth user whose `/users/{uid}` has `role == "admin"` and is active. That admin has every permission. No subscription gate. |
| `core/firebase-config.js` | re-exports `app`/`auth`/`db` from `../firebase-config.js` (the KhunTest project) |
| `core/branding*.js` | compiled-in KhunTest identity (name, colours, address, signatory); no per-lab Firestore read |
| `core/data/ids.js` | counters at flat `/counters/{kind}`; ids drop the lab prefix (`B00001`, `INV00001`) |
| dropped | `core/provision-user.js`, `core/password-reset.js`, `core/data/labs.js` |

`admin-login.html` was **not changed** — it already does the same
`/users/{uid}` + `role == "admin"` check and redirects to `admin-dashboard.html`.

## Report schema — `report.html` stays untouched

swati's Report Entry stores `groups[]` / `rows[]`; KhunTest's `report.html` and
patient portal read a flat `results[]` with a top-level `status`. So
`core/data/reports.js` now writes **both** on every save
(`flatResultsFromGroups()` / `khuntestStatus()`):

- `groups[]` — reopened by the entry screen, carries the medical-engine metadata
- `results[]` + `status` (`"Final"` / `"Draft"`) — rendered by `report.html`
  and filtered by the patient portal, with no change to either

## Test catalogue

`frontend/data/tests.json` is now the **swatisofttechsolution 677-test
catalogue** (also copied to `data/seed-catalogue.json`). Every parameter
carries structured reference ranges — `normalRange` string **plus**
`rangeMale` / `rangeFemale` / `rangeChild` and numeric `lowValue` / `highValue`
— and a `parameterId`, which is what `core/flags.js` and the `core/medical/*`
interpretation engine key on.

`core/data/tests.js` treats that bundled file as the **source of truth**: the
677 always exist exactly as shipped. Firestore `/tests` is only an *overlay* —
`price`, `mrp`, `isActive`, `reportTime`, `sample`, `method`, `notes`,
`shortName` edits on a shipped test, or an entirely new test the admin adds.
Firestore can never change a shipped test's parameter grid or its ranges, so
"the 677 with their ranges" holds regardless of DB state and with no seeding
step. `admin-import-tests.html` still exists to push the file into `/tests` and
prune orphans if you want the collection itself to match.

## Firestore rules

`frontend/firestore.rules` gained `isAdmin()` rules for collections the ported
panel writes that previously had none: `counters`, `settings`, `auditLogs`,
`payments`, `homeCollections`, `expenses`, `staff`, `notifications`,
`reportResults`, `reportTemplates`. All existing rules are unchanged. **These
take effect only when the rules are deployed.**

## Known gaps / follow-ups

- **Booking interop:** admin-created bookings use swati's field shape. They
  feed Report Entry fine. The KhunTest patient portal ("My Bookings") keys off
  its own field names, so it may not list admin-created bookings until a
  bookings compat pass (same idea as the reports dual-write).
- **Home Collection / Finance / Staff / Analytics** screens are wired and their
  rules are in place, but were not exercised against live data.
- **Machine Results:** the screen reads flat `/machineResults`; confirm the
  desktop listener / LIS bridge write there (they already did in the pre-port
  KhunTest admin).
- `admin-dashboard.legacy.html` can be deleted once the new panel is confirmed
  against the live project.
- No automated tests were ported; verification so far is module-load + static.
  Exercise the New Booking → Report Entry → Release → `report.html` path on the
  live project before relying on it.
