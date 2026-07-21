# Customer Installation Guide

## Install

1. Download `KhunTestLab-Listener-Setup.exe`.
2. Double-click the installer.
3. Click Next.
4. Choose the install folder if needed.
5. Click Install.
6. Click Finish.

The listener starts automatically and also starts after Windows boot.

## First Login

1. Enter the KhunTest Lab admin email.
2. Enter the password.
3. Keep Remember Me enabled on trusted lab computers.
4. Click Login.

## Connect Analyzer

1. Open Analyzers.
2. Select Mindray BC5000.
3. Confirm Protocol is HL7.
4. Confirm Connection Type is LAN.
5. Set Listener Host to `0.0.0.0`.
6. Set Analyzer Port to `5001` unless the service engineer configured another port.
7. Enter Analyzer IP for testing.
8. Click Test Connection.
9. Click Start Listener.

## Daily Use

Keep the app running in the system tray. Results sent by the analyzer appear in Machine Results on the admin dashboard. Reports remain draft until the lab reviews and releases them.

## TCP Server Network Check

For Mindray BC5000 TCP Server mode, the customer PC should listen on `0.0.0.0:5001` and the analyzer should connect inbound from its configured IP.

On Windows Command Prompt:

```bat
netstat -ano | findstr :5001
```

Expected listener line:

```text
TCP    0.0.0.0:5001    0.0.0.0:0    LISTENING    <PID>
```

From PowerShell on a machine in the same analyzer network:

```powershell
Test-NetConnection 10.0.0.3 -Port 5001
```

If the listener is running but Remote Connections stays `0`, create an inbound firewall rule for TCP port `5001`. Do not disable Windows Firewall.

```powershell
New-NetFirewallRule -DisplayName "KhunTest Lab Listener TCP 5001" -Direction Inbound -Protocol TCP -LocalPort 5001 -Action Allow
```
