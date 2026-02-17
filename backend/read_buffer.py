"""
Companion-Link 阅读缓冲区

基于 TTL (Time-To-Live) 的滑动窗口缓存，
用于积累用户最近的 read 行为，供 AI 生成"潜意识感知"。

设计要点：
- 统一使用 UTC 时间戳（避免跨时区问题）
- 每次访问时自动清理过期记录
- 全局单例
"""

import logging
from datetime import datetime, timezone, timedelta
from collections import deque
from typing import Optional

logger = logging.getLogger("companion-link.buffer")


class ReadBuffer:
    """
    基于 TTL 的 Read 信号滑动窗口缓存

    记录最近 N 分钟内的 read 信号（标题、标签、URL），
    供 like/comment 触发时聚合上下文。
    """

    DEFAULT_TTL_SECONDS = 900  # 15 分钟

    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS):
        self.ttl = timedelta(seconds=ttl_seconds)
        self._buffer: deque[dict] = deque(maxlen=100)  # 最多 100 条防爆
        logger.info(f"📦 ReadBuffer 初始化 (TTL={ttl_seconds}s)")

    # ============================================================
    # 核心操作
    # ============================================================

    def add(
        self,
        title: str,
        tags: list[str],
        url: str,
        author: str = "",
    ) -> int:
        """
        添加一条 read 记录

        Returns:
            int: 当前缓冲区大小（清理后）
        """
        self._cleanup()

        entry = {
            "timestamp": datetime.now(timezone.utc),
            "title": title.strip() if title else "",
            "tags": tags or [],
            "url": url,
            "author": author,
        }
        self._buffer.append(entry)

        logger.info(
            f"📖 Read 缓冲 +1: 《{entry['title'][:30]}》"
            f" | 缓冲区大小: {len(self._buffer)}"
        )
        return len(self._buffer)

    def get_recent(self) -> list[dict]:
        """
        获取所有未过期的记录

        Returns:
            list[dict]: [{timestamp, title, tags, url, author}, ...]
        """
        self._cleanup()
        return list(self._buffer)

    def get_keywords_summary(self) -> str:
        """
        聚合所有记录的标签和标题关键词，生成简短摘要

        Returns:
            str: 例如 "美食探店、鸣潮同人、穿搭分享"
        """
        self._cleanup()
        if not self._buffer:
            return ""

        # 收集所有标签
        all_tags: list[str] = []
        for entry in self._buffer:
            all_tags.extend(entry.get("tags", []))

        # 去重并保留顺序
        seen = set()
        unique_tags = []
        for tag in all_tags:
            t = tag.strip().lstrip("#")
            if t and t not in seen:
                seen.add(t)
                unique_tags.append(t)

        # 如果标签不够，用标题补充
        if len(unique_tags) < 3:
            for entry in self._buffer:
                title = entry.get("title", "").strip()
                if title and title not in seen:
                    seen.add(title)
                    unique_tags.append(title)

        # 最多取 8 个关键词
        keywords = unique_tags[:8]
        return "、".join(keywords) if keywords else ""

    def get_titles(self) -> list[str]:
        """
        获取缓冲区中所有标题列表（简版）

        Returns:
            list[str]: ["标题1", "标题2", ...]
        """
        self._cleanup()
        return [
            entry["title"]
            for entry in self._buffer
            if entry.get("title")
        ]

    def get_display_entries(self) -> list[dict]:
        """
        获取缓冲区条目用于前端展示（标题 + 标签）

        Returns:
            list[dict]: [{"title": "xx", "tags": ["tag1", "tag2"]}, ...]
        """
        self._cleanup()
        return [
            {
                "title": entry["title"],
                "tags": entry.get("tags", []),
            }
            for entry in self._buffer
            if entry.get("title")
        ]

    def size(self) -> int:
        """当前缓冲区大小（清理后）"""
        self._cleanup()
        return len(self._buffer)

    def clear(self) -> None:
        """手动清空缓冲区"""
        self._buffer.clear()
        logger.info("🗑️ ReadBuffer 已清空")

    def status(self) -> dict:
        """返回缓冲区状态（用于调试端点）"""
        self._cleanup()
        return {
            "size": len(self._buffer),
            "ttl_seconds": int(self.ttl.total_seconds()),
            "entries": [
                {
                    "title": e["title"],
                    "tags": e["tags"],
                    "age_seconds": int(
                        (datetime.now(timezone.utc) - e["timestamp"]).total_seconds()
                    ),
                }
                for e in self._buffer
            ],
            "keywords_summary": self.get_keywords_summary(),
        }

    # ============================================================
    # 内部方法
    # ============================================================

    def _cleanup(self) -> None:
        """剔除超过 TTL 的旧数据"""
        now = datetime.now(timezone.utc)
        cutoff = now - self.ttl

        # deque 是按时间顺序排列的，从左侧淘汰
        while self._buffer and self._buffer[0]["timestamp"] < cutoff:
            expired = self._buffer.popleft()
            logger.debug(
                f"🧹 过期清理: 《{expired['title'][:20]}》"
                f" ({int((now - expired['timestamp']).total_seconds())}s ago)"
            )


# 全局单例
read_buffer = ReadBuffer()
