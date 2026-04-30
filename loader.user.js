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

})();
