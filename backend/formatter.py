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
}



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

    # --- 构建 "手机卡片" 样式 Markdown ---
    # <details>
    # <summary>📱 小红书笔记分享 · 点赞了</summary>
    #
    # > ─────────────────
    # > ...
    # </details>

    lines = [
        f"<details>",
        f"<summary>📱 小红书笔记分享 · {action_desc}</summary>",
        "",  # HTML标签后必须空一行才能正常渲染 Markdown 引用
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
        # 防止正文中的 # 被渲染成标题
        content = content.replace('#', '＃')
        if len(content) > 200:
            content = content[:200] + "..."
        lines.append(f"> {content}")
        lines.append(">")

    # 互动数据 + 标签 (合并到一行)
    inter = note.interaction
    stats = []
    if inter.like_count:
        stats.append(f"❤️ {_format_count(inter.like_count)}")
    if inter.collect_count:
        stats.append(f"⭐ {_format_count(inter.collect_count)}")
    if inter.comment_count:
        stats.append(f"💬 {_format_count(inter.comment_count)}")
    
    stats_str = "  ".join(stats) if stats else ""
    
    # 标签用「」包裹，避免 # 被渲染成 markdown 标题
    if note.tags:
        tag_str = " ".join(f"「{t}」" for t in note.tags[:5])
        if stats_str:
            lines.append(f"> {stats_str}  ｜  {tag_str}")
        else:
            lines.append(f"> {tag_str}")
    elif stats_str:
        lines.append(f"> {stats_str}")

    # Top 3 热门评论
    if note.top_comments:
        lines.append("> ─────────────────")
        lines.append("> 💬 热门评论:")
        for comment in note.top_comments[:3]:
            nickname = comment.user_nickname or "匿名"
            text = comment.content.replace('\n', ' ').strip()
            if len(text) > 80:
                text = text[:80] + "..."
            likes = f" ({_format_count(comment.like_count)}❤️)" if comment.like_count else ""
            lines.append(f"> › **{nickname}**: {text}{likes}")

    # 用户自己的评论
    if user_comment:
        lines.append("> ─────────────────")
        lines.append(f"> 🗣️ 我的评论: \"{user_comment}\"")

    lines.append("</details>")

    formatted_text = "\n".join(lines)

    logger.info(
        f"📝 格式化完成: action={action.value}, "
        f"title={note.title[:20]}..., "
        f"length={len(formatted_text)}"
    )

    return CompanionContext(
        action=action,
        note=note,
        user_comment=user_comment,
        formatted_text=formatted_text,
    )


def _get_action_guidance(action: ActionType) -> str:
    """(Deprecated) 行为指引现由前端 Prompt 处理，保留此函数兼容旧代码或备用"""
    return ""


def _format_count(count: int) -> str:
    """将数字格式化为可读字符串 (如 12345 → 1.2w)"""
    if not count:
        return "0"
    if count >= 10000:
        return f"{count / 10000:.1f}w"
    if count >= 1000:
         return f"{count / 1000:.1f}k"
    return str(count)


