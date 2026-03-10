---
name: memory-viewer
description: inspect current AI short-term memory (buffer)
---

# Memory Viewer

Inspects the current state of the `read_buffer` (AI's short-term memory of what you've read).

## Usage

Query the backend buffer status endpoint:

```powershell
curl http://localhost:8765/buffer/status
```

This will return a JSON object showing:
- `count`: Number of items in memory.
- `items`: List of titles and tags currently held.
