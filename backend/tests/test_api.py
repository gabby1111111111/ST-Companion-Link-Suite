"""
main.py FastAPI API 路由测试

使用 httpx.AsyncClient + ASGITransport 测试端点
覆盖场景：
1. /api/health 健康检查
2. /api/signal POST 请求验证
3. /api/webhook/* CRUD 操作
4. 请求参数校验（缺失字段、无效枚举值）
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app
from models import NoteData


@pytest_asyncio.fixture
async def client():
    """异步测试客户端"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ============================================================
# 健康检查
# ============================================================


class TestHealthEndpoint:

    @pytest.mark.asyncio
    async def test_health_check(self, client):
        """GET /api/health → 200"""
        response = await client.get("/api/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "companion-link-backend"
        assert data["version"] == "0.1.0"
        assert "sillytavern_url" in data
        assert "webhook_count" in data


# ============================================================
# 信号接收 API
# ============================================================


class TestSignalEndpoint:

    @pytest.mark.asyncio
    async def test_signal_missing_action(self, client):
        """POST /api/signal 缺少 action 字段 → 422"""
        response = await client.post("/api/signal", json={
            "note_url": "https://www.xiaohongshu.com/explore/abc123"
        })

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_signal_missing_url(self, client):
        """POST /api/signal 缺少 note_url 字段 → 422"""
        response = await client.post("/api/signal", json={
            "action": "like"
        })

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_signal_invalid_action(self, client):
        """POST /api/signal 无效的 action 值 → 422"""
        response = await client.post("/api/signal", json={
            "action": "invalid_action",
            "note_url": "https://www.xiaohongshu.com/explore/abc123"
        })

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_signal_valid_request(self, client):
        """POST /api/signal 有效请求（mock 提取器和分发器）"""
        mock_note = NoteData(
            note_id="abc123",
            note_url="https://www.xiaohongshu.com/explore/abc123",
            title="测试笔记",
            content="测试内容",
            content_summary="测试内容",
        )

        with patch("main.extractor") as mock_extractor, \
             patch("main.dispatcher") as mock_dispatcher:
            mock_extractor.extract = AsyncMock(return_value=mock_note)
            mock_dispatcher.dispatch = AsyncMock(
                return_value={"sillytavern": {"success": True}}
            )

            response = await client.post("/api/signal", json={
                "action": "like",
                "note_url": "https://www.xiaohongshu.com/explore/abc123"
            })

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "abc123" in data["data"]["note_id"]

    @pytest.mark.asyncio
    async def test_signal_comment_with_text(self, client):
        """POST /api/signal 评论行为带评论文本"""
        mock_note = NoteData(
            note_id="abc123",
            note_url="https://www.xiaohongshu.com/explore/abc123",
            title="评论测试笔记",
            content="内容",
            content_summary="内容",
        )

        with patch("main.extractor") as mock_extractor, \
             patch("main.dispatcher") as mock_dispatcher:
            mock_extractor.extract = AsyncMock(return_value=mock_note)
            mock_dispatcher.dispatch = AsyncMock(
                return_value={"sillytavern": {"success": True}}
            )

            response = await client.post("/api/signal", json={
                "action": "comment",
                "note_url": "https://www.xiaohongshu.com/explore/abc123",
                "comment_text": "我觉得这篇写得很好！"
            })

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_signal_all_action_types(self, client):
        """POST /api/signal 所有行为类型都能被接受"""
        mock_note = NoteData(
            note_id="abc123",
            note_url="https://example.com",
            title="Test",
            content_summary="Test",
        )

        for action in ["like", "comment", "read", "collect", "share"]:
            with patch("main.extractor") as mock_extractor, \
                 patch("main.dispatcher") as mock_dispatcher:
                mock_extractor.extract = AsyncMock(return_value=mock_note)
                mock_dispatcher.dispatch = AsyncMock(return_value={})

                response = await client.post("/api/signal", json={
                    "action": action,
                    "note_url": "https://www.xiaohongshu.com/explore/abc123"
                })

                assert response.status_code == 200, \
                    f"Action '{action}' failed with {response.status_code}"


# ============================================================
# Webhook 管理 API
# ============================================================


class TestWebhookEndpoints:

    @pytest.mark.asyncio
    async def test_register_webhook(self, client):
        """POST /api/webhook/register → 200"""
        response = await client.post("/api/webhook/register", json={
            "url": "http://test-webhook.local/hook",
            "name": "测试Webhook"
        })

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @pytest.mark.asyncio
    async def test_register_webhook_missing_url(self, client):
        """POST /api/webhook/register 缺少 url → 422"""
        response = await client.post("/api/webhook/register", json={
            "name": "无URL"
        })

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_list_webhooks(self, client):
        """GET /api/webhook/list → 返回列表"""
        response = await client.get("/api/webhook/list")

        assert response.status_code == 200
        data = response.json()
        assert "count" in data
        assert "webhooks" in data
        assert isinstance(data["webhooks"], list)

    @pytest.mark.asyncio
    async def test_unregister_nonexistent_webhook(self, client):
        """DELETE /api/webhook/unregister 不存在的 URL → 404"""
        response = await client.request(
            "DELETE",
            "/api/webhook/unregister",
            params={"url": "http://nonexistent.com"},
        )

        assert response.status_code == 404


# ============================================================
# 请求空 body
# ============================================================


class TestEdgeCases:

    @pytest.mark.asyncio
    async def test_signal_empty_body(self, client):
        """POST /api/signal 空 body → 422"""
        response = await client.post("/api/signal", content=b"")

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_signal_invalid_json(self, client):
        """POST /api/signal 无效 JSON → 422"""
        response = await client.post(
            "/api/signal",
            content=b"{broken json}",
            headers={"Content-Type": "application/json"},
        )

        assert response.status_code == 422
