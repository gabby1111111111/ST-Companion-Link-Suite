---
name: sim-bilibili
description: simulate Bilibili coin/progress events
---

# Bilibili Event Simulator

Simulates user interactions on Bilibili to test backend triggers.

## Simulation Scenarios

### 1. Coin Toss (2 Coins)
```powershell
curl -X POST http://localhost:8765/api/signal -H "Content-Type: application/json" -d '{\"action\": \"coin\", \"note_url\": \"https://bilibili.com/video/BV_TEST\", \"note_data\": {\"platform\": \"bilibili\", \"title\": \"Zenless Zone Zero Guide\", \"interaction\": {\"coin_count\": 2}}}'
```

### 2. Like a Video
```powershell
curl -X POST http://localhost:8765/api/signal -H "Content-Type: application/json" -d '{\"action\": \"like\", \"note_url\": \"https://bilibili.com/video/BV_LIKE_TEST\", \"note_data\": {\"platform\": \"bilibili\", \"title\": \"Awesome AMV\", \"interaction\": {\"like_count\": 1200}}}'
```

### 3. High Energy Progress (50%)
```powershell
curl -X POST http://localhost:8765/api/signal -H "Content-Type: application/json" -d '{\"action\": \"read\", \"note_url\": \"https://bilibili.com/video/BV_TEST_PROG\", \"note_data\": {\"platform\": \"bilibili\", \"title\": \"Epic Moments\", \"play_progress\": \"05:00 / 10:00\"}}'
```

### 4. Live Stream (High Online Count)
```powershell
curl -X POST http://localhost:8765/api/signal -H "Content-Type: application/json" -d '{\"action\": \"read\", \"note_url\": \"https://live.bilibili.com/123\", \"note_data\": {\"platform\": \"bilibili\", \"title\": \"New Year Gala\", \"online_count\": 15000}}'
```
