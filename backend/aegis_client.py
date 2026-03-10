import os
import httpx
import logging
from typing import Optional, List

logger = logging.getLogger("companion-link.aegis")

AEGIS_URL = os.getenv("AEGIS_URL", "http://localhost:8001/v1/diary/event")

# 模块级 httpx 客户端，复用连接池
_client: Optional[httpx.AsyncClient] = None


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=5.0)
    return _client


async def update_state(user_id: str, action: str, title: str, tags: List[str], url: str, platform: str, comment: Optional[str] = None) -> bool:
    """
    写入行为事件到 Aegis-Isle 的高阶 EventBus，静默降级不抛异常
    """
    try:
        client = await _get_client()
        payload = {
            "user_id": user_id,
            "source": "browsing",
            "action": action,
            "title": title,
            "tags": tags,
            "url": url,
            "platform": platform,
            "comment": comment
        }
        # 调用 Aegis-Isle 写入行为事件
        response = await client.post(AEGIS_URL, json=payload)
        response.raise_for_status()
        logger.info(f"[Aegis-Isle] 成功将浏览事件({action})写入 Diary EventBus")
        return True
    except Exception as e:
        logger.warning(f"[Aegis-Isle] 写入事件失败(静默降级): {e}")
        return False


async def close():
    """优雅关闭连接池，应在应用退出时调用"""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None
