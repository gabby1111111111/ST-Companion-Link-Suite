
import httpx
import asyncio
import json

async def main():
    url = "http://localhost:8765/api/signal"
    payload = {
        "action": "like",
        "note_url": "https://www.bilibili.com/video/BV1xx411c7mD",
        "note_data": {
            "platform": "bilibili",
            "title": "Manual Test Video",
            "author": {"nickname": "Tester"},
            "interaction": {"coin_count": 1}
        }
    }
    print(f"Sending payload to {url}...")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload)
            print(f"Status: {resp.status_code}")
            print(f"Body: {resp.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
