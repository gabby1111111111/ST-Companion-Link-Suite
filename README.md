# 🔗 ST-Companion-Link (Complete Suite)

**小红书 / Bilibili ⟷ SillyTavern 实时联动系统 (v2.1)**

> 让 AI 角色拥有“潜意识”——它不仅能看到你分享的内容，还能默默关注你的浏览喜好，甚至陪你一起看视频发弹幕。

这是一个完整的全栈解决方案，将你的浏览器行为（小红书点赞、B站投币、阅读记录）实时同步给 SillyTavern 中的 AI 角色，实现沉浸式的跨次元陪伴。

---

## ✨ 核心特性 (v2.1 Major Update)

### 1. 📺 双平台深度适配
- **🔴 小红书 (Xiaohongshu)**: 完美解析图文笔记，支持点赞、收藏、评论触发。
- **📺 哔哩哔哩 (Bilibili)**: **[NEW]** 
    - **视频感知**: 自动解析 BV 号、标题、UP主、封面。
    - **投币联动**: 监测“投币”行为，触发 AI 的“硬币”特效反馈 (🪙)。
    - **进度感知**: AI 知道你看到了第几分钟，并能根据进度（刚开始 vs用于看完了）给出不同反应。

### 2. 🧠 潜意识积累 (Subconscious Buffer)
当你浏览内容时，系统会**静默记录**你最近 **15分钟** 的浏览历史（标题 + 标签），而不会打断对话。
- **无感注入**：AI 会在后台默默“知道”你最近关注的话题（如：#绝区零 #Kpop #穿搭）。
- **自然关联**：当你主动分享（投币/点赞）时，AI 会结合这些“潜意识”进行回复，例如：“*我看你刚才连续看了好几个猫咪视频，终于忍不住给这个投币了吗？*”

### 3. 🎭 "神吐槽" 叙事级 Prompt
- **场景化旁白**: 注入文本不再是生硬的数据，而是小说般的描写：*“（此时，{{user}} 把手机屏幕侧过来给你看...）”*
- **性格化反馈**: 
    - **秒退党**: 如果视频进度 < 5%，AI 会吐槽：“*喂，标题党吧？这就关了？*”
    - **真爱粉**: 如果视频进度 > 90%，AI 会夸奖：“*居然耐心看完了，看来是真爱啊。*”

### 4. 🛡️ 架构级坚固 (Hardening)
- **SPA 路由适配**: 完美支持 B 站不刷新换视频场景。
- **智能防抖**: 针对 B 站投币手滑连点，提供 **3秒** 智能防抖，杜绝刷屏。
- **高并发安全**: 后端引入 `RLock` 线程锁，确保高频浏览下的数据一致性。

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
3. 复制 `.env.example` 为 `.env` 并配置。
4. 运行后端 (会自动在该目录下生成 `read_buffer.pkl` 等缓存文件)：
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
   - 目标路径应为：`SillyTavern/plugins/companion-link/index.js`
3. 修改 SillyTavern 的 `config.yaml`，确保启用 Server Plugins：
   ```yaml
   enableServerPlugins: true
   ```
4. 重启 SillyTavern。

---

## 🛠️ 常见问题

**Q: B站投币后没反应？**
A: 
1. 只有**投币成功**（按钮变亮）才会触发。
2. 有 **3秒防抖** 冷却时间，请勿频繁点击。
3. 检查后端日志是否显示 `📡 Signal Received: coin`。

**Q: 为什么有时候是“静默感知”有时候是“主动触发”？**
A: 
- **观看/浏览** = 静默（存入 Buffer，不打扰）。
- **点赞/投币/评论** = 主动（AI 立即回复）。

**Q: 进度条检测显示 00:00？**
A: 请确保视频已经开始播放。系统会自动轮询获取当前进度。

---

## 📄 License

MIT
