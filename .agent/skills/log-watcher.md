---
name: log-watcher
description: real-time backend log monitoring
---

# Log Watcher

Monitors the backend log file for real-time activity and errors.

## Usage

Run this command to tail the log file:

```powershell
Get-Content e:\ST-Companion-Link\backend.log -Wait -Tail 20
```
