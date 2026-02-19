# 🔗 ST-Companion-Link (Complete Suite)

**小红书 / Bilibili / 现实世界 (Reality) ⟷ SillyTavern 实时联动系统 (v2.1)**

> 让 AI 角色拥有“潜意识”——它不仅能看到你分享的内容，还能默默关注你的浏览喜好，甚至感知你刚结束的游戏，陪你一起看视频发弹幕。

这是一个完整的全栈解决方案，将你的浏览器行为（小红书点赞、B站投币）与现实状态（游戏进程）实时同步给 SillyTavern 中的 AI 角色，实现沉浸式的跨次元陪伴。

![Architecture](https://img.shields.io/badge/Architecture-v2.1-blue) ![Python](https://img.shields.io/badge/Python-3.10%2B-green) ![SillyTavern](https://img.shields.io/badge/SillyTavern-1.12%2B-orange)

---

## ✨ 核心特性 (v2.1 Major Update)

### 1. 📺 双平台深度适配
- **🔴 小红书 (Xiaohongshu)**: 完美解析图文笔记，支持点赞、收藏、评论触发。
- **📺 哔哩哔哩 (Bilibili)**:
    - **视频感知**: 自动解析 BV 号、标题、UP主、封面。
    - **投币联动**: 监测“投币”行为，触发 AI 的“硬币”特效反馈。
    - **进度感知**: AI 知道你是刚开始看 (<5%) 还是已经看完 (>90%)。

### 2. 📡 现实感知 (Passive Telemetry) **[NEW]**
- **静默潜伏**: 后端 `monitor.py` 会默默感知你的电脑状态（如《鸣潮》、《绝区零》运行中），但不主动打扰。
- **隐式背景**: 当你打开浏览器时，系统会自动将“电脑很热”、“刚结束2小时游戏”等环境信息作为 **背景设定** 注入到 AI 的认知中。
- **转场叙事**: AI 会说：“*（{{char}} 注意到你终于关掉了《鸣潮》，正靠在椅子上休息...）*”

### 3. ⚡ Draft & Go (跨平台一键点评) **[NEW]**
- **场景触发**: 
    - **双修联动**: 当你一边刷小红书一边看 B站。
    - **游戏联动**: 当你刚打完游戏，立刻去 B 站看该游戏的攻略。
- **自动拟稿**: AI 会兴奋地为你拟定一条神评论：“*刚才我也在刷这只BOSS，P2阶段那个闪避判定真的绝了...*”
- **一键三连**: 聊天窗会出现粉色按钮 `🔗 跨平台一键点评`，点击即自动复制草稿并跳转 B 站视频页。

### 4. 🧠 潜意识积累 (Subconscious Buffer)
- **无感注入**：AI 会在后台默默“知道”你最近15分钟关注的话题（如：#绝区零 #Kpop #穿搭），仅作为背景参考。
- **自然关联**：当你主动分享时，AI 会结合这些“潜意识”进行回复。

---

## 📦 项目组成

| 组件 | 文件夹 | 说明 |
| :--- | :--- | :--- |
| **1. 观察员** | `chrome-extension/` | **Chrome 扩展**，安装在浏览器中，负责监听行为。 |
| **2. 翻译官** | `backend/` | **Python 后端**，负责数据清洗、缓存管理、进程监控。 |
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
4. **运行后端** (建议保持后台运行)：
   - **Windows 用户**：直接双击项目根目录下的 `start_backend.bat`。
   - **命令行启动**：`python main.py`

### 第二步：加载浏览器扩展 (Chrome Extension)
... (略)

### 第三步：安装 SillyTavern 扩展

**手动安装（推荐）：**
1. 复制 `SillyTavern-CompanionLink` 文件夹到 SillyTavern 的 `public/scripts/extensions` 目录。
2. **关键步骤**：将 `SillyTavern-CompanionLink/server` 文件夹内的内容，复制到 SillyTavern 的 `plugins/companion-link` 目录（需手动创建）。
   - 目标路径应为：`SillyTavern/plugins/companion-link/index.js`
3. 修改 SillyTavern 的 `config.yaml`，启用 Server Plugins：
   ```yaml
   enableServerPlugins: true
   ```
4. 重启 SillyTavern。

---

## ⚙️ 高级配置 (Customization)

### 添加新游戏/应用监控
想让 AI 知道你在玩《黑神话：悟空》或写代码？
1. 打开 `backend/games.json` 文件（该文件现在已默认包含在仓库中）。
2. 在 `apps` 列表中添加一项：
   ```json
   {
       "exe": "b1-Win64-Shipping.exe",
       "name": "黑神话：悟空",
       "type": "gaming"
   }
   ```
3. 重启后端即可生效。

---

## 🛠️ 常见问题

**Q: 启动后报错 `ModuleNotFoundError`？**
A: 请确保在 `backend` 目录下运行了 `pip install -r requirements.txt`。

**Q: 游戏联动没触发？**
A: 
1. 确保后端进程正在运行。
2. 确保游戏进程名在 `backend/games.json` 中。
3. 游戏结束后的有效“照顾期”默认为 30 分钟。

---

## 📄 License

MIT
