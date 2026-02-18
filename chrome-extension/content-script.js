/**
 * Companion-Link Content Script
 *
 * 支持平台：
 * 1. 小红书 (Xiaohongshu)
 * 2. 哔哩哔哩 (Bilibili)
 */

(() => {
  "use strict";

  const LOG_PREFIX = "[CL]";
  const PLATFORM = window.location.hostname.includes("bilibili.com") ? "BILIBILI" : "XHS";

  const DEFAULT_CONFIG = {
    enabled: true,
    debounceMs: 1500,
    readThresholdSec: 5,
    backendUrl: "http://localhost:8765",
  };

  // ============================================================
  // Platform Adapter Interface
  // ============================================================
  
  class PlatformAdapter {
    constructor() {}
    parseCurrentId() { return null; }
    extractData(id) { return null; }
    isLikeActivated(element) { return false; }
    getClickSelectors() { return { like: [], collect: [], share: [], commentSubmit: [] }; }
  }

  // ============================================================
  // Xiaohongshu Adapter
  // ============================================================

  class XiaohongshuAdapter extends PlatformAdapter {
    constructor() {
      super();
      this.NOTE_URL_PATTERNS = [
        /xiaohongshu\.com\/explore\/([a-f0-9]+)/,
        /xiaohongshu\.com\/discovery\/item\/([a-f0-9]+)/,
      ];
      this.LIKE_SELECTORS = {
        wrappers: [".like-wrapper", '[data-type="like"]', ".like-container", ".engage-bar .like"],
        activeClasses: ["active", "liked", "is-liked", "like-active", "is-active"],
      };
    }

    parseCurrentId() {
      const url = window.location.href;
      for (const pattern of this.NOTE_URL_PATTERNS) {
        const match = url.match(pattern);
        if (match) return match[1];
      }
      return null;
    }

    extractData(noteId) {
      // 优先尝试 __INITIAL_STATE__
      try {
        const scripts = document.querySelectorAll("script");
        for (const script of scripts) {
          if (script.textContent.includes("__INITIAL_STATE__")) {
            const match = script.textContent.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*;?\s*$/ms);
            if (match) {
              const data = JSON.parse(match[1].replace(/undefined/g, "null"));
              const noteEntry = data?.note?.noteDetailMap?.[noteId];
              if (noteEntry?.note) {
                const n = noteEntry.note;
                return {
                  note_id: noteId,
                  title: n.title || "",
                  content: n.desc || "",
                  platform: "xiaohongshu",
                  author: {
                    nickname: n.user?.nickname || "",
                    user_id: n.user?.userId || "",
                    avatar: n.user?.imageb || ""
                  },
                  interaction: {
                    like_count: n.interactInfo?.likedCount || 0,
                    collect_count: n.interactInfo?.collectedCount || 0,
                    comment_count: n.interactInfo?.commentCount || 0,
                  },
                  tags: (n.tagList || []).map(t => t.name),
                  top_comments: [], 
                  images: (n.imageList || []).map(i => i.urlDefault)
                };
              }
            }
          }
        }
      } catch (e) { console.warn("XHS InitialState parse error", e); }

      // 降级 DOM 提取
      return {
        note_id: noteId,
        title: document.querySelector(".title")?.textContent || document.title,
        platform: "xiaohongshu",
        content: document.querySelector(".desc")?.textContent || "",
        author: { nickname: document.querySelector(".name")?.textContent || "", user_id: "", avatar: "" },
        interaction: {},
        tags: Array.from(document.querySelectorAll(".tag-item")).map(el => el.textContent.replace(/^#/, "").trim()),
        top_comments: [],
        images: []
      };
    }

    isLikeActivated(element) {
      const wrapper = this.LIKE_SELECTORS.wrappers.reduce((found, sel) => found || element.closest(sel), null);
      if (!wrapper) return false;
      
      if (this.LIKE_SELECTORS.activeClasses.some(c => wrapper.classList.contains(c))) return true;
      
      const svg = wrapper.querySelector("svg");
      if (svg) {
        const color = (svg.getAttribute("fill") || svg.style.color || "").toLowerCase();
        if (color.includes("red") || color.match(/#f[0-9a-f]{2}/)) return true;
      }
      return false;
    }

    getClickSelectors() {
      return {
        like: this.LIKE_SELECTORS.wrappers,
        collect: ['.collect-wrapper', '[data-type="collect"]'],
        share: ['.share-wrapper', '[data-type="share"]'],
        commentSubmit: ['.submit-btn', 'button.submit']
      };
    }
  }

  // ============================================================
  // Bilibili Adapter
  // ============================================================

  class BilibiliAdapter extends PlatformAdapter {
    constructor() {
      super();
      this.BV_PATTERN = /\/(BV[0-9a-zA-Z]+)/;
    }

    parseCurrentId() {
      const match = window.location.href.match(this.BV_PATTERN);
      return match ? match[1] : null;
    }

    extractData(bvId) {
      const meta = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content || "";
      
      const title = meta("title").replace("_哔哩哔哩_bilibili", "").trim();
      const desc = meta("description");
      const cover = meta("og:image");
      const author = meta("author");
      const keywords = meta("keywords")?.split(",") || [];

      // 尝试获取硬币数
      const coinEl = document.querySelector('.coin-info, .video-coin');
      const coinCount = coinEl ? parseInt(coinEl.textContent.trim()) || 0 : 0;

      // 播放进度
      let progress = "";
      const video = document.querySelector('video');
      if (video && video.duration) {
          const fmt = t => {
              const m = Math.floor(t / 60);
              const s = Math.floor(t % 60);
              return `${m}:${s.toString().padStart(2, '0')}`;
          };
          progress = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
      }

      return {
        note_id: bvId,
        title: title,
        content: desc,
        platform: "bilibili",
        play_progress: progress,
        author: {
            nickname: author,
            user_id: "",
            avatar: ""
        },
        interaction: {
            like_count: 0, 
            collect_count: 0,
            comment_count: 0,
            coin_count: coinCount
        },
        tags: keywords.slice(0, 5),
        top_comments: [],
        images: [cover]
      };
    }

    isLikeActivated(element) {
      // Bilibili 点赞按钮 (新旧版混杂)
      // 旧版: .video-toolbar-left-item.like.on
      // 新版: .video-like.on
      const container = element.closest('.like, .video-like, .video-toolbar-left-item'); 
      return container && container.classList.contains('on');
    }
    
    isCoinActivated(element) {
       const container = element.closest('.coin, .video-coin');
       return container && container.classList.contains('on');
    }

    getClickSelectors() {
      return {
        like: ['.video-like', '.like', '.video-toolbar-left-item.like'],
        collect: ['.video-fav', '.fav', '.video-toolbar-left-item.fav'],
        share: ['.video-share', '.share', '.video-toolbar-left-item.share'],
        coin: ['.video-coin', '.coin', '.video-toolbar-left-item.coin'],
        commentSubmit: ['.reply-box-send', '.comment-submit']
      };
    }
  }

  // ============================================================
  // Main Logic
  // ============================================================

  const adapter = PLATFORM === "BILIBILI" ? new BilibiliAdapter() : new XiaohongshuAdapter();
  // 全局状态
  const _sentSignals = new Map();
  const _likedNotes = new Set();
  let _currentNoteId = null;
  let config = { ...DEFAULT_CONFIG };

  const log = {
    info: (...args) => console.log(`%c${LOG_PREFIX}[${PLATFORM}]`, "color:#00d2ff", ...args),
    warn: (...args) => console.warn(`%c${LOG_PREFIX}[${PLATFORM}]`, "color:#ffaa00", ...args),
    debug: (...args) => console.debug(`%c${LOG_PREFIX}[${PLATFORM}]`, "color:#888", ...args),
  };

  function sendSignal(action, extra = {}) {
    const noteId = adapter.parseCurrentId();
    if (!noteId) return;

    const key = `${action}:${noteId}`;
    const now = Date.now();
    
    // 防抖
    const debounceTime = action === 'coin' ? 3000 : config.debounceMs;
    if (_sentSignals.has(key) && (now - _sentSignals.get(key) < debounceTime)) return;
    _sentSignals.set(key, now);

    const data = adapter.extractData(noteId);
    if (!data.title) {
        // 数据提取失败，可能页面未加载完，延迟重试
        log.warn("数据提取为空，跳过");
        return;
    }
    
    log.info(`📡 发送信号: ${action}`, data);

    chrome.runtime.sendMessage({
      type: "COMPANION_LINK_SIGNAL",
      payload: {
        action,
        note_id: noteId,
        note_url: window.location.href,
        timestamp: new Date().toISOString(),
        note_data: data,
        ...extra
      }
    });
  }

  function initObserver() {
    log.info("已启动");
    
    // 1. MutationObserver 监听点赞状态变化 (通用逻辑)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
           const target = m.target;
           // Like
           if (adapter.isLikeActivated(target)) {
             const id = adapter.parseCurrentId();
             if (id && !_likedNotes.has(id)) {
               _likedNotes.add(id);
               sendSignal("like");
             }
           }
        }
      }
    });

    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });

    // 2. 点击代理
    document.addEventListener("click", (e) => {
        const sel = adapter.getClickSelectors();
        const target = e.target;

        // B站投币特殊处理
        if (PLATFORM === "BILIBILI" && sel.coin && sel.coin.some(s => target.closest(s))) {
            setTimeout(() => {
                // 检查是否投币成功 (active state)
                const coinBtn = sel.coin.map(s => document.querySelector(s)).find(Boolean);
                if (coinBtn && adapter.isCoinActivated(coinBtn)) {
                     sendSignal("coin"); 
                }
            }, 800); 
        }

        // Like
        if (sel.like.some(s => target.closest(s))) {
            setTimeout(() => {
                const el = sel.like.map(s => document.querySelector(s)).find(Boolean);
                if (el && adapter.isLikeActivated(el)) sendSignal("like");
            }, 500);
        }
        
        // Comment
        if (sel.commentSubmit.some(s => target.closest(s))) {
            // 简单取值 (B站: .reply-box-textarea, 小红书: .comment-input)
            const text = document.querySelector('textarea.reply-box-textarea, .comment-input textarea')?.value;
            if(text) sendSignal("comment", { comment_text: text });
        }

    }, true);
    
    // 3. 初始 Read
    const id = adapter.parseCurrentId();
    if (id) {
        _currentNoteId = id;
        setTimeout(() => sendSignal("read"), 2500);
    }
    
    // 4. URL 变化监听
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            const newId = adapter.parseCurrentId();
            if (newId && newId !== _currentNoteId) {
                _currentNoteId = newId;
                setTimeout(() => sendSignal("read"), 2500);
            }
        }
    }, 1000); // 轮询比 pushState 钩子更稳（B站有时候不触发standard events）
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initObserver);
  } else {
    initObserver();
  }

})();
