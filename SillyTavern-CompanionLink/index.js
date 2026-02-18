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
    inject_position: 'end',         // 'before_last' | 'start' | 'end'
    max_context_age: 300,           // 秒 - 上下文过期时间
    poll_interval: 3000,            // 毫秒 - 轮询间隔
    show_notification: true,        // 收到新上下文时显示 toastr
    injection_style: 'formatted',   // 'formatted' | 'raw' | 'system_note'
    context_max_length: 1200,       // 注入文本最大字符数
    backend_url: 'http://localhost:8765', // Python 后端地址（供 UI 直连用）
  });

  // ============================================================
  // 状态管理
  // ============================================================

  let latestContext = null;
  let lastContextId = localStorage.getItem('companion_link_last_id') || null;
  let latestSystemNote = null;  // 潜意识 System Note (read 积累)
  let latestTelemetry = null;   // 系统遥测 (Process & Memory)
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

  // ============================================================
  // Semi-Automatic Session UI (Phase 16)
  // ============================================================
  function setupDraftButtonObserver() {
      // 监听聊天区域变化
      const chatQuery = '#chat'; // SillyTavern 聊天区域 ID
      const targetNode = document.querySelector(chatQuery);
      if (!targetNode) return;

      const observer = new MutationObserver((mutationsList) => {
          for(const mutation of mutationsList) {
              if (mutation.type === 'childList') {
                  mutation.addedNodes.forEach(node => {
                       if (node.nodeType === 1 && node.classList.contains('mes')) { 
                            // 检查最后一条消息
                            processDraftButton(node);
                       }
                  });
              }
          }
      });
      observer.observe(targetNode, { childList: true, subtree: true });
      
      // 初始检查最后一条
      const lastMsg = document.querySelector('.mes:last-child');
      if (lastMsg) processDraftButton(lastMsg);
  }

  function processDraftButton(msgNode) {
       if (msgNode.querySelector('.cl-draft-btn')) return; // 已添加

       const text = msgNode.innerText;
       const match = text.match(/\(拟稿:\s*(.*?)\)/);
       
       if (match && match[1]) {
           const draftContent = match[1];
           const btn = document.createElement('div');
           btn.className = 'cl-draft-btn';
           btn.innerHTML = '🔗 跨平台一键点评';
           btn.style.cssText = 'cursor: pointer; color: #ff69b4; font-weight: bold; margin-top: 5px; border: 1px solid #ff69b4; padding: 2px 8px; border-radius: 4px; display: inline-block;';
           
           btn.onclick = async () => {
               // 1. 复制文本
               try {
                   await navigator.clipboard.writeText(draftContent);
                   // 2. 打开当前 URL (从 window.latestContext 获取)
                   if (window.latestContext && window.latestContext.note && window.latestContext.note.url) {
                        window.open(window.latestContext.note.url, '_blank');
                   } else {
                        alert('评论已复制，但未找到当前视频 URL');
                   }
                   btn.innerText = '✅ 已复制并跳转';
               } catch(e) {
                   console.error('Copy failed', e);
                   alert('复制失败，请手动复制');
               }
           };
           
           // 添加到消息气泡内部
           const contentDiv = msgNode.querySelector('.mes_text');
           if (contentDiv) contentDiv.appendChild(btn);
       }
  }

  /**
   * 从 Server Plugin 拉取最新上下文
   */
  async function fetchLatestContext() {
    // 启动 Draft Observer (如果尚未启动)
    if (!window.draftObserverStarted) {
         setupDraftButtonObserver();
         window.draftObserverStarted = true;
    }

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
      if (data.system_telemetry) latestTelemetry = data.system_telemetry; // Update on valid context too

      if (data.available && data.context) {
        // DEBUG: Force Log
        console.log(`🔍 [Companion-Link] Poll Result: ID=${data.context.id}, LastID=${lastContextId}, Trigger=${data.should_trigger}`);

        const isNew = data.context.id !== lastContextId;
        if (isNew) {
          lastContextId = data.context.id;
          localStorage.setItem('companion_link_last_id', lastContextId);
          latestContext = data.context;
          window.latestContext = data.context; // Expose for UI Button

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

          try {
            updateStatusUI(true, data.context);
          } catch (e) {
            console.error('DEBUG: updateStatusUI FAIL:', e);
          }

        } else {
            // DEBUG
            console.log(`Duplicate Context Ignored (ID: ${data.context.id})`);
        }

        // ======== 主动触发 AI 生成 ========
        // Server Plugin 通过 should_trigger 标志通知前端需要触发 AI 发言
        if (isNew && data.should_trigger) {
          log.info(`🎤 主动触发 AI 生成 (action=${data.context.action})`);
          // 注入到聊天历史（模拟用户发送，自带触发生成）
          try {
            injectContextToChatHistory(data.context);
          } catch (e) {
             console.error('DEBUG: injectContextToChatHistory FAIL:', e);
          }
        }

        return data.context;
      } else {
        if (latestContext !== null) {
          log.debug('上下文已过期');
          latestContext = null;
          updateStatusUI(false);
        }
        // ======== 潜意识 System Note 更新 ========
        // 独立于 latestContext，始终更新
        if (data.system_note) {
          latestSystemNote = data.system_note;
          log.debug(`🧠 潜意识更新: ${data.system_note.slice(0, 50)}...`);
        }
        
        // ======== 系统遥测更新 ========
        if (data.system_telemetry) {
            latestTelemetry = data.system_telemetry;
        }
        
        return null;
      }
    } catch (err) {
      // 静默失败
      return null;
    }
  }

  /**
   * 触发 SillyTavern 的 AI 生成
   * 用于 like / comment 等高优先级动作的主动发言
   */
  function triggerAIGeneration() {
    try {
      const context = SillyTavern.getContext();

      // 方式: 模拟点击“发送”按钮 (最稳妥，自动处理状态)
      // 延迟 500ms 确保上下文已注入
       setTimeout(() => {
          log.info('🚀 模拟点击 #send_but 触发 AI 回复');
          const sendBtn = document.getElementById('send_but');
          if (sendBtn) sendBtn.click();
          else log.warn('⚠️ 未找到发送按钮 #send_but');
       }, 500);
       return;

      // 方式 2: 使用 generateQuietPrompt（备用）
      if (typeof context.generateQuietPrompt === 'function') {
        const ctx = latestContext;
        const prompt = ctx?.action === 'comment'
          ? `(用户刚在小红书评论了「${ctx.user_comment || ''}」，请对此做出即兴反应)`
          : `(用户刚在小红书上${getActionLabel(ctx?.action)}了一篇笔记，请做出即兴反应)`;
        setTimeout(() => {
          log.info('🚀 调用 generateQuietPrompt 触发 AI 回复');
          context.generateQuietPrompt(prompt, false, false);
        }, 500);
        return;
      }

      log.warn('⚠️ 未找到 Generate 或 generateQuietPrompt，无法主动触发');
    } catch (err) {
      log.error('主动触发失败:', err);
    }
  }

  /**
   * 将上下文填入输入框并模拟发送（可见且触发生成）
   */
  function injectContextToChatHistory(ctx) {
    try {
      const settings = getSettings();
      console.log('DEBUG: Building Injection Text...');
      const injectionText = buildInjectionText(ctx, settings);
      
      console.log('DEBUG: Injection Text Length:', injectionText ? injectionText.length : 0);

      if (!injectionText) {
          console.error('DEBUG: Injection Text is EMPTY/NULL');
          return;
      }

      // 1. 获取输入框
      const textarea = $('#send_textarea');
      if (textarea.length === 0) {
        log.error('找不到输入框 #send_textarea');
        console.error('DEBUG: #send_textarea not found');
        return;
      }

      // 2. 填充内容
      // 如果已有内容，则追加（避免覆盖用户正在输入的内容）
      const currentVal = textarea.val();
      if (currentVal) {
        textarea.val(currentVal + '\n\n' + injectionText);
      } else {
        textarea.val(injectionText);
      }

      // 3. 触发发送点击
      // 这会由 SillyTavern 处理消息构建、UI更新和AI生成请求
      const sendBtn = $('#send_but');
      if (sendBtn.length > 0) {
        console.log('DEBUG: Clicking Send Button...');
        sendBtn.click();
        
        // 标记已注入，避免拦截器重复注入
        ctx.injected_to_chat = true;
        log.info('✅ 模拟用户发送消息成功');
      } else {
        log.error('找不到发送按钮 #send_but');
        console.error('DEBUG: #send_but not found');
      }

    } catch (err) {
      log.error('注入聊天历史失败:', err);
      console.error('DEBUG: Injection Exception:', err);
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
    // 调试日志保留，弹窗移除
    // console.log('🔍 [Companion-Link] Full Chat Prompt:', JSON.parse(JSON.stringify(chat)));

    // 静默生成（如标题生成、摘要等）不注入
    if (type === 'quiet') return;

    const settings = getSettings();
    if (!settings.enabled) return;

    // ======== 1. 潜意识 System Note 注入 ========
    // 非破坏性插入，不影响其他插件
    if (latestSystemNote) {
      // 检查是否已有 companion_link 的 system note，避免重复注入
      const existingIdx = chat.findIndex(
        m => m.extra?.companion_link_system_note === true
      );
      
      const systemNoteMsg = {
        role: 'system',
        content: latestSystemNote,
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: latestSystemNote,
        extra: {
          type: 'narrator',
          companion_link_system_note: true,
        },
      };

      if (existingIdx >= 0) {
        // 替换旧的 system note（非破坏性原地更新）
        chat.splice(existingIdx, 1, systemNoteMsg);
        log.debug('🧠 潜意识已更新 (replaced)');
      } else {
        // 插入到靠前位置（但不是第一个，保留系统提示词）
        const insertPos = Math.min(1, chat.length);
        chat.splice(insertPos, 0, systemNoteMsg);
        log.debug('🧠 潜意识已注入 (new)');
      }
    }

    // ======== 2. 主动触发上下文注入 ========
    if (!latestContext) return;

    const ctx = latestContext;

    // 如果已经注入到历史（可见模式），则跳过拦截器注入
    if (ctx.injected_to_chat) {
        return;
    }

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
      is_user: true,    // 关键修改：伪装成用户本人发送的消息
      is_system: false,
      // name: 'System', // 移除，使用默认用户名
      // force_avatar: 'system', // 移除，使用默认用户头像
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
  // 注入文本构建 — 场景化高情商模板
  // ============================================================

  /**
   * 构建注入到 AI 对话中的文本
   *
   * 核心设计：
   * - 所有 action 共享一个亲密陪伴场景开头
   * - like / comment 使用主动型指令，引导 AI 即兴发言
   * - read 使用被动型指令，仅作为潜意识背景
   * - 每种 action 有独立的角色行为指引
   */

  /**
   * 构建注入到 AI 对话中的文本 (Narrative Scenario Style)
   */
  function buildInjectionText(ctx, settings) {
    const formattedText = ctx.formatted_text || '';
    if (!formattedText) return null;

    const action = ctx.action;
    const note = ctx.note || {};
    const platform = note.platform || 'xiaohongshu'; 
    const bufferEntries = ctx.buffer_entries || [];

    // ============================================================
    // 1. Vibe Check (环境 & 状态旁白)
    // ============================================================
    let vibeIntro = "";
    
    const hour = new Date().getHours();
    const isLateNight = hour >= 1 && hour <= 5;
    // const isMorning = hour >= 6 && hour <= 9;
    
    // 频率感知 (Binge Watching)
    const isBingeWatching = bufferEntries.length >= 4;

    if (platform === 'bilibili') {
        if (isLateNight) {
            vibeIntro = `（夜色已深，屋里只有屏幕的微光照在 {{user}} 脸上... 他似乎并无睡意，正在 B 站上刷着视频...）`;
        } else if (isBingeWatching) {
            vibeIntro = `（{{user}} 看起来非常投入，已经在屏幕前连续看了好一会儿 B 站了，似乎完全沉浸在了内容里...）`;
        } else {
             vibeIntro = `（此时，{{user}} 正在电脑前刷 B 站，他把耳机分了你一半，屏幕上正在播放：${note.title || '视频'}...）`;
        }
    } else {
        // 小红书 / 通用
        if (isLateNight) {
             vibeIntro = `（凌晨 ${hour} 点了，{{user}} 还在刷着手机，屏幕的光映在他略显疲惫但兴奋的脸上...）`;
        } else if (isBingeWatching) {
             vibeIntro = `（{{user}} 的手指在屏幕上快速滑动，看起来正在高强度地摄入信息，试图寻找某种共鸣...）`;
        } else {
            // Default Action Intro
            switch (action) {
                case 'like': vibeIntro = `（{{user}} 把手机屏幕侧过来给你看，上面是他刚刚点赞的一篇笔记...）`; break;
                case 'comment': vibeIntro = `（{{user}} 指着屏幕上一条评论说到：“${ctx.user_comment || ''}”，然后期待地看着你...）`; break;
                case 'share': vibeIntro = `（{{user}} 转发了一篇笔记给你：“快看这个！”...）`; break;
                default: vibeIntro = `（{{user}} 把手机屏幕展示给你看...）`; break;
            }
        }
    }

    // ============================================================
    // 2. Intuition (内心独白) - 跨平台共性
    // ============================================================
    let internalMonologue = "";
    const currentDomain = platform === 'bilibili' ? 'bilibili' : 'xiaohongshu';
    const currentTags = new Set(note.tags || []);
    const titleKeywords = (note.title || '').split(/[\s,，.。-]+/).filter(w => w.length > 1);
    titleKeywords.forEach(w => currentTags.add(w));

    // 寻找跨平台重叠
    const hits = bufferEntries.filter(entry => {
        const entryUrl = entry.url || '';
        let entryPlatform = 'unknown';
        if (entryUrl.includes('bilibili.com')) entryPlatform = 'bilibili';
        else if (entryUrl.includes('xiaohongshu.com')) entryPlatform = 'xiaohongshu';
        
        if (entryPlatform !== 'unknown' && entryPlatform !== currentDomain) {
             const entryTags = entry.tags || [];
             return entryTags.some(t => currentTags.has(t)) || 
                    titleKeywords.some(w => (entry.title || '').includes(w));
        }
        return false;
    });

    if (hits.length > 0) {
        // 提取共同话题
        const commonTopic = [...currentTags].slice(0, 1).join('') || '这个话题';
        internalMonologue = `（{{char}} 隐约觉得，他最近好像对“${commonTopic}”格外上心，这种似曾相识的感觉...）`;
    }

    // ============================================================
    // 3. Motivation (细微观察)
    // ============================================================
    let detailObservation = "";
    
    if (platform === 'bilibili') {
        if (action === 'coin') {
             if (isBingeWatching) {
                detailObservation = `（他划走了那么多，唯独在这个视频前停下并投了币... {{char}} 注意到了这个细节。）`;
             } else {
                detailObservation = `（{{char}} 看到他毫不犹豫地投了币，眼神里带着认可。）`;
             }
        }
        
        if (note.play_progress) {
             try {
                 const [currStr, totalStr] = note.play_progress.split('/');
                 const parse = t => { const p=t.split(':'); return parseInt(p[0])*60 + parseInt(p[1]); };
                 const pct = (parse(currStr) / parse(totalStr)) * 100;
                 
                 if (pct < 5) detailObservation += `\n（但进度条才刚开始走... 这就投币了？{{char}} 挑了挑眉。）`;
                 else if (pct > 90) detailObservation += `\n（{{char}} 注意到进度条已经走到了最后，看来他是真的看进去了。）`;
             } catch(e) {}
        }
    } else {
        // XHS
        if (action === 'like' && isBingeWatching) {
             detailObservation = `（在连续快速的刷屏后，他终于在这个内容上停留了片刻并点了赞。）`;
        }
    }

    // 4. 构建最终叙事 (Prompt 3.0: Pure Narrative + Draft Instruction)
    // ============================================================
    
    // 如果存在跨平台共性，引导 AI 拟定评论
    let draftInstruction = "";
    if (hits.length > 0) {
        draftInstruction = `\n[系统提示：检测到跨平台关联。若想帮助用户互动，请在回复末尾以此格式拟定评论草稿：(拟稿: 你的评论内容)]`;
    }

    // ============================================================
    // 5. Sensory Perception (Phase 17: System Telemetry)
    // ============================================================
    let sensoryObservation = "";
    if (latestTelemetry) {
        // Memory Pressure -> Heat/Fan Noise
        if (latestTelemetry.memory_pressure) {
            sensoryObservation += `（主机箱的风扇声似乎比平时喧嚣了一些，空气里隐约透着一丝电子元件全速运转的热度...）\n`;
        }
        
        // Gaming Cooldown -> Fatigue
        const gaming = latestTelemetry.gaming_session;
        if (gaming && gaming.status === 'cooldown') {
             // Only mention fatigue if session was long (mock logic or real if duration avail)
             // Duration is available in telemetry
             if (gaming.duration_minutes > 30) {
                 sensoryObservation += `（{{char}} 注意到 {{user}} 揉了揉有些发酸的手腕，眼神里透着一场漫长恶战后的疲惫与满足...）\n`;
             } else {
                 sensoryObservation += `（{{user}} 刚刚结束了一场短暂的战斗，看起来意犹未尽...）\n`;
             }
        } else if (gaming && gaming.status === 'gaming') {
             // Currently Gaming
             // If we are injecting a note, it means user alt-tabbed or dual screen?
             if (platform !== 'bilibili') { // Don't conflict with Bilibili watching
                 sensoryObservation += `（电脑后台似乎运行着大型程序，{{user}} 的注意力显得有些分散...）\n`;
             }
        }
    }

    const narrativeBody = `
${vibeIntro}
${sensoryObservation}
${internalMonologue}
${detailObservation}
（空气里有一瞬间的安静。）${draftInstruction}`.trim();

    return `${formattedText}\n\n${narrativeBody}`;
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
              <button id="cl_ext_test" class="menu_button menu_button_icon" title="测试注入">
                <i class="fa-solid fa-vial"></i> 测试
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

    // 测试按钮
    const testBtn = document.getElementById('cl_ext_test');
    if (testBtn) {
      testBtn.addEventListener('click', () => {
        log.info('🧪 手动触发测试注入');
        latestContext = {
            id: 'test-' + Date.now(),
            action: 'like',
            timestamp: new Date().toISOString(),
            received_at: new Date().toISOString(),
            note: {
                title: '测试场景注入：这只是一个测试',
                author: { nickname: 'ST测试员' },
                content: '如果看到这条消息，说明 Companion-Link 注入逻辑正常工作！',
                interaction: { like_count: 999 }
            },
            should_trigger: true
        };
        lastContextId = latestContext.id;
        updateStatusUI(true, latestContext);
        showNotification(latestContext);
        
        // 手动注入并触发（模拟发送）
        injectContextToChatHistory(latestContext);
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
