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

## 🚀 安装

### 前置要求

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) 1.12.0+
- Node.js 18+
- [Companion-Link Chrome Extension](https://github.com/gabby1111111111/ST-Companion-Link/tree/main/chrome-extension) (需配合 Chrome 扩展和 Python 后端使用)

### 步骤 1：安装 UI Extension

1. 打开 SillyTavern
2. 点击顶栏的 🧩 **Extensions** 按钮
3. 点击 **Install Extension**
4. 输入本仓库地址并点击安装：
   ```
   https://github.com/gabby1111111111/SillyTavern-CompanionLink-Extension
   ```

### 步骤 2：安装 Server Plugin

UI Extension 自带了 Server Plugin 文件（位于 `server/` 目录），需手动启用。

1. 进入 SillyTavern 的插件目录：
   ```bash
   # Windows PowerShell
   cd <你的SillyTavern路径>
   Copy-Item -Recurse public\scripts\extensions\third-party\SillyTavern-CompanionLink-Extension\server plugins\companion-link
   ```
2. 编辑 SillyTavern 的 `config.yaml`，启用插件：
   ```yaml
   enableServerPlugins: true
   ```
3. 重启 SillyTavern

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

## 📁 目录结构

```
SillyTavern-CompanionLink-Extension/
├── manifest.json       # UI Extension 清单 (必须在根目录)
├── index.js            # UI Extension 主逻辑
├── style.css           # UI 样式
├── server/             # Server Plugin (需手动复刻)
│   └── index.js
├── README.md
└── LICENSE
```

---

## 📄 License

MIT
