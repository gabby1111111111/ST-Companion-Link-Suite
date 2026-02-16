"""
Pytest 共享 Fixtures 和测试配置

通过 monkeypatch 确保测试期间不会发出真实 HTTP 请求
"""

import sys
import os
import pytest

# 将 backend 目录加入 Python Path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


@pytest.fixture
def sample_note_url():
    """标准小红书笔记 URL"""
    return "https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6"


@pytest.fixture
def sample_note_id():
    return "66a1b2c3d4e5f6"


@pytest.fixture
def sample_initial_state_html():
    """模拟包含 __INITIAL_STATE__ 的小红书页面 HTML"""
    import json

    state_data = {
        "note": {
            "noteDetailMap": {
                "66a1b2c3d4e5f6": {
                    "note": {
                        "title": "今天做了一碗超好吃的番茄鸡蛋面",
                        "desc": "分享一个简单的番茄鸡蛋面做法，只需要番茄、鸡蛋和面条三样食材就能做出来。先把番茄切块炒出汁，再放入鸡蛋翻炒，最后加水煮面。",
                        "type": "normal",
                        "user": {
                            "userId": "user123",
                            "nickname": "美食小达人",
                            "avatar": "https://example.com/avatar.jpg",
                        },
                        "interactInfo": {
                            "likedCount": "1.2万",
                            "collectedCount": 3456,
                            "commentCount": 789,
                            "shareCount": 234,
                        },
                        "imageList": [
                            {"urlDefault": "https://example.com/img1.jpg"},
                            {"url": "https://example.com/img2.jpg"},
                            {},
                        ],
                        "tagList": [
                            {"name": "美食"},
                            {"name": "家常菜"},
                            {"name": ""},
                        ],
                    },
                    "comments": [
                        {
                            "content": "看起来好好吃！求详细教程",
                            "likeCount": 245,
                            "subCommentCount": 12,
                            "userInfo": {"nickname": "吃货小王"},
                        },
                        {
                            "content": "我也试过，加点糖味道更好",
                            "likeCount": 128,
                            "subCommentCount": 5,
                            "userInfo": {"nickname": "厨房新手"},
                        },
                        {
                            "content": "这不就是我妈做的味道吗",
                            "likeCount": 96,
                            "subCommentCount": 3,
                            "userInfo": {"nickname": "思乡的人"},
                        },
                        {
                            "content": "普通评论",
                            "likeCount": 2,
                            "subCommentCount": 0,
                            "userInfo": {"nickname": "路人甲"},
                        },
                    ],
                }
            }
        }
    }

    json_str = json.dumps(state_data, ensure_ascii=False)
    return f"""
    <html>
    <head><title>Test</title></head>
    <body>
    <script>window.__INITIAL_STATE__={json_str};</script>
    </body>
    </html>
    """


@pytest.fixture
def sample_dom_html():
    """模拟没有 __INITIAL_STATE__ 的小红书页面 HTML（DOM 降级提取）"""
    return """
    <html>
    <head>
        <meta property="og:title" content="OG标题测试" />
        <meta property="og:description" content="OG描述测试" />
    </head>
    <body>
        <div id="detail-title">DOM提取的标题</div>
        <div id="detail-desc">DOM提取的正文内容，这是一段测试用的正文。</div>
        <div class="author"><span class="name">DOM作者</span></div>
        <div class="like-wrapper"><span class="count">5678</span></div>
        <div class="comment-item">
            <span class="name">评论人A</span>
            <span class="content">DOM评论内容1</span>
            <span class="like-count">100</span>
        </div>
        <div class="comment-item">
            <span class="name">评论人B</span>
            <span class="content">DOM评论内容2</span>
        </div>
        <a class="tag" href="/tag/test">#测试标签</a>
        <a class="hashtag">#第二标签</a>
    </body>
    </html>
    """


@pytest.fixture
def sample_empty_html():
    """模拟空白/无内容的页面 HTML"""
    return "<html><head></head><body></body></html>"


@pytest.fixture
def sample_og_only_html():
    """模拟仅有 og 标签的 HTML（标题和内容靠 og 标签降级）"""
    return """
    <html>
    <head>
        <meta property="og:title" content="OG回退标题" />
        <meta property="og:description" content="OG回退正文描述" />
    </head>
    <body></body>
    </html>
    """


@pytest.fixture
def make_note_data():
    """工厂 fixture：快速创建 NoteData 实例"""
    from models import NoteData, NoteAuthor, NoteComment, NoteInteraction

    def _make(
        title="测试笔记",
        content="这是测试正文",
        with_comments=True,
        with_interaction=True,
        with_author=True,
        with_tags=True,
    ):
        comments = []
        if with_comments:
            comments = [
                NoteComment(
                    user_nickname="用户A",
                    content="好棒！",
                    like_count=245,
                ),
                NoteComment(
                    user_nickname="用户B",
                    content="学到了",
                    like_count=128,
                ),
            ]

        interaction = NoteInteraction()
        if with_interaction:
            interaction = NoteInteraction(
                like_count=12000,
                collect_count=3456,
                comment_count=789,
            )

        author = NoteAuthor()
        if with_author:
            author = NoteAuthor(nickname="测试作者")

        tags = []
        if with_tags:
            tags = ["美食", "家常菜"]

        return NoteData(
            note_id="test123",
            note_url="https://www.xiaohongshu.com/explore/test123",
            title=title,
            content=content,
            content_summary=content[:50] if content else "",
            author=author,
            interaction=interaction,
            top_comments=comments,
            tags=tags,
        )

    return _make
