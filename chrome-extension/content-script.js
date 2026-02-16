/**
 * Companion-Link Content Script
 *
 * 在小红书页面中非侵入式监听用户行为：
 * 1. 点赞 (like)      — 三层容错检测
 * 2. 评论提交 (comment) — 发送按钮 + Enter 键
 * 3. 长时间阅读 (read)  — URL 停留 > 阈值
 *
 * 技术要点：
 * - MutationObserver 深度监听 DOM 变化
 * - SPA pushState / replaceState AOP 拦截
 * - 基于 Map 的行为防抖
 * - 所有日志带 [CL] 前缀
 */

(() => {
  "use strict";

  // ============================================================
  // 常量 & 配置
  // ============================================================

  const LOG_PREFIX = "[CL]";

  /** 默认配置，可通过 Popup 面板覆盖 */
  const DEFAULT_CONFIG = {
    enabled: true,
    debounceMs: 1500,       // 防抖间隔（ms）
    readThresholdSec: 5,    // 阅读停留阈值（秒）
    backendUrl: "http://localhost:8765",
  };

  /** 小红书笔记 URL 正则 — 从 URL 中提取 note_id */
  const NOTE_URL_PATTERNS = [
    /xiaohongshu\.com\/explore\/([a-f0-9]+)/,
    /xiaohongshu\.com\/discovery\/item\/([a-f0-9]+)/,
  ];

  /**
   * 点赞相关 DOM 选择器（多选择器容错）
   * 小红书前端迭代频繁，这里列出多种可能的选择器
   */
  const LIKE_SELECTORS = {
    // 点赞按钮容器
    wrappers: [
      ".like-wrapper",
      '[data-type="like"]',
      ".like-container",
      ".engage-bar .like",
    ],
    // 点赞激活时添加的类名
    activeClasses: [
      "active",
      "liked",
      "is-liked",
      "like-active",
      "is-active",
    ],
    // 点赞图标（SVG / icon）
    icons: [
      ".like-wrapper .like-icon",
      ".like-wrapper svg",
      '[data-type="like"] svg',
      ".like-icon",
    ],
  };

  /** 评论相关选择器 */
  const COMMENT_SELECTORS = {
    inputs: [
      ".comment-input textarea",
      ".comment-input",
      'textarea[placeholder*="评论"]',
      'textarea[placeholder*="说点什么"]',
      '[contenteditable="true"]',
    ],
    submitButtons: [
      ".comment-input .submit-btn",
      'button.submit',
      '.comment-btn',
      // 文字匹配由代码实现（"发布", "发送"）
    ],
  };

  /** 笔记详情页容器选择器（用于定位当前笔记） */
  const NOTE_DETAIL_SELECTORS = [
    ".note-detail-mask",
    "#noteContainer",
    ".note-container",
    '[class*="note-detail"]',
    ".main-content",
  ];

  /** 前端提取 DOM 选择器 */
  const EXTRACT_SELECTORS = {
    title: ["#detail-title", ".title", 'meta[name="og:title"]'],
    content: ["#detail-desc .note-text", ".desc", ".content", 'meta[name="og:description"]'],
    authorName: [".author-wrapper .username", ".user-nickname", ".name"],
    authorAvatar: [".author-wrapper .avatar img", ".avatar img"],
    likeCount: [".like-wrapper .count", '[data-type="like"] .count', ".like-count"],
    collectCount: [".collect-wrapper .count", '[data-type="collect"] .count', ".collect-count"],
    commentCount: [".chat-wrapper .count", '[data-type="comment"] .count', ".comment-count"],
    shareCount: [".share-wrapper .count", '[data-type="share"] .count'],
    comments: [".comment-item", ".comment-inner-container", ".parent-comment"],
    tags: [".tag-item", "a.tag", "#hash-tag-container a"],
  };

  // ============================================================
  // 状态管理
  // ============================================================

  /** 运行时配置（从 storage 加载后覆盖） */
  let config = { ...DEFAULT_CONFIG };

  /** 防抖记录：key = `${action}:${noteId}`, value = timestamp */
  const _sentSignals = new Map();

  /** 阅读计时器 */
  let _readTimer = null;
  let _readStartTime = null;
  let _currentNoteUrl = null;
  let _currentNoteId = null;

  /** 已检测到的点赞状态缓存（避免重复触发） */
  const _likedNotes = new Set();

  /** MutationObserver 实例引用 */
  let _domObserver = null;

  // ============================================================
  // 日志工具
  // ============================================================

  const log = {
    info: (...args) => console.log(`%c${LOG_PREFIX}`, "color:#00d2ff;font-weight:bold", ...args),
    warn: (...args) => console.warn(`%c${LOG_PREFIX}`, "color:#ffaa00;font-weight:bold", ...args),
    error: (...args) => console.error(`%c${LOG_PREFIX}`, "color:#ff4444;font-weight:bold", ...args),
    debug: (...args) => console.debug(`%c${LOG_PREFIX}`, "color:#888;font-weight:bold", ...args),
  };

  // ============================================================
  // 工具函数
  // ============================================================

  /**
   * 从当前页面 URL 解析笔记信息
   * @returns {{ noteUrl: string, noteId: string|null }}
   */
  function parseCurrentNote() {
    const url = window.location.href;
    for (const pattern of NOTE_URL_PATTERNS) {
      const match = url.match(pattern);
      if (match) {
        return { noteUrl: url, noteId: match[1] };
      }
    }
    return { noteUrl: url, noteId: null };
  }

  /**
   * 防抖检查：同 action + noteId 在 debounceMs 内只发一次
   * @returns {boolean} true = 应跳过（被防抖）
   */
  function isDebounced(action, noteId) {
    const key = `${action}:${noteId || "unknown"}`;
    const now = Date.now();
    const lastSent = _sentSignals.get(key);

    if (lastSent && (now - lastSent) < config.debounceMs) {
      log.debug(`防抖跳过: ${key} (距上次 ${now - lastSent}ms)`);
      return true;
    }

    _sentSignals.set(key, now);

    // 清理过期记录（防止内存泄漏）
    if (_sentSignals.size > 100) {
      const expiry = now - config.debounceMs * 10;
      for (const [k, v] of _sentSignals) {
        if (v < expiry) _sentSignals.delete(k);
      }
    }

    return false;
  }

  // ============================================================
  // 前端页面数据提取
  // ============================================================

  /**
   * 安全地把中文数字字符串转为数字
   * "1.2万" → 12000, "3456" → 3456, "" → 0
   */
  function safeInt(val) {
    if (val == null) return 0;
    const s = String(val).trim();
    if (!s) return 0;
    if (s.includes("万")) {
      return Math.round(parseFloat(s) * 10000) || 0;
    }
    return parseInt(s.replace(/[^\d]/g, ""), 10) || 0;
  }

  /**
   * 在多个选择器中找到第一个匹配的元素文本
   */
  function queryText(selectors, attr) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (attr === "content") return el.getAttribute("content") || "";
      return (el.textContent || el.innerText || "").trim();
    }
    return "";
  }

  /**
   * 从 __INITIAL_STATE__ 提取结构化数据
   * @param {string} noteId
   * @returns {object|null}
   */
  function extractFromInitialState(noteId) {
    try {
      const scripts = document.querySelectorAll("script");
      for (const script of scripts) {
        const text = script.textContent || "";
        if (!text.includes("__INITIAL_STATE__")) continue;

        const match = text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*;?\s*$/ms);
        if (!match) continue;

        let jsonStr = match[1].replace(/undefined/g, "null");
        const data = JSON.parse(jsonStr);

        // 导航到笔记详情
        const noteDetailMap = data?.note?.noteDetailMap;
        if (!noteDetailMap) return null;

        const noteEntry = noteDetailMap[noteId];
        if (!noteEntry?.note) return null;

        const note = noteEntry.note;
        const user = note.user || {};
        const interact = note.interactInfo || {};

        // 评论
        const rawComments = noteEntry.comments || note.comments || [];
        const topComments = rawComments
          .map((c) => ({
            user_nickname: c.userInfo?.nickname || c.user?.nickname || "匿名",
            content: c.content || "",
            like_count: safeInt(c.likeCount || c.like_count),
          }))
          .sort((a, b) => b.like_count - a.like_count)
          .slice(0, 3);

        // 标签
        const tags = (note.tagList || [])
          .map((t) => t.name || "")
          .filter(Boolean);

        // 图片
        const images = (note.imageList || [])
          .map((img) => img.urlDefault || img.url || "")
          .filter(Boolean);

        const result = {
          note_id: noteId,
          title: note.title || "",
          content: note.desc || "",
          note_type: note.type || "normal",
          author: {
            nickname: user.nickname || "",
            user_id: user.userId || user.user_id || "",
            avatar: user.imageb || user.avatar || "",
          },
          interaction: {
            like_count: safeInt(interact.likedCount || interact.liked_count),
            collect_count: safeInt(interact.collectedCount || interact.collected_count),
            comment_count: safeInt(interact.commentCount || interact.comment_count),
            share_count: safeInt(interact.shareCount || interact.share_count),
          },
          top_comments: topComments,
          tags,
          images,
        };

        log.info("📦 [__INITIAL_STATE__] 提取成功:", result.title);
        return result;
      }
    } catch (err) {
      log.warn("⚠️ __INITIAL_STATE__ 解析失败:", err.message);
    }
    return null;
  }

  /**
   * 降级方案：从 DOM 元素直接提取
   * @param {string} noteId
   * @returns {object}
   */
  function extractFromDom(noteId) {
    const title = queryText(EXTRACT_SELECTORS.title) || document.title || "[无标题]";
    const content = queryText(EXTRACT_SELECTORS.content);
    const authorName = queryText(EXTRACT_SELECTORS.authorName);

    const likeCount = safeInt(queryText(EXTRACT_SELECTORS.likeCount));
    const collectCount = safeInt(queryText(EXTRACT_SELECTORS.collectCount));
    const commentCount = safeInt(queryText(EXTRACT_SELECTORS.commentCount));

    // 评论提取
    const topComments = [];
    const commentEls = [];
    for (const sel of EXTRACT_SELECTORS.comments) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { commentEls.push(...found); break; }
    }
    for (const el of Array.from(commentEls).slice(0, 3)) {
      const nick = el.querySelector(".author-wrapper .name, .user-name, .nickname");
      const text = el.querySelector(".content, .comment-text, .note-text");
      const likes = el.querySelector(".like-count, .like .count");
      topComments.push({
        user_nickname: nick?.textContent?.trim() || "匿名",
        content: text?.textContent?.trim() || "",
        like_count: safeInt(likes?.textContent),
      });
    }

    // 标签
    const tags = [];
    for (const sel of EXTRACT_SELECTORS.tags) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        found.forEach((el) => {
          const t = (el.textContent || "").trim().replace(/^#/, "");
          if (t) tags.push(t);
        });
        break;
      }
    }

    const result = {
      note_id: noteId,
      title,
      content,
      note_type: "normal",
      author: { nickname: authorName, user_id: "", avatar: "" },
      interaction: {
        like_count: likeCount,
        collect_count: collectCount,
        comment_count: commentCount,
        share_count: 0,
      },
      top_comments: topComments,
      tags,
      images: [],
    };

    log.info("📦 [DOM] 提取成功:", result.title);
    return result;
  }

  /**
   * 提取当前笔记页面的完整数据
   * 策略: __INITIAL_STATE__ 优先 → DOM 降级
   */
  function extractNoteData(noteId) {
    return extractFromInitialState(noteId) || extractFromDom(noteId);
  }

  // ============================================================
  // 信号发送
  // ============================================================

  /**
   * 发送信号到 Background Service Worker
   * 自动附加页面提取数据
   */
  function sendSignal(action, extra = {}) {
    const { noteUrl, noteId } = parseCurrentNote();

    if (!noteId) {
      log.debug(`非笔记页面，忽略 ${action} 信号`);
      return;
    }

    if (isDebounced(action, noteId)) return;

    // 提取页面数据
    const noteData = extractNoteData(noteId);
    log.info(`📦 附加笔记数据: 《${noteData.title}》`, noteData);

    const payload = {
      action,
      note_url: noteUrl,
      note_id: noteId,
      timestamp: new Date().toISOString(),
      note_data: noteData,  // 前端提取的完整数据
      ...extra,
    };

    log.info(`📡 发送信号: ${action}`, { action, note_id: noteId, title: noteData.title });

    try {
      chrome.runtime.sendMessage(
        { type: "COMPANION_LINK_SIGNAL", payload },
        (response) => {
          if (chrome.runtime.lastError) {
            log.warn("消息发送失败:", chrome.runtime.lastError.message);
            return;
          }
          if (response?.success) {
            log.info(`✅ 信号已送达: ${action}`);
          } else {
            log.warn(`⚠️ 后端响应异常:`, response);
          }
        }
      );
    } catch (err) {
      log.error("sendMessage 异常:", err);
    }
  }

  // ============================================================
  // 层级 1: MutationObserver — 监听点赞 class 变化
  // ============================================================

  /**
   * 检查某个元素是否是点赞按钮且处于激活状态
   */
  function isLikeActivated(element) {
    if (!element || !element.classList) return false;

    // 检查元素自身或其祖先是否为点赞容器
    const likeWrapper = LIKE_SELECTORS.wrappers.reduce((found, sel) => {
      return found || element.closest(sel);
    }, null);

    if (!likeWrapper) return false;

    // 检查是否新增了激活类名
    for (const cls of LIKE_SELECTORS.activeClasses) {
      if (likeWrapper.classList.contains(cls)) {
        return true;
      }
    }

    // 检查 SVG 颜色变化（红色 = 已点赞）
    const svg = likeWrapper.querySelector("svg");
    if (svg) {
      const fill = svg.getAttribute("fill") || "";
      const color = svg.getAttribute("color") || "";
      const style = svg.style?.color || svg.style?.fill || "";
      const allColor = `${fill} ${color} ${style}`.toLowerCase();
      // 红色系 = 已点赞
      if (allColor.match(/#f[0-9a-f]{2}[0-3]/i) || allColor.includes("red") || allColor.includes("rgb(255")) {
        return true;
      }
    }

    return false;
  }

  /**
   * MutationObserver 回调 — 深度监听 DOM 变化
   * 主要捕获点赞按钮的 class 属性变化和子节点 SVG 替换
   */
  function handleMutations(mutations) {
    for (const mutation of mutations) {
      // --- class 属性变化 ---
      if (mutation.type === "attributes" && mutation.attributeName === "class") {
        const target = mutation.target;

        // 检查是否是点赞容器的 class 变化
        const isLikeContainer = LIKE_SELECTORS.wrappers.some(
          (sel) => target.matches?.(sel) || target.closest?.(sel)
        );

        if (isLikeContainer && isLikeActivated(target)) {
          const { noteId } = parseCurrentNote();
          if (noteId && !_likedNotes.has(noteId)) {
            _likedNotes.add(noteId);
            log.info("👍 [MutationObserver] 检测到点赞 class 变化");
            sendSignal("like");
          }
        }
      }

      // --- SVG 子节点替换（点赞图标从空心变实心）---
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // 检查新添加的节点是否在点赞容器内
          const parentLike = LIKE_SELECTORS.wrappers.reduce((found, sel) => {
            return found || node.closest?.(sel);
          }, null);

          if (parentLike && isLikeActivated(node)) {
            const { noteId } = parseCurrentNote();
            if (noteId && !_likedNotes.has(noteId)) {
              _likedNotes.add(noteId);
              log.info("👍 [MutationObserver] 检测到点赞 SVG 节点替换");
              sendSignal("like");
            }
          }
        }
      }
    }
  }

  /**
   * 启动 MutationObserver
   */
  function startDomObserver() {
    if (_domObserver) {
      _domObserver.disconnect();
    }

    _domObserver = new MutationObserver(handleMutations);

    // 监听整个 body 的深度变化
    _domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "fill", "color"],
    });

    log.info("🔍 MutationObserver 已启动 (深度监听)");
  }

  // ============================================================
  // 层级 2: 点击事件代理 — 点赞、收藏、分享按钮
  // ============================================================

  function setupClickDelegate() {
    document.addEventListener("click", (event) => {
      if (!config.enabled) return;

      const target = event.target;

      // === 点赞检测 ===
      const likeEl = LIKE_SELECTORS.wrappers.reduce((found, sel) => {
        return found || target.closest(sel);
      }, null);

      if (likeEl) {
        const { noteId } = parseCurrentNote();
        if (noteId) {
          // 延迟检测：等待 DOM 更新后确认是否真的点赞成功
          setTimeout(() => {
            if (isLikeActivated(likeEl) && !_likedNotes.has(noteId)) {
              _likedNotes.add(noteId);
              log.info("👍 [点击代理] 检测到点赞按钮点击");
              sendSignal("like");
            }
          }, 300);
        }
      }

      // === 收藏检测 ===
      const collectEl = target.closest(
        '.collect-wrapper, [data-type="collect"], .star-wrapper, .collect-container'
      );
      if (collectEl) {
        setTimeout(() => {
          const { noteId } = parseCurrentNote();
          if (noteId) {
            log.info("⭐ [点击代理] 检测到收藏按钮点击");
            sendSignal("collect");
          }
        }, 300);
      }

      // === 分享检测 ===
      const shareEl = target.closest(
        '.share-wrapper, [data-type="share"], .share-container'
      );
      if (shareEl) {
        const { noteId } = parseCurrentNote();
        if (noteId) {
          log.info("🔗 [点击代理] 检测到分享按钮点击");
          sendSignal("share");
        }
      }

      // === 评论发送按钮检测 ===
      const submitEl = COMMENT_SELECTORS.submitButtons.reduce((found, sel) => {
        return found || target.closest(sel);
      }, null);

      // 文字匹配兜底
      const isTextSubmit =
        !submitEl &&
        (target.tagName === "BUTTON" || target.tagName === "SPAN" || target.tagName === "DIV") &&
        /^(发布|发送|评论)$/.test(target.textContent?.trim());

      if (submitEl || isTextSubmit) {
        handleCommentSubmit();
      }
    }, true); // useCapture = true，在捕获阶段拦截

    log.info("🖱️ 点击事件代理已设置");
  }

  // ============================================================
  // 层级 3: SVG 属性直接监听（兜底方案）
  // ============================================================
  // 已整合在 MutationObserver 的 attributeFilter 中
  // 通过监听 style / fill / color 属性变化来检测

  // ============================================================
  // 评论捕获
  // ============================================================

  /** 上一次捕获的评论文本（避免重复） */
  let _lastCommentText = "";

  /**
   * 尝试读取评论输入框的内容
   */
  function readCommentText() {
    for (const sel of COMMENT_SELECTORS.inputs) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.value || el.textContent || el.innerText || "";
        return text.trim();
      }
    }
    return "";
  }

  /**
   * 处理评论提交
   */
  function handleCommentSubmit() {
    const commentText = readCommentText();

    if (!commentText) {
      log.debug("评论内容为空，跳过");
      return;
    }

    if (commentText === _lastCommentText) {
      log.debug("评论内容与上次相同，跳过");
      return;
    }

    _lastCommentText = commentText;
    log.info(`💬 检测到评论提交: "${commentText.substring(0, 50)}..."`);
    sendSignal("comment", { comment_text: commentText });
  }

  /**
   * 监听键盘事件（Enter 提交评论）
   */
  function setupCommentKeyListener() {
    document.addEventListener("keydown", (event) => {
      if (!config.enabled) return;

      // Enter 键（非 Shift+Enter 换行）
      if (event.key === "Enter" && !event.shiftKey) {
        // 检查焦点是否在评论输入框内
        const activeEl = document.activeElement;
        if (!activeEl) return;

        const isCommentInput = COMMENT_SELECTORS.inputs.some(
          (sel) => activeEl.matches?.(sel) || activeEl.closest?.(sel)
        );

        if (isCommentInput) {
          // 延迟执行：等待框架处理 Enter 事件后再读取
          setTimeout(() => handleCommentSubmit(), 100);
        }
      }
    }, true);

    log.info("⌨️ 评论键盘监听已设置");
  }

  // ============================================================
  // 阅读停留监听
  // ============================================================

  /**
   * 开始阅读计时
   */
  function startReadTimer() {
    stopReadTimer(); // 先清理上一个

    const { noteUrl, noteId } = parseCurrentNote();
    if (!noteId) return;

    _currentNoteUrl = noteUrl;
    _currentNoteId = noteId;
    _readStartTime = Date.now();

    _readTimer = setTimeout(() => {
      const dwellTime = (Date.now() - _readStartTime) / 1000;
      log.info(`📖 阅读停留达到 ${dwellTime.toFixed(1)}s → 触发 read 信号`);
      sendSignal("read", { dwell_time: dwellTime });
    }, config.readThresholdSec * 1000);

    log.debug(`⏱️ 阅读计时开始: ${noteId} (阈值 ${config.readThresholdSec}s)`);
  }

  /**
   * 停止阅读计时
   */
  function stopReadTimer() {
    if (_readTimer) {
      clearTimeout(_readTimer);
      _readTimer = null;
    }
    _readStartTime = null;
  }

  /**
   * 页面可见性变化处理
   * - 切到后台 → 暂停计时
   * - 回到前台 → 恢复计时
   */
  function setupVisibilityHandler() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        // 页面隐藏 → 暂停
        if (_readTimer && _readStartTime) {
          clearTimeout(_readTimer);
          _readTimer = null;
          log.debug("⏸️ 页面隐藏，阅读计时暂停");
        }
      } else {
        // 页面恢复 → 重新开始计时（剩余时间）
        if (_readStartTime && _currentNoteId) {
          const elapsed = (Date.now() - _readStartTime) / 1000;
          const remaining = config.readThresholdSec - elapsed;

          if (remaining > 0) {
            _readTimer = setTimeout(() => {
              const totalDwell = (Date.now() - _readStartTime) / 1000;
              log.info(`📖 阅读停留达到 ${totalDwell.toFixed(1)}s → 触发 read 信号`);
              sendSignal("read", { dwell_time: totalDwell });
            }, remaining * 1000);
            log.debug(`▶️ 页面恢复，剩余 ${remaining.toFixed(1)}s`);
          }
        }
      }
    });

    log.info("👁️ 页面可见性监听已设置");
  }

  // ============================================================
  // SPA 路由追踪
  // ============================================================

  /**
   * Hook pushState 和 replaceState，拦截 SPA 路由变化
   */
  function hookHistoryAPI() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      onRouteChange("pushState");
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      onRouteChange("replaceState");
    };

    window.addEventListener("popstate", () => {
      onRouteChange("popstate");
    });

    log.info("🔀 History API 已 Hook (pushState + replaceState + popstate)");
  }

  /**
   * 路由变化回调
   */
  function onRouteChange(source) {
    const { noteUrl, noteId } = parseCurrentNote();

    log.debug(`🔀 路由变化 [${source}]: ${window.location.pathname} → noteId=${noteId || "N/A"}`);

    // 清理上一页的状态
    _lastCommentText = "";

    if (noteId) {
      // 进入笔记详情页 → 开始阅读计时
      if (noteId !== _currentNoteId) {
        startReadTimer();
      }
    } else {
      // 离开笔记页面 → 停止计时
      stopReadTimer();
      _currentNoteId = null;
      _currentNoteUrl = null;
    }
  }

  /**
   * 降级兜底：定期检查 URL 是否变化
   * 防止某些情况下 pushState Hook 失效
   */
  function setupUrlPolling() {
    let lastUrl = window.location.href;

    setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        onRouteChange("polling");
      }
    }, 1000); // 每秒检查

    log.debug("🔄 URL 轮询兜底已启动 (1s 间隔)");
  }

  // ============================================================
  // 配置加载
  // ============================================================

  /**
   * 从 chrome.storage.local 加载配置
   */
  function loadConfig() {
    try {
      chrome.storage.local.get(
        ["cl_enabled", "cl_debounceMs", "cl_readThresholdSec", "cl_backendUrl"],
        (result) => {
          if (chrome.runtime.lastError) {
            log.warn("配置加载失败，使用默认值:", chrome.runtime.lastError.message);
            return;
          }

          if (result.cl_enabled !== undefined) config.enabled = result.cl_enabled;
          if (result.cl_debounceMs) config.debounceMs = result.cl_debounceMs;
          if (result.cl_readThresholdSec) config.readThresholdSec = result.cl_readThresholdSec;
          if (result.cl_backendUrl) config.backendUrl = result.cl_backendUrl;

          log.info("⚙️ 配置已加载:", {
            enabled: config.enabled,
            debounceMs: config.debounceMs,
            readThresholdSec: config.readThresholdSec,
            backendUrl: config.backendUrl,
          });
        }
      );
    } catch (err) {
      log.warn("chrome.storage 不可用，使用默认配置");
    }
  }

  /**
   * 监听配置变更（来自 Popup 面板的实时更新）
   */
  function watchConfigChanges() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;

        if (changes.cl_enabled) {
          config.enabled = changes.cl_enabled.newValue;
          log.info(`⚙️ 开关已${config.enabled ? "开启" : "关闭"}`);
        }
        if (changes.cl_debounceMs) {
          config.debounceMs = changes.cl_debounceMs.newValue;
        }
        if (changes.cl_readThresholdSec) {
          config.readThresholdSec = changes.cl_readThresholdSec.newValue;
        }
        if (changes.cl_backendUrl) {
          config.backendUrl = changes.cl_backendUrl.newValue;
        }
      });
    } catch (err) {
      // 非扩展环境（如测试）忽略
    }
  }

  // ============================================================
  // 初始化
  // ============================================================

  function init() {
    log.info("🚀 Companion-Link Content Script 初始化中...");
    log.info(`   页面: ${window.location.href}`);

    // 1. 加载配置
    loadConfig();
    watchConfigChanges();

    // 2. Hook History API（必须尽早执行）
    hookHistoryAPI();

    // 3. 等待 DOM 就绪后启动监听
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onDomReady);
    } else {
      onDomReady();
    }
  }

  function onDomReady() {
    log.info("📄 DOM 就绪，启动所有监听器");

    // 4. 启动 MutationObserver（层级 1）
    startDomObserver();

    // 5. 设置点击代理（层级 2）
    setupClickDelegate();

    // 6. 设置评论键盘监听
    setupCommentKeyListener();

    // 7. 设置页面可见性监听
    setupVisibilityHandler();

    // 8. URL 轮询兜底
    setupUrlPolling();

    // 9. 如果当前已经在笔记详情页，开始计时
    const { noteId } = parseCurrentNote();
    if (noteId) {
      log.info(`📍 当前已在笔记页面: ${noteId}`);
      startReadTimer();
    }

    log.info("✅ Companion-Link Content Script 初始化完成");
    log.info("   监听中: 点赞 | 评论 | 收藏 | 分享 | 阅读停留");
  }

  // 启动！
  init();
})();
