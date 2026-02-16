"""
Companion-Link 数据模型
参考 xiaohongshu-mcp 的数据结构，标准化为 Pydantic 模型
"""

from enum import Enum
from typing import Optional, Any
from datetime import datetime

from pydantic import BaseModel, Field


# ============================================================
# 信号模型 (Chrome Extension → Backend)
# ============================================================


class ActionType(str, Enum):
    """用户行为类型"""
    LIKE = "like"           # 点赞
    COMMENT = "comment"     # 发送评论
    READ = "read"           # 长时间阅读 (>5秒)
    COLLECT = "collect"     # 收藏
    SHARE = "share"         # 分享


class SignalPayload(BaseModel):
    """Chrome 扩展发送的信号"""
    action: ActionType = Field(..., description="用户行为类型")
    note_url: str = Field(..., description="笔记 URL")
    note_id: Optional[str] = Field(None, description="笔记 ID (从 URL 解析)")
    xsec_token: Optional[str] = Field(None, description="小红书 xsec_token")
    comment_text: Optional[str] = Field(
        None, description="用户发送的评论内容 (仅 comment 行为)"
    )
    dwell_time: Optional[float] = Field(
        None, description="停留时长（秒）(仅 read 行为)"
    )
    note_data: Optional[dict[str, Any]] = Field(
        None, description="前端提取的完整笔记数据 (优先使用，后端提取为兜底)"
    )
    timestamp: datetime = Field(
        default_factory=datetime.now,
        description="信号时间戳",
    )


# ============================================================
# 小红书笔记数据模型 (参考 xiaohongshu-mcp 的 FeedDetail)
# ============================================================


class NoteAuthor(BaseModel):
    """笔记作者信息"""
    user_id: Optional[str] = None
    nickname: str = ""
    avatar_url: Optional[str] = None


class NoteComment(BaseModel):
    """笔记评论"""
    user_nickname: str = ""
    content: str = ""
    like_count: int = 0
    sub_comment_count: int = 0


class NoteInteraction(BaseModel):
    """笔记互动数据"""
    like_count: int = 0
    collect_count: int = 0
    comment_count: int = 0
    share_count: int = 0


class NoteData(BaseModel):
    """
    结构化笔记数据
    字段设计参考 xiaohongshu-mcp 的 FeedDetailResponse
    """
    note_id: str = Field(..., description="笔记 ID")
    note_url: str = Field(..., description="笔记原始 URL")
    title: str = Field(default="", description="笔记标题")
    content: str = Field(default="", description="笔记正文")
    content_summary: str = Field(default="", description="正文摘要")
    author: NoteAuthor = Field(default_factory=NoteAuthor)
    interaction: NoteInteraction = Field(default_factory=NoteInteraction)
    top_comments: list[NoteComment] = Field(
        default_factory=list, description="热门评论"
    )
    tags: list[str] = Field(default_factory=list, description="标签")
    images: list[str] = Field(default_factory=list, description="图片 URL 列表")
    note_type: str = Field(default="normal", description="笔记类型: normal/video")
    created_at: Optional[str] = Field(None, description="笔记发布时间")
    extracted_at: datetime = Field(
        default_factory=datetime.now,
        description="数据提取时间",
    )


# ============================================================
# 联动上下文模型 (Backend → SillyTavern)
# ============================================================


class CompanionContext(BaseModel):
    """发送给 SillyTavern 的联动上下文"""
    action: ActionType = Field(..., description="触发行为")
    note: NoteData = Field(..., description="笔记数据")
    user_comment: Optional[str] = Field(
        None, description="用户自己发送的评论"
    )
    formatted_text: str = Field(
        default="", description="预格式化的注入文本"
    )
    timestamp: datetime = Field(default_factory=datetime.now)


# ============================================================
# API 响应模型
# ============================================================


class APIResponse(BaseModel):
    """标准 API 响应"""
    success: bool
    message: str
    data: Optional[dict] = None


class WebhookTarget(BaseModel):
    """Webhook 注册目标"""
    url: str = Field(..., description="Webhook URL")
    name: Optional[str] = Field(None, description="Webhook 名称")
    events: list[ActionType] = Field(
        default_factory=lambda: list(ActionType),
        description="监听的事件类型，默认全部",
    )
