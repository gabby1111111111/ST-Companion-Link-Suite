"""
formatter.py 测试

覆盖场景：
1. 各种行为类型的格式化输出
2. 无评论/无互动/无作者/无标签的边界情况
3. 用户评论的注入
4. 数字格式化 (万单位)
5. 行为指引文本的正确性
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from models import ActionType, NoteData, NoteAuthor, NoteInteraction
from formatter import format_for_sillytavern, _format_count, _get_action_guidance


# ============================================================
# 格式化输出测试
# ============================================================


class TestFormatForSillytavern:
    """format_for_sillytavern 函数测试"""

    def test_like_action_basic(self, make_note_data):
        """点赞行为 - 完整数据"""
        note = make_note_data()
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "[Companion-Link 实时上下文]" in ctx.formatted_text
        assert "点赞了" in ctx.formatted_text
        assert "《测试笔记》" in ctx.formatted_text
        assert "测试作者" in ctx.formatted_text
        assert ctx.action == ActionType.LIKE

    def test_comment_action_with_user_comment(self, make_note_data):
        """评论行为 - 包含用户评论"""
        note = make_note_data()
        ctx = format_for_sillytavern(
            ActionType.COMMENT, note, user_comment="我也想试试！"
        )

        assert "评论了" in ctx.formatted_text
        assert "用户自己评论道：「我也想试试！」" in ctx.formatted_text
        assert ctx.user_comment == "我也想试试！"

    def test_read_action(self, make_note_data):
        """阅读行为"""
        note = make_note_data()
        ctx = format_for_sillytavern(ActionType.READ, note)

        assert "仔细阅读了" in ctx.formatted_text

    def test_collect_action(self, make_note_data):
        """收藏行为"""
        note = make_note_data()
        ctx = format_for_sillytavern(ActionType.COLLECT, note)

        assert "收藏了" in ctx.formatted_text

    def test_share_action(self, make_note_data):
        """分享行为"""
        note = make_note_data()
        ctx = format_for_sillytavern(ActionType.SHARE, note)

        assert "分享了" in ctx.formatted_text

    def test_interaction_stats_display(self, make_note_data):
        """互动数据显示 - 万单位"""
        note = make_note_data(with_interaction=True)
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "❤️ 1.2万" in ctx.formatted_text
        assert "⭐ 3456" in ctx.formatted_text
        assert "💬 789" in ctx.formatted_text or "💬 789" in ctx.formatted_text

    def test_tags_display(self, make_note_data):
        """标签显示"""
        note = make_note_data(with_tags=True)
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "#美食" in ctx.formatted_text
        assert "#家常菜" in ctx.formatted_text

    def test_comments_display(self, make_note_data):
        """热评显示"""
        note = make_note_data(with_comments=True)
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "热评TOP2" in ctx.formatted_text
        assert "好棒！" in ctx.formatted_text
        assert "用户A" in ctx.formatted_text

    def test_context_model_fields(self, make_note_data):
        """CompanionContext 模型字段完整性"""
        note = make_note_data()
        ctx = format_for_sillytavern(ActionType.LIKE, note, "我的评论")

        assert ctx.action == ActionType.LIKE
        assert ctx.note.note_id == "test123"
        assert ctx.user_comment == "我的评论"
        assert len(ctx.formatted_text) > 0
        assert ctx.timestamp is not None


# ============================================================
# 边界情况：缺失数据
# ============================================================


class TestFormatMissingData:
    """缺失字段时的格式化行为"""

    def test_no_comments(self, make_note_data):
        """没有评论 → 不显示热评区域"""
        note = make_note_data(with_comments=False)
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "热评" not in ctx.formatted_text

    def test_no_interaction(self, make_note_data):
        """没有互动数据 → 不显示互动行"""
        note = make_note_data(with_interaction=False)
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "互动数据" not in ctx.formatted_text

    def test_no_author(self, make_note_data):
        """没有作者 → 不显示作者行"""
        note = make_note_data(with_author=False)
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "作者：" not in ctx.formatted_text

    def test_no_tags(self, make_note_data):
        """没有标签 → 不显示标签行"""
        note = make_note_data(with_tags=False)
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "标签：" not in ctx.formatted_text

    def test_no_user_comment(self, make_note_data):
        """没有用户评论 → 不显示评论区域"""
        note = make_note_data()
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "用户自己评论道" not in ctx.formatted_text

    def test_empty_title(self, make_note_data):
        """空标题 → 不显示标题行"""
        note = make_note_data(title="")
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "标题：" not in ctx.formatted_text

    def test_minimal_note(self):
        """最小数据的笔记 → 仍然能生成不崩溃"""
        note = NoteData(
            note_id="min",
            note_url="https://example.com",
        )
        ctx = format_for_sillytavern(ActionType.LIKE, note)

        assert "[Companion-Link 实时上下文]" in ctx.formatted_text
        assert "点赞了" in ctx.formatted_text


# ============================================================
# 工具函数测试
# ============================================================


class TestFormatCount:

    def test_small_number(self):
        assert _format_count(999) == "999"
        assert _format_count(0) == "0"

    def test_wan_number(self):
        assert _format_count(10000) == "1.0万"
        assert _format_count(12345) == "1.2万"
        assert _format_count(100000) == "10.0万"


class TestGetActionGuidance:

    def test_all_actions_have_guidance(self):
        """每种行为类型都有对应的指引文本"""
        for action in ActionType:
            guidance = _get_action_guidance(action)
            assert len(guidance) > 10  # 至少有一句话
            assert "请" in guidance  # 指引都包含 "请"
