"""
dispatcher.py 测试

覆盖场景：
1. Webhook 注册/注销/列表
2. 去重逻辑
3. 事件过滤
4. HTTP 推送成功/失败
5. SillyTavern 推送的 header 处理
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dispatcher import Dispatcher
from models import (
    WebhookTarget, CompanionContext, ActionType,
    NoteData, NoteAuthor, NoteInteraction,
)


@pytest.fixture
def fresh_dispatcher():
    """创建一个干净的 Dispatcher 实例（无预注册 webhook）"""
    with patch("dispatcher.settings") as mock_settings:
        mock_settings.webhooks = []
        mock_settings.sillytavern_url = "http://localhost:8000"
        mock_settings.sillytavern_plugin_route = "/api/plugins/companion-link/inject"
        mock_settings.sillytavern_api_key = None
        d = Dispatcher()
        return d


@pytest.fixture
def sample_context():
    """创建一个测试用的 CompanionContext"""
    note = NoteData(
        note_id="test123",
        note_url="https://www.xiaohongshu.com/explore/test123",
        title="测试笔记",
        content="测试内容",
    )
    return CompanionContext(
        action=ActionType.LIKE,
        note=note,
        formatted_text="[测试] 格式化文本",
    )


# ============================================================
# Webhook 注册/注销管理
# ============================================================


class TestWebhookManagement:

    def test_register_webhook(self, fresh_dispatcher):
        """注册 webhook"""
        target = WebhookTarget(url="http://example.com/webhook", name="测试")
        fresh_dispatcher.register_webhook(target)

        webhooks = fresh_dispatcher.list_webhooks()
        assert len(webhooks) == 1
        assert webhooks[0].url == "http://example.com/webhook"

    def test_register_duplicate_ignored(self, fresh_dispatcher):
        """重复注册同一 URL → 忽略"""
        target = WebhookTarget(url="http://example.com/webhook")
        fresh_dispatcher.register_webhook(target)
        fresh_dispatcher.register_webhook(target)  # 第二次注册

        assert len(fresh_dispatcher.list_webhooks()) == 1

    def test_unregister_webhook(self, fresh_dispatcher):
        """注销已存在的 webhook"""
        target = WebhookTarget(url="http://example.com/webhook")
        fresh_dispatcher.register_webhook(target)

        result = fresh_dispatcher.unregister_webhook("http://example.com/webhook")
        assert result is True
        assert len(fresh_dispatcher.list_webhooks()) == 0

    def test_unregister_nonexistent(self, fresh_dispatcher):
        """注销不存在的 webhook → 返回 False"""
        result = fresh_dispatcher.unregister_webhook("http://nonexistent.com")
        assert result is False

    def test_list_returns_copy(self, fresh_dispatcher):
        """list_webhooks 返回副本，修改不影响原数据"""
        target = WebhookTarget(url="http://example.com")
        fresh_dispatcher.register_webhook(target)

        webhooks = fresh_dispatcher.list_webhooks()
        webhooks.clear()  # 清空副本

        assert len(fresh_dispatcher.list_webhooks()) == 1  # 原始不受影响

    def test_multiple_webhooks(self, fresh_dispatcher):
        """注册多个 webhook"""
        for i in range(3):
            fresh_dispatcher.register_webhook(
                WebhookTarget(url=f"http://example{i}.com")
            )
        assert len(fresh_dispatcher.list_webhooks()) == 3


# ============================================================
# 事件过滤测试
# ============================================================


class TestEventFiltering:

    @pytest.mark.asyncio
    async def test_webhook_with_matching_event(self, fresh_dispatcher, sample_context):
        """webhook 的事件列表包含当前行为 → 推送"""
        target = WebhookTarget(
            url="http://example.com",
            events=[ActionType.LIKE, ActionType.COMMENT],
        )
        fresh_dispatcher.register_webhook(target)

        # Mock HTTP
        fresh_dispatcher.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        fresh_dispatcher.client.post = AsyncMock(return_value=mock_resp)

        results = await fresh_dispatcher.dispatch(sample_context)

        # 应该有 sillytavern + 1个 webhook 的结果
        assert "sillytavern" in results

    @pytest.mark.asyncio
    async def test_webhook_with_non_matching_event(self, fresh_dispatcher, sample_context):
        """webhook 的事件列表不包含当前行为 → 跳过"""
        target = WebhookTarget(
            url="http://example.com",
            name="仅评论",
            events=[ActionType.COMMENT],  # 只监听评论
        )
        fresh_dispatcher.register_webhook(target)

        fresh_dispatcher.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        fresh_dispatcher.client.post = AsyncMock(return_value=mock_resp)

        results = await fresh_dispatcher.dispatch(sample_context)  # 行为是 LIKE

        # 只有 sillytavern，webhook 被过滤
        assert "sillytavern" in results
        assert "仅评论" not in results


# ============================================================
# HTTP 推送测试
# ============================================================


class TestDispatchPush:

    @pytest.mark.asyncio
    async def test_sillytavern_push_success(self, fresh_dispatcher, sample_context):
        """SillyTavern 推送成功"""
        fresh_dispatcher.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        fresh_dispatcher.client.post = AsyncMock(return_value=mock_resp)

        result = await fresh_dispatcher._push_to_sillytavern(sample_context)

        assert result["success"] is True
        assert result["status"] == 200

    @pytest.mark.asyncio
    async def test_sillytavern_push_failure(self, fresh_dispatcher, sample_context):
        """SillyTavern 推送失败 → 返回错误但不崩溃"""
        fresh_dispatcher.client = AsyncMock()
        fresh_dispatcher.client.post = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        result = await fresh_dispatcher._push_to_sillytavern(sample_context)

        assert result["success"] is False
        assert "error" in result

    @pytest.mark.asyncio
    async def test_sillytavern_push_with_api_key(self, sample_context):
        """带 API Key 的 SillyTavern 推送 → header 中包含 Bearer token"""
        with patch("dispatcher.settings") as mock_settings:
            mock_settings.webhooks = []
            mock_settings.sillytavern_url = "http://localhost:8000"
            mock_settings.sillytavern_plugin_route = "/api/plugins/companion-link/inject"
            mock_settings.sillytavern_api_key = "test-key-12345"

            d = Dispatcher()
            d.client = AsyncMock()
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.raise_for_status = MagicMock()
            d.client.post = AsyncMock(return_value=mock_resp)

            await d._push_to_sillytavern(sample_context)

            # 验证 post 调用的 headers 参数包含 Authorization
            call_kwargs = d.client.post.call_args
            headers = call_kwargs.kwargs.get("headers", {})
            assert "Authorization" in headers
            assert headers["Authorization"] == "Bearer test-key-12345"

    @pytest.mark.asyncio
    async def test_webhook_push_success(self, fresh_dispatcher, sample_context):
        """外部 Webhook 推送成功"""
        target = WebhookTarget(url="http://aegis-isle.local/webhook", name="Aegis")

        fresh_dispatcher.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        fresh_dispatcher.client.post = AsyncMock(return_value=mock_resp)

        result = await fresh_dispatcher._push_to_webhook(target, sample_context)

        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_webhook_push_failure(self, fresh_dispatcher, sample_context):
        """外部 Webhook 推送失败 → 返回错误但不崩溃"""
        target = WebhookTarget(url="http://dead.host/webhook")

        fresh_dispatcher.client = AsyncMock()
        fresh_dispatcher.client.post = AsyncMock(
            side_effect=httpx.ConnectError("timeout")
        )

        result = await fresh_dispatcher._push_to_webhook(target, sample_context)

        assert result["success"] is False
        assert "error" in result

    @pytest.mark.asyncio
    async def test_webhook_payload_structure(self, fresh_dispatcher, sample_context):
        """验证 Webhook 推送的 payload 结构"""
        target = WebhookTarget(url="http://example.com/webhook")

        fresh_dispatcher.client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        fresh_dispatcher.client.post = AsyncMock(return_value=mock_resp)

        await fresh_dispatcher._push_to_webhook(target, sample_context)

        call_kwargs = fresh_dispatcher.client.post.call_args
        payload = call_kwargs.kwargs.get("json", {})
        assert payload["source"] == "companion-link"
        assert payload["action"] == "like"
        assert "note" in payload
        assert "timestamp" in payload
