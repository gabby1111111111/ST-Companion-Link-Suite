# 🔗 ST-Companion-Link (Complete Suite)

**小红书 ⟷ SillyTavern 实时联动系统 (v2.0)**

> 让 AI 角色拥有“潜意识”——它不仅能看到你分享的内容，还能默默关注你的浏览喜好。

这是一个完整的全栈解决方案，将你的浏览器行为（小红书点赞、评论、阅读）实时同步给 SillyTavern 中的 AI 角色，实现沉浸式的陪伴体验。

---

## ✨ 核心特性 (v2.0)

### 1. 🧠 潜意识积累 (Subconscious Buffer)
当你浏览小红书笔记时，系统会**静默记录**你最近 **15分钟** 的浏览历史（标题 + 标签），而不会打断对话。
- **无感注入**：AI 会在后台默默“知道”你最近关注的话题（如：#绝区零 #Kpop #穿搭）。
- **自然关联**：当你主动分享（点赞/评论）某篇笔记时，AI 会结合这些“潜意识”进行回复，例如：“*我看你刚才刷了好几篇关于XX的，果然还是这篇最戳你吧？*”

### 2. 📱 沉浸式手机卡片
重新设计的 UI 完美模拟手机分享体验：
- **折叠式设计**：点击 `▶ 📱 小红书笔记分享` 展开详情，保持聊天界面清爽。
- **丰富信息**：包含标题、作者、正文摘要、互动数据 (❤️⭐💬)、标签、**Top 3 热门评论**。
- **Markdown 优化**：完美处理 `#tag`，避免产生巨型标题。

### 3. ⚡ 分级触发机制 (Tiered Dispatch)
系统根据你的行为智能判断触发方式：
| 行为 | 触发方式 | AI 反应 |
| :--- | :--- | :--- |
| **阅读 (Read)** | 🔇 **静默感知** | 不说话，仅更新后台潜意识 Buffer。 |
| **点赞/评论** | 🎤 **主动触发** | **立即回复**，并结合当前笔记 + 潜意识 Buffer 进行评论。 |

### 4. 🛡️ 非破坏性注入
使用 `chat.splice()` 技术，System Note 仅在 AI 生成时暂时插入，**不污染**原始聊天记录，也不影响 Lorebook 或其他插件。

---

## 📦 项目组成

本仓库包含运行该系统所需的**全部三个组件**：

| 组件 | 文件夹 | 说明 |
| :--- | :--- | :--- |
| **1. 观察员** | `chrome-extension/` | **Chrome 扩展**，安装在浏览器中，负责监听行为。 |
| **2. 翻译官** | `backend/` | **Python 后端**，负责数据清洗、缓存管理和中转。 |
| **3. 接收器** | `SillyTavern-CompanionLink/` | **SillyTavern 扩展**，包含前端 UI 和 Server Plugin。 |

---

## 🚀 快速开始

### 第一步：启动后端 (Backend)

1. 确保已安装 Python 3.10+。
2. 进入 `backend` 文件夹，安装依赖：
   ```bash
   pip install -r requirements.txt
   ```
3. 复制 `.env.example` 为 `.env` 并配置（如不需要 ST API Key 可跳过）。
4. 运行后端：
   ```bash
   python main.py
   ```
   *(保持窗口开启)*

### 第二步：加载浏览器扩展 (Chrome Extension)

1. Chrome极其内核浏览器打开 `chrome://extensions/`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目的 `chrome-extension` 文件夹。

### 第三步：安装 SillyTavern 扩展

**手动安装（推荐开发版）：**
1. 复制 `SillyTavern-CompanionLink` 文件夹到 SillyTavern 的 `public/scripts/extensions` 目录。
2. **关键步骤**：将 `SillyTavern-CompanionLink/server` 文件夹内的内容，复制到 SillyTavern 的 `plugins/companion-link` 目录（需手动创建该目录）。
   - 路径应为：`SillyTavern/plugins/companion-link/index.js`
3. 修改 SillyTavern 的 `config.yaml`，确保启用 Server Plugins：
   ```yaml
   enableServerPlugins: true
   ```
4. 重启 SillyTavern。

---

## 🛠️ 常见问题

**Q: 点赞后 AI 没有反应？**
A: 
1. 检查 Python 后端是否运行。
2. 检查 SillyTavern 是否已重启加载 Server Plugin。
3. 确保 SillyTavern 中已连接 API 且处于聊天状态。

**Q: 只有标题，没有正文？**
A: 可能是小红书页面结构变化。系统会自动回退到后端提取模式。请确保笔记链接是公开可访问的。

**Q: Markdown 渲染乱码？**
A: 请确保使用的是最新版代码，v2.0 已修复 `#` 标签渲染问题。

---

## 📄 License

MIT
