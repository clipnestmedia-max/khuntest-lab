# Configuration Guide

## Firebase

Default project values are prefilled from the existing KhunTest Lab Firebase web app:

- Project ID: `khuntest-lab-e5966`
- Auth domain: `khuntest-lab-e5966.firebaseapp.com`

Login with a Firebase user whose Firestore user document has:

```json
{
  "role": "admin",
  "isActive": true
}
```

## Analyzer

Default analyzer:

- Name: Mindray BC5000
- Protocol: HL7
- Connection Type: LAN
- Listener Host: `0.0.0.0`
- Port: `5001`
- Reconnect Automatically: enabled

Use the analyzer IP field for connection testing. The actual listener opens a local TCP server and waits for the analyzer to connect.

## Offline Queue

If Firebase upload fails, parsed results are stored in SQLite under Electron user data. The app retries queued uploads every 15 seconds while running.

## Logs

Logs are stored by date under the app user data directory. Use Logs -> Export Logs to create a CSV export.
