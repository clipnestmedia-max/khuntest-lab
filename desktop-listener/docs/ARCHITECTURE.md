# Architecture Diagram

```text
+------------------+
| Mindray BC5000   |
| HL7 / ASTM       |
+--------+---------+
         | LAN TCP 5001
+--------v---------+
| Electron Main    |
| ListenerService  |
+--------+---------+
         | parse
+--------v---------+
| Parser Modules   |
| HL7 / ASTM CBC   |
+--------+---------+
         | upload or queue
+--------v---------+       offline
| FirebaseService  |<-----> SQLite Queue
+--------+---------+
         |
+--------v---------+
| Firestore        |
| machineResults   |
| reports drafts   |
| bookings status  |
+--------+---------+
         | realtime read
+--------v---------+
| Admin Dashboard  |
| Review / Release |
+------------------+
```

## Process Boundaries

- `src/main/main.js`: Electron window, tray, IPC, startup, updater.
- `src/services/listener-service.js`: TCP server, HL7 ACK, message lifecycle.
- `src/parsers/*`: Analyzer-specific HL7 and ASTM parsers.
- `src/services/firebase-service.js`: Login, Firestore upload, draft report mapping.
- `src/services/offline-queue.js`: SQLite retry queue.
- `src/services/logger-service.js`: JSONL daily logs and CSV export.
- `src/renderer/*`: Desktop UI.

## Data Safety

The listener creates draft reports only. It does not release reports, generate PDFs, or modify patient-facing report visibility.
