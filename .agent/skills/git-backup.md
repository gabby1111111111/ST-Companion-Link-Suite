---
name: git-backup
description: auto-commit and push with timestamp
---

# Git Auto-Backup

Automatically stages, commits, and pushes changes with a timestamp.

## Usage

Run this command in the terminal:

```powershell
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git add .
git commit -m "backup: auto-save at $timestamp"
git push origin main
Write-Host "✅ Code backed up to GitHub at $timestamp"
```
