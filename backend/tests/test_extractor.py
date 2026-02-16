"""
extractor.py 测试

覆盖场景：
1. URL 解析（多种格式 + 非法 URL）
2. __INITIAL_STATE__ JSON 提取（完整数据、无评论、中文数字）
3. DOM 降级提取（标准 DOM、og 标签回退、空白页面）
4. HTTP 请求失败的优雅降级
5. _safe_int 中文数字处理边界
6. 摘要截断逻辑
"""

import json
import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from extractor import XiaohongshuExtractor
from models import NoteData


# ============================================================
# URL 解析测试
# ============================================================


class TestParseNoteId:
    """parse_note_id 方法的各种 URL 格式测试"""

    def setup_method(self):
        self.ext = XiaohongshuExtractor()

    def test_explore_url(self):
        """标准 explore 链接"""
        url = "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"
        assert self.ext.parse_note_id(url) == "66a1b2c3d4e5f6"

    def test_explore_url_with_params(self):
        """带查询参数的 explore 链接"""
        url = "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6?xsec_token=abc123&source=feed"
        assert self.ext.parse_note_id(url) == "66a1b2c3d4e5f6"

    def test_discovery_url(self):
        """discovery/item 链接"""
        url = "https://www.xiaohongshu.com/discovery/item/abcdef123456"
        assert self.ext.parse_note_id(url) == "abcdef123456"

    def test_short_url(self):
        """xhslink 短链"""
        url = "https://xhslink.com/abc123XYZ"
        assert self.ext.parse_note_id(url) == "abc123XYZ"

    def test_invalid_url_returns_none(self):
        """无法识别的 URL 返回 None"""
        assert self.ext.parse_note_id("https://google.com/explore/123") is None
        assert self.ext.parse_note_id("not-a-url") is None
        assert self.ext.parse_note_id("") is None

    def test_url_with_uppercase_rejected(self):
        """explore URL 中的大写字母不匹配（小红书 ID 只有小写 hex）"""
        url = "https://www.xiaohongshu.com/explore/ABCDEF"
        assert self.ext.parse_note_id(url) is None


# ============================================================
# _safe_int 中文数字处理测试
# ============================================================


class TestSafeInt:
    """_safe_int 方法的边界情况"""

    def test_int_passthrough(self):
        assert XiaohongshuExtractor._safe_int(42) == 42
        assert XiaohongshuExtractor._safe_int(0) == 0

    def test_float_truncation(self):
        assert XiaohongshuExtractor._safe_int(3.7) == 3

    def test_chinese_wan(self):
        """中文 '万' 单位"""
        assert XiaohongshuExtractor._safe_int("1.2万") == 12000
        assert XiaohongshuExtractor._safe_int("3万") == 30000
        assert XiaohongshuExtractor._safe_int("0.5万") == 5000

    def test_plain_number_string(self):
        """纯数字字符串"""
        assert XiaohongshuExtractor._safe_int("12345") == 12345
        assert XiaohongshuExtractor._safe_int("0") == 0

    def test_empty_string(self):
        assert XiaohongshuExtractor._safe_int("") == 0

    def test_whitespace_string(self):
        assert XiaohongshuExtractor._safe_int("  ") == 0

    def test_non_numeric_string(self):
        """非数字字符串"""
        assert XiaohongshuExtractor._safe_int("abc") == 0

    def test_none_value(self):
        assert XiaohongshuExtractor._safe_int(None) == 0

    def test_mixed_string(self):
        """包含非数字字符的字符串"""
        assert XiaohongshuExtractor._safe_int("1,234") == 1234


# ============================================================
# __INITIAL_STATE__ 提取测试
# ============================================================


class TestExtractFromInitialState:
    """_extract_from_initial_state 方法测试"""

    def setup_method(self):
        self.ext = XiaohongshuExtractor()

    def test_full_data_extraction(self, sample_initial_state_html):
        """完整数据提取 - 标题/正文/作者/互动/评论/标签"""
        result = self.ext._extract_from_initial_state(
            sample_initial_state_html, "66a1b2c3d4e5f6",
            "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"
        )

        assert result is not None
        assert result.title == "今天做了一碗超好吃的番茄鸡蛋面"
        assert "番茄" in result.content
        assert result.author.nickname == "美食小达人"
        assert result.author.user_id == "user123"
        assert result.interaction.like_count == 12000  # "1.2万" → 12000
        assert result.interaction.collect_count == 3456
        assert result.interaction.comment_count == 789
        assert result.note_type == "normal"

    def test_images_extraction(self, sample_initial_state_html):
        """图片列表提取 - 空对象应被过滤"""
        result = self.ext._extract_from_initial_state(
            sample_initial_state_html, "66a1b2c3d4e5f6",
            "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"
        )

        assert len(result.images) == 2  # 第三个是空对象，应被过滤
        assert "img1.jpg" in result.images[0]
        assert "img2.jpg" in result.images[1]

    def test_tags_extraction(self, sample_initial_state_html):
        """标签提取 - 空名称应被过滤"""
        result = self.ext._extract_from_initial_state(
            sample_initial_state_html, "66a1b2c3d4e5f6",
            "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"
        )

        assert result.tags == ["美食", "家常菜"]  # 空字符串标签被过滤

    def test_comments_sorted_by_likes(self, sample_initial_state_html):
        """评论按赞数降序排列，取 TOP 3"""
        result = self.ext._extract_from_initial_state(
            sample_initial_state_html, "66a1b2c3d4e5f6",
            "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"
        )

        assert len(result.top_comments) == 3  # 默认 max_comments=3
        assert result.top_comments[0].like_count == 245
        assert result.top_comments[1].like_count == 128
        assert result.top_comments[2].like_count == 96

    def test_no_initial_state(self):
        """页面不含 __INITIAL_STATE__ → 返回 None"""
        html = "<html><body>普通页面</body></html>"
        result = self.ext._extract_from_initial_state(
            html, "abc123", "https://example.com"
        )
        assert result is None

    def test_malformed_json(self):
        """__INITIAL_STATE__ 中的 JSON 格式错误 → 返回 None"""
        html = "<script>window.__INITIAL_STATE__={broken json!!!};</script>"
        result = self.ext._extract_from_initial_state(
            html, "abc123", "https://example.com"
        )
        assert result is None

    def test_missing_note_detail_node(self):
        """JSON 存在但不包含笔记详情节点 → 返回 None"""
        html = '<script>window.__INITIAL_STATE__={"other": "data"};</script>'
        result = self.ext._extract_from_initial_state(
            html, "abc123", "https://example.com"
        )
        assert result is None

    def test_no_comments_in_state(self):
        """笔记存在但完全没有评论数据"""
        state = {
            "note": {
                "noteDetailMap": {
                    "abc123": {
                        "note": {
                            "title": "无评论笔记",
                            "desc": "这篇没人评论",
                            "type": "normal",
                            "user": {"nickname": "作者"},
                            "interactInfo": {},
                        }
                        # 注意: 没有 "comments" 键
                    }
                }
            }
        }
        json_str = json.dumps(state, ensure_ascii=False)
        html = f"<script>window.__INITIAL_STATE__={json_str};</script>"

        result = self.ext._extract_from_initial_state(
            html, "abc123", "https://example.com"
        )

        assert result is not None
        assert result.title == "无评论笔记"
        assert result.top_comments == []  # 无评论不崩溃

    def test_undefined_in_json(self):
        """JSON 中包含 JavaScript 的 undefined 关键字（作为独立值）"""
        state = {
            "note": {
                "noteDetailMap": {
                    "abc123": {
                        "note": {
                            "title": "测试笔记标题",
                            "desc": "占位符",
                            "type": "normal",
                            "user": {"nickname": "作者"},
                            "interactInfo": {},
                        }
                    }
                }
            }
        }
        json_str = json.dumps(state, ensure_ascii=False)
        # 手动将 desc 值替换为 JavaScript 的 undefined
        json_str = json_str.replace('"占位符"', "undefined")
        html = f"<script>window.__INITIAL_STATE__={json_str};</script>"

        result = self.ext._extract_from_initial_state(
            html, "abc123", "https://example.com"
        )

        assert result is not None
        assert result.title == "测试笔记标题"
        # undefined 被替换为 null → extractor 用 or "" 兜底 → content 为 ""
        assert result.content == ""


# ============================================================
# DOM 降级提取测试
# ============================================================


class TestExtractFromDom:
    """_extract_from_dom 方法测试"""

    def setup_method(self):
        self.ext = XiaohongshuExtractor()

    def test_standard_dom_extraction(self, sample_dom_html):
        """标准 DOM 结构提取"""
        result = self.ext._extract_from_dom(
            sample_dom_html, "test123", "https://example.com"
        )

        assert result.title == "DOM提取的标题"
        assert "测试用的正文" in result.content
        assert result.author.nickname == "DOM作者"
        assert result.interaction.like_count == 5678

    def test_dom_comments(self, sample_dom_html):
        """DOM 评论提取"""
        result = self.ext._extract_from_dom(
            sample_dom_html, "test123", "https://example.com"
        )

        assert len(result.top_comments) == 2
        assert result.top_comments[0].user_nickname == "评论人A"
        assert result.top_comments[0].content == "DOM评论内容1"
        assert result.top_comments[0].like_count == 100
        # 评论B没有 like-count
        assert result.top_comments[1].like_count == 0

    def test_dom_tags(self, sample_dom_html):
        """DOM 标签提取 - 去除 # 前缀"""
        result = self.ext._extract_from_dom(
            sample_dom_html, "test123", "https://example.com"
        )

        assert "测试标签" in result.tags
        assert "第二标签" in result.tags

    def test_og_tag_fallback(self, sample_og_only_html):
        """当 DOM 元素不存在时，回退到 og 标签"""
        result = self.ext._extract_from_dom(
            sample_og_only_html, "test123", "https://example.com"
        )

        assert result.title == "OG回退标题"
        assert result.content == "OG回退正文描述"

    def test_empty_page(self, sample_empty_html):
        """完全空白的页面 → 默认值不崩溃"""
        result = self.ext._extract_from_dom(
            sample_empty_html, "test123", "https://example.com"
        )

        assert result.title == "[无标题]"  # 空白时的默认标题
        assert result.content == ""
        assert result.top_comments == []
        assert result.tags == []
        assert result.note_id == "test123"


# ============================================================
# extract 完整流程测试 (mock HTTP)
# ============================================================


class TestExtractFullFlow:
    """extract 方法完整流程测试，通过 mock HTTP 请求"""

    def setup_method(self):
        self.ext = XiaohongshuExtractor()

    @pytest.mark.asyncio
    async def test_http_failure_graceful_degradation(self):
        """HTTP 请求失败时优雅降级，返回错误信息而不崩溃"""
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        self.ext.client = AsyncMock()
        self.ext.client.get = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        result = await self.ext.extract(
            "https://www.xiaohongshu.com/explore/abc123def456"
        )

        assert isinstance(result, NoteData)
        assert result.title == "[提取失败]"
        assert "Connection refused" in result.content
        assert result.note_id == "abc123def456"

    @pytest.mark.asyncio
    async def test_http_404_graceful(self):
        """HTTP 404 响应时优雅降级"""
        self.ext.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                "404", request=MagicMock(), response=MagicMock()
            )
        )
        self.ext.client.get = AsyncMock(return_value=mock_resp)

        result = await self.ext.extract(
            "https://www.xiaohongshu.com/explore/deadbeef1234"
        )

        assert result.title == "[提取失败]"
        assert result.note_id == "deadbeef1234"

    @pytest.mark.asyncio
    async def test_successful_initial_state_extraction(
        self, sample_initial_state_html
    ):
        """成功的 __INITIAL_STATE__ 提取"""
        self.ext.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()  # 不抛异常
        mock_resp.text = sample_initial_state_html
        self.ext.client.get = AsyncMock(return_value=mock_resp)

        result = await self.ext.extract(
            "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"
        )

        assert result.title == "今天做了一碗超好吃的番茄鸡蛋面"
        assert result.author.nickname == "美食小达人"
        assert len(result.top_comments) == 3

    @pytest.mark.asyncio
    async def test_fallback_to_dom_when_no_initial_state(
        self, sample_dom_html
    ):
        """无 __INITIAL_STATE__ 时降级到 DOM 解析"""
        self.ext.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.text = sample_dom_html
        self.ext.client.get = AsyncMock(return_value=mock_resp)

        result = await self.ext.extract(
            "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"
        )

        assert result.title == "DOM提取的标题"


# ============================================================
# 摘要生成测试
# ============================================================


class TestMakeSummary:
    """_make_summary 方法测试"""

    def setup_method(self):
        self.ext = XiaohongshuExtractor()

    def test_short_text_unchanged(self):
        """短文本不截断"""
        text = "这是一段很短的文本"
        result = self.ext._make_summary(text)
        assert result == text

    def test_long_text_truncated(self):
        """长文本截断到 200 字 + ..."""
        text = "这是测试" * 100  # 400 字
        result = self.ext._make_summary(text)
        assert len(result) == 203  # 200 + "..."
        assert result.endswith("...")

    def test_empty_text(self):
        assert self.ext._make_summary("") == ""

    def test_whitespace_collapsed(self):
        """多余空白被合并"""
        text = "你好   世界\n\n\n测试"
        result = self.ext._make_summary(text)
        assert "   " not in result


# ============================================================
# 辅助方法测试
# ============================================================


class TestBuildCanonicalUrl:

    def setup_method(self):
        self.ext = XiaohongshuExtractor()

    def test_with_note_id(self):
        result = self.ext._build_canonical_url("abc123", "https://fallback.com")
        assert result == "https://www.xiaohongshu.com/explore/abc123"

    def test_without_note_id(self):
        """没有 note_id 时返回 fallback URL"""
        result = self.ext._build_canonical_url("", "https://fallback.com")
        assert result == "https://fallback.com"
