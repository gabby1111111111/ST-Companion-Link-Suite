/**
 * Companion-Link Popup 配置面板逻辑
 *
 * 功能：
 * 1. 从 chrome.storage.local 加载/保存配置
 * 2. 通过 background.js 执行健康检查
 * 3. 实时同步配置变更到 content-script
 */

// ============================================================
// DOM 元素引用
// ============================================================

const $ = (sel) => document.querySelector(sel);

const dom = {
  statusDot: $("#statusDot"),
  statusText: $("#statusText"),
  statusDetail: $("#statusDetail"),
  statusCard: $("#statusCard"),
  enableToggle: $("#enableToggle"),
  backendUrl: $("#backendUrl"),
  saveBtn: $("#saveBtn"),
  testBtn: $("#testBtn"),
  debounceMs: $("#debounceMs"),
  readThreshold: $("#readThreshold"),
  toast: $("#toast"),
  version: $("#version"),
};

// ============================================================
// 配置加载
// ============================================================

/**
 * 从 storage 加载配置到 UI
 */
function loadConfig() {
  chrome.storage.local.get(
    ["cl_enabled", "cl_backendUrl", "cl_debounceMs", "cl_readThresholdSec"],
    (result) => {
      dom.enableToggle.checked = result.cl_enabled !== false;
      dom.backendUrl.value = result.cl_backendUrl || "http://localhost:8765";
      dom.debounceMs.value = result.cl_debounceMs || 1500;
      dom.readThreshold.value = result.cl_readThresholdSec || 5;
    }
  );
}

// ============================================================
// 配置保存
// ============================================================

/**
 * 保存当前 UI 配置到 storage
 */
function saveConfig() {
  const config = {
    cl_backendUrl: dom.backendUrl.value.trim().replace(/\/$/, ""),
    cl_debounceMs: parseInt(dom.debounceMs.value, 10) || 1500,
    cl_readThresholdSec: parseInt(dom.readThreshold.value, 10) || 5,
  };

  if (!config.cl_backendUrl) {
    showToast("❌ 后端地址不能为空", "error");
    return;
  }

  chrome.storage.local.set(config, () => {
    showToast("✅ 配置已保存", "success");

    // 通知 background.js
    chrome.runtime.sendMessage({
      type: "COMPANION_LINK_CONFIG_UPDATED",
      changes: config,
    });
  });
}

/**
 * 切换启用/禁用
 */
function toggleEnabled() {
  const enabled = dom.enableToggle.checked;
  chrome.storage.local.set({ cl_enabled: enabled }, () => {
    showToast(enabled ? "✅ 已启用监听" : "⏸️ 已暂停监听", enabled ? "success" : "warn");
  });
}

// ============================================================
// 连接状态检查
// ============================================================

/**
 * 执行后端健康检查并更新 UI
 */
function checkConnection() {
  setStatus("checking", "检查中...", "");

  chrome.runtime.sendMessage(
    { type: "COMPANION_LINK_HEALTH_CHECK" },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus("error", "扩展错误", chrome.runtime.lastError.message);
        return;
      }

      if (response?.connected) {
        setStatus(
          "connected",
          "已连接",
          `v${response.version || "?"} · ${response.webhookCount ?? 0} 个 Webhook`
        );
      } else {
        setStatus(
          "disconnected",
          "未连接",
          response?.error || "后端未启动"
        );
      }
    }
  );
}

/**
 * 更新状态 UI
 * @param {"connected"|"disconnected"|"checking"|"error"} state
 * @param {string} text
 * @param {string} detail
 */
function setStatus(state, text, detail) {
  dom.statusDot.className = `status-dot ${state}`;
  dom.statusText.textContent = text;
  dom.statusDetail.textContent = detail;
  dom.statusCard.className = `status-card ${state}`;
}

// ============================================================
// Toast 提示
// ============================================================

let _toastTimer = null;

/**
 * 显示提示条
 * @param {string} message
 * @param {"success"|"error"|"warn"} type
 */
function showToast(message, type = "success") {
  dom.toast.textContent = message;
  dom.toast.className = `toast show ${type}`;

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    dom.toast.className = "toast";
  }, 2000);
}

// ============================================================
// 事件绑定
// ============================================================

function setupListeners() {
  // 保存按钮
  dom.saveBtn.addEventListener("click", saveConfig);

  // Enter 键保存
  dom.backendUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveConfig();
  });

  // 启用开关
  dom.enableToggle.addEventListener("change", toggleEnabled);

  // 测试连接
  dom.testBtn.addEventListener("click", () => {
    // 先保存（确保用最新 URL 测试）
    const url = dom.backendUrl.value.trim().replace(/\/$/, "");
    if (url) {
      chrome.storage.local.set({ cl_backendUrl: url }, () => {
        checkConnection();
      });
    } else {
      checkConnection();
    }
  });

  // 高级设置自动保存（失去焦点时）
  dom.debounceMs.addEventListener("change", saveConfig);
  dom.readThreshold.addEventListener("change", saveConfig);
}

// ============================================================
// 初始化
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  // 显示版本号
  const manifest = chrome.runtime.getManifest();
  dom.version.textContent = `v${manifest.version}`;

  loadConfig();
  setupListeners();

  // 自动检查连接状态
  checkConnection();
});
