"""
Companion-Link Python 后端入口

FastAPI 服务：接收 Chrome 扩展信号 → 提取小红书数据 → 格式化 → 分发
"""

import logging
import httpx # Added by user
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from models import (
    SignalPayload,
    APIResponse,
    WebhookTarget,
    ActionType,
)
from extractor import extractor
from formatter import format_for_sillytavern
from dispatcher import dispatcher
from read_buffer import read_buffer
from monitor import SystemObserver
import asyncio

# 全局 System Observer
system_observer = SystemObserver()

# ============================================================
# 日志配置
# ============================================================

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s | %(name)-30s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("companion-link")


# ============================================================
# 应用生命周期
# ============================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期"""
    logger.info("🚀 Companion-Link Backend 启动中...")
    logger.info(f"   监听地址: {settings.host}:{settings.port}")
    logger.info(f"   SillyTavern: {settings.sillytavern_url}")
    logger.info(f"   已注册 Webhook: {len(dispatcher.list_webhooks())} 个")
    
    logger.info(f"   已注册 Webhook: {len(dispatcher.list_webhooks())} 个")
    
    # 启动 System Observer (但不开启自动推送 Loop)
    system_observer.start()

    # 🔄 Tell SillyTavern to Clear Context (Sync Reset)
    try:
        async with httpx.AsyncClient() as client:
            st_clear_url = f"{settings.sillytavern_url}/api/plugins/companion-link/clear"
            await client.post(st_clear_url, json={"clear_history": True}, timeout=2.0)
            logger.info("🧹 已通知 SillyTavern 清空旧上下文 (Sync Reset)")
    except Exception as e:
        logger.warning(f"⚠️ 无法连接 SillyTavern 清空上下文: {e}")
    
    yield
    
    logger.info("👋 Companion-Link Backend 正在关闭...")
        
    await extractor.close()
    await dispatcher.close()

# Removed telemetry_loop: Passive Mode Enabled (Phase 19)


# ============================================================
# FastAPI 应用
# ============================================================

app = FastAPI(
    title="Companion-Link Backend",
    description="小红书 ⟷ SillyTavern 实时联动中间件",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS - 允许 Chrome 扩展跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Chrome 扩展需要
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 路由: 核心信号接收
# ============================================================


@app.post("/api/signal", response_model=APIResponse)
async def receive_signal(signal: SignalPayload):
    """
    接收来自 Chrome 扩展的用户行为信号

    流程:
    1. 优先使用前端传来的 note_data 构建 NoteData
    2. 如前端未提供，降级到后端 httpx 抓取（兜底）
    3. 格式化为 SillyTavern 可注入文本
    4. 通过分发器推送到所有目标
    """
    logger.info(
        f"📡 收到信号: action={signal.action.value}, "
        f"url={signal.note_url}"
    )

    try:
        # Step 1: 获取笔记数据（前端优先 → 后端兜底）
        note_data = _build_note_from_frontend(signal)
        if note_data:
            logger.info(f"📄 使用前端数据: 《{note_data.title}》")
        else:
            logger.info("📄 前端未提供数据，降级到后端提取...")
            note_data = await extractor.extract(signal.note_url)
            logger.info(f"📄 后端提取完成: 《{note_data.title}》")

        # ============================================================
        # Step 2: 分级处理 (Tiered Dispatch)
        # ============================================================

        if signal.action == ActionType.READ:
            # 3. 如果是 Read 操作，更新缓冲区 (潜意识)
            read_buffer.add(
                title=note_data.title,
                tags=note_data.tags,
                url=note_data.note_url,
                author=note_data.author.nickname,
                content=note_data.content  # Added content
            )
            
            # 立即生成并推送 System Note (Silent)
            # 只有当缓冲区积累了一定数据，或者刚好是 active 时才推？read_buffer.get_keywords_summary()
            keywords = read_buffer.get_keywords_summary()
            system_note_text = (
                f"（潜意识感知：用户最近 15 分钟浏览了关于 {keywords} 的内容，"
                f"仅作为背景参考，除非必要请勿主动提起。）"
            ) if keywords else None

            # 推送 System Note 到 SillyTavern（静默，无 chat 消息）
            dispatch_results = {}
            if system_note_text:
                dispatch_results["system_note"] = await dispatcher.push_system_note(
                    system_note_text
                )
            logger.info(
                f"🔇 静默感知: 缓冲区={read_buffer.size()}, "
                f"keywords='{keywords[:50]}'"
            )
            
            # -- 把静默浏览记录发射到 Aegis-Isle 的 EventBus 中 --
            from aegis_client import update_state
            asyncio.create_task(update_state(
                user_id="gabby",
                action=signal.action.value,
                title=note_data.title,
                tags=note_data.tags,
                url=signal.note_url,
                platform=note_data.platform,
                comment=signal.comment_text
            ))

            return APIResponse(
                success=True,
                message=f"静默感知: read → 《{note_data.title}》 (缓冲区 {read_buffer.size()} 条)",
                data={
                    "note_id": note_data.note_id,
                    "title": note_data.title,
                    "buffer_size": read_buffer.size(),
                    "dispatch_results": dispatch_results,
                },
            )

        else:
            # -------- 主动触发路径 (Like/Comment → Format + Aggregate) --------
            # Step 2a: 格式化当前笔记
            context = format_for_sillytavern(
                action=signal.action,
                note=note_data,
                user_comment=signal.comment_text,
            )
            # Inject Passive Telemetry
            context.system_telemetry = system_observer.capture_snapshot()

            # Step 2b: 聚合缓冲区上下文
            buffer_entries = read_buffer.get_display_entries()
            buffer_summary = read_buffer.get_keywords_summary()

            # --- RAG 增强：将行为事件送至 Aegis-Isle 离线日记系统 ---
            from aegis_client import update_state
            
            # 使用 create_task 异步抛给后台写入 EventBus，不阻塞当前流程
            asyncio.create_task(update_state(
                user_id="gabby",
                action=signal.action.value,
                title=note_data.title,
                tags=note_data.tags,
                url=signal.note_url,
                platform=note_data.platform,
                comment=signal.comment_text
            ))
            # （注：Aegis 本身就是代理，ST 调用补全时会自动通过 memory.py 注入 FAISS 背景，这里无需再主动取回）
            # -------------------------------------------------------------

            # Step 3: 分发到各目标（附带缓冲区数据）
            dispatch_results = await dispatcher.dispatch(
                context,
                buffer_entries=buffer_entries,
                buffer_summary=buffer_summary,
            )
            logger.info(f"📤 分发完成: {dispatch_results}")

            return APIResponse(
                success=True,
                message=f"信号处理完成: {signal.action.value} → 《{note_data.title}》",
                data={
                    "note_id": note_data.note_id,
                    "title": note_data.title,
                    "source": "frontend" if signal.note_data else "backend",
                    "buffer_context": buffer_summary,
                    "dispatch_results": dispatch_results,
                },
            )

    except Exception as e:
        logger.error(f"❌ 信号处理失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # 更新全局状态 — 仅 like/comment 写入 LATEST_CONTEXT
        # read 不写入，避免前端误触发
        if 'context' in locals() and signal.action != ActionType.READ:
            global LATEST_CONTEXT
            should_trigger = signal.action in (ActionType.LIKE, ActionType.COMMENT)

            # 聚合缓冲区数据
            buf_entries = read_buffer.get_display_entries()
            buf_summary = read_buffer.get_keywords_summary()

            LATEST_CONTEXT = {
                "id": f"cl_{int(context.timestamp.timestamp() * 1000)}_{_short_id()}",
                "action": signal.action.value,
                "should_trigger": should_trigger,
                "timestamp": context.timestamp.isoformat(),
                "note": {
                    "title": context.note.title,
                    "author": context.note.author.nickname,
                    "summary": context.note.content_summary,
                    "url": context.note.note_url,
                },
                "formatted_text": context.formatted_text,
                "user_comment": context.user_comment,
                # 新增: 缓冲区聚合数据 (title + tags)
                "buffer_entries": buf_entries,
                "buffer_summary": buf_summary,
                # 遥测
                "system_telemetry": context.system_telemetry,
            }
            logger.debug(
                f"🧠 Context 更新: {signal.action.value} | "
                f"(Trigger={should_trigger}, Buffer={len(buf_entries)})"
            )


def _build_note_from_frontend(signal: SignalPayload):
    """
    从前端传来的 note_data 字典构建 NoteData 对象
    如果前端未提供数据或数据不完整，返回 None
    """
    from models import NoteData, NoteAuthor, NoteComment, NoteInteraction

    fd = signal.note_data
    if not fd:
        return None

    try:
        author_raw = fd.get("author", {}) or {}
        interact_raw = fd.get("interaction", {}) or {}
        comments_raw = fd.get("top_comments", []) or []

        note_data = NoteData(
            note_id=fd.get("note_id") or signal.note_id or "unknown",
            note_url=signal.note_url,
            platform=fd.get("platform", "xiaohongshu"),
            title=fd.get("title", "") or "",
            content=fd.get("content", "") or "",
            content_summary=(fd.get("content", "") or "")[:200],
            note_type=fd.get("note_type", "normal") or "normal",
            play_progress=fd.get("play_progress", ""),
            author=NoteAuthor(
                user_id=author_raw.get("user_id", ""),
                nickname=author_raw.get("nickname", ""),
                avatar_url=author_raw.get("avatar", ""),
            ),
            interaction=NoteInteraction(
                like_count=interact_raw.get("like_count", 0) or 0,
                collect_count=interact_raw.get("collect_count", 0) or 0,
                comment_count=interact_raw.get("comment_count", 0) or 0,
                share_count=interact_raw.get("share_count", 0) or 0,
                coin_count=interact_raw.get("coin_count", 0) or 0,
            ),
            top_comments=[
                NoteComment(
                    user_nickname=c.get("user_nickname", ""),
                    content=c.get("content", ""),
                    like_count=c.get("like_count", 0) or 0,
                )
                for c in comments_raw[:3]
            ],
            tags=fd.get("tags", []) or [],
            images=fd.get("images", []) or [],
        )
        return note_data
    except Exception as e:
        logger.warning(f"⚠️ 前端数据解析失败({e})，将降级到后端提取")
        return None


# ============================================================
# 路由: Webhook 管理
# ============================================================


@app.post("/api/webhook/register", response_model=APIResponse)
async def register_webhook(target: WebhookTarget):
    """注册一个外部 Webhook 目标"""
    dispatcher.register_webhook(target)
    return APIResponse(
        success=True,
        message=f"Webhook 已注册: {target.name or target.url}",
    )


@app.delete("/api/webhook/unregister", response_model=APIResponse)
async def unregister_webhook(url: str):
    """注销一个 Webhook 目标"""
    removed = dispatcher.unregister_webhook(url)
    if removed:
        return APIResponse(success=True, message=f"Webhook 已注销: {url}")
    raise HTTPException(status_code=404, detail="Webhook 不存在")


@app.get("/api/webhook/list")
async def list_webhooks():
    """列出所有已注册的 Webhook"""
    targets = dispatcher.list_webhooks()
    return {
        "count": len(targets),
        "webhooks": [t.model_dump() for t in targets],
    }


# ============================================================
# 路由: 调试 & 工具
# ============================================================


@app.get("/api/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "service": "companion-link-backend",
        "version": "0.1.0",
        "sillytavern_url": settings.sillytavern_url,
        "webhook_count": len(dispatcher.list_webhooks()),
    }


@app.post("/api/test/extract", response_model=APIResponse)
async def test_extract(note_url: str):
    """
    测试端点：从指定 URL 提取笔记数据（不触发分发）
    用于调试提取器
    """
    note_data = await extractor.extract(note_url)
    return APIResponse(
        success=True,
        message=f"提取成功: 《{note_data.title}》",
        data=note_data.model_dump(mode="json"),
    )


@app.post("/api/test/format")
async def test_format(note_url: str, action: ActionType = ActionType.LIKE):
    """
    测试端点：提取 + 格式化（不触发分发）
    用于预览 AI 收到的注入文本
    """
    note_data = await extractor.extract(note_url)
    context = format_for_sillytavern(action=action, note=note_data)
    return {
        "formatted_text": context.formatted_text,
        "note": note_data.model_dump(mode="json"),
    }


# ============================================================
# 路由: 前端轮询
# ============================================================

# 内存中的最新上下文（用于前端轮询）
LATEST_CONTEXT = None
# 最新的潜意识 System Note 文本
LATEST_SYSTEM_NOTE = None


@app.get("/latest_context")
async def get_latest_context():
    """
    SillyTavern 扩展轮询端点
    返回最近一次处理的信号上下文
    """
    if not LATEST_CONTEXT:
        return {}
    return LATEST_CONTEXT


@app.get("/telemetry/current")
async def get_current_telemetry():
    """调试端点：获取当前系统遥测快照"""
    return system_observer.capture_snapshot()


@app.get("/buffer/status")
async def buffer_status():
    """
    调试端点：查看 ReadBuffer 当前状态
    """
    return read_buffer.status()


@app.post("/buffer/clear")
async def buffer_clear():
    """
    手动清空 ReadBuffer
    """
    read_buffer.clear()
    return {"success": True, "message": "ReadBuffer 已清空"}


# ============================================================
# 启动入口
# ============================================================

def _short_id() -> str:
    """生成短随机 ID (6 位)"""
    import random
    import string
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
