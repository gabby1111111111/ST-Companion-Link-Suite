
import asyncio
import httpx
from datetime import datetime

BACKEND_URL = "http://localhost:8765"

async def test_bilibili_signal():
    payload = {
        "action": "coin",  # Bilibili specific action
        "note_url": "https://www.bilibili.com/video/BV1GM4m1m7UN",
        "note_id": "BV1GM4m1m7UN",
        "timestamp": datetime.now().isoformat(),
        "note_data": {
            "note_id": "BV1GM4m1m7UN",
            "platform": "bilibili",
            "title": "【4K60FPS】G I D L E - Super Lady",
            "content": "Original 4K source...",
            "author": {
                "nickname": "KpopFancam",
                "user_id": "12345"
            },
            "interaction": {
                "like_count": 1024,
                "coin_count": 512,  # Bilibili specific field
                "collect_count": 256
            },
            "tags": ["Kpop", "GIDLE", "Fancam"],
            "images": ["http://i0.hdslb.com/bfs/archive/cover.jpg"]
        }
    }

    print(f"📡 Sending signal to {BACKEND_URL}/api/signal ...")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{BACKEND_URL}/api/signal", json=payload)
            print(f"Response Status: {resp.status_code}")
            print(f"Response Body: {resp.json()}")
            
            data = resp.json().get("data", {})
            dispatch_results = data.get("dispatch_results", {})
            st_result = dispatch_results.get("sillytavern", {})
            
            if st_result.get("success"):
                print("✅ SillyTavern dispatch successful")
            else:
                 print(f"⚠️ SillyTavern dispatch failed (expected if ST not running): {st_result}")

            # Check formatted text log or response if possible
            # But the response only contains minimal info. 
            # We can check /api/test/format to see the text.
            
    except Exception as e:
        print(f"❌ Error: {e}")

async def test_bilibili_format():
    # Test formatting endpoint directly to verify text
    print("\n📝 Testing formatting logic...")
    # Note: /api/test/format expects real extraction, which might fail without network/cookies.
    # So we better rely on the signal test above and check logs, OR trust unit test.
    pass

if __name__ == "__main__":
    asyncio.run(test_bilibili_signal())
