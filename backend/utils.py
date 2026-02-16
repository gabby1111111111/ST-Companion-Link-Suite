"""
Companion-Link 工具函数
"""

import re
from typing import Optional
from urllib.parse import urlparse, parse_qs


def extract_note_id_from_url(url: str) -> Optional[str]:
    """
    从各种格式的小红书 URL 中提取笔记 ID

    支持格式:
    - https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6
    - https://www.xiaohongshu.com/discovery/item/66a1b2c3d4e5f6
    - https://xhslink.com/abc123
    - https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6?xsec_token=xxx
    """
    parsed = urlparse(url)

    # 标准 explore 链接
    if "xiaohongshu.com" in parsed.netloc:
        path_match = re.search(r"/(explore|discovery/item)/([a-f0-9]+)", parsed.path)
        if path_match:
            return path_match.group(2)

    # 短链接
    if "xhslink.com" in parsed.netloc:
        path = parsed.path.strip("/")
        if path:
            return path

    return None


def extract_xsec_token_from_url(url: str) -> Optional[str]:
    """从 URL 查询参数中提取 xsec_token"""
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    tokens = params.get("xsec_token", [])
    return tokens[0] if tokens else None


def sanitize_text(text: str) -> str:
    """
    清理文本内容
    - 去除多余空白
    - 去除零宽字符
    - 规范化换行
    """
    if not text:
        return ""
    # 去除零宽字符
    text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
    # 多个换行 → 最多两个
    text = re.sub(r"\n{3,}", "\n\n", text)
    # 去除首尾空白
    return text.strip()
