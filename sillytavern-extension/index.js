/**
 * Companion-Link UI Extension for SillyTavern
 *
 * 功能:
 * 1. 定期从 Server Plugin 拉取最新联动上下文
 * 2. 通过 generate_interceptor 在每次生成前将笔记数据注入聊天
 * 3. 提供设置 UI 面板（开关、历史查看）
 */

(function () {
  const MODULE_NAME = 'companion-link';
  const LOG_PREFIX = '[CL:ST]';
  const POLL_INTERVAL_MS = 3000; // 3 秒轮询一次

  // ============================================================
  // 状态
  // ============================================================

  let latestContext = null;
  let isEnabled = true;
  let pollTimer = null;
  let lastContextId = null;

  // ============================================================
  // 日志
  // ============================================================

  const log = {
    info: (...args) => console.log(LOG_PREFIX, ...args),
    warn: (...args) => console.warn(LOG_PREFIX, ...args),
    error: (...args) => console.error(LOG_PREFIX, ...args),
  };

  // ============================================================
  // Server Plugin 通信
  // ============================================================

  /**
   * 从 Server Plugin 获取最新上下文
   */
  async function fetchLatestContext() {
    try {
      const response = await fetch('/api/plugins/companion-link/context?max_age=300', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        log.warn(`上下文获取失败: HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.available && data.context) {
        // 只在有新数据时更新
        if (data.context.id !== lastContextId) {
          lastContextId = data.context.id;
          latestContext = data.context;
          log.info(
            `📦 新上下文: ${data.context.action} →`,
            `《${data.context.note?.title || '?'}》`,
            `(${data.age_seconds}s ago)`
          );
          updateStatusUI(true, data.context);
        }
      } else {
        if (latestContext !== null) {
          log.info('📭 上下文已过期或无数据');
          latestContext = null;
          updateStatusUI(false);
        }
      }

      return data;
    } catch (err) {
      // Server Plugin 可能未安装/加载
      log.warn('无法连接 Server Plugin:', err.message);
      updateStatusUI(false);
      return null;
    }
  }

  // ============================================================
  // Generate Interceptor
  // ============================================================

  /**
   * SillyTavern generate_interceptor 回调
   * 在每次 AI 生成前被调用，将最新联动上下文注入 chat
   *
   * @param {Array} chat 聊天历史数组（可修改）
   * @param {number} contextSize 上下文 token 大小
   * @param {Function} abort 中止生成的回调
   * @param {string} type 生成类型 ('normal', 'quiet', 'regenerate', etc.)
   */
  globalThis.companionLinkInterceptor = async function (chat, contextSize, abort, type) {
    // 静默生成（如标题生成等）不注入
    if (type === 'quiet') return;

    // 未启用或无上下文时跳过
    if (!isEnabled || !latestContext) return;

    const ctx = latestContext;

    // 构建注入文本
    const injectionText = buildInjectionText(ctx);
    if (!injectionText) return;

    // 创建一个 System Note 消息，插入到最后一条用户消息之前
    const systemNote = {
      is_user: false,
      is_system: true,
      name: 'Companion-Link',
      send_date: Date.now(),
      mes: injectionText,
      extra: {
        type: 'narrator',
        companion_link: true,
        cl_action: ctx.action,
        cl_context_id: ctx.id,
      },
    };

    // 在 chat 末尾前插入（即在最后一条用户消息前）
    if (chat.length > 0) {
      chat.splice(chat.length - 1, 0, systemNote);
    } else {
      chat.push(systemNote);
    }

    log.info(
      `🎯 已注入联动上下文 → action=${ctx.action},`,
      `title=《${ctx.note?.title || '?'}》,`,
      `chars=${injectionText.length}`
    );
  };

  /**
   * 构建注入到 AI 对话中的文本
   * @param {object} ctx 联动上下文
   * @returns {string}
   */
  function buildInjectionText(ctx) {
    // 如果后端已格式化好，直接使用
    if (ctx.formatted_text) {
      return ctx.formatted_text;
    }

    // 否则从 note 数据自行构建
    const note = ctx.note || {};
    const parts = [];

    parts.push(`[Companion-Link 实时联动]`);
    parts.push(`用户在小红书上${getActionLabel(ctx.action)}了一篇笔记：`);

    if (note.title) parts.push(`标题：${note.title}`);
    if (note.content) {
      const summary = note.content.length > 200
        ? note.content.substring(0, 200) + '...'
        : note.content;
      parts.push(`内容：${summary}`);
    }

    if (note.author?.nickname) {
      parts.push(`作者：${note.author.nickname}`);
    }

    // 互动数据
    const interact = note.interaction;
    if (interact) {
      const stats = [];
      if (interact.like_count) stats.push(`${interact.like_count} 赞`);
      if (interact.collect_count) stats.push(`${interact.collect_count} 收藏`);
      if (interact.comment_count) stats.push(`${interact.comment_count} 评论`);
      if (stats.length > 0) parts.push(`互动：${stats.join(' · ')}`);
    }

    // 热评
    if (note.top_comments?.length > 0) {
      parts.push('热门评论：');
      for (const c of note.top_comments.slice(0, 3)) {
        parts.push(`  - ${c.user_nickname}：${c.content}`);
      }
    }

    // 标签
    if (note.tags?.length > 0) {
      parts.push(`标签：${note.tags.map(t => `#${t}`).join(' ')}`);
    }

    // 用户评论
    if (ctx.user_comment) {
      parts.push(`用户自己的评论：「${ctx.user_comment}」`);
    }

    return parts.join('\n');
  }

  /**
   * 获取行为的中文描述
   */
  function getActionLabel(action) {
    const labels = {
      like: '点赞',
      comment: '评论',
      read: '阅读',
      collect: '收藏',
      share: '分享',
    };
    return labels[action] || action;
  }

  // ============================================================
  // UI 面板
  // ============================================================

  function renderSettingsUI() {
    const settingsHtml = `
      <div id="cl-settings" class="cl-settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>🔗 Companion-Link</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <!-- 开关 -->
            <div class="cl-setting-row">
              <label for="cl_enabled">启用联动注入</label>
              <input type="checkbox" id="cl_enabled" ${isEnabled ? 'checked' : ''}>
            </div>

            <!-- 状态 -->
            <div class="cl-setting-row">
              <label>连接状态</label>
              <span id="cl_status_badge" class="cl-badge cl-badge-unknown">检查中</span>
            </div>

            <!-- 最新上下文 -->
            <div class="cl-setting-row" style="flex-direction:column; align-items:stretch;">
              <label>最新上下文</label>
              <div id="cl_latest_context" class="cl-context-preview">无数据</div>
            </div>

            <!-- 操作按钮 -->
            <div class="cl-setting-row">
              <button id="cl_refresh_btn" class="menu_button">🔄 刷新</button>
              <button id="cl_clear_btn" class="menu_button">🗑️ 清除</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 注入到 SillyTavern 的扩展设置区域
    const container = document.getElementById('extensions_settings');
    if (container) {
      container.insertAdjacentHTML('beforeend', settingsHtml);
      bindUIEvents();
    }
  }

  function bindUIEvents() {
    const enabledCheckbox = document.getElementById('cl_enabled');
    if (enabledCheckbox) {
      enabledCheckbox.addEventListener('change', (e) => {
        isEnabled = e.target.checked;
        saveSettings();
        log.info(`开关已${isEnabled ? '开启' : '关闭'}`);
      });
    }

    const refreshBtn = document.getElementById('cl_refresh_btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => fetchLatestContext());
    }

    const clearBtn = document.getElementById('cl_clear_btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/plugins/companion-link/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear_history: false }),
          });
          latestContext = null;
          lastContextId = null;
          updateStatusUI(false);
          log.info('🗑️ 上下文已清除');
        } catch (err) {
          log.error('清除失败:', err);
        }
      });
    }
  }

  /**
   * 更新状态 UI
   */
  function updateStatusUI(connected, ctx) {
    const badge = document.getElementById('cl_status_badge');
    const preview = document.getElementById('cl_latest_context');

    if (badge) {
      badge.className = `cl-badge ${connected ? 'cl-badge-active' : 'cl-badge-inactive'}`;
      badge.textContent = connected ? '🟢 有数据' : '⚪ 无数据';
    }

    if (preview) {
      if (connected && ctx) {
        preview.innerHTML = `
          <strong>${getActionLabel(ctx.action)}</strong>
          《${ctx.note?.title || '?'}》<br>
          <small style="color:#888">${ctx.note?.author?.nickname || ''} · ${new Date(ctx.received_at).toLocaleTimeString()}</small>
        `;
      } else {
        preview.textContent = '无数据';
      }
    }
  }

  // ============================================================
  // 设置持久化
  // ============================================================

  function loadSettings() {
    try {
      const context = SillyTavern.getContext();
      const settings = context.extensionSettings[MODULE_NAME];
      if (settings) {
        isEnabled = settings.enabled !== false;
      }
    } catch (err) {
      // SillyTavern context 不可用时使用默认值
    }
  }

  function saveSettings() {
    try {
      const context = SillyTavern.getContext();
      if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = {};
      }
      context.extensionSettings[MODULE_NAME].enabled = isEnabled;
      context.saveSettingsDebounced();
    } catch (err) {
      log.warn('设置保存失败:', err);
    }
  }

  // ============================================================
  // 轮询启动
  // ============================================================

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);

    // 立即拉取一次
    fetchLatestContext();

    // 定期轮询
    pollTimer = setInterval(() => {
      if (isEnabled) {
        fetchLatestContext();
      }
    }, POLL_INTERVAL_MS);

    log.info(`🔄 轮询已启动 (每 ${POLL_INTERVAL_MS / 1000}s)`);
  }

  // ============================================================
  // 初始化
  // ============================================================

  function init() {
    log.info('🚀 Companion-Link UI Extension 初始化...');

    loadSettings();
    renderSettingsUI();
    startPolling();

    // 监听聊天切换
    try {
      const { eventSource, event_types } = SillyTavern.getContext();
      eventSource.on(event_types.CHAT_CHANGED, () => {
        log.info('💬 聊天已切换，刷新上下文');
        fetchLatestContext();
      });
    } catch (err) {
      // 非关键功能，忽略
    }

    log.info('✅ Companion-Link UI Extension 已就绪');
  }

  // 等待 jQuery 就绪后初始化
  if (typeof jQuery !== 'undefined') {
    jQuery(init);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
