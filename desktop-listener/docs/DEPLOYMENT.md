# Deployment Guide

## Build Machine

Use a Windows machine or CI runner for the final customer installer.

```bash
cd desktop-listener
npm install
npm run dist
```

Output:

```text
desktop-listener/dist/KhunTestLab-Listener-Setup.exe
```

## GitHub Releases Auto Update

`electron-updater` is configured for GitHub Releases. Update the `build.publish.owner` and `build.publish.repo` values in `package.json` to match the production repository before release.

Release steps:

1. Increment `version` in `package.json`.
2. Build installer.
3. Create a GitHub Release.
4. Upload generated installer and update metadata files from `dist/`.
5. Installed apps check for updates on startup.

## Customer Support Checklist

- Confirm Windows Firewall allows inbound TCP on the configured listener port.
- Confirm the analyzer host IP points to the customer PC.
- Confirm Firebase admin login works.
- Send a demo analyzer result.
- Verify Firestore `machineResults` and admin dashboard draft report.
