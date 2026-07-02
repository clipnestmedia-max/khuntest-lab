# KhunTest LIS Bridge for Mindray BC-5000

This is a local-only Node.js bridge for importing CBC results from a Mindray BC-5000 hematology analyzer into KhunTest Firestore as draft reports.

## Architecture

Mindray BC-5000 -> LAN HL7/LIS -> Local Node.js Bridge -> Firestore `machineResults` -> KhunTest Admin Dashboard -> Review -> Release Report

The browser frontend must not connect directly to the analyzer. The bridge runs on the lab computer that is reachable by the analyzer over the lab LAN.

## What It Does

- Listens for HL7 over TCP on port `5001` by default.
- Supports MLLP framing: `0x0b` start, `0x1c 0x0d` end.
- Sends HL7 ACK messages back to the analyzer.
- Parses HL7 `MSH`, `PID`, `OBR`, and `OBX` segments.
- Provides a basic ASTM parser fallback.
- Uploads machine results to Firestore collection `machineResults`.
- Attempts to match bookings by `billNo`, then by `sampleId`.
- Creates or updates a draft report in `reports`.
- Sets the matched booking to `Report Entry` and marks `machineResultReceived: true`.
- Never auto-releases reports. A lab assistant/pathologist must review and release.

## Setup

1. Ask the Mindray service engineer to enable LIS/HL7 output on the BC-5000.
2. Connect the BC-5000 and the lab PC to the same LAN.
3. Find the lab PC IP address.
4. Set the analyzer LIS host/IP to the lab PC IP.
5. Set the analyzer LIS port to `5001`.
6. Set protocol to `HL7` if available.
7. Create a Firebase service account JSON and place it at `lis-bridge/serviceAccountKey.json`.
8. Copy `.env.example` to `.env` and adjust values if needed.
9. Install and run:

```bash
cd lis-bridge
npm install
npm start
```

10. Create a test sample on the analyzer.
11. Watch bridge logs.
12. Check Firestore `machineResults`.
13. Open KhunTest Admin Dashboard -> Machine Results.

## Manual Test Parser

The bridge also starts a local paste test page by default:

```text
http://127.0.0.1:5050
```

Paste fake/demo HL7 or ASTM text only. Do not paste real patient data unless this PC is approved for PHI handling.

You can also run:

```bash
npm run test:parse
```

## Files Not To Commit

Never commit:

- `serviceAccountKey.json`
- `.env`
- `raw-messages/`
- real patient analyzer dumps

These are ignored by the root `.gitignore`.

## Notes For Mindray Service Engineer

Exact BC-5000 LIS details can depend on the analyzer firmware and LIS interface options. Confirm:

- HL7 or ASTM protocol mode
- TCP client/server direction
- analyzer host/IP and port settings
- sample ID field format
- whether bill number is sent as `OBR-2`, `OBR-3`, or another field
- result code naming for CBC parameters

If HL7 is not available in the configured mode, ASTM may be available and can be expanded using the official Mindray LIS interface manual.
