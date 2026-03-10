---
name: project-health
description: diagnose python env, ports, and game processes
---

# Project Health Check

Diagnoses common issues with the ST-Companion-Link backend.

## Checks

### 1. Port Check (8765 & 8000)
Is the backend (8765) and SillyTavern (8000) running?
```powershell
netstat -ano | findstr "8765 8000"
```

### 2. Backend Process
Is the Python backend process active?
```powershell
tasklist | findstr python
```

### 3. Game Process Detection
Are the supported games running?
```powershell
tasklist | findstr /i "ZenlessZoneZero Wuthering Waves"
```

### 4. API Connectivity Connect
Is the backend documentation accessible?
```powershell
curl -I http://localhost:8765/docs
```
