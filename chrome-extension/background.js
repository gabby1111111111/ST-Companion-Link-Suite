/**
 * Companion-Link Background Service Worker
 *
 * 职责：
 * 1. 接收 content-script.js 发来的行为信号
 * 2. 从 chrome.storage.local 读取后端 API 地址
 * 3. 通过 fetch POST 将信号转发至 Python 后端
 * 4. 提供健康检查能力供 Popup 查询连接状态
 */

const LOG_PREFIX = "[CL:BG]";

/** 默认后端地址 */
const DEFAULT_BACKEND_URL = "http://localhost:8765";

// ============================================================
// 日志工具
// ============================================================

const log = {
  info: (...args) => console.log(LOG_PREFIX, ...args),
  warn: (...args) => console.warn(LOG_PREFIX, ...args),
  error: (...args) => console.error(LOG_PREFIX, ...args),
};

// ============================================================
// 后端通信
// ============================================================

/**
 * 获取后端 API 基础地址
 * @returns {Promise<string>}
 */
async function getBackendUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["cl_backendUrl"], (result) => {
      resolve(result.cl_backendUrl || DEFAULT_BACKEND_URL);
    });
  });
}

/**
 * 将信号发送到后端 /api/signal
 * @param {object} payload - 来自 content-script 的信号数据
 * @returns {Promise<object>} 后端响应
 */
async function postSignalToBackend(payload) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl.replace(/\/$/, "")}/api/signal`;

  log.info(`📡 正在发送信号到 ${url}`, {
    action: payload.action,
    note_id: payload.note_id,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "无法读取响应体");
      log.error(`❌ 后端返回错误 [${response.status}]:`, errorText);
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
      };
    }

    const data = await response.json();
    log.info("✅ 后端响应成功:", data.message || "OK");
    return { success: true, data };

  } catch (err) {
    // 区分不同类型的错误，给出友好提示
    if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
      log.error(
        `❌ 无法连接后端 (${url})`,
        "\n   💡 请确认：",
        "\n   1. Python 后端是否已启动？ → cd backend && python main.py",
        "\n   2. 后端监听地址是否正确？ → 当前配置: " + url,
        "\n   3. 防火墙是否阻止了连接？"
      );
      return {
        success: false,
        error: "后端未启动或无法连接，请检查 Python 后端是否在运行",
      };
    }

    log.error("❌ 请求异常:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 健康检查：测试后端连接
 * @returns {Promise<object>}
 */
async function checkBackendHealth() {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl.replace(/\/$/, "")}/api/health`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      return { connected: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      connected: true,
      status: data.status,
      version: data.version,
      webhookCount: data.webhook_count,
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message.includes("Failed to fetch")
        ? "后端未启动"
        : err.message,
    };
  }
}

// ============================================================
// 消息监听
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- 来自 Content Script 的信号 ---
  if (message.type === "COMPANION_LINK_SIGNAL") {
    const { payload } = message;

    log.info(`📨 收到信号: action=${payload.action}, note=${payload.note_id}`,
      sender.tab ? `(tab: ${sender.tab.id})` : "");

    // 异步发送到后端
    postSignalToBackend(payload)
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        log.error("处理信号失败:", err);
        sendResponse({ success: false, error: err.message });
      });

    // 返回 true 表示将异步发送响应
    return true;
  }

  // --- 来自 Popup 的健康检查请求 ---
  if (message.type === "COMPANION_LINK_HEALTH_CHECK") {
    checkBackendHealth()
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        sendResponse({ connected: false, error: err.message });
      });

    return true;
  }

  // --- 来自 Popup 的配置更新通知 ---
  if (message.type === "COMPANION_LINK_CONFIG_UPDATED") {
    log.info("⚙️ 配置已更新:", message.changes);
    sendResponse({ success: true });
    return false;
  }
});

// ============================================================
// Service Worker 生命周期
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    log.info("🎉 Companion-Link 扩展已安装！");

    // 设置默认配置
    chrome.storage.local.set({
      cl_enabled: true,
      cl_backendUrl: DEFAULT_BACKEND_URL,
      cl_debounceMs: 1500,
      cl_readThresholdSec: 5,
    });
  } else if (details.reason === "update") {
    log.info(`🔄 Companion-Link 已更新至 v${chrome.runtime.getManifest().version}`);
  }
});

// 启动日志
log.info("🚀 Companion-Link Background Service Worker 已启动");
