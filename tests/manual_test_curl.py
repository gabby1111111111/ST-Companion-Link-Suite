import httpx
import asyncio
import json

async def send_signal(action, title, tags=[], progress=None, online=None, coin=0):
    url = "http://localhost:8765/api/signal"
    payload = {
        "action": action,
        "note_url": f"https://www.bilibili.com/video/BV_TEST_{action}",
        "note_data": {
            "platform": "bilibili",
            "title": title,
            "tags": tags,
            "author": {"nickname": "BiliTester"},
            "interaction": {"coin_count": coin},
            "play_progress": progress,
            "online_count": online
        }
    }
    print(f"\n🚀 Sending [{action}] - {title}...")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=5.0)
            print(f"✅ Status: {resp.status_code}")
    except Exception as e:
        print(f"❌ Error: {e}")

async def main():
    print("--- 📺 Bilibili Functional Simulation ---")
    
    # 1. 模拟投币 (触发主动对话)
    await send_signal("coin", "【绝区零】全角色攻略合集", ["绝区零", "攻略"], coin=2)
    
    await asyncio.sleep(2)
    
    # 2. 模拟高能时刻 (50% 进度)
    await send_signal("read", "全网最燃！黑神话悟空动作踩点", ["黑神话", "动作"], progress="03:00 / 06:00")
    
    await asyncio.sleep(2)
    
    # 3. 模拟热门视频 (10万人在线)
    await send_signal("read", "B站跨年晚会 正在直播", ["晚会", "B站"], online=15000)

    print("\n--- Simulation Complete. Check SillyTavern! ---")

if __name__ == "__main__":
    asyncio.run(main())
