/**
 * Companion-Link — SillyTavern Server Plugin
 *
 * 职责：接收 Python 后端的 POST 推送，存储上下文，供 UI Extension 拉取。
 *
 * 安装：复制此文件夹到 SillyTavern/plugins/companion-link/
 *       并在 config.yaml 中设置 enableServerPlugins: true
 *
 * 路由（自动挂载在 /api/plugins/companion-link/ 下）：
 *   POST /inject    ← Python 后端推送联动数据
 *   GET  /context   ← UI Extension 拉取最新上下文
 *   GET  /history   ← 获取最近记录
 *   POST /clear     ← 清除上下文
 *   GET  /status    ← 健康检查
 */

const MODULE_NAME = 'companion-link';
const MAX_HISTORY = 50;

let contextHistory = [];
let latestContext = null;
let latestSystemNote = null;  // 潜意识 System Note (read 积累)
let latestTelemetry = null;   // 系统遥测数据 (Process & Memory)
let pendingTrigger = false;   // 主动触发标志

/**
 * @param {import('express').Router} router
 * @returns {Promise<void>}
 */
async function init(router) {
  console.log(`[${MODULE_NAME}] 🚀 Server Plugin 初始化...`);

  // ----------------------------------------------------------
  // POST /inject — 接收推送
  // ----------------------------------------------------------
  router.post('/inject', (req, res) => {
    try {
      const { action, formatted_text, note, user_comment, timestamp, buffer_entries, buffer_summary } = req.body;

      if (!action) {
        return res.status(400).json({ success: false, error: 'Missing: action' });
      }

      const entry = {
        id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        action,
        formatted_text: formatted_text || '',
        note: note || {},
        user_comment: user_comment || null,
        timestamp: timestamp || new Date().toISOString(),
        received_at: new Date().toISOString(),
        // 缓冲区聚合数据 (title + tags)
        buffer_entries: buffer_entries || [],
        buffer_summary: buffer_summary || '',
        // 系统遥测 (Passive Injection)
        system_telemetry: req.body.system_telemetry || null,
      };

      latestContext = entry;
      contextHistory.unshift(entry);
      if (contextHistory.length > MAX_HISTORY) {
        contextHistory.length = MAX_HISTORY;
      }

      console.log(
        `[${MODULE_NAME}] 📥 action=${action}`,
        `title="${note?.title || '?'}"`,
        `text=${(formatted_text || '').length}chars`
      );

      return res.json({
        success: true,
        message: `OK: ${action} → 《${note?.title || '?'}》`,
        id: entry.id,
      });
    } catch (err) {
      console.error(`[${MODULE_NAME}] ❌ inject error:`, err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // POST /inject_system_note — 接收潜意识 System Note
  // ----------------------------------------------------------
  router.post('/inject_system_note', (req, res) => {
    try {
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ success: false, error: 'Missing: text' });
      }

      latestSystemNote = {
        text,
        updated_at: new Date().toISOString(),
      };

      console.log(
        `[${MODULE_NAME}] 🧠 System Note 更新:`,
        `${text.length} chars`,
        `"${text.slice(0, 60)}..."`
      );

      return res.json({
        success: true,
        message: 'System Note updated',
        length: text.length,
      });
    } catch (err) {
      console.error(`[${MODULE_NAME}] ❌ inject_system_note error:`, err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // GET /context — 拉取最新上下文
  // ----------------------------------------------------------
  router.get('/context', (req, res) => {
    const maxAge = parseInt(req.query.max_age) || 300;

    if (!latestContext) {
      return res.json({ available: false, context: null, should_trigger: false });
    }

    const ageSec = (Date.now() - new Date(latestContext.received_at).getTime()) / 1000;
    if (ageSec > maxAge) {
      return res.json({
        available: false,
        context: null,
        should_trigger: false,
        reason: `expired (${Math.round(ageSec)}s > ${maxAge}s)`,
      });
    }

    // 读取并重置主动触发标志
    const shouldTrigger = pendingTrigger;
    if (pendingTrigger) {
      pendingTrigger = false;
      console.log(`[${MODULE_NAME}] 🎤 should_trigger 已发送并重置`);
    }

    return res.json({
      available: true,
      context: latestContext,
      age_seconds: Math.round(ageSec),
      should_trigger: shouldTrigger,
      // 潜意识 System Note (read 积累)
      system_note: latestSystemNote ? latestSystemNote.text : null,
      // 系统遥测数据
      system_telemetry: latestTelemetry,
    });
  });

  // ----------------------------------------------------------
  // POST /telemetry — 接收系统遥测数据
  // ----------------------------------------------------------
  router.post('/telemetry', (req, res) => {
    try {
        const telemetry = req.body;
        if (!telemetry) {
            return res.status(400).json({ success: false, error: 'Missing body' });
        }
        
        latestTelemetry = {
            ...telemetry,
            updated_at: new Date().toISOString()
        };
        
        // Log sparingly? Or no log to avoid spam
        // console.log(`[${MODULE_NAME}] 📡 Telemetry updated`);
        
        return res.json({ success: true });
    } catch(err) {
        console.error(`[${MODULE_NAME}] ❌ telemetry error:`, err);
        return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // GET /history
  // ----------------------------------------------------------
  router.get('/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, MAX_HISTORY);
    return res.json({
      count: contextHistory.length,
      items: contextHistory.slice(0, limit),
    });
  });

  // ----------------------------------------------------------
  // POST /clear
  // ----------------------------------------------------------
  router.post('/clear', (req, res) => {
    const hadData = latestContext !== null;
    latestContext = null;
    if (req.body?.clear_history) contextHistory = [];
    return res.json({ success: true, cleared: hadData });
  });

  // ----------------------------------------------------------
  // GET /status
  // ----------------------------------------------------------
  router.get('/status', (req, res) => {
    return res.json({
      status: 'active',
      plugin: MODULE_NAME,
      version: info.version,
      has_context: latestContext !== null,
      history_count: contextHistory.length,
      latest_action: latestContext?.action || null,
      latest_title: latestContext?.note?.title || null,
      latest_age_sec: latestContext
        ? Math.round((Date.now() - new Date(latestContext.received_at).getTime()) / 1000)
        : null,
    });
  });

  // ----------------------------------------------------------
  // POST /trigger — 主动触发 AI 生成
  // ----------------------------------------------------------
  router.post('/trigger', (req, res) => {
    try {
      const { action } = req.body || {};
      pendingTrigger = true;

      console.log(
        `[${MODULE_NAME}] 🎤 收到主动触发请求`,
        action ? `(action=${action})` : '',
        latestContext ? `当前上下文: ${latestContext.action} → 《${latestContext.note?.title || '?'}》` : '(无上下文)'
      );

      return res.json({
        success: true,
        message: 'Trigger 已设置，UI Extension 下次轮询时将触发 AI 生成',
        has_context: latestContext !== null,
      });
    } catch (err) {
      console.error(`[${MODULE_NAME}] ❌ trigger error:`, err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log(`[${MODULE_NAME}] ✅ 路由已注册: inject, inject_system_note, context, history, clear, trigger, status`);
}

async function exit() {
  latestContext = null;
  latestSystemNote = null;
  contextHistory = [];
  pendingTrigger = false;
  console.log(`[${MODULE_NAME}] 👋 已卸载`);
}

const info = {
  id: MODULE_NAME,
  name: 'Companion-Link',
  description: '小红书 ⟷ SillyTavern 实时联动 — 接收外部浏览行为信号并注入 AI 对话',
  version: '0.1.0',
};

module.exports = { init, exit, info };
