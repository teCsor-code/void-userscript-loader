// ==UserScript==
// @name         VoidIdle Loader
// @namespace    voididle-loader
// @version      2026-04-30.1
// @description  Modular VoidIdle userscript — core embedded, feature modules loaded from manifest.json
// @match        https://www.voididle.com/*
// @match        https://voididle.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  // manifestUrl is the only line you need to change when forking this loader.
  const CONFIG = Object.freeze({
    appId:       'voididle-loader',
    version:     '2026-04-30.1',
    manifestUrl: 'https://raw.githubusercontent.com/AimForNuts/void-userscript-loader/main/manifest.json',
    logPrefix:   '[VoidIdle]',
    socketMessageTypes: new Set(['fullState', 'partyTick', 'auraRegen', 'auraXpGain']),
    cache: {
      manifest:  'voididle.loader.manifest.v1',
      settings:  'voididle.loader.settings.v1',
      panels:    'voididle.loader.panelSettings.v1',
      moduleKey: (id, ver) => `voididle.loader.module.${id}@${ver}`,
    },
  });

  // ─── LOGGER ─────────────────────────────────────────────────────────────────
  // Shared ring buffer (last 150 lines) used by ManagerUI debug log panel.
  const _logRing = [];
  const LOG_RING_MAX = 150;

  function pushLog(prefix, level, args) {
    const text = args.map(a =>
      (a && typeof a === 'object') ? JSON.stringify(a) : String(a)
    ).join(' ');
    const line = `${prefix} ${text}`;
    _logRing.push({ ts: Date.now(), level, line });
    if (_logRing.length > LOG_RING_MAX) _logRing.shift();
    console[level](prefix, ...args);
  }

  // createLogger(moduleId) — pass '' for the core loader logger.
  function createLogger(moduleId) {
    const prefix = moduleId
      ? `${CONFIG.logPrefix}:${moduleId}`
      : CONFIG.logPrefix;
    return {
      log:    (...args) => pushLog(prefix, 'log',   args),
      warn:   (...args) => pushLog(prefix, 'warn',  args),
      error:  (...args) => pushLog(prefix, 'error', args),
      getLog: ()        => [..._logRing],
    };
  }

  // Core loader logger (no module scope).
  const logger = createLogger('');

  // ─── MODULE STORAGE HELPER ──────────────────────────────────────────────────
  // Returns a namespaced localStorage interface for a single module.
  // Keys are stored as: voididle.module.{moduleId}.{key}
  function createModuleStorage(moduleId) {
    const pfx = `voididle.module.${moduleId}.`;
    return {
      get(key, fallback = null) {
        try {
          const raw = localStorage.getItem(pfx + key);
          return raw !== null ? JSON.parse(raw) : fallback;
        } catch { return fallback; }
      },
      set(key, value) {
        try { localStorage.setItem(pfx + key, JSON.stringify(value)); }
        catch (err) { logger.warn(`storage.set failed [${moduleId}.${key}]`, err.message); }
      },
      remove(key) {
        try { localStorage.removeItem(pfx + key); } catch {}
      },
      clear() {
        try {
          Object.keys(localStorage)
            .filter(k => k.startsWith(pfx))
            .forEach(k => localStorage.removeItem(k));
        } catch {}
      },
    };
  }

  // ─── GENERAL STORAGE HELPERS ────────────────────────────────────────────────
  function clone(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch { return v; }
  }

  // Merges incoming into base in-place and returns base.
  function deepMerge(base, incoming) {
    if (!base || typeof base !== 'object') return base;
    if (!incoming || typeof incoming !== 'object') return base;
    for (const [k, v] of Object.entries(incoming)) {
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        deepMerge(base[k], v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Panel settings (position/size/open state) stored separately from module data.
  const PanelStorage = {
    load() {
      try {
        const raw = localStorage.getItem(CONFIG.cache.panels);
        return raw ? deepMerge({ panels: {} }, JSON.parse(raw)) : { panels: {} };
      } catch { return { panels: {} }; }
    },
    save(settings) {
      try { localStorage.setItem(CONFIG.cache.panels, JSON.stringify(settings)); }
      catch (err) { logger.warn('PanelStorage.save failed:', err.message); }
    },
  };

  // ─── EVENT BUS ──────────────────────────────────────────────────────────────
  function createEventBus() {
    const listeners = new Map();
    return {
      on(type, handler) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
        return () => this.off(type, handler);
      },
      off(type, handler) {
        listeners.get(type)?.delete(handler);
      },
      emit(type, payload) {
        for (const handler of listeners.get(type) || []) {
          try { handler(payload); }
          catch (err) {
            logger.error(`EventBus error in handler for "${type}":`, err.message);
          }
        }
      },
    };
  }

  // ─── SOCKET CORE ────────────────────────────────────────────────────────────
    const SocketCore = {
        init(app) {
            const NativeWebSocket = window.WebSocket;
            if (!NativeWebSocket || NativeWebSocket.__voididleLoaderHooked) return;

            window.__VoidIdleNativeWebSocket = window.__VoidIdleNativeWebSocket || NativeWebSocket;

            function parseSocketPayload(raw) {
                if (typeof raw !== "string") {
                    return {
                        parsed: null,
                        raw,
                        rawType: typeof raw,
                        parseError: "",
                    };
                }

                let text = raw;

                // Some socket wrappers prefix frames before JSON. Keep this tolerant.
                const arrayStart = text.indexOf("[");
                const objectStart = text.indexOf("{");
                const start = Math.min(
                    arrayStart === -1 ? Infinity : arrayStart,
                    objectStart === -1 ? Infinity : objectStart
                );

                if (start !== Infinity && start > 0) {
                    text = text.slice(start);
                }

                try {
                    return {
                        parsed: JSON.parse(text),
                        raw,
                        rawType: "string",
                        parseError: "",
                    };
                } catch (err) {
                    return {
                        parsed: null,
                        raw,
                        rawType: "string",
                        parseError: String(err),
                    };
                }
            }

            function emitSocketDebug(direction, url, raw) {
                const parsed = parseSocketPayload(raw);

                app.events.emit("socket:debug", {
                    direction,
                    url: String(url || ""),
                    ts: Date.now(),
                    raw: parsed.raw,
                    rawType: parsed.rawType,
                    parseError: parsed.parseError,
                    parsed: parsed.parsed,
                    type: parsed.parsed && typeof parsed.parsed === "object" && !Array.isArray(parsed.parsed)
                        ? String(parsed.parsed.type || "")
                        : Array.isArray(parsed.parsed)
                            ? "array"
                            : "",
                });

                return parsed.parsed;
            }

            function HookedWebSocket(...args) {
                const socket = new NativeWebSocket(...args);
                const socketUrl = args[0];

                socket.addEventListener("message", (event) => {
                    const msg = emitSocketDebug("IN", socketUrl, event.data);

                    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

                    app.events.emit("socket:any", msg);

                    if (!msg?.type || !CONFIG.socketMessageTypes.has(msg.type)) return;

                    app.events.emit("socket:message", msg);
                    app.events.emit(msg.type, msg);
                });

                const nativeSend = socket.send;

                socket.send = function patchedSend(data) {
                    emitSocketDebug("OUT", socketUrl, data);

                    return nativeSend.apply(this, arguments);
                };

                return socket;
            }

            HookedWebSocket.prototype = NativeWebSocket.prototype;
            HookedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
            HookedWebSocket.OPEN = NativeWebSocket.OPEN;
            HookedWebSocket.CLOSING = NativeWebSocket.CLOSING;
            HookedWebSocket.CLOSED = NativeWebSocket.CLOSED;
            HookedWebSocket.__voididleLoaderHooked = true;

            window.WebSocket = HookedWebSocket;
        },
    };

  // ─── RELAY CORE ─────────────────────────────────────────────────────────────
    const RelayCore = {
        relayUrl: "wss://voididle-combat-relay.onrender.com",

        state: {
            ws: null,
            connected: false,
            connecting: false,
            manualDisconnect: false,

            clientId: "",
            roomKey: "",
            roomHash: "",
            peerCount: 0,

            reconnectTimer: null,
            reconnectDelayMs: 5000,
        },

        init(app) {
            this.app = app;
        },

        isConnected() {
            return !!this.state.ws && this.state.ws.readyState === WebSocket.OPEN && this.state.connected;
        },

        generateRoomKey() {
            const bytes = new Uint8Array(12);
            crypto.getRandomValues(bytes);

            return Array.from(bytes)
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join("")
                .match(/.{1,6}/g)
                .join("-");
        },

        async hashRoomKey(raw) {
            const text = String(raw || "").trim();
            if (!text) return "";

            const buffer = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(text)
            );

            return Array.from(new Uint8Array(buffer))
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join("");
        },

        async connect(roomKey) {
            const cleanRoomKey = String(roomKey || "").trim();

            if (!cleanRoomKey) {
                alert("Enter or generate a relay room code first.");
                return;
            }

            clearTimeout(this.state.reconnectTimer);
            this.state.reconnectTimer = null;

            this.state.manualDisconnect = false;
            this.state.roomKey = cleanRoomKey;
            this.state.roomHash = await this.hashRoomKey(cleanRoomKey);

            if (!this.state.roomHash) {
                alert("Could not create relay room hash.");
                return;
            }

            this.closeSocketOnly();

            this.state.connected = false;
            this.state.connecting = true;
            this.state.peerCount = 0;

            this.emitStatus();

            const NativeWebSocket =
                window.__VoidIdleNativeWebSocket ||
                window.__VoidIdlePersonalCoachNativeWebSocket ||
                window.WebSocket;

            const url = `${this.relayUrl}/?room=${encodeURIComponent(this.state.roomHash)}`;
            const ws = new NativeWebSocket(url);

            this.state.ws = ws;

            ws.addEventListener("open", () => {
                this.state.connecting = false;
                this.emitStatus();

                this.emit("relay:raw", {
                    direction: "INTERNAL",
                    event: "socketOpen",
                    roomHash: this.state.roomHash,
                });
            });

            ws.addEventListener("message", (event) => {
                this.handleSocketMessage(event);
            });

            ws.addEventListener("close", () => {
                const shouldReconnect =
                    !this.state.manualDisconnect &&
                    !!this.state.roomKey;

                const wasActive =
                    this.state.connected ||
                    this.state.connecting;

                this.state.ws = null;
                this.state.connected = false;
                this.state.connecting = false;
                this.state.clientId = "";
                this.state.peerCount = 0;

                this.emitStatus();

                this.emit("relay:raw", {
                    direction: "INTERNAL",
                    event: "socketClose",
                    shouldReconnect,
                });

                if (wasActive && shouldReconnect) {
                    this.state.reconnectTimer = setTimeout(() => {
                        this.connect(this.state.roomKey);
                    }, this.state.reconnectDelayMs);
                }
            });

            ws.addEventListener("error", () => {
                this.state.connecting = false;

                this.emitStatus();

                this.emit("relay:raw", {
                    direction: "INTERNAL",
                    event: "socketError",
                });
            });
        },

        disconnect() {
            this.state.manualDisconnect = true;

            clearTimeout(this.state.reconnectTimer);
            this.state.reconnectTimer = null;

            this.closeSocketOnly();

            this.state.connected = false;
            this.state.connecting = false;
            this.state.clientId = "";
            this.state.peerCount = 0;

            this.emitStatus();

            this.emit("relay:raw", {
                direction: "INTERNAL",
                event: "manualDisconnect",
            });
        },

        closeSocketOnly() {
            if (!this.state.ws) return;

            try {
                this.state.ws.close();
            } catch { }

            this.state.ws = null;
        },

        send(payload) {
            const ws = this.state.ws;

            if (!ws || ws.readyState !== WebSocket.OPEN) {
                this.emit("relay:raw", {
                    direction: "OUT_BLOCKED",
                    reason: "socket not open",
                    payload,
                });

                return false;
            }

            const message = {
                ...payload,
                senderClientId: this.state.clientId || payload?.senderClientId || "",
                ts: Date.now(),
            };

            try {
                ws.send(JSON.stringify(message));

                this.emit("relay:raw", {
                    direction: "OUT_RAW",
                    payload: message,
                });

                return true;
            } catch (err) {
                console.warn("[VoidIdle Relay] send failed", err);

                this.emit("relay:raw", {
                    direction: "OUT_ERROR",
                    error: String(err),
                    payload: message,
                });

                return false;
            }
        },

        handleSocketMessage(event) {
            if (typeof event.data !== "string") {
                this.emit("relay:raw", {
                    direction: "IN_RAW_NON_STRING",
                    dataType: typeof event.data,
                });

                return;
            }

            let msg;

            try {
                msg = JSON.parse(event.data);
            } catch {
                this.emit("relay:raw", {
                    direction: "IN_RAW_PARSE_ERROR",
                    raw: event.data,
                });

                return;
            }

            this.emit("relay:raw", {
                direction: "IN_RAW",
                payload: msg,
            });

            this.handleRelayMessage(msg);
        },

        handleRelayMessage(msg) {
            if (!msg || typeof msg !== "object") return;

            const type = String(msg.type || "");

            if (type === "relayReady") {
                this.state.clientId = msg.clientId || this.state.clientId;
                this.state.peerCount = Number(msg.connected || msg.peerCount || this.state.peerCount || 1);
                this.state.connected = true;
                this.state.connecting = false;

                this.emit("relay:ready", msg);
                this.emitStatus();
                this.emitPeers();

                return;
            }

            if (
                type === "peerCount" ||
                type === "relayPeers" ||
                type === "peers"
            ) {
                this.state.peerCount = Number(msg.connected || msg.peerCount || msg.count || this.state.peerCount || 1);

                this.emit("relay:peers", msg);
                this.emitStatus();

                return;
            }

            const payload =
                msg.payload && typeof msg.payload === "object"
                    ? msg.payload
                    : msg.message && typeof msg.message === "object"
                        ? msg.message
                        : msg.data && typeof msg.data === "object"
                            ? msg.data
                            : msg;

            if (!payload || typeof payload !== "object") return;

            if (
                payload.senderClientId &&
                this.state.clientId &&
                payload.senderClientId === this.state.clientId
            ) {
                return;
            }

            if (this.state.connected) {
                this.state.peerCount = Math.max(2, Number(this.state.peerCount || 1));
                this.emitStatus();
                this.emitPeers();
            }

            const payloadType = String(payload.type || "");

            if (!payloadType) {
                this.emit("relay:unknown", payload);
                return;
            }

            this.emit(`relay:${payloadType}`, payload);
        },

        emitStatus() {
            this.emit("relay:status", {
                connected: this.state.connected,
                connecting: this.state.connecting,
                peerCount: this.state.peerCount,
                roomKey: this.state.roomKey,
                roomHash: this.state.roomHash,
                clientId: this.state.clientId,
            });
        },

        emitPeers() {
            this.emit("relay:peers", {
                connected: this.state.peerCount,
                peerCount: this.state.peerCount,
                clientId: this.state.clientId,
            });
        },

        emit(eventName, payload) {
            if (this.app?.events?.emit) {
                this.app.events.emit(eventName, payload);
            }
        },
    };

  // ─── DOM HELPER ─────────────────────────────────────────────────────────────
  // Shared utilities passed to every module via appContext.dom.*
  const DomHelper = {

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    waitForSelector(selector, { timeout = 10000, root = document } = {}) {
      return new Promise((resolve, reject) => {
        const existing = root.querySelector(selector);
        if (existing) return resolve(existing);

        const timer = setTimeout(() => {
          obs.disconnect();
          reject(new Error(`waitForSelector timeout: "${selector}"`));
        }, timeout);

        const obs = new MutationObserver(() => {
          const el = root.querySelector(selector);
          if (el) { clearTimeout(timer); obs.disconnect(); resolve(el); }
        });

        const observeTarget = root.nodeType === Node.DOCUMENT_NODE
          ? root.documentElement
          : root;
        obs.observe(observeTarget, { childList: true, subtree: true });
      });
    },

    async waitForStableElement(selector, {
      stabilityMs = 300,
      timeout = 10000,
      root = document,
    } = {}) {
      const deadline = Date.now() + timeout;
      let lastHtml = null;
      let stableFor = 0;

      while (Date.now() < deadline) {
        const el = root.querySelector(selector);
        const html = el ? el.innerHTML : '__absent__';

        if (html === lastHtml) {
          stableFor += 50;
          if (stableFor >= stabilityMs && el) return el;
        } else {
          stableFor = 0;
          lastHtml = html;
        }

        await this.sleep(50);
      }

      throw new Error(`waitForStableElement timeout: "${selector}"`);
    },

    clickByText(selector, text, { root = document } = {}) {
      const el = [...root.querySelectorAll(selector)]
        .find(e => e.textContent.trim() === text);
      if (!el) throw new Error(`clickByText: no "${selector}" with text "${text}"`);
      el.click();
      return el;
    },

    clickButtonByText(text, { root = document } = {}) {
      return this.clickByText('button', text, { root });
    },

    setNativeInputValue(input, value) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };

  // ─── API HELPER ─────────────────────────────────────────────────────────────
  // Thin fetch wrapper. Uses browser's own session cookies — no hardcoded tokens.
  // Pass paths relative to /api, e.g. '/inventory/123/salvage'.
  const ApiHelper = {
    async fetch(path, options = {}) {
      const url = path.startsWith('http') ? path : `/api${path}`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });
      if (!res.ok) {
        throw new Error(`API ${options.method || 'GET'} ${path} → ${res.status}`);
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    },
  };

  // ─── STYLES ──────────────────────────────────────────────────────────────────
  const Styles = {
    inject() {
      if (document.getElementById(`${CONFIG.appId}-styles`)) return;

      const style = document.createElement("style");
      style.id = `${CONFIG.appId}-styles`;
      style.textContent = `
        .vim-panel {
          position: fixed;
          z-index: 999999;
          display: none;
          flex-direction: column;
          min-width: 260px;
          min-height: 140px;
          max-width: calc(100vw - 20px);
          max-height: calc(100vh - 58px);
          resize: both;
          overflow: hidden;
          background: rgba(8, 10, 15, 0.96);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, 0.38);
          border-radius: 12px;
          box-shadow: 0 16px 46px rgba(0, 0, 0, 0.48);
          font-family: Arial, sans-serif;
          font-size: 12px;
          backdrop-filter: blur(6px);
        }

        .vim-panel.vim-open {
          display: flex;
        }

        .vim-header {
          height: 36px;
          min-height: 36px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 0 10px;
          background: rgba(255, 255, 255, 0.06);
          border-bottom: 1px solid rgba(255, 255, 255, 0.11);
          cursor: move;
          user-select: none;
          flex: 0 0 auto;
        }

        .vim-title {
          font-weight: 800;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .vim-actions {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .vim-btn {
          background: rgba(255, 255, 255, 0.08);
          color: #e5e7eb;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 7px;
          padding: 4px 8px;
          font-size: 11px;
          cursor: pointer;
        }

        .vim-btn:hover {
          background: rgba(255, 255, 255, 0.15);
        }

        .vim-btn-primary {
          background: rgba(56, 189, 248, 0.22);
          border-color: rgba(56, 189, 248, 0.55);
        }

        .vim-body {
          flex: 1 1 auto;
          overflow: auto;
          padding: 10px;
        }

        .vim-footer {
          flex: 0 0 auto;
          padding: 7px 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.10);
          color: rgba(229, 231, 235, 0.65);
          font-size: 11px;
        }

        .vim-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px;
          margin-bottom: 8px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .vim-row-main {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .vim-row-title {
          font-weight: 800;
        }

        .vim-muted {
          color: rgba(229, 231, 235, 0.62);
        }

        .vim-good {
          color: #4ade80;
          font-weight: 800;
        }

        .vim-switch-row {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          user-select: none;
        }

        .vim-switch-row input {
          transform: translateY(1px);
        }

        .vim-placeholder {
          padding: 12px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          line-height: 1.45;
        }

        #${CONFIG.appId}-tray {
          position: fixed;
          right: 14px;
          bottom: 14px;
          z-index: 1000000;
          display: flex;
          flex-direction: row-reverse;
          align-items: center;
          gap: 8px;
          pointer-events: auto;
        }

        .vim-tray-btn {
          height: 34px;
          min-width: 34px;
          max-width: 150px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 0 10px;
          background: rgba(8, 10, 15, 0.96);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, 0.45);
          border-radius: 999px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.38);
          font-family: Arial, sans-serif;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
        }

        .vim-tray-btn:hover {
          background: rgba(30, 41, 59, 0.98);
        }

        .vim-tray-btn.vim-active {
          border-color: rgba(74, 222, 128, 0.7);
        }

        .vim-tray-label {
          max-width: 110px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `;

      document.documentElement.appendChild(style);
    },
  };

  // ─── WINDOW MANAGER ──────────────────────────────────────────────────────────
  const WindowManager = {
    init(app) {
      this.createTray(app);
      this.createMasterPanel(app);
    },

    createTray(app) {
      if (app.tray || !document.documentElement) return;

      const tray = document.createElement("div");
      tray.id = `${CONFIG.appId}-tray`;
      document.documentElement.appendChild(tray);
      app.tray = tray;
    },

    createMasterPanel(app) {
      this.createBuiltinPanel(app, {
        id: `${CONFIG.appId}-manager`,
        icon: "🧩",
        title: CONFIG.title,
        bodyHtml: "",
        footer: "Hide sends the whole window to the tray. Modules are managed here.",
      });
    },

    createModulePanel(app, module) {
      this.createBuiltinPanel(app, {
        id: module.id,
        icon: module.icon,
        title: module.name,
        bodyHtml: module.render?.(app) || renderPlaceholder(module),
        footer: module.footer || "Drag the title bar. Resize from the lower-right corner.",
      });
    },

    renderAll(app) {
      this.renderMaster(app);
      this.renderTray(app);
      this.applyPanel(app, `${CONFIG.appId}-manager`);

      for (const module of app.modules.values()) {
        this.applyPanel(app, module.id);
      }
    },

    renderMaster(app) {
      const panel = app.panels.get(`${CONFIG.appId}-manager`);
      if (!panel) return;

      const body = panel.querySelector(".vim-body");
      const footer = panel.querySelector(".vim-footer");

      body.innerHTML = `
        <div class="vim-row">
          <label class="vim-switch-row">
            <input type="checkbox" data-setting="open-auto" ${app.settings.openScriptsAutomatically ? "checked" : ""} />
            <span>Open scripts automatically</span>
          </label>
        </div>

        ${[...app.modules.values()].map((module) => renderModuleRow(app, module)).join("")}

        <button type="button" class="vim-btn vim-btn-primary" data-action="run-scripts">Run Scripts</button>
      `;

      footer.textContent = app.settings.openScriptsAutomatically
        ? "Auto-open is on. Enabled scripts open on page load."
        : "Auto-open is off. Enabled scripts stay in the tray until Run Scripts is clicked.";

      body.querySelector('[data-setting="open-auto"]').addEventListener("change", (event) => {
        app.settings.openScriptsAutomatically = event.target.checked;
        Storage.save(app.settings);
        this.renderMaster(app);
      });

      body.querySelectorAll("[data-module-toggle]").forEach((input) => {
        input.addEventListener("change", (event) => {
          this.setModuleEnabled(app, event.target.dataset.moduleToggle, event.target.checked);
        });
      });

      body.querySelector('[data-action="run-scripts"]').addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.runEnabledModules(app);
      });
    },

    renderTray(app) {
      if (!app.tray) return;

      const items = [
        {
          id: `${CONFIG.appId}-manager`,
          icon: "🧩",
          label: "Scripts",
          title: "VoidIdle Scripts Master",
          open: isPanelOpen(app, `${CONFIG.appId}-manager`),
        },
        ...[...app.modules.values()]
          .filter((module) => getPanelState(app, module.id).enabled)
          .map((module) => ({
            id: module.id,
            icon: module.icon,
            label: module.shortName || module.name,
            title: module.name,
            open: isPanelOpen(app, module.id),
          })),
      ];

      app.tray.innerHTML = "";

      for (const item of items) {
        const button = document.createElement("button");
        button.className = `vim-tray-btn${item.open ? " vim-active" : ""}`;
        button.title = item.title;
        button.innerHTML = `<span>${escapeHtml(item.icon)}</span><span class="vim-tray-label">${escapeHtml(item.label)}</span>`;
        button.addEventListener("click", () => {
          if (isPanelOpen(app, item.id)) this.hidePanel(app, item.id);
          else this.openPanel(app, item.id);
        });
        app.tray.appendChild(button);
      }
    },

    openPanel(app, id) {
      const state = getPanelState(app, id);
      if (!state) return;

      if (id !== `${CONFIG.appId}-manager`) state.enabled = true;
      state.open = true;

      this.applyPanel(app, id);
      this.renderMaster(app);
      this.renderTray(app);
      Storage.save(app.settings);
    },

    hidePanel(app, id) {
      const state = getPanelState(app, id);
      if (!state) return;

      state.open = false;

      this.applyPanel(app, id);
      this.renderMaster(app);
      this.renderTray(app);
      Storage.save(app.settings);
    },

    setModuleEnabled(app, id, enabled) {
      const state = getPanelState(app, id);
      if (!state) return;

      state.enabled = !!enabled;
      state.open = !!enabled && !!app.settings.openScriptsAutomatically;

      this.applyPanel(app, id);
      this.renderMaster(app);
      this.renderTray(app);
      Storage.save(app.settings);
    },

    runEnabledModules(app) {
      for (const module of app.modules.values()) {
        const state = getPanelState(app, module.id);
        if (!state.enabled) continue;
        state.open = true;
        this.applyPanel(app, module.id);
      }

      this.renderMaster(app);
      this.renderTray(app);
      Storage.save(app.settings);
    },

    applyPanel(app, id) {
      const panel = app.panels.get(id);
      const state = getPanelState(app, id);
      if (!panel || !state) return;

      panel.style.width = `${state.width}px`;
      panel.style.height = `${state.height}px`;
      panel.style.right = `${state.right}px`;
      panel.style.bottom = `${state.bottom}px`;
      panel.classList.toggle("vim-open", isPanelOpen(app, id));
    },

    // createBuiltinPanel — used for built-in panels (e.g. the manager UI).
    createBuiltinPanel(app, { id, icon, title, bodyHtml, footer }) {
      if (!app.settings.panels[id]) {
        app.settings.panels[id] = {
          enabled: true,
          open:    false,
          width:   380,
          height:  460,
          right:   16,
          bottom:  58,
        };
      }
      this.createModulePanel(app, {
        id,
        icon:        icon  || '⚙️',
        name:        title || id,
        description: '',
        footer:      footer || '',
        render:      () => bodyHtml,
      });
    },

    // registerModulePanel — called by remote modules via app.ui.registerPanel(config).
    registerModulePanel(app, moduleId, config) {
      if (!app.settings.panels[moduleId]) {
        app.settings.panels[moduleId] = {
          enabled: true,
          open:    false,
          width:   config.width  || 520,
          height:  config.height || 540,
          right:   config.right  || 16,
          bottom:  config.bottom || 58,
        };
      }
      this.createModulePanel(app, {
        id:          moduleId,
        icon:        config.icon        || '🔧',
        name:        config.title       || moduleId,
        description: config.description || '',
        footer:      config.footer      || 'Drag title bar · resize from corner.',
        render:      config.render      || null,
      });
    },
  };

  function renderModuleRow(app, module) {
    const state = getPanelState(app, module.id);

    if (!state) {
      return "";
    }

    const status = !state.enabled ? "Off" : state.open ? "Open" : "In tray";
    const statusClass = state.enabled ? "vim-good" : "vim-muted";

    return `
    <div class="vim-row">
      <div class="vim-row-main">
        <div class="vim-row-title">${escapeHtml(module.icon)} ${escapeHtml(module.name)}</div>
        <div class="vim-muted">${escapeHtml(module.description)}</div>
        <div class="${statusClass}">${status}</div>
      </div>
      <label class="vim-switch-row">
        <input type="checkbox" data-module-toggle="${escapeHtml(module.id)}" ${state.enabled ? "checked" : ""} />
        <span>Enabled</span>
      </label>
    </div>
  `;
  }

  function renderPlaceholder(module) {
    return `
      <div class="vim-placeholder">
        <b>${escapeHtml(module.name)}</b><br />
        ${escapeHtml(module.description)}<br /><br />
        This module is registered, but no feature logic has been migrated into it yet.
      </div>
    `;
  }

  function getPanelState(app, id) {
    if (!app?.settings) return null;

    if (!app.settings.panels) {
      app.settings.panels = {};
    }

    const defaults = DEFAULT_SETTINGS.panels?.[id] || {
      enabled: false,
      open: false,
      width: 520,
      height: 420,
      right: 16,
      bottom: 58,
    };

    if (!app.settings.panels[id]) {
      app.settings.panels[id] = clone(defaults);
      Storage.save(app.settings);
    }

    return app.settings.panels[id];
  }

  function isPanelOpen(app, id) {
    const state = getPanelState(app, id);
    if (!state) return false;
    if (id === `${CONFIG.appId}-manager`) return !!state.open;
    return !!state.enabled && !!state.open;
  }

  function savePanelGeometry(app, id) {
    const panel = app.panels.get(id);
    const state = getPanelState(app, id);
    if (!panel || !state || !panel.classList.contains("vim-open")) return;

    const rect = panel.getBoundingClientRect();

    state.width = clamp(Math.round(rect.width), 260, Math.max(260, window.innerWidth - 20));
    state.height = clamp(Math.round(rect.height), 140, Math.max(140, window.innerHeight - 60));
    state.right = clamp(Math.round(window.innerWidth - rect.right), 0, Math.max(0, window.innerWidth - 120));
    state.bottom = clamp(Math.round(window.innerHeight - rect.bottom), 48, Math.max(48, window.innerHeight - 80));

    Storage.save(app.settings);
  }

  function makeDraggable(panel, id, app) {
    const header = panel.querySelector(".vim-header");
    if (!header) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    header.addEventListener("mousedown", (event) => {
      if (event.target.closest("button, input, label")) return;

      dragging = true;
      startX = event.clientX;
      startY = event.clientY;

      const rect = panel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;

      document.body.style.userSelect = "none";
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      panel.style.right = `${Math.max(0, startRight - dx)}px`;
      panel.style.bottom = `${Math.max(48, startBottom - dy)}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = "";
      savePanelGeometry(app, id);
    });
  }

  function makeResizable(panel, id, app) {
    let timer = null;

    const observer = new ResizeObserver(() => {
      if (!panel.classList.contains("vim-open")) return;
      clearTimeout(timer);
      timer = setTimeout(() => savePanelGeometry(app, id), 150);
    });

    observer.observe(panel);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));
  }

})();
