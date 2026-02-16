"""
Companion-Link 小红书数据提取引擎

使用 httpx + BeautifulSoup 从小红书页面提取结构化数据
参考 xiaohongshu-mcp 的 service.go 中的数据抓取逻辑
"""

import re
import logging
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from config import settings
from models import NoteData, NoteAuthor, NoteComment, NoteInteraction

logger = logging.getLogger("companion-link.extractor")


class XiaohongshuExtractor:
    """
    小红书笔记数据提取器

    支持两种提取模式：
    1. 直接从 URL 抓取页面 HTML → 解析 DOM
    2. 解析页面中的 __INITIAL_STATE__ JSON（首选，数据更完整）
    """

    # 小红书笔记 URL 正则
    NOTE_URL_PATTERNS = [
        # https://www.xiaohongshu.com/explore/笔记ID
        re.compile(r"xiaohongshu\.com/explore/([a-f0-9]+)"),
        # https://www.xiaohongshu.com/discovery/item/笔记ID
        re.compile(r"xiaohongshu\.com/discovery/item/([a-f0-9]+)"),
        # https://xhslink.com/xxxxx (短链)
        re.compile(r"xhslink\.com/([a-zA-Z0-9]+)"),
    ]

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=settings.extract_timeout,
            headers={
                "User-Agent": settings.user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Referer": "https://www.xiaohongshu.com/",
            },
            follow_redirects=True,
        )

    async def close(self):
        """关闭 HTTP 客户端"""
        await self.client.aclose()

    # ============================================================
    # 公开接口
    # ============================================================

    def parse_note_id(self, url: str) -> Optional[str]:
        """从笔记 URL 中解析出 note_id"""
        for pattern in self.NOTE_URL_PATTERNS:
            match = pattern.search(url)
            if match:
                return match.group(1)
        return None

    async def extract(self, note_url: str) -> NoteData:
        """
        提取笔记完整数据

        Args:
            note_url: 小红书笔记 URL

        Returns:
            NoteData: 结构化笔记数据
        """
        note_id = self.parse_note_id(note_url) or ""

        # 确保 URL 是完整的 explore 格式
        canonical_url = self._build_canonical_url(note_id, note_url)

        logger.info(f"📥 开始提取笔记: {canonical_url}")

        try:
            response = await self.client.get(canonical_url)
            response.raise_for_status()
            html = response.text
        except httpx.HTTPError as e:
            logger.error(f"❌ HTTP 请求失败: {e}")
            return NoteData(
                note_id=note_id,
                note_url=note_url,
                title="[提取失败]",
                content=f"无法获取笔记内容: {str(e)}",
                content_summary="提取失败",
            )

        # 优先从 __INITIAL_STATE__ 提取（数据更完整）
        note_data = self._extract_from_initial_state(html, note_id, note_url)
        if note_data:
            logger.info(f"✅ 从 __INITIAL_STATE__ 提取成功: {note_data.title}")
            return note_data

        # 降级到 DOM 解析
        note_data = self._extract_from_dom(html, note_id, note_url)
        logger.info(f"✅ 从 DOM 解析提取成功: {note_data.title}")
        return note_data

    # ============================================================
    # 提取策略 1: __INITIAL_STATE__ JSON
    # ============================================================

    def _extract_from_initial_state(
        self, html: str, note_id: str, note_url: str
    ) -> Optional[NoteData]:
        """
        从页面的 __INITIAL_STATE__ 脚本中提取 JSON 数据
        小红书 SSR 页面会将完整的笔记数据嵌入到这个全局变量中
        """
        try:
            # 匹配 window.__INITIAL_STATE__ = {...}
            pattern = re.compile(
                r"window\.__INITIAL_STATE__\s*=\s*(\{.+?\})\s*(?:;|</script>)",
                re.DOTALL,
            )
            match = pattern.search(html)
            if not match:
                return None

            import json

            # 小红书的 JSON 中可能包含 undefined，需要替换
            raw_json = match.group(1)
            raw_json = raw_json.replace("undefined", "null")
            data = json.loads(raw_json)

            # 导航到笔记数据节点
            note_detail = self._navigate_json(data, note_id)
            if not note_detail:
                return None

            # 提取各字段（用 or "" 兜底，因为 JSON 中可能有 null 值）
            title = note_detail.get("title", "") or ""
            desc = note_detail.get("desc", "") or ""
            note_type = note_detail.get("type", "normal") or "normal"

            # 作者信息
            user_info = note_detail.get("user", {})
            author = NoteAuthor(
                user_id=user_info.get("userId", ""),
                nickname=user_info.get("nickname", ""),
                avatar_url=user_info.get("avatar", ""),
            )

            # 互动数据
            interact_info = note_detail.get("interactInfo", {})
            interaction = NoteInteraction(
                like_count=self._safe_int(interact_info.get("likedCount", 0)),
                collect_count=self._safe_int(
                    interact_info.get("collectedCount", 0)
                ),
                comment_count=self._safe_int(
                    interact_info.get("commentCount", 0)
                ),
                share_count=self._safe_int(
                    interact_info.get("shareCount", 0)
                ),
            )

            # 图片列表
            images = []
            for img in note_detail.get("imageList", []):
                url = img.get("urlDefault", "") or img.get("url", "")
                if url:
                    images.append(url)

            # 标签
            tag_list = note_detail.get("tagList", [])
            tags = [t.get("name", "") for t in tag_list if t.get("name")]

            # 热门评论
            top_comments = self._extract_comments_from_json(data, note_id)

            # 生成摘要
            content_summary = self._make_summary(desc)

            return NoteData(
                note_id=note_id,
                note_url=note_url,
                title=title,
                content=desc,
                content_summary=content_summary,
                author=author,
                interaction=interaction,
                top_comments=top_comments,
                tags=tags,
                images=images,
                note_type=note_type,
            )

        except Exception as e:
            logger.warning(f"⚠️ __INITIAL_STATE__ 解析失败: {e}")
            return None

    def _navigate_json(self, data: dict, note_id: str) -> Optional[dict]:
        """导航到笔记详情数据节点"""
        # 尝试多种路径（小红书前端结构可能变化）
        paths = [
            lambda d: d.get("note", {}).get("noteDetailMap", {})
                       .get(note_id, {}).get("note"),
            lambda d: d.get("note", {}).get("note"),
            lambda d: d.get("noteDetail", {}).get("data", {}).get("noteData"),
        ]
        for path_fn in paths:
            try:
                result = path_fn(data)
                if result and isinstance(result, dict):
                    return result
            except (KeyError, TypeError, AttributeError):
                continue
        return None

    def _extract_comments_from_json(
        self, data: dict, note_id: str
    ) -> list[NoteComment]:
        """从 __INITIAL_STATE__ 中提取评论"""
        comments = []
        max_count = settings.extract_max_comments

        try:
            # 评论数据可能在不同路径
            comment_paths = [
                lambda d: d.get("comment", {}).get("comments", []),
                lambda d: d.get("note", {}).get("noteDetailMap", {})
                           .get(note_id, {}).get("comments", []),
            ]

            raw_comments = []
            for path_fn in comment_paths:
                try:
                    result = path_fn(data)
                    if result:
                        raw_comments = result
                        break
                except (KeyError, TypeError):
                    continue

            # 按点赞排序取 TOP N
            sorted_comments = sorted(
                raw_comments,
                key=lambda c: self._safe_int(c.get("likeCount", 0)),
                reverse=True,
            )

            for c in sorted_comments[:max_count]:
                user_info = c.get("userInfo", {})
                comments.append(
                    NoteComment(
                        user_nickname=user_info.get("nickname", "匿名用户"),
                        content=c.get("content", ""),
                        like_count=self._safe_int(c.get("likeCount", 0)),
                        sub_comment_count=self._safe_int(
                            c.get("subCommentCount", 0)
                        ),
                    )
                )
        except Exception as e:
            logger.warning(f"⚠️ 评论提取失败: {e}")

        return comments

    # ============================================================
    # 提取策略 2: DOM 解析（降级方案）
    # ============================================================

    def _extract_from_dom(
        self, html: str, note_id: str, note_url: str
    ) -> NoteData:
        """通过 BeautifulSoup 解析 HTML DOM"""
        soup = BeautifulSoup(html, "lxml")

        # 标题
        title = ""
        title_el = soup.select_one("#detail-title") or soup.select_one(
            ".title, .note-title"
        )
        if title_el:
            title = title_el.get_text(strip=True)

        # 正文
        content = ""
        content_el = soup.select_one("#detail-desc") or soup.select_one(
            ".desc, .note-content, .content"
        )
        if content_el:
            content = content_el.get_text(strip=True)

        # og 标签降级
        if not title:
            og_title = soup.select_one('meta[property="og:title"]')
            if og_title:
                title = og_title.get("content", "")
        if not content:
            og_desc = soup.select_one('meta[property="og:description"]')
            if og_desc:
                content = og_desc.get("content", "")

        # 作者
        author = NoteAuthor()
        author_el = soup.select_one(".author .name, .user-nickname")
        if author_el:
            author.nickname = author_el.get_text(strip=True)

        # 互动数据
        interaction = NoteInteraction()
        like_el = soup.select_one(
            '.like-wrapper .count, [data-type="like"] .count'
        )
        if like_el:
            interaction.like_count = self._safe_int(
                like_el.get_text(strip=True)
            )

        # 评论
        top_comments = []
        comment_els = soup.select(".comment-item, .parent-comment")
        for cel in comment_els[: settings.extract_max_comments]:
            nick_el = cel.select_one(".name, .user-name")
            text_el = cel.select_one(
                ".content, .comment-text, .note-text"
            )
            like_el = cel.select_one(".like .count, .like-count")
            if text_el:
                top_comments.append(
                    NoteComment(
                        user_nickname=(
                            nick_el.get_text(strip=True) if nick_el else "匿名"
                        ),
                        content=text_el.get_text(strip=True),
                        like_count=(
                            self._safe_int(like_el.get_text(strip=True))
                            if like_el
                            else 0
                        ),
                    )
                )

        # 标签
        tags = []
        tag_els = soup.select(".tag, .hashtag, a[href*='tag']")
        for t in tag_els:
            text = t.get_text(strip=True).lstrip("#")
            if text:
                tags.append(text)

        return NoteData(
            note_id=note_id,
            note_url=note_url,
            title=title or "[无标题]",
            content=content,
            content_summary=self._make_summary(content),
            author=author,
            interaction=interaction,
            top_comments=top_comments,
            tags=tags,
        )

    # ============================================================
    # 工具方法
    # ============================================================

    def _build_canonical_url(self, note_id: str, fallback_url: str) -> str:
        """构建标准化笔记 URL"""
        if note_id:
            return f"https://www.xiaohongshu.com/explore/{note_id}"
        return fallback_url

    def _make_summary(self, text: str) -> str:
        """生成正文摘要"""
        if not text:
            return ""
        max_len = settings.extract_summary_length
        cleaned = re.sub(r"\s+", " ", text).strip()
        if len(cleaned) <= max_len:
            return cleaned
        return cleaned[:max_len] + "..."

    @staticmethod
    def _safe_int(value) -> int:
        """安全转换为整数，处理 '1.2万' 等中文数字"""
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return 0
            # 处理 "1.2万", "3万" 等
            wan_match = re.match(r"([\d.]+)\s*万", value)
            if wan_match:
                return int(float(wan_match.group(1)) * 10000)
            # 处理纯数字
            try:
                return int(re.sub(r"[^\d]", "", value) or 0)
            except ValueError:
                return 0
        return 0


# 全局提取器实例
extractor = XiaohongshuExtractor()
