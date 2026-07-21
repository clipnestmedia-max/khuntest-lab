# KhunTest Lab Listener

Professional Windows desktop listener for importing CBC analyzer results into KhunTest Lab Firestore.

## Architecture

```text
Mindray BC5000
  -> HL7 / ASTM over LAN
  -> KhunTest Lab Listener for Windows
  -> Firebase Firestore machineResults
  -> KhunTest Lab Admin Dashboard
  -> Draft report review and release
```

The desktop listener is intentionally separate from the existing website. It adds analyzer import capability without changing report printing, patient portal, booking, or admin dashboard workflows.

## Features

- Firebase Authentication login with Remember Me.
- Dashboard for computer, Firebase, internet, analyzer, listener, daily imports, queue, and sync status.
- Multiple analyzer settings with Mindray BC5000 enabled first.
- HL7 TCP listener with MLLP support and ACK responses.
- ASTM parser fallback.
- CBC parameter extraction for WBC, differential, RBC, HGB, HCT, indices, RDW, platelet parameters, and flags.
- Firestore upload to `machineResults` and matched draft report creation in `reports`.
- Never auto-releases reports.
- SQLite offline queue with automatic retry.
- System tray controls for open, pause, resume, settings, and exit.
- Auto startup after boot.
- Log storage and CSV export.
- Electron Builder NSIS installer: `KhunTestLab-Listener-Setup.exe`.
- GitHub Releases auto-update support through `electron-updater`.

## Developer Setup

```bash
cd desktop-listener
npm install
npm start
```

Parser smoke test:

```bash
npm run test:parse
```

Build the Windows installer from a Windows build machine:

```bash
npm run dist
```

The generated installer is written under `desktop-listener/dist/` as `KhunTestLab-Listener-Setup.exe`.

## Release Process

The admin dashboard downloads the latest listener through GitHub Releases using `frontend/listener-release.json`. Do not commit the installer EXE into the normal source tree.

1. Update `desktop-listener/package.json` and `desktop-listener/package-lock.json` to the next version.
2. Commit and push the listener changes to `main`.
3. Create and push a listener tag:

```bash
git tag listener-v1.0.3
git push origin listener-v1.0.3
```

4. GitHub Actions runs `.github/workflows/release-listener.yml`.
5. The workflow installs dependencies, runs tests, builds `KhunTestLab-Listener-Setup.exe`, calculates SHA-256, creates the GitHub Release, uploads the installer, and updates `frontend/listener-release.json`.
6. The metadata commit to `main` triggers the existing Firebase Hosting deployment workflow.
7. Admin Dashboard > Machine Results shows the newest version, release date, file size, checksum, release notes, and download button.
8. The customer closes the running listener, downloads the update from the admin dashboard, verifies the checksum, and installs it.

Windows may show SmartScreen warnings until production builds are code-signed. Production distribution should use a code-signing certificate; do not instruct customers to disable Windows security.

## Customer Workflow

1. Download `KhunTestLab-Listener-Setup.exe`.
2. Install with the wizard.
3. Open KhunTest Lab Listener.
4. Login with an active Firebase admin account.
5. Select or add the analyzer.
6. Enter listener host/port and analyzer IP.
7. Click Test Connection.
8. Click Start Listener.
9. Analyzer results upload automatically to Firestore.
10. Admin reviews draft reports before releasing.

## Security

The app uses Electron safe storage through `electron-store` for remembered login data. This avoids storing credentials in plain text on supported Windows systems. For production, prefer a dedicated Firebase admin user with only the required Firestore permissions.

Optional service-account support exists in the Firebase service layer, but service account JSON should be injected through a secure setup flow and never committed.

## Firestore Collections

The listener writes to the existing collections only:

- `machineResults`
- `reports`
- `bookings`

It uses the same draft behavior as the existing LIS bridge:

- create a `machineResults` document
- match booking by `billNo`/`sampleId`
- create or update a Draft report
- set booking status to `Report Entry`
- never set report status to Final

## Analyzer Notes

Mindray BC5000 should be configured by the service engineer:

- LIS protocol: HL7 preferred
- Host IP: Windows PC running this listener
- Port: default `5001`
- Result auto-send enabled

RS232 and USB Serial are represented in the settings UI as future adapters. Add a vetted serial driver after confirming exact analyzer cabling and protocol mode.
