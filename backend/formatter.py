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
    将笔记数据格式化为 SillyTavern 注入上下文

    Args:
        action: 触发行为类型
        note: 结构化笔记数据
        user_comment: 用户发送的评论内容（仅 comment 行为）

    Returns:
        CompanionContext: 包含预格式化文本的联动上下文
    """
    action_desc = ACTION_DESCRIPTIONS.get(action, "浏览了")

    # --- 构建格式化文本 ---
    lines = [
        "[Companion-Link 实时上下文]",
        f"用户刚刚在小红书上{action_desc}一篇笔记：",
        "",
    ]

    # 标题
    if note.title:
        lines.append(f"标题：《{note.title}》")

    # 作者
    if note.author.nickname:
        lines.append(f"作者：{note.author.nickname}")

    # 正文摘要
    if note.content_summary:
        lines.append(f"正文摘要：{note.content_summary}")

    # 互动数据
    inter = note.interaction
    if any([inter.like_count, inter.collect_count, inter.comment_count]):
        stats = []
        if inter.like_count:
            stats.append(f"❤️ {_format_count(inter.like_count)}")
        if inter.collect_count:
            stats.append(f"⭐ {_format_count(inter.collect_count)}")
        if inter.comment_count:
            stats.append(f"💬 {_format_count(inter.comment_count)}")
        lines.append(f"互动数据：{' | '.join(stats)}")

    # 标签
    if note.tags:
        tag_str = " ".join(f"#{t}" for t in note.tags[:5])
        lines.append(f"标签：{tag_str}")

    # 热评
    if note.top_comments:
        lines.append("")
        lines.append(f"热评TOP{len(note.top_comments)}：")
        for i, comment in enumerate(note.top_comments, 1):
            like_str = f" (❤️ {_format_count(comment.like_count)})" if comment.like_count else ""
            lines.append(
                f'{i}. "{comment.content}"{like_str} —— {comment.user_nickname}'
            )

    # 用户自己的评论
    if user_comment:
        lines.append("")
        lines.append(f"用户自己评论道：「{user_comment}」")

    # 行为指引
    lines.append("")
    lines.append(_get_action_guidance(action))

    formatted_text = "\n".join(lines)

    logger.info(
        f"📝 格式化完成: action={action.value}, "
        f"title={note.title[:20]}..., "
        f"text_length={len(formatted_text)}"
    )

    return CompanionContext(
        action=action,
        note=note,
        user_comment=user_comment,
        formatted_text=formatted_text,
    )


def _get_action_guidance(action: ActionType) -> str:
    """根据行为类型返回 AI 角色的行为指引"""
    guidance_map = {
        ActionType.LIKE: "请自然地融入对话，对这篇笔记发表你的看法或感受。",
        ActionType.COMMENT: "用户刚参与了评论互动，请对笔记内容和用户的评论做出自然的回应。",
        ActionType.READ: "用户花了较长时间阅读这篇笔记，似乎非常感兴趣。请自然地展开话题讨论。",
        ActionType.COLLECT: "用户收藏了这篇笔记，说明觉得很有价值。请对内容做出正面的、有深度的评价。",
        ActionType.SHARE: "用户分享了这篇笔记，请积极参与讨论并表达你的见解。",
    }
    return guidance_map.get(
        action, "请自然地融入对话，对这篇笔记发表你的看法。"
    )


def _format_count(count: int) -> str:
    """将数字格式化为可读字符串 (如 12345 → 1.2万)"""
    if count >= 10000:
        return f"{count / 10000:.1f}万"
    return str(count)
