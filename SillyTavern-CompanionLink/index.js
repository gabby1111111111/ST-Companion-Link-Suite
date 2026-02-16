/**
 * Companion-Link — SillyTavern UI Extension
 *
 * 小红书 ⟷ SillyTavern 实时联动
 *
 * 功能:
 * 1. 通过 generate_interceptor 在每次 AI 生成前注入最新联动上下文
 * 2. 定期从 Server Plugin 轮询最新数据
 * 3. 提供扩展设置面板（开关、状态、上下文预览、后端地址配置）
 * 4. 支持直接接收后端 POST（无 Server Plugin 时走 /api/extensions/companion-link/inject）
 *
 * 安装：通过 SillyTavern 的扩展管理器安装（提供 GitHub 仓库地址）
 * Server Plugin：需额外复制 server/ 目录到 SillyTavern/plugins/companion-link/
 */

(function () {
  'use strict';

  const MODULE_NAME = 'companion_link';
  const LOG_PREFIX = '🔗 [Companion-Link]';

  // ============================================================
  // 默认配置
  // ============================================================

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    inject_position: 'before_last', // 'before_last' | 'start' | 'end'
    max_context_age: 300,           // 秒 - 上下文过期时间
    poll_interval: 3000,            // 毫秒 - 轮询间隔
    show_notification: true,        // 收到新上下文时显示 toastr
    injection_style: 'formatted',   // 'formatted' | 'raw' | 'system_note'
    context_max_length: 800,        // 注入文本最大字符数
    backend_url: 'http://localhost:8765', // Python 后端地址（供 UI 直连用）
  });

  // ============================================================
  // 状态管理
  // ============================================================

  let latestContext = null;
  let lastContextId = null;
  let pollTimer = null;
  let isPluginAvailable = false;

  // ============================================================
  // 日志
  // ============================================================

  const log = {
    info: (...args) => console.log(LOG_PREFIX, ...args),
    warn: (...args) => console.warn(LOG_PREFIX, ...args),
    error: (...args) => console.error(LOG_PREFIX, ...args),
    debug: (...args) => console.debug(LOG_PREFIX, ...args),
  };

  // ============================================================
  // 设置管理
  // ============================================================

  function getSettings() {
    try {
      const { extensionSettings } = SillyTavern.getContext();
      if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
      }
      // 确保所有默认 key 存在（版本升级兼容）
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
          extensionSettings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
        }
      }
      return extensionSettings[MODULE_NAME];
    } catch (err) {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  function saveSettings() {
    try {
      const { saveSettingsDebounced } = SillyTavern.getContext();
      saveSettingsDebounced();
    } catch (err) {
      log.warn('设置保存失败:', err.message);
    }
  }

  // ============================================================
  // Server Plugin 通信
  // ============================================================

  /**
   * 检测 Server Plugin 是否可用
   */
  async function checkPluginAvailability() {
    try {
      const resp = await fetch('/api/plugins/companion-link/status', {
        method: 'GET',
        headers: getAuthHeaders(),
      });
      if (resp.ok) {
        isPluginAvailable = true;
        log.info('✅ Server Plugin 已连接');
        return true;
      }
    } catch (e) {
      // 忽略
    }
    isPluginAvailable = false;
    log.info('ℹ️ Server Plugin 未检测到（使用直连模式）');
    return false;
  }

  /**
   * 获取SillyTavern 请求的认证头
   * 这些头在 ST 内部请求时自动携带 CSRF token 等
   */
  function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      // ST 内部 fetch 通常自带凭证，这里保持简单
      const context = SillyTavern.getContext();
      if (context.getRequestHeaders) {
        return { ...headers, ...context.getRequestHeaders() };
      }
    } catch (e) {
      // 降级
    }
    return headers;
  }

  /**
   * 从 Server Plugin 拉取最新上下文
   */
  async function fetchLatestContext() {
    const settings = getSettings();
    if (!settings.enabled) return null;

    try {
      const maxAge = settings.max_context_age || 300;
      const resp = await fetch(
        `/api/plugins/companion-link/context?max_age=${maxAge}`,
        { method: 'GET', headers: getAuthHeaders() }
      );

      if (!resp.ok) return null;

      const data = await resp.json();

      if (data.available && data.context) {
        if (data.context.id !== lastContextId) {
          lastContextId = data.context.id;
          latestContext = data.context;

          log.info(
            `📦 新上下文:`,
            `${data.context.action} →`,
            `《${data.context.note?.title || '?'}》`,
            `(${data.age_seconds}s ago)`
          );

          // 显示通知
          if (settings.show_notification) {
            showNotification(data.context);
          }

          updateStatusUI(true, data.context);
        }
        return data.context;
      } else {
        if (latestContext !== null) {
          log.debug('上下文已过期');
          latestContext = null;
          updateStatusUI(false);
        }
        return null;
      }
    } catch (err) {
      // 静默失败
      return null;
    }
  }

  /**
   * 显示 toastr 通知
   */
  function showNotification(ctx) {
    try {
      const { toastr } = SillyTavern.getContext();
      if (toastr) {
        toastr.info(
          `${getActionLabel(ctx.action)} · 《${ctx.note?.title || '?'}》`,
          '🔗 Companion-Link',
          { timeOut: 3000, preventDuplicates: true }
        );
      }
    } catch (e) {
      // 非关键
    }
  }

  // ============================================================
  // Generate Interceptor
  // ============================================================

  /**
   * SillyTavern generate_interceptor 回调
   *
   * 在每次 AI 生成前被调用，将最新联动上下文注入 chat 数组。
   * 通过 manifest.json 的 generate_interceptor 字段注册。
   *
   * @param {Array} chat     聊天历史（可变数组）
   * @param {number} contextSize 上下文 token 大小
   * @param {Function} abort  中止生成的回调
   * @param {string} type     生成类型 ('quiet', 'regenerate', 'impersonate', 'swipe', etc.)
   */
  globalThis.companionLinkInterceptor = async function (chat, contextSize, abort, type) {
    // 静默生成（如标题生成、摘要等）不注入
    if (type === 'quiet') return;

    const settings = getSettings();
    if (!settings.enabled || !latestContext) return;

    const ctx = latestContext;

    // 检查上下文是否过期
    const ageMs = Date.now() - new Date(ctx.received_at || ctx.timestamp).getTime();
    if (ageMs > (settings.max_context_age * 1000)) {
      log.debug('上下文已过期，跳过注入');
      return;
    }

    // 构建注入文本
    const injectionText = buildInjectionText(ctx, settings);
    if (!injectionText) return;

    // 创建 System Note 消息
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

    // 根据配置决定插入位置
    switch (settings.inject_position) {
      case 'start':
        chat.splice(0, 0, systemNote);
        break;
      case 'end':
        chat.push(systemNote);
        break;
      case 'before_last':
      default:
        if (chat.length > 0) {
          chat.splice(chat.length - 1, 0, systemNote);
        } else {
          chat.push(systemNote);
        }
        break;
    }

    log.info(
      `🎯 注入联动上下文:`,
      `action=${ctx.action},`,
      `《${ctx.note?.title || '?'}》,`,
      `position=${settings.inject_position},`,
      `chars=${injectionText.length}`
    );
  };

  // ============================================================
  // 注入文本构建
  // ============================================================

  /**
   * 构建注入到 AI 对话中的文本
   */
  function buildInjectionText(ctx, settings) {
    const maxLen = settings.context_max_length || 800;

    // 优先使用后端格式化好的文本
    if (settings.injection_style === 'formatted' && ctx.formatted_text) {
      return ctx.formatted_text.substring(0, maxLen);
    }

    // 自行构建
    const note = ctx.note || {};
    const parts = [];

    parts.push(`[Companion-Link 实时联动]`);
    parts.push(`用户在小红书上${getActionLabel(ctx.action)}了一篇笔记：`);

    if (note.title) parts.push(`📌 标题：${note.title}`);

    if (note.content) {
      const contentMax = Math.min(maxLen - 200, 400);
      const summary = note.content.length > contentMax
        ? note.content.substring(0, contentMax) + '...'
        : note.content;
      parts.push(`📝 内容：${summary}`);
    }

    if (note.author?.nickname) {
      parts.push(`👤 作者：${note.author.nickname}`);
    }

    // 互动数据
    const interact = note.interaction;
    if (interact) {
      const stats = [];
      if (interact.like_count) stats.push(`❤️ ${interact.like_count}`);
      if (interact.collect_count) stats.push(`⭐ ${interact.collect_count}`);
      if (interact.comment_count) stats.push(`💬 ${interact.comment_count}`);
      if (stats.length > 0) parts.push(`互动：${stats.join(' · ')}`);
    }

    // 热评
    if (note.top_comments?.length > 0) {
      parts.push('🔥 热评：');
      for (const c of note.top_comments.slice(0, 3)) {
        parts.push(`  「${c.content}」— ${c.user_nickname}`);
      }
    }

    // 标签
    if (note.tags?.length > 0) {
      parts.push(`🏷️ ${note.tags.map(t => `#${t}`).join(' ')}`);
    }

    // 用户评论
    if (ctx.user_comment) {
      parts.push(`💭 用户自己发表的评论：「${ctx.user_comment}」`);
    }

    const text = parts.join('\n');
    return text.substring(0, maxLen);
  }

  /**
   * 行为标签
   */
  function getActionLabel(action) {
    return {
      like: '点赞',
      comment: '评论',
      read: '深度阅读',
      collect: '收藏',
      share: '分享',
    }[action] || action;
  }

  // ============================================================
  // UI 设置面板
  // ============================================================

  function renderSettingsUI() {
    const settings = getSettings();

    const html = `
      <div id="cl-extension-settings" class="cl-extension-settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>🔗 Companion-Link</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">

            <!-- 主开关 -->
            <div class="cl-row">
              <label for="cl_ext_enabled">启用联动注入</label>
              <input type="checkbox" id="cl_ext_enabled" ${settings.enabled ? 'checked' : ''}>
            </div>

            <!-- 连接状态 -->
            <div class="cl-row">
              <label>插件状态</label>
              <span id="cl_ext_status" class="cl-status-badge cl-status-checking">检查中...</span>
            </div>

            <!-- 注入位置 -->
            <div class="cl-row">
              <label for="cl_ext_position">注入位置</label>
              <select id="cl_ext_position">
                <option value="before_last" ${settings.inject_position === 'before_last' ? 'selected' : ''}>最后一条消息前</option>
                <option value="start" ${settings.inject_position === 'start' ? 'selected' : ''}>对话开头</option>
                <option value="end" ${settings.inject_position === 'end' ? 'selected' : ''}>对话末尾</option>
              </select>
            </div>

            <!-- 注入风格 -->
            <div class="cl-row">
              <label for="cl_ext_style">注入风格</label>
              <select id="cl_ext_style">
                <option value="formatted" ${settings.injection_style === 'formatted' ? 'selected' : ''}>后端格式化文本</option>
                <option value="raw" ${settings.injection_style === 'raw' ? 'selected' : ''}>原始数据</option>
              </select>
            </div>

            <!-- 过期时间 -->
            <div class="cl-row">
              <label for="cl_ext_max_age">上下文过期 (秒)</label>
              <input type="number" id="cl_ext_max_age" value="${settings.max_context_age}" min="30" max="3600" step="30" class="text_pole" style="width:80px">
            </div>

            <!-- 最大长度 -->
            <div class="cl-row">
              <label for="cl_ext_max_len">最大注入字符</label>
              <input type="number" id="cl_ext_max_len" value="${settings.context_max_length}" min="100" max="2000" step="100" class="text_pole" style="width:80px">
            </div>

            <!-- 通知 -->
            <div class="cl-row">
              <label for="cl_ext_notify">新数据通知</label>
              <input type="checkbox" id="cl_ext_notify" ${settings.show_notification ? 'checked' : ''}>
            </div>

            <!-- 分隔线 -->
            <hr class="sysHR">

            <!-- 最新上下文预览 -->
            <div class="cl-row" style="flex-direction:column;align-items:stretch;">
              <label style="margin-bottom:4px;">📋 最新上下文</label>
              <div id="cl_ext_preview" class="cl-preview">暂无联动数据</div>
            </div>

            <!-- 操作按钮 -->
            <div class="cl-row" style="gap:6px;">
              <button id="cl_ext_refresh" class="menu_button menu_button_icon" title="刷新">
                <i class="fa-solid fa-rotate"></i> 刷新
              </button>
              <button id="cl_ext_clear" class="menu_button menu_button_icon" title="清除">
                <i class="fa-solid fa-trash"></i> 清除
              </button>
              <button id="cl_ext_history" class="menu_button menu_button_icon" title="历史">
                <i class="fa-solid fa-clock-rotate-left"></i> 历史
              </button>
            </div>

          </div>
        </div>
      </div>
    `;

    const container = document.getElementById('extensions_settings');
    if (container) {
      container.insertAdjacentHTML('beforeend', html);
      bindSettingsEvents();
      log.info('🎨 设置面板已渲染');
    } else {
      log.warn('extensions_settings 容器未找到');
    }
  }

  function bindSettingsEvents() {
    const settings = getSettings();

    // 主开关
    const enabled = document.getElementById('cl_ext_enabled');
    if (enabled) {
      enabled.addEventListener('change', (e) => {
        settings.enabled = e.target.checked;
        saveSettings();
        log.info(`开关: ${settings.enabled ? '开启' : '关闭'}`);
      });
    }

    // 注入位置
    const position = document.getElementById('cl_ext_position');
    if (position) {
      position.addEventListener('change', (e) => {
        settings.inject_position = e.target.value;
        saveSettings();
      });
    }

    // 注入风格
    const style = document.getElementById('cl_ext_style');
    if (style) {
      style.addEventListener('change', (e) => {
        settings.injection_style = e.target.value;
        saveSettings();
      });
    }

    // 过期时间
    const maxAge = document.getElementById('cl_ext_max_age');
    if (maxAge) {
      maxAge.addEventListener('change', (e) => {
        settings.max_context_age = parseInt(e.target.value) || 300;
        saveSettings();
      });
    }

    // 最大长度
    const maxLen = document.getElementById('cl_ext_max_len');
    if (maxLen) {
      maxLen.addEventListener('change', (e) => {
        settings.context_max_length = parseInt(e.target.value) || 800;
        saveSettings();
      });
    }

    // 通知开关
    const notify = document.getElementById('cl_ext_notify');
    if (notify) {
      notify.addEventListener('change', (e) => {
        settings.show_notification = e.target.checked;
        saveSettings();
      });
    }

    // 刷新按钮
    const refreshBtn = document.getElementById('cl_ext_refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        await fetchLatestContext();
        refreshBtn.disabled = false;
      });
    }

    // 清除按钮
    const clearBtn = document.getElementById('cl_ext_clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          if (isPluginAvailable) {
            await fetch('/api/plugins/companion-link/clear', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ clear_history: false }),
            });
          }
          latestContext = null;
          lastContextId = null;
          updateStatusUI(false);
          log.info('🗑️ 上下文已清除');
        } catch (err) {
          log.error('清除失败:', err);
        }
      });
    }

    // 历史按钮
    const historyBtn = document.getElementById('cl_ext_history');
    if (historyBtn) {
      historyBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch('/api/plugins/companion-link/history?limit=10', {
            headers: getAuthHeaders(),
          });
          if (resp.ok) {
            const data = await resp.json();
            showHistoryPopup(data.items);
          }
        } catch (err) {
          log.warn('获取历史失败:', err.message);
        }
      });
    }
  }

  /**
   * 在弹窗中显示历史记录
   */
  function showHistoryPopup(items) {
    if (!items || items.length === 0) {
      try {
        SillyTavern.getContext().toastr.info('暂无历史记录', 'Companion-Link');
      } catch (e) { /* */ }
      return;
    }

    const rows = items.map((item, i) => {
      const time = new Date(item.received_at).toLocaleTimeString();
      const action = getActionLabel(item.action);
      const title = item.note?.title || '无标题';
      return `<tr>
        <td style="padding:4px;color:#888">${i + 1}</td>
        <td style="padding:4px">${action}</td>
        <td style="padding:4px">《${title}》</td>
        <td style="padding:4px;color:#888">${time}</td>
      </tr>`;
    }).join('');

    const html = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid #555">
          <th style="padding:4px;text-align:left">#</th>
          <th style="padding:4px;text-align:left">行为</th>
          <th style="padding:4px;text-align:left">标题</th>
          <th style="padding:4px;text-align:left">时间</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    try {
      const context = SillyTavern.getContext();
      context.callPopup(html, 'text', '', {
        large: false,
        wide: true,
        okButton: '关闭',
      });
    } catch (e) {
      log.warn('弹窗不可用', e);
    }
  }

  // ============================================================
  // 状态 UI 更新
  // ============================================================

  function updateStatusUI(hasData, ctx) {
    const badge = document.getElementById('cl_ext_status');
    const preview = document.getElementById('cl_ext_preview');

    if (badge) {
      if (!isPluginAvailable) {
        badge.className = 'cl-status-badge cl-status-warn';
        badge.textContent = '⚠️ Server Plugin 未连接';
      } else if (hasData) {
        badge.className = 'cl-status-badge cl-status-ok';
        badge.textContent = '🟢 已就绪';
      } else {
        badge.className = 'cl-status-badge cl-status-idle';
        badge.textContent = '⚪ 等待数据';
      }
    }

    if (preview) {
      if (hasData && ctx) {
        const time = new Date(ctx.received_at || ctx.timestamp).toLocaleTimeString();
        const author = ctx.note?.author?.nickname;

        preview.innerHTML = [
          `<strong>${getActionLabel(ctx.action)}</strong>`,
          `《${escapeHtml(ctx.note?.title || '?')}》`,
          author ? `<br><small style="opacity:0.6">👤 ${escapeHtml(author)} · ⏰ ${time}</small>` : '',
          ctx.note?.interaction?.like_count
            ? `<br><small style="opacity:0.6">❤️ ${ctx.note.interaction.like_count} · ⭐ ${ctx.note.interaction.collect_count || 0}</small>`
            : '',
        ].filter(Boolean).join(' ');
      } else {
        preview.textContent = '暂无联动数据';
      }
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ============================================================
  // 轮询
  // ============================================================

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);

    const settings = getSettings();
    const interval = settings.poll_interval || 3000;

    // 立即拉取一次
    fetchLatestContext();

    // 定期轮询
    pollTimer = setInterval(() => {
      if (getSettings().enabled && isPluginAvailable) {
        fetchLatestContext();
      }
    }, interval);

    log.info(`🔄 轮询启动 (间隔 ${interval / 1000}s)`);
  }

  // ============================================================
  // 初始化入口
  // ============================================================

  async function init() {
    log.info('🚀 Companion-Link 初始化...');

    // 渲染设置面板
    renderSettingsUI();

    // 检测 Server Plugin
    await checkPluginAvailability();
    updateStatusUI(false);

    // 启动轮询
    if (isPluginAvailable) {
      startPolling();
    } else {
      // Server Plugin 不可用时，每 10 秒重试检测
      const retryTimer = setInterval(async () => {
        const available = await checkPluginAvailability();
        if (available) {
          clearInterval(retryTimer);
          updateStatusUI(false);
          startPolling();
        }
      }, 10000);
    }

    // 监听事件
    try {
      const { eventSource, event_types } = SillyTavern.getContext();

      // 聊天切换时刷新
      eventSource.on(event_types.CHAT_CHANGED, () => {
        log.debug('聊天切换');
        if (isPluginAvailable) fetchLatestContext();
      });
    } catch (err) {
      log.warn('事件监听绑定失败:', err.message);
    }

    log.info('✅ Companion-Link 已就绪');
  }

  // 等待 jQuery 就绪后初始化
  if (typeof jQuery !== 'undefined') {
    jQuery(init);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
