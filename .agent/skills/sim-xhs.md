---
name: sim-xhs
description: simulate Xiaohongshu like/comment events
---

# Xiaohongshu Event Simulator

Simulates user interactions on Xiaohongshu.

## Simulation Scenarios

### 1. Like a Note
```powershell
curl -X POST http://localhost:8765/api/signal -H "Content-Type: application/json" -d '{\"action\": \"like\", \"note_url\": \"https://xhs.com/note/123\", \"note_data\": {\"platform\": \"xiaohongshu\", \"title\": \"Delicious Food\", \"tags\": [\"Food\", \"Dinner\"]}}'
```

### 2. Comment on a Note
```powershell
curl -X POST http://localhost:8765/api/signal -H "Content-Type: application/json" -d '{\"action\": \"comment\", \"note_url\": \"https://xhs.com/note/456\", \"comment_text\": \"Looks great!\", \"note_data\": {\"platform\": \"xiaohongshu\", \"title\": \"OOTD\", \"tags\": [\"Fashion\"]}}'
```
