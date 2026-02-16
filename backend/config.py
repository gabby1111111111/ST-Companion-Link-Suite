"""
Companion-Link 后端配置管理
支持环境变量 + config.yaml 双重配置
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    """应用配置 - 支持环境变量覆盖"""

    # --- 服务配置 ---
    host: str = Field(default="0.0.0.0", description="服务监听地址")
    port: int = Field(default=8765, description="服务监听端口")
    debug: bool = Field(default=False, description="调试模式")

    # --- SillyTavern 配置 ---
    sillytavern_url: str = Field(
        default="http://localhost:8000",
        description="SillyTavern 服务地址",
    )
    sillytavern_api_key: Optional[str] = Field(
        default=None,
        description="SillyTavern API Key (如果启用了认证)",
    )
    sillytavern_plugin_route: str = Field(
        default="/api/plugins/companion-link/inject",
        description="SillyTavern Companion-Link 插件注入路由",
    )

    # --- 数据提取配置 ---
    extract_timeout: int = Field(default=15, description="HTTP 请求超时(秒)")
    extract_max_comments: int = Field(default=3, description="热评提取条数")
    extract_summary_length: int = Field(default=200, description="正文摘要最大字数")

    # --- Webhook 配置 ---
    webhooks: list[str] = Field(
        default_factory=list,
        description="预注册的 Webhook URL 列表",
    )

    # --- 用户代理 ---
    user_agent: str = Field(
        default=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        description="HTTP 请求 User-Agent",
    )

    model_config = {
        "env_prefix": "CL_",  # 环境变量前缀: CL_HOST, CL_PORT ...
        "env_file": ".env",
        "case_sensitive": False,
    }


# 全局单例
settings = Settings()
