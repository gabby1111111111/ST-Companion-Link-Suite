/**
 * Companion-Link SillyTavern Server Plugin
 *
 * 职责:
 * 1. 接收来自 Python 后端的 POST 请求 (笔记数据 + 格式化文本)
 * 2. 将最新的联动上下文存储在内存中
 * 3. 提供 GET 接口供 UI Extension 获取最新上下文
 * 4. 提供状态查询接口（健康检查）
 *
 * 路由:
 *   POST /api/plugins/companion-link/inject  ← Python 后端推送
 *   GET  /api/plugins/companion-link/context  ← UI Extension 拉取
 *   GET  /api/plugins/companion-link/status   ← 健康检查
 *   POST /api/plugins/companion-link/clear    ← 清除上下文
 */

const MODULE_NAME = 'companion-link';

/**
 * 内存中的联动上下文存储
 * 保留最近 N 条记录，按时间倒序
 */
const MAX_HISTORY = 20;
let contextHistory = [];
let latestContext = null;

/**
 * Initialize plugin.
 * @param {import('express').Router} router Express router
 * @returns {Promise<void>}
 */
async function init(router) {
  console.log(`[${MODULE_NAME}] 🚀 Companion-Link Server Plugin 初始化中...`);

  // ============================================================
  // POST /inject — 接收 Python 后端推送的联动数据
  // ============================================================

  router.post('/inject', (req, res) => {
    try {
      const { action, formatted_text, note, user_comment, timestamp } = req.body;

      if (!action || !formatted_text) {
        return res.status(400).json({
          success: false,
          error: '缺少必要字段: action, formatted_text',
        });
      }

      const contextEntry = {
        id: `cl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        action,
        formatted_text,
        note: note || {},
        user_comment: user_comment || null,
        timestamp: timestamp || new Date().toISOString(),
        received_at: new Date().toISOString(),
      };

      // 更新最新上下文
      latestContext = contextEntry;

      // 追加到历史（保留最近 N 条）
      contextHistory.unshift(contextEntry);
      if (contextHistory.length > MAX_HISTORY) {
        contextHistory = contextHistory.slice(0, MAX_HISTORY);
      }

      console.log(
        `[${MODULE_NAME}] 📥 收到联动数据:`,
        `action=${action},`,
        `title=${note?.title || '?'},`,
        `text_length=${formatted_text?.length || 0}`
      );

      return res.json({
        success: true,
        message: `上下文已注入: ${action} → 《${note?.title || '无标题'}》`,
        id: contextEntry.id,
      });
    } catch (err) {
      console.error(`[${MODULE_NAME}] ❌ inject 处理异常:`, err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  // ============================================================
  // GET /context — UI Extension 拉取最新上下文
  // ============================================================

  router.get('/context', (req, res) => {
    const maxAge = parseInt(req.query.max_age) || 300; // 默认 5 分钟有效期

    if (!latestContext) {
      return res.json({ available: false, context: null });
    }

    // 检查是否过期
    const age = (Date.now() - new Date(latestContext.received_at).getTime()) / 1000;
    if (age > maxAge) {
      return res.json({
        available: false,
        context: null,
        reason: `上下文已过期 (${Math.round(age)}s > ${maxAge}s)`,
      });
    }

    return res.json({
      available: true,
      context: latestContext,
      age_seconds: Math.round(age),
    });
  });

  // ============================================================
  // GET /history — 获取最近的联动历史
  // ============================================================

  router.get('/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, MAX_HISTORY);
    return res.json({
      count: contextHistory.length,
      items: contextHistory.slice(0, limit),
    });
  });

  // ============================================================
  // POST /clear — 清除当前上下文
  // ============================================================

  router.post('/clear', (req, res) => {
    const cleared = latestContext !== null;
    latestContext = null;

    if (req.body?.clear_history) {
      contextHistory = [];
    }

    console.log(`[${MODULE_NAME}] 🗑️ 上下文已清除 (含历史: ${req.body?.clear_history || false})`);
    return res.json({ success: true, cleared });
  });

  // ============================================================
  // GET /status — 健康检查 + 状态信息
  // ============================================================

  router.get('/status', (req, res) => {
    return res.json({
      status: 'active',
      plugin: MODULE_NAME,
      version: info.version || '0.1.0',
      has_context: latestContext !== null,
      history_count: contextHistory.length,
      latest_action: latestContext?.action || null,
      latest_title: latestContext?.note?.title || null,
      latest_age: latestContext
        ? Math.round((Date.now() - new Date(latestContext.received_at).getTime()) / 1000)
        : null,
    });
  });

  console.log(`[${MODULE_NAME}] ✅ Server Plugin 已就绪`);
  console.log(`[${MODULE_NAME}]    路由: POST /inject, GET /context, GET /history, POST /clear, GET /status`);
  return Promise.resolve();
}

/**
 * Clean up on shutdown.
 * @returns {Promise<void>}
 */
async function exit() {
  console.log(`[${MODULE_NAME}] 👋 Server Plugin 已卸载`);
  latestContext = null;
  contextHistory = [];
  return Promise.resolve();
}

const info = {
  id: MODULE_NAME,
  name: 'Companion-Link',
  description: '小红书 ⟷ SillyTavern 实时联动 — 接收浏览行为数据并注入 AI 对话上下文',
  version: '0.1.0',
};

module.exports = {
  init,
  exit,
  info,
};
