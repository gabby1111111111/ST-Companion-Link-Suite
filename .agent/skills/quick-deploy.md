---
name: quick-deploy
description: sync frontend/backend code to SillyTavern
---

# Quick Deploy to SillyTavern

Synchronizes the latest code to your SillyTavern installation directory.

## Instructions

Run this PowerShell block to copy files:

```powershell
$ST_PATH = "E:\SillyTaven\SillyTavern"

Write-Host "🚀 Syncing Frontend (index.js)..."
Copy-Item "e:\ST-Companion-Link\SillyTavern-CompanionLink\index.js" "$ST_PATH\data\default-user\extensions\SillyTavern-CompanionLink-Extension\index.js" -Force

Write-Host "🚀 Syncing Server Plugin (server/index.js)..."
Copy-Item "e:\ST-Companion-Link\SillyTavern-CompanionLink\server\index.js" "$ST_PATH\plugins\companion-link\index.js" -Force

Write-Host "✅ Deployment Complete! Please refresh SillyTavern (Ctrl+F5) and Restart Backend."
```
