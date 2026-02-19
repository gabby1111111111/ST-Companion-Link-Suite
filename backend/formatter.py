"""
Companion-Link 数据格式化器

将 NoteData 格式化为 SillyTavern 可注入的文本
"""

import logging
from models import ActionType, NoteData, CompanionContext

logger = logging.getLogger("companion-link.formatter")


# 行为类型的中文描述映射
ACTION_DESCRIPTIONS = {
    ActionType.LIKE: "点赞了",
    ActionType.COMMENT: "评论了",
    ActionType.READ: "仔细阅读了",
    ActionType.COLLECT: "收藏了",
    ActionType.SHARE: "分享了",
    ActionType.COIN: "投币了",
}

class BiliContentService:
    """
    Bilibili 内容感知服务 (Danmaku/Subs)
    """
    def __init__(self):
        # Mock Danmaku Database (In real world, fetch from API)
        self.danmaku_db = {
            "high_energy": ["前方高能", "卧槽", "帅帅帅", "经费在燃烧"],
            "sad": ["泪目", "致敬", "哭死", "意难平"],
            "funny": ["哈哈哈哈", "笑死", "人才", "生草"]
        }

    def get_content_context(self, current_time_str: str, duration_str: str) -> str:
        """
        根据时间进度返回内容上下文 (e.g. "前方高能")
        """
        if not current_time_str or not duration_str:
            return ""

        try:
            # Parse "0:45" -> 45s
            def parse_sec(t):
                if ":" not in t: return 0
                parts = t.split(":")
                return int(parts[0]) * 60 + int(parts[1])
            
            curr = parse_sec(current_time_str)
            total = parse_sec(duration_str)
            
            if total == 0: return ""
            progress = curr / total

            import random
            context = ""
            
            if 0.1 <= progress <= 0.2:
                kw = random.choice(self.danmaku_db["funny"])
                context = f"（此时屏幕上飘过大片“{kw}”的弹幕...）"
            elif 0.5 <= progress <= 0.6:
                kw = random.choice(self.danmaku_db["high_energy"])
                context = f"（弹幕突然刷屏“{kw}”，BGM也变得燃了起来...）"
            elif progress > 0.9:
                kw = random.choice(self.danmaku_db["sad"])
                context = f"（进度条见底，弹幕里满屏都是“{kw}”...）"
                
            return context
        except Exception:
            return ""

# Singleton Service
bili_service = BiliContentService()


def format_for_sillytavern(
    action: ActionType,
    note: NoteData,
    user_comment: str | None = None,
) -> CompanionContext:
    """
    将笔记数据格式化为 SillyTavern 注入上下文 (Modern Phone Card Style)

    Args:
        action: 触发行为类型
        note: 结构化笔记数据
        user_comment: 用户发送的评论内容（仅 comment 行为）

    Returns:
        CompanionContext: 包含预格式化文本的联动上下文
    """
    
    action_desc = ACTION_DESCRIPTIONS.get(action, "浏览了")
    is_bilibili = getattr(note, "platform", "xiaohongshu") == "bilibili"
    
    if is_bilibili:
        return _format_bilibili_card(action, action_desc, note, user_comment)

    # --- 构建 "手机卡片" 样式 Markdown (小红书) ---
    app_name = "小红书笔记分享"
    header_icon = "📱"

    lines = [
        f"<details>",
        f"<summary>{header_icon} {app_name} · {action_desc}</summary>",
        "",
        "> ─────────────────",
    ]

    # 标题 (书名号)
    if note.title:
        lines.append(f"> 「{note.title.strip()}」")
    
    # 作者
    if note.author.nickname:
        lines.append(f"> by {note.author.nickname.strip()}")
    
    lines.append(">")  # 空行分隔

    # 正文内容 (截断200字)
    if note.content_summary:
        content = note.content_summary.replace('\n', ' ').strip()
        content = content.replace('#', '＃')
        if len(content) > 200:
            content = content[:200] + "..."
        lines.append(f"> {content}")
        lines.append(">")

    # 互动数据 + 标签
    inter = note.interaction
    stats = []
    if inter.like_count:
        stats.append(f"❤️ {_format_count(inter.like_count)}")
    if inter.collect_count:
        stats.append(f"⭐ {_format_count(inter.collect_count)}")
    if inter.comment_count:
        stats.append(f"💬 {_format_count(inter.comment_count)}")
    
    stats_str = "  ".join(stats) if stats else ""
    
    if note.tags:
        tag_str = " ".join(f"「{t}」" for t in note.tags[:5])
        if stats_str:
            lines.append(f"> {stats_str}  ｜  {tag_str}")
        else:
            lines.append(f"> {tag_str}")
    elif stats_str:
        lines.append(f"> {stats_str}")

    _append_comments_and_user_input(lines, note, user_comment)

    lines.append("</details>")
    
    formatted_text = "\n".join(lines)
    logger.info(f"📝 格式化完成 (XHS): {len(formatted_text)} chars")

    return CompanionContext(
        action=action,
        note=note,
        user_comment=user_comment,
        formatted_text=formatted_text,
    )


def _format_bilibili_card(
    action: ActionType,
    action_desc: str,
    note: NoteData,
    user_comment: str | None
) -> CompanionContext:
    # Bilibili 专属粉色卡片样式
    lines = [
        f"<details>",
        f"<summary>📺 Bilibili · {action_desc}</summary>",
        "",
        "> ─────────────────",
    ]

    # 1. 标题
    if note.title:
        lines.append(f"> 🍡 **{note.title.strip()}**")
    
    # 2. UP主 + 进度
    infos = []
    if note.author.nickname:
        infos.append(f"UP主: {note.author.nickname}")
    if note.play_progress:
        infos.append(f"进度: {note.play_progress}")
    
    if infos:
        lines.append(f"> {'  '.join(infos)}")
    
    lines.append(">")

    # 3. 实时弹幕/内容感知 (Phase 26)
    if note.play_progress:
         parts = note.play_progress.split("/")
         if len(parts) == 2:
             content_ctx = bili_service.get_content_context(parts[0].strip(), parts[1].strip())
             if content_ctx:
                 lines.append(f"> {content_ctx}")
                 lines.append(">")
    if note.content_summary:
        content = note.content_summary.replace('\n', ' ').strip()[:100]
        if content:
            lines.append(f"> {content}...")
            lines.append(">")

    # 5. 互动数据 (硬币/三连)
    inter = note.interaction
    stats = []
    if inter.coin_count:
        stats.append(f"🪙 {_format_count(inter.coin_count)}")
    if inter.like_count:
        stats.append(f"👍 {_format_count(inter.like_count)}")
    if inter.collect_count:
        stats.append(f"⭐ {_format_count(inter.collect_count)}")

    stats_str = "  ".join(stats)
    
    # 5. 分区/Tags
    tag_str = ""
    if note.tags:
        tag_str = " ".join(f"#{t}" for t in note.tags[:3])
    
    if stats_str or tag_str:
        lines.append(f"> {stats_str}   {tag_str}")

    _append_comments_and_user_input(lines, note, user_comment)

    lines.append("</details>")

    formatted_text = "\n".join(lines)
    logger.info(f"📝 格式化完成 (Bilibili): {len(formatted_text)} chars")

    return CompanionContext(
        action=action,
        note=note,
        user_comment=user_comment,
        formatted_text=formatted_text,
    )


def _append_comments_and_user_input(lines: list, note: NoteData, user_comment: str | None):
    # 通用: 追加热门评论和用户输入
    if note.top_comments:
        lines.append("> ─────────────────")
        lines.append("> 💬 热门弹幕/评论:")
        for comment in note.top_comments[:3]:
            nickname = comment.user_nickname or "用户"
            text = comment.content.replace('\n', ' ').strip()[:50]
            lines.append(f"> › {nickname}: {text}")

    if user_comment:
        lines.append("> ─────────────────")
        lines.append(f"> 🗣️ 我的评论: \"{user_comment}\"")


def _get_action_guidance(action: ActionType) -> str:
    # (Deprecated) 行为指引现由前端 Prompt 处理, 保留此函数兼容旧代码或备用
    return ""


def _format_count(val: int | float) -> str:
    if not val:
        return "0"
    count = int(val)
    if count >= 10000:
        return f"{count / 10000:.1f}w"
    if count >= 1000:
         return f"{count / 1000:.1f}k"
    return str(count)


