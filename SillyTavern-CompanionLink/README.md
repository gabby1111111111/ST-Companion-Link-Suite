# 🔗 Companion-Link for SillyTavern

**小红书 ⟷ SillyTavern 实时联动扩展**

当你在小红书上浏览、点赞、评论、收藏时，AI 角色会实时感知到你的行为并自然地融入对话。

---

## ✨ 功能

- 📡 **实时联动** — 小红书点赞/评论/收藏/深度阅读 → AI 自动感知
- 🧠 **智能注入** — 通过 `generate_interceptor` 在 AI 生成前注入笔记上下文
- ⚙️ **可配置** — 注入位置、文本长度、过期时间等均可在 UI 中调整
- 📋 **历史记录** — 查看最近的联动事件
- 🔔 **通知提醒** — 新数据到达时显示 Toast 通知

---

## 📦 架构

```
Chrome Extension  →  Python Backend  →  ST Server Plugin  →  ST UI Extension  →  AI
   (观察员)          (情报翻译官)        (接收站)              (注入器)
```

| 组件 | 说明 |
|------|------|
| [Chrome Extension](../chrome-extension/) | 监听小红书用户行为 + 前端数据提取 |
| [Python Backend](../backend/) | 信号处理 + 数据格式化 + 分发 |
| **Server Plugin** (`server/`) | 接收后端 POST，存储上下文 |
| **UI Extension** (本目录根) | `generate_interceptor` 注入 AI 对话 |

---

## 🚀 安装

### 前置要求

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) 1.12.0+
- Node.js 18+

### 步骤 1：安装 UI Extension

**方法 A：通过扩展管理器（推荐）**

1. 打开 SillyTavern
2. 点击顶栏的 🧩 **Extensions** 按钮
3. 点击 **Install Extension**
4. 输入本仓库的 GitHub URL：
   ```
   https://github.com/YOUR_USERNAME/SillyTavern-CompanionLink
   ```
5. 点击安装

**方法 B：手动安装**

```bash
cd <SillyTavern>/public/scripts/extensions/third-party/
git clone https://github.com/YOUR_USERNAME/SillyTavern-CompanionLink companion-link
```

### 步骤 2：安装 Server Plugin

```bash
# 复制 server 目录到 SillyTavern 的 plugins 目录
cp -r server/ <SillyTavern>/plugins/companion-link/

# Windows PowerShell:
# Copy-Item -Recurse server\ <SillyTavern>\plugins\companion-link\
```

### 步骤 3：启用 Server Plugin

编辑 SillyTavern 的 `config.yaml`：

```yaml
# 找到 enableServerPlugins，设为 true
enableServerPlugins: true
```

### 步骤 4：重启 SillyTavern

重启后，你应该在控制台看到：
```
[companion-link] 🚀 Server Plugin 初始化...
[companion-link] ✅ 路由已注册: inject, context, history, clear, status
```

---

## ⚙️ 配置

### SillyTavern 端

在 SillyTavern 的 **Extensions** 面板中找到 **🔗 Companion-Link** 设置：

| 设置 | 说明 | 默认值 |
|------|------|--------|
| 启用联动注入 | 主开关 | ✅ 开 |
| 注入位置 | System Note 插入位置 | 最后一条消息前 |
| 注入风格 | 使用后端格式化文本 / 原始数据 | 后端格式化 |
| 上下文过期 | 超过此时间的上下文不注入 | 300 秒 |
| 最大注入字符 | 限制注入文本长度 | 800 字符 |
| 新数据通知 | 收到新联动数据时显示 Toast | ✅ 开 |

### Python 后端端

编辑 `backend/.env`：

```env
# SillyTavern 地址（默认 8000 端口）
CL_SILLYTAVERN_URL=http://localhost:8000

# 如果 SillyTavern 启用了认证，在此填入 API Key
# CL_SILLYTAVERN_API_KEY=your-api-key-here
```

---

## 🔐 鉴权说明

如果你在 SillyTavern 中启用了用户认证（`basicAuthUser`），Python 后端的请求会被 SillyTavern 拦截返回 `401`。

**解决方案（任选其一）**：

1. **配置 API Key**：在 `.env` 中设置 `CL_SILLYTAVERN_API_KEY`，后端会自动添加 `Authorization: Bearer <key>` 请求头
2. **白名单本地连接**：在 SillyTavern 的 `config.yaml` 中设置 `whitelist` 包含 `127.0.0.1`
3. **关闭认证**（仅限本地使用）：`securityOverride: true`

---

## 🧪 API

Server Plugin 注册的路由（前缀 `/api/plugins/companion-link/`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/inject` | 接收联动数据（Python 后端调用） |
| GET | `/context?max_age=300` | 获取最新上下文（UI Extension 轮询） |
| GET | `/history?limit=10` | 获取最近历史 |
| POST | `/clear` | 清除当前上下文 |
| GET | `/status` | 健康检查 + 状态 |

### POST /inject 请求体

```json
{
  "action": "like",
  "formatted_text": "用户在小红书上点赞了...",
  "note": {
    "title": "笔记标题",
    "content": "正文内容",
    "author": { "nickname": "作者名" },
    "interaction": { "like_count": 1200 },
    "top_comments": [
      { "user_nickname": "热评用户", "content": "评论内容" }
    ]
  },
  "user_comment": null,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

---

## 📁 目录结构

```
SillyTavern-CompanionLink/
├── manifest.json       # UI Extension 清单
├── index.js            # UI Extension 主逻辑
├── style.css           # UI 样式
├── README.md           # 本文件
├── LICENSE             # 开源协议
└── server/
    └── index.js        # Server Plugin（需手动复制到 ST/plugins/）
```

---

## 📄 License

MIT
