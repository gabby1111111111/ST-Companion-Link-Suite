
import asyncio
import httpx
import logging
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8765"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("QA_TEST")

async def test_xhs_regression(client):
    logger.info("🧪 [TC1] XHS Regression: Like Action")
    payload = {
        "action": "like",
        "note_id": "xhs_123",
        "note_url": "https://www.xiaohongshu.com/explore/xhs_123",
        "timestamp": datetime.now().isoformat(),
        "note_data": {
            "platform": "xiaohongshu",
            "title": "Regression Test Note",
            "desc": "Testing if XHS still works",
            "user": {"nickname": "Tester"}
        }
    }
    resp = await client.post(f"{BASE_URL}/api/signal", json=payload)
    assert resp.status_code == 200, f"XHS Like failed: {resp.text}"
    data = resp.json()
    assert data["success"] is True
    # Check if dispatch_results exists (it might be empty if ST url invalid, but key should exist)
    # The response model is APIResponse(success, message, data)
    assert "data" in data
    logger.info("✅ XHS Regression Passed")

async def test_bili_coin(client):
    logger.info("🧪 [TC2] Bilibili: Coin Action (Pink Theme)")
    payload = {
        "action": "coin",
        "note_id": "BV1xx411c7mD",
        "note_url": "https://www.bilibili.com/video/BV1xx411c7mD",
        "timestamp": datetime.now().isoformat(),
        "note_data": {
            "platform": "bilibili",
            "title": "【4K】Super Test Video",
            "desc": "Testing Bilibili Coin",
            "play_progress": "05:00 / 10:00",
            "interaction": {"coin_count": 666}
        }
    }
    resp = await client.post(f"{BASE_URL}/api/signal", json=payload)
    assert resp.status_code == 200, f"Bili Coin failed: {resp.text}"
    logger.info("✅ Bilibili Coin Passed")

async def test_bili_roast_trigger(client):
    logger.info("🧪 [TC3] Bilibili: Roast Logic (Progress)")
    # Case A: 1% progress (Clickbait?)
    payload_low = {
        "action": "coin",
        "note_id": "BV_LOW_PROG",
        "note_url": "https://www.bilibili.com/video/BV_LOW",
        "note_data": {
            "platform": "bilibili",
            "title": "Clickbait Video",
            "play_progress": "00:05 / 10:00"
        }
    }
    await client.post(f"{BASE_URL}/api/signal", json=payload_low)
    
    # Case B: 99% progress (Patience)
    payload_high = {
        "action": "coin",
        "note_id": "BV_HIGH_PROG",
        "note_url": "https://www.bilibili.com/video/BV_HIGH",
        "note_data": {
            "platform": "bilibili",
            "title": "Long Documentary",
            "play_progress": "59:00 / 60:00"
        }
    }
    await client.post(f"{BASE_URL}/api/signal", json=payload_high)
    logger.info("✅ Bilibili Roast Triggers Sent")

async def test_malformed_data(client):
    logger.info("🧪 [TC4] Resilience: Malformed Data")
    # Missing note_url (Required field)
    payload = {
        "action": "like",
        "note_id": "bad_id"
    }
    resp = await client.post(f"{BASE_URL}/api/signal", json=payload)
    logger.info(f"Malformed Response: {resp.status_code}")
    assert resp.status_code == 422, "Should return 422 for missing required fields"
    logger.info("✅ Resilience Passed")

async def main():
    logger.info("🚀 Starting QA Suite...")
    async with httpx.AsyncClient() as client:
        try:
            await test_xhs_regression(client)
            await test_bili_coin(client)
            await test_bili_roast_trigger(client)
            await test_malformed_data(client)
            logger.info("🎉 All Tests Passed!")
        except Exception as e:
            logger.error(f"❌ Test Failed: {e}")
            exit(1)

if __name__ == "__main__":
    asyncio.run(main())
