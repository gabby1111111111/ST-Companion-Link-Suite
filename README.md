# 🔗 ST-Companion-Link (Complete Suite)

**小红书 ⟷ SillyTavern 实时联动系统**

这是一个完整的全栈解决方案，让 AI 角色实时感知你的浏览器行为（小红书点赞、评论、阅读）并自然地将其融入对话。

---

## 📦 项目组成

本仓库包含运行该系统所需的**全部三个组件**：

| 组件 | 文件夹 | 说明 |
| :--- | :--- | :--- |
| **1. 观察员** | `chrome-extension/` | **Chrome 扩展**，安装在浏览器中，负责监听行为。 |
| **2. 翻译官** | `backend/` | **Python 后端**，负责数据清洗和中转。 |
| **3. 接收器** | `SillyTavern-CompanionLink/` | **SillyTavern 扩展**，安装在 ST 中，负责接收并注入上下文。 |

*(注：`SillyTavern-CompanionLink` 目录及其内容也可独立发布为 git 仓库)*

---

## 🚀 快速开始

### 第一步：启动后端 (Backend)

1. 进入 `backend` 文件夹。
2. 双击运行 `start_server.bat`。
3. 保持窗口开启。

### 第二步：加载浏览器扩展 (Chrome Extension)

1. Chrome极其内核浏览器打开 `chrome://extensions/`。
2. 开启右其角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目的 `chrome-extension` 文件夹。

### 第三步：安装 SillyTavern 扩展

推荐直接使用 SillyTavern 内置的扩展管理器安装：
👉 **[SillyTavern-CompanionLink-Extension](https://github.com/gabby1111111111/SillyTavern-CompanionLink-Extension)**

或者手动安装：
1. 复制 `SillyTavern-CompanionLink` 文件夹到 SillyTavern 的扩展目录。
2. 手动复制 `SillyTavern-CompanionLink/server` 到 SillyTavern 的 `plugins/companion-link` 目录。
3. 在 `config.yaml` 中启用 `enableServerPlugins: true`。

---

## 🛠️ 配置

- **SillyTavern**: 在扩展面板中开启 Companion-Link。
- **Backend**: 修改 `backend/.env` 配置 API Key (如果 ST 开启了认证)。

---

## 📄 License

MIT
