"""
Companion-Link Webhook 分发器

将处理后的数据推送到多个目标端：
1. SillyTavern Plugin (主目标)
2. 用户注册的外部 Webhook (如 Aegis-Isle)
"""

import logging
from typing import Optional

import httpx

from config import settings
from models import CompanionContext, ActionType, WebhookTarget, APIResponse

logger = logging.getLogger("companion-link.dispatcher")


class Dispatcher:
    """多目标 Webhook 分发器"""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=10)
        # 内存中的动态 Webhook 列表
        self._webhook_targets: list[WebhookTarget] = []

        # 从配置文件预注册的 Webhook
        for url in settings.webhooks:
            self._webhook_targets.append(
                WebhookTarget(url=url, name="预注册")
            )

    async def close(self):
        """关闭 HTTP 客户端"""
        await self.client.aclose()

    # ============================================================
    # Webhook 注册管理
    # ============================================================

    def register_webhook(self, target: WebhookTarget) -> None:
        """注册一个新的 Webhook 目标"""
        # 去重
        existing_urls = {t.url for t in self._webhook_targets}
        if target.url not in existing_urls:
            self._webhook_targets.append(target)
            logger.info(f"🔗 Webhook 已注册: {target.name or target.url}")
        else:
            logger.warning(f"⚠️ Webhook 已存在，跳过: {target.url}")

    def unregister_webhook(self, url: str) -> bool:
        """注销一个 Webhook 目标"""
        before = len(self._webhook_targets)
        self._webhook_targets = [
            t for t in self._webhook_targets if t.url != url
        ]
        removed = len(self._webhook_targets) < before
        if removed:
            logger.info(f"🔌 Webhook 已注销: {url}")
        return removed

    def list_webhooks(self) -> list[WebhookTarget]:
        """列出所有已注册的 Webhook"""
        return self._webhook_targets.copy()

    # ============================================================
    # 数据分发
    # ============================================================

    async def dispatch(
        self,
        context: CompanionContext,
        buffer_entries: list[dict] | None = None,
        buffer_summary: str | None = None,
    ) -> dict:
        """
        将联动上下文分发到所有目标

        分级策略:
        - 所有 action: 推送数据到 SillyTavern + Webhooks
        - like / comment: 额外触发 AI 主动生成
        - read: 静默推送，不触发主动生成

        Returns:
            dict: 各目标的响应结果
        """
        results = {}

        # 1. 推送数据到 SillyTavern（所有 action）
        st_result = await self._push_to_sillytavern(
            context,
            buffer_entries=buffer_entries,
            buffer_summary=buffer_summary,
        )
        results["sillytavern"] = st_result

        # 2. 主动触发 AI 生成（仅 like / comment）
        if context.action in (ActionType.LIKE, ActionType.COMMENT):
            trigger_result = await self._trigger_ai_generation(context)
            results["ai_trigger"] = trigger_result
            logger.info(
                f"🎤 主动触发: action={context.action.value}, "
                f"result={trigger_result}"
            )
        else:
            logger.debug(
                f"🔇 静默模式: action={context.action.value}, 不触发主动生成"
            )

        # 3. 推送到所有 Webhook
        for target in self._webhook_targets:
            if context.action not in target.events:
                continue
            wh_result = await self._push_to_webhook(target, context)
            results[target.name or target.url] = wh_result

        return results

    async def push_system_note(self, text: str) -> dict:
        """
        推送潜意识 System Note 到 SillyTavern Plugin

        该方法不触发 chat 消息或 AI 生成，
        仅更新 Server Plugin 中的 system_note 变量，
        前端 interceptor 在下次 AI 生成时自动注入。
        """
        url = (
            settings.sillytavern_url.rstrip("/")
            + "/api/plugins/companion-link/inject_system_note"
        )

        headers = {"Content-Type": "application/json"}
        if settings.sillytavern_api_key:
            headers["Authorization"] = f"Bearer {settings.sillytavern_api_key}"

        payload = {"text": text}

        try:
            response = await self.client.post(
                url, json=payload, headers=headers
            )
            response.raise_for_status()
            logger.info(
                f"🧠 System Note 推送成功: "
                f"{len(text)} chars → [{response.status_code}]"
            )
            return {"success": True, "status": response.status_code}
        except httpx.ConnectError:
            logger.warning(
                f"⚠️ System Note 推送失败: SillyTavern 未连接 ({url})"
            )
            return {"success": False, "error": "SillyTavern 未启动"}
        except httpx.HTTPError as e:
            logger.warning(f"⚠️ System Note 推送失败: {e}")
            return {"success": False, "error": str(e)}

    async def _push_to_sillytavern(
        self,
        context: CompanionContext,
        buffer_entries: list[dict] | None = None,
        buffer_summary: str | None = None,
    ) -> dict:
        """推送数据到 SillyTavern Plugin"""
        url = (
            settings.sillytavern_url.rstrip("/")
            + settings.sillytavern_plugin_route
        )

        headers = {"Content-Type": "application/json"}
        if settings.sillytavern_api_key:
            headers["Authorization"] = f"Bearer {settings.sillytavern_api_key}"

        payload = {
            "action": context.action.value,
            "formatted_text": context.formatted_text,
            "note": context.note.model_dump(mode="json"),
            "user_comment": context.user_comment,
            "timestamp": context.timestamp.isoformat(),
            # 缓冲区聚合数据 (title + tags)
            "buffer_entries": buffer_entries or [],
            "buffer_summary": buffer_summary or "",
        }

        try:
            response = await self.client.post(
                url, json=payload, headers=headers
            )
            response.raise_for_status()
            logger.info(f"🎭 SillyTavern 推送成功: {response.status_code}")
            return {"success": True, "status": response.status_code}
        except httpx.ConnectError:
            logger.warning(
                f"⚠️ SillyTavern 未连接 ({url})"
                " — 如果 ST 插件尚未安装，此提示可忽略"
            )
            return {"success": False, "error": "SillyTavern 未启动或未安装插件"}
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status == 401:
                logger.warning(
                    "⚠️ SillyTavern 返回 401 Unauthorized"
                    " — 请检查 .env 中 CL_SILLYTAVERN_API_KEY 是否配置正确"
                    "，或 SillyTavern 插件是否已安装"
                )
            elif status == 404:
                logger.warning(
                    "⚠️ SillyTavern 返回 404"
                    " — Companion-Link 插件可能尚未安装到 SillyTavern"
                )
            else:
                logger.error(f"❌ SillyTavern 推送失败 [{status}]: {e}")
            return {"success": False, "error": f"HTTP {status}"}
        except httpx.HTTPError as e:
            logger.error(f"❌ SillyTavern 推送失败: {e}")
            return {"success": False, "error": str(e)}

    async def _trigger_ai_generation(
        self, context: CompanionContext
    ) -> dict:
        """
        通知 SillyTavern Server Plugin 触发 AI 主动生成

        仅在 like / comment 时调用。
        即使失败也不阻塞主流程。
        """
        url = (
            settings.sillytavern_url.rstrip("/")
            + "/api/plugins/companion-link/trigger"
        )

        headers = {"Content-Type": "application/json"}
        if settings.sillytavern_api_key:
            headers["Authorization"] = f"Bearer {settings.sillytavern_api_key}"

        payload = {
            "action": context.action.value,
        }

        try:
            response = await self.client.post(
                url, json=payload, headers=headers
            )
            response.raise_for_status()
            logger.info(
                f"🎤 AI 触发成功: {response.status_code}, "
                f"action={context.action.value}"
            )
            return {"success": True, "status": response.status_code}
        except httpx.ConnectError:
            logger.warning(
                f"⚠️ AI 触发失败: SillyTavern 未连接 ({url})"
            )
            return {"success": False, "error": "SillyTavern 未启动"}
        except httpx.HTTPStatusError as e:
            logger.warning(
                f"⚠️ AI 触发失败 [{e.response.status_code}]: {e}"
            )
            return {"success": False, "error": f"HTTP {e.response.status_code}"}
        except httpx.HTTPError as e:
            logger.warning(f"⚠️ AI 触发失败: {e}")
            return {"success": False, "error": str(e)}

    async def _push_to_webhook(
        self, target: WebhookTarget, context: CompanionContext
    ) -> dict:
        """推送数据到外部 Webhook"""
        payload = {
            "source": "companion-link",
            "action": context.action.value,
            "note": context.note.model_dump(mode="json"),
            "formatted_text": context.formatted_text,
            "user_comment": context.user_comment,
            "timestamp": context.timestamp.isoformat(),
        }

        try:
            response = await self.client.post(
                target.url,
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            logger.info(
                f"🔗 Webhook 推送成功: {target.name or target.url} "
                f"[{response.status_code}]"
            )
            return {"success": True, "status": response.status_code}
        except httpx.HTTPError as e:
            logger.error(
                f"❌ Webhook 推送失败: {target.name or target.url} - {e}"
            )
            return {"success": False, "error": str(e)}


# 全局分发器实例
dispatcher = Dispatcher()
