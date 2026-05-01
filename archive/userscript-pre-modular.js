// ==UserScript==
// @name         VoidIdle Master Modular Base
// @namespace    voididle-master-modular-base
// @version      0.2.7
// @description  Clean modular VoidIdle userscript base with one socket core, one window manager, and module registry
// @match        https://www.voididle.com/*
// @match        https://voididle.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    "use strict";

    /**************************************************************************
     * CONFIG
     **************************************************************************/

    const CONFIG = Object.freeze({
        appId: "voididle-master-modular-base",
        storageKey: "voididle.masterModularBase.v1",
        title: "VoidIdle Scripts",
        relayUrl: "wss://voididle-combat-relay.onrender.com",
        socketMessageTypes: new Set(["fullState", "partyTick", "auraRegen", "auraXpGain"]),
    });

    const MODULE_DEFINITIONS = [
        {
            id: "dpsCoach",
            name: "DPS Coach",
            shortName: "DPS",
            icon: "🎯",
            description: "Personal and team DPS tools.",
        },
        {
            id: "statGrabber",
            name: "Stat Grabber",
            shortName: "Stats",
            icon: "📊",
            description: "Stats, gear comparison, roll quality, filters, and scoring.",
        },
        {
            id: "itemShare",
            name: "Item Share",
            shortName: "Items",
            icon: "🎁",
            description: "Item sharing tools.",
        },
        {
            id: "runePlanner",
            name: "Rune Planner",
            shortName: "Runes",
            icon: "◈",
            description: "Plan and export rune loadouts by type and tier.",
        },
        {
            id: "bossTracker",
            name: "Boss Tracker",
            shortName: "Bosses",
            icon: "👑",
            description: "Tracks world boss history, fighters, and DPS leaderboards.",
        },
        {
            id: "wsSniffer",
            name: "WS Sniffer",
            shortName: "WS",
            icon: "🛰️",
            description: "Capture WebSocket messages with filters for world boss debugging.",
        },
    ];

    const DEFAULT_SETTINGS = Object.freeze({
        openScriptsAutomatically: true,
        panels: {
            master: {
                open: false,
                width: 340,
                height: 420,
                right: 16,
                bottom: 58,
            },
            dpsCoach: {
                enabled: false,
                open: false,
                width: 580,
                height: 640,
                right: 16,
                bottom: 58,
            },
            statGrabber: {
                enabled: false,
                open: false,
                width: 520,
                height: 620,
                right: 612,
                bottom: 58,
            },
            itemShare: {
                enabled: false,
                open: false,
                width: 460,
                height: 360,
                right: 1148,
                bottom: 58,
            },
            runePlanner: {
                enabled: false,
                open: false,
                width: 720,
                height: 620,
                right: 16,
                bottom: 58,
            },
            bossTracker: {
                enabled: false,
                open: false,
                width: 760,
                height: 640,
                right: 16,
                bottom: 58,
            },
            wsSniffer: {
                enabled: false,
                open: false,
                width: 760,
                height: 640,
                right: 16,
                bottom: 58,
            },
        },
    });

    /**************************************************************************
     * APP FACTORY
     **************************************************************************/

    function createApp() {
        return {
            settings: Storage.load(),
            events: createEventBus(),
            modules: new Map(),
            panels: new Map(),
            tray: null,

            socket: SocketCore,
            relay: RelayCore,

            register(module) {
                if (!module?.id) return;
                this.modules.set(module.id, module);
            },

            start() {
                Styles.inject();

                this.socket.init(this);
                this.relay.init(this);

                WindowManager.init(this);

                for (const module of this.modules.values()) {
                    module.init?.(this);
                    WindowManager.createModulePanel(this, module);
                }

                applyStartupOpenRules(this);
                WindowManager.renderAll(this);
                Storage.save(this.settings);

                console.log("[VoidIdle Master Modular Base] Running");
            },
        };
    }

    function applyStartupOpenRules(app) {
        // Preserve saved open/tray state on reload.
        // If auto-open is OFF, enabled modules stay in tray until Run Scripts is clicked.
        // If auto-open is ON, we respect the saved state instead of forcing panels open.
        if (!app.settings.openScriptsAutomatically) {
            for (const module of app.modules.values()) {
                const panel = getPanelState(app, module.id);
                if (panel?.enabled) {
                    panel.open = false;
                }
            }
        }
    }

    /**************************************************************************
     * EVENT BUS
     **************************************************************************/

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
                    try {
                        handler(payload);
                    } catch (err) {
                        console.error(`[VoidIdle] Event handler failed for ${type}`, err);
                    }
                }
            },
        };
    }

    /**************************************************************************
     * STORAGE
     **************************************************************************/

    const Storage = {
        load() {
            try {
                const raw = localStorage.getItem(CONFIG.storageKey);
                if (!raw) return clone(DEFAULT_SETTINGS);
                return deepMerge(clone(DEFAULT_SETTINGS), JSON.parse(raw));
            } catch {
                return clone(DEFAULT_SETTINGS);
            }
        },

        save(settings) {
            try {
                localStorage.setItem(CONFIG.storageKey, JSON.stringify(settings));
            } catch (err) {
                console.warn("[VoidIdle] Could not save settings", err);
            }
        },
    };

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function deepMerge(base, incoming) {
        if (!incoming || typeof incoming !== "object") return base;

        for (const [key, value] of Object.entries(incoming)) {
            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                base[key] &&
                typeof base[key] === "object" &&
                !Array.isArray(base[key])
            ) {
                deepMerge(base[key], value);
            } else {
                base[key] = value;
            }
        }

        return base;
    }

    /**************************************************************************
     * SOCKET CORE
     **************************************************************************/

    const SocketCore = {
        init(app) {
            const NativeWebSocket = window.WebSocket;
            if (!NativeWebSocket || NativeWebSocket.__voididleMasterHooked) return;

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
            HookedWebSocket.__voididleMasterHooked = true;

            window.WebSocket = HookedWebSocket;
        },
    };

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

    /**************************************************************************
     * STYLES
     **************************************************************************/

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

    /**************************************************************************
     * WINDOW MANAGER
     **************************************************************************/

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
            this.createPanel(app, {
                id: "master",
                icon: "🧩",
                title: CONFIG.title,
                bodyHtml: "",
                footer: "Hide sends the whole window to the tray. Modules are managed here.",
            });
        },

        createModulePanel(app, module) {
            this.createPanel(app, {
                id: module.id,
                icon: module.icon,
                title: module.name,
                bodyHtml: module.render?.(app) || renderPlaceholder(module),
                footer: module.footer || "Drag the title bar. Resize from the lower-right corner.",
            });
        },

        createPanel(app, { id, icon, title, bodyHtml, footer }) {
            if (app.panels.has(id)) return app.panels.get(id);

            const panel = document.createElement("div");
            panel.id = `${CONFIG.appId}-${id}`;
            panel.className = "vim-panel";
            panel.innerHTML = `
        <div class="vim-header">
          <div class="vim-title">${escapeHtml(icon)} ${escapeHtml(title)}</div>
          <div class="vim-actions">
            <button type="button" class="vim-btn" data-action="hide">Hide</button>
          </div>
        </div>
        <div class="vim-body">${bodyHtml}</div>
        <div class="vim-footer">${escapeHtml(footer)}</div>
      `;

            document.documentElement.appendChild(panel);
            app.panels.set(id, panel);

            panel.querySelector('[data-action="hide"]').addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.hidePanel(app, id);
            });

            makeDraggable(panel, id, app);
            makeResizable(panel, id, app);
            this.applyPanel(app, id);

            return panel;
        },
        renderAll(app) {
            this.renderMaster(app);
            this.renderTray(app);
            this.applyPanel(app, "master");

            for (const module of app.modules.values()) {
                this.applyPanel(app, module.id);
            }
        },

        renderMaster(app) {
            const panel = app.panels.get("master");
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
                    id: "master",
                    icon: "🧩",
                    label: "Scripts",
                    title: "VoidIdle Scripts Master",
                    open: isPanelOpen(app, "master"),
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

            if (id !== "master") state.enabled = true;
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
        if (id === "master") return !!state.open;
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

    /**************************************************************************
     * MODULES
     **************************************************************************/

    function createDpsCoachModule(definition) {
        const config = {
            rollingWindowMs: 10_000,
            fightTimeoutMs: 8_000,
            maxLogs: 250,
            maxAbilityEvents: 200,
        };

        const state = {
            activeTab: "summary",
            updateQueued: false,
            relayHelloSent: false,

            playerName: "You",
            currentWeaponType: "",
            weaponLevel: 0,
            weaponXp: 0,
            activeAura: "",
            zoneId: "",
            lastSocketZoneAt: 0,
            lastDomZoneAt: 0,
            tier: null,

            fightStartedAt: 0,
            lastCombatAt: 0,
            inCombat: false,

            hp: 0,
            maxHp: 0,
            mana: 0,
            maxMana: 0,
            attackSpeed: 0,

            totalDamage: 0,
            autoDamage: 0,
            abilityDamage: 0,
            totalHealing: 0,
            totalManaSpent: 0,
            totalManaRegen: 0,
            totalManaObservedSpent: 0,
            totalManaEstimatedSpent: 0,
            pendingManaSpentEstimate: 0,
            sustainedManaLastAt: 0,

            deaths: 0,
            wasDead: false,

            hits: 0,
            crits: 0,
            misses: 0,

            kills: 0,
            xp: 0,
            goldEarned: 0,
            goldBalance: 0,
            spiritShards: 0,

            rollingDamageEvents: [],
            logs: [],

            abilities: new Map(),
            abilityCooldowns: {},
            abilityCdTotals: {},
            abilityManaCosts: {},
            abilityMeta: {},
            activeAbilityIds: [],

            buffs: [],
            previousBuffKeys: new Set(),
            partyAuraBuffs: {},
            activeBuffs: [],
            activeImbue: [],
            enemyDebuffs: [],

            previousCooldowns: {},
            previousMana: null,
            previousHp: null,
            previousPlayerXp: null,
            previousPlayerGold: null,
            previousSpiritShards: null,

            zoneStats: {},
            lastZoneStatsKey: "",
            zoneStatsLastTickAt: 0,

            team: {
                members: new Map(),
                lastSnapshotAt: 0,
            },
        };

        let appRef = null;

        const DPS_RELAY_STORAGE_KEY = "voididle.dpsCoach.relayRoomKey";
        const DPS_RELAY_SESSION_KEY = "voididle.dpsCoach.relaySession.v1";

        function loadRelaySession() {
            try {
                const raw = localStorage.getItem(DPS_RELAY_SESSION_KEY);

                if (raw) {
                    const parsed = JSON.parse(raw);

                    return {
                        roomKey: String(parsed?.roomKey || "").trim(),
                        shouldReconnect: parsed?.shouldReconnect === true,
                    };
                }
            } catch { }

            try {
                const legacyRoomKey = localStorage.getItem(DPS_RELAY_STORAGE_KEY) || "";

                return {
                    roomKey: String(legacyRoomKey || "").trim(),
                    shouldReconnect: false,
                };
            } catch {
                return {
                    roomKey: "",
                    shouldReconnect: false,
                };
            }
        }

        function saveRelaySession(next = {}) {
            const current = loadRelaySession();

            const session = {
                roomKey: String(
                    next.roomKey !== undefined
                        ? next.roomKey
                        : current.roomKey
                ).trim(),
                shouldReconnect:
                    next.shouldReconnect !== undefined
                        ? next.shouldReconnect === true
                        : current.shouldReconnect === true,
            };

            try {
                localStorage.setItem(DPS_RELAY_SESSION_KEY, JSON.stringify(session));

                if (session.roomKey) {
                    localStorage.setItem(DPS_RELAY_STORAGE_KEY, session.roomKey);
                } else {
                    localStorage.removeItem(DPS_RELAY_STORAGE_KEY);
                }
            } catch { }

            return session;
        }

        function loadSavedRelayRoomKey() {
            return loadRelaySession().roomKey;
        }

        function saveRelayRoomKey(roomKey) {
            const cleanRoomKey = String(roomKey || "").trim();

            saveRelaySession({
                roomKey: cleanRoomKey,
            });
        }

        function setRelayReconnectWanted(wanted) {
            const roomKey = appRef?.relay?.state?.roomKey || loadSavedRelayRoomKey();

            saveRelaySession({
                roomKey,
                shouldReconnect: wanted === true,
            });
        }

        function syncSavedRelayRoomKeyToRelay(app) {
            if (!app?.relay?.state) return;

            const saved = loadRelaySession();

            if (saved.roomKey && !app.relay.state.roomKey) {
                app.relay.state.roomKey = saved.roomKey;
            }
        }

        function reconnectRelayIfWanted(app) {
            if (!app?.relay) return;

            const saved = loadRelaySession();

            if (!saved.shouldReconnect || !saved.roomKey) return;
            if (app.relay.state.connected || app.relay.state.connecting) return;

            setTimeout(() => {
                if (!app?.relay) return;
                if (app.relay.state.connected || app.relay.state.connecting) return;

                app.relay.state.roomKey = saved.roomKey;
                app.relay.connect(saved.roomKey);
            }, 350);
        }

        const relayDebug = {
            enabled: false,
            logs: [],
            maxLogs: 80,
            installed: false,
            originalEmit: null,
            originalSend: null,
        };

        /******************************************************************
         * UTILITIES
         ******************************************************************/

        function now() {
            return Date.now();
        }

        function clean(value) {
            return String(value ?? "").replace(/\s+/g, " ").trim();
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

        function formatNumber(value) {
            const n = Number(value || 0);

            if (!Number.isFinite(n)) return "0";
            if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
            if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
            if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;

            return Math.round(n).toLocaleString();
        }

        function formatDuration(seconds) {
            const total = Math.max(0, Math.floor(seconds || 0));
            const minutes = Math.floor(total / 60);
            const secs = total % 60;
            return `${minutes}:${String(secs).padStart(2, "0")}`;
        }

        function formatTime(ts) {
            return new Date(ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        }

        const DPS_ZONE_STATS_STORAGE_KEY = "voididle.dpsCoach.zoneStats.v4.session";
        // v4 intentionally does not import older zone history. Older builds stored
        // lifetime totals, which made the Zones tab look wildly different from
        // the Summary tab after long play sessions.
        const MAX_ZONE_STATS = 80;

        const ZONE_ENEMY_ID_MAP = Object.freeze({
            "ancient-grove-spirit": "Sea of Swaying Bamboo",
            "bamboo-sail-spirit": "Sea of Swaying Bamboo",
            "swaying-bamboo-spirit": "Sea of Swaying Bamboo",

            "peak-specter": "Frost Peak Hermitage",
            "frozen-hermit": "Frost Peak Hermitage",
            "glacial-wraith": "Frost Peak Hermitage",

            "terracotta-warrior": "Desert of Forgotten Kings",
            "desert-scarab": "Desert of Forgotten Kings",
            "forgotten-king": "Desert of Forgotten Kings"
        });

        const ZONE_ENEMY_HINTS = [
            { zone: "Bamboo Thicket", patterns: ["bamboo thicket", "thicket"] },
            { zone: "Jade River Delta", patterns: ["jade river", "river delta", "delta"] },
            { zone: "Crimson Petal Grove", patterns: ["crimson petal", "petal grove"] },
            { zone: "Iron Gate Pass", patterns: ["iron gate", "gate pass"] },
            { zone: "Ascending Mist Temple", patterns: ["ascending mist", "mist temple"] },
            { zone: "Sunken Lotus Marshes", patterns: ["sunken lotus", "lotus marsh", "marshes"] },
            { zone: "Shattered Sky Ridge", patterns: ["shattered sky", "sky ridge"] },
            { zone: "Desert of Forgotten Kings", patterns: ["desert of forgotten kings", "terracotta", "scarab", "mummy", "pharaoh"] },
            { zone: "Sea of Swaying Bamboo", patterns: ["sea of swaying bamboo", "ancient grove spirit"] },
            { zone: "Frost Peak Hermitage", patterns: ["frost peak", "peak specter", "frozen hermit", "glacial wraith"] },
            { zone: "Celestial Dragon Spire", patterns: ["celestial dragon", "dragon spire"] },
            { zone: "Palace of Jade Emperor", patterns: ["jade emperor", "palace of jade"] },
            { zone: "Abyssal Demon Pit", patterns: ["abyssal demon", "demon pit"] },
            { zone: "Void Nexus", patterns: ["void nexus"] },
            { zone: "Immortal Battlefield", patterns: ["immortal battlefield"] },
            { zone: "Primordial Chaos Wastes", patterns: ["primordial chaos", "chaos wastes"] },
            { zone: "Throne of the Dao", patterns: ["throne of the dao"] },
        ];

        function titleCaseZoneSlug(value) {
            return String(value || "")
                .replace(/^Party in\s+/i, "")
                .replace(/[-_]+/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .replace(/\b\w/g, (char) => char.toUpperCase());
        }

        function normalizeZoneName(value) {
            const raw = String(value || "")
                .replace(/^Party in\s+/i, "")
                .replace(/\s+/g, " ")
                .trim();

            if (!raw) return "Unknown Zone";
            if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(raw)) return titleCaseZoneSlug(raw);

            return raw;
        }

        function getZoneStorageKey(zoneName) {
            return normalizeZoneName(zoneName)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "") || "unknown-zone";
        }

        function getZoneKeyFor(zoneName, tier = "") {
            const base = getZoneStorageKey(zoneName);
            const cleanTier = String(tier || "").replace(/^T/i, "").trim();
            return cleanTier ? `${base}|T${cleanTier}` : base;
        }

        function parseZoneTier(value) {
            const text = String(value || "");
            const match = text.match(/(?:\bD|\bT|Tier\s*)(\d+)/i);
            return match ? String(match[1]) : "";
        }

        function detectCurrentZoneNameFromDom() {
            const selectors = [
                ".pb-zone",
                ".zone-title",
                ".zone-name",
                ".area-title",
                ".area-name",
                ".combat-zone-title",
                ".world-zone-name",
                "[data-zone-name]"
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                const text = clean(el?.textContent || el?.getAttribute?.("data-zone-name") || "");

                if (text && !/^[-—]$/.test(text)) {
                    return normalizeZoneName(text);
                }
            }

            const headerCandidates = [...document.querySelectorAll("h1, h2, .title, .heading")]
                .map((el) => clean(el.textContent))
                .filter((text) => text && /\b(Desert|Temple|Ridge|Thicket|Delta|Grove|Pass|Marsh|Bamboo|Peak|Spire|Palace|Pit|Nexus|Battlefield|Wastes|Throne)\b/i.test(text));

            if (headerCandidates[0]) {
                return normalizeZoneName(headerCandidates[0]);
            }

            return "";
        }

        function detectCurrentZoneTierFromDom() {
            const selectors = [
                ".zone-tier",
                ".zone-difficulty",
                ".difficulty-badge",
                ".pb-zone-tier"
            ];

            for (const selector of selectors) {
                const text = clean(document.querySelector(selector)?.textContent || "");
                const tier = parseZoneTier(text);
                if (tier) return tier;
            }

            const zoneHeader = [...document.querySelectorAll(".pb-zone, h1, h2, .zone-title, .zone-name, .area-title")]
                .map((el) => clean(el.textContent))
                .join(" ");

            return parseZoneTier(zoneHeader);
        }

        function syncCurrentZoneFromDom() {
            const domZone = detectCurrentZoneNameFromDom();
            const domTier = detectCurrentZoneTierFromDom();

            if (domZone && domZone !== "Unknown Zone") {
                const socketZoneIsFresh = state.lastSocketZoneAt && now() - state.lastSocketZoneAt < 3500;

                if (!socketZoneIsFresh || !state.zoneId || state.zoneId === "Unknown Zone") {
                    state.zoneId = domZone;
                    state.lastDomZoneAt = now();
                }
            }

            if (domTier) {
                state.tier = domTier;
            }
        }

        function inferZoneNameFromPartyTick(msg) {
            const explicitZoneRaw = msg?.lastZoneId || msg?.zoneId || msg?.zone || msg?.areaName || "";
            const explicitZone = normalizeZoneName(explicitZoneRaw);

            if (explicitZone && explicitZone !== "Unknown Zone") {
                return explicitZone;
            }

            const enemies = Array.isArray(msg?.enemies) ? msg.enemies : [];

            for (const enemy of enemies) {
                const id = String(enemy?.id || "")
                    .toLowerCase()
                    .replace(/[^a-z0-9-]+/g, "-")
                    .replace(/^-+|-+$/g, "");

                if (id && ZONE_ENEMY_ID_MAP[id]) {
                    return ZONE_ENEMY_ID_MAP[id];
                }
            }

            const enemyText = enemies
                .map((enemy) => `${enemy?.id || ""} ${enemy?.name || ""}`)
                .join(" ")
                .replace(/T\d+\s*[—-]\s*/gi, " ")
                .replace(/[-_]+/g, " ")
                .toLowerCase();

            if (!enemyText.trim()) return "";

            for (const hint of ZONE_ENEMY_HINTS) {
                if (hint.patterns.some((pattern) => enemyText.includes(String(pattern).toLowerCase()))) {
                    return hint.zone;
                }
            }

            return "";
        }

        function syncCurrentZoneFromSocketMessage(msg) {
            const socketZone = inferZoneNameFromPartyTick(msg);

            if (socketZone && socketZone !== "Unknown Zone") {
                state.zoneId = normalizeZoneName(socketZone);
                state.lastSocketZoneAt = now();
                return true;
            }

            return false;
        }

        function syncCurrentZoneFromBestSource(msg) {
            if (!syncCurrentZoneFromSocketMessage(msg)) {
                syncCurrentZoneFromDom();
            } else {
                const domTier = detectCurrentZoneTierFromDom();
                if (domTier) state.tier = domTier;
            }
        }

        function getCurrentZoneName() {
            const socketZoneIsFresh = state.lastSocketZoneAt && now() - state.lastSocketZoneAt < 6000;

            if (socketZoneIsFresh && state.zoneId && state.zoneId !== "Unknown Zone") {
                return normalizeZoneName(state.zoneId);
            }

            const domZone = detectCurrentZoneNameFromDom();
            if (domZone && domZone !== "Unknown Zone") return domZone;

            return normalizeZoneName(state.zoneId || "Unknown Zone");
        }

        function getCurrentZoneTier() {
            const domTier = detectCurrentZoneTierFromDom();
            if (domTier) return domTier;

            return state.tier == null || state.tier === "" ? "" : String(state.tier);
        }

        function getCurrentZoneKey() {
            return getZoneKeyFor(getCurrentZoneName(), getCurrentZoneTier());
        }

        const ZONE_SUMMARY_METRICS = Object.freeze([
            "xp",
            "gold",
            "shards",
            "kills",
            "deaths",
            "hits",
            "misses",
            "attempts",
            "damage",
            "manaSpent",
            "manaRegen",
        ]);

        function getDpsCoachSummaryTotals() {
            return {
                xp: Number(state.xp || 0),
                gold: Number(state.goldEarned || 0),
                shards: Number(state.spiritShards || 0),
                kills: Number(state.kills || 0),
                deaths: Number(state.deaths || 0),
                hits: Number(state.hits || 0),
                misses: Number(state.misses || 0),
                attempts: Number(state.hits || 0) + Number(state.misses || 0),
                damage: Number(state.totalDamage || 0),
                manaSpent: Number(state.totalManaSpent || 0),
                manaRegen: Number(state.totalManaRegen || 0),
            };
        }

        function createZeroZoneMetrics() {
            const out = {};

            for (const key of ZONE_SUMMARY_METRICS) {
                out[key] = 0;
            }

            return out;
        }

        function cloneZoneMetrics(source = {}) {
            const out = {};

            for (const key of ZONE_SUMMARY_METRICS) {
                out[key] = Number(source?.[key] || 0);
            }

            return out;
        }

        function createEmptyZoneRecord(zoneName = "Unknown Zone", tier = "") {
            const cleanZoneName = normalizeZoneName(zoneName);
            const ts = now();
            const base = getDpsCoachSummaryTotals();

            return {
                key: getZoneKeyFor(cleanZoneName, tier),
                zoneName: cleanZoneName,
                tier: String(tier || ""),
                firstSeenAt: ts,
                lastSeenAt: ts,
                sessions: 0,
                activeMs: 0,
                visitStartedAt: 0,
                base: cloneZoneMetrics(base),
                visitStart: createZeroZoneMetrics(),

                xp: 0,
                gold: 0,
                shards: 0,
                kills: 0,
                deaths: 0,

                hits: 0,
                misses: 0,
                attempts: 0,
                damage: 0,
                manaSpent: 0,
                manaRegen: 0,
            };
        }

        function sanitizeZoneRecord(raw, fallbackKey = "Unknown Zone") {
            const fallbackText = String(fallbackKey || "Unknown Zone").replace(/\|T\d+$/i, "");
            const zoneName = normalizeZoneName(raw?.zoneName || fallbackText || "Unknown Zone");
            const tier = String(raw?.tier || parseZoneTier(fallbackKey) || "");
            const record = createEmptyZoneRecord(zoneName, tier);

            record.firstSeenAt = Number(raw?.firstSeenAt || record.firstSeenAt);
            record.lastSeenAt = Number(raw?.lastSeenAt || record.lastSeenAt);
            record.sessions = Number(raw?.sessions || 0);
            record.activeMs = Number(raw?.activeMs || raw?.combatMs || raw?.timeMs || 0);
            record.visitStartedAt = Number(raw?.visitStartedAt || 0);

            record.xp = Number(raw?.xp || 0);
            record.gold = Number(raw?.gold || 0);
            record.shards = Number(raw?.shards || 0);
            record.kills = Number(raw?.kills || 0);
            record.deaths = Number(raw?.deaths || 0);

            record.hits = Number(raw?.hits || 0);
            record.misses = Number(raw?.misses || 0);
            record.attempts = Number(raw?.attempts || (record.hits + record.misses) || 0);
            record.damage = Number(raw?.damage || 0);
            record.manaSpent = Number(raw?.manaSpent || 0);
            record.manaRegen = Number(raw?.manaRegen || 0);

            record.base = cloneZoneMetrics(raw?.base || getDpsCoachSummaryTotals());
            record.visitStart = cloneZoneMetrics(raw?.visitStart || record);

            return record;
        }

        function mergeZoneRecords(base, incoming) {
            if (!base) return incoming;
            if (!incoming) return base;

            // There should only be one record per key. When duplicates appear from old
            // storage, keep the newest live visit instead of summing and inflating rates.
            return Number(incoming.lastSeenAt || 0) >= Number(base.lastSeenAt || 0)
                ? incoming
                : base;
        }

        function loadZoneStats() {
            try {
                const raw = localStorage.getItem(DPS_ZONE_STATS_STORAGE_KEY);
                if (!raw) return {};

                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

                const loaded = {};

                for (const [key, value] of Object.entries(parsed)) {
                    const record = sanitizeZoneRecord(value, key);
                    record.key = getZoneKeyFor(record.zoneName, record.tier);
                    loaded[record.key] = mergeZoneRecords(loaded[record.key], record);
                }

                return loaded;
            } catch {
                return {};
            }
        }

        function saveZoneStats() {
            try {
                const records = Object.values(state.zoneStats || {})
                    .filter((record) => record && record.key)
                    .sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
                    .slice(0, MAX_ZONE_STATS);

                const out = {};
                for (const record of records) {
                    const cleanRecord = sanitizeZoneRecord(record, record.key);
                    cleanRecord.key = getZoneKeyFor(cleanRecord.zoneName, cleanRecord.tier);
                    out[cleanRecord.key] = mergeZoneRecords(out[cleanRecord.key], cleanRecord);
                }

                state.zoneStats = out;
                localStorage.setItem(DPS_ZONE_STATS_STORAGE_KEY, JSON.stringify(out));
            } catch (err) {
                console.warn("[VoidIdle DPS Coach] Could not save zone stats", err);
            }
        }

        function beginZoneVisit(record, totals = getDpsCoachSummaryTotals()) {
            record.base = cloneZoneMetrics(totals);
            record.visitStart = cloneZoneMetrics(record);
            record.visitStartedAt = now();
        }

        function syncZoneRecordFromSummary(record, totals = getDpsCoachSummaryTotals()) {
            if (!record) return null;

            if (!record.base || !record.visitStart) {
                beginZoneVisit(record, totals);
            }

            const base = cloneZoneMetrics(record.base);
            const visitStart = cloneZoneMetrics(record.visitStart);

            for (const key of ZONE_SUMMARY_METRICS) {
                const delta = Math.max(0, Number(totals[key] || 0) - Number(base[key] || 0));
                record[key] = Number(visitStart[key] || 0) + delta;
            }

            // attempts is derived from the same hit/miss counters as Summary.
            record.attempts = Number(record.hits || 0) + Number(record.misses || 0);
            record.lastSeenAt = now();

            return record;
        }

        function touchCurrentZone(trackTime = false) {
            const zoneName = getCurrentZoneName();
            if (!zoneName || zoneName === "Unknown Zone") return null;

            const tier = getCurrentZoneTier();
            const key = getCurrentZoneKey();
            const existing = state.zoneStats[key] || createEmptyZoneRecord(zoneName, tier);
            const ts = now();
            const totals = getDpsCoachSummaryTotals();
            const previousKey = state.lastZoneStatsKey || "";
            const changedZone = !previousKey || previousKey !== key;

            existing.key = key;
            existing.zoneName = zoneName;
            existing.tier = existing.tier || tier;
            existing.lastSeenAt = ts;
            existing.activeMs = Number(existing.activeMs || 0);

            if (changedZone) {
                existing.sessions = Number(existing.sessions || 0) + 1;
                state.lastZoneStatsKey = key;
                state.zoneStatsLastTickAt = ts;
                beginZoneVisit(existing, totals);
            } else if (trackTime) {
                const previousTickAt = Number(state.zoneStatsLastTickAt || 0);
                const elapsedMs = previousTickAt ? ts - previousTickAt : 0;

                if (previousTickAt && elapsedMs > 0 && elapsedMs <= 15_000) {
                    existing.activeMs += elapsedMs;
                }

                state.zoneStatsLastTickAt = ts;
            }

            syncZoneRecordFromSummary(existing, totals);
            state.zoneStats[key] = existing;
            saveZoneStats();

            return existing;
        }

        function addZoneStats() {
            // Keep Zones as a per-zone delta view of the exact same counters used by
            // Summary. Callers still invoke addZoneStats after they update Summary state,
            // so syncing here gives the Zone tab the same values without a second parser.
            const record = touchCurrentZone();
            if (!record) return;

            syncZoneRecordFromSummary(record);
            saveZoneStats();
        }

        function getZoneAccuracy(record) {
            const attempts = Number(record?.attempts || 0);
            return attempts ? (Number(record.hits || 0) / attempts) * 100 : 0;
        }

        function zoneRecordHasStats(record) {
            return !!(
                Number(record?.xp || 0) ||
                Number(record?.gold || 0) ||
                Number(record?.shards || 0) ||
                Number(record?.kills || 0) ||
                Number(record?.deaths || 0) ||
                Number(record?.hits || 0) ||
                Number(record?.misses || 0)
            );
        }

        function getZoneRows(includeCurrent = true) {
            const currentKey = state.lastZoneStatsKey || getCurrentZoneKey();

            return Object.values(state.zoneStats || {})
                .filter((record) => zoneRecordHasStats(record) || (includeCurrent && record.key === currentKey))
                .sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0));
        }

        function getZoneHours(record) {
            return Math.max(0, Number(record?.activeMs || 0) / 3_600_000);
        }

        function getZoneRate(record, key) {
            const hours = getZoneHours(record);
            return hours > 0 ? Number(record?.[key] || 0) / hours : 0;
        }

        function formatZoneTrackedTime(record) {
            const totalSeconds = Math.max(0, Math.floor(Number(record?.activeMs || 0) / 1000));
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
            if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
            return `${seconds}s`;
        }

        function formatZoneNameForDisplay(record) {
            const name = normalizeZoneName(record?.zoneName || "Unknown Zone");
            return record?.tier ? `${name} T${record.tier}` : name;
        }

        function pct(value, decimals = 1) {
            return `${Number(value || 0).toFixed(decimals)}%`;
        }

        function getFightSeconds() {
            if (!state.fightStartedAt) return 0;

            const end = state.inCombat ? now() : state.lastCombatAt || now();
            return Math.max(1, (end - state.fightStartedAt) / 1000);
        }

        function markCombat(ts = now()) {
            if (!state.fightStartedAt) state.fightStartedAt = ts;
            state.lastCombatAt = ts;
            state.inCombat = true;
        }

        function pruneRollingEvents(ts = now()) {
            const cutoff = ts - config.rollingWindowMs;
            state.rollingDamageEvents = state.rollingDamageEvents.filter((event) => event.ts >= cutoff);
        }

        function addLog(type, text, data = {}) {
            state.logs.unshift({
                id: `${now()}-${Math.random().toString(16).slice(2)}`,
                ts: now(),
                time: formatTime(now()),
                type,
                text: clean(text),
                ...data,
            });

            if (state.logs.length > config.maxLogs) {
                state.logs.length = config.maxLogs;
            }
        }

        function getAbilityRecord(abilityId, fallbackName = "Unknown Ability") {
            const id = abilityId || fallbackName || "unknown";

            if (!state.abilities.has(id)) {
                state.abilities.set(id, {
                    id,
                    name: fallbackName || id,
                    icon: "",
                    casts: 0,
                    damage: 0,
                    healing: 0,
                    hits: 0,
                    crits: 0,
                    targetsHit: 0,
                    lastCastAt: 0,
                    events: [],
                });
            }

            return state.abilities.get(id);
        }

        /******************************************************************
         * RELAY DEBUGGER
         ******************************************************************/

        function safeRelayJson(value) {
            try {
                return JSON.stringify(value, null, 2);
            } catch {
                return String(value);
            }
        }

        function addRelayDebugLog(direction, eventName, payload) {
            if (!relayDebug.enabled && direction !== "DEBUG") return;

            relayDebug.logs.unshift({
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                ts: Date.now(),
                time: formatTime(Date.now()),
                direction,
                eventName,
                payload,
                json: safeRelayJson(payload),
            });

            if (relayDebug.logs.length > relayDebug.maxLogs) {
                relayDebug.logs.length = relayDebug.maxLogs;
            }
        }

        function installRelayDebugger(app) {
            if (!app || relayDebug.installed) return;

            relayDebug.installed = true;

            if (app.events && typeof app.events.emit === "function") {
                relayDebug.originalEmit = app.events.emit.bind(app.events);

                app.events.emit = (eventName, payload) => {
                    if (String(eventName).startsWith("relay:raw")) {
                        addRelayDebugLog("RAW", eventName, payload);
                    } else if (String(eventName).startsWith("relay:")) {
                        addRelayDebugLog("IN", eventName, payload);
                    }

                    return relayDebug.originalEmit(eventName, payload);
                };
            }

            if (app.relay && typeof app.relay.send === "function") {
                relayDebug.originalSend = app.relay.send.bind(app.relay);

                app.relay.send = (payload) => {
                    addRelayDebugLog("OUT", payload?.type || "unknown", payload);
                    return relayDebug.originalSend(payload);
                };
            }
        }

        function renderRelayDebugPanel() {
            if (!relayDebug.enabled) return "";

            return `
      <div class="dps-section" data-relay-debug-panel>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div class="dps-section-title" style="margin-bottom:0;">Relay Debugger</div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="vim-btn" data-relay-debug-copy>Copy Debug</button>
            <button type="button" class="vim-btn" data-relay-debug-clear>Clear</button>
          </div>
        </div>

        <div class="dps-muted" style="margin-top:6px;">
          Debug records relay messages seen by this browser while enabled.
        </div>

        <div style="margin-top:8px;max-height:260px;overflow:auto;border:1px solid rgba(255,255,255,0.08);border-radius:8px;">
          ${relayDebug.logs.length
                    ? relayDebug.logs.map((entry) => `
                <div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;">
                    <div>
                      <span class="${entry.direction === "OUT" ? "dps-purple" : entry.direction === "DEBUG" ? "dps-warn" : "dps-blue"}">${escapeHtml(entry.direction)}</span>
                      <span class="dps-good">${escapeHtml(entry.eventName)}</span>
                    </div>
                    <span class="dps-muted">${escapeHtml(entry.time)}</span>
                  </div>
                  <pre style="
                    margin:0;
                    white-space:pre-wrap;
                    word-break:break-word;
                    color:rgba(229,231,235,0.78);
                    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                    font-size:11px;
                    line-height:1.35;
                  ">${escapeHtml(entry.json)}</pre>
                </div>
              `).join("")
                    : `<div class="dps-muted" style="padding:8px;">No relay messages captured yet.</div>`
                }
        </div>
      </div>
    `;
        }

        async function copyRelayDebug() {
            const text = relayDebug.logs.map((entry) => {
                return [
                    `[${entry.time}] ${entry.direction} ${entry.eventName}`,
                    entry.json,
                ].join("\n");
            }).join("\n\n");

            try {
                await navigator.clipboard.writeText(text || "No relay debug logs.");
                return true;
            } catch {
                console.log(text || "No relay debug logs.");
                alert("Could not copy automatically. Relay debug logs were printed to console.");
                return false;
            }
        }

        /******************************************************************
         * MESSAGE HANDLERS
         ******************************************************************/

        function handleFullState(msg) {
            state.currentWeaponType = msg.currentWeaponType || msg.weaponSkill?.weaponType || state.currentWeaponType;
            if (msg.weaponSkill?.level != null) state.weaponLevel = Number(msg.weaponSkill.level || 0);
            if (msg.weaponSkill?.xp != null) state.weaponXp = Number(msg.weaponSkill.xp || 0);
            state.activeAura = msg.activeAura || state.activeAura;
            syncCurrentZoneFromBestSource(msg);
            touchCurrentZone(true);

            if (msg.player) {
                state.hp = Number(msg.player.hp || state.hp || 0);
                state.maxHp = Number(msg.player.maxHp || state.maxHp || 0);
                state.mana = Number(msg.player.mana || state.mana || 0);
                state.maxMana = Number(msg.player.maxMana || state.maxMana || 0);
                state.goldBalance = Number(msg.player.gold || state.goldBalance || 0);
                state.playerName = msg.player.username || msg.player.name || state.playerName;
            }

            state.activeAbilityIds = Array.isArray(msg.activeAbilityIds)
                ? msg.activeAbilityIds.slice()
                : state.activeAbilityIds;

            state.abilityCdTotals = msg.abilityCdTotals || state.abilityCdTotals;
            state.abilityMeta = msg.abilityMeta || state.abilityMeta;
            state.partyAuraBuffs = msg.partyAuraBuffs || state.partyAuraBuffs;
            state.activeBuffs = Array.isArray(msg.activeBuffs) ? msg.activeBuffs : state.activeBuffs;
            state.activeImbue = Array.isArray(msg.activeImbue) ? msg.activeImbue : state.activeImbue;

            for (const id of state.activeAbilityIds) {
                const meta = state.abilityMeta[id] || {};
                const record = getAbilityRecord(id, abilityNameFromId(id));
                record.description = meta.desc || record.description || "";
                record.manaCost = Number(meta.manaCost || record.manaCost || 0);
                record.cooldownTotal = Number(meta.cdMs || state.abilityCdTotals[id] || record.cooldownTotal || 0);
            }

            sendRelayHelloIfReady();
        }

        function handlePartyTick(msg) {
            const ts = now();

            state.tier = msg.tier ?? state.tier;
            syncCurrentZoneFromBestSource(msg);
            touchCurrentZone(true);

            const selfMember = getSelfPartyMember(msg);

            state.hp = Number((selfMember?.hp ?? msg.hp) || 0);
            state.maxHp = Number((selfMember?.maxHp ?? msg.maxHp) || 0);
            state.mana = Number((selfMember?.mana ?? msg.mana) || 0);
            state.maxMana = Number((selfMember?.maxMana ?? msg.maxMana) || 0);
            state.attackSpeed = Number((selfMember?.attackSpeed ?? msg.attackSpeed) || state.attackSpeed || 0);

            if (msg.weaponSkill?.weaponType) {
                state.currentWeaponType = msg.weaponSkill.weaponType;
            }
            if (msg.weaponSkill?.level != null) state.weaponLevel = Number(msg.weaponSkill.level || state.weaponLevel || 0);
            if (msg.weaponSkill?.xp != null) state.weaponXp = Number(msg.weaponSkill.xp || state.weaponXp || 0);

            state.abilityCooldowns = msg.abilityCooldowns || state.abilityCooldowns;
            state.abilityCdTotals = msg.abilityCdTotals || state.abilityCdTotals;
            state.abilityManaCosts = msg.abilityManaCosts || state.abilityManaCosts;
            state.buffs = Array.isArray(msg.abilityBuffs) ? msg.abilityBuffs : state.buffs;

            detectBuffTriggeredAbilities(ts);

            state.activeBuffs = Array.isArray(msg.activeBuffs) ? msg.activeBuffs : state.activeBuffs;
            state.partyAuraBuffs = msg.partyAuraBuffs || state.partyAuraBuffs;
            state.activeImbue = Array.isArray(msg.activeImbue) ? msg.activeImbue : state.activeImbue;

            updateSustainedManaDrain(ts);

            detectSelfNameFromParty(msg);
            detectEnemyDebuffs(msg);

            handleAutoAttack(msg, ts);

            const firedAbilityIds = handleAbilitiesFired(msg, ts);

            inferAbilityCastsFromCooldowns(msg, ts, firedAbilityIds);
            handleZoneResourceCounters(msg, ts);
            handleKillRewards(msg, ts);
            handleResourceDiffs();

            state.previousCooldowns = { ...state.abilityCooldowns };
            state.previousMana = state.mana;
            state.previousHp = state.hp;

            pruneRollingEvents(ts);
            sendTeamSnapshot();
        }

        function getSelfPartyMember(msg) {
            if (!Array.isArray(msg?.partyMemberStates)) return null;

            const currentName = clean(state.playerName || "");
            if (currentName && !isPlaceholderPlayerName(currentName)) {
                const byName = msg.partyMemberStates.find((member) => clean(member?.username) === currentName);
                if (byName) return byName;
            }

            const topAttackAt = Number(msg.attackAt || 0);
            const topMaxHp = Number(msg.maxHp || 0);
            const topMaxMana = Number(msg.maxMana || 0);
            const topAttackSpeed = Number(msg.attackSpeed || 0);

            return msg.partyMemberStates.find((member) => {
                return (
                    Number(member.maxHp || 0) === topMaxHp &&
                    Number(member.maxMana || 0) === topMaxMana &&
                    Math.abs(Number(member.attackSpeed || 0) - topAttackSpeed) <= 5 &&
                    (!topAttackAt || Math.abs(Number(member.attackAt || 0) - topAttackAt) <= 250)
                );
            }) || null;
        }

        function detectSelfNameFromParty(msg) {
            const self = getSelfPartyMember(msg);

            if (self?.username) {
                state.playerName = self.username;
                sendRelayHelloIfReady();
            }
        }

        function detectEnemyDebuffs(msg) {
            const debuffs = [];

            if (Array.isArray(msg.enemies)) {
                for (const enemy of msg.enemies) {
                    for (const debuff of enemy.debuffs || []) {
                        debuffs.push({
                            enemy: enemy.name || enemy.id || "Enemy",
                            type: debuff.type || "debuff",
                            value: debuff.value,
                            expiresAt: debuff.expiresAt,
                        });
                    }
                }
            }

            state.enemyDebuffs = debuffs;
        }

        function handleAutoAttack(msg, ts) {
            const damage = Number(msg.dmgToEnemy || 0);
            const hit = msg.playerHit;
            const crit = Boolean(msg.playerCrit);

            if (damage > 0) {
                markCombat(ts);

                state.totalDamage += damage;
                state.autoDamage += damage;
                state.hits += 1;
                addZoneStats({ hits: 1, attempts: 1 });
                if (crit) state.crits += 1;

                state.rollingDamageEvents.push({
                    ts,
                    amount: damage,
                    type: "auto",
                });

                const target = getEnemyName(msg, msg.attackedEnemyIdx);

                addLog(
                    crit ? "CRIT" : "AUTO",
                    `${state.playerName} ${crit ? "crit" : "hit"} ${target} for ${formatNumber(damage)}`,
                    {
                        amount: damage,
                        target,
                    }
                );

                return;
            }

            if (hit === false) {
                markCombat(ts);
                state.misses += 1;
                addZoneStats({ misses: 1, attempts: 1 });

                const target = getEnemyName(msg, msg.attackedEnemyIdx);

                addLog("MISS", `${state.playerName} missed ${target}`, {
                    target,
                });
            }
        }

        function normalizeAbilityKey(value) {
            return String(value || "")
                .toLowerCase()
                .replace(/iii|ii|iv|v/g, "")
                .replace(/[^a-z0-9]+/g, " ")
                .trim();
        }

        function estimateAbilityManaCost(abilityId, abilityName, fallback = 0) {
            const direct =
                Number(state.abilityManaCosts[abilityId] || 0) ||
                Number(state.abilityMeta[abilityId]?.manaCost || 0) ||
                Number(fallback || 0);

            return direct > 0 ? direct : 0;
        }

        function registerManaSpent(amount, source = "ability") {
            const value = Number(amount || 0);

            if (!Number.isFinite(value) || value <= 0) return;

            // Ability casts are first held as estimates. partyTick also exposes live mana,
            // so handleResourceDiffs reconciles the estimate against the observed mana drop.
            // This avoids double-counting casts while still counting casts that happen when
            // the visible mana value is clamped or instantly refilled.
            state.pendingManaSpentEstimate += value;
        }

        function getSustainedManaCostPerFiveSeconds(nodeId) {
            const meta = state.abilityMeta?.[nodeId] || {};
            const desc = String(meta.desc || "");
            const hasFiveSecondDrain = /mana\s*\/\s*5s/i.test(desc);

            if (!hasFiveSecondDrain) return 0;

            const reducedCost = Number(meta.manaCost || 0);
            if (Number.isFinite(reducedCost) && reducedCost > 0) return reducedCost;

            const match = desc.match(/(\d+(?:\.\d+)?)\s*mana\s*\/\s*5s/i);
            const parsed = match ? Number(match[1]) : 0;

            return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        }

        function getActiveSustainedManaDrainPerSecond() {
            const activeNodes = new Set();

            for (const entry of state.activeImbue || []) {
                const nodeId = entry?.nodeId || entry?.id || entry;
                if (nodeId) activeNodes.add(String(nodeId));
            }

            // Some partyTick payloads only expose persistent song buffs, not activeImbue.
            // Map those buff names back to their socket node IDs so the drain still works
            // after the first fullState has not arrived or after a reconnect.
            const buffToNode = {
                "battle march": "battle_march",
                "guard rhythm": "guard_rhythm",
                "hymn of life": "hymn_of_life",
                "mana sonata": "mana_sonata",
            };

            for (const buff of state.buffs || []) {
                if (!buff?.persistent) continue;

                const nodeId = buffToNode[String(buff.name || "").toLowerCase()];
                if (nodeId) activeNodes.add(nodeId);
            }

            let totalPerFiveSeconds = 0;

            for (const nodeId of activeNodes) {
                totalPerFiveSeconds += getSustainedManaCostPerFiveSeconds(nodeId);
            }

            return totalPerFiveSeconds / 5;
        }

        function updateSustainedManaDrain(ts = now()) {
            const perSecond = getActiveSustainedManaDrainPerSecond();

            if (!state.sustainedManaLastAt) {
                state.sustainedManaLastAt = ts;
                return;
            }

            const elapsedSeconds = Math.max(0, Math.min(5, (ts - state.sustainedManaLastAt) / 1000));
            state.sustainedManaLastAt = ts;

            if (perSecond <= 0 || elapsedSeconds <= 0) return;
            if (state.maxMana <= 0) return;
            if (state.hp <= 0 && state.mana <= 0) return;

            registerManaSpent(perSecond * elapsedSeconds, "sustained");
        }

        function handleAbilitiesFired(msg, ts) {
            const firedAbilityIds = new Set();

            if (!Array.isArray(msg.abilitiesFired) || msg.abilitiesFired.length === 0) {
                return firedAbilityIds;
            }

            markCombat(ts);

            for (const ability of msg.abilitiesFired) {
                const abilityId = ability.abilityId || ability.id || ability.name || "unknown";
                firedAbilityIds.add(abilityId);

                const abilityName = ability.name || abilityNameFromId(abilityId);
                const icon = ability.icon || "";
                const damages = Array.isArray(ability.damages) ? ability.damages : [];
                const damage = damages.reduce((sum, value) => sum + Number(value || 0), 0);
                const healing = Number(ability.hpRestore || 0);
                const targetsHit = Number(ability.targetsHit || damages.length || 0);
                const targets = getAbilityTargets(msg);

                const record = getAbilityRecord(abilityId, abilityName);
                record.name = abilityName;
                record.icon = icon;
                record.casts += 1;
                record.damage += damage;
                record.healing += healing;
                record.hits += targetsHit;
                record.targetsHit += targetsHit;
                record.lastCastAt = ts;
                record.manaCost = estimateAbilityManaCost(abilityId, abilityName, record.manaCost || ability.manaCost || 0);
                record.cooldownTotal = Number(state.abilityCdTotals[abilityId] || record.cooldownTotal || 0);
                record.description = state.abilityMeta[abilityId]?.desc || record.description || "";

                registerManaSpent(record.manaCost, abilityName);

                record.events.unshift({
                    ts,
                    damage,
                    healing,
                    targetsHit,
                    targets,
                    buffs: state.buffs.slice(),
                    enemyDebuffs: state.enemyDebuffs.slice(),
                });

                if (record.events.length > config.maxAbilityEvents) {
                    record.events.length = config.maxAbilityEvents;
                }

                if (damage > 0) {
                    state.totalDamage += damage;
                    state.abilityDamage += damage;
                    state.rollingDamageEvents.push({
                        ts,
                        amount: damage,
                        type: "ability",
                        abilityId,
                    });

                    addLog(
                        "ABILITY",
                        `${state.playerName} cast ${icon} ${abilityName} for ${formatNumber(damage)} damage${targets ? ` → ${targets}` : ""}`,
                        {
                            amount: damage,
                            abilityId,
                            abilityName,
                        }
                    );
                } else {
                    addLog("CAST", `${state.playerName} cast ${icon} ${abilityName}`, {
                        abilityId,
                        abilityName,
                    });
                }

                if (healing > 0) {
                    state.totalHealing += healing;

                    addLog(
                        "HEAL",
                        `${state.playerName} restored ${formatNumber(healing)} HP with ${icon} ${abilityName}`,
                        {
                            amount: healing,
                            abilityId,
                            abilityName,
                        }
                    );
                }
            }

            sendTeamSnapshot(true);

            return firedAbilityIds;
        }

        function inferAbilityCastsFromCooldowns(msg, ts, firedAbilityIds = new Set()) {
            if (!msg.abilityCooldowns || !msg.abilityCdTotals) return;

            for (const [abilityId, currentRaw] of Object.entries(msg.abilityCooldowns)) {
                if (firedAbilityIds.has(abilityId)) continue;

                const hadPrevious = Object.prototype.hasOwnProperty.call(state.previousCooldowns || {}, abilityId);
                if (!hadPrevious) continue;

                const previous = Number(state.previousCooldowns[abilityId] || 0);
                const current = Number(currentRaw || 0);
                const total = Number(msg.abilityCdTotals[abilityId] || state.abilityCdTotals[abilityId] || 0);

                if (!total) continue;

                const jumpedFromReady = previous <= 250 && current >= total * 0.45;
                const jumpedSignificantly = current > previous + Math.max(1000, total * 0.35);

                if (!jumpedFromReady && !jumpedSignificantly) continue;

                const abilityName = state.abilityMeta[abilityId]?.name || abilityNameFromId(abilityId);

                registerInferredAbilityCast({
                    abilityId,
                    abilityName,
                    ts,
                    reason: "cooldown jump",
                });
            }
        }

        function detectBuffTriggeredAbilities(ts) {
            const currentKeys = new Set();

            for (const buff of state.buffs || []) {
                const name = buff.name || buff.type || "Unknown Buff";
                const type = buff.type || "";
                const expiresAt = Number(buff.expiresAt || 0);
                const key = `${name}|${type}|${expiresAt}`;

                currentKeys.add(key);

                if (state.previousBuffKeys.has(key)) continue;

                const normalizedName = String(name).toLowerCase();
                const normalizedType = String(type).toLowerCase();

                if (normalizedName.includes("relentless") || normalizedType.includes("atkspeedbuff")) {
                    registerInferredAbilityCast({
                        abilityId: "rapid_fire_3",
                        abilityName: "Rapid Fire III",
                        ts,
                        reason: `buff gained: ${name}`,
                    });
                }
            }

            state.previousBuffKeys = currentKeys;
        }

        function registerInferredAbilityCast({ abilityId, abilityName, ts, reason }) {
            const record = getAbilityRecord(abilityId, abilityName);

            const recentDuplicate = record.lastCastAt && ts - record.lastCastAt < 750;
            if (recentDuplicate) return;

            record.name = abilityName;
            record.casts += 1;
            record.lastCastAt = ts;
            record.manaCost = estimateAbilityManaCost(abilityId, abilityName, record.manaCost || 0);
            record.cooldownTotal = Number(state.abilityCdTotals[abilityId] || state.abilityMeta[abilityId]?.cdMs || record.cooldownTotal || 0);
            record.description = state.abilityMeta[abilityId]?.desc || record.description || "";

            registerManaSpent(record.manaCost, abilityName);

            record.events.unshift({
                ts,
                damage: 0,
                healing: 0,
                targetsHit: 0,
                targets: "",
                buffs: state.buffs.slice(),
                enemyDebuffs: state.enemyDebuffs.slice(),
                inferred: true,
                reason,
            });

            if (record.events.length > config.maxAbilityEvents) {
                record.events.length = config.maxAbilityEvents;
            }

            markCombat(ts);

            addLog("CAST", `${state.playerName} cast ${abilityName} inferred from ${reason}`, {
                abilityId,
                abilityName,
                inferred: true,
                reason,
            });
        }

        function handleZoneResourceCounters(msg, ts) {
            // Zone history should follow the same live counters the Summary tab sees.
            // Some party ticks do not expose killThisTick/xpGained consistently, so also
            // fall back to visible playerXp/playerGold/spiritShards deltas. This fixes the
            // session Zones tab sitting at 0 while Summary is moving.
            const playerXp = Number(msg.playerXp || 0);
            const playerGold = Number(msg.playerGold || 0);
            const currentShards = Number(msg.spiritShards || msg.shards || 0);

            let xpDelta = 0;
            let goldDelta = 0;
            let shardDelta = 0;

            if (playerXp > 0 && state.previousPlayerXp != null) {
                xpDelta = Math.max(0, playerXp - Number(state.previousPlayerXp || 0));
            }

            if (playerGold > 0 && state.previousPlayerGold != null) {
                goldDelta = Math.max(0, playerGold - Number(state.previousPlayerGold || 0));
            }

            if (currentShards > 0 && state.previousSpiritShards != null) {
                shardDelta = Math.max(0, currentShards - Number(state.previousSpiritShards || 0));
            }

            if (playerXp > 0) state.previousPlayerXp = playerXp;
            if (playerGold > 0) {
                state.previousPlayerGold = playerGold;
                state.goldBalance = playerGold;
            }
            if (currentShards > 0) state.previousSpiritShards = currentShards;

            const reportedXp = Number(msg.xpGained || 0);
            const reportedGold = Number(msg.goldGained || 0);
            const reportedShards = Number(msg.spiritShardsGained || 0);

            // When the server gives explicit kill rewards, handleKillRewards is the source
            // of truth. Only use deltas for fields that were not explicitly reported.
            if (msg.killThisTick && (reportedXp > 0 || reportedGold > 0 || reportedShards > 0)) {
                xpDelta = reportedXp > 0 ? 0 : xpDelta;
                goldDelta = reportedGold > 0 ? 0 : goldDelta;
                shardDelta = reportedShards > 0 ? 0 : shardDelta;
            }

            if (xpDelta || goldDelta || shardDelta) {
                state.xp += xpDelta;
                state.goldEarned += goldDelta;
                state.spiritShards += shardDelta;
                addZoneStats({ xp: xpDelta, gold: goldDelta, shards: shardDelta });
                markCombat(ts);
            }
        }

        function handleKillRewards(msg, ts) {
            if (!msg.killThisTick) return;

            const xp = Number(msg.xpGained || 0);
            const gold = Number(msg.goldGained || 0);
            const shards = Number(msg.spiritShards || 0);
            const enemy = msg.killedEnemyName || "Enemy";

            state.kills += 1;
            state.xp += xp;
            state.goldEarned += gold;
            state.spiritShards += shards;
            addZoneStats({ xp, gold, shards, kills: 1 });

            markCombat(ts);

            addLog(
                "KILL",
                `${enemy} defeated: +${formatNumber(xp)} XP, +${formatNumber(gold)} gold${shards ? `, +${formatNumber(shards)} shards` : ""}`,
                {
                    xp,
                    gold,
                    shards,
                    enemy,
                }
            );
        }

        function handleResourceDiffs() {
            const pendingSpend = Number(state.pendingManaSpentEstimate || 0);

            if (state.previousMana != null) {
                const manaDiff = state.mana - state.previousMana;
                const observedSpend = Math.max(0, -manaDiff);

                // Use the same idea as the reference tracker: recovered mana is the visible
                // mana delta plus mana we know was spent during the same tick. This catches
                // regen that is hidden by a cast or song drain. Example: mana 100 -> 60 with
                // a 75-cost cast means 35 mana recovered during that sample.
                const countedSpend = Math.max(observedSpend, pendingSpend);
                const recoveredDuringSample = manaDiff + countedSpend;

                if (countedSpend > 0) {
                    state.totalManaSpent += countedSpend;
                    if (observedSpend > 0) state.totalManaObservedSpent += observedSpend;
                    if (pendingSpend > observedSpend) state.totalManaEstimatedSpent += pendingSpend - observedSpend;
                }

                if (recoveredDuringSample > 0) {
                    state.totalManaRegen += recoveredDuringSample;
                }

                state.pendingManaSpentEstimate = 0;
            } else if (pendingSpend > 0) {
                state.totalManaSpent += pendingSpend;
                state.totalManaEstimatedSpent += pendingSpend;
                state.pendingManaSpentEstimate = 0;
            }

            const currentlyDead =
                state.maxHp > 0 &&
                state.hp <= 0;

            if (currentlyDead && !state.wasDead) {
                state.deaths += 1;
                addZoneStats({ deaths: 1 });
                state.wasDead = true;
                markCombat();

                addLog("DEATH", `${state.playerName} died.`, {
                    deaths: state.deaths,
                });
            }

            if (state.hp > 0) {
                state.wasDead = false;
            }
        }

        function handleAuraRegen(msg) {
            const ts = now();
            const hpRegen = Number(msg.hpRegen || 0);
            const manaRegen = Number(msg.manaRegen || 0);

            state.hp = Number(msg.hp || state.hp || 0);
            state.maxHp = Number(msg.maxHp || state.maxHp || 0);
            state.mana = Number(msg.mana || state.mana || 0);
            state.maxMana = Number(msg.maxMana || state.maxMana || 0);

            if (hpRegen > 0) {
                state.totalHealing += hpRegen;
                addLog("REGEN", `Aura restored ${formatNumber(hpRegen)} HP`, {
                    amount: hpRegen,
                });
            }

            if (manaRegen > 0) {
                state.totalManaRegen += manaRegen;
                addLog("REGEN", `Aura restored ${formatNumber(manaRegen)} mana`, {
                    amount: manaRegen,
                });
            }

            if (hpRegen > 0 || manaRegen > 0) {
                // The auraRegen socket message already tells us the recovered amount. Keep
                // the diff baseline in sync so the following partyTick does not count the
                // same visible mana/HP jump a second time.
                state.previousHp = state.hp;
                state.previousMana = state.mana;
                markCombat(ts);
            }
        }

        function handleAuraXpGain(msg) {
            const auraId = msg.auraId || state.activeAura || "aura";
            const xp = Number(msg.xp || 0);
            const xpToNext = Number(msg.xpToNext || 0);
            const level = Number(msg.level || 0);
            const progress = xpToNext > 0 ? (xp / xpToNext) * 100 : 0;

            addLog(
                "AURA",
                `${auraName(auraId)} aura level ${level}: ${formatNumber(xp)} / ${formatNumber(xpToNext)} XP (${progress.toFixed(1)}%)`,
                {
                    auraId,
                    level,
                    xp,
                    xpToNext,
                }
            );
        }

        /******************************************************************
         * TEAM / RELAY
         ******************************************************************/

        function isPlaceholderPlayerName(value) {
            const normalized = normalizeTeamName(value);
            return !normalized || normalized === "you" || normalized === "unknown" || normalized === "ally";
        }

        function hasResolvedPlayerName() {
            return !isPlaceholderPlayerName(state.playerName);
        }

        function isZeroTeamSnapshot(payload) {
            if (!payload || typeof payload !== "object") return true;

            const stats = payload.stats && typeof payload.stats === "object" ? payload.stats : payload;

            return (
                Number(stats.avgDps || 0) <= 0 &&
                Number(stats.rollingDps || 0) <= 0 &&
                Number(stats.autoDps || 0) <= 0 &&
                Number(stats.abilityDps || 0) <= 0 &&
                Number(stats.totalDamage || 0) <= 0 &&
                Number(stats.autoDamage || 0) <= 0 &&
                Number(stats.abilityDamage || 0) <= 0 &&
                Number(stats.totalHealing || 0) <= 0 &&
                Number(stats.hits || 0) <= 0 &&
                Number(stats.misses || 0) <= 0 &&
                Number(stats.crits || 0) <= 0 &&
                Number(stats.fightSeconds || 0) <= 0
            );
        }

        function isPlaceholderTeamSnapshot(msg) {
            const stats = msg?.stats && typeof msg.stats === "object" ? msg.stats : msg;
            const name = msg?.name || msg?.username || stats?.name || "";

            return isPlaceholderPlayerName(name) && isZeroTeamSnapshot(msg);
        }

        function sendRelayHelloIfReady(force = false) {
            if (!appRef?.relay?.isConnected()) return false;
            if (!hasResolvedPlayerName()) return false;
            if (state.relayHelloSent && !force) return true;

            state.relayHelloSent = true;

            return appRef.relay.send({
                type: "hello",
                name: state.playerName,
                username: state.playerName,
            });
        }

        function getOwnTeamSnapshot() {
            const stats = getStats();
            const playerName = hasResolvedPlayerName() ? state.playerName : "";

            return {
                type: "teamSnapshot",
                name: playerName,
                username: playerName,
                weaponType: state.currentWeaponType || "",
                weaponLevel: Number(state.weaponLevel || 0),

                avgDps: stats.avgDps,
                rollingDps: stats.rollingDps,
                autoDps: stats.autoDps,
                abilityDps: stats.abilityDps,

                accuracy: stats.accuracy,
                critRate: stats.critRate,

                totalHealing: state.totalHealing,
                totalDamage: state.totalDamage,
                autoDamage: state.autoDamage,
                abilityDamage: state.abilityDamage,

                totalManaSpent: state.totalManaSpent,
                totalManaRegen: state.totalManaRegen,
                manaSpentPerSecond: stats.manaSpentPerSecond,
                manaRegenPerSecond: stats.manaRegenPerSecond,
                deaths: state.deaths,

                hits: state.hits,
                misses: state.misses,
                crits: state.crits,

                fightSeconds: stats.fightSeconds,
            };
        }

        function sendTeamSnapshot(force = false) {
            if (!appRef?.relay?.isConnected()) return;
            if (!hasResolvedPlayerName()) return;

            sendRelayHelloIfReady();

            const ts = now();

            if (!force && ts - state.team.lastSnapshotAt < 1000) {
                return;
            }

            state.team.lastSnapshotAt = ts;
            appRef.relay.send(getOwnTeamSnapshot());
        }

        function normalizeTeamName(value) {
            return String(value || "")
                .replace(/\s*\(You\)\s*$/i, "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
        }

        function getTeamMemberKey(name, fallbackId = "") {
            const normalizedName = normalizeTeamName(name);

            if (normalizedName) {
                return `name:${normalizedName}`;
            }

            return `id:${String(fallbackId || "unknown").trim()}`;
        }

        function mergeExistingTeamEntriesByName(name, preferredKey) {
            const normalizedName = normalizeTeamName(name);
            if (!normalizedName) return null;

            let merged = null;

            for (const [key, member] of state.team.members.entries()) {
                if (key === preferredKey) continue;

                const memberName = normalizeTeamName(member?.name);

                if (memberName !== normalizedName) continue;

                if (!merged) {
                    merged = { ...member };
                } else {
                    merged = {
                        ...merged,
                        ...member,
                        totalDamage: Math.max(Number(merged.totalDamage || 0), Number(member.totalDamage || 0)),
                        autoDamage: Math.max(Number(merged.autoDamage || 0), Number(member.autoDamage || 0)),
                        abilityDamage: Math.max(Number(merged.abilityDamage || 0), Number(member.abilityDamage || 0)),
                        totalHealing: Math.max(Number(merged.totalHealing || 0), Number(member.totalHealing || 0)),
                        totalManaSpent: Math.max(Number(merged.totalManaSpent || 0), Number(member.totalManaSpent || 0)),
                        totalManaRegen: Math.max(Number(merged.totalManaRegen || 0), Number(member.totalManaRegen || 0)),
                        manaSpentPerSecond: Math.max(Number(merged.manaSpentPerSecond || 0), Number(member.manaSpentPerSecond || 0)),
                        manaRegenPerSecond: Math.max(Number(merged.manaRegenPerSecond || 0), Number(member.manaRegenPerSecond || 0)),
                        deaths: Math.max(Number(merged.deaths || 0), Number(member.deaths || 0)),
                        hits: Math.max(Number(merged.hits || 0), Number(member.hits || 0)),
                        misses: Math.max(Number(merged.misses || 0), Number(member.misses || 0)),
                        crits: Math.max(Number(merged.crits || 0), Number(member.crits || 0)),
                        lastSeenAt: Math.max(Number(merged.lastSeenAt || 0), Number(member.lastSeenAt || 0)),
                    };
                }

                state.team.members.delete(key);
            }

            return merged;
        }

        function compactTeamMembersByName() {
            const compacted = new Map();

            for (const member of state.team.members.values()) {
                const key = getTeamMemberKey(member.name, member.id);
                const existing = compacted.get(key);

                if (!existing) {
                    compacted.set(key, {
                        ...member,
                        id: key,
                    });

                    continue;
                }

                compacted.set(key, {
                    ...existing,
                    ...member,
                    id: key,
                    totalDamage: Math.max(Number(existing.totalDamage || 0), Number(member.totalDamage || 0)),
                    autoDamage: Math.max(Number(existing.autoDamage || 0), Number(member.autoDamage || 0)),
                    abilityDamage: Math.max(Number(existing.abilityDamage || 0), Number(member.abilityDamage || 0)),
                    totalHealing: Math.max(Number(existing.totalHealing || 0), Number(member.totalHealing || 0)),
                    totalManaSpent: Math.max(Number(existing.totalManaSpent || 0), Number(member.totalManaSpent || 0)),
                    totalManaRegen: Math.max(Number(existing.totalManaRegen || 0), Number(member.totalManaRegen || 0)),
                    manaSpentPerSecond: Math.max(Number(existing.manaSpentPerSecond || 0), Number(member.manaSpentPerSecond || 0)),
                    manaRegenPerSecond: Math.max(Number(existing.manaRegenPerSecond || 0), Number(member.manaRegenPerSecond || 0)),
                    deaths: Math.max(Number(existing.deaths || 0), Number(member.deaths || 0)),
                    hits: Math.max(Number(existing.hits || 0), Number(member.hits || 0)),
                    misses: Math.max(Number(existing.misses || 0), Number(member.misses || 0)),
                    crits: Math.max(Number(existing.crits || 0), Number(member.crits || 0)),
                    lastSeenAt: Math.max(Number(existing.lastSeenAt || 0), Number(member.lastSeenAt || 0)),
                });
            }

            state.team.members = compacted;
        }

        function upsertTeamMemberFromSnapshot(msg) {
            const senderId =
                msg.senderClientId ||
                msg.clientId ||
                msg.relayClientId ||
                msg.username ||
                msg.name;

            const stats = msg.stats && typeof msg.stats === "object" ? msg.stats : msg;
            const name = msg.name || msg.username || stats.name || "Ally";

            if (isPlaceholderTeamSnapshot(msg)) {
                return;
            }

            if (normalizeTeamName(name) === normalizeTeamName(state.playerName)) {
                return;
            }

            const memberKey = getTeamMemberKey(name, senderId);
            const existingByName = mergeExistingTeamEntriesByName(name, memberKey);
            const existing = state.team.members.get(memberKey) || existingByName || {};

            state.team.members.set(memberKey, {
                ...existing,

                id: memberKey,
                lastClientId: senderId || existing.lastClientId || "",
                name,
                weaponType: msg.weaponType || stats.weaponType || existing.weaponType || "",
                weaponLevel: Number(msg.weaponLevel || stats.weaponLevel || existing.weaponLevel || 0),

                avgDps: Number(stats.avgDps || 0),
                rollingDps: Number(stats.rollingDps || 0),
                autoDps: Number(stats.autoDps || 0),
                abilityDps: Number(stats.abilityDps || 0),

                accuracy: Number(stats.accuracy || 0),
                critRate: Number(stats.critRate || 0),

                totalHealing: Number(stats.totalHealing || 0),
                totalDamage: Number(stats.totalDamage || 0),
                autoDamage: Number(stats.autoDamage || 0),
                abilityDamage: Number(stats.abilityDamage || 0),

                totalManaSpent: Number(stats.totalManaSpent || 0),
                totalManaRegen: Number(stats.totalManaRegen || 0),
                manaSpentPerSecond: Number(stats.manaSpentPerSecond || 0),
                manaRegenPerSecond: Number(stats.manaRegenPerSecond || 0),
                deaths: Number(stats.deaths || 0),

                hits: Number(stats.hits || 0),
                misses: Number(stats.misses || 0),
                crits: Number(stats.crits || 0),

                fightSeconds: Number(stats.fightSeconds || 0),
                lastSeenAt: now(),
            });
        }

        function upsertTeamMemberFromLegacyAbilityMessage(msg) {
            const senderId =
                msg.senderClientId ||
                msg.clientId ||
                msg.relayClientId ||
                msg.username ||
                msg.caster ||
                msg.name ||
                "legacy-ally";

            const name = msg.username || msg.caster || msg.name || "Ally";

            if (isPlaceholderPlayerName(name) && Number(msg.damage || 0) <= 0 && Number(msg.healing || 0) <= 0) {
                return;
            }

            if (normalizeTeamName(name) === normalizeTeamName(state.playerName)) {
                return;
            }

            const memberKey = getTeamMemberKey(name, senderId);
            const existingByName = mergeExistingTeamEntriesByName(name, memberKey);

            const existing = state.team.members.get(memberKey) || existingByName || {
                id: memberKey,
                name,
                weaponType: "",
                weaponLevel: 0,
                avgDps: 0,
                rollingDps: 0,
                autoDps: 0,
                abilityDps: 0,
                accuracy: 0,
                critRate: 0,
                totalHealing: 0,
                totalManaSpent: 0,
                totalManaRegen: 0,
                manaSpentPerSecond: 0,
                manaRegenPerSecond: 0,
                deaths: 0,
                totalDamage: 0,
                autoDamage: 0,
                abilityDamage: 0,
                hits: 0,
                misses: 0,
                crits: 0,
                fightSeconds: 0,
                firstSeenAt: now(),
                lastSeenAt: now(),
                rollingDamageEvents: [],
            };

            const ts = now();
            const damage = Number(msg.damage || 0);
            const healing = Number(msg.healing || 0);

            existing.id = memberKey;
            existing.lastClientId = senderId;
            existing.name = name;

            if (!existing.firstSeenAt) {
                existing.firstSeenAt = ts;
            }

            if (!Array.isArray(existing.rollingDamageEvents)) {
                existing.rollingDamageEvents = [];
            }

            if (damage > 0) {
                existing.totalDamage += damage;
                existing.abilityDamage += damage;
                existing.rollingDamageEvents.push({ ts, amount: damage });
            }

            if (healing > 0) {
                existing.totalHealing += healing;
            }

            existing.rollingDamageEvents = existing.rollingDamageEvents.filter(
                (event) => event.ts >= ts - config.rollingWindowMs
            );

            existing.fightSeconds = Math.max(1, (ts - existing.firstSeenAt) / 1000);
            existing.avgDps = existing.totalDamage / existing.fightSeconds;
            existing.rollingDps =
                existing.rollingDamageEvents.reduce((sum, event) => sum + event.amount, 0) /
                (config.rollingWindowMs / 1000);
            existing.abilityDps = existing.abilityDamage / existing.fightSeconds;
            existing.lastSeenAt = ts;

            state.team.members.set(memberKey, existing);
        }

        function getTeamRows() {
            compactTeamMembersByName();

            const own = {
                ...getOwnTeamSnapshot(),
                id: "self",
                name: `${state.playerName || "You"} (You)`,
                lastSeenAt: now(),
            };

            const ownName = normalizeTeamName(state.playerName);

            const others = [...state.team.members.values()]
                .filter((member) => normalizeTeamName(member.name) !== ownName)
                .sort((a, b) => Number(b.avgDps || 0) - Number(a.avgDps || 0));

            return [own, ...others];
        }

        function formatSeenAgo(ts) {
            if (!ts) return "?";

            const seconds = Math.max(0, Math.floor((now() - ts) / 1000));

            if (seconds < 2) return "now";
            if (seconds < 60) return `${seconds}s`;

            return `${Math.floor(seconds / 60)}m`;
        }

        function getRelayStatusShort() {
            const relayState = appRef?.relay?.state;

            if (!relayState) {
                return {
                    text: "Relay: off",
                    cls: "dps-muted",
                    icon: "🔴",
                    border: "rgba(248, 113, 113, 0.75)",
                    title: "Relay core unavailable",
                };
            }

            if (relayState.connecting) {
                return {
                    text: "Relay: ...",
                    cls: "dps-warn",
                    icon: "🟡",
                    border: "rgba(251, 191, 36, 0.75)",
                    title: "Connecting...",
                };
            }

            if (relayState.connected) {
                return {
                    text: `Relay: ${Math.max(1, Number(relayState.peerCount || 1))}`,
                    cls: "dps-good",
                    icon: "🟢",
                    border: "rgba(74, 222, 128, 0.75)",
                    title: "Disconnect relay",
                };
            }

            return {
                text: "Relay: off",
                cls: "dps-muted",
                icon: "🔴",
                border: "rgba(248, 113, 113, 0.75)",
                title: "Connect relay",
            };
        }

        /******************************************************************
         * DATA HELPERS
         ******************************************************************/

        function getEnemyName(msg, idx) {
            if (!Array.isArray(msg.enemies)) return "Enemy";

            const enemy =
                msg.enemies[Number(idx)] ||
                msg.enemies.find((entry) => entry.active) ||
                msg.enemies[0];

            return enemy?.name || enemy?.id || "Enemy";
        }

        function getAbilityTargets(msg) {
            if (!msg.abilityDmgPerEnemy || !Array.isArray(msg.enemies)) return "";

            return Object.entries(msg.abilityDmgPerEnemy)
                .map(([index, damage]) => {
                    const amount = Number(damage || 0);
                    if (amount <= 0) return null;

                    const enemy = msg.enemies[Number(index)];
                    const name = enemy?.name || enemy?.id || `Enemy ${index}`;

                    return `${name} ${formatNumber(amount)}`;
                })
                .filter(Boolean)
                .join(", ");
        }

        function abilityNameFromId(id) {
            return String(id || "Unknown Ability")
                .split("_")
                .filter(Boolean)
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" ");
        }

        function auraName(id) {
            const names = {
                att: "Attack",
                atk: "Attack",
                def: "Defense",
                hp: "HP",
                mana: "Mana",
                hp_regen: "HP Regen",
                mana_regen: "Mana Regen",
                att_spd: "Attack Speed",
                atk_spd: "Attack Speed",
                drop_rate: "Drop Rate",
            };

            return names[id] || abilityNameFromId(id);
        }

        function getStats() {
            const fightSeconds = getFightSeconds();
            const elapsedHours = fightSeconds / 3600;

            pruneRollingEvents();

            const rollingDamage = state.rollingDamageEvents.reduce((sum, event) => sum + event.amount, 0);
            const rollingDps = rollingDamage / (config.rollingWindowMs / 1000);
            const avgDps = fightSeconds ? state.totalDamage / fightSeconds : 0;
            const autoDps = fightSeconds ? state.autoDamage / fightSeconds : 0;
            const abilityDps = fightSeconds ? state.abilityDamage / fightSeconds : 0;
            const hitAttempts = state.hits + state.misses;
            const accuracy = hitAttempts ? (state.hits / hitAttempts) * 100 : 0;
            const critRate = state.hits ? (state.crits / state.hits) * 100 : 0;
            const xpPerHour = elapsedHours ? state.xp / elapsedHours : 0;
            const goldPerHour = elapsedHours ? state.goldEarned / elapsedHours : 0;
            const killsPerHour = elapsedHours ? state.kills / elapsedHours : 0;
            const deathsPerHour = elapsedHours ? state.deaths / elapsedHours : 0;
            const manaSpentPerSecond = fightSeconds ? state.totalManaSpent / fightSeconds : 0;
            const manaRegenPerSecond = fightSeconds ? state.totalManaRegen / fightSeconds : 0;

            return {
                fightSeconds,
                rollingDamage,
                rollingDps,
                avgDps,
                autoDps,
                abilityDps,
                hitAttempts,
                accuracy,
                critRate,
                xpPerHour,
                goldPerHour,
                killsPerHour,
                deathsPerHour,
                manaSpentPerSecond,
                manaRegenPerSecond,
                totalManaSpent: state.totalManaSpent,
                totalManaRegen: state.totalManaRegen,
                totalManaObservedSpent: state.totalManaObservedSpent,
                totalManaEstimatedSpent: state.totalManaEstimatedSpent,
                totalHealing: state.totalHealing,
                totalDamage: state.totalDamage,
                autoDamage: state.autoDamage,
                abilityDamage: state.abilityDamage,
                hits: state.hits,
                misses: state.misses,
                crits: state.crits,
                deaths: state.deaths,
            };
        }

        function getReadyAbilities() {
            return state.activeAbilityIds
                .map((id) => {
                    const cd = Number(state.abilityCooldowns[id] || 0);
                    const manaCost = Number(state.abilityManaCosts[id] || state.abilityMeta[id]?.manaCost || 0);
                    const record = getAbilityRecord(id, abilityNameFromId(id));

                    return {
                        id,
                        name: record.name || abilityNameFromId(id),
                        cd,
                        manaCost,
                    };
                })
                .filter((ability) => ability.cd <= 250 && state.mana >= ability.manaCost);
        }

        function getCoachScore() {
            const stats = getStats();
            let score = 100;

            if (!state.fightStartedAt || stats.fightSeconds < 10) return 0;

            if (stats.accuracy > 0) {
                if (stats.accuracy < 75) score -= 30;
                else if (stats.accuracy < 88) score -= 18;
                else if (stats.accuracy < 95) score -= 7;
            }

            if (state.mana < state.maxMana * 0.15 && state.maxMana > 0) score -= 12;
            if (stats.rollingDps < stats.avgDps * 0.55 && stats.avgDps > 0 && stats.fightSeconds > 20) score -= 15;
            if (state.totalDamage <= 0) score = 0;

            return Math.max(0, Math.min(100, Math.round(score)));
        }

        function getCoachRecommendations() {
            const stats = getStats();
            const recs = [];

            if (!state.fightStartedAt || stats.fightSeconds < 10) {
                recs.push({
                    level: "info",
                    text: "Run combat for at least 10–20 seconds for reliable coaching.",
                });
                return recs;
            }

            if (stats.accuracy > 0 && stats.accuracy < 75) {
                recs.push({
                    level: "bad",
                    text: `Accuracy is very low at ${stats.accuracy.toFixed(1)}%. Hit chance is probably your best DPS upgrade.`,
                });
            } else if (stats.accuracy > 0 && stats.accuracy < 88) {
                recs.push({
                    level: "warn",
                    text: `Accuracy is ${stats.accuracy.toFixed(1)}%. Misses are costing damage; consider more hit chance.`,
                });
            }

            if (state.mana < state.maxMana * 0.15 && state.maxMana > 0) {
                recs.push({
                    level: "warn",
                    text: "Mana is very low. Your ability uptime may be limited by mana sustain.",
                });
            }

            if (stats.rollingDps < stats.avgDps * 0.55 && stats.avgDps > 0 && stats.fightSeconds > 20) {
                recs.push({
                    level: "warn",
                    text: "Your recent 10s DPS is much lower than your fight average.",
                });
            }

            if (state.abilityDamage < state.totalDamage * 0.15 && state.activeAbilityIds.length > 0 && stats.fightSeconds > 30) {
                recs.push({
                    level: "info",
                    text: "Ability damage is a small part of total damage. Check cooldowns, mana, or whether abilities are utility-focused.",
                });
            }

            if (stats.critRate < 5 && state.hits >= 25) {
                recs.push({
                    level: "info",
                    text: `Crit rate is only ${stats.critRate.toFixed(1)}%. Crit scaling may not be worth prioritizing unless your build adds more crit chance.`,
                });
            }

            const ready = getReadyAbilities();

            if (ready.length > 0 && state.mana > 0) {
                recs.push({
                    level: "info",
                    text: `Ready abilities detected: ${ready.map((a) => a.name).join(", ")}.`,
                });
            }

            if (!recs.length) {
                recs.push({
                    level: "good",
                    text: "No major weakness detected yet.",
                });
            }

            return recs;
        }

        /******************************************************************
         * RENDER
         ******************************************************************/

        function renderStyles() {
            return `
      <style>
        .dps-tabs {
          display:flex;
          gap:6px;
          margin-bottom:10px;
          overflow-x:auto;
        }

        .dps-tab {
          background:rgba(255,255,255,0.08);
          color:#e5e7eb;
          border:1px solid rgba(255,255,255,0.14);
          border-radius:7px;
          padding:4px 8px;
          font-size:11px;
          cursor:pointer;
        }

        .dps-tab.active {
          background:rgba(56,189,248,0.24);
          border-color:rgba(56,189,248,0.55);
          color:#fff;
        }

        .dps-grid {
          display:grid;
          grid-template-columns:repeat(4, 1fr);
          gap:8px;
          margin-bottom:10px;
        }

        .dps-card,
        .dps-section {
          background:rgba(255,255,255,0.045);
          border:1px solid rgba(255,255,255,0.08);
          border-radius:10px;
          padding:9px;
        }

        .dps-card-label {
          color:rgba(229,231,235,0.6);
          font-size:10px;
          margin-bottom:3px;
        }

        .dps-card-value {
          font-size:15px;
          font-weight:800;
        }

        .dps-section {
          margin-top:10px;
        }

        .dps-section-title {
          font-weight:800;
          margin-bottom:7px;
        }

        .dps-good { color:#4ade80; font-weight:800; }
        .dps-warn { color:#fbbf24; font-weight:800; }
        .dps-bad { color:#fb7185; font-weight:800; }
        .dps-blue { color:#60a5fa; font-weight:800; }
        .dps-purple { color:#c084fc; font-weight:800; }
        .dps-muted { color:rgba(229,231,235,0.58); }

        .dps-input {
          background:rgba(0,0,0,0.25);
          color:#e5e7eb;
          border:1px solid rgba(255,255,255,0.14);
          border-radius:7px;
          padding:5px 7px;
          font-size:11px;
          outline:none;
        }

        .dps-input:focus {
          border-color:rgba(56,189,248,0.65);
        }

        .dps-table {
          width:100%;
          border-collapse:collapse;
        }

        .dps-table th,
        .dps-table td {
          padding:5px 6px;
          border-bottom:1px solid rgba(255,255,255,0.07);
          text-align:right;
          white-space:nowrap;
        }

        .dps-table th:first-child,
        .dps-table td:first-child {
          text-align:left;
        }

        .dps-table th {
          background:rgba(8,10,15,0.97);
          color:rgba(229,231,235,0.65);
        }

        .dps-chip {
          display:inline-block;
          margin:2px 4px 2px 0;
          padding:3px 7px;
          border-radius:999px;
          background:rgba(255,255,255,0.08);
          border:1px solid rgba(255,255,255,0.12);
          font-size:11px;
        }

        .dps-log-row {
          display:grid;
          grid-template-columns:74px 72px 1fr;
          gap:7px;
          padding:5px 4px;
          border-bottom:1px solid rgba(255,255,255,0.06);
        }

        .dps-log-time {
          color:rgba(229,231,235,0.45);
          font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
        }

        .dps-log-type {
          font-weight:800;
        }

        .dps-bar {
          height:8px;
          background:rgba(255,255,255,0.11);
          border-radius:999px;
          overflow:hidden;
          margin-top:4px;
        }

        .dps-bar > div {
          height:100%;
          background:#38bdf8;
        }
      </style>
    `;
        }

        function render() {
            return `
      ${renderStyles()}

      <div class="dps-section" style="margin-top:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <div class="dps-section-title" style="margin-bottom:2px;">🎯 DPS Coach</div>
            <div class="dps-muted">Personal parse locally. Team parse through relay snapshots.</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="vim-btn" data-dps-copy>Copy Summary</button>
            <button class="vim-btn" data-dps-reset>Reset</button>
          </div>
        </div>
      </div>

      <div class="dps-tabs">
        ${tabButton("summary", "Summary")}
        ${tabButton("abilities", "Abilities")}
        ${tabButton("coach", "Coach")}
        ${tabButton("team", "Team")}
        ${tabButton("zones", "Zones")}
        ${tabButton("buffs", "Buffs")}
        ${tabButton("logs", "Logs")}
      </div>

      ${state.activeTab === "summary" ? renderSummaryTab() : ""}
      ${state.activeTab === "abilities" ? renderAbilitiesTab() : ""}
      ${state.activeTab === "coach" ? renderCoachTab() : ""}
      ${state.activeTab === "team" ? renderTeamTab() : ""}
      ${state.activeTab === "zones" ? renderZonesTab() : ""}
      ${state.activeTab === "buffs" ? renderBuffsTab() : ""}
      ${state.activeTab === "logs" ? renderLogsTab() : ""}
    `;
        }

        function tabButton(id, label) {
            return `<button class="dps-tab ${state.activeTab === id ? "active" : ""}" data-dps-tab="${id}">${escapeHtml(label)}</button>`;
        }

        function renderSummaryTab() {
            const stats = getStats();
            const hpPct = state.maxHp ? (state.hp / state.maxHp) * 100 : 0;
            const manaPct = state.maxMana ? (state.mana / state.maxMana) * 100 : 0;

            return `
      <div class="dps-grid">
        ${card("Avg DPS", formatNumber(stats.avgDps), "dps-good")}
        ${card("10s DPS", formatNumber(stats.rollingDps), "dps-good")}
        ${card("Damage", formatNumber(state.totalDamage))}
        ${card("Duration", formatDuration(stats.fightSeconds))}
        ${card("Auto DPS", formatNumber(stats.autoDps))}
        ${card("Ability DPS", formatNumber(stats.abilityDps), "dps-purple")}
        ${card("Accuracy", pct(stats.accuracy), stats.accuracy >= 90 ? "dps-good" : stats.accuracy >= 75 ? "dps-warn" : "dps-bad")}
        ${card("Crit", pct(stats.critRate), "dps-warn")}
        ${card("Deaths", formatNumber(state.deaths), state.deaths > 0 ? "dps-bad" : "dps-good")}
        ${card("Mana spent/s", formatNumber(stats.manaSpentPerSecond), "dps-warn")}
        ${card("Mana regen/s", formatNumber(stats.manaRegenPerSecond), "dps-blue")}
        ${card("Coach Score", `${getCoachScore()}/100`, scoreClass(getCoachScore()))}
        ${card("Kills/hr", formatNumber(stats.killsPerHour))}
        ${card("XP/hr", formatNumber(stats.xpPerHour), "dps-blue")}
        ${card("Gold/hr", formatNumber(stats.goldPerHour), "dps-warn")}
        ${card("Mana spent", formatNumber(state.totalManaSpent), "dps-warn")}
      </div>

      <div class="dps-section">
        <div class="dps-section-title">Player</div>
        <div><b>Name:</b> ${escapeHtml(state.playerName)}</div>
        <div><b>Weapon:</b> ${escapeHtml(state.currentWeaponType || "Unknown")}${state.weaponLevel ? ` Lv. ${formatNumber(state.weaponLevel)}` : ""}${state.weaponXp ? ` (${formatNumber(state.weaponXp)} XP)` : ""}</div>
        <div><b>Zone:</b> ${escapeHtml(state.zoneId || "Unknown")} ${state.tier != null ? `| <b>Tier:</b> ${state.tier}` : ""}</div>
        <div><b>Attack Speed:</b> ${formatNumber(state.attackSpeed)} ms</div>
        <div><b>Gold earned this session:</b> ${formatNumber(state.goldEarned)}</div>
        <div><b>Current gold balance:</b> ${formatNumber(state.goldBalance)}</div>
      </div>

      <div class="dps-section">
        <div class="dps-section-title">Resources</div>
        <div>HP: ${formatNumber(state.hp)} / ${formatNumber(state.maxHp)} (${hpPct.toFixed(1)}%)</div>
        <div class="dps-bar"><div style="width:${Math.max(0, Math.min(100, hpPct))}%"></div></div>
        <div style="margin-top:8px;">Mana: ${formatNumber(state.mana)} / ${formatNumber(state.maxMana)} (${manaPct.toFixed(1)}%)</div>
        <div class="dps-bar"><div style="width:${Math.max(0, Math.min(100, manaPct))}%"></div></div>
        <div style="margin-top:8px;"><b>Total mana spent:</b> ${formatNumber(state.totalManaSpent)} (${formatNumber(stats.manaSpentPerSecond)}/s)</div>
        <div class="dps-muted" title="Observed is visible mana drops from WS. Estimated is the part inferred from ability costs/song drain when the visible mana bar was refilled in the same tick.">Observed drop: ${formatNumber(state.totalManaObservedSpent)} · inferred hidden spend: ${formatNumber(state.totalManaEstimatedSpent)}</div>
        <div><b>Total mana regenerated:</b> ${formatNumber(state.totalManaRegen)} (${formatNumber(stats.manaRegenPerSecond)}/s)</div>
        <div><b>Deaths:</b> ${formatNumber(state.deaths)}${stats.deathsPerHour > 0 ? ` (${formatNumber(stats.deathsPerHour)}/hr)` : ""}</div>
      </div>
    `;
        }

        function renderAbilitiesTab() {
            const abilities = [...state.abilities.values()].sort((a, b) => b.damage - a.damage);

            if (!abilities.length) {
                return `<div class="dps-muted">No ability data yet. Use abilities in party combat and wait for partyTick abilitiesFired data.</div>`;
            }

            return `
      <table class="dps-table">
        <thead>
          <tr>
            <th>Ability</th>
            <th>Casts</th>
            <th>Damage</th>
            <th>DPS Share</th>
            <th>Avg Cast</th>
            <th>Heal</th>
            <th>CD</th>
            <th>Mana</th>
          </tr>
        </thead>
        <tbody>
          ${abilities.map((ability) => {
                const share = state.totalDamage ? (ability.damage / state.totalDamage) * 100 : 0;
                const avg = ability.casts ? ability.damage / ability.casts : 0;
                const cd = Number(state.abilityCooldowns[ability.id] || 0);
                const totalCd = Number(ability.cooldownTotal || state.abilityCdTotals[ability.id] || 0);

                return `
              <tr>
                <td>${escapeHtml(`${ability.icon || ""} ${ability.name}`)}</td>
                <td>${ability.casts}</td>
                <td class="dps-purple">${formatNumber(ability.damage)}</td>
                <td>${share.toFixed(1)}%</td>
                <td>${formatNumber(avg)}</td>
                <td class="dps-good">${formatNumber(ability.healing)}</td>
                <td>${formatNumber(cd / 1000)}s / ${formatNumber(totalCd / 1000)}s</td>
                <td>${formatNumber(ability.manaCost || 0)}</td>
              </tr>
            `;
            }).join("")}
        </tbody>
      </table>

      <div class="dps-section">
        <div class="dps-section-title">Recent Cast Context</div>
        ${abilities.slice(0, 5).map(renderAbilityContext).join("")}
      </div>
    `;
        }

        function renderAbilityContext(ability) {
            const last = ability.events[0];
            if (!last) return "";

            return `
      <div style="margin-bottom:10px;">
        <b>${escapeHtml(`${ability.icon || ""} ${ability.name}`)}</b>
        <div class="dps-muted">Last cast: ${formatTime(last.ts)} | Damage ${formatNumber(last.damage)} | Targets ${last.targetsHit}</div>
        <div>${last.buffs.map((buff) => `<span class="dps-chip">${escapeHtml(`${buff.icon || ""} ${buff.name || buff.type} ${buff.value != null ? `+${buff.value}` : ""}`)}</span>`).join("") || `<span class="dps-muted">No caster buffs captured.</span>`}</div>
        <div>${last.enemyDebuffs.map((debuff) => `<span class="dps-chip">${escapeHtml(`${debuff.enemy}: ${debuff.type} ${debuff.value ?? ""}`)}</span>`).join("") || `<span class="dps-muted">No enemy debuffs captured.</span>`}</div>
      </div>
    `;
        }

        function renderCoachTab() {
            const score = getCoachScore();
            const recs = getCoachRecommendations();
            const ready = getReadyAbilities();

            return `
      <div class="dps-grid">
        ${card("Coach Score", `${score}/100`, scoreClass(score))}
        ${card("Accuracy", pct(getStats().accuracy))}
        ${card("10s DPS", formatNumber(getStats().rollingDps), "dps-good")}
        ${card("Mana", `${formatNumber(state.mana)} / ${formatNumber(state.maxMana)}`, state.maxMana && state.mana < state.maxMana * 0.15 ? "dps-warn" : "")}
      </div>

      <div class="dps-section">
        <div class="dps-section-title">Recommendations</div>
        ${recs.map((rec) => `
          <div class="${rec.level === "bad" ? "dps-bad" : rec.level === "warn" ? "dps-warn" : rec.level === "good" ? "dps-good" : "dps-blue"}" style="margin-bottom:6px;">
            • ${escapeHtml(rec.text)}
          </div>
        `).join("")}
      </div>

      <div class="dps-section">
        <div class="dps-section-title">Ready Abilities</div>
        ${ready.length ? ready.map((ability) => `<span class="dps-chip">${escapeHtml(`${ability.name} (${ability.manaCost} mana)`)}</span>`).join("") : `<span class="dps-muted">No ready abilities detected.</span>`}
      </div>
    `;
        }

        function renderTeamTab() {
            const rows = getTeamRows();
            const relayState = appRef?.relay?.state;
            const savedRoomKey = loadSavedRelayRoomKey();
            const roomKey = relayState?.roomKey || savedRoomKey || "";
            const relayStatus = getRelayStatusShort();

            return `
    <div class="dps-section">
      <div class="dps-section-title">Relay Connection</div>

      <div data-relay-controls style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <input
          class="dps-input"
          data-relay-room
          placeholder="Relay room code"
          value="${escapeHtml(roomKey)}"
          style="min-width:180px;flex:1;"
        />

        <button type="button" class="vim-btn" data-relay-generate title="Generate relay code" style="width:30px;min-width:30px;padding:4px 0;text-align:center;">🎲</button>
        <button type="button" class="vim-btn" data-relay-copy title="Copy relay code" style="width:30px;min-width:30px;padding:4px 0;text-align:center;">📋</button>

        <button
          type="button"
          class="vim-btn"
          data-relay-connect
          title="${escapeHtml(relayStatus.title)}"
          style="width:34px;min-width:34px;padding:4px 0;text-align:center;border-color:${relayStatus.border};"
        >${relayStatus.icon}</button>

        <span data-relay-short-status class="${relayStatus.cls}" style="white-space:nowrap;min-width:70px;">
          ${escapeHtml(relayStatus.text)}
        </span>

        <button
          type="button"
          class="vim-btn"
          data-relay-debug-toggle
          title="Toggle relay debugger"
          style="${relayDebug.enabled ? "border-color:rgba(96,165,250,0.75);" : ""}"
        >
          ${relayDebug.enabled ? "Debug: on" : "Debug: off"}
        </button>
      </div>

      <div class="dps-muted" style="margin-top:8px;">
        Team stats are only based on each player's own local parse sent through relay.
      </div>
    </div>

    <div class="dps-section">
      <div class="dps-section-title">Team DPS</div>

      <table class="dps-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Weapon</th>
            <th>Avg DPS</th>
            <th>10s DPS</th>
            <th>Auto DPS</th>
            <th>Ability DPS</th>
            <th>Accuracy</th>
            <th>Crit</th>
            <th>Healing</th>
            <th>Mana -/s</th>
            <th>Mana +/s</th>
            <th>Deaths</th>
            <th>Seen</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td class="dps-muted">${escapeHtml(row.weaponType || "—")}${row.weaponLevel ? ` ${formatNumber(row.weaponLevel)}` : ""}</td>
              <td class="dps-good">${formatNumber(row.avgDps)}</td>
              <td class="dps-good">${formatNumber(row.rollingDps)}</td>
              <td>${formatNumber(row.autoDps)}</td>
              <td class="dps-purple">${formatNumber(row.abilityDps)}</td>
              <td>${pct(row.accuracy)}</td>
              <td>${pct(row.critRate)}</td>
              <td class="dps-blue">${formatNumber(row.totalHealing)}</td>
              <td class="dps-warn">${formatNumber(row.manaSpentPerSecond || 0)}</td>
              <td class="dps-blue">${formatNumber(row.manaRegenPerSecond || 0)}</td>
              <td class="${Number(row.deaths || 0) > 0 ? "dps-bad" : "dps-muted"}">${formatNumber(row.deaths || 0)}</td>
              <td class="dps-muted">${escapeHtml(row.name.endsWith("(You)") ? "now" : formatSeenAgo(row.lastSeenAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    ${renderRelayDebugPanel()}
  `;
        }

        function renderZonesTab() {
            saveZoneStats();

            const rows = getZoneRows(true);
            const currentKey = state.lastZoneStatsKey || getCurrentZoneKey();

            return `
      <div class="dps-section" style="margin-top:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <div class="dps-section-title" style="margin-bottom:2px;">Zone History</div>
            <div class="dps-muted">Session stats. Rates use tracked time in each zone; DPS Coach Reset starts this over.</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="vim-btn" data-dps-zones-copy>Copy Zones</button>
            <button type="button" class="vim-btn" data-dps-zones-clear>Clear Zones</button>
          </div>
        </div>
      </div>

      ${rows.length ? `
        <table class="dps-table">
          <thead>
            <tr>
              <th>Zone</th>
              <th>Time</th>
              <th>XP/hr</th>
              <th>Gold/hr</th>
              <th>Shards/hr</th>
              <th>Kills/hr</th>
              <th>Deaths</th>
              <th>Accuracy</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
                const accuracy = getZoneAccuracy(row);
                const name = formatZoneNameForDisplay(row);
                const isCurrent = row.key === currentKey;

                return `
                  <tr>
                    <td>${isCurrent ? "▶ " : ""}${escapeHtml(name)}</td>
                    <td>${escapeHtml(formatZoneTrackedTime(row))}</td>
                    <td class="dps-blue">${formatNumber(getZoneRate(row, "xp"))}</td>
                    <td class="dps-warn">${formatNumber(getZoneRate(row, "gold"))}</td>
                    <td class="dps-purple">${formatNumber(getZoneRate(row, "shards"))}</td>
                    <td>${formatNumber(getZoneRate(row, "kills"))}</td>
                    <td class="${Number(row.deaths || 0) > 0 ? "dps-bad" : ""}">${formatNumber(row.deaths)}</td>
                    <td class="${accuracy >= 90 ? "dps-good" : accuracy >= 75 ? "dps-warn" : accuracy > 0 ? "dps-bad" : "dps-muted"}">${pct(accuracy)}</td>
                    <td class="dps-muted">${escapeHtml(formatTime(row.lastSeenAt))}</td>
                  </tr>
                `;
            }).join("")}
          </tbody>
        </table>
      ` : `<div class="dps-muted">No zone stats yet. Fight in a zone to start tracking rates, deaths, and accuracy.</div>`}
    `;
        }

        async function copyZoneStats() {
            const rows = getZoneRows(false).filter(zoneRecordHasStats);

            const text = rows.length
                ? [
                    "VoidIdle DPS Coach Zone History",
                    ...rows.map((row) => {
                        const name = formatZoneNameForDisplay(row);
                        return [
                            name,
                            `Time ${formatZoneTrackedTime(row)}`,
                            `XP/hr ${formatNumber(getZoneRate(row, "xp"))}`,
                            `Gold/hr ${formatNumber(getZoneRate(row, "gold"))}`,
                            `Shards/hr ${formatNumber(getZoneRate(row, "shards"))}`,
                            `Kills/hr ${formatNumber(getZoneRate(row, "kills"))}`,
                            `Deaths ${formatNumber(row.deaths)}`,
                            `Accuracy ${pct(getZoneAccuracy(row))}`,
                        ].join(" | ");
                    }),
                ].join("\n")
                : "No zone stats yet.";

            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                console.log(text);
                return false;
            }
        }

        function clearZoneStats() {
            if (!confirm("Clear all saved DPS Coach zone history?")) return false;

            state.zoneStats = {};
            state.lastZoneStatsKey = "";
            state.zoneStatsLastTickAt = 0;
            saveZoneStats();
            return true;
        }

        function renderBuffsTab() {
            return `
      <div class="dps-section">
        <div class="dps-section-title">Your Ability Buffs</div>
        ${state.buffs.length ? state.buffs.map((buff) => `<span class="dps-chip">${escapeHtml(`${buff.icon || ""} ${buff.name || buff.type} ${buff.value != null ? `+${buff.value}` : ""}`)}</span>`).join("") : `<span class="dps-muted">No current ability buffs captured.</span>`}
      </div>

      <div class="dps-section">
        <div class="dps-section-title">Enemy Debuffs</div>
        ${state.enemyDebuffs.length ? state.enemyDebuffs.map((debuff) => `<span class="dps-chip">${escapeHtml(`${debuff.enemy}: ${debuff.type} ${debuff.value ?? ""}`)}</span>`).join("") : `<span class="dps-muted">No enemy debuffs captured.</span>`}
      </div>

      <div class="dps-section">
        <div class="dps-section-title">Party Aura Buffs</div>
        ${Object.entries(state.partyAuraBuffs || {}).length ? Object.entries(state.partyAuraBuffs).map(([key, value]) => `<span class="dps-chip">${escapeHtml(`${key}: ${value}`)}</span>`).join("") : `<span class="dps-muted">No party aura buffs captured.</span>`}
      </div>

      <div class="dps-section">
        <div class="dps-section-title">Active Buffs</div>
        ${state.activeBuffs.length ? state.activeBuffs.map((buff) => `<span class="dps-chip">${escapeHtml(`${buff.buffType || buff.type || "buff"}`)}</span>`).join("") : `<span class="dps-muted">No active buffs captured.</span>`}
      </div>
    `;
        }

        function renderLogsTab() {
            if (!state.logs.length) return `<div class="dps-muted">No logs yet.</div>`;

            return state.logs.map((log) => `
      <div class="dps-log-row">
        <div class="dps-log-time">${escapeHtml(log.time)}</div>
        <div class="dps-log-type ${logTypeClass(log.type)}">${escapeHtml(log.type)}</div>
        <div>${escapeHtml(log.text)}</div>
      </div>
    `).join("");
        }

        function card(label, value, cls = "") {
            return `
      <div class="dps-card">
        <div class="dps-card-label">${escapeHtml(label)}</div>
        <div class="dps-card-value ${cls}">${escapeHtml(value)}</div>
      </div>
    `;
        }

        function scoreClass(score) {
            if (score >= 85) return "dps-good";
            if (score >= 65) return "dps-warn";
            return "dps-bad";
        }

        function logTypeClass(type) {
            if (["AUTO", "CRIT", "ABILITY", "KILL"].includes(type)) return "dps-good";
            if (["MISS", "DEATH"].includes(type)) return "dps-bad";
            if (["CAST"].includes(type)) return "dps-purple";
            if (["HEAL", "REGEN", "AURA", "RELAY"].includes(type)) return "dps-blue";
            return "";
        }

        /******************************************************************
         * UI EVENTS
         ******************************************************************/

        function attachEvents(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            if (panel.dataset.dpsCoachEventsBound === "1") return;
            panel.dataset.dpsCoachEventsBound = "1";

            panel.addEventListener("pointerdown", (event) => {
                const interactive = event.target.closest(
                    "button, input, select, textarea, [data-relay-controls], [data-relay-debug-panel]"
                );

                if (!interactive || !panel.contains(interactive)) return;

                state.uiControlsBusyUntil = Date.now() + 900;
                state.relayControlsBusyUntil = Date.now() + 900;
            });

            panel.addEventListener("mousedown", (event) => {
                const button = event.target.closest("button");
                if (!button || !panel.contains(button)) return;

                state.uiControlsBusyUntil = Date.now() + 900;
                state.relayControlsBusyUntil = Date.now() + 900;

                if (
                    button.closest("[data-relay-controls]") ||
                    button.closest("[data-relay-debug-panel]")
                ) {
                    event.preventDefault();
                }
            });

            panel.addEventListener("input", (event) => {
                const input = event.target.closest("[data-relay-room]");
                if (!input || !panel.contains(input)) return;

                const relay = app?.relay;
                if (!relay) return;

                state.relayControlsBusyUntil = Date.now() + 1200;

                const roomKey = String(input.value || "").trim();

                relay.state.roomKey = roomKey;
                saveRelayRoomKey(roomKey);
            });

            panel.addEventListener("click", async (event) => {
                const target = event.target;
                const relay = app?.relay;

                const tabButton = target.closest("[data-dps-tab]");
                if (tabButton && panel.contains(tabButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.activeTab = tabButton.dataset.dpsTab;
                    renderIntoPanel(app, { forceFullRender: true });
                    return;
                }

                const resetButton = target.closest("[data-dps-reset]");
                if (resetButton && panel.contains(resetButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    resetState();
                    renderIntoPanel(app, { forceFullRender: true });
                    return;
                }

                const copyButton = target.closest("[data-dps-copy]");
                if (copyButton && panel.contains(copyButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    await copySummary();
                    return;
                }

                const zoneCopyButton = target.closest("[data-dps-zones-copy]");
                if (zoneCopyButton && panel.contains(zoneCopyButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.uiControlsBusyUntil = Date.now() + 1200;

                    const copied = await copyZoneStats();
                    zoneCopyButton.textContent = copied ? "Copied!" : "Failed";

                    setTimeout(() => {
                        const currentButton = panel.querySelector("[data-dps-zones-copy]");
                        if (currentButton) currentButton.textContent = "Copy Zones";
                    }, 900);

                    return;
                }

                const zoneClearButton = target.closest("[data-dps-zones-clear]");
                if (zoneClearButton && panel.contains(zoneClearButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.uiControlsBusyUntil = Date.now() + 900;

                    if (clearZoneStats()) {
                        renderIntoPanel(app, { forceFullRender: true });
                    }
                    return;
                }

                const relayDebugCopy = target.closest("[data-relay-debug-copy]");
                if (relayDebugCopy && panel.contains(relayDebugCopy)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.relayControlsBusyUntil = Date.now() + 1200;

                    const copied = await copyRelayDebug();

                    relayDebugCopy.textContent = copied ? "Copied!" : "Failed";

                    setTimeout(() => {
                        const currentButton = panel.querySelector("[data-relay-debug-copy]");
                        if (currentButton) currentButton.textContent = "Copy Debug";
                    }, 900);

                    return;
                }

                const relayDebugClear = target.closest("[data-relay-debug-clear]");
                if (relayDebugClear && panel.contains(relayDebugClear)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.relayControlsBusyUntil = Date.now() + 900;

                    relayDebug.logs = [];
                    renderIntoPanel(app, { forceFullRender: true });
                    return;
                }

                const relayControls = target.closest("[data-relay-controls]");
                if (!relayControls || !panel.contains(relayControls)) return;

                state.relayControlsBusyUntil = Date.now() + 1200;

                const generateButton = target.closest("[data-relay-generate]");
                if (generateButton) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (!relay) {
                        alert("Relay core is not available.");
                        return;
                    }

                    const input = panel.querySelector("[data-relay-room]");
                    const roomKey = relay.generateRoomKey();

                    relay.state.roomKey = roomKey;

                    saveRelaySession({
                        roomKey,
                        shouldReconnect: relay.state.connected || relay.state.connecting,
                    });

                    if (input) input.value = roomKey;

                    try {
                        await navigator.clipboard.writeText(roomKey);
                        addLog("RELAY", "Generated and copied relay room code.");
                    } catch {
                        addLog("RELAY", "Generated relay room code.");
                    }

                    updateRelayControlsOnly(app);
                    return;
                }

                const relayCopyButton = target.closest("[data-relay-copy]");
                if (relayCopyButton) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (!relay) {
                        alert("Relay core is not available.");
                        return;
                    }

                    const input = panel.querySelector("[data-relay-room]");
                    const roomKey = String(input?.value || relay.state.roomKey || loadSavedRelayRoomKey() || "").trim();

                    if (!roomKey) {
                        alert("No relay room code to copy. Generate or enter one first.");
                        return;
                    }

                    relay.state.roomKey = roomKey;
                    saveRelayRoomKey(roomKey);

                    try {
                        await navigator.clipboard.writeText(roomKey);
                        addLog("RELAY", "Copied relay room code.");
                    } catch {
                        console.log(roomKey);
                        alert("Could not copy automatically. Relay code was printed to console.");
                        addLog("RELAY", "Relay room code printed to console.");
                    }

                    updateRelayControlsOnly(app);
                    return;
                }

                const relayConnectButton = target.closest("[data-relay-connect]");
                if (relayConnectButton) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (!relay) {
                        alert("Relay core is not available.");
                        return;
                    }

                    const input = panel.querySelector("[data-relay-room]");

                    if (relay.state.connected || relay.state.connecting) {
                        setRelayReconnectWanted(false);

                        relay.disconnect();
                        addLog("RELAY", "Relay disconnected.");

                        updateRelayControlsOnly(app);
                        return;
                    }

                    const roomKey = String(input?.value || relay.state.roomKey || loadSavedRelayRoomKey() || "").trim();

                    if (!roomKey) {
                        alert("Enter or generate a relay room code first.");
                        return;
                    }

                    relay.state.roomKey = roomKey;

                    saveRelaySession({
                        roomKey,
                        shouldReconnect: true,
                    });

                    relay.connect(roomKey);
                    updateRelayControlsOnly(app);
                    return;
                }

                const relayDebugToggle = target.closest("[data-relay-debug-toggle]");
                if (relayDebugToggle) {
                    event.preventDefault();
                    event.stopPropagation();

                    relayDebug.enabled = !relayDebug.enabled;

                    if (relayDebug.enabled) {
                        addRelayDebugLog("DEBUG", "debuggerEnabled", {
                            relayAvailable: !!relay,
                            connected: !!relay?.state?.connected,
                            connecting: !!relay?.state?.connecting,
                            peerCount: relay?.state?.peerCount || 0,
                            roomKeyPresent: !!relay?.state?.roomKey,
                        });
                    }

                    renderIntoPanel(app, { forceFullRender: true });
                }
            });
        }

        function updateRelayControlsOnly(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            const relayState = app?.relay?.state;
            const status = getRelayStatusShort();

            const input = panel.querySelector("[data-relay-room]");
            const connectButton = panel.querySelector("[data-relay-connect]");
            const statusEl = panel.querySelector("[data-relay-short-status]");
            const debugButton = panel.querySelector("[data-relay-debug-toggle]");

            if (input && document.activeElement !== input) {
                input.value = relayState?.roomKey || loadSavedRelayRoomKey() || "";
            }

            if (connectButton) {
                connectButton.textContent = status.icon;
                connectButton.title = status.title;
                connectButton.style.borderColor = status.border;
            }

            if (statusEl) {
                statusEl.textContent = status.text;
                statusEl.className = status.cls;
            }

            if (debugButton) {
                debugButton.textContent = relayDebug.enabled ? "Debug: on" : "Debug: off";
                debugButton.style.borderColor = relayDebug.enabled
                    ? "rgba(96,165,250,0.75)"
                    : "";
            }
        }

        function renderIntoPanel(app, options = {}) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            const body = panel.querySelector(".vim-body");
            const footer = panel.querySelector(".vim-footer");

            if (!body || !footer) return;

            const forceFullRender = options.forceFullRender === true;
            const activeElement = document.activeElement;

            const uiControlsBusy =
                !forceFullRender &&
                Date.now() < Number(state.uiControlsBusyUntil || 0);

            const relayControlsBusy =
                !forceFullRender &&
                state.activeTab === "team" &&
                Date.now() < Number(state.relayControlsBusyUntil || 0);

            const relayElementFocused =
                !forceFullRender &&
                state.activeTab === "team" &&
                activeElement &&
                panel.contains(activeElement) &&
                (
                    activeElement.closest("[data-relay-controls]") ||
                    activeElement.closest("[data-relay-debug-panel]")
                );

            if (uiControlsBusy || relayControlsBusy || relayElementFocused) {
                if (state.activeTab === "team") {
                    updateRelayControlsOnly(app);
                }
            } else {
                body.innerHTML = render();
                attachEvents(app);
            }

            const stats = getStats();
            const relayStatus = getRelayStatusShort();

            footer.textContent =
                `${state.playerName} | ${formatNumber(state.totalDamage)} dmg | ` +
                `${formatNumber(stats.avgDps)} avg DPS | ${formatNumber(stats.rollingDps)} 10s DPS | ` +
                `${state.logs.length} logs | ${relayStatus.text}`;
        }

        function queueRender(app) {
            if (state.updateQueued) return;

            state.updateQueued = true;

            requestAnimationFrame(() => {
                state.updateQueued = false;

                const panel = app.panels.get(definition.id);
                if (!panel) return;

                const activeElement = document.activeElement;

                const uiControlsBusy =
                    Date.now() < Number(state.uiControlsBusyUntil || 0);

                const relayControlsBusy =
                    state.activeTab === "team" &&
                    Date.now() < Number(state.relayControlsBusyUntil || 0);

                const relayElementFocused =
                    state.activeTab === "team" &&
                    activeElement &&
                    panel.contains(activeElement) &&
                    (
                        activeElement.closest("[data-relay-controls]") ||
                        activeElement.closest("[data-relay-debug-panel]")
                    );

                if (uiControlsBusy || relayControlsBusy || relayElementFocused) {
                    if (state.activeTab === "team") {
                        updateRelayControlsOnly(app);
                    }

                    const footer = panel.querySelector(".vim-footer");

                    if (footer) {
                        const stats = getStats();
                        const relayStatus = getRelayStatusShort();

                        footer.textContent =
                            `${state.playerName} | ${formatNumber(state.totalDamage)} dmg | ` +
                            `${formatNumber(stats.avgDps)} avg DPS | ${formatNumber(stats.rollingDps)} 10s DPS | ` +
                            `${state.logs.length} logs | ${relayStatus.text}`;
                    }

                    return;
                }

                renderIntoPanel(app);
            });
        }

        /******************************************************************
         * RESET / COPY
         ******************************************************************/

        function resetState() {
            const keepActiveTab = state.activeTab;
            const keepTeam = state.team;

            state.playerName = "You";
            state.currentWeaponType = "";
            state.weaponLevel = 0;
            state.weaponXp = 0;
            state.activeAura = "";
            state.zoneId = "";
            state.lastSocketZoneAt = 0;
            state.lastDomZoneAt = 0;
            state.tier = null;

            state.fightStartedAt = 0;
            state.lastCombatAt = 0;
            state.inCombat = false;

            state.hp = 0;
            state.maxHp = 0;
            state.mana = 0;
            state.maxMana = 0;
            state.attackSpeed = 0;

            state.totalDamage = 0;
            state.autoDamage = 0;
            state.abilityDamage = 0;
            state.totalHealing = 0;
            state.totalManaSpent = 0;
            state.totalManaRegen = 0;
            state.totalManaObservedSpent = 0;
            state.totalManaEstimatedSpent = 0;
            state.pendingManaSpentEstimate = 0;
            state.sustainedManaLastAt = 0;

            state.deaths = 0;
            state.wasDead = false;

            state.hits = 0;
            state.crits = 0;
            state.misses = 0;

            state.kills = 0;
            state.xp = 0;
            state.goldEarned = 0;
            state.goldBalance = 0;
            state.spiritShards = 0;

            state.rollingDamageEvents = [];
            state.logs = [];
            state.abilities = new Map();

            state.abilityCooldowns = {};
            state.abilityCdTotals = {};
            state.abilityManaCosts = {};
            state.abilityMeta = {};
            state.activeAbilityIds = [];

            state.buffs = [];
            state.previousBuffKeys = new Set();
            state.partyAuraBuffs = {};
            state.activeBuffs = [];
            state.enemyDebuffs = [];

            state.previousCooldowns = {};
            state.previousMana = null;
            state.previousHp = null;
            state.previousPlayerXp = null;
            state.previousPlayerGold = null;
            state.previousSpiritShards = null;

            state.zoneStats = {};
            state.lastZoneStatsKey = "";
            state.zoneStatsLastTickAt = 0;
            saveZoneStats();

            state.activeTab = keepActiveTab;
            state.team = keepTeam;
        }

        async function copySummary() {
            const stats = getStats();
            const abilities = [...state.abilities.values()].sort((a, b) => b.damage - a.damage);
            const recs = getCoachRecommendations();

            const text = [
                "VoidIdle DPS Coach Summary",
                `Player: ${state.playerName}`,
                `Weapon: ${state.currentWeaponType || "Unknown"}${state.weaponLevel ? ` Lv. ${formatNumber(state.weaponLevel)}` : ""}`,
                `Duration: ${formatDuration(stats.fightSeconds)}`,
                `Damage: ${formatNumber(state.totalDamage)}`,
                `Avg DPS: ${formatNumber(stats.avgDps)}`,
                `10s DPS: ${formatNumber(stats.rollingDps)}`,
                `Auto Damage: ${formatNumber(state.autoDamage)}`,
                `Ability Damage: ${formatNumber(state.abilityDamage)}`,
                `Hits: ${state.hits}`,
                `Misses: ${state.misses}`,
                `Accuracy: ${pct(stats.accuracy)}`,
                `Crit Rate: ${pct(stats.critRate)}`,
                `Deaths: ${state.deaths}`,
                `Mana spent: ${formatNumber(state.totalManaSpent)}`,
                `Mana spent/s: ${formatNumber(stats.manaSpentPerSecond)}`,
                `Observed mana drop: ${formatNumber(state.totalManaObservedSpent)}`,
                `Inferred hidden mana spend: ${formatNumber(state.totalManaEstimatedSpent)}`,
                `Mana regenerated: ${formatNumber(state.totalManaRegen)}`,
                `Mana regen/s: ${formatNumber(stats.manaRegenPerSecond)}`,
                `Kills: ${state.kills}`,
                `XP/hr: ${formatNumber(stats.xpPerHour)}`,
                `Gold earned: ${formatNumber(state.goldEarned)}`,
                `Gold/hr: ${formatNumber(stats.goldPerHour)}`,
                "",
                "Abilities:",
                ...abilities.map((a) => `- ${a.name}: ${formatNumber(a.damage)} dmg, ${a.casts} casts, ${formatNumber(a.casts ? a.damage / a.casts : 0)} avg`),
                "",
                "Coach:",
                ...recs.map((r) => `- ${r.text}`),
            ].join("\n");

            try {
                await navigator.clipboard.writeText(text);
                alert("Copied DPS summary.");
            } catch {
                console.log(text);
                alert("Could not copy automatically. Summary printed to console.");
            }
        }

        /******************************************************************
         * MODULE API
         ******************************************************************/


        /******************************************************************
         * WORLD BOSS WS PATCH — direct combat/corpse packets
         ******************************************************************/

        function normalizeWsRole(role, damage = 0, corpseDamage = 0) {
            const raw = clean(role).toLowerCase();
            if (raw === "lifeskill" || raw === "gathering") return "lifeskill";
            if (raw === "combat" || raw === "fighter" || raw === "fighting") return "combat";
            if (Number(corpseDamage || 0) > 0) return "lifeskill";
            if (Number(damage || 0) > 0) return "combat";
            return raw || "combat";
        }

        function normalizeParticipant(participant) {
            const damage = Number(participant.damage || 0);
            const corpseDamage = Number(participant.corpseDamage || participant.harvestDamage || 0);

            return {
                playerId: clean(participant.playerId || participant.id || ""),
                name: clean(participant.name || participant.username || ""),
                level: Number(participant.level || 0),
                firstSeenAt: Number(participant.firstSeenAt || participant.joinedAt || now()),
                lastSeenAt: Number(participant.lastSeenAt || participant.lastAttackAt || participant.lastHarvestAt || now()),
                hpPct: Number(participant.hpPct || (Number(participant.maxHp || 0) ? (Number(participant.hp || 0) / Number(participant.maxHp || 1)) * 100 : 0)),
                hp: Number(participant.hp || 0),
                maxHp: Number(participant.maxHp || 0),
                isZerk: participant.isZerk === true || participant.zerkActive === true,
                image: String(participant.image || ""),
                role: normalizeWsRole(participant.role, damage, corpseDamage),
                damage,
                corpseDamage,
                contribution: Number(participant.contribution || 0),
                lastDmgTaken: Number(participant.lastDmgTaken || 0),
                lastDmgToBoss: Number(participant.lastDmgToBoss || 0),
                lastAttackAt: Number(participant.lastAttackAt || 0),
                attackSpeed: Number(participant.attackSpeed || 0),
                recovering: participant.recovering === true,
                lastHit: participant.lastHit === true,
                lastCrit: participant.lastCrit === true,
                lastHarvestAt: Number(participant.lastHarvestAt || 0),
                harvestTickMs: Number(participant.harvestTickMs || 0),
                isYou: participant.isYou === true,
            };
        }

        function normalizeLeaderboardRow(row) {
            return {
                rank: clean(row.rank || ""),
                name: clean(row.name || row.username || ""),
                playerId: clean(row.playerId || ""),
                damageText: clean(row.damageText || ""),
                damage: Number(row.damage || parseNumberText(row.damageText) || 0),
                corpseDamageText: clean(row.corpseDamageText || ""),
                corpseDamage: Number(row.corpseDamage || parseNumberText(row.corpseDamageText) || 0),
                contribution: Number(row.contribution || 0),
                dpsText: clean(row.dpsText || ""),
                dps: Number(row.dps || parseNumberText(String(row.dpsText || "").replace(/\/s$/i, "")) || 0),
                role: normalizeWsRole(row.role, row.damage, row.corpseDamage),
                isYou: row.isYou === true,
            };
        }

        function normalizeBossRecord(boss) {
            const record = {
                id: String(boss.id || boss.sourceId || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
                sourceId: clean(boss.sourceId || boss.worldBossId || boss.serverId || ""),
                sessionKey: clean(boss.sessionKey || bossSessionKey(boss)),
                signature: String(boss.signature || bossSignature(boss.name, boss.level, boss.maxHp)),
                name: clean(boss.name || "Unknown Boss"),
                level: Number(boss.level || 0),
                maxHp: Number(boss.maxHp || 0),
                currentHp: Number(boss.currentHp || 0),
                hpPct: Number(boss.hpPct || 0),
                corpseHp: Number(boss.corpseHp || boss.currentHp || 0),
                corpseMaxHp: Number(boss.corpseMaxHp || 0),
                corpseEndsAt: Number(boss.corpseEndsAt || 0),
                queuedAt: Number(boss.queuedAt || 0),
                expectedSpawnAt: Number(boss.expectedSpawnAt || 0),
                spawnedAt: Number(boss.spawnedAt || boss.firstSeenAt || now()),
                firstSeenAt: Number(boss.firstSeenAt || boss.spawnedAt || now()),
                lastSeenAt: Number(boss.lastSeenAt || now()),
                endedAt: Number(boss.endedAt || boss.killedAt || 0),
                killedAt: Number(boss.killedAt || boss.endedAt || 0),
                corpseAt: Number(boss.corpseAt || 0),
                gatheringStartedAt: Number(boss.gatheringStartedAt || 0),
                role: clean(boss.role || "fighting"),
                phase: clean(boss.phase || (boss.active ? "combat" : "ended")),
                active: boss.active === true,
                fightersCount: Number(boss.fightersCount || 0),
                lifeskillCount: Number(boss.lifeskillCount || 0),
                participantCount: Number(boss.participantCount || 0),
                myName: clean(boss.myName || ""),
                myRank: clean(boss.myRank || ""),
                myDamage: clean(boss.myDamage || ""),
                myDps: clean(boss.myDps || ""),
                participants: Array.isArray(boss.participants) ? boss.participants.map(normalizeParticipant).filter((p) => p.name) : [],
                leaderboard: Array.isArray(boss.leaderboard) ? boss.leaderboard.map(normalizeLeaderboardRow).filter((p) => p.name) : [],
                lifeskillLeaderboard: Array.isArray(boss.lifeskillLeaderboard) ? boss.lifeskillLeaderboard.map(normalizeLeaderboardRow).filter((p) => p.name) : [],
                snapshots: Array.isArray(boss.snapshots) ? boss.snapshots.slice(-30) : [],
            };

            rebuildBossLeaderboards(record, { preserveExisting: true });
            return record;
        }

        function participantKey(player) {
            return clean(player.playerId || "") || normalizeName(player.name || "");
        }

        function upsertParticipants(boss, participants) {
            const byKey = new Map();

            for (const old of boss.participants || []) {
                const normalized = normalizeParticipant(old);
                const key = participantKey(normalized);
                if (key) byKey.set(key, normalized);
            }

            for (const incomingRaw of participants || []) {
                const incoming = normalizeParticipant(incomingRaw);
                const key = participantKey(incoming);
                if (!key || !incoming.name) continue;

                const existing = byKey.get(key);
                byKey.set(key, {
                    ...existing,
                    ...incoming,
                    firstSeenAt: existing?.firstSeenAt || incoming.firstSeenAt || now(),
                    lastSeenAt: Math.max(Number(existing?.lastSeenAt || 0), Number(incoming.lastSeenAt || now()), now()),
                    damage: Math.max(Number(existing?.damage || 0), Number(incoming.damage || 0)),
                    corpseDamage: Math.max(Number(existing?.corpseDamage || 0), Number(incoming.corpseDamage || 0)),
                    contribution: Math.max(Number(existing?.contribution || 0), Number(incoming.contribution || 0)),
                    role: incoming.role || existing?.role || "combat",
                });
            }

            boss.participants = [...byKey.values()].sort((a, b) => {
                const roleDiff = (a.role === "combat" ? 0 : 1) - (b.role === "combat" ? 0 : 1);
                if (roleDiff) return roleDiff;
                return Number(b.damage || b.corpseDamage || 0) - Number(a.damage || a.corpseDamage || 0) || a.name.localeCompare(b.name);
            });

            rebuildBossLeaderboards(boss);
        }

        function rebuildBossLeaderboards(boss, options = {}) {
            const participants = Array.isArray(boss.participants) ? boss.participants.map(normalizeParticipant) : [];

            const fighters = participants
                .filter((p) => p.name && (p.role === "combat" || Number(p.damage || 0) > 0))
                .sort((a, b) => Number(b.damage || 0) - Number(a.damage || 0));

            const lifeskillers = participants
                .filter((p) => p.name && (p.role === "lifeskill" || Number(p.corpseDamage || 0) > 0))
                .sort((a, b) => Number(b.corpseDamage || 0) - Number(a.corpseDamage || 0));

            if (fighters.length || !options.preserveExisting) {
                boss.leaderboard = fighters.map((p, index) => ({
                    rank: `#${index + 1}`,
                    playerId: p.playerId,
                    name: p.name,
                    damage: Number(p.damage || 0),
                    damageText: formatCompactNumber(p.damage || 0),
                    contribution: Number(p.contribution || 0),
                    dps: 0,
                    dpsText: "",
                    role: "combat",
                    isYou: p.isYou === true || (boss.myName && normalizeName(p.name) === normalizeName(boss.myName)),
                }));
            }

            if (lifeskillers.length || !options.preserveExisting) {
                boss.lifeskillLeaderboard = lifeskillers.map((p, index) => ({
                    rank: `#${index + 1}`,
                    playerId: p.playerId,
                    name: p.name,
                    corpseDamage: Number(p.corpseDamage || 0),
                    corpseDamageText: formatCompactNumber(p.corpseDamage || 0),
                    contribution: Number(p.contribution || 0),
                    role: "lifeskill",
                    isYou: p.isYou === true || (boss.myName && normalizeName(p.name) === normalizeName(boss.myName)),
                }));
            }

            boss.fightersCount = Math.max(Number(boss.fightersCount || 0), fighters.length);
            boss.lifeskillCount = Math.max(Number(boss.lifeskillCount || 0), lifeskillers.length);
            boss.participantCount = Math.max(Number(boss.participantCount || 0), participants.length);
        }

        function findBossBySourceId(sourceId) {
            const id = clean(sourceId || "");
            if (!id) return null;
            return state.history.find((boss) => clean(boss.sourceId) === id || clean(boss.id) === id || clean(boss.sessionKey) === `server:${id}`) || null;
        }

        function getOrCreateBossFromSource(sourceId, seed = {}) {
            const id = clean(sourceId || seed.sourceId || seed.id || "");
            let boss = findBossBySourceId(id) || findActiveBoss();

            if (!boss) {
                boss = normalizeBossRecord({
                    ...seed,
                    id: id || seed.id,
                    sourceId: id,
                    worldBossId: id,
                    serverId: id,
                    sessionKey: id ? `server:${id}` : bossSessionKey(seed),
                    name: seed.name || state.queuedBoss?.name || "World Boss",
                    level: seed.level || state.queuedBoss?.level || 0,
                    firstSeenAt: now(),
                    spawnedAt: seed.spawnedAt || seed.fightStartsAt || now(),
                    lastSeenAt: now(),
                    active: true,
                    phase: seed.phase || "combat",
                    role: state.role,
                    participants: [],
                    leaderboard: [],
                    lifeskillLeaderboard: [],
                    snapshots: [],
                });
                state.history.unshift(boss);
            }

            if (id && !boss.sourceId) boss.sourceId = id;
            if (id && !boss.sessionKey) boss.sessionKey = `server:${id}`;
            state.selectedBossId = state.selectedBossId || boss.id;
            return boss;
        }

        function convertWsParticipant(p, ts = now()) {
            return normalizeParticipant({
                playerId: p?.playerId || "",
                name: p?.username || p?.name || "",
                level: p?.level || 0,
                hp: p?.hp || 0,
                maxHp: p?.maxHp || 0,
                role: p?.role || "",
                damage: p?.damage || 0,
                corpseDamage: p?.corpseDamage || 0,
                contribution: p?.contribution || 0,
                lastDmgTaken: p?.lastDmgTaken || 0,
                lastDmgToBoss: p?.lastDmgToBoss || 0,
                lastAttackAt: p?.lastAttackAt || 0,
                attackSpeed: p?.attackSpeed || 0,
                recovering: p?.recovering === true,
                zerkActive: p?.zerkActive === true,
                joinedAt: p?.joinedAt || ts,
                lastHarvestAt: p?.lastHarvestAt || 0,
                harvestTickMs: p?.harvestTickMs || 0,
                firstSeenAt: p?.joinedAt || ts,
                lastSeenAt: Math.max(Number(p?.lastAttackAt || 0), Number(p?.lastHarvestAt || 0), ts),
                lastHit: p?.lastHit === true,
                lastCrit: p?.lastCrit === true,
            });
        }

        function applyHitDeltasToBoss(boss, hits, ts) {
            if (!Array.isArray(hits) || !hits.length) return;

            const byKey = new Map((boss.participants || []).map((p) => [participantKey(normalizeParticipant(p)), normalizeParticipant(p)]));

            for (const hit of hits) {
                const incoming = convertWsParticipant({
                    playerId: hit.playerId,
                    username: hit.username,
                    role: "combat",
                    damage: 0,
                    lastDmgToBoss: Number(hit.dmg || 0),
                    lastAttackAt: ts,
                    lastHit: true,
                    lastCrit: hit.crit === true,
                }, ts);
                const key = participantKey(incoming);
                if (!key || !incoming.name) continue;

                const existing = byKey.get(key) || incoming;
                existing.damage = Number(existing.damage || 0) + Number(hit.dmg || 0);
                existing.lastDmgToBoss = Number(hit.dmg || 0);
                existing.lastAttackAt = ts;
                existing.lastSeenAt = ts;
                existing.lastHit = true;
                existing.lastCrit = hit.crit === true;
                existing.role = "combat";
                byKey.set(key, existing);
            }

            boss.participants = [...byKey.values()];
            rebuildBossLeaderboards(boss);
        }

        function updateBossFromWorldBossPayload(wb) {
            const phase = worldBossPhaseFromPayload(wb);
            const ts = now();
            const sourceId = clean(wb.id || "");

            if (phase === "queue") {
                state.queuedBoss = {
                    id: sourceId,
                    sourceId,
                    sessionKey: sourceId ? `server:${sourceId}` : bossSessionKey(wb),
                    name: clean(wb.name || "World Boss"),
                    level: Number(wb.level || 0),
                    queuedAt: Number(state.queuedBoss?.queuedAt || ts),
                    expectedSpawnAt: Number(wb.fightStartsAt || 0),
                    fightersCount: Number(wb.combatCount || 0),
                    queuedCount: Number(wb.queueCount || 0),
                    lifeskillCount: Number(wb.lifeskillCount || 0),
                    timerText: Number(wb.fightStartsAt || 0) ? `Fight in ${formatDuration(Number(wb.fightStartsAt || 0) - ts)}` : "Queued",
                    fightersText: `⚔ ${Number(wb.combatCount || 0)} · 🌾 ${Number(wb.lifeskillCount || 0)} queued`,
                    lastSeenAt: ts,
                };
                return true;
            }

            const boss = getOrCreateBossFromSource(sourceId, {
                ...wb,
                name: clean(wb.name || "World Boss"),
                level: Number(wb.level || 0),
                maxHp: Number(wb.maxHp || 0),
                currentHp: Number(wb.hp || 0),
                spawnedAt: phase === "combat" ? Number(wb.fightStartsAt || ts) : 0,
                phase,
            });

            boss.name = clean(wb.name || boss.name || "World Boss");
            boss.level = Number(wb.level || boss.level || 0);
            boss.maxHp = Math.max(Number(boss.maxHp || 0), Number(wb.maxHp || 0));
            boss.currentHp = Number(wb.hp ?? boss.currentHp ?? 0);
            boss.hpPct = boss.maxHp ? (boss.currentHp / boss.maxHp) * 100 : Number(boss.hpPct || 0);
            boss.corpseHp = Number(wb.corpseHp || boss.corpseHp || 0);
            boss.corpseMaxHp = Number(wb.corpseMaxHp || boss.corpseMaxHp || 0);
            boss.corpseEndsAt = Number(wb.corpseEndsAt || boss.corpseEndsAt || 0);
            boss.expectedSpawnAt = Number(wb.fightStartsAt || boss.expectedSpawnAt || 0);
            boss.lastSeenAt = ts;
            boss.role = state.role;
            boss.phase = phase;
            boss.fightersCount = Math.max(Number(boss.fightersCount || 0), Number(wb.combatCount || 0));
            boss.lifeskillCount = Math.max(Number(boss.lifeskillCount || 0), Number(wb.lifeskillCount || 0));
            boss.participantCount = Math.max(Number(boss.participantCount || 0), Number(wb.participantCount || 0));

            if (Array.isArray(wb.participants)) {
                upsertParticipants(boss, wb.participants.map((p) => convertWsParticipant(p, ts)));
            }

            if (phase === "combat") {
                boss.active = true;
                boss.endedAt = 0;
                boss.killedAt = 0;
                boss.spawnedAt = boss.spawnedAt || Number(wb.fightStartsAt || ts);
                state.activeBossId = boss.id;
                state.selectedBossId = state.selectedBossId || boss.id;
                state.queuedBoss = null;
            }

            if (phase === "corpse" || phase === "gathering") {
                boss.corpseAt = boss.corpseAt || ts;
                boss.killedAt = boss.killedAt || boss.corpseAt;
                if (state.role === "fighting") {
                    boss.active = false;
                    boss.endedAt = boss.endedAt || boss.corpseAt;
                    state.activeBossId = "";
                } else {
                    boss.active = true;
                    boss.gatheringStartedAt = boss.gatheringStartedAt || boss.corpseAt;
                    state.activeBossId = boss.id;
                }
                state.corpse = {
                    id: sourceId,
                    name: boss.name,
                    level: boss.level,
                    currentHp: boss.corpseHp || boss.currentHp || 0,
                    maxHp: boss.corpseMaxHp || boss.maxHp || 0,
                    hpPct: boss.corpseMaxHp ? (boss.corpseHp / boss.corpseMaxHp) * 100 : 100,
                    opensAt: boss.corpseEndsAt || 0,
                    seenAt: ts,
                    hint: "WS corpse phase",
                };
            }

            boss.snapshots = [
                ...(boss.snapshots || []),
                {
                    ts,
                    phase,
                    currentHp: boss.currentHp,
                    maxHp: boss.maxHp,
                    hpPct: boss.hpPct,
                    corpseHp: boss.corpseHp,
                    corpseMaxHp: boss.corpseMaxHp,
                    queueCount: Number(wb.queueCount || 0),
                    participantCount: Number(wb.participantCount || 0),
                    combatCount: Number(wb.combatCount || 0),
                    lifeskillCount: Number(wb.lifeskillCount || 0),
                },
            ].slice(-30);

            rebuildBossLeaderboards(boss, { preserveExisting: true });
            dedupeBossHistory();
            saveHistory();
            return true;
        }

        function handleWorldBossSocketMessage(msg) {
            if (!msg || typeof msg !== "object") return false;
            const type = clean(msg.type);
            const ts = Number(msg.serverTs || now());

            if (type === "worldBossCombatTick") {
                const boss = getOrCreateBossFromSource(msg.bossId, { phase: "combat" });
                boss.currentHp = Number(msg.bossHp ?? boss.currentHp ?? 0);
                boss.hpPct = boss.maxHp ? (boss.currentHp / boss.maxHp) * 100 : boss.hpPct;
                boss.phase = "combat";
                boss.active = true;
                boss.lastSeenAt = ts;
                boss.role = state.role;
                boss.spawnedAt = boss.spawnedAt || ts;
                boss.firstSeenAt = boss.firstSeenAt || ts;
                applyHitDeltasToBoss(boss, msg.hits, ts);
                state.activeBossId = boss.id;
                state.selectedBossId = state.selectedBossId || boss.id;
                state.queuedBoss = null;
                saveHistory();
                return true;
            }

            if (type === "worldBossPhase") {
                const boss = getOrCreateBossFromSource(msg.bossId, { phase: msg.phase || "corpse" });
                const phase = clean(msg.phase).toLowerCase();
                boss.lastSeenAt = ts;
                boss.corpseEndsAt = Number(msg.corpseEndsAt || boss.corpseEndsAt || 0);
                boss.corpseHp = Number(msg.corpseHp || boss.corpseHp || 0);
                boss.corpseMaxHp = Number(msg.corpseMaxHp || boss.corpseMaxHp || 0);

                if (phase === "corpse") {
                    boss.phase = state.role === "gathering" ? "gathering" : "corpse";
                    boss.corpseAt = boss.corpseAt || ts;
                    boss.killedAt = boss.killedAt || boss.corpseAt;
                    boss.currentHp = 0;
                    boss.hpPct = 0;

                    if (state.role === "fighting") {
                        boss.active = false;
                        boss.endedAt = boss.endedAt || boss.corpseAt;
                        state.activeBossId = "";
                    } else {
                        boss.active = true;
                        boss.gatheringStartedAt = boss.gatheringStartedAt || boss.corpseAt;
                        state.activeBossId = boss.id;
                    }

                    state.corpse = {
                        id: clean(msg.bossId || ""),
                        name: boss.name,
                        level: boss.level,
                        currentHp: boss.corpseHp,
                        maxHp: boss.corpseMaxHp,
                        hpPct: boss.corpseMaxHp ? (boss.corpseHp / boss.corpseMaxHp) * 100 : 100,
                        opensAt: boss.corpseEndsAt || 0,
                        seenAt: ts,
                        hint: "WS worldBossPhase corpse",
                    };
                } else {
                    boss.phase = phase || boss.phase;
                }

                saveHistory();
                return true;
            }

            if (type === "worldBossCorpseTick") {
                const boss = getOrCreateBossFromSource(msg.bossId, { phase: "corpse" });
                boss.phase = state.role === "gathering" ? "gathering" : "corpse";
                boss.corpseAt = boss.corpseAt || ts;
                boss.killedAt = boss.killedAt || boss.corpseAt;
                boss.lastSeenAt = ts;
                boss.currentHp = 0;
                boss.hpPct = 0;
                boss.corpseHp = Number(msg.corpseHp || boss.corpseHp || 0);
                boss.corpseMaxHp = Number(msg.corpseMaxHp || boss.corpseMaxHp || 0);
                boss.corpseEndsAt = Number(msg.corpseEndsAt || boss.corpseEndsAt || 0);

                if (Array.isArray(msg.participants)) {
                    upsertParticipants(boss, msg.participants.map((p) => convertWsParticipant(p, ts)));
                }

                if (Array.isArray(msg.harvests) && msg.harvests.length) {
                    const harvestParticipants = msg.harvests.map((h) => ({
                        playerId: h.playerId,
                        name: h.username,
                        username: h.username,
                        role: "lifeskill",
                        corpseDamage: Number(h.corpseDamage || h.dmg || 0),
                        lastHarvestAt: ts,
                    }));
                    upsertParticipants(boss, harvestParticipants);
                }

                rebuildBossLeaderboards(boss);

                if (state.role === "fighting") {
                    boss.active = false;
                    boss.endedAt = boss.endedAt || boss.corpseAt;
                    state.activeBossId = "";
                } else {
                    boss.active = true;
                    boss.gatheringStartedAt = boss.gatheringStartedAt || boss.corpseAt;
                    state.activeBossId = boss.id;
                }

                state.corpse = {
                    id: clean(msg.bossId || ""),
                    name: boss.name,
                    level: boss.level,
                    currentHp: boss.corpseHp,
                    maxHp: boss.corpseMaxHp,
                    hpPct: boss.corpseMaxHp ? (boss.corpseHp / boss.corpseMaxHp) * 100 : 100,
                    opensAt: boss.corpseEndsAt || 0,
                    seenAt: ts,
                    hint: "WS corpse tick",
                };

                saveHistory();
                return true;
            }

            return false;
        }

        function renderBossDetail(boss, options = {}) {
            const current = state.detailSubTab === "lifeskill" ? "lifeskill" : "fighters";
            return `
                <div class="bt-tabs" style="margin-top:10px;">
                    <button type="button" class="bt-tab ${current === "fighters" ? "active" : ""}" data-bt-subtab="fighters">Fighters (${boss.leaderboard.length})</button>
                    <button type="button" class="bt-tab ${current === "lifeskill" ? "active" : ""}" data-bt-subtab="lifeskill">Lifeskillers (${(boss.lifeskillLeaderboard || []).length})</button>
                </div>
                ${current === "lifeskill" ? renderLifeskillLeaderboard(boss, options) : renderLeaderboard(boss, options)}
                ${renderParticipants(boss, options)}
            `;
        }

        function renderLeaderboard(boss, options = {}) {
            const rowsAll = (boss.leaderboard || []).slice().sort((a, b) => Number(b.damage || 0) - Number(a.damage || 0));
            if (!rowsAll.length) {
                return `
                    <div class="bt-section">
                        <div class="bt-section-title">Fighter Damage Leaderboard</div>
                        <div class="bt-muted">No fighter damage captured yet. Direct <code>worldBossCombatTick</code> and corpse participant packets will fill this table.</div>
                    </div>
                `;
            }

            const rows = options.compact ? rowsAll.slice(0, 25) : rowsAll;
            return `
                <div class="bt-section">
                    <div class="bt-section-title">Fighter Damage Leaderboard ${options.compact && rowsAll.length > rows.length ? `(Top ${rows.length}/${rowsAll.length})` : `(${rowsAll.length})`}</div>
                    <div class="bt-scroll">
                        <table class="bt-table">
                            <thead><tr><th>Rank</th><th>Name</th><th>Damage Done</th><th>Contribution</th><th>DPS</th></tr></thead>
                            <tbody>
                                ${rows.map((row, index) => `
                                    <tr class="${row.isYou ? "bt-good" : ""}">
                                        <td>${escapeHtml(row.rank || `#${index + 1}`)}</td>
                                        <td>${escapeHtml(row.name)}</td>
                                        <td>${escapeHtml(row.damageText || formatCompactNumber(row.damage))}</td>
                                        <td>${escapeHtml(row.contribution ? `${(Number(row.contribution) * 100).toFixed(2)}%` : "—")}</td>
                                        <td>${escapeHtml(row.dpsText || (row.dps ? formatCompactNumber(row.dps) : "—"))}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        function renderLifeskillLeaderboard(boss, options = {}) {
            const rowsAll = (boss.lifeskillLeaderboard || []).slice().sort((a, b) => Number(b.corpseDamage || 0) - Number(a.corpseDamage || 0));
            if (!rowsAll.length) {
                return `
                    <div class="bt-section">
                        <div class="bt-section-title">Lifeskill Corpse Leaderboard</div>
                        <div class="bt-muted">No corpse harvesting captured yet. This fills from <code>worldBossCorpseTick.harvests</code> and corpse participants.</div>
                    </div>
                `;
            }

            const rows = options.compact ? rowsAll.slice(0, 25) : rowsAll;
            return `
                <div class="bt-section">
                    <div class="bt-section-title">Lifeskill Corpse Leaderboard ${options.compact && rowsAll.length > rows.length ? `(Top ${rows.length}/${rowsAll.length})` : `(${rowsAll.length})`}</div>
                    <div class="bt-scroll">
                        <table class="bt-table">
                            <thead><tr><th>Rank</th><th>Name</th><th>Corpse Damage</th><th>Contribution</th></tr></thead>
                            <tbody>
                                ${rows.map((row, index) => `
                                    <tr class="${row.isYou ? "bt-good" : ""}">
                                        <td>${escapeHtml(row.rank || `#${index + 1}`)}</td>
                                        <td>${escapeHtml(row.name)}</td>
                                        <td>${escapeHtml(row.corpseDamageText || formatCompactNumber(row.corpseDamage))}</td>
                                        <td>${escapeHtml(row.contribution ? `${(Number(row.contribution) * 100).toFixed(2)}%` : "—")}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        function renderParticipants(boss, options = {}) {
            const mode = state.detailSubTab === "lifeskill" ? "lifeskill" : "combat";
            const listAll = (boss.participants || []).filter((player) => mode === "lifeskill" ? (player.role === "lifeskill" || Number(player.corpseDamage || 0) > 0) : (player.role === "combat" || Number(player.damage || 0) > 0));
            const participants = options.compact ? listAll.slice(0, 120) : listAll;
            const title = mode === "lifeskill" ? "Joined Lifeskillers" : "Joined Fighters";

            return `
                <div class="bt-section">
                    <div class="bt-section-title">${title} (${listAll.length})</div>
                    ${participants.length
                        ? participants.map((player) => `
                            <span class="bt-pill" title="First seen ${escapeHtml(formatTime(player.firstSeenAt))} · Last seen ${escapeHtml(formatTime(player.lastSeenAt))}">
                                ${player.isZerk ? "🔥 " : ""}${escapeHtml(player.name)}${player.level ? ` · Lv ${Number(player.level)}` : ""}${mode === "lifeskill" ? ` · ${formatCompactNumber(player.corpseDamage || 0)}` : ` · ${formatCompactNumber(player.damage || 0)}`}
                            </span>
                        `).join("")
                        : `<div class="bt-muted">No ${mode === "lifeskill" ? "lifeskillers" : "fighters"} captured yet.</div>`
                    }
                </div>
            `;
        }

        function renderHistoryButton(boss) {
            const active = boss.id === state.selectedBossId;
            const status = boss.active ? "Live" : boss.endedAt ? "Ended" : "Seen";
            const duration = formatDuration((boss.endedAt || boss.lastSeenAt || now()) - (boss.spawnedAt || boss.firstSeenAt));
            const checked = state.copyIds?.has?.(boss.id);

            return `
                <div style="display:flex;align-items:stretch;gap:6px;margin-bottom:6px;">
                    <label class="bt-row-btn" style="width:auto;display:flex;align-items:center;margin:0;padding:0 8px;">
                        <input type="checkbox" data-bt-copy-toggle="${escapeHtml(boss.id)}" ${checked ? "checked" : ""} title="Include in Copy Checked" />
                    </label>
                    <button type="button" class="bt-row-btn ${active ? "active" : ""}" data-bt-select="${escapeHtml(boss.id)}" style="margin:0;">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                            <div>
                                <b>${escapeHtml(boss.name)}${boss.level ? ` Lv ${boss.level}` : ""}</b><br />
                                <span class="bt-muted">
                                    ${phaseLabel(boss.phase)} · ${roleLabel(boss.role)} · Spawned ${formatDateTime(boss.spawnedAt || boss.firstSeenAt)} · Corpse ${boss.corpseAt ? formatDateTime(boss.corpseAt) : "—"} · Killed ${boss.killedAt || boss.endedAt ? formatDateTime(boss.killedAt || boss.endedAt) : "—"} · ${duration}
                                </span><br />
                                <span class="bt-muted">${boss.fightersCount || boss.leaderboard.length} fighters · ${(boss.lifeskillCount || (boss.lifeskillLeaderboard || []).length)} lifeskillers · ${boss.leaderboard.length} fighter rows · ${(boss.lifeskillLeaderboard || []).length} corpse rows</span>
                            </div>
                            <div class="${boss.active ? "bt-good" : "bt-muted"}">${status}</div>
                        </div>
                    </button>
                </div>
            `;
        }

        function bossToText(boss) {
            if (!boss) return "No boss selected.";
            rebuildBossLeaderboards(boss, { preserveExisting: true });

            const lines = [];
            lines.push(`Boss: ${boss.name}${boss.level ? ` Lv ${boss.level}` : ""}`);
            if (boss.sourceId) lines.push(`Boss ID: ${boss.sourceId}`);
            lines.push(`Mode: ${roleLabel(boss.role)}`);
            lines.push(`Phase: ${phaseLabel(boss.phase)}`);
            lines.push(`Spawned: ${formatDateTime(boss.spawnedAt || boss.firstSeenAt)}`);
            if (boss.corpseAt) lines.push(`Corpse: ${formatDateTime(boss.corpseAt)}`);
            if (boss.gatheringStartedAt) lines.push(`Gathering started: ${formatDateTime(boss.gatheringStartedAt)}`);
            lines.push(`Killed: ${boss.killedAt || boss.endedAt ? formatDateTime(boss.killedAt || boss.endedAt) : "active"}`);
            lines.push(`Duration: ${formatDuration((boss.killedAt || boss.endedAt || boss.lastSeenAt || now()) - (boss.spawnedAt || boss.firstSeenAt))}`);
            lines.push(`Boss HP: ${formatCompactNumber(boss.currentHp)} / ${formatCompactNumber(boss.maxHp)} (${Number(boss.hpPct || 0).toFixed(1)}%)`);
            if (boss.corpseMaxHp) lines.push(`Corpse HP: ${formatCompactNumber(boss.corpseHp)} / ${formatCompactNumber(boss.corpseMaxHp)}`);
            lines.push(`Fighters: ${boss.fightersCount || boss.leaderboard.length}`);
            lines.push(`Lifeskillers: ${boss.lifeskillCount || (boss.lifeskillLeaderboard || []).length}`);

            lines.push("");
            lines.push("Fighter Damage Leaderboard:");
            if (boss.leaderboard.length) {
                for (const row of boss.leaderboard) {
                    const contribution = row.contribution ? ` · ${(Number(row.contribution) * 100).toFixed(2)}%` : "";
                    lines.push(`${row.rank || ""} ${row.name}: ${row.damageText || formatCompactNumber(row.damage)} damage${contribution}${row.dpsText ? ` · ${row.dpsText}` : ""}`.trim());
                }
            } else {
                lines.push("No fighter leaderboard captured.");
            }

            lines.push("");
            lines.push("Lifeskill Corpse Leaderboard:");
            if ((boss.lifeskillLeaderboard || []).length) {
                for (const row of boss.lifeskillLeaderboard) {
                    const contribution = row.contribution ? ` · ${(Number(row.contribution) * 100).toFixed(2)}%` : "";
                    lines.push(`${row.rank || ""} ${row.name}: ${row.corpseDamageText || formatCompactNumber(row.corpseDamage)} corpse damage${contribution}`.trim());
                }
            } else {
                lines.push("No corpse leaderboard captured.");
            }

            return lines.join("\n");
        }

        async function copySelectedBoss(app) {
            const selectedIds = state.copyIds && state.copyIds.size ? [...state.copyIds] : [];
            const bosses = selectedIds.length
                ? state.history.filter((boss) => selectedIds.includes(boss.id))
                : [findSelectedBoss()].filter(Boolean);

            const text = bosses.length
                ? bosses.map(bossToText).join("\n\n==============================\n\n")
                : "No boss selected.";

            try {
                await navigator.clipboard.writeText(text);
                state.lastExportAt = now();
                showMessage(app, selectedIds.length ? `Copied ${bosses.length} checked bosses.` : "Copied selected boss.", "#69f0ae");
            } catch {
                console.log(text);
                alert("Could not copy automatically. Boss text was printed to console.");
            }
        }

        return {
            ...definition,

            init(app) {
                appRef = app;

                state.zoneStats = loadZoneStats();

                syncSavedRelayRoomKeyToRelay(app);
                installRelayDebugger(app);

                app.events.on("fullState", (msg) => {
                    handleFullState(msg);
                    queueRender(app);
                });

                app.events.on("partyTick", (msg) => {
                    handlePartyTick(msg);
                    queueRender(app);
                });

                app.events.on("auraRegen", (msg) => {
                    handleAuraRegen(msg);
                    queueRender(app);
                });

                app.events.on("auraXpGain", (msg) => {
                    handleAuraXpGain(msg);
                    queueRender(app);
                });

                app.events.on("relay:ready", () => {
                    saveRelaySession({
                        roomKey: app.relay.state.roomKey || loadSavedRelayRoomKey(),
                        shouldReconnect: true,
                    });

                    addLog("RELAY", "Relay connected.");

                    sendRelayHelloIfReady(true);
                    sendTeamSnapshot(true);
                    queueRender(app);
                });

                app.events.on("relay:status", (status) => {
                    if (!status?.connected) {
                        state.relayHelloSent = false;
                    } else {
                        sendRelayHelloIfReady();
                    }

                    queueRender(app);
                });

                app.events.on("relay:peers", () => {
                    queueRender(app);
                });

                app.events.on("relay:hello", (msg) => {
                    const name = msg.name || msg.username || msg.caster || "Ally";

                    if (!isPlaceholderPlayerName(name) && normalizeTeamName(name) !== normalizeTeamName(state.playerName)) {
                        addLog("RELAY", `${name} joined the relay.`);
                    }

                    sendRelayHelloIfReady();
                    sendTeamSnapshot(true);
                    queueRender(app);
                });

                app.events.on("relay:teamSnapshot", (msg) => {
                    upsertTeamMemberFromSnapshot(msg);
                    queueRender(app);
                });

                app.events.on("relay:abilityDamage", (msg) => {
                    upsertTeamMemberFromLegacyAbilityMessage(msg);
                    queueRender(app);
                });

                app.events.on("relay:abilityHealing", (msg) => {
                    upsertTeamMemberFromLegacyAbilityMessage(msg);
                    queueRender(app);
                });

                app.events.on("relay:abilityCast", (msg) => {
                    upsertTeamMemberFromLegacyAbilityMessage(msg);
                    queueRender(app);
                });

                setInterval(() => {
                    if (
                        state.inCombat &&
                        state.lastCombatAt &&
                        now() - state.lastCombatAt > config.fightTimeoutMs
                    ) {
                        state.inCombat = false;
                    }

                    syncCurrentZoneFromDom();
                    touchCurrentZone();
                    pruneRollingEvents();
                    sendTeamSnapshot();
                    queueRender(app);
                }, 1000);

                reconnectRelayIfWanted(app);
            },

            render() {
                return render();
            },
        };
    }

    function createItemShareModule(definition) {
        const TOOLTIP_WRAP_SELECTOR = ".item-tooltip-wrap";
        const TOOLTIP_CARD_SELECTOR = ".item-tooltip";
        const INV_PANEL_SELECTOR = ".inv-panel";

        const SKIP_INVENTORY_CATEGORIES = new Set([
            "RUNES",
            "CONSUMABLES",
            "POTIONS",
        ]);

        const state = {
            observer: null,
            scanTimer: null,
            enhancedTooltips: new WeakSet(),
            enhancedPanels: new WeakSet(),
            lastCopiedAt: null,
            lastCopiedText: "",
            lastCopiedKind: "—",
            updateQueued: false,
        };

        let appRef = null;

        function sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        function clean(text) {
            return String(text || "")
                .replace(/\s+/g, " ")
                .trim();
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

        function formatTime(ts) {
            if (!ts) return "—";

            return new Date(ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        }

        async function copyText(text, kind = "Item") {
            const value = String(text || "");
            if (!value) return;

            try {
                if (typeof GM_setClipboard === "function") {
                    GM_setClipboard(value, "text");
                } else {
                    await navigator.clipboard.writeText(value);
                }

                state.lastCopiedAt = Date.now();
                state.lastCopiedText = value;
                state.lastCopiedKind = kind;

                console.log("[VoidIdle Item Share] Copied:\n" + value);
                queueRender(appRef);
            } catch (err) {
                console.warn("[VoidIdle Item Share] Clipboard failed. Printing text instead.", err);
                console.log(value);
                alert("Could not copy automatically. Text was printed to console.");
            }
        }

        function getVisibleText(el) {
            if (!el) return "";

            const style = getComputedStyle(el);

            if (style.visibility === "hidden" || style.display === "none") {
                return "";
            }

            return clean(el.innerText);
        }

        function parseTooltipCard(card) {
            const isEquipped = card.classList.contains("item-tooltip-equipped");

            const name = clean(card.querySelector(".tt-name")?.innerText);
            const sub = clean(card.querySelector(".tt-sub")?.innerText);
            const dmgType = clean(card.querySelector(".tt-dmg-type")?.innerText);
            const levelReq = clean(card.querySelector(".tt-level-req")?.innerText);
            const speed = clean(card.querySelector(".tt-attack-speed .tt-stat-value")?.innerText);

            const stats = [...card.querySelectorAll(".tt-stats .dst-stat-row")]
                .map((row) => {
                    const label = clean(row.querySelector(".tt-stat-label")?.innerText);
                    const value = clean(row.querySelector(".dst-stat-val")?.innerText);
                    const quality = clean(row.querySelector(".tt-stat-quality")?.innerText);
                    const base = clean(row.querySelector(".dst-stat-base")?.innerText);

                    return {
                        label,
                        value,
                        quality,
                        base,
                    };
                })
                .filter((stat) => stat.label && stat.value);

            const runesLabel = clean(card.querySelector(".tt-runes-label")?.innerText);
            const runeEmpty = clean(card.querySelector(".tt-rune-empty")?.innerText);

            return {
                isEquipped,
                name,
                sub,
                dmgType,
                levelReq,
                speed,
                stats,
                runesLabel,
                runeEmpty,
            };
        }

        function formatItemForDiscord(data) {
            const lines = [];

            lines.push(`**${data.name || "Unknown Item"}**${data.isEquipped ? " *(equipped)*" : ""}`);

            if (data.sub) lines.push(data.sub);
            if (data.dmgType) lines.push(data.dmgType);
            if (data.levelReq) lines.push(data.levelReq);

            if (data.stats.length) {
                lines.push("");
                lines.push("**Stats**");

                for (const stat of data.stats) {
                    let line = `• ${stat.label}: ${stat.value}`;

                    if (stat.quality) line += ` ${stat.quality}`;
                    if (stat.base) line += ` base ${stat.base}`;

                    lines.push(line);
                }
            }

            if (data.speed) {
                lines.push(`• SPEED: ${data.speed}`);
            }

            if (data.runesLabel || data.runeEmpty) {
                lines.push("");
                lines.push(`**${data.runesLabel || "Runes"}**`);

                if (data.runeEmpty) {
                    lines.push(data.runeEmpty);
                }
            }

            return lines.join("\n");
        }

        function parseInventorySlot(slot) {
            const img = slot.querySelector("img.item-img");
            const alt = clean(img?.alt);

            const emojiIcon = !img
                ? clean(slot.querySelector(".is-icon")?.innerText)
                : "";

            const tier = clean(slot.querySelector(".inv-item-tier")?.innerText);
            const plus = getVisibleText(slot.querySelector(".is-plus"));
            const qty = clean(slot.querySelector(".is-qty")?.innerText);
            const runeStat = clean(slot.querySelector(".is-rune-stat")?.innerText);
            const locked = !!slot.querySelector(".inv-lock-badge");

            const forge = [...slot.classList].find((cls) => cls.startsWith("forged-"));
            const forgeText = forge ? forge.replace("forged-", "forged ") : "";

            const parts = [];

            if (alt) parts.push(alt);
            else if (emojiIcon) parts.push(emojiIcon);
            else parts.push("item");

            if (tier) parts.push(tier);
            if (plus) parts.push(plus);
            if (qty) parts.push(qty);
            if (runeStat) parts.push(runeStat);
            if (forgeText) parts.push(forgeText);
            if (locked) parts.push("locked");

            return parts.join(" · ");
        }

        function parseInventoryPanel(panel) {
            const title = clean(panel.querySelector(".inv-title")?.innerText) || "Inventory";
            const bagCount = clean(panel.querySelector(".inv-tab.active .inv-tab-count")?.innerText);
            const gold = clean(panel.querySelector(".inv-gold")?.innerText);
            const shards = clean(panel.querySelector(".inv-shards")?.innerText);

            const lines = [];

            lines.push(`**${title}${bagCount ? ` ${bagCount}` : ""}**`);

            if (gold || shards) {
                lines.push(
                    [
                        gold && `Gold: ${gold}`,
                        shards && `Shards: ${shards}`,
                    ]
                        .filter(Boolean)
                        .join(" | ")
                );
            }

            const categories = [...panel.querySelectorAll(".bag-category")];

            for (const category of categories) {
                const label = clean(category.querySelector(".bag-cat-label")?.innerText);
                const labelUpper = label.toUpperCase();

                if (SKIP_INVENTORY_CATEGORIES.has(labelUpper)) continue;

                const count = clean(category.querySelector(".bag-cat-count")?.innerText);
                const slots = [...category.querySelectorAll(".item-slot")];

                if (!slots.length) continue;

                lines.push("");
                lines.push(`**${label || "Category"}${count ? ` (${count})` : ""}**`);

                slots.forEach((slot, index) => {
                    lines.push(`${index + 1}. ${parseInventorySlot(slot)}`);
                });
            }

            return lines.join("\n");
        }

        function getEventOptionsForElement(el) {
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const pageWindow = el.ownerDocument.defaultView;

            return {
                pageWindow,
                opts: {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: x,
                    clientY: y,
                    screenX: x,
                    screenY: y,
                    view: pageWindow,
                },
            };
        }

        function dispatchPointerOrMouse(el, type, opts, pageWindow) {
            try {
                if (typeof pageWindow.PointerEvent === "function") {
                    el.dispatchEvent(new pageWindow.PointerEvent(type, opts));
                } else {
                    el.dispatchEvent(new pageWindow.MouseEvent(type, opts));
                }
            } catch {
                el.dispatchEvent(new pageWindow.MouseEvent(type, opts));
            }
        }

        function fireHoverEvents(el) {
            const { pageWindow, opts } = getEventOptionsForElement(el);

            dispatchPointerOrMouse(el, "pointerover", opts, pageWindow);
            dispatchPointerOrMouse(el, "pointerenter", opts, pageWindow);

            el.dispatchEvent(new pageWindow.MouseEvent("mouseover", opts));
            el.dispatchEvent(new pageWindow.MouseEvent("mouseenter", opts));
            el.dispatchEvent(new pageWindow.MouseEvent("mousemove", opts));
        }

        function fireUnhoverEvents(el) {
            const { pageWindow, opts } = getEventOptionsForElement(el);

            dispatchPointerOrMouse(el, "pointerout", opts, pageWindow);
            dispatchPointerOrMouse(el, "pointerleave", opts, pageWindow);

            el.dispatchEvent(new pageWindow.MouseEvent("mouseout", opts));
            el.dispatchEvent(new pageWindow.MouseEvent("mouseleave", opts));
        }

        function getHoveredTooltipCard() {
            const wrap = document.querySelector(TOOLTIP_WRAP_SELECTOR);
            if (!wrap) return null;

            const cards = [...wrap.querySelectorAll(TOOLTIP_CARD_SELECTOR)];
            if (!cards.length) return null;

            const nonEquipped = cards.find((card) => !card.classList.contains("item-tooltip-equipped"));

            return nonEquipped || cards[cards.length - 1];
        }

        async function getItemFromSlotByHover(slot) {
            slot.scrollIntoView({
                block: "center",
                inline: "center",
            });

            await sleep(80);

            fireHoverEvents(slot);

            await sleep(240);

            const card = getHoveredTooltipCard();

            let result = null;

            if (card) {
                const data = parseTooltipCard(card);

                if (data.name && data.name !== "Unknown Item") {
                    result = formatItemForDiscord(data);
                }
            }

            fireUnhoverEvents(slot);

            await sleep(80);

            return result;
        }

        async function copyInventoryDeep(panel, btn) {
            const lines = [];

            const title = clean(panel.querySelector(".inv-title")?.innerText) || "Inventory";
            const bagCount = clean(panel.querySelector(".inv-tab.active .inv-tab-count")?.innerText);
            const gold = clean(panel.querySelector(".inv-gold")?.innerText);
            const shards = clean(panel.querySelector(".inv-shards")?.innerText);

            lines.push(`**${title}${bagCount ? ` ${bagCount}` : ""}**`);

            if (gold || shards) {
                lines.push(
                    [
                        gold && `Gold: ${gold}`,
                        shards && `Shards: ${shards}`,
                    ]
                        .filter(Boolean)
                        .join(" | ")
                );
            }

            const categories = [...panel.querySelectorAll(".bag-category")];

            for (const category of categories) {
                const label = clean(category.querySelector(".bag-cat-label")?.innerText);
                const labelUpper = label.toUpperCase();

                if (SKIP_INVENTORY_CATEGORIES.has(labelUpper)) continue;

                const count = clean(category.querySelector(".bag-cat-count")?.innerText);
                const slots = [...category.querySelectorAll(".item-slot")];

                if (!slots.length) continue;

                lines.push("");
                lines.push(`__**${label || "Category"}${count ? ` (${count})` : ""}**__`);

                for (let index = 0; index < slots.length; index += 1) {
                    if (btn) {
                        btn.textContent = `Copying ${label || "items"} ${index + 1}/${slots.length}`;
                    }

                    const slot = slots[index];

                    let itemText = await getItemFromSlotByHover(slot);

                    if (!itemText) {
                        itemText = parseInventorySlot(slot);
                    }

                    lines.push("");
                    lines.push(`**#${index + 1}**`);
                    lines.push(itemText);
                }
            }

            const text = lines.join("\n");
            await copyText(text, "Inventory");

            if (btn) {
                btn.textContent = "Copied!";

                setTimeout(() => {
                    btn.textContent = "Copy Inventory";
                }, 900);
            }
        }

        function addCopyButtonToTooltipCard(card) {
            if (!card || state.enhancedTooltips.has(card)) return;

            state.enhancedTooltips.add(card);

            const btn = document.createElement("button");
            btn.textContent = "Copy Item";
            btn.className = "vi-copy-item-btn";

            btn.style.position = "absolute";
            btn.style.top = "6px";
            btn.style.right = "28px";
            btn.style.zIndex = "99999";
            btn.style.fontSize = "11px";
            btn.style.padding = "3px 6px";
            btn.style.borderRadius = "6px";
            btn.style.border = "1px solid rgba(255,255,255,0.25)";
            btn.style.background = "rgba(0,0,0,0.65)";
            btn.style.color = "#ffd36a";
            btn.style.cursor = "pointer";

            btn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();

                const data = parseTooltipCard(card);
                const text = formatItemForDiscord(data);

                await copyText(text, "Item");

                btn.textContent = "Copied!";

                setTimeout(() => {
                    btn.textContent = "Copy Item";
                }, 800);
            });

            card.style.position = card.style.position || "relative";
            card.appendChild(btn);
        }

        function enhanceTooltipWrap(wrap) {
            const cards = wrap.querySelectorAll(TOOLTIP_CARD_SELECTOR);
            cards.forEach(addCopyButtonToTooltipCard);
        }

        function addCopyInventoryButton(panel) {
            if (!panel || state.enhancedPanels.has(panel)) return;

            const actions = panel.querySelector(".inv-actions-row");
            if (!actions) return;

            state.enhancedPanels.add(panel);

            const btn = document.createElement("button");
            btn.textContent = "Copy Inventory";
            btn.className = "inv-select-btn vi-copy-inventory-btn";
            btn.title = "Copy full inventory for Discord";

            btn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();

                btn.disabled = true;

                const oldText = btn.textContent;
                btn.textContent = "Copying...";

                try {
                    await copyInventoryDeep(panel, btn);
                } catch (err) {
                    console.error("[VoidIdle Item Share] Deep inventory copy failed:", err);

                    const text = parseInventoryPanel(panel);
                    await copyText(text, "Inventory basic");

                    btn.textContent = "Copied basic inventory";
                } finally {
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.textContent = oldText || "Copy Inventory";
                    }, 1200);
                }
            });

            actions.appendChild(btn);
        }

        function scan() {
            document.querySelectorAll(TOOLTIP_WRAP_SELECTOR).forEach(enhanceTooltipWrap);
            document.querySelectorAll(INV_PANEL_SELECTOR).forEach(addCopyInventoryButton);
        }

        function startObserver() {
            if (state.observer || !document.body) return;

            state.observer = new MutationObserver((mutations) => {
                let shouldScan = false;

                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (!(node instanceof HTMLElement)) continue;

                        if (
                            node.matches?.(TOOLTIP_WRAP_SELECTOR) ||
                            node.querySelector?.(TOOLTIP_WRAP_SELECTOR) ||
                            node.matches?.(INV_PANEL_SELECTOR) ||
                            node.querySelector?.(INV_PANEL_SELECTOR)
                        ) {
                            shouldScan = true;
                            break;
                        }
                    }

                    if (shouldScan) break;
                }

                if (shouldScan) {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(scan);
                    });
                }
            });

            state.observer.observe(document.body, {
                childList: true,
                subtree: true,
            });

            scan();
        }

        function stopObserver() {
            if (state.observer) {
                state.observer.disconnect();
                state.observer = null;
            }
        }

        function renderStyles() {
            return `
      <style>
        .vis-sec {
          margin-top: 10px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 9px;
        }

        .vis-title {
          font-weight: 800;
          margin-bottom: 7px;
        }

        .vis-muted {
          color: rgba(229,231,235,0.58);
        }

        .vis-good {
          color: #4ade80;
          font-weight: 800;
        }

        .vis-pre {
          white-space: pre-wrap;
          color: rgba(229,231,235,0.78);
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          line-height: 1.35;
          max-height: 240px;
          overflow: auto;
          background: rgba(0,0,0,0.18);
          border-radius: 8px;
          padding: 8px;
          margin-top: 8px;
        }
      </style>
    `;
        }

        function render() {
            return `
      ${renderStyles()}

      <div class="vis-sec">
        <div class="vis-title">🎁 Item Share</div>
        <div class="vis-muted">
          Adds <b>Copy Item</b> to item tooltips and <b>Copy Inventory</b> to the inventory panel.
        </div>
      </div>

      <div class="vis-sec">
        <div class="vis-title">Status</div>
        <div class="vis-good">Scanner active</div>
        <div class="vis-muted" style="margin-top:6px;">
          Hover an item tooltip to see the Copy Item button. Open Inventory to see Copy Inventory.
        </div>
        <div style="margin-top:8px;">
          <button type="button" class="vim-btn" data-vis-scan>Scan Now</button>
        </div>
      </div>

      <div class="vis-sec">
        <div class="vis-title">Local Activity</div>
        <div class="vis-muted">Last copied: ${escapeHtml(formatTime(state.lastCopiedAt))}</div>
        <div class="vis-muted">Type: ${escapeHtml(state.lastCopiedKind)}</div>
        ${state.lastCopiedText
                    ? `<div class="vis-pre">${escapeHtml(state.lastCopiedText.slice(0, 1500))}${state.lastCopiedText.length > 1500 ? "\n..." : ""}</div>`
                    : `<div class="vis-muted" style="margin-top:8px;">Nothing copied yet.</div>`
                }
      </div>
    `;
        }

        function attachEvents(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            if (panel.dataset.itemShareEventsBound === "1") return;
            panel.dataset.itemShareEventsBound = "1";

            panel.addEventListener("click", (event) => {
                const scanButton = event.target.closest("[data-vis-scan]");

                if (!scanButton || !panel.contains(scanButton)) return;

                event.preventDefault();
                event.stopPropagation();

                startObserver();
                scan();
                renderIntoPanel(app);
            });
        }

        function renderIntoPanel(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            const body = panel.querySelector(".vim-body");
            const footer = panel.querySelector(".vim-footer");

            if (!body || !footer) return;

            body.innerHTML = render();

            footer.textContent = `Scanner active | Last copied ${formatTime(state.lastCopiedAt)} | ${state.lastCopiedKind}`;

            attachEvents(app);
        }

        function queueRender(app) {
            if (!app || state.updateQueued) return;

            state.updateQueued = true;

            requestAnimationFrame(() => {
                state.updateQueued = false;
                renderIntoPanel(app);
            });
        }

        return {
            ...definition,

            init(app) {
                appRef = app;

                const boot = () => {
                    startObserver();
                    scan();
                    renderIntoPanel(app);
                };

                if (document.body) {
                    boot();
                } else {
                    window.addEventListener("DOMContentLoaded", boot, { once: true });
                }

                state.scanTimer = setInterval(() => {
                    const panelState = getPanelState(app, definition.id);

                    if (!panelState?.enabled) return;

                    startObserver();
                    scan();
                }, 1500);
            },

            render() {
                return render();
            },

            destroy() {
                stopObserver();

                if (state.scanTimer) {
                    clearInterval(state.scanTimer);
                    state.scanTimer = null;
                }

                if (state.detachBossTrackerEvents) {
                    state.detachBossTrackerEvents();
                }
            },
        };
    }

    function createRunePlannerModule(definition) {
        const RUNE_CATEGORIES = [
            {
                label: "Weapon Runes",
                accent: "#e07b54",
                dimBg: "#1f140f",
                runes: [
                    { name: "Sharpened", stat: "+ATK" },
                    { name: "Precise", stat: "+Crit%" },
                    { name: "Brutal", stat: "+CritDmg%" },
                    { name: "Swift", stat: "+CDR%" },
                    { name: "Vampiric", stat: "+Lifesteal%" },
                    { name: "Arcane", stat: "+Healing" },
                ],
            },
            {
                label: "Armor Runes",
                accent: "#4fc3f7",
                dimBg: "#0d1820",
                runes: [
                    { name: "Fortified", stat: "+DEF" },
                    { name: "Resilient", stat: "+HP" },
                    { name: "Warding", stat: "+Mana" },
                    { name: "Regenerating", stat: "+HP Regen" },
                    { name: "Absorbing", stat: "+Dmg Reduction%" },
                    { name: "Thorned", stat: "+Thorns" },
                ],
            },
            {
                label: "Accessories Runes",
                accent: "#f9d857",
                dimBg: "#1a1900",
                runes: [
                    { name: "Prosperous", stat: "+Gold%" },
                    { name: "Enlightened", stat: "+XP%" },
                    { name: "Wise", stat: "+Mana" },
                    { name: "Energized", stat: "+Mana Regen" },
                    { name: "Lucky", stat: "+Loot%" },
                    { name: "Efficient", stat: "+CDR%" },
                ],
            },
        ];

        const MAX_TIER = 4;
        const TIER_COLORS = ["#888", "#7ec8e3", "#a78bfa", "#f472b6"];
        const STORAGE_KEY = "voididle.runePlanner.counts.v1";

        const state = {
            counts: createEmptyCounts(),
            lastCopiedAt: null,
            lastMessage: "",
            lastMessageColor: "#69f0ae",
            updateQueued: false,
        };

        function createEmptyCounts() {
            const counts = {};

            for (const cat of RUNE_CATEGORIES) {
                for (const rune of cat.runes) {
                    counts[rune.name] = {};

                    for (let tier = 1; tier <= MAX_TIER; tier += 1) {
                        counts[rune.name][tier] = 0;
                    }
                }
            }

            return counts;
        }

        function loadCounts() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return;

                const saved = JSON.parse(raw);
                if (!saved || typeof saved !== "object") return;

                const fresh = createEmptyCounts();

                for (const [runeName, tiers] of Object.entries(saved)) {
                    if (!fresh[runeName] || !tiers || typeof tiers !== "object") continue;

                    for (let tier = 1; tier <= MAX_TIER; tier += 1) {
                        fresh[runeName][tier] = Math.max(0, Number(tiers[tier] || 0));
                    }
                }

                state.counts = fresh;
            } catch {
                state.counts = createEmptyCounts();
            }
        }

        function saveCounts() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state.counts));
            } catch (err) {
                console.warn("[VoidIdle Rune Planner] Could not save counts", err);
            }
        }

        function clean(value) {
            return String(value ?? "").replace(/\s+/g, " ").trim();
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

        function formatTime(ts) {
            if (!ts) return "—";

            return new Date(ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        }

        function getCount(runeName, tier) {
            return Number(state.counts[runeName]?.[tier] || 0);
        }

        function setCount(runeName, tier, value) {
            if (!state.counts[runeName]) state.counts[runeName] = {};
            state.counts[runeName][tier] = Math.max(0, Number(value || 0));
            saveCounts();
        }

        function changeCount(runeName, tier, delta) {
            setCount(runeName, tier, getCount(runeName, tier) + delta);
        }

        function getSelectedLines() {
            const lines = [];

            for (const cat of RUNE_CATEGORIES) {
                for (const rune of cat.runes) {
                    const parts = [];

                    for (let tier = 1; tier <= MAX_TIER; tier += 1) {
                        const count = getCount(rune.name, tier);

                        if (count > 0) {
                            parts.push(`t${tier} x ${count}`);
                        }
                    }

                    if (parts.length > 0) {
                        lines.push(`${rune.name} rune ${parts.join(" / ")}`);
                    }
                }
            }

            return lines;
        }

        function getSelectedTotal() {
            let total = 0;

            for (const cat of RUNE_CATEGORIES) {
                for (const rune of cat.runes) {
                    for (let tier = 1; tier <= MAX_TIER; tier += 1) {
                        total += getCount(rune.name, tier);
                    }
                }
            }

            return total;
        }

        function showMessage(app, message, color = "#69f0ae") {
            state.lastMessage = message;
            state.lastMessageColor = color;

            renderIntoPanel(app);

            setTimeout(() => {
                if (state.lastMessage === message) {
                    state.lastMessage = "";
                    renderIntoPanel(app);
                }
            }, 2200);
        }

        async function copyText(text) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                try {
                    const textarea = document.createElement("textarea");
                    textarea.value = text;
                    textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px";
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand("copy");
                    textarea.remove();
                    return true;
                } catch {
                    console.log(text);
                    return false;
                }
            }
        }

        async function exportToClipboard(app) {
            const lines = getSelectedLines();

            if (!lines.length) {
                showMessage(app, "⚠ Nothing selected", "#ffa726");
                return;
            }

            const copied = await copyText(lines.join("\n"));

            if (copied) {
                state.lastCopiedAt = Date.now();
                showMessage(app, "✓ Copied!", "#69f0ae");
            } else {
                showMessage(app, "⚠ Copy failed; printed to console", "#ffa726");
            }
        }

        function resetAll(app) {
            state.counts = createEmptyCounts();
            saveCounts();
            showMessage(app, "Reset all rune counts", "#ffa726");
        }

        function renderStyles() {
            return `
      <style>
        .rp-wrap {
          color:#cdd6f4;
          font-family:Arial, sans-serif;
          font-size:12px;
        }

        .rp-head {
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:10px;
          margin-bottom:10px;
          padding:10px;
          border-radius:10px;
          background:rgba(124,111,205,0.10);
          border:1px solid rgba(124,111,205,0.25);
        }

        .rp-title {
          font-weight:800;
          font-size:14px;
          color:#c9b8ff;
          margin-bottom:3px;
        }

        .rp-muted {
          color:rgba(229,231,235,0.58);
        }

        .rp-actions {
          display:flex;
          gap:6px;
          flex-wrap:wrap;
          justify-content:flex-end;
        }

        .rp-toast {
          margin-top:8px;
          min-height:16px;
          font-size:12px;
          font-weight:800;
        }

        .rp-section {
          margin-bottom:12px;
          border-radius:10px;
          overflow:hidden;
          border:1px solid rgba(255,255,255,0.08);
          background:rgba(255,255,255,0.035);
        }

        .rp-section-title {
          font-size:11px;
          font-weight:800;
          text-transform:uppercase;
          letter-spacing:.08em;
          padding:8px 10px;
          display:flex;
          align-items:center;
          gap:8px;
        }

        .rp-dot {
          width:8px;
          height:8px;
          border-radius:50%;
          flex-shrink:0;
        }

        .rp-table {
          width:100%;
          border-collapse:collapse;
        }

        .rp-table th {
          text-align:center;
          font-size:11px;
          font-weight:800;
          padding:6px 4px;
          white-space:nowrap;
          background:rgba(0,0,0,0.24);
        }

        .rp-table th:first-child {
          text-align:left;
          padding-left:10px;
          min-width:190px;
          color:rgba(229,231,235,0.45);
        }

        .rp-table th.rp-tier-hdr {
          min-width:78px;
        }

        .rp-table td {
          padding:5px 4px;
          text-align:center;
          vertical-align:middle;
          border-top:1px solid rgba(255,255,255,0.055);
        }

        .rp-table td:first-child {
          text-align:left;
          padding-left:10px;
          padding-right:8px;
          white-space:nowrap;
        }

        .rp-table tr:hover td {
          background:rgba(255,255,255,0.035);
        }

        .rp-rune-name {
          font-weight:800;
          font-size:12px;
        }

        .rp-rune-stat {
          font-size:10px;
          opacity:.58;
          margin-left:5px;
        }

        .rp-cell {
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:3px;
        }

        .rp-minus,
        .rp-plus {
          width:23px;
          height:23px;
          border-radius:6px;
          border:1px solid rgba(255,255,255,0.10);
          background:rgba(255,255,255,0.055);
          color:#aaa;
          font-size:15px;
          line-height:1;
          cursor:pointer;
          padding:0;
          display:flex;
          align-items:center;
          justify-content:center;
        }

        .rp-plus:hover {
          background:rgba(74,222,128,0.12);
          border-color:rgba(74,222,128,0.55);
          color:#69f0ae;
        }

        .rp-minus:hover {
          background:rgba(248,113,113,0.12);
          border-color:rgba(248,113,113,0.55);
          color:#ef9a9a;
        }

        .rp-count {
          min-width:24px;
          text-align:center;
          font-size:12px;
          color:rgba(229,231,235,0.42);
          font-weight:800;
          border-radius:5px;
          padding:2px 4px;
        }

        .rp-count.nonzero {
          color:#fff;
          background:rgba(124,111,205,0.42);
        }

        .rp-summary {
          margin-top:10px;
          padding:9px;
          border-radius:10px;
          background:rgba(255,255,255,0.04);
          border:1px solid rgba(255,255,255,0.08);
        }

        .rp-pre {
          white-space:pre-wrap;
          color:rgba(229,231,235,0.82);
          font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
          font-size:11px;
          line-height:1.35;
          max-height:160px;
          overflow:auto;
          background:rgba(0,0,0,0.20);
          border-radius:8px;
          padding:8px;
          margin-top:8px;
        }
      </style>
    `;
        }

        function render() {
            const selectedLines = getSelectedLines();
            const selectedTotal = getSelectedTotal();

            return `
      ${renderStyles()}

      <div class="rp-wrap">
        <div class="rp-head">
          <div>
            <div class="rp-title">◈ Rune Planner</div>
            <div class="rp-muted">Plan rune loadouts by type and tier, then copy the list for Discord or notes.</div>
            <div class="rp-toast" style="color:${escapeHtml(state.lastMessageColor)};">${escapeHtml(state.lastMessage)}</div>
          </div>

          <div class="rp-actions">
            <button type="button" class="vim-btn vim-btn-primary" data-rp-export>📋 Copy</button>
            <button type="button" class="vim-btn" data-rp-reset>Reset</button>
          </div>
        </div>

        ${RUNE_CATEGORIES.map(renderCategory).join("")}

        <div class="rp-summary">
          <div><b>Selected:</b> ${selectedTotal} rune${selectedTotal === 1 ? "" : "s"}</div>
          <div class="rp-muted">Last copied: ${escapeHtml(formatTime(state.lastCopiedAt))}</div>

          ${
                    selectedLines.length
                        ? `<div class="rp-pre">${escapeHtml(selectedLines.join("\n"))}</div>`
                        : `<div class="rp-muted" style="margin-top:8px;">No runes selected yet.</div>`
                }
        </div>
      </div>
    `;
        }

        function renderCategory(cat) {
            const tierHeaders = Array.from({ length: MAX_TIER }, (_, index) => {
                const tier = index + 1;
                const color = TIER_COLORS[index];

                return `<th class="rp-tier-hdr" style="color:${color};">T${tier}</th>`;
            }).join("");

            return `
      <div class="rp-section" style="border-color:${cat.accent}33;">
        <div class="rp-section-title" style="background:${cat.dimBg};color:${cat.accent};">
          <span class="rp-dot" style="background:${cat.accent};"></span>
          ${escapeHtml(cat.label)}
        </div>

        <table class="rp-table">
          <thead>
            <tr>
              <th></th>
              ${tierHeaders}
            </tr>
          </thead>
          <tbody>
            ${cat.runes.map((rune) => renderRuneRow(cat, rune)).join("")}
          </tbody>
        </table>
      </div>
    `;
        }

        function renderRuneRow(cat, rune) {
            return `
      <tr>
        <td>
          <span class="rp-rune-name" style="color:${cat.accent};">${escapeHtml(rune.name)}</span>
          <span class="rp-rune-stat">${escapeHtml(rune.stat)}</span>
        </td>

        ${Array.from({ length: MAX_TIER }, (_, index) => {
                const tier = index + 1;
                const count = getCount(rune.name, tier);

                return `
            <td>
              <div class="rp-cell">
                <button
                  type="button"
                  class="rp-minus"
                  data-rp-change="-1"
                  data-rp-rune="${escapeHtml(rune.name)}"
                  data-rp-tier="${tier}"
                  title="Remove ${escapeHtml(rune.name)} T${tier}"
                >−</button>

                <span class="rp-count${count > 0 ? " nonzero" : ""}">${count}</span>

                <button
                  type="button"
                  class="rp-plus"
                  data-rp-change="1"
                  data-rp-rune="${escapeHtml(rune.name)}"
                  data-rp-tier="${tier}"
                  title="Add ${escapeHtml(rune.name)} T${tier}"
                >+</button>
              </div>
            </td>
          `;
            }).join("")}
      </tr>
    `;
        }

        function attachEvents(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            if (panel.dataset.runePlannerEventsBound === "1") return;
            panel.dataset.runePlannerEventsBound = "1";

            panel.addEventListener("click", async (event) => {
                const target = event.target;

                const changeButton = target.closest("[data-rp-change]");
                if (changeButton && panel.contains(changeButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    const runeName = clean(changeButton.dataset.rpRune);
                    const tier = Number(changeButton.dataset.rpTier || 0);
                    const delta = Number(changeButton.dataset.rpChange || 0);

                    if (!runeName || !tier || !delta) return;

                    changeCount(runeName, tier, delta);
                    renderIntoPanel(app);
                    return;
                }

                const exportButton = target.closest("[data-rp-export]");
                if (exportButton && panel.contains(exportButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    await exportToClipboard(app);
                    return;
                }

                const resetButton = target.closest("[data-rp-reset]");
                if (resetButton && panel.contains(resetButton)) {
                    event.preventDefault();
                    event.stopPropagation();

                    resetAll(app);
                }
            });
        }

        function renderIntoPanel(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            const body = panel.querySelector(".vim-body");
            const footer = panel.querySelector(".vim-footer");

            if (!body || !footer) return;

            body.innerHTML = render();

            const selectedTotal = getSelectedTotal();

            footer.textContent =
                `${selectedTotal} selected | Last copied ${formatTime(state.lastCopiedAt)} | Counts saved locally`;

            attachEvents(app);
        }

        function queueRender(app) {
            if (!app || state.updateQueued) return;

            state.updateQueued = true;

            requestAnimationFrame(() => {
                state.updateQueued = false;
                renderIntoPanel(app);
            });
        }

        return {
            ...definition,

            init(app) {
                loadCounts();
                queueRender(app);
            },

            render() {
                return render();
            },
        };
    }

    function createStatGrabberModule(definition) {
  /**************************************************************************
   * CONSTANTS
   **************************************************************************/

  const RARITY_COLOR = {
    MYTHIC: "#B33A3A", LEGENDARY: "#C6A85C",
    EPIC:   "#6B3A8A", RARE:      "#2F6B5F", COMMON: "#7A6E62",
  };

  // Game stat keys that differ from our internal keys
  const STAT_KEY_MAP = {
    cooldownReduction: "cdr",
    critDamage:        "critDmg",
  };

  const FORGE_TIER_SYMBOL = {
    starforged: "★",
    moonforged: "☽",
    sunforged:  "☀",
  };

  // Expected stat slot counts per rarity — fewer unique stats = multi-rolled stat(s)
  const RARITY_STAT_SLOTS = { COMMON:1, RARE:2, EPIC:3, LEGENDARY:4, MYTHIC:5 };

  const ZONE_TIERS = {
    "Bamboo Thicket": 1, "Jade River Delta": 1,
    "Crimson Petal Grove": 2, "Iron Gate Pass": 2,
    "Ascending Mist Temple": 3, "Sunken Lotus Marshes": 3,
    "Shattered Sky Ridge": 4, "Desert of Forgotten Kings": 4,
    "Sea of Swaying Bamboo": 5, "Frost Peak Hermitage": 5,
    "Celestial Dragon Spire": 6, "Palace of Jade Emperor": 6,
    "Abyssal Demon Pit": 7, "Void Nexus": 7,
    "Immortal Battlefield": 8, "Primordial Chaos Wastes": 8,
    "Throne of the Dao": 9,
  };

  const ITEM_TYPE_TO_SLOT = {
    bow:"Weapon", sword:"Weapon", spear:"Weapon", staff:"Weapon",
    harp:"Weapon", fan:"Weapon", axe:"Weapon", dagger:"Weapon",
    mace:"Weapon", wand:"Weapon", scepter:"Weapon", scythe:"Weapon",
    crossbow:"Weapon", helmet:"Helmet", helm:"Helmet",
    shoulders:"Shoulders", chest:"Chest", robe:"Chest", vestment:"Chest",
    hands:"Hands", gauntlets:"Hands", gloves:"Hands",
    "leg armor":"Legs", legs:"Legs", greaves:"Legs",
    boots:"Boots", sabatons:"Boots", amulet:"Amulet", ring:"Ring", shield:"Shield",
  };

  const GEAR_ITEM_TYPES = new Set(Object.keys(ITEM_TYPE_TO_SLOT));

  const ITEM_ICONS = {
    bow:"🏹", crossbow:"🏹",
    sword:"⚔️", axe:"🪓", mace:"🔨", dagger:"🗡️", spear:"🗡️",
    staff:"🪄", wand:"🪄", scepter:"🪄", scythe:"🪄",
    harp:"🎵", fan:"🪭",
    helmet:"⛑️", helm:"⛑️",
    shoulders:"🛡️", chest:"🧥", robe:"🧥", vestment:"🧥",
    hands:"🧤", gauntlets:"🧤", gloves:"🧤",
    "leg armor":"👖", legs:"👖", greaves:"👖",
    boots:"👢", sabatons:"👢",
    shield:"🛡️", amulet:"📿", ring:"💍",
  };

  const GEAR_SLOT_ORDER = [
    "Weapon","Helmet","Shoulders","Chest","Hands","Legs","Boots","Amulet","Ring","Shield",
  ];

  // Weapon types that share a usable family (equipping one → only those are upgrades)
  const WEAPON_FAMILIES = {
    bow:      new Set(["bow","crossbow"]),
    crossbow: new Set(["bow","crossbow"]),
    sword:    new Set(["sword","axe","mace","dagger","spear"]),
    axe:      new Set(["sword","axe","mace","dagger","spear"]),
    mace:     new Set(["sword","axe","mace","dagger","spear"]),
    dagger:   new Set(["sword","axe","mace","dagger","spear"]),
    spear:    new Set(["sword","axe","mace","dagger","spear"]),
    staff:    new Set(["staff","wand","scepter","scythe"]),
    wand:     new Set(["staff","wand","scepter","scythe"]),
    scepter:  new Set(["staff","wand","scepter","scythe"]),
    scythe:   new Set(["staff","wand","scepter","scythe"]),
    harp:     new Set(["harp"]),
    fan:      new Set(["fan"]),
  };
  // Weapon families that cannot equip a shield
  const NO_SHIELD_WEAPONS = new Set(["bow","crossbow","harp","fan","staff","wand","scepter","scythe"]);
  // Weapon families that cannot wear heavy (plate) armor
  const NO_HEAVY_ARMOR_WEAPONS = new Set(["bow","crossbow","harp","fan","staff","wand","scepter","scythe"]);
  // Item types classified as heavy/plate armor
  const HEAVY_ARMOR_TYPES = new Set(["chest","gauntlets","greaves","sabatons","helmet"]);

  const CATEGORIES = [
    { key:"top",  label:"✅ Top Pick", cls:"rec-top"  },
    { key:"up",   label:"👍 Upgrade",  cls:"rec-up"   },
    { key:"neu",  label:"↔ Neutral",   cls:"rec-neu"  },
    { key:"skip", label:"⚠️ Skip",     cls:"rec-skip" },
    { key:"sal",  label:"💾 Salvage",  cls:"rec-sal"  },
  ];

  const STAT_DEFS = [
    { key:"atk",        label:"ATK"        },
    { key:"atkSpeed",   label:"Atk Speed"  },
    { key:"critChance", label:"Crit%"      },
    { key:"critDmg",    label:"Crit DMG"   },
    { key:"def",        label:"DEF"        },
    { key:"hp",         label:"HP"         },
    { key:"mana",       label:"Mana"       },
    { key:"manaRegen",  label:"Mana Regen" },
    { key:"cdr",        label:"CDR"        },
    { key:"healPower",  label:"Heal Power" },
    { key:"dropRate",   label:"Drop Rate"  },
    { key:"allStats",   label:"All Stats"  },
  ];

  // Maps uppercase tooltip stat labels → internal stat keys
  const TOOLTIP_STAT_MAP = {
    "ATK":         "atk",
    "DEF":         "def",
    "HP":          "hp",
    "MANA":        "mana",
    "CDR":         "cdr",
    "HEAL":        "healPower",
    "DROPRATE":    "dropRate",
    "DROP RATE":   "dropRate",
    "ALL STATS":   "allStats",
    "ALLSTATS":    "allStats",
    "ATK SPEED":   "atkSpeed",
    "ATKSPEED":    "atkSpeed",
    "CRIT":        "critChance",
    "CRIT CHANCE": "critChance",
    "CRIT DMG":    "critDmg",
    "MANA REGEN":  "manaRegen",
    "MANAREGEN":   "manaRegen",
  };

  const FILTER_PRESETS = {
    "🏹 Bow":   ["atk","atkSpeed","critChance","critDmg","allStats"],
    "⚔️ Sword": ["atk","atkSpeed","critChance","critDmg","allStats"],
    "🛡 Tank":  ["def","hp","healPower","manaRegen","allStats"],
    "🔮 Mage":  ["mana","cdr","healPower","manaRegen","atkSpeed","allStats"],
    "🎲 Loot":  ["dropRate","allStats"],
  };

  /**************************************************************************
   * FILTER STORAGE
   **************************************************************************/

  function mkFC(stats, enabled=true, multiBonus={}, preferredStats=[]) {
    return { stats: new Set(stats), enabled, multiBonus, preferredStats: new Set(preferredStats) };
  }

  function loadFilters() {
    try {
      const raw = JSON.parse(localStorage.getItem("sgFilters") || "null");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const map = new Map();
        for (const [k, v] of Object.entries(raw)) {
          if (Array.isArray(v)) {
            // migrate old format
            map.set(k, mkFC(v));
          } else if (v && typeof v === "object") {
            map.set(k, mkFC(v.stats ?? [], v.enabled !== false, v.multiBonus ?? {}, v.preferredStats ?? []));
          }
        }
        if (map.size > 0) return map;
      }
    } catch {}
    const map = new Map();
    for (const [name, keys] of Object.entries(FILTER_PRESETS)) map.set(name, mkFC(keys));
    return map;
  }

  function saveFilters() {
    const out = {};
    for (const [k, fc] of state.filters) {
      out[k] = { stats:[...fc.stats], enabled:fc.enabled, multiBonus:fc.multiBonus, preferredStats:[...fc.preferredStats] };
    }
    localStorage.setItem("sgFilters", JSON.stringify(out));
  }

  /**************************************************************************
   * TEAM PROFILES
   **************************************************************************/

  const TEAM_KEY = "sgTeamProfiles";
  const teamProfiles = (() => {
    try { return JSON.parse(localStorage.getItem(TEAM_KEY) || "{}"); } catch { return {}; }
  })();
  function saveTeamProfiles() {
    try { localStorage.setItem(TEAM_KEY, JSON.stringify(teamProfiles)); } catch {}
  }

  // Pending inspect data keyed by playerId (captured from fetch intercept)
  const pendingInspect = {};

  // API auth capture. VoidIdle's normal React requests include an auth token header,
  // but userscript fetch() calls do not automatically inherit custom headers. Capture
  // the token from real app requests and reuse it for Stat Grabber API actions like
  // salvage-selected.
  const API_AUTH_HEADERS_KEY = "voididle.sg.apiAuthHeaders.v1";

  function headersToPlainObject(headersLike) {
    const out = {};
    try {
      if (!headersLike) return out;
      const h = headersLike instanceof Headers ? headersLike : new Headers(headersLike);
      h.forEach((value, key) => { out[String(key).toLowerCase()] = String(value); });
    } catch {
      if (headersLike && typeof headersLike === "object") {
        for (const [key, value] of Object.entries(headersLike)) out[String(key).toLowerCase()] = String(value);
      }
    }
    return out;
  }

  function rememberApiAuthHeaders(headersLike) {
    const h = headersToPlainObject(headersLike);
    const auth = h.authorization || h["x-auth-token"] || h["x-access-token"] || h["x-supabase-auth"] || h["apikey"];
    if (!auth) return;

    const keep = {};
    for (const key of ["authorization", "x-auth-token", "x-access-token", "x-supabase-auth", "apikey", "x-csrf-token", "x-xsrf-token"]) {
      if (h[key]) keep[key] = h[key];
    }
    try { localStorage.setItem(API_AUTH_HEADERS_KEY, JSON.stringify({ headers: keep, savedAt: Date.now() })); } catch {}
  }

  function rememberApiAuthFromFetchArgs(args) {
    try {
      const initHeaders = args?.[1]?.headers;
      const requestHeaders = args?.[0]?.headers;
      rememberApiAuthHeaders(initHeaders || requestHeaders);
    } catch {}
  }

  function findAccessTokenInStorage() {
    const stores = [localStorage, sessionStorage];
    const seen = new Set();

    const consider = (value) => {
      if (!value || typeof value !== "string") return null;
      const raw = value.trim();
      if (!raw || seen.has(raw)) return null;
      seen.add(raw);

      // Plain JWT or Bearer token stored directly.
      if (/^Bearer\s+/i.test(raw)) return raw.replace(/^Bearer\s+/i, "").trim();
      if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) return raw;

      // JSON blobs used by Supabase/auth libraries.
      try {
        const obj = JSON.parse(raw);
        const walk = (node) => {
          if (!node || typeof node !== "object") return null;
          for (const key of ["access_token", "accessToken", "token", "jwt"]) {
            if (typeof node[key] === "string" && node[key].split(".").length === 3) return node[key];
          }
          for (const child of Object.values(node)) {
            const found = walk(child);
            if (found) return found;
          }
          return null;
        };
        return walk(obj);
      } catch {
        const m = raw.match(/"(?:access_token|accessToken|token|jwt)"\s*:\s*"([^"]+\.[^"]+\.[^"]+)"/);
        return m?.[1] || null;
      }
    };

    for (const store of stores) {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          const val = store.getItem(key);
          const found = consider(val);
          if (found) return found;
        }
      } catch {}
    }
    return null;
  }

  function getApiAuthHeaders() {
    try {
      const saved = JSON.parse(localStorage.getItem(API_AUTH_HEADERS_KEY) || "null");
      if (saved?.headers && typeof saved.headers === "object") {
        const out = {};
        for (const [key, value] of Object.entries(saved.headers)) out[key] = value;
        if (out.authorization || out["x-auth-token"] || out["x-access-token"]) return out;
      }
    } catch {}

    const token = findAccessTokenInStorage();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  // Hook fetch to capture /api/player/{id}/inspect responses
  (function hookInspectFetch() {
    const _orig = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "");
      if (/\/api\//i.test(url)) rememberApiAuthFromFetchArgs(args);
      const res = await _orig.apply(this, args);
      const method = String(args[1]?.method || args[0]?.method || "GET").toUpperCase();
      if (/\/api\/mail/i.test(url) && ["POST","PUT","PATCH"].includes(method)) {
        let parsed = null;
        try {
          const body = args[1]?.body || args[0]?.body || "";
          parsed = typeof body === "string" ? JSON.parse(body || "{}") : null;
        } catch {}
        rememberMailEndpoint(url, parsed, method);
      }
      if (/salvage/i.test(url) && ["POST","PUT","PATCH","DELETE"].includes(method)) {
        let parsed = null;
        try {
          const body = args[1]?.body || args[0]?.body || "";
          parsed = typeof body === "string" ? JSON.parse(body || "{}") : null;
        } catch {}
        rememberSalvageEndpoint(url, parsed, method);
      }
      const m = url.match(/\/api\/player\/([^/?]+)\/inspect/);
      if (m) {
        res.clone().json().then(data => {
          if (Array.isArray(data.equipped)) {
            pendingInspect[m[1]] = data;
          }
        }).catch(() => {});
      }
      return res;
    };
  })();

  function buildEquippedMap(equippedArray) {
    const map = {};
    for (const item of (equippedArray || [])) {
      if (!item.equippedSlot) continue;
      const raw  = item.equippedSlot;
      const slot = raw === "ring1" ? "Ring 1"
                 : raw === "ring2" ? "Ring 2"
                 : raw.charAt(0).toUpperCase() + raw.slice(1);
      map[slot] = item;
    }
    return map;
  }

  /**************************************************************************
   * STATE
   **************************************************************************/

  const _filters = loadFilters();
  const _storedKey = localStorage.getItem("sgActiveFilter") || "";

  const state = {
    filters:         _filters,
    activeFilterKey: _filters.has(_storedKey) ? _storedKey : (_filters.keys().next().value ?? ""),
    filterEdit:      null,
    activeTab:       "stats",
    gearMode:        "slot",

    level:null, hp:null, maxHp:null, mana:null, maxMana:null,
    xpPct:null, xpCurrent:null, xpTotal:null, xphr:null, zone:null,

    charViewOpen:false, charName:null,
    str:null, strDerived:null, int:null, intDerived:null,
    atkPhys:null, atkMag:null, critChance:null, critDmg:null,
    hitChance:null, atkSpeed:null, def:null, maxHpStat:null, maxManaStat:null,
    healPower:null, lifesteal:null, manaRegen:null,
    xpBonus:null, goldBonus:null, dropRate:null, allStats:null,
    kills:null, zonesVisited:null,

    equipped:{}, equippedCachedAt:null,
    bagItems:[], bagItemsRaw:[], bagVisible:false,
    catOpen:{ top:true, up:true, neu:false, skip:false, sal:false },
    highlightCats: new Set(),
    marketItems: [], marketVisible: false, marketHideFuture: false,
    teamSendStatus: "", teamSendBusy: false,
    salvageStatus: "", salvageBusy: false, salvageSelectedIds: new Set(),
  };

  /**************************************************************************
   * HELPERS
   **************************************************************************/

  function parseNum(raw) {
    if (raw == null) return NaN;
    let s = String(raw).trim(), mult = 1;
    if (/k$/i.test(s)) { mult = 1_000;     s = s.slice(0,-1); }
    if (/m$/i.test(s)) { mult = 1_000_000; s = s.slice(0,-1); }
    s = s.replace(/[^0-9.,\-]/g,"");
    if (!s) return NaN;
    if (s.includes(",")) s = s.replace(/\./g,"").replace(",",".");
    else                 s = s.replace(/\.(\d{3})(?=\.|$)/g,"$1");
    return (parseFloat(s) || 0) * mult;
  }

  function txt(sel, root) {
    return (root || document).querySelector(sel)?.textContent?.trim() ?? "";
  }

  function fmt(n) {
    n = Number(n);
    if (!isFinite(n)) return "—";
    if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+"M";
    if (n >= 1_000)     return (n/1_000).toFixed(1)+"K";
    return String(Math.round(n));
  }

  function fmtDec(n, d=1) { n=Number(n); return isFinite(n)?n.toFixed(d):"—"; }

  function esc(v) {
    return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function barHtml(val, max, color) {
    const p = max>0 ? Math.min(100,(val/max)*100) : 0;
    return `<div style="height:5px;background:#1e293b;border-radius:3px;overflow:hidden;margin-top:2px;">
      <div style="width:${p.toFixed(1)}%;height:100%;background:${color};border-radius:3px;"></div></div>`;
  }

  function rarityColor(r) { return RARITY_COLOR[String(r).toUpperCase()] ?? "#7A6E62"; }

  function normStatKey(k) { return STAT_KEY_MAP[k] ?? k; }
  function normForge(ft)  { return FORGE_TIER_SYMBOL[ft] ?? ""; }

  function calcMedian(vals) {
    if (!vals.length) return 1;
    const s = [...vals].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
  }

  function fmtDelta(delta) {
    const sign = delta > 0 ? "+" : "";
    const abs  = Math.abs(delta);
    if (abs >= 10 || delta === Math.round(delta)) return sign + Math.round(delta);
    return sign + delta.toFixed(1);
  }

  // DOM category label → set of item types the game puts in that group
  const DOM_CAT_TYPES = {
    "Weapons":     new Set(["bow","sword","spear","staff","harp","fan","axe","dagger","mace","wand","scepter","scythe","crossbow"]),
    "Armor":       new Set(["helmet","helm","shoulders","chest","robe","vestment","hands","gauntlets","gloves","legs","leg armor","greaves","boots","sabatons","shield"]),
    "Accessories": new Set(["amulet","ring"]),
  };

  // Uppercase item-type → slot name, built from existing ITEM_TYPE_TO_SLOT
  const TOOLTIP_TYPE_TO_SLOT = Object.fromEntries(
    Object.entries(ITEM_TYPE_TO_SLOT).map(([k, v]) => [k.toUpperCase(), v])
  );

  function parseChatTooltip(el) {
    // .tt-sub direct text node: "MYTHIC · AMULET" (tier is in a child <span>)
    const subEl = el.querySelector(".tt-sub");
    let subText = "";
    if (subEl) {
      for (const node of subEl.childNodes) {
        if (node.nodeType === 3) subText += node.textContent;
      }
    }
    subText = subText.trim();
    const parts   = subText.split("·").map(s => s.trim());
    const rarity   = parts[0] ?? "";
    const typePart = parts[1] ?? "";
    const slot     = TOOLTIP_TYPE_TO_SLOT[typePart] ?? null;

    const ttStats     = {};
    const ttQualities = {};
    el.querySelectorAll(".tt-stat-row").forEach(row => {
      const label   = row.querySelector(".tt-stat-label")?.textContent?.trim()?.toUpperCase();
      const valueEl = row.querySelector(".tt-stat-value");
      if (!label || !valueEl) return;
      // Grab only direct text nodes to skip the quality % span
      const rawText = [...valueEl.childNodes]
        .filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
      const value = parseFloat(rawText.replace(/[+%,\s]/g, ""));
      const key   = TOOLTIP_STAT_MAP[label];
      if (key && !isNaN(value)) {
        ttStats[key] = value;
        const qMatch = row.querySelector(".tt-stat-quality")?.textContent?.match(/(\d+)/);
        if (qMatch) ttQualities[key] = parseInt(qMatch[1]) / 100;
      }
    });

    return { rarity, slot, typePart, stats: ttStats, qualities: ttQualities };
  }

  function injectChatComparison(el) {
    if (el.querySelector(".sg-chat-compare")) return;

    const { rarity, slot, typePart, stats: ttStats, qualities: ttQualities } = parseChatTooltip(el);
    const div = document.createElement("div");
    div.className = "sg-chat-compare";

    const equippedItem = slot
      ? (state.equipped[slot] ?? state.equipped[slot + " 1"] ?? null)
      : null;

    if (!slot || !equippedItem) {
      div.innerHTML = `<div class="sg-chat-compare-hint">${
        !slot
          ? "Slot not recognized — stat labels may need updating."
          : "No cached equipped " + esc(slot) + ". Open inventory first."
      }</div>`;
      el.appendChild(div);
      return;
    }

    // Equipped item base stats (no forge/rune inflation)
    const eqBaseStats = {};
    for (const [k, v] of Object.entries(equippedItem.stats)) {
      if (k === "_qualities") continue;
      eqBaseStats[normStatKey(k)] = v;
    }

    // Diffs: tooltip stats vs equipped base
    const allKeys = new Set([...Object.keys(ttStats), ...Object.keys(eqBaseStats)]);
    const diffs   = [];
    for (const sk of allKeys) {
      const delta = (ttStats[sk] ?? 0) - (eqBaseStats[sk] ?? 0);
      if (Math.abs(delta) < 0.001) continue;
      const label = STAT_DEFS.find(d => d.key === sk)?.label ?? sk;
      diffs.push({ text:`${label} ${fmtDelta(delta)}`, stat:sk, isUp:delta>0, isDown:delta<0 });
    }

    // Score + recommendation using active filter
    const activeFC      = state.filters.get(state.activeFilterKey) ?? mkFC([]);
    const itemStatKeys  = new Set(Object.keys(ttStats));
    const maxSlots      = RARITY_STAT_SLOTS[rarity.toUpperCase()] ?? 4;
    const multiRollCount = Math.max(0, maxSlots - itemStatKeys.size);
    const priorityUps   = diffs.filter(d => d.isUp && activeFC.stats.has(d.stat)).length;
    const hasPriorityMR = multiRollCount > 0 && [...itemStatKeys].some(s => activeFC.stats.has(s));
    const score = calcPrefScore(diffs, activeFC, multiRollCount, itemStatKeys);
    let { rec, cat: chatCat } = applyQualityCap(
      recommendation(score, priorityUps, hasPriorityMR, activeFC),
      categoryOf(score, priorityUps, hasPriorityMR, activeFC),
      ttQualities, multiRollCount, slot
    );
    const hasChatPrefMR = multiRollCount > 0 && [...itemStatKeys].some(s => activeFC.preferredStats.has(s));
    if (hasChatPrefMR && (chatCat === "neu" || chatCat === "skip" || chatCat === "sal")) {
      rec = { label:"👍 Upgrade", cls:"rec-up" }; chatCat = "up";
    }
    // Class restriction cap for chat tooltips
    const chatItemType = typePart.toLowerCase();
    const chatEqWeapon = state.equipped["Weapon"];
    if (chatEqWeapon) {
      let chatRestricted = false;
      if (slot === "Weapon") {
        const allowed = WEAPON_FAMILIES[chatEqWeapon.type] ?? new Set([chatEqWeapon.type]);
        if (!allowed.has(chatItemType)) chatRestricted = true;
      } else if (slot === "Shield" && NO_SHIELD_WEAPONS.has(chatEqWeapon.type)) {
        chatRestricted = true;
      } else if (HEAVY_ARMOR_TYPES.has(chatItemType) && NO_HEAVY_ARMOR_WEAPONS.has(chatEqWeapon.type)) {
        chatRestricted = true;
      }
      if (chatRestricted && (chatCat === "top" || chatCat === "up")) {
        rec = { label:"↔ Neutral", cls:"rec-neu" };
      }
    }

    const eqForge = normForge(equippedItem.forgeTier);
    const eqLabel = `${eqForge ? eqForge + " " : ""}${equippedItem.name}${equippedItem.plus_level > 0 ? " +" + equippedItem.plus_level : ""}`;

    const diffsHtml = diffs.map(d => {
      const isPref  = activeFC.stats.has(d.stat);
      const isStar  = activeFC.preferredStats.has(d.stat);
      return `<span class="sg-diff ${d.isUp?"sg-diff-up":"sg-diff-down"}${isStar?" pref-star":isPref?" pref":""}">${esc(d.text)}</span>`;
    }).join("");

    div.innerHTML = `
      <div class="sg-chat-compare-head">
        <span class="sg-badge ${rec.cls}">${esc(rec.label)}</span>
        <span class="sg-chat-compare-vs">vs ${esc(eqLabel)}</span>
      </div>
      <div class="sg-diffs">${diffsHtml || '<span style="color:#4b5563;font-size:10px;">No stat differences</span>'}</div>
    `;
    el.appendChild(div);
  }

  function setupTooltipObserver() {
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList?.contains("chat-item-tooltip")) {
            injectChatComparison(n);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  const CAT_HL_CLASS = { top:"sg-hl-top", up:"sg-hl-up", neu:"sg-hl-neu", skip:"sg-hl-skip", sal:"sg-hl-sal" };

  function applyBagHighlights() {
    Object.values(CAT_HL_CLASS).forEach(cls =>
      document.querySelectorAll("."+cls).forEach(el => el.classList.remove(cls))
    );
    if (!state.highlightCats.size || !state.bagItems.length) return;

    const hlMap = new Map();
    for (const item of state.bagItems) {
      const cls = state.highlightCats.has(item.cat) ? CAT_HL_CLASS[item.cat] : null;
      if (cls) hlMap.set(item.id, cls);
    }
    if (!hlMap.size) return;

    const invPanel = document.querySelector(".inv-panel");
    if (!invPanel) return;
    const fkey = Object.keys(invPanel).find(k => k.startsWith("__reactFiber"));
    if (!fkey) return;
    let fiber = invPanel[fkey];
    while (fiber) {
      if (fiber.memoizedProps?.inventory) {
        _applyHighlightByPosition(fiber.memoizedProps.inventory, hlMap);
        return;
      }
      fiber = fiber.return;
    }
  }

  function _applyHighlightByPosition(inventory, hlMap) {
    const bagByCat = {};
    for (const [catLabel, types] of Object.entries(DOM_CAT_TYPES)) {
      bagByCat[catLabel] = inventory.filter(i => !i.equippedSlot && types.has(i.type));
    }

    document.querySelectorAll(".inv-panel .bag-category").forEach(catEl => {
      const label = catEl.querySelector(".bag-cat-label")?.textContent?.trim();
      const items  = bagByCat[label];
      if (!items?.length) return;
      catEl.querySelectorAll(".item-slot").forEach((slot, i) => {
        const cls = items[i] && hlMap.get(items[i].id);
        if (cls) slot.classList.add(cls);
      });
    });
  }

  /**************************************************************************
   * LOOT LOGIC
   **************************************************************************/

  function calcPrefScore(diffs, fc, multiRollCount, itemStatKeys) {
    let score = 0;
    for (const d of diffs) {
      const dir = d.isUp ? 1 : -1;
      if (fc.preferredStats.has(d.stat))      score += dir * 4;
      else if (fc.stats.has(d.stat))          score += dir * 2;
      else                                    score += dir * 0.5;
    }
    if (multiRollCount > 0) {
      for (const [stat, bonus] of Object.entries(fc.multiBonus ?? {})) {
        if (bonus > 0 && itemStatKeys.has(stat)) score += bonus;
      }
    }
    return score;
  }

  // qualifies = 3+ priority stats improved (scales down for small filters) OR a priority stat multi-rolled
  function _qualifies(priorityUps, hasPriorityMultiRoll, fc) {
    const total = (fc?.stats.size ?? 0) + (fc?.preferredStats.size ?? 0);
    if (!fc || total === 0) return false;
    const needed = Math.min(3, total);
    return priorityUps >= needed || hasPriorityMultiRoll;
  }

  function recommendation(score, priorityUps, hasPriorityMultiRoll, fc) {
    const q = _qualifies(priorityUps, hasPriorityMultiRoll, fc);
    if (score >= 4  && q) return { label:"✅ Top Pick", cls:"rec-top"  };
    if (score >= 1  && q) return { label:"👍 Upgrade",  cls:"rec-up"   };
    if (score >= -1)      return { label:"↔ Neutral",   cls:"rec-neu"  };
    if (score >= -3)      return { label:"⚠️ Skip",     cls:"rec-skip" };
    return                       { label:"💾 Salvage",  cls:"rec-sal"  };
  }

  function categoryOf(score, priorityUps, hasPriorityMultiRoll, fc) {
    const q = _qualifies(priorityUps, hasPriorityMultiRoll, fc);
    if (score >= 4  && q) return "top";
    if (score >= 1  && q) return "up";
    if (score >= -1)      return "neu";
    if (score >= -3)      return "skip";
    return "sal";
  }

  // Caps recommendation based on roll quality — diffs and scores are not affected
  function applyQualityCap(rec, cat, rollQualities, multiRollCount, slotType) {
    const qVals = Object.values(rollQualities);
    if (!qVals.length) return { rec, cat };

    const median      = calcMedian(qVals);
    const hasAllStats = "allStats" in rollQualities;

    // Weapon rule: ATK quality < 75% with no multi-roll → cap at Skip
    if (slotType === "Weapon" && !hasAllStats) {
      const atkQ = rollQualities["atk"] ?? null;
      if (atkQ !== null && atkQ < 0.75 && multiRollCount === 0) {
        if (cat === "top" || cat === "up" || cat === "neu") {
          return { rec:{ label:"⚠️ Skip", cls:"rec-skip" }, cat:"skip" };
        }
      }
    }

    // Median quality < 75%: cap at Neutral
    if (median < 0.75) {
      if (hasAllStats) {
        // allStats exception: force exactly Neutral — allStats has inherent value so prevent Salvage/Skip too
        return { rec:{ label:"↔ Neutral", cls:"rec-neu" }, cat:"neu" };
      }
      // Normal case: block Upgrade and Top Pick only
      if (cat === "top" || cat === "up") {
        return { rec:{ label:"↔ Neutral", cls:"rec-neu" }, cat:"neu" };
      }
    }

    return { rec, cat };
  }

  /**************************************************************************
   * DOM READERS
   **************************************************************************/

  function readPlayerBar() {
    const bar = document.querySelector(".player-bar");
    if (!bar) return;
    state.level = parseNum(txt(".pb-level", bar));
    const vitals = bar.querySelectorAll(".pb-vitals .pb-bar-group");
    if (vitals[0]) { const [h,mh] = txt(".pb-bar-text",vitals[0]).split("/").map(parseNum); state.hp=h; state.maxHp=mh; }
    if (vitals[1]) { const [m,mm] = txt(".pb-bar-text",vitals[1]).split("/").map(parseNum); state.mana=m; state.maxMana=mm; }
    state.xpPct = parseNum(txt(".pb-bar-text strong", bar));
    const xpM = txt(".pb-xp-raw", bar).match(/([\d.,]+)\s*\/\s*([\d.,]+)/);
    if (xpM) { state.xpCurrent=parseNum(xpM[1]); state.xpTotal=parseNum(xpM[2]); }
    state.xphr = txt(".pb-xphr-val", bar);
    state.zone  = txt(".pb-zone", bar);
  }

  function readCharView() {
    const cv = document.querySelector(".char-view");
    state.charViewOpen = !!cv;
    if (!cv) return;
    state.charName = txt(".cv-portrait-name", cv);
    cv.querySelectorAll(".cv-stat-row").forEach((row) => {
      const name = txt(".cv-stat-name", row);
      const val  = parseNum(txt(".cv-stat-value", row));
      const der  = row.nextElementSibling?.classList.contains("cv-stat-derived")
        ? row.nextElementSibling.textContent.trim() : "";
      if (name==="STR") { state.str=val; state.strDerived=der; }
      if (name==="INT") { state.int=val; state.intDerived=der; }
    });
    cv.querySelectorAll(".sb-stat-header").forEach((btn) => {
      const name = txt(".sb-stat-name", btn);
      const val  = parseNum(txt(".sb-stat-total", btn));
      switch (name) {
        case "Physical Attack": state.atkPhys    = val; break;
        case "Crit Chance":     state.critChance = val; break;
        case "Crit Damage":     state.critDmg    = val; break;
        case "Hit Chance":      state.hitChance  = val; break;
        case "Attack Speed":    state.atkSpeed   = val; break;
        case "Defense":         state.def        = val; break;
        case "Max HP":          state.maxHpStat  = val; break;
        case "Max Mana":        state.maxManaStat= val; break;
        case "Healing Power":   state.healPower  = val; break;
        case "Lifesteal":       state.lifesteal  = val; break;
        case "Mana Regen":      state.manaRegen  = val; break;
        case "XP Bonus":        state.xpBonus    = val; break;
        case "Gold Bonus":      state.goldBonus  = val; break;
        case "Drop Rate":       state.dropRate   = val; break;
        case "All Stats":       state.allStats   = val; break;
      }
    });
    const splitRow = cv.querySelector(".sb-phys-mag-row");
    if (splitRow) {
      splitRow.querySelectorAll(".sb-pm-val").forEach((v) => {
        const m = v.textContent.match(/Magical:\s*([\d.,]+)/);
        if (m) state.atkMag = parseNum(m[1]);
      });
    }
    cv.querySelectorAll(".char-stat-row").forEach((row) => {
      const label = txt(".char-stat-label", row);
      const val   = txt(".char-stat-value",  row);
      if (label==="Total Kills")   state.kills        = parseNum(val);
      if (label==="Zones Visited") state.zonesVisited = val;
    });
  }

  // Reads the full inventory from React state. Keeps cached data when panel is closed.
  function readInventoryState() {
    const invPanel = document.querySelector(".inv-panel");
    state.bagVisible = !!invPanel;
    if (!invPanel) return;

    const fkey = Object.keys(invPanel).find(k => k.startsWith("__reactFiber"));
    if (!fkey) return;
    let fiber = invPanel[fkey];
    while (fiber) {
      if (fiber.memoizedProps?.inventory) {
        _processInventory(fiber.memoizedProps.inventory);
        return;
      }
      fiber = fiber.return;
    }
  }

  function _processInventory(inventory) {
    const equippedMap = {};

    for (const item of inventory) {
      if (!item.equippedSlot || !GEAR_ITEM_TYPES.has(item.type)) continue;
      const raw  = item.equippedSlot;
      const slot = raw === "ring1" ? "Ring 1"
                 : raw === "ring2" ? "Ring 2"
                 : raw.charAt(0).toUpperCase() + raw.slice(1);
      equippedMap[slot] = item;
    }

    state.equipped        = equippedMap;
    state.equippedCachedAt = Date.now();

    state.bagItemsRaw = inventory.filter(item => !item.equippedSlot && GEAR_ITEM_TYPES.has(item.type));
    state.bagItems    = state.bagItemsRaw.map(item => _buildBagItem(item, equippedMap));
  }

  function _buildBagItem(item, equippedMap, filterKeyOverride = null) {
    const slotType   = ITEM_TYPE_TO_SLOT[item.type] ?? item.type;
    const rarity     = item.rarity.toUpperCase();
    const forge      = normForge(item.forgeTier);
    const forgeLevel = item.plus_level > 0 ? String(item.plus_level) : "";

    // totalStats = base rolls + forge/plus bonuses + runes — used for display only
    const ownStats = {};
    for (const [k, v] of Object.entries(item.totalStats)) {
      if (k === "_qualities") continue;
      ownStats[normStatKey(k)] = v;
    }

    // Base stats (raw rolls, no forge/rune inflation) — used for fair comparison
    const ownBaseStats = {};
    for (const [k, v] of Object.entries(item.stats)) {
      if (k === "_qualities") continue;
      ownBaseStats[normStatKey(k)] = v;
    }

    // Roll quality already provided as 0–100; convert to 0–1
    const rollQualities = {};
    for (const [k, v] of Object.entries(item.stats._qualities ?? {})) {
      rollQualities[normStatKey(k)] = v / 100;
    }

    // Equipped item for same slot — compare base-to-base so forge upgrades don't skew scoring
    const eqKey        = slotType === "Ring" ? (equippedMap["Ring 1"] ? "Ring 1" : "Ring 2") : slotType;
    const equippedItem = equippedMap[eqKey] ?? null;
    const eqBaseStats  = {};
    if (equippedItem) {
      for (const [k, v] of Object.entries(equippedItem.stats)) {
        if (k === "_qualities") continue;
        eqBaseStats[normStatKey(k)] = v;
      }
    }

    // Diffs use base stats on both sides for a fair apples-to-apples comparison
    const allKeys = new Set([...Object.keys(ownBaseStats), ...Object.keys(eqBaseStats)]);
    const diffs   = [];
    for (const sk of allKeys) {
      const delta = (ownBaseStats[sk] ?? 0) - (eqBaseStats[sk] ?? 0);
      if (Math.abs(delta) < 0.001) continue;
      const label = STAT_DEFS.find(d => d.key === sk)?.label ?? sk;
      diffs.push({ text:`${label} ${fmtDelta(delta)}`, stat:sk, isUp:delta>0, isDown:delta<0 });
    }

    // Multi-roll detection: item.stats has exactly the rolled stat count (no rune extras)
    const rawStatCount   = Object.keys(item.stats).filter(k => k !== "_qualities").length;
    const maxSlots       = RARITY_STAT_SLOTS[rarity] ?? 4;
    const multiRollCount = Math.max(0, maxSlots - rawStatCount);
    const itemStatKeys   = new Set(Object.keys(ownBaseStats));

    // Score + qualification data per filter
    const filterScores          = {};
    const filterPriorityUps     = {};
    const filterHasPriorityMR   = {};
    const filterHasPrefMR       = {};
    for (const [key, fc] of state.filters) {
      filterScores[key]        = calcPrefScore(diffs, fc, multiRollCount, itemStatKeys);
      filterPriorityUps[key]   = diffs.filter(d => d.isUp && (fc.stats.has(d.stat) || fc.preferredStats.has(d.stat))).length;
      filterHasPriorityMR[key] = multiRollCount > 0 && [...itemStatKeys].some(s => fc.stats.has(s) || fc.preferredStats.has(s));
      filterHasPrefMR[key]     = multiRollCount > 0 && [...itemStatKeys].some(s => fc.preferredStats.has(s));
    }

    const activeKey     = filterKeyOverride ?? state.activeFilterKey;
    const activeFC      = state.filters.get(activeKey);
    const prefScore     = filterScores[activeKey]        ?? 0;
    const activePriUps  = filterPriorityUps[activeKey]   ?? 0;
    const activePriMR   = filterHasPriorityMR[activeKey] ?? false;
    const activePrefMR  = filterHasPrefMR[activeKey]     ?? false;

    let bestFilter = null, bestFilterScore = -Infinity;
    for (const [key, score] of Object.entries(filterScores)) {
      const fc = state.filters.get(key);
      if (key !== activeKey && fc?.enabled && score > bestFilterScore &&
          _qualifies(filterPriorityUps[key] ?? 0, filterHasPriorityMR[key] ?? false, fc)) {
        bestFilterScore = score; bestFilter = key;
      }
    }

    let { rec, cat } = applyQualityCap(
      recommendation(prefScore, activePriUps, activePriMR, activeFC),
      categoryOf(prefScore, activePriUps, activePriMR, activeFC),
      rollQualities, multiRollCount, slotType
    );

    // Multi-roll floors (applied after quality cap):
    // • Double roll (any quality)       → at least Upgrade
    // • Triple+ roll, quality ≥ 75%    → at least Upgrade
    // • Triple+ roll, quality < 75%    → at least Neutral + "Interesting" flag
    const mrMedianQuality = multiRollCount > 0 ? calcMedian(Object.values(rollQualities)) : 1;
    let mrInteresting = false;
    if (multiRollCount >= 1) {
      if (multiRollCount === 1 || mrMedianQuality >= 0.75) {
        if (cat === "neu" || cat === "skip" || cat === "sal") {
          rec = { label:"👍 Upgrade", cls:"rec-up" }; cat = "up";
        }
      } else {
        if (cat === "skip" || cat === "sal") {
          rec = { label:"↔ Neutral", cls:"rec-neu" }; cat = "neu";
        }
        mrInteresting = true;
      }
    }

    // Preferred stat + any multi-roll → always at least Upgrade (overrides "interesting")
    if (activePrefMR && (cat === "neu" || cat === "skip" || cat === "sal")) {
      rec = { label:"👍 Upgrade", cls:"rec-up" }; cat = "up";
      mrInteresting = false;
    }

    // Class usability restriction — unusable item types are capped at Neutral regardless
    let classRestricted = false;
    const eqWeapon = equippedMap["Weapon"];
    if (eqWeapon) {
      if (slotType === "Weapon") {
        const allowed = WEAPON_FAMILIES[eqWeapon.type] ?? new Set([eqWeapon.type]);
        if (!allowed.has(item.type)) classRestricted = true;
      } else if (slotType === "Shield" && NO_SHIELD_WEAPONS.has(eqWeapon.type)) {
        classRestricted = true;
      } else if (HEAVY_ARMOR_TYPES.has(item.type) && NO_HEAVY_ARMOR_WEAPONS.has(eqWeapon.type)) {
        classRestricted = true;
      }
    }
    if (classRestricted && (cat === "top" || cat === "up")) {
      rec = { label:"↔ Neutral", cls:"rec-neu" }; cat = "neu";
    }

    return {
      id: item.id,
      name: item.name, slotType, weaponSubType: item.type,
      typeText: item.type.charAt(0).toUpperCase() + item.type.slice(1),
      rarity, forgeLevel, forge,
      diffs,
      parsedStats: Object.entries(ownStats).map(([stat, value]) => ({ stat, value })),
      rollQualities,
      multiRollCount, mrMedianQuality, mrInteresting, activePrefMR, classRestricted,
      shards: item.sellPrice,
      filterScores, filterPriorityUps, filterHasPriorityMR, filterHasPrefMR,
      prefScore, bestFilter, bestFilterScore,
      rec, cat,
      isLegacyStar: item.forgeTier === "starforged",
    };
  }

  function readMarketListings() {
    const mpPanel = document.querySelector(".mp-panel");
    state.marketVisible = !!mpPanel;
    if (!mpPanel) { state.marketItems = []; return; }

    // T1=Lv0, T2=Lv10, T3=Lv20 … max wearable tier from current level
    const mwt   = Math.floor((state.level ?? 0) / 10) + 1;
    const items = [];

    mpPanel.querySelectorAll(".mp-listing").forEach(el => {
      const fkey = Object.keys(el).find(k => k.startsWith("__reactFiber"));
      if (!fkey) return;
      const listingProps = el[fkey]?.return?.memoizedProps;
      if (!listingProps?.l?.item) return;
      const listing = listingProps.l;
      const raw     = listing.item;

      const item = {
        ...raw,
        id:           listing.id,
        forgeTier:    raw.forge_tier ?? raw.forgeTier ?? "",
        equippedSlot: null,
        sellPrice:    listing.price,
      };

      const itemTier     = raw.itemTier ?? 1;
      const isFutureTier = (itemTier - mwt) > 1;   // 2+ tiers ahead = not yet relevant
      const built        = _buildBagItem(item, state.equipped);
      items.push({ ...built, listingId: listing.id, price: listing.price, sellerName: listing.sellerName, itemTier, isFutureTier });
    });

    state.marketItems = items;
  }

  function applyMarketBadges() {
    if (!state.marketVisible) {
      document.querySelectorAll(".sg-mp-badge").forEach(el => el.remove());
      return;
    }
    const byId = new Map(state.marketItems.map(i => [i.listingId, i]));

    document.querySelectorAll(".mp-listing").forEach(el => {
      const fkey = Object.keys(el).find(k => k.startsWith("__reactFiber"));
      if (!fkey) return;
      const lid = el[fkey]?.return?.memoizedProps?.l?.id;
      if (!lid) return;

      const item     = byId.get(lid);
      const existing = el.querySelector(".sg-mp-badge");

      let wantCls = null, wantText = null;
      if (item?.isFutureTier) {
        wantCls  = `sg-mp-badge sg-badge sg-badge-future`;
        wantText = `🔒 T${item.itemTier}`;
      } else if (item?.cat === "top" || item?.cat === "up") {
        wantCls  = `sg-mp-badge sg-badge ${item.rec.cls}`;
        wantText = item.rec.label;
      }

      if (!wantCls) { existing?.remove(); return; }

      if (existing) {
        if (existing.className !== wantCls) existing.className = wantCls;
        if (existing.textContent !== wantText) existing.textContent = wantText;
      } else {
        const badge = document.createElement("span");
        badge.className   = wantCls;
        badge.textContent = wantText;
        el.style.position = "relative";
        el.appendChild(badge);
      }
    });

    document.querySelectorAll(".sg-mp-badge").forEach(b => {
      if (!b.closest(".mp-listing")) b.remove();
    });
  }

  /**************************************************************************
   * CALCULATIONS
   **************************************************************************/

  function calcDPS() {
    if (!state.atkPhys || !state.atkSpeed || state.atkSpeed <= 0) return null;
    const hitRate  = (state.hitChance  ?? 95)  / 100;
    const critRate = (state.critChance ?? 0)   / 100;
    const critMult = (state.critDmg    ?? 150) / 100;
    return (state.atkPhys / state.atkSpeed) * hitRate * (1 + critRate * (critMult - 1));
  }

  /**************************************************************************
   * CSS
   **************************************************************************/

  const CSS = `
    #sgPanel {
      position:fixed; z-index:2147483647;
      left:16px; top:50%; transform:translateY(-50%);
      width:300px; background:#060912; color:#e8eefc;
      border:1px solid rgba(255,255,255,.16); border-radius:12px;
      box-shadow:0 18px 60px rgba(0,0,0,.65);
      font:12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;
      overflow:hidden; display:flex; flex-direction:column;
      max-height:calc(100vh - 32px); transition:width .2s ease;
    }
    #sgPanel.sg-wide { width:480px; }
    #sgPanel.sg-hidden { display:none; }

    .sg-drag {
      display:flex; align-items:center; justify-content:space-between;
      padding:8px 10px;
      background:linear-gradient(180deg,#172033,#0d1321);
      border-bottom:1px solid rgba(255,255,255,.1);
      cursor:move; user-select:none; flex-shrink:0;
    }
    .sg-title { font-weight:900; font-size:13px; }
    .sg-btn {
      background:#141d30; color:#e8eefc;
      border:1px solid rgba(255,255,255,.16);
      border-radius:6px; padding:3px 8px;
      font:inherit; cursor:pointer; font-size:11px;
    }
    .sg-btn:hover { background:#1e2d45; }

    .sg-tabs {
      display:flex; background:#080f1c;
      border-bottom:1px solid rgba(255,255,255,.08); flex-shrink:0;
    }
    .sg-tab {
      flex:1; padding:7px 4px; background:none; color:#64748b;
      border:none; font:inherit; font-size:11px; cursor:pointer;
      border-bottom:2px solid transparent; transition:all .15s;
    }
    .sg-tab.active { color:#e8eefc; border-bottom-color:#3b82f6; }
    .sg-tab:hover:not(.active) { color:#94a3b8; }

    .sg-body { flex:1; overflow-y:auto; padding:8px 0; }
    .sg-body::-webkit-scrollbar { width:4px; }
    .sg-body::-webkit-scrollbar-track { background:transparent; }
    .sg-body::-webkit-scrollbar-thumb { background:#1e293b; border-radius:2px; }

    .sg-sec { padding:6px 10px; border-bottom:1px solid rgba(255,255,255,.05); }
    .sg-lbl { font-weight:700; font-size:10px; color:#3b82f6; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; }
    .sg-row { display:flex; justify-content:space-between; align-items:baseline; margin:2px 0; }
    .sg-key { color:#64748b; font-size:11px; }
    .sg-val { font-size:11px; font-weight:600; }
    .sg-derived { color:#4b5563; font-size:10px; padding-left:8px; margin-top:-1px; }

    .sg-dps-box { background:#0f172a; border-radius:8px; padding:8px; margin:4px 0; text-align:center; }
    .sg-dps-num { font-size:22px; font-weight:900; color:#f97316; }
    .sg-dps-calc { color:#64748b; font-size:10px; line-height:1.6; margin-top:4px; }

    .sg-gear-toolbar {
      display:flex; align-items:center; justify-content:space-between;
      padding:6px 10px; border-bottom:1px solid rgba(255,255,255,.06);
      flex-shrink:0; background:#080f1c;
    }
    .sg-hl-toolbar {
      display:flex; align-items:center; gap:4px; flex-wrap:wrap;
      padding:4px 10px; border-bottom:1px solid rgba(255,255,255,.06);
      flex-shrink:0; background:#080f1c;
    }
    .sg-hl-label { color:#4b5563; font-size:10px; flex-shrink:0; margin-right:2px; }
    .sg-mode-btn {
      background:#141d30; color:#64748b;
      border:1px solid rgba(255,255,255,.1);
      border-radius:5px; padding:3px 8px;
      font:inherit; font-size:11px; cursor:pointer;
    }
    .sg-mode-btn.active { color:#e8eefc; border-color:#3b82f6; }
    .sg-cache-hint { color:#374151; font-size:10px; }

    .sg-item {
      background:#0c1526; border:1px solid rgba(255,255,255,.06);
      border-left:3px solid #333; border-radius:7px;
      padding:7px 9px; margin:4px 0;
    }
    .sg-item-head { display:flex; align-items:center; gap:5px; margin-bottom:2px; }
    .sg-item-name { font-weight:700; font-size:11px; }
    .sg-item-meta { color:#4b5563; font-size:10px; margin-bottom:3px; }
    .sg-badges { display:flex; flex-wrap:wrap; gap:3px; margin-bottom:4px; }

    .sg-badge {
      font-size:10px; padding:1px 5px; border-radius:4px;
      border:1px solid; white-space:nowrap;
    }
    .rec-top  { color:#86efac; border-color:#166534; background:rgba(134,239,172,.1); }
    .rec-up   { color:#93c5fd; border-color:#1d4ed8; background:rgba(147,197,253,.1); }
    .rec-neu  { color:#94a3b8; border-color:#334155; background:rgba(148,163,184,.06); }
    .rec-skip { color:#fb923c; border-color:#9a3412; background:rgba(251,146,60,.1); }
    .rec-sal  { color:#fca5a5; border-color:#7f1d1d; background:rgba(252,165,165,.1); }
    .sg-badge-shard  { color:#a78bfa; border-color:#4c1d95; background:rgba(167,139,250,.1); }
    .sg-badge-legacy { color:#fbbf24; border-color:#78350f; background:rgba(251,191,36,.1); }
    .sg-badge-multi      { color:#c084fc; border-color:#581c87; background:rgba(192,132,252,.1); }
    .sg-badge-future     { color:#6b7280; border-color:#374151; background:rgba(107,114,128,.08); }
    .sg-badge-restricted { color:#6b7280; border-color:#374151; background:rgba(107,114,128,.06); }

    .sg-filter-row.disabled { opacity:.45; }
    .sg-toggle-btn { font-size:13px; line-height:1; padding:1px 4px; }
    .sg-toggle-btn.off { color:#374151; }

    .sg-mb-grid { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
    .sg-mb-chip {
      background:#141d30; color:#64748b;
      border:1px solid rgba(255,255,255,.1);
      border-radius:5px; padding:3px 7px;
      font:inherit; font-size:11px; cursor:pointer;
    }
    .sg-mb-chip.active { color:#c084fc; border-color:rgba(192,132,252,.5); background:rgba(192,132,252,.1); }

    .sg-diffs { display:flex; flex-wrap:wrap; gap:3px; margin-top:3px; }
    .sg-diff {
      font-size:10px; padding:1px 5px; border-radius:4px;
      border:1px solid rgba(255,255,255,.08); white-space:nowrap;
    }
    .sg-diff-up   { color:#86efac; }
    .sg-diff-down { color:#fca5a5; }
    .sg-diff.pref { border-color:rgba(59,130,246,.5); }

    .sg-diff-row { display:flex; align-items:center; gap:5px; margin:1px 0; flex-wrap:wrap; }
    .sg-qual-badge {
      font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px;
      border:1px solid; white-space:nowrap;
    }
    .sg-type-icon { font-size:11px; line-height:1; }

    .sg-multi {
      font-size:9px; padding:0 4px; border-radius:3px;
      background:rgba(251,191,36,.15); color:#fbbf24;
      border:1px solid rgba(251,191,36,.3);
    }

    .sg-filter-tags { display:flex; flex-wrap:wrap; gap:3px; margin-top:3px; }
    .sg-filter-tag {
      font-size:9px; padding:1px 4px; border-radius:3px;
      background:rgba(59,130,246,.1); color:#60a5fa;
      border:1px solid rgba(59,130,246,.25);
    }

    .sg-eq-label { color:#4b5563; font-size:10px; margin-bottom:4px; }

    .sg-cat-section { border-bottom:1px solid rgba(255,255,255,.05); }
    .sg-cat-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:7px 10px; cursor:pointer; user-select:none;
    }
    .sg-cat-header:hover { background:rgba(255,255,255,.02); }
    .sg-cat-title { display:flex; align-items:center; gap:6px; }
    .sg-cat-count { color:#4b5563; font-size:10px; }
    .sg-cat-toggle { color:#4b5563; font-size:11px; }
    .sg-cat-body.collapsed { display:none; }

    .sg-cat-item {
      display:flex; align-items:flex-start; gap:8px;
      margin:3px 10px; padding:6px 8px;
      background:#0c1526; border:1px solid rgba(255,255,255,.07);
      border-left:3px solid #333; border-radius:7px;
    }
    .sg-cat-item-left { flex:1; min-width:0; }
    .sg-cat-item-name {
      font-weight:700; font-size:11px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px;
    }
    .sg-cat-item-sub { color:#4b5563; font-size:10px; margin-bottom:3px; }
    .sg-cat-item-right { display:flex; flex-direction:column; align-items:flex-end; gap:3px; flex-shrink:0; }
    .sg-slot-pill {
      background:rgba(148,163,184,.1); border:1px solid rgba(148,163,184,.15);
      border-radius:4px; padding:1px 5px; font-size:10px; color:#64748b;
    }

    .sg-filter-list { display:flex; flex-direction:column; gap:4px; }
    .sg-filter-row {
      display:flex; align-items:center; gap:6px;
      padding:5px 8px; border-radius:6px;
      border:1px solid rgba(255,255,255,.07);
      background:#0c1526; cursor:pointer;
    }
    .sg-filter-row.active { border-color:rgba(59,130,246,.4); background:rgba(59,130,246,.08); }
    .sg-filter-dot { width:7px; height:7px; border-radius:50%; background:#334155; flex-shrink:0; }
    .sg-filter-row.active .sg-filter-dot { background:#3b82f6; }
    .sg-filter-name { flex:1; font-size:11px; font-weight:600; }
    .sg-filter-statcount { color:#4b5563; font-size:10px; }
    .sg-icon-btn {
      background:none; border:none; color:#4b5563;
      cursor:pointer; padding:2px 4px; border-radius:4px; font-size:11px;
    }
    .sg-icon-btn:hover { color:#e8eefc; background:rgba(255,255,255,.06); }

    .sg-filter-edit {
      background:#0a1220; border:1px solid rgba(59,130,246,.3);
      border-radius:8px; padding:8px; margin-top:6px;
    }
    .sg-filter-edit-row { display:flex; gap:5px; align-items:center; margin-bottom:6px; }
    .sg-filter-input {
      flex:1; background:#141d30; color:#e8eefc;
      border:1px solid rgba(255,255,255,.15); border-radius:5px;
      padding:4px 7px; font:inherit; font-size:11px;
    }
    .sg-pref-grid { display:flex; flex-wrap:wrap; gap:4px; margin:5px 0; }
    .sg-pref-chip {
      background:#141d30; color:#64748b;
      border:1px solid rgba(255,255,255,.1);
      border-radius:5px; padding:3px 8px;
      font:inherit; font-size:11px; cursor:pointer;
    }
    .sg-pref-chip.active { color:#93c5fd; border-color:rgba(59,130,246,.5); background:rgba(59,130,246,.12); }
    .sg-pref-chip.preferred { color:#fbbf24; border-color:rgba(251,191,36,.5); background:rgba(251,191,36,.12); }
    .sg-diff.pref-star { border-color:rgba(251,191,36,.55); }
    .sg-add-btn {
      width:100%; background:#0c1526; color:#4b5563;
      border:1px dashed rgba(255,255,255,.1); border-radius:6px;
      padding:6px; font:inherit; font-size:11px; cursor:pointer; margin-top:4px;
    }
    .sg-add-btn:hover { color:#94a3b8; border-color:rgba(255,255,255,.2); }
    .sg-preset-row { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }

    .sg-hint { color:#4b5563; font-size:11px; text-align:center; padding:14px 10px; }
    .c-green{color:#86efac;} .c-blue{color:#93c5fd;} .c-gold{color:#fde68a;}
    .c-orange{color:#fb923c;} .c-red{color:#fca5a5;} .c-purple{color:#c084fc;} .c-muted{color:#64748b;}

    .sg-inspect-save {
      position:absolute; top:10px; right:40px;
      background:#172554; color:#93c5fd;
      border:1px solid rgba(59,130,246,.4); border-radius:6px;
      padding:4px 10px; font:11px Inter,sans-serif; cursor:pointer; z-index:10;
    }
    .sg-inspect-save:hover { background:#1e3a8a; }
    .sg-team-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:8px 10px; cursor:pointer; user-select:none;
      border-bottom:1px solid rgba(255,255,255,.05);
    }
    .sg-team-header:hover { background:rgba(255,255,255,.02); }
    .sg-team-body.collapsed { display:none; }

    .sg-footer {
      text-align:center; font-size:9px; color:#1e293b;
      padding:5px 10px; border-top:1px solid rgba(255,255,255,.05);
      flex-shrink:0; transition:color .2s;
    }
    .sg-footer:hover { color:#475569; }
    .sg-footer-name { color:#1d3461; font-weight:700; transition:color .2s; }
    .sg-footer:hover .sg-footer-name { color:#3b82f6; }

    .sg-chat-compare {
      border-top:1px solid rgba(255,255,255,.14);
      margin-top:10px; padding-top:8px;
      font:11px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;
    }
    .sg-chat-compare-head {
      display:flex; align-items:center; gap:6px; margin-bottom:5px; flex-wrap:wrap;
    }
    .sg-chat-compare-vs { color:#4b5563; font-size:10px; }
    .sg-chat-compare-hint { color:#4b5563; font-size:10px; font-style:italic; }

    #sgToggle {
      position:fixed; z-index:2147483647;
      left:16px; top:50%; transform:translateY(-50%);
      background:#172554; color:white;
      border:1px solid rgba(255,255,255,.22); border-radius:999px;
      padding:7px 12px; font-weight:900; font-size:12px;
      cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,.4);
    }
  `;

  /**************************************************************************
   * UI SETUP
   **************************************************************************/

  let panelEl = null;

  function installUI() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.documentElement.appendChild(style);

    const hlStyle = document.createElement("style");
    hlStyle.textContent = `
      .sg-mp-badge {
        position:absolute !important; top:5px !important; right:5px !important;
        font:700 10px/1.4 Inter,sans-serif !important;
        padding:2px 7px !important; border-radius:4px !important;
        border:1px solid !important; z-index:10 !important; pointer-events:none !important;
      }
      .sg-hl-top  { outline:3px solid #22c55e !important; box-shadow:0 0 16px 4px rgba(34,197,94,.75) !important; border-radius:4px; }
      .sg-hl-up   { outline:3px solid #3b82f6 !important; box-shadow:0 0 16px 4px rgba(59,130,246,.75) !important; border-radius:4px; }
      .sg-hl-neu  { outline:3px solid #94a3b8 !important; box-shadow:0 0 16px 4px rgba(148,163,184,.65) !important; border-radius:4px; }
      .sg-hl-skip { outline:3px solid #f97316 !important; box-shadow:0 0 16px 4px rgba(249,115,22,.75) !important; border-radius:4px; }
      .sg-hl-sal  { outline:3px solid #ef4444 !important; box-shadow:0 0 16px 4px rgba(239,68,68,.75) !important; border-radius:4px; }
    `;
    document.documentElement.appendChild(hlStyle);

    panelEl = document.createElement("div");
    panelEl.id = "sgPanel";
    panelEl.innerHTML = `
      <div class="sg-drag" id="sgDrag">
        <span class="sg-title">⚡ Loot Helper</span>
        <button class="sg-btn" id="sgHide">Hide</button>
      </div>
      <div class="sg-tabs">
        <button class="sg-tab active" data-tab="stats">📊 Stats</button>
        <button class="sg-tab"        data-tab="gear">🎒 Gear</button>
        <button class="sg-tab"        data-tab="filters">⚙️ Filters</button>
        <button class="sg-tab"        data-tab="market">🏪 Market</button>
        <button class="sg-tab"        data-tab="team">👥 Team</button>
      </div>
      <div class="sg-body" id="sgBody"><div class="sg-hint">Waiting for data…</div></div>
      <div class="sg-footer">Produced, maintained &amp; improved by <span class="sg-footer-name">teCsor</span></div>
    `;

    const toggleEl = document.createElement("button");
    toggleEl.id = "sgToggle";
    toggleEl.textContent = "⚡ Loot";
    toggleEl.style.display = "none";

    document.documentElement.appendChild(panelEl);
    document.documentElement.appendChild(toggleEl);

    document.getElementById("sgHide").addEventListener("click", () => {
      panelEl.classList.add("sg-hidden"); toggleEl.style.display = "block";
    });
    toggleEl.addEventListener("click", () => {
      panelEl.classList.remove("sg-hidden"); toggleEl.style.display = "none";
    });

    panelEl.querySelectorAll(".sg-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        panelEl.querySelectorAll(".sg-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.activeTab = btn.dataset.tab;
        panelEl.classList.toggle("sg-wide", state.activeTab === "gear" || state.activeTab === "market" || state.activeTab === "team");
        render();
      });
    });

    makeDraggable(panelEl, document.getElementById("sgDrag"));
  }

  function makeDraggable(panel, handle) {
    let drag=false, ox=0, oy=0, ol=0, ot=0;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const r = panel.getBoundingClientRect();
      panel.style.transform = "none";
      panel.style.left = r.left+"px"; panel.style.top = r.top+"px";
      drag=true; ox=e.clientX; oy=e.clientY; ol=r.left; ot=r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      panel.style.left = Math.max(0, ol+e.clientX-ox)+"px";
      panel.style.top  = Math.max(0, ot+e.clientY-oy)+"px";
    });
    window.addEventListener("mouseup", () => { drag=false; });
  }

  /**************************************************************************
   * RENDER — Stats Tab
   **************************************************************************/

  function renderStats() {
    const hp=state.hp??0, maxHp=state.maxHp??0;
    const mana=state.mana??0, maxMana=state.maxMana??0;
    const hpRatio = maxHp>0 ? hp/maxHp : 0;
    const hpColor = hpRatio>0.6?"#4ade80":hpRatio>0.3?"#fde68a":"#f87171";
    const dps = calcDPS();
    const rawZone = (state.zone||"").replace(/^Party in /i,"").trim();
    const zoneTier = ZONE_TIERS[rawZone] ? `T${ZONE_TIERS[rawZone]}` : "";

    let html = `<div class="sg-sec">
      <div class="sg-lbl">Character</div>
      <div class="sg-row">
        <span class="sg-key">Name / Level</span>
        <span class="sg-val">${esc(state.charName||"—")} <span class="c-muted">Lv${state.level??"—"}</span></span>
      </div>
      <div class="sg-row">
        <span class="sg-key">Zone</span>
        <span class="sg-val c-muted" style="font-size:10px;max-width:175px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${esc(state.zone||"—")}${zoneTier?` <b>(${zoneTier})</b>`:""}
        </span>
      </div>
    </div>
    <div class="sg-sec">
      <div class="sg-lbl">Vitals</div>
      <div class="sg-row"><span class="sg-key">HP</span><span class="sg-val c-green">${fmt(hp)} / ${fmt(maxHp)}</span></div>
      ${barHtml(hp,maxHp,hpColor)}
      <div class="sg-row" style="margin-top:5px;"><span class="sg-key">Mana</span><span class="sg-val c-blue">${fmt(mana)} / ${fmt(maxMana)}</span></div>
      ${barHtml(mana,maxMana,"#60a5fa")}
      <div class="sg-row" style="margin-top:5px;"><span class="sg-key">XP</span>
        <span class="sg-val">${fmtDec(state.xpPct)}%${state.xphr?` <span class="c-gold" style="font-size:10px;">(${esc(state.xphr)})</span>`:""}</span></div>
      ${barHtml(state.xpPct??0,100,"#facc15")}
    </div>`;

    if (dps !== null) {
      const hitsPerSec = 1/state.atkSpeed;
      const critBonus  = (state.critChance/100)*((state.critDmg/100)-1);
      html += `<div class="sg-sec">
        <div class="sg-lbl">Theoretical DPS</div>
        <div class="sg-dps-box">
          <div class="sg-dps-num">${Math.round(dps).toLocaleString("en")}</div>
          <div class="sg-dps-calc">
            <b>${state.atkPhys} ATK</b> × <b>${fmtDec(hitsPerSec,2)}/s</b> (${state.atkSpeed}s)<br>
            × <b>${state.hitChance}%</b> Hit × <b>${fmtDec((1+critBonus)*100,1)}%</b> Avg DMG
            (${state.critChance}% Crit @ ${state.critDmg}%)
          </div>
        </div>
      </div>`;
    }

    if (state.charViewOpen) {
      html += `
      <div class="sg-sec">
        <div class="sg-lbl">Attack</div>
        <div class="sg-row"><span class="sg-key">Phys. ATK</span>   <span class="sg-val c-red">${state.atkPhys??"—"}</span></div>
        <div class="sg-row"><span class="sg-key">Magic. ATK</span>  <span class="sg-val c-purple">${state.atkMag??"—"}</span></div>
        <div class="sg-row"><span class="sg-key">Attack Speed</span><span class="sg-val">${state.atkSpeed??"—"}s</span></div>
        <div class="sg-row"><span class="sg-key">Hit Chance</span>  <span class="sg-val">${state.hitChance??"—"}%</span></div>
        <div class="sg-row"><span class="sg-key">Crit Chance</span> <span class="sg-val c-orange">${state.critChance??"—"}%</span></div>
        <div class="sg-row"><span class="sg-key">Crit Damage</span> <span class="sg-val c-orange">${state.critDmg??"—"}%</span></div>
        <div class="sg-row"><span class="sg-key">Lifesteal</span>   <span class="sg-val c-green">${state.lifesteal??"—"}%</span></div>
      </div>
      <div class="sg-sec">
        <div class="sg-lbl">Defense</div>
        <div class="sg-row"><span class="sg-key">DEF</span>        <span class="sg-val c-blue">${state.def??"—"}</span></div>
        <div class="sg-row"><span class="sg-key">Max HP</span>     <span class="sg-val c-green">${fmt(state.maxHpStat)}</span></div>
        <div class="sg-row"><span class="sg-key">Max Mana</span>   <span class="sg-val c-blue">${state.maxManaStat??"—"}</span></div>
        <div class="sg-row"><span class="sg-key">Heal Power</span> <span class="sg-val c-green">${state.healPower??"—"}</span></div>
        <div class="sg-row"><span class="sg-key">Mana Regen</span> <span class="sg-val c-blue">${state.manaRegen??"—"}</span></div>
      </div>
      <div class="sg-sec">
        <div class="sg-lbl">Base Stats</div>
        <div class="sg-row"><span class="sg-key">STR</span><span class="sg-val">${state.str??"—"}</span></div>
        ${state.strDerived?`<div class="sg-derived">${esc(state.strDerived)}</div>`:""}
        <div class="sg-row"><span class="sg-key">INT</span><span class="sg-val">${state.int??"—"}</span></div>
        ${state.intDerived?`<div class="sg-derived">${esc(state.intDerived)}</div>`:""}
      </div>
      <div class="sg-sec">
        <div class="sg-lbl">Bonuses</div>
        <div class="sg-row"><span class="sg-key">XP Bonus</span>   <span class="sg-val c-gold">+${state.xpBonus??"—"}%</span></div>
        <div class="sg-row"><span class="sg-key">Gold Bonus</span> <span class="sg-val c-gold">+${state.goldBonus??"—"}%</span></div>
        <div class="sg-row"><span class="sg-key">Drop Rate</span>  <span class="sg-val c-gold">+${state.dropRate??"—"}%</span></div>
        <div class="sg-row"><span class="sg-key">All Stats</span>  <span class="sg-val c-gold">+${state.allStats??"—"}%</span></div>
      </div>`;
      if (state.kills !== null) {
        html += `<div class="sg-sec">
          <div class="sg-lbl">Progress</div>
          <div class="sg-row"><span class="sg-key">Total Kills</span><span class="sg-val">${fmt(state.kills)}</span></div>
          ${state.zonesVisited?`<div class="sg-row"><span class="sg-key">Zones</span><span class="sg-val">${esc(state.zonesVisited)}</span></div>`:""}
        </div>`;
      }
    } else {
      html += `<div class="sg-hint">Open <strong>Character Screen</strong><br>for full stats.</div>`;
    }
    return html;
  }

  /**************************************************************************
   * RENDER — Filters Tab
   **************************************************************************/

  function renderFilters() {
    const fe = state.filterEdit;
    let html = `<div class="sg-sec">
      <div class="sg-lbl">Filters</div>
      <div class="sg-filter-list">`;

    for (const [key, fc] of state.filters) {
      const isActive  = key === state.activeFilterKey;
      const isEditing = fe?.key === key;
      html += `<div class="sg-filter-row${isActive?" active":""}${fc.enabled?"":" disabled"}" data-fkey="${esc(key)}">
        <div class="sg-filter-dot"></div>
        <span class="sg-filter-name">${esc(key)}</span>
        <span class="sg-filter-statcount">${fc.stats.size + fc.preferredStats.size} stats${fc.preferredStats.size ? ` · ★${fc.preferredStats.size}` : ""}</span>
        <button class="sg-icon-btn sg-toggle-btn${fc.enabled?"":" off"}" data-ftoggle="${esc(key)}" title="${fc.enabled?"Disable":"Enable"}">${fc.enabled?"●":"○"}</button>
        <button class="sg-icon-btn" data-edit="${esc(key)}">✏</button>
        ${state.filters.size>1?`<button class="sg-icon-btn" data-del="${esc(key)}">✗</button>`:""}
      </div>`;
      if (isEditing) {
        html += `<div class="sg-filter-edit">
          <div class="sg-filter-edit-row">
            <input class="sg-filter-input" id="sgFeName" value="${esc(fe.name)}" placeholder="Filter name">
            <button class="sg-btn" id="sgFeSave">Save</button>
            <button class="sg-btn" id="sgFeCancel">✗</button>
          </div>
          <div style="font-size:10px;color:#64748b;margin:2px 0 4px;">Click to cycle: off → ♥ Liked (±2) → ★ Preferred (±4) → off</div>
          <div class="sg-pref-grid">`;
        for (const def of STAT_DEFS) {
          const isPref  = fe.preferredStats.has(def.key);
          const isLiked = fe.stats.has(def.key);
          const cls     = isPref ? "sg-pref-chip preferred" : isLiked ? "sg-pref-chip active" : "sg-pref-chip";
          const lbl     = isPref ? `★ ${def.label}` : isLiked ? `♥ ${def.label}` : def.label;
          html += `<button class="${cls}" data-estat="${esc(def.key)}">${esc(lbl)}</button>`;
        }
        html += `</div>
          <div style="font-size:10px;color:#64748b;margin:8px 0 4px;">Multi-roll bonus — click to cycle +0→+1→+2→+3:</div>
          <div class="sg-mb-grid">`;
        for (const def of STAT_DEFS) {
          const val = fe.multiBonus[def.key] ?? 0;
          html += `<button class="sg-mb-chip${val>0?" active":""}" data-mbstat="${esc(def.key)}">${esc(def.label)}${val>0?" +"+val:""}</button>`;
        }
        html += `</div></div>`;
      }
    }

    html += `</div>
      <button class="sg-add-btn" id="sgFeAdd">+ New Filter</button>
    </div>`;

    if (!fe) {
      html += `<div class="sg-sec">
        <div class="sg-lbl">Init from Preset</div>
        <div class="sg-preset-row">`;
      for (const name of Object.keys(FILTER_PRESETS)) {
        html += `<button class="sg-btn" data-preset="${esc(name)}">${esc(name)}</button>`;
      }
      html += `</div></div>`;

      const activeFC = state.filters.get(state.activeFilterKey) ?? mkFC([]);
      html += `<div class="sg-sec">
        <div class="sg-lbl">Stats — ${esc(state.activeFilterKey)}</div>
        <div style="font-size:10px;color:#4b5563;margin-bottom:4px;">Click to cycle: off → ♥ Liked → ★ Preferred → off · ★ double-roll → always Upgrade</div>
        <div class="sg-pref-grid">`;
      for (const def of STAT_DEFS) {
        const isPref  = activeFC.preferredStats.has(def.key);
        const isLiked = activeFC.stats.has(def.key);
        const cls     = isPref ? "sg-pref-chip preferred" : isLiked ? "sg-pref-chip active" : "sg-pref-chip";
        const lbl     = isPref ? `★ ${def.label}` : isLiked ? `♥ ${def.label}` : def.label;
        html += `<button class="${cls}" data-qstat="${esc(def.key)}">${esc(lbl)}</button>`;
      }
      html += `</div></div>`;
    }

    return html;
  }

  /**************************************************************************
   * RENDER — Gear Tab
   **************************************************************************/

  function renderGear() {
    const cacheAge = state.equippedCachedAt
      ? Math.floor((Date.now()-state.equippedCachedAt)/1000) : null;
    const statusText = state.bagVisible
      ? `${state.bagItems.length} items (live)`
      : state.bagItems.length
        ? `${state.bagItems.length} cached`
        : "open inventory";

    const CAT_HL_STYLE = {
      top:  "color:#86efac;border-color:#22c55e;",
      up:   "color:#93c5fd;border-color:#3b82f6;",
      neu:  "color:#94a3b8;border-color:#64748b;",
      skip: "color:#fb923c;border-color:#f97316;",
      sal:  "color:#fca5a5;border-color:#ef4444;",
    };
    const CAT_HL_EMOJI = { top:"✅", up:"👍", neu:"↔", skip:"⚠️", sal:"💾" };

    let html = `<div class="sg-gear-toolbar">
      <div style="display:flex;gap:5px;">
        <button class="sg-mode-btn${state.gearMode==="slot"?" active":""}" id="sgModeSlot">📦 Slot</button>
        <button class="sg-mode-btn${state.gearMode==="category"?" active":""}" id="sgModeCat">🏷 Category</button>
      </div>
      <span class="sg-cache-hint">
        ${esc(statusText)}
        ${cacheAge!==null?` · ${cacheAge}s ago`:""}
        · <span style="color:#3b82f6;">${esc(state.activeFilterKey||"—")}</span>
      </span>
    </div>
    <div class="sg-hl-toolbar">
      <span class="sg-hl-label">Highlight:</span>
      <button class="sg-mode-btn${state.highlightCats.size===CATEGORIES.length?" active":""}" id="sgHlAll"
        style="${state.highlightCats.size===CATEGORIES.length?"color:#e8eefc;border-color:#3b82f6;":""}"
        title="Toggle all highlights">All</button>
      ${CATEGORIES.map(cat => {
        const active = state.highlightCats.has(cat.key);
        const count  = state.bagItems.filter(i => i.cat === cat.key).length;
        return `<button class="sg-mode-btn${active?" active":""}" data-hlcat="${esc(cat.key)}"
          style="${active ? CAT_HL_STYLE[cat.key] : ""}"
          title="${esc(cat.label)}">${CAT_HL_EMOJI[cat.key]} ${count}</button>`;
      }).join("")}
    </div>`;

    const checkedSalvageCount = getSelectedSalvageItems().length;
    const highlightedSalvageCount = getHighlightedSalvageItems().length;
    const selectedSalvageCount = getSalvageTargetItems().length;
    const salvageRecCount = state.bagItems.filter(i => i.cat === "sal").length;
    html += `<div class="sg-hl-toolbar" style="border-top:1px solid rgba(255,255,255,.04);padding-top:5px;align-items:center;">
      <span class="sg-hl-label">Salvage:</span>
      <button class="sg-mode-btn" data-sg-select-salvage ${(!salvageRecCount || state.salvageBusy) ? "disabled" : ""}
        style="${(!salvageRecCount || state.salvageBusy) ? "opacity:.45;cursor:not-allowed;" : "color:#fca5a5;border-color:#ef4444;"}"
        title="Highlight the Salvage recommendation category">Highlight Salvage (${salvageRecCount})</button>
      <button class="sg-mode-btn" data-sg-clear-salvage ${((!checkedSalvageCount && !highlightedSalvageCount) || state.salvageBusy) ? "disabled" : ""}
        style="${((!checkedSalvageCount && !highlightedSalvageCount) || state.salvageBusy) ? "opacity:.45;cursor:not-allowed;" : ""}">Clear</button>
      <button class="sg-mode-btn" data-sg-salvage-selected ${(!selectedSalvageCount || state.salvageBusy) ? "disabled" : ""}
        style="${(!selectedSalvageCount || state.salvageBusy) ? "opacity:.45;cursor:not-allowed;" : "color:#fca5a5;border-color:#ef4444;background:rgba(239,68,68,.08);"}"
        title="Salvage gear items selected by the Highlight buttons, plus any checked items">💾 ${state.salvageBusy ? "Salvaging…" : `Salvage Highlighted (${selectedSalvageCount})`}</button>
      ${state.salvageStatus ? `<span style="font-size:10px;line-height:1.25;color:${state.salvageStatus.startsWith("Salvaged") ? "#4ade80" : state.salvageStatus.startsWith("Salvaging") ? "#93c5fd" : "#fca5a5"};">${esc(state.salvageStatus)}</span>` : ""}
    </div>`;

    if (!state.bagItems.length) {
      html += `<div class="sg-hint">Open <strong>Inventory</strong><br>to load items.</div>`;
      return html;
    }
    if (!Object.keys(state.equipped).length) {
      html += `<div class="sg-hint" style="padding:6px 10px;">No equipped gear cached — diffs unavailable.</div>`;
    }
    html += state.gearMode==="category" ? renderGearByCategory() : renderGearBySlot();
    return html;
  }

  function renderGearBySlot() {
    const bySlot = {};
    for (const item of state.bagItems) {
      const slot = (item.slotType==="Ring 1"||item.slotType==="Ring 2") ? "Ring" : item.slotType;
      (bySlot[slot] ??= []).push({ ...item, slotType:slot });
    }
    for (const items of Object.values(bySlot)) items.sort((a,b) => b.prefScore-a.prefScore);

    let html="", hasAny=false;
    for (const slot of GEAR_SLOT_ORDER) {
      const items = bySlot[slot];
      if (!items?.length) continue;
      hasAny = true;
      const eq      = state.equipped[slot] ?? state.equipped[slot+" 1"] ?? null;
      const eqColor = eq ? rarityColor(eq.rarity) : "#4b5563";
      const eqForge = eq ? normForge(eq.forgeTier) : "";
      const eqText  = eq
        ? `<span style="color:${eqColor};">${eqForge?esc(eqForge)+" ":""}${esc(eq.name)}${eq.plus_level>0?" +"+eq.plus_level:""}</span>`
        : `<span class="c-muted">— not cached</span>`;
      html += `<div class="sg-sec">
        <div class="sg-lbl">${esc(slot)}</div>
        <div class="sg-eq-label">Equipped: ${eqText}</div>
        ${items.map(renderItemCard).join("")}
      </div>`;
    }
    if (!hasAny) html += `<div class="sg-hint">No gear items in bag.</div>`;
    return html;
  }

  function renderGearByCategory() {
    const bycat = {};
    for (const cat of CATEGORIES) bycat[cat.key] = [];
    for (const item of state.bagItems) bycat[item.cat]?.push(item);
    for (const list of Object.values(bycat)) list.sort((a,b) => b.prefScore-a.prefScore);

    let html = "";
    for (const cat of CATEGORIES) {
      const items   = bycat[cat.key];
      const defOpen = state.catOpen[cat.key] ?? (cat.key==="top"||cat.key==="up");
      html += `<div class="sg-cat-section" data-cat="${esc(cat.key)}">
        <div class="sg-cat-header">
          <span class="sg-cat-title">
            <span class="sg-badge ${cat.cls}">${esc(cat.label)}</span>
            <span class="sg-cat-count">${items.length}</span>
          </span>
          <span class="sg-cat-toggle">${defOpen?"▾":"▸"}</span>
        </div>
        <div class="sg-cat-body${defOpen?"":" collapsed"}">
          ${items.length ? items.map(renderCatItem).join("") : `<div style="padding:6px 10px;color:#4b5563;font-size:10px;">—</div>`}
        </div>
      </div>`;
    }
    return html;
  }

  /**************************************************************************
   * RENDER — Market Tab
   **************************************************************************/

  function renderMarket() {
    if (!state.marketVisible) {
      return `<div class="sg-hint">Open the <strong>Market</strong><br>to scan listings.</div>`;
    }
    if (!state.marketItems.length) {
      return `<div class="sg-hint">No gear listings visible.<br>Switch to Weapons / Armor / Jewelry.</div>`;
    }
    if (!Object.keys(state.equipped).length) {
      return `<div class="sg-hint" style="padding:6px 10px;">No equipped gear cached — open inventory first for diffs.</div>`;
    }

    const mwt         = Math.floor((state.level ?? 0) / 10) + 1;
    const nowItems    = state.marketItems.filter(i => !i.isFutureTier);
    const futureItems = state.marketItems.filter(i =>  i.isFutureTier);
    const topItems    = nowItems.filter(i => i.cat === "top");
    const upItems     = nowItems.filter(i => i.cat === "up");
    const neuItems    = nowItems.filter(i => i.cat === "neu");

    let html = `<div class="sg-gear-toolbar">
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="color:#e8eefc;font-size:11px;font-weight:600;">${state.marketItems.length} listings</span>
        <span style="color:#4b5563;font-size:10px;">max T${mwt} (Lv${state.level??0})</span>
      </div>
      <div style="display:flex;gap:5px;align-items:center;">
        ${futureItems.length ? `<button class="sg-mode-btn${state.marketHideFuture?" active":""}" id="sgMktHideFuture"
          style="${state.marketHideFuture?"color:#6b7280;border-color:#374151;":""}"
          title="${state.marketHideFuture?"Show":"Hide"} future tier items">🔒 ${futureItems.length}</button>` : ""}
        <span class="sg-cache-hint">· <span style="color:#3b82f6;">${esc(state.activeFilterKey||"—")}</span></span>
      </div>
    </div>`;

    if (!topItems.length && !upItems.length) {
      html += `<div class="sg-hint">No Top Picks or Upgrades<br>in current tier range.</div>`;
    }

    const groups = [
      { cls:"rec-top", label:"✅ Top Pick", items: topItems },
      { cls:"rec-up",  label:"👍 Upgrade",  items: upItems  },
      { cls:"rec-neu", label:"↔ Neutral",   items: neuItems },
    ].filter(g => g.items.length);

    for (const g of groups) {
      g.items.sort((a, b) => b.prefScore - a.prefScore);
      html += `<div class="sg-sec">
        <div class="sg-lbl">
          <span class="sg-badge ${g.cls}">${esc(g.label)}</span>
          <span class="sg-cat-count" style="margin-left:5px;">${g.items.length}</span>
        </div>
        ${g.items.map(renderMarketItem).join("")}
      </div>`;
    }

    if (futureItems.length && !state.marketHideFuture) {
      const fs = [...futureItems].sort((a, b) => a.itemTier - b.itemTier || b.prefScore - a.prefScore);
      html += `<div class="sg-sec" style="opacity:.5;">
        <div class="sg-lbl">
          <span class="sg-badge sg-badge-future">🔒 Future — T${mwt+2}+</span>
          <span class="sg-cat-count" style="margin-left:5px;">${futureItems.length}</span>
        </div>
        ${fs.slice(0, 6).map(renderMarketItem).join("")}
        ${futureItems.length > 6 ? `<div style="color:#374151;font-size:10px;padding:4px 10px;">+${futureItems.length-6} more…</div>` : ""}
      </div>`;
    }

    return html;
  }

  function renderMarketItem(item) {
    const color    = rarityColor(item.rarity);
    const activeFC = state.filters.get(state.activeFilterKey) ?? mkFC([]);
    const forgeStr = item.forgeLevel ? `+${item.forgeLevel}` : "";
    const priceStr = item.price >= 1_000_000 ? (item.price/1_000_000).toFixed(1)+"M"
                   : item.price >= 1_000     ? Math.round(item.price/1_000)+"K"
                   : String(item.price);
    const mrRaw    = {1:"Double",2:"Triple",3:"Quad"}[item.multiRollCount];
    const mrQPct   = item.multiRollCount ? Math.round((item.mrMedianQuality??1)*100) : 0;
    const mrQCol   = mrQPct>=80?"#4ade80":mrQPct>=60?"#fde68a":"#f87171";
    const mrLabel  = mrRaw ? `${mrRaw} Roll <span style="color:${mrQCol}">${mrQPct}%</span>${item.mrInteresting?" 🎲 Interesting":""}` : null;

    const chips = item.diffs.slice(0, 4).map(d => {
      const isPref  = d.stat && activeFC.stats.has(d.stat);
      const isStar  = d.stat && activeFC.preferredStats.has(d.stat);
      return `<span class="sg-diff ${d.isUp?"sg-diff-up":"sg-diff-down"}${isStar?" pref-star":isPref?" pref":""}">${esc(d.text)}</span>`;
    }).join("");

    return `<div class="sg-cat-item" style="border-left-color:${color};">
      <div class="sg-cat-item-left">
        <div class="sg-cat-item-name" style="color:${color};">
          ${ITEM_ICONS[item.weaponSubType]?`<span class="sg-type-icon">${ITEM_ICONS[item.weaponSubType]}</span> `:""}${item.forge?`<span style="color:#facc15;">${esc(item.forge)}</span> `:""}${esc(item.name)}${forgeStr?` <span style="color:#64748b;">${esc(forgeStr)}</span>`:""}
        </div>
        <div class="sg-cat-item-sub">${esc(item.rarity)} · T${item.itemTier??"?"} ${mrLabel?"· "+mrLabel+" ":""} · ${esc(item.sellerName)}</div>
        <div class="sg-diffs">${chips||'<span style="color:#4b5563;font-size:10px;">No diffs vs equipped</span>'}</div>
      </div>
      <div class="sg-cat-item-right">
        <label title="Select for salvage" style="display:inline-flex;align-items:center;gap:3px;color:#64748b;font-size:10px;cursor:pointer;"><input type="checkbox" data-sg-salvage-check="${esc(item.id)}" ${state.salvageSelectedIds.has(String(item.id)) ? "checked" : ""} style="width:12px;height:12px;accent-color:#ef4444;cursor:pointer;"> select</label>
        <span class="sg-slot-pill">${esc(item.slotType)}</span>
        <span class="sg-badge sg-badge-shard" style="color:#fde68a;border-color:#78350f;background:rgba(253,230,138,.1);">💰 ${priceStr}</span>
      </div>
    </div>`;
  }

  /**************************************************************************
   * RENDER — Item Cards
   **************************************************************************/

  function qualityBadge(q) {
    if (q === null || q === undefined) return "";
    const pct = Math.round(q * 100);
    const [color, bg, border] =
      q >= 0.8 ? ["#4ade80","rgba(134,239,172,.15)","rgba(134,239,172,.35)"] :
      q >= 0.5 ? ["#fde68a","rgba(253,230,138,.15)","rgba(253,230,138,.35)"] :
                 ["#f87171","rgba(252,165,165,.15)","rgba(252,165,165,.35)"];
    return `<span class="sg-qual-badge" style="color:${color};background:${bg};border-color:${border};">${pct}%</span>`;
  }

  function filterTagsHtml(item) {
    const tags = Object.entries(item.filterScores)
      .filter(([k, s]) => {
        if (k === state.activeFilterKey) return false;
        const fc = state.filters.get(k);
        if (!fc?.enabled || s < 1) return false;
        return _qualifies(item.filterPriorityUps?.[k] ?? 0, item.filterHasPriorityMR?.[k] ?? false, fc);
      })
      .sort(([,a],[,b]) => b-a)
      .map(([k]) => `<span class="sg-filter-tag">${esc(k)}</span>`);
    return tags.length ? `<div class="sg-filter-tags">${tags.join("")}</div>` : "";
  }

  function multiHtml(item) {
    if (!item.multiRollCount) return "";
    const label  = {1:"Double",2:"Triple",3:"Quad"}[item.multiRollCount] ?? `×${item.multiRollCount+1}`;
    const qPct   = Math.round((item.mrMedianQuality ?? 1) * 100);
    const qColor = qPct >= 80 ? "#4ade80" : qPct >= 60 ? "#fde68a" : "#f87171";
    const note   = item.mrInteresting ? ` · <span style="color:#a78bfa;">🎲 Interesting</span>` : "";
    return `<span class="sg-badge sg-badge-multi">${label} Roll <span style="color:${qColor};font-weight:700;">${qPct}%</span>${note}</span>`;
  }

  function renderItemCard(item, opts = {}) {
    const selectable = opts.selectable !== false;
    const checked = state.salvageSelectedIds.has(String(item.id));
    const color     = rarityColor(item.rarity);
    const forgeStr  = item.forgeLevel ? `+${item.forgeLevel}` : "";
    const activeFC  = state.filters.get(state.activeFilterKey) ?? mkFC([]);
    const teamSendButton = opts.teamSendProfileId
      ? `<button type="button" class="sg-btn" data-sg-team-send-one="${esc(opts.teamSendProfileId)}" data-item-id="${esc(item.id)}" ${state.teamSendBusy ? "disabled" : ""} style="padding:1px 6px;font-size:9px;margin-left:4px;${state.teamSendBusy ? "opacity:.45;cursor:not-allowed;" : "border-color:rgba(74,222,128,.35);color:#86efac;"}" title="Send only this item to this teammate through Mail">📬 Send this</button>`
      : "";
    const badges    = [
      `<span class="sg-badge ${item.rec.cls}">${esc(item.rec.label)}</span>`,
      `<span class="sg-badge sg-badge-shard">💎 ${item.shards}</span>`,
      item.isLegacyStar ? `<span class="sg-badge sg-badge-legacy">★ Legacy</span>` : "",
      multiHtml(item),
      item.classRestricted ? `<span class="sg-badge sg-badge-restricted">🔒 Wrong type</span>` : "",
      teamSendButton,
    ].filter(Boolean).join("");

    const icon = ITEM_ICONS[item.weaponSubType] ?? "";
    const diffsHtml = item.diffs.map(d => {
      const isPref  = d.stat && activeFC.stats.has(d.stat);
      const isStar  = d.stat && activeFC.preferredStats.has(d.stat);
      const q = d.stat ? (item.rollQualities[d.stat] ?? null) : null;
      return `<div class="sg-diff-row">
        <span class="sg-diff ${d.isUp?"sg-diff-up":"sg-diff-down"}${isStar?" pref-star":isPref?" pref":""}">${esc(d.text)}</span>
        ${qualityBadge(q)}
      </div>`;
    }).join("");

    return `<div class="sg-item" style="border-left-color:${color};">
      <div class="sg-item-head">
        ${selectable ? `<label title="Select for salvage" style="display:inline-flex;align-items:center;margin-right:3px;cursor:pointer;"><input type="checkbox" data-sg-salvage-check="${esc(item.id)}" ${checked ? "checked" : ""} style="width:12px;height:12px;accent-color:#ef4444;cursor:pointer;"></label>` : ""}
        ${icon?`<span class="sg-type-icon">${icon}</span>`:""}
        ${item.forge?`<span style="color:#facc15;font-size:11px;">${esc(item.forge)}</span>`:""}
        <span class="sg-item-name" style="color:${color};">${esc(item.name)}${forgeStr?` <span style="color:#64748b;font-weight:400;">${esc(forgeStr)}</span>`:""}</span>
      </div>
      <div class="sg-item-meta">${esc(item.typeText)} · ${esc(item.rarity)}</div>
      <div class="sg-badges">${badges}</div>
      ${item.diffs.length ? `<div style="margin-top:3px;">${diffsHtml}</div>` : ""}
      ${filterTagsHtml(item)}
    </div>`;
  }

  function renderCatItem(item) {
    const color     = rarityColor(item.rarity);
    const forgeStr  = item.forgeLevel ? `+${item.forgeLevel}` : "";
    const activeFC  = state.filters.get(state.activeFilterKey) ?? mkFC([]);
    const sortedDiffs = [...item.diffs].sort((a,b) => {
      const wa = activeFC.preferredStats.has(a.stat) ? 2 : activeFC.stats.has(a.stat) ? 1 : 0;
      const wb = activeFC.preferredStats.has(b.stat) ? 2 : activeFC.stats.has(b.stat) ? 1 : 0;
      return wb - wa;
    });

    const chips = sortedDiffs.slice(0,4).map(d => {
      const isPref  = d.stat && activeFC.stats.has(d.stat);
      const isStar  = d.stat && activeFC.preferredStats.has(d.stat);
      return `<span class="sg-diff ${d.isUp?"sg-diff-up":"sg-diff-down"}${isStar?" pref-star":isPref?" pref":""}">${esc(d.text)}</span>`;
    }).join("");

    return `<div class="sg-cat-item" style="border-left-color:${color};">
      <div class="sg-cat-item-left">
        <div class="sg-cat-item-name" style="color:${color};">
          ${ITEM_ICONS[item.weaponSubType]?`<span class="sg-type-icon">${ITEM_ICONS[item.weaponSubType]}</span> `:""}${item.forge?`<span style="color:#facc15;">${esc(item.forge)}</span> `:""}${esc(item.name)}${forgeStr?` <span style="color:#64748b;font-weight:400;">${esc(forgeStr)}</span>`:""}
        </div>
        <div class="sg-cat-item-sub">${esc(item.rarity)}${item.isLegacyStar?" · ★ Legacy":""}${item.multiRollCount>0?(() => {
          const lbl   = {1:"Double",2:"Triple",3:"Quad"}[item.multiRollCount] ?? "×"+(item.multiRollCount+1);
          const qPct  = Math.round((item.mrMedianQuality??1)*100);
          const qCol  = qPct>=80?"#4ade80":qPct>=60?"#fde68a":"#f87171";
          const iNote = item.mrInteresting ? " 🎲 Interesting" : "";
          return ` · ${lbl} Roll <span style="color:${qCol}">${qPct}%</span>${iNote}`;
        })():""}${item.classRestricted?" · 🔒 Wrong type":""}</div>
        <div class="sg-diffs">${chips}</div>
        ${filterTagsHtml(item)}
      </div>
      <div class="sg-cat-item-right">
        <span class="sg-slot-pill">${esc(item.slotType)}</span>
        <span class="sg-badge sg-badge-shard">💎 ${item.shards}</span>
      </div>
    </div>`;
  }

  /**************************************************************************
   * RENDER — Team Tab
   **************************************************************************/

  const teamOpen = {};   // profileId → bool (section expanded state)

  const TEAM_SEND_STORAGE_KEY = "sgMailSendLearnedEndpoint";
  const TEAM_SEND_TEMPLATE_STORAGE_KEY = "sgMailSendLearnedItemTemplateV2";

  function getRawItemById(itemId) {
    return state.bagItemsRaw.find(raw => String(raw.id) === String(itemId)) || null;
  }

  function compactItemLabel(item) {
    if (!item) return "Unknown item";
    const forge = item.forge ? `${item.forge} ` : "";
    const plus = item.forgeLevel ? ` +${item.forgeLevel}` : "";
    return `${forge}${item.name}${plus}`.trim();
  }

  function buildTeamSendPlan() {
    const candidates = [];
    for (const profile of Object.values(teamProfiles)) {
      const eqMap = profile.equippedMap || {};
      const profFilter = profile.filterKey ?? state.activeFilterKey;
      for (const raw of state.bagItemsRaw) {
        const ev = _buildBagItem(raw, eqMap, profFilter);
        if (ev.cat !== "top") continue;
        if (!ev.id) continue;
        candidates.push({ profile, item: ev, raw, score: Number(ev.prefScore || 0) });
      }
    }

    candidates.sort((a, b) =>
      b.score - a.score ||
      (b.item.mrMedianQuality || 0) - (a.item.mrMedianQuality || 0) ||
      String(a.profile.username || "").localeCompare(String(b.profile.username || ""))
    );

    const usedItems = new Set();
    const plan = [];
    for (const candidate of candidates) {
      const itemKey = String(candidate.item.id);
      if (usedItems.has(itemKey)) continue;
      usedItems.add(itemKey);
      plan.push(candidate);
    }

    plan.sort((a, b) => String(a.profile.username || "").localeCompare(String(b.profile.username || "")) || b.score - a.score);
    return plan;
  }

  function buildMailMessage(profile, item) {
    const diffs = (item.diffs || [])
      .filter(d => d.isUp)
      .slice(0, 5)
      .map(d => d.text)
      .join(", ");
    const why = diffs ? `Upgrade stats: ${diffs}` : "Stat Grabber marked this as a Top Pick.";
    return `Sent by Stat Grabber. ${why}`;
  }

  function getStoredMailTemplate() {
    try { return JSON.parse(localStorage.getItem(TEAM_SEND_TEMPLATE_STORAGE_KEY) || "null"); } catch { return null; }
  }

  function _objHasItemishKey(obj) {
    let found = false;
    const walk = (v, key = "") => {
      if (found || v == null) return;
      if (/item|inventory|attachment/i.test(String(key))) found = true;
      if (Array.isArray(v)) return v.slice(0, 3).forEach(x => walk(x, key));
      if (typeof v === "object") Object.entries(v).forEach(([k, val]) => walk(val, k));
    };
    walk(obj);
    return found;
  }

  function rememberMailEndpoint(url, bodyOrKeys = null, method = "POST") {
    try {
      const keys = Array.isArray(bodyOrKeys)
        ? bodyOrKeys
        : (bodyOrKeys && typeof bodyOrKeys === "object" ? Object.keys(bodyOrKeys) : []);
      localStorage.setItem(TEAM_SEND_STORAGE_KEY, JSON.stringify({ url, method, bodyKeys: keys, savedAt: Date.now() }));
      if (bodyOrKeys && typeof bodyOrKeys === "object" && _objHasItemishKey(bodyOrKeys)) {
        localStorage.setItem(TEAM_SEND_TEMPLATE_STORAGE_KEY, JSON.stringify({ url, method, body: bodyOrKeys, savedAt: Date.now() }));
      }
    } catch {}
  }

  function addMailEndpointToAttempts(attempts, url, payload, method = "POST", learned = false) {
    if (!url || attempts.some(a => a.url === url && JSON.stringify(a.body) === JSON.stringify(payload))) return;
    attempts.push({ url, method, body: payload, learned });
  }

  function _cloneJson(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch { return x; }
  }

  function _rewriteLearnedMailPayload(templateBody, profile, item, subject, message) {
    const recipientId = profile.playerId;
    const recipientName = profile.username;
    const itemId = item.id;

    const rewrite = (value, key = "") => {
      const k = String(key || "");
      if (/^(recipientid|toplayerid|targetplayerid|receiverid|receiverplayerid|playerid|toid|userid)$/i.test(k)) return recipientId;
      if (/^(recipientname|tousername|targetusername|receivername|toname|to)$/i.test(k)) return recipientName;
      if (/^(itemid|iteminstanceid|inventoryitemid|attachmentitemid|attacheditemid)$/i.test(k)) return itemId;
      if (/^(itemids|iteminstanceids|inventoryitemids)$/i.test(k)) return [itemId];
      if (/^(quantity|qty|amount|count)$/i.test(k)) return 1;
      if (/^(subject|title)$/i.test(k)) return subject;
      if (/^(message|body|text|content)$/i.test(k)) return message;
      if (Array.isArray(value)) {
        if (/^(items|attachments|attacheditems|mailitems)$/i.test(k)) {
          const first = value[0];
          if (first && typeof first === "object") return [rewrite(first, k)];
          return [itemId];
        }
        return value.map(v => rewrite(v, k));
      }
      if (value && typeof value === "object") {
        const out = {};
        for (const [childKey, childVal] of Object.entries(value)) out[childKey] = rewrite(childVal, childKey);
        if (/^(items|attachments|attacheditems|mailitems)$/i.test(k) && !Object.keys(out).some(x => /item/i.test(x))) {
          out.itemId = itemId;
          out.quantity = 1;
        }
        return out;
      }
      return value;
    };
    return rewrite(_cloneJson(templateBody));
  }

  function buildMailAttempts(profile, item) {
    const subject = `Gear upgrade: ${compactItemLabel(item)}`.slice(0, 80);
    const message = buildMailMessage(profile, item);
    const recipientId = profile.playerId;
    const recipientName = profile.username;
    const itemId = item.id;
    const attempts = [];

    const learnedTemplate = getStoredMailTemplate();
    if (learnedTemplate?.url && learnedTemplate?.body) {
      addMailEndpointToAttempts(attempts, learnedTemplate.url, _rewriteLearnedMailPayload(learnedTemplate.body, profile, item, subject, message), learnedTemplate.method || "POST", true);
    }

    [
      ["/api/mail/send-item", { recipientId, itemId, quantity: 1, subject, message }],
      ["/api/mail/send-item", { recipientName, itemId, quantity: 1, subject, message }],
      ["/api/mail/sendItem", { recipientId, itemId, quantity: 1, subject, message }],
      ["/api/mail/item", { toPlayerId: recipientId, itemId, quantity: 1, subject, message }],
      ["/api/mail/items/send", { toPlayerId: recipientId, itemId, quantity: 1, subject, message }],
      ["/api/mail/send", { recipientId, subject, message, itemId, quantity: 1 }],
      ["/api/mail/send", { recipientId, subject, message, itemInstanceId: itemId, quantity: 1 }],
      ["/api/mail/send", { toPlayerId: recipientId, subject, body: message, itemId, quantity: 1 }],
      ["/api/mail/send", { toUsername: recipientName, subject, body: message, itemId, quantity: 1 }],
      ["/api/mail/send", { recipientId, subject, message, attachments: [{ itemId, quantity: 1 }] }],
      ["/api/mail/send", { toUsername: recipientName, subject, body: message, items: [{ itemId, quantity: 1 }] }],
    ].forEach(([url, body]) => addMailEndpointToAttempts(attempts, url, body));

    return attempts;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function waitForSelector(selector, timeoutMs = 5000, root = document) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = root.querySelector(selector);
      if (el) return el;
      await sleep(75);
    }
    throw new Error(`Timed out waiting for ${selector}`);
  }

  function clickDom(el) {
    if (!el) throw new Error("Missing clickable element");
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  function setReactValue(el, value) {
    if (!el) throw new Error("Missing input element");
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, String(value ?? ""));
    else el.value = String(value ?? "");

    // React-controlled inputs need a real InputEvent in the live VoidIdle UI.
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: String(value ?? "") }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findButtonByText(selector, text) {
    const want = String(text || "").trim().toLowerCase();
    return [...document.querySelectorAll(selector)].find(btn => String(btn.textContent || "").trim().toLowerCase() === want) || null;
  }

  async function waitUntil(predicate, timeout = 5000, interval = 80, label = "condition") {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      let ok = false;
      try { ok = !!predicate(); } catch {}
      if (ok) return true;
      await sleep(interval);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  function isDisabledLike(el) {
    if (!el) return true;
    return !!(el.disabled || el.getAttribute("aria-disabled") === "true" || /disabled/i.test(String(el.className || "")));
  }

  function getVisibleMailRecipientText(compose) {
    const picker = compose?.querySelector?.(".mail-recipient-picker");
    if (!picker) return "";
    const input = picker.querySelector("input");
    const clone = picker.cloneNode(true);
    clone.querySelectorAll("input,textarea,button").forEach(n => n.remove());
    return String(input?.value || clone.textContent || "").trim();
  }

  function recipientAlreadySet(compose, recipientName) {
    const want = normRecipientName(recipientName);
    if (!want) return false;

    // Important: when the dropdown is visible, the text in the input is only a search
    // string. It is NOT the selected recipient yet. Do not treat "HarrisonMode" typed
    // in the input as selected until the matching .mail-dropdown-item was clicked.
    const visibleDropdown = getMailDropdownOptions(compose).length > 0;
    if (visibleDropdown) return false;

    const got = normRecipientName(getVisibleMailRecipientText(compose));
    return !!got && (got === want || got.startsWith(`${want} lv`) || got.startsWith(`${want} `));
  }

  function normRecipientName(v) {
    return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect?.();
    const st = getComputedStyle(el);
    return !!r && r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
  }

  function getMailDropdownOptions(compose) {
    const roots = [
      ...(compose ? [...compose.querySelectorAll(".mail-dropdown")] : []),
      ...document.querySelectorAll(".mail-dropdown"),
      ...document.querySelectorAll('[role="listbox"], [role="menu"]'),
    ].filter(Boolean);

    const candidates = [];
    for (const root of roots) {
      // Prefer the actual option rows. In the live UI these are:
      // <div class="mail-dropdown-item">HarrisonMode <span>Lv50</span></div>
      const directItems = [...root.querySelectorAll(".mail-dropdown-item, button, [role='option'], [role='menuitem'], li")];
      if (root.matches?.(".mail-dropdown-item, button, [role='option'], [role='menuitem'], li")) directItems.unshift(root);
      if (directItems.length) candidates.push(...directItems);
      else candidates.push(...root.querySelectorAll("div, span"));
    }

    return [...new Set(candidates)]
      .filter(el => isElementVisible(el))
      .map(el => {
        const rawText = String(el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || "").trim();
        const text = normRecipientName(rawText);
        const usernameText = normRecipientName(rawText.replace(/\s+Lv\s*\d+\s*$/i, ""));
        return { el, text, usernameText, rawText };
      })
      .filter(x => x.text);
  }

  function findRecipientDropdownOption(recipientName, compose) {
    const want = normRecipientName(recipientName);
    const usable = getMailDropdownOptions(compose);

    // Dropdown rows are usually like: "HarrisonMode Lv50". Match the username
    // portion exactly first. This prevents selecting partial/prefix text.
    return (usable.find(x => x.usernameText === want)
      || usable.find(x => x.text === want)
      || usable.find(x => x.text === `${want} lv`)
      || usable.find(x => x.text.startsWith(`${want} lv`))
      || usable.find(x => x.text.startsWith(`${want} `)))?.el || null;
  }

  function debugMailDom(compose = document.querySelector(".mail-compose")) {
    const picker = document.querySelector(".mail-picker");
    const input = compose?.querySelector?.('.mail-recipient-picker input, input[placeholder*="Recipient"], input') || null;
    const dropdown = document.querySelector(".mail-dropdown") || compose?.querySelector?.(".mail-dropdown") || null;
    const info = {
      inputValue: input?.value || "",
      recipientPickerHtml: compose?.querySelector?.(".mail-recipient-picker")?.outerHTML || "",
      dropdownHtml: dropdown?.outerHTML || "",
      dropdownOptions: getMailDropdownOptions(compose).map(o => o.rawText),
      firstPickerSlotHtml: picker?.querySelector?.(".item-slot")?.outerHTML || "",
      selectedCardHtml: document.querySelector(".mail-item-card")?.outerHTML || "",
    };
    console.log("[Stat Grabber Mail Debug]", info);
    return info;
  }

  window.SG_MAIL_DEBUG = window.SG_MAIL_DEBUG || {
    dump: () => debugMailDom(),
    copy: async () => {
      const text = JSON.stringify(debugMailDom(), null, 2);
      try { await navigator.clipboard.writeText(text); } catch {}
      return text;
    },
  };

  async function pickMailRecipientFromDropdown(compose, recipientName) {
    const input = compose.querySelector('.mail-recipient-picker input, input[placeholder*="Recipient"], input');
    if (!input) throw new Error("Could not find Recipient input.");

    const want = String(recipientName || "").trim();
    if (!want) throw new Error("Missing recipient name.");

    // If the same recipient is already truly selected and the dropdown is closed,
    // reuse it. If a dropdown is open, click the exact matching option anyway.
    if (recipientAlreadySet(compose, want)) return;

    setReactValue(input, "");
    input.focus();
    await sleep(80);

    // Type the FULL username. Do not use a prefix like "Harrison"; the game only
    // commits the recipient after clicking the exact dropdown item.
    setReactValue(input, want);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: want.slice(-1) || " ", code: "KeyA" }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: want.slice(-1) || " ", code: "KeyA" }));
    await sleep(120);

    let option = null;
    const started = Date.now();
    while (Date.now() - started < 6000) {
      option = findRecipientDropdownOption(want, compose);
      if (option) break;
      await sleep(100);
    }

    if (!option) {
      const options = getMailDropdownOptions(compose).map(o => o.rawText).join(" | ");
      debugMailDom(compose);
      throw new Error(`Could not select recipient from dropdown: ${want}${options ? `. Options: ${options}` : ""}`);
    }

    clickDom(option);

    // The React input may still show the username, but the reliable sign that the
    // selection committed is the dropdown closing. Wait for that before attaching.
    await waitUntil(() => {
      const hasDropdown = getMailDropdownOptions(compose).length > 0;
      const inputText = normRecipientName(input.value || getVisibleMailRecipientText(compose));
      return !hasDropdown && (inputText === normRecipientName(want) || inputText.startsWith(`${normRecipientName(want)} lv`));
    }, 5000, 80, `recipient ${want} dropdown selection`);
    await sleep(150);
  }

  async function setMailRecipientOnce(compose, recipientName) {
    return pickMailRecipientFromDropdown(compose, recipientName);
  }

  function getHighlightedSalvageItems() {
    if (!state.highlightCats.size) return [];
    return state.bagItems.filter(item => item && item.id && state.highlightCats.has(item.cat));
  }

  function getSalvageTargetItems() {
    const byId = new Map();
    for (const item of getHighlightedSalvageItems()) byId.set(String(item.id), item);
    for (const item of getSelectedSalvageItems()) byId.set(String(item.id), item);
    return [...byId.values()];
  }

  function getMailSlotOrderItems() {
    const weaponTypes = new Set(["sword", "bow", "spear", "fan", "harp", "staff", "wand", "dagger", "axe", "mace"]);
    const accessoryTypes = new Set(["ring", "amulet"]);
    const raw = (state.bagItemsRaw || []).filter(item => item && item.id && !item.equippedSlot && !item.is_locked && item.type !== "rune");
    return [
      ...raw.filter(item => weaponTypes.has(String(item.type || "").toLowerCase())),
      ...raw.filter(item => !weaponTypes.has(String(item.type || "").toLowerCase()) && !accessoryTypes.has(String(item.type || "").toLowerCase())),
      ...raw.filter(item => accessoryTypes.has(String(item.type || "").toLowerCase())),
    ];
  }

  function findMailPickerSlotForItem(item) {
    const picker = document.querySelector(".mail-picker");
    if (!picker) throw new Error("Mail item picker did not open.");

    const name = String(item?.name || "").trim();
    const titleMatches = [...picker.querySelectorAll('.item-slot[title]')].filter(slot => String(slot.getAttribute("title") || "").trim() === name);
    if (!titleMatches.length) throw new Error(`Could not find item in mail picker: ${name}`);

    const ordered = getMailSlotOrderItems();
    let targetOccurrence = 0;
    for (const raw of ordered) {
      if (String(raw.name || "").trim() === name) {
        if (String(raw.id) === String(item.id)) break;
        targetOccurrence++;
      }
    }
    return titleMatches[Math.min(targetOccurrence, titleMatches.length - 1)] || titleMatches[0];
  }

  async function ensureMailComposeOpen() {
    let modal = document.querySelector(".mail-modal");
    if (!modal) {
      const mailBtn = document.querySelector('button.sb-item[title="Mail"]')
        || [...document.querySelectorAll("button")].find(btn => /(^|\s)Mail(\s|$)/i.test(String(btn.textContent || "")) && /✉|Mail/i.test(String(btn.textContent || "")));
      if (!mailBtn) throw new Error("Could not find the Mail sidebar button.");
      clickDom(mailBtn);
      modal = await waitForSelector(".mail-modal", 6000);
    }

    const newMailTab = [...modal.querySelectorAll(".mail-tab")].find(tab => String(tab.textContent || "").trim().toLowerCase() === "new mail");
    if (!newMailTab) throw new Error("Could not find the New Mail tab.");
    if (!newMailTab.classList.contains("active")) {
      clickDom(newMailTab);
      await waitForSelector(".mail-compose", 5000, modal);
    }
    return document.querySelector(".mail-modal .mail-compose");
  }

  function buildMailMessageForItems(profile, items) {
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
    if (list.length <= 1) return buildMailMessage(profile, list[0]);

    const names = list.slice(0, 12).map(item => compactItemLabel(item)).join(", ");
    const more = list.length > 12 ? `, +${list.length - 12} more` : "";
    return `Sent by Stat Grabber. Top Pick upgrades for ${profile?.username || "teammate"}: ${names}${more}`.slice(0, 500);
  }

  async function attachOneItemToCurrentMail(item) {
    const compose = await ensureMailComposeOpen();
    const attachBtn = compose.querySelector(".mail-btn-attach") || findButtonByText("button", "Attach Items");
    if (!attachBtn) throw new Error("Could not find Attach Items button.");

    clickDom(attachBtn);
    await waitForSelector(".mail-picker", 6000);
    await sleep(150);

    const slot = findMailPickerSlotForItem(item);
    clickDom(slot);

    // Clicking a slot opens the item detail card; the item is NOT attached until
    // the card's Attach button is clicked. This matches the live mail UI.
    const confirmAttachBtn = await waitForSelector(
      ".mail-picker .mail-card-confirm, .mail-item-card .mail-card-confirm",
      6000
    );
    await waitUntil(() => !isDisabledLike(confirmAttachBtn), 4000, 80, "mail item Attach button to become enabled");
    clickDom(confirmAttachBtn);

    await sleep(250);
    await waitUntil(() => {
      const cardBtn = document.querySelector(".mail-picker .mail-card-confirm, .mail-item-card .mail-card-confirm");
      return !cardBtn || !document.body.contains(cardBtn);
    }, 4000, 80, "mail item card to close after Attach").catch(() => {});

    const picker = document.querySelector(".mail-picker");
    if (picker) {
      const close = picker.querySelector(".mail-close") || picker.querySelector("button");
      if (close) clickDom(close);
      await sleep(150);
    }
  }

  async function clickSendCurrentMail() {
    const sendBtn = document.querySelector(".mail-modal .mail-btn-send") || findButtonByText("button", "Send Mail");
    if (!sendBtn) throw new Error("Could not find Send Mail button.");
    await waitUntil(() => !isDisabledLike(sendBtn), 5000, 80, "Send Mail button to become enabled");
    clickDom(sendBtn);
    await sleep(900);
  }

  async function sendTeamMailViaDom(profile, items) {
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
    if (!list.length) throw new Error("No items to attach.");

    const recipientName = String(profile?.username || "").trim();
    if (!recipientName) throw new Error("Missing teammate username.");

    const compose = await ensureMailComposeOpen();
    await setMailRecipientOnce(compose, recipientName);

    const msgBox = compose.querySelector("textarea.mail-compose-msg, textarea");
    if (msgBox) setReactValue(msgBox, buildMailMessageForItems(profile, list));

    // Attach every requested item first. Only after the final attachment succeeds
    // do we click Send Mail. This prevents half-empty mails when multiple Top Picks
    // are being sent to the same teammate.
    for (const item of list) {
      await attachOneItemToCurrentMail(item);
    }

    await clickSendCurrentMail();
    return { ok: true, via: "dom-mail-compose", count: list.length };
  }

  async function sendOneTeamMailViaDom(profile, item) {
    return sendTeamMailViaDom(profile, [item]);
  }

  async function postJson(url, body, method = "POST") {
    const authHeaders = getApiAuthHeaders();
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body)
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok || json?.ok === false || json?.success === false) {
      const msg = json?.error || json?.message || text || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return json ?? { ok: true, raw: text };
  }

  const SALVAGE_STORAGE_KEY = "sgSalvageLearnedEndpoint";
  const SALVAGE_TEMPLATE_STORAGE_KEY = "sgSalvageLearnedTemplateV1";

  function getSelectedSalvageItems() {
    const liveIds = new Set(state.bagItems.map(i => String(i.id)));
    for (const id of [...state.salvageSelectedIds]) {
      if (!liveIds.has(String(id))) state.salvageSelectedIds.delete(id);
    }
    return state.bagItems.filter(item => state.salvageSelectedIds.has(String(item.id)));
  }

  function getStoredSalvageTemplate() {
    try { return JSON.parse(localStorage.getItem(SALVAGE_TEMPLATE_STORAGE_KEY) || "null"); } catch { return null; }
  }

  function rememberSalvageEndpoint(url, bodyOrKeys = null, method = "POST") {
    try {
      const keys = Array.isArray(bodyOrKeys)
        ? bodyOrKeys
        : (bodyOrKeys && typeof bodyOrKeys === "object" ? Object.keys(bodyOrKeys) : []);
      localStorage.setItem(SALVAGE_STORAGE_KEY, JSON.stringify({ url, method, bodyKeys: keys, savedAt: Date.now() }));
      if (bodyOrKeys && typeof bodyOrKeys === "object") {
        localStorage.setItem(SALVAGE_TEMPLATE_STORAGE_KEY, JSON.stringify({ url, method, body: bodyOrKeys, savedAt: Date.now() }));
      }
    } catch {}
  }

  function addSalvageAttempt(attempts, url, payload, method = "POST", learned = false) {
    if (!url || attempts.some(a => a.url === url && JSON.stringify(a.body) === JSON.stringify(payload))) return;
    attempts.push({ url, method, body: payload, learned });
  }

  function _rewriteLearnedSalvagePayload(templateBody, item) {
    const itemId = item.id;
    const rewrite = (value, key = "") => {
      const k = String(key || "");
      if (/^(itemid|iteminstanceid|inventoryitemid|id)$/i.test(k)) return itemId;
      if (/^(itemids|iteminstanceids|inventoryitemids|ids)$/i.test(k)) return [itemId];
      if (/^(quantity|qty|amount|count)$/i.test(k)) return 1;
      if (Array.isArray(value)) {
        if (/^(items|itemids|inventoryitems|salvageitems)$/i.test(k)) {
          const first = value[0];
          if (first && typeof first === "object") return [rewrite(first, k)];
          return [itemId];
        }
        return value.map(v => rewrite(v, k));
      }
      if (value && typeof value === "object") {
        const out = {};
        for (const [childKey, childVal] of Object.entries(value)) out[childKey] = rewrite(childVal, childKey);
        if (/^(items|inventoryitems|salvageitems)$/i.test(k) && !Object.keys(out).some(x => /item|id/i.test(x))) {
          out.itemId = itemId;
          out.quantity = 1;
        }
        return out;
      }
      return value;
    };
    return rewrite(_cloneJson(templateBody));
  }

  function buildSalvageAttempts(item) {
    const itemId = item.id;
    const attempts = [];
    const learnedTemplate = getStoredSalvageTemplate();
    if (learnedTemplate?.url && learnedTemplate?.body) {
      addSalvageAttempt(attempts, learnedTemplate.url, _rewriteLearnedSalvagePayload(learnedTemplate.body, item), learnedTemplate.method || "POST", true);
    }
    [
      ["/api/inventory/salvage-selected", { itemIds: [itemId] }],
      ["/api/inventory/salvage", { itemId, quantity: 1 }],
      ["/api/inventory/salvage", { itemIds: [itemId] }],
      ["/api/inventory/salvage-item", { itemId, quantity: 1 }],
      ["/api/inventory/salvageItem", { itemId, quantity: 1 }],
      ["/api/item/salvage", { itemId, quantity: 1 }],
      ["/api/items/salvage", { itemIds: [itemId] }],
      ["/api/equipment/salvage", { inventoryItemId: itemId, quantity: 1 }],
      ["/api/inventory/sell", { itemId, quantity: 1 }],
    ].forEach(([url, body]) => addSalvageAttempt(attempts, url, body));
    return attempts;
  }

  async function salvageItemsBatch(items) {
    const itemIds = items.map(item => String(item.id)).filter(Boolean);
    if (!itemIds.length) return { ok: true };

    // message.txt uses this exact live endpoint/payload. Use it first so the
    // server handles the selected list in one request instead of trying guessed
    // per-item endpoints.
    const result = await postJson("/api/inventory/salvage-selected", { itemIds });
    rememberSalvageEndpoint("/api/inventory/salvage-selected", { itemIds }, "POST");
    return result;
  }

  async function salvageOneItem(item) {
    const attempts = buildSalvageAttempts(item);
    let lastError = null;
    for (const attempt of attempts) {
      try {
        const result = await postJson(attempt.url, attempt.body, attempt.method || "POST");
        if (attempt.learned) rememberSalvageEndpoint(attempt.url, attempt.body, attempt.method || "POST");
        return result;
      } catch (err) { lastError = err; continue; }
    }
    throw lastError || new Error("No salvage endpoint accepted the request. Manually salvage one cheap item once while the script is active so it can learn the real endpoint.");
  }

  async function salvageSelectedItems(app) {
    if (state.salvageBusy) return;
    const items = getSalvageTargetItems();
    if (!items.length) {
      state.salvageStatus = "No highlighted/checked items to salvage.";
      rerender(app);
      return;
    }
    const preview = items.slice(0, 20).map(item => `${item.rec?.label || ""} ${compactItemLabel(item)} · ${item.rarity} · ${item.slotType}`).join("\n");
    const more = items.length > 20 ? `\n…plus ${items.length - 20} more` : "";
    const ok = window.confirm(`Salvage ${items.length} highlighted/checked item(s)?\n\n${preview}${more}`);
    if (!ok) return;

    state.salvageBusy = true;
    state.salvageStatus = `Salvaging ${items.length} item(s)…`;
    rerender(app);

    const salvaged = [];
    const failed = [];

    try {
      const result = await salvageItemsBatch(items);
      salvaged.push(...items);
      for (const item of items) state.salvageSelectedIds.delete(String(item.id));

      const goldGained = Number(result?.goldGained || result?.gold || 0);
      const matsGained = result?.materialsGained || result?.materials || null;
      let extra = goldGained ? ` · +${fmt(goldGained)}g` : "";
      if (matsGained && typeof matsGained === "object") {
        const mats = Object.entries(matsGained).map(([k, v]) => `${v} ${k}`).join(", ");
        if (mats) extra += ` · ${mats}`;
      }
      state.salvageStatus = `Salvaged ${salvaged.length} item(s)${extra}.`;
    } catch (batchErr) {
      console.warn("[Stat Grabber] Batch salvage failed, falling back to per-item salvage", batchErr);
      for (const item of items) {
        try {
          await salvageOneItem(item);
          salvaged.push(item);
          state.salvageSelectedIds.delete(String(item.id));
        } catch (err) {
          failed.push({ item, error: err?.message || String(err) });
        }
      }
      state.salvageStatus = failed.length
        ? `Salvaged ${salvaged.length}/${items.length}. Failed: ${failed.slice(0, 3).map(f => `${compactItemLabel(f.item)} (${f.error})`).join("; ")}${failed.length > 3 ? "…" : ""}`
        : `Salvaged ${salvaged.length} item(s).`;
      if (failed.length) console.warn("[Stat Grabber] Salvage failures", failed);
    }

    if (salvaged.length) {
      const done = new Set(salvaged.map(item => String(item.id)));
      state.bagItems = state.bagItems.filter(item => !done.has(String(item.id)));
      if (Array.isArray(state.bagItemsRaw)) state.bagItemsRaw = state.bagItemsRaw.filter(item => !done.has(String(item.id)));
      applyBagHighlights();
    }

    state.salvageBusy = false;
    rerender(app);
  }

  async function sendOneTeamMail(profile, item) {
    // The live game compose UI attaches exactly one item per mail and does not expose
    // item ids in the DOM. Use the real UI first; keep API attempts only as fallback.
    let domError = null;
    try {
      return await sendOneTeamMailViaDom(profile, item);
    } catch (err) {
      domError = err;
      console.warn("[Stat Grabber] DOM mail send failed, trying learned/API endpoints", err);
    }

    const attempts = buildMailAttempts(profile, item);
    let lastError = null;
    for (const attempt of attempts) {
      try {
        const result = await postJson(attempt.url, attempt.body, attempt.method || "POST");
        if (attempt.learned) rememberMailEndpoint(attempt.url, attempt.body, attempt.method || "POST");
        return result;
      } catch (err) { lastError = err; continue; }
    }
    throw lastError || domError || new Error("No item-mail endpoint accepted the request.");
  }

  async function sendSingleTeamTopPick(app, profileId, itemId) {
    if (state.teamSendBusy) return;

    const profile = teamProfiles[profileId];
    if (!profile) {
      state.teamSendStatus = "Could not find that teammate profile.";
      rerender(app);
      return;
    }

    const eqMap = profile.equippedMap || {};
    const profFilter = profile.filterKey ?? state.activeFilterKey;
    const raw = state.bagItemsRaw.find(i => String(i.id) === String(itemId));
    if (!raw) {
      state.teamSendStatus = "Could not find that item in your current bag snapshot.";
      rerender(app);
      return;
    }

    const item = _buildBagItem(raw, eqMap, profFilter);
    const ok = window.confirm(`Send this item through mail?\n\n${profile.username}: ${compactItemLabel(item)}`);
    if (!ok) return;

    state.teamSendBusy = true;
    state.teamSendStatus = `Sending ${compactItemLabel(item)} to ${profile.username}…`;
    rerender(app);

    try {
      await sendOneTeamMail(profile, item);
      state.teamSendStatus = `Sent ${compactItemLabel(item)} to ${profile.username}.`;
    } catch (err) {
      state.teamSendStatus = `Failed sending to ${profile.username}: ${err?.message || String(err)}`;
      console.warn("[Stat Grabber] Single team mail send failed", { profile, item, err });
    } finally {
      state.teamSendBusy = false;
      rerender(app);
    }
  }

  async function sendTeamTopPicks(app) {
    if (state.teamSendBusy) return;

    const plan = buildTeamSendPlan();
    if (!plan.length) {
      state.teamSendStatus = "No Top Pick items to send.";
      rerender(app);
      return;
    }

    const preview = plan.slice(0, 20).map(({ profile, item }) => `${profile.username}: ${compactItemLabel(item)}`).join("\n");
    const more = plan.length > 20 ? `\n…plus ${plan.length - 20} more` : "";
    const ok = window.confirm(`Send ${plan.length} Top Pick item(s) through mail?\n\n${preview}${more}`);
    if (!ok) return;

    state.teamSendBusy = true;
    state.teamSendStatus = `Sending ${plan.length} item(s)…`;
    rerender(app);

    const sent = [];
    const failed = [];
    const groups = new Map();
    for (const entry of plan) {
      const key = String(entry.profile?.playerId || entry.profile?.username || "unknown");
      if (!groups.has(key)) groups.set(key, { profile: entry.profile, entries: [] });
      groups.get(key).entries.push(entry);
    }

    for (const group of groups.values()) {
      try {
        state.teamSendStatus = `Attaching ${group.entries.length} item(s) for ${group.profile.username}…`;
        rerender(app);
        await sendTeamMailViaDom(group.profile, group.entries.map(entry => entry.item));
        sent.push(...group.entries);
      } catch (err) {
        // If a grouped DOM mail fails, fall back to the older one-item flow so a
        // single bad item does not block the entire team send run.
        console.warn("[Stat Grabber] Grouped team mail send failed; falling back to one item per mail", { group, err });
        for (const entry of group.entries) {
          try {
            await sendOneTeamMail(entry.profile, entry.item);
            sent.push(entry);
          } catch (oneErr) {
            failed.push({ ...entry, error: oneErr?.message || err?.message || String(oneErr || err) });
          }
        }
      }
    }

    state.teamSendBusy = false;
    state.teamSendStatus = failed.length
      ? `Sent ${sent.length}/${plan.length}. Failed: ${failed.slice(0, 3).map(f => `${f.profile.username} (${f.error})`).join("; ")}${failed.length > 3 ? "…" : ""}`
      : `Sent ${sent.length} item(s).`;

    if (failed.length) console.warn("[Stat Grabber] Team mail send failures", failed);
    rerender(app);
  }

  function renderTeam() {
    const profiles = Object.values(teamProfiles).sort((a, b) => b.savedAt - a.savedAt);

    if (!profiles.length) {
      return `<div class="sg-hint">No profiles saved yet.<br>Click <b>Inspect</b> on a player<br>then hit <b>💾 Save Profile</b>.</div>`;
    }
    if (!state.bagItemsRaw.length) {
      return `<div class="sg-hint">Open <strong>Inventory</strong><br>to load your bag items first.</div>`;
    }

    const filterKeys = [...state.filters.keys()];
    const sendPlan = buildTeamSendPlan();

    let html = `<div class="sg-gear-toolbar" style="gap:8px;align-items:flex-start;">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
        <span style="color:#e8eefc;font-size:11px;font-weight:700;">Team Top Picks</span>
        <span style="color:#4b5563;font-size:10px;">${sendPlan.length} item(s) ready to mail · one best teammate per item</span>
        ${state.teamSendStatus ? `<span style="color:${state.teamSendStatus.startsWith("Sent") ? "#4ade80" : state.teamSendStatus.startsWith("Sending") ? "#93c5fd" : "#fca5a5"};font-size:10px;line-height:1.25;">${esc(state.teamSendStatus)}</span>` : ""}
      </div>
      <button class="sg-btn" data-sg-team-send-top ${(!sendPlan.length || state.teamSendBusy) ? "disabled" : ""} style="white-space:nowrap;${(!sendPlan.length || state.teamSendBusy) ? "opacity:.45;cursor:not-allowed;" : "border-color:rgba(74,222,128,.35);color:#86efac;"}" title="Open Mail > New Mail, attach all Top Picks for each teammate, then send one mail per teammate">
        📬 ${state.teamSendBusy ? "Sending…" : "Send Top Picks"}
      </button>
    </div>`;
    for (const profile of profiles) {
      const eqMap      = profile.equippedMap;
      const eqWeapon   = Object.values(eqMap).find(i => ITEM_TYPE_TO_SLOT[i.type] === "Weapon");
      const icon       = eqWeapon ? (ITEM_ICONS[eqWeapon.type] ?? "⚔️") : "❓";
      const wtype      = eqWeapon ? eqWeapon.type : "unknown";
      const profFilter = profile.filterKey ?? state.activeFilterKey;

      // Evaluate every bag item against this teammate's gear using their assigned filter
      const topItems = [];
      for (const raw of state.bagItemsRaw) {
        const ev = _buildBagItem(raw, eqMap, profFilter);
        if (ev.cat === "top") topItems.push(ev);
      }
      topItems.sort((a, b) => b.prefScore - a.prefScore);

      const isOpen = teamOpen[profile.playerId] !== false;  // default open
      const d = new Date(profile.savedAt);
      const ts = `${d.getDate().toString().padStart(2,"0")}.${(d.getMonth()+1).toString().padStart(2,"0")} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;

      const filterChips = filterKeys.map(k => {
        const active = k === profFilter;
        return `<button class="sg-btn sg-team-fchip${active?" sg-team-fchip-on":""}" data-team-fset="${esc(profile.playerId)}" data-fkey="${esc(k)}" style="padding:1px 6px;font-size:9px;${active?"border-color:rgba(59,130,246,.5);background:rgba(59,130,246,.18);color:#93c5fd;":""}">${esc(k)}</button>`;
      }).join("");

      html += `<div class="sg-cat-section" data-team-pid="${esc(profile.playerId)}">
        <div class="sg-team-header">
          <span class="sg-cat-title" style="gap:6px;">
            <span style="font-size:13px;">${icon}</span>
            <b style="font-size:12px;color:#e8eefc;">${esc(profile.username)}</b>
            <span style="color:#4b5563;font-size:10px;">${esc(profile.levelText)} · ${esc(wtype)}</span>
            ${topItems.length
              ? `<span class="sg-badge rec-top" style="margin-left:4px;">${topItems.length} Top</span>`
              : `<span style="color:#374151;font-size:10px;">(no top picks)</span>`}
          </span>
          <span style="display:flex;gap:4px;align-items:center;">
            <span style="color:#1e293b;font-size:9px;">${ts}</span>
            <button class="sg-icon-btn sg-team-del" data-team-del="${esc(profile.playerId)}" title="Remove">✗</button>
            <span class="sg-cat-toggle">${isOpen ? "▾" : "▸"}</span>
          </span>
        </div>
        <div style="padding:2px 8px 4px;display:flex;gap:3px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,.04);">
          <span style="color:#4b5563;font-size:9px;line-height:20px;margin-right:2px;">Filter:</span>
          ${filterChips}
        </div>
        <div class="sg-cat-body${isOpen ? "" : " collapsed"}">
          ${topItems.length
            ? topItems.map(item => renderItemCard(item, { selectable:false, teamSendProfileId: profile.playerId })).join("")
            : `<div style="color:#374151;font-size:10px;padding:8px 12px;">Nothing in your bag is a Top Pick for ${esc(profile.username)} right now.</div>`}
        </div>
      </div>`;
    }
    return html;
  }

  /**************************************************************************
   * INSPECT MODAL — Save Button
   **************************************************************************/

  function injectInspectSaveBtn(modal) {
    // Walk React fiber to find the playerId prop
    const fkey = Object.keys(modal).find(k => k.startsWith("__reactFiber"));
    let playerId = null;
    if (fkey) {
      let fiber = modal[fkey]; let depth = 0;
      while (fiber && depth < 12) {
        if (fiber.memoizedProps?.playerId) { playerId = fiber.memoizedProps.playerId; break; }
        fiber = fiber.return; depth++;
      }
    }
    if (!playerId) return;

    function tryInject() {
      if (modal.querySelector(".sg-inspect-save")) return;  // already injected
      const usernameEl = modal.querySelector(".inspect-username");
      if (!usernameEl) return;  // async content not yet loaded

      const username  = usernameEl.textContent.trim() || "Unknown";
      const levelText = modal.querySelector(".inspect-level")?.textContent?.trim() ?? "";

      const alreadySaved = !!teamProfiles[playerId];

      const wrap = document.createElement("div");
      wrap.className = "sg-inspect-save";
      wrap.style.cssText = "display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;";

      const saveBtn = document.createElement("button");
      saveBtn.className = "sg-btn";
      saveBtn.textContent = alreadySaved ? "🔄 Update Profile" : "💾 Save Profile";

      const removeBtn = document.createElement("button");
      removeBtn.className = "sg-btn";
      removeBtn.style.cssText = "color:#f87171;border-color:rgba(248,113,113,.3);display:" + (alreadySaved ? "inline-block" : "none") + ";";
      removeBtn.textContent = "✗ Remove";

      saveBtn.addEventListener("click", () => {
        const data = pendingInspect[playerId];
        if (!data) { saveBtn.textContent = "⚠ No data yet…"; setTimeout(() => { saveBtn.textContent = "🔄 Update Profile"; }, 2000); return; }
        teamProfiles[playerId] = {
          playerId, username, levelText,
          equippedMap: buildEquippedMap(data.equipped),
          filterKey: teamProfiles[playerId]?.filterKey ?? state.activeFilterKey,
          savedAt: Date.now(),
        };
        saveTeamProfiles();
        saveBtn.textContent = "✓ Saved!";
        saveBtn.style.color = "#4ade80";
        removeBtn.style.display = "inline-block";
        setTimeout(() => { saveBtn.textContent = "🔄 Update Profile"; saveBtn.style.color = ""; }, 2000);
      });

      removeBtn.addEventListener("click", () => {
        delete teamProfiles[playerId];
        saveTeamProfiles();
        saveBtn.textContent = "💾 Save Profile";
        removeBtn.style.display = "none";
      });

      wrap.appendChild(saveBtn);
      wrap.appendChild(removeBtn);
      modal.style.position = "relative";
      modal.appendChild(wrap);
    }

    tryInject();
    if (!modal.querySelector(".sg-inspect-save")) {
      // Inspect modal loads async — watch for username to appear
      const obs = new MutationObserver(() => {
        tryInject();
        if (modal.querySelector(".sg-inspect-save")) obs.disconnect();
      });
      obs.observe(modal, { childList: true, subtree: true });
    }
  }

  function setupInspectObserver() {
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList?.contains("inspect-modal")) { injectInspectSaveBtn(n); continue; }
          const inner = n.querySelector?.(".inspect-modal");
          if (inner) injectInspectSaveBtn(inner);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }



  let appRef = null;
  state.updateQueued = false;

  /**************************************************************************
   * MODULAR RENDER / EVENTS
   **************************************************************************/

  function renderStyles() {
    return `<style>${CSS}</style><style>
      .sg-mp-badge {
        position:absolute !important; top:5px !important; right:5px !important;
        font:700 10px/1.4 Inter,sans-serif !important;
        padding:2px 7px !important; border-radius:4px !important;
        border:1px solid !important; z-index:10 !important; pointer-events:none !important;
      }
      .sg-hl-top  { outline:3px solid #22c55e !important; box-shadow:0 0 16px 4px rgba(34,197,94,.75) !important; border-radius:4px; }
      .sg-hl-up   { outline:3px solid #3b82f6 !important; box-shadow:0 0 16px 4px rgba(59,130,246,.75) !important; border-radius:4px; }
      .sg-hl-neu  { outline:3px solid #94a3b8 !important; box-shadow:0 0 16px 4px rgba(148,163,184,.65) !important; border-radius:4px; }
      .sg-hl-skip { outline:3px solid #f97316 !important; box-shadow:0 0 16px 4px rgba(249,115,22,.75) !important; border-radius:4px; }
      .sg-hl-sal  { outline:3px solid #ef4444 !important; box-shadow:0 0 16px 4px rgba(239,68,68,.75) !important; border-radius:4px; }
    </style>`;
  }

  function renderActiveTab() {
    if (state.activeTab === "gear") return renderGear();
    if (state.activeTab === "filters") return renderFilters();
    if (state.activeTab === "market") return renderMarket();
    if (state.activeTab === "team") return renderTeam();
    return renderStats();
  }

  function tabButton(id, label) {
    return `<button type="button" class="sg-tab ${state.activeTab === id ? "active" : ""}" data-sg-tab="${id}">${label}</button>`;
  }

  function render() {
    return `
      ${renderStyles()}
      <div class="sg-tabs">
        ${tabButton("stats", "📊 Stats")}
        ${tabButton("gear", "🎒 Gear")}
        ${tabButton("filters", "⚙️ Filters")}
        ${tabButton("market", "🏪 Market")}
        ${tabButton("team", "👥 Team")}
      </div>
      <div class="sg-body">${renderActiveTab()}</div>
      <div class="sg-footer">Produced, maintained &amp; improved by <span class="sg-footer-name">teCsor</span></div>
    `;
  }

  function rerender(app) {
    renderIntoPanel(app || appRef);
  }

  function attachEvents(app) {
    const panel = app.panels.get(definition.id);
    if (!panel) return;

    if (panel.dataset.statGrabberEventsBound === "1") return;
    panel.dataset.statGrabberEventsBound = "1";

    panel.addEventListener("input", (event) => {
      const nameInput = event.target.closest("#sgFeName");
      if (nameInput && panel.contains(nameInput) && state.filterEdit) {
        state.filterEdit.name = nameInput.value;
      }
    });

    panel.addEventListener("click", (event) => {
      const target = event.target;
      const body = panel.querySelector(".vim-body");
      if (!body) return;

      const tab = target.closest("[data-sg-tab]");
      if (tab && panel.contains(tab)) {
        event.preventDefault();
        event.stopPropagation();
        state.activeTab = tab.dataset.sgTab || "stats";
        state.filterEdit = state.activeTab === "filters" ? state.filterEdit : null;
        rerender(app);
        return;
      }

      const filterToggle = target.closest("[data-ftoggle]");
      if (filterToggle && panel.contains(filterToggle)) {
        event.preventDefault();
        event.stopPropagation();
        const fc = state.filters.get(filterToggle.dataset.ftoggle);
        if (fc) {
          fc.enabled = !fc.enabled;
          saveFilters();
          rerender(app);
        }
        return;
      }

      const editButton = target.closest("[data-edit]");
      if (editButton && panel.contains(editButton)) {
        event.preventDefault();
        event.stopPropagation();
        const key = editButton.dataset.edit;
        const fc = state.filters.get(key);
        state.filterEdit = {
          key,
          name: key,
          stats: new Set(fc?.stats || []),
          multiBonus: { ...(fc?.multiBonus || {}) },
          preferredStats: new Set(fc?.preferredStats || []),
        };
        rerender(app);
        return;
      }

      const deleteButton = target.closest("[data-del]");
      if (deleteButton && panel.contains(deleteButton)) {
        event.preventDefault();
        event.stopPropagation();
        const key = deleteButton.dataset.del;
        state.filters.delete(key);
        if (state.activeFilterKey === key) {
          state.activeFilterKey = state.filters.keys().next().value ?? "";
          localStorage.setItem("sgActiveFilter", state.activeFilterKey);
        }
        saveFilters();
        rerender(app);
        return;
      }

      const filterRow = target.closest(".sg-filter-row[data-fkey]");
      if (filterRow && panel.contains(filterRow) && !target.closest("button")) {
        event.preventDefault();
        event.stopPropagation();
        state.activeFilterKey = filterRow.dataset.fkey;
        localStorage.setItem("sgActiveFilter", state.activeFilterKey);
        state.filterEdit = null;
        rerender(app);
        return;
      }

      const saveFilter = target.closest("#sgFeSave");
      if (saveFilter && panel.contains(saveFilter)) {
        event.preventDefault();
        event.stopPropagation();
        const fe = state.filterEdit;
        if (!fe) return;
        const nameInput = panel.querySelector("#sgFeName");
        const newName = (nameInput?.value || fe.name || fe.key).trim();
        const oldFC = state.filters.get(fe.key);
        if (newName !== fe.key) state.filters.delete(fe.key);
        state.filters.set(newName, mkFC([...fe.stats], oldFC?.enabled ?? true, fe.multiBonus, [...fe.preferredStats]));
        if (state.activeFilterKey === fe.key) {
          state.activeFilterKey = newName;
          localStorage.setItem("sgActiveFilter", newName);
        }
        state.filterEdit = null;
        saveFilters();
        rerender(app);
        return;
      }

      const cancelFilter = target.closest("#sgFeCancel");
      if (cancelFilter && panel.contains(cancelFilter)) {
        event.preventDefault();
        event.stopPropagation();
        state.filterEdit = null;
        rerender(app);
        return;
      }

      const editStat = target.closest("[data-estat]");
      if (editStat && panel.contains(editStat)) {
        event.preventDefault();
        event.stopPropagation();
        const nameInput = panel.querySelector("#sgFeName");
        if (nameInput && state.filterEdit) state.filterEdit.name = nameInput.value;
        const stat = editStat.dataset.estat;
        const fe = state.filterEdit;
        if (!fe) return;
        if (fe.preferredStats.has(stat)) {
          fe.preferredStats.delete(stat);
          fe.stats.delete(stat);
        } else if (fe.stats.has(stat)) {
          fe.stats.delete(stat);
          fe.preferredStats.add(stat);
        } else {
          fe.stats.add(stat);
        }
        rerender(app);
        return;
      }

      const quickStat = target.closest("[data-qstat]");
      if (quickStat && panel.contains(quickStat)) {
        event.preventDefault();
        event.stopPropagation();
        const fc = state.filters.get(state.activeFilterKey);
        if (!fc) return;
        const stat = quickStat.dataset.qstat;
        if (fc.preferredStats.has(stat)) {
          fc.preferredStats.delete(stat);
          fc.stats.delete(stat);
        } else if (fc.stats.has(stat)) {
          fc.stats.delete(stat);
          fc.preferredStats.add(stat);
        } else {
          fc.stats.add(stat);
        }
        saveFilters();
        rerender(app);
        return;
      }

      const mbStat = target.closest("[data-mbstat]");
      if (mbStat && panel.contains(mbStat)) {
        event.preventDefault();
        event.stopPropagation();
        const stat = mbStat.dataset.mbstat;
        if (!state.filterEdit) return;
        const nameInput = panel.querySelector("#sgFeName");
        if (nameInput) state.filterEdit.name = nameInput.value;
        const current = state.filterEdit.multiBonus[stat] ?? 0;
        const next = (current + 1) % 4;
        if (next === 0) delete state.filterEdit.multiBonus[stat];
        else state.filterEdit.multiBonus[stat] = next;
        rerender(app);
        return;
      }

      const addFilter = target.closest("#sgFeAdd");
      if (addFilter && panel.contains(addFilter)) {
        event.preventDefault();
        event.stopPropagation();
        const name = `Filter ${state.filters.size + 1}`;
        state.filters.set(name, mkFC([]));
        state.filterEdit = {
          key: name,
          name,
          stats: new Set(),
          multiBonus: {},
          preferredStats: new Set(),
        };
        saveFilters();
        rerender(app);
        return;
      }

      const preset = target.closest("[data-preset]");
      if (preset && panel.contains(preset)) {
        event.preventDefault();
        event.stopPropagation();
        const fc = state.filters.get(state.activeFilterKey);
        if (!fc) return;
        const keys = FILTER_PRESETS[preset.dataset.preset] ?? [];
        fc.stats.clear();
        fc.preferredStats.clear();
        keys.forEach((key) => fc.stats.add(key));
        saveFilters();
        rerender(app);
        return;
      }

      const modeSlot = target.closest("#sgModeSlot");
      if (modeSlot && panel.contains(modeSlot)) {
        event.preventDefault();
        event.stopPropagation();
        state.gearMode = "slot";
        rerender(app);
        return;
      }

      const modeCat = target.closest("#sgModeCat");
      if (modeCat && panel.contains(modeCat)) {
        event.preventDefault();
        event.stopPropagation();
        state.gearMode = "category";
        rerender(app);
        return;
      }

      const highlightAll = target.closest("#sgHlAll");
      if (highlightAll && panel.contains(highlightAll)) {
        event.preventDefault();
        event.stopPropagation();
        const allCats = CATEGORIES.map((cat) => cat.key);
        if (allCats.every((key) => state.highlightCats.has(key))) state.highlightCats.clear();
        else allCats.forEach((key) => state.highlightCats.add(key));
        applyBagHighlights();
        rerender(app);
        return;
      }

      const highlightCat = target.closest("[data-hlcat]");
      if (highlightCat && panel.contains(highlightCat)) {
        event.preventDefault();
        event.stopPropagation();
        const cat = highlightCat.dataset.hlcat;
        if (state.highlightCats.has(cat)) state.highlightCats.delete(cat);
        else state.highlightCats.add(cat);
        applyBagHighlights();
        rerender(app);
        return;
      }

      const salvageCheck = target.closest("[data-sg-salvage-check]");
      if (salvageCheck && panel.contains(salvageCheck)) {
        event.stopPropagation();
        const id = String(salvageCheck.dataset.sgSalvageCheck || "");
        if (id) {
          if (salvageCheck.checked) state.salvageSelectedIds.add(id);
          else state.salvageSelectedIds.delete(id);
          rerender(app);
        }
        return;
      }

      const selectSalvage = target.closest("[data-sg-select-salvage]");
      if (selectSalvage && panel.contains(selectSalvage)) {
        event.preventDefault();
        event.stopPropagation();
        state.highlightCats.add("sal");
        applyBagHighlights();
        state.salvageStatus = state.bagItems.some(item => item.cat === "sal") ? "Highlighted current Salvage items." : "No Salvage items found.";
        rerender(app);
        return;
      }

      const clearSalvage = target.closest("[data-sg-clear-salvage]");
      if (clearSalvage && panel.contains(clearSalvage)) {
        event.preventDefault();
        event.stopPropagation();
        state.salvageSelectedIds.clear();
        state.highlightCats.clear();
        state.salvageStatus = "";
        applyBagHighlights();
        rerender(app);
        return;
      }

      const salvageSelected = target.closest("[data-sg-salvage-selected]");
      if (salvageSelected && panel.contains(salvageSelected)) {
        event.preventDefault();
        event.stopPropagation();
        salvageSelectedItems(app).catch((err) => {
          state.salvageBusy = false;
          state.salvageStatus = err?.message || String(err);
          rerender(app);
        });
        return;
      }

      const sendOneTop = target.closest("[data-sg-team-send-one]");
      if (sendOneTop && panel.contains(sendOneTop)) {
        event.preventDefault();
        event.stopPropagation();
        sendSingleTeamTopPick(app, sendOneTop.dataset.sgTeamSendOne, sendOneTop.dataset.itemId).catch((err) => {
          state.teamSendBusy = false;
          state.teamSendStatus = err?.message || String(err);
          rerender(app);
        });
        return;
      }

      const teamSendTop = target.closest("[data-sg-team-send-top]");
      if (teamSendTop && panel.contains(teamSendTop)) {
        event.preventDefault();
        event.stopPropagation();
        sendTeamTopPicks(app).catch((err) => {
          state.teamSendBusy = false;
          state.teamSendStatus = err?.message || String(err);
          rerender(app);
        });
        return;
      }

      const teamDelete = target.closest(".sg-team-del");
      if (teamDelete && panel.contains(teamDelete)) {
        event.preventDefault();
        event.stopPropagation();
        const pid = teamDelete.dataset.teamDel;
        if (pid) {
          delete teamProfiles[pid];
          saveTeamProfiles();
          rerender(app);
        }
        return;
      }

      const teamFilter = target.closest(".sg-team-fchip");
      if (teamFilter && panel.contains(teamFilter)) {
        event.preventDefault();
        event.stopPropagation();
        const pid = teamFilter.dataset.teamFset;
        const fkey = teamFilter.dataset.fkey;
        if (pid && fkey && teamProfiles[pid]) {
          teamProfiles[pid].filterKey = fkey;
          saveTeamProfiles();
          rerender(app);
        }
        return;
      }

      const catHeader = target.closest(".sg-cat-header, .sg-team-header");
      if (catHeader && panel.contains(catHeader)) {
        event.preventDefault();
        event.stopPropagation();

        const teamSection = catHeader.closest("[data-team-pid]");
        if (teamSection) {
          const pid = teamSection.dataset.teamPid;
          const bodyEl = catHeader.nextElementSibling?.nextElementSibling || catHeader.nextElementSibling;
          const toggle = catHeader.querySelector(".sg-cat-toggle");
          const nowOpen = bodyEl?.classList.toggle("collapsed") === false;
          if (toggle) toggle.textContent = nowOpen ? "▾" : "▸";
          if (pid) teamOpen[pid] = nowOpen;
          return;
        }

        const catKey = catHeader.closest(".sg-cat-section")?.dataset.cat;
        const catBody = catHeader.nextElementSibling;
        const toggle = catHeader.querySelector(".sg-cat-toggle");
        const nowCollapsed = catBody?.classList.toggle("collapsed");
        if (toggle) toggle.textContent = nowCollapsed ? "▸" : "▾";
        if (catKey) state.catOpen[catKey] = !nowCollapsed;
        return;
      }

      const marketHideFuture = target.closest("#sgMktHideFuture");
      if (marketHideFuture && panel.contains(marketHideFuture)) {
        event.preventDefault();
        event.stopPropagation();
        state.marketHideFuture = !state.marketHideFuture;
        rerender(app);
      }
    });
  }

  function renderIntoPanel(app) {
    const panel = app?.panels?.get(definition.id);
    if (!panel) return;

    const body = panel.querySelector(".vim-body");
    const footer = panel.querySelector(".vim-footer");
    if (!body || !footer) return;

    if (
      state.activeTab === "filters" &&
      state.filterEdit &&
      document.activeElement &&
      panel.contains(document.activeElement) &&
      document.activeElement.classList.contains("sg-filter-input")
    ) {
      return;
    }

    body.innerHTML = render();

    footer.textContent = `${state.charName || "No character"} | ${state.bagItems.length} bag items | ${state.marketItems.length} market | Filter ${state.activeFilterKey || "—"}`;

    attachEvents(app);
  }

  function queueRender(app) {
    if (state.updateQueued) return;
    state.updateQueued = true;

    requestAnimationFrame(() => {
      state.updateQueued = false;
      renderIntoPanel(app);
    });
  }

  function tick(app) {
    readPlayerBar();
    readCharView();
    readInventoryState();
    readMarketListings();
    applyBagHighlights();
    applyMarketBadges();
    queueRender(app);
  }

  return {
    ...definition,

    init(app) {
      appRef = app;

      const boot = () => {
        setupTooltipObserver();
        setupInspectObserver();
        tick(app);
      };

      app.events.on("socket:any", (msg) => {
        const snap = msg?.snapshot || (msg?.type === "fullState" ? msg : null);
        if (snap?.inventory && Array.isArray(snap.inventory)) {
          try {
            _processInventory(snap.inventory);
            state.charName = snap.username || snap.name || state.charName;
            queueRender(app);
          } catch (err) {
            console.warn("[Stat Grabber] Could not process WS snapshot inventory", err);
          }
        }
      });

      if (document.body) {
        boot();
      } else {
        window.addEventListener("DOMContentLoaded", boot, { once: true });
      }

      setInterval(() => {
        const panelState = getPanelState(app, definition.id);
        if (!panelState?.enabled) return;
        tick(app);
      }, 1000);
    },

    render() {
      return render();
    },
  };

    }


    function createWsSnifferModule(definition) {
        const STORAGE_KEY = "voididle.wsSniffer.settings.v1";
        const MAX_LOGS = 500;

        const state = {
            logs: [],
            updateQueued: false,
            filter: "worldBoss",
            search: "",
            paused: false,
            selectedId: "",
            selectedIds: new Set(),
            captureOut: true,
            captureRaw: true,
        };

        function clean(value) {
            return String(value ?? "").replace(/\s+/g, " ").trim();
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

        function formatTime(ts) {
            return new Date(ts || Date.now()).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        }

        function safeJson(value) {
            try {
                return JSON.stringify(value, null, 2);
            } catch {
                return String(value);
            }
        }

        function loadSettings() {
            try {
                const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

                state.filter = parsed.filter || state.filter;
                state.search = parsed.search || "";
                state.captureOut = parsed.captureOut !== false;
                state.captureRaw = parsed.captureRaw !== false;
            } catch { }
        }

        function saveSettings() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    filter: state.filter,
                    search: state.search,
                    captureOut: state.captureOut,
                    captureRaw: state.captureRaw,
                }));
            } catch { }
        }

        function flattenForSearch(value) {
            if (value == null) return "";

            if (typeof value === "string") return value.toLowerCase();

            try {
                return JSON.stringify(value).toLowerCase();
            } catch {
                return String(value).toLowerCase();
            }
        }

        function getMessageObject(entry) {
            if (entry?.parsed && typeof entry.parsed === "object") return entry.parsed;
            return null;
        }

        function getWorldBossPayload(entryOrMessage) {
            const msg = entryOrMessage?.parsed || entryOrMessage;

            if (!msg || typeof msg !== "object") return null;

            return msg.worldBoss || msg.snapshot?.worldBoss || null;
        }

        function inferWorldBossStateFromPayload(wb) {
            if (!wb || typeof wb !== "object") return "";

            const now = Date.now();
            const phase = String(wb.phase || "").toLowerCase();

            if (phase === "queuing" || wb.queued || (Number(wb.fightStartsAt) > now && Number(wb.corpseEndsAt || 0) <= 0)) {
                return "queued";
            }

            if (phase === "corpse" || Number(wb.corpseEndsAt || 0) > now || Number(wb.corpseHp || 0) > 0 || Number(wb.corpseMaxHp || 0) > 0) {
                return "corpse";
            }

            if (phase === "fighting" || phase === "fight" || Boolean(wb.inWorldBossFight) || (Number(wb.hp) > 0 && Number(wb.maxHp) > 0 && Number(wb.fightStartsAt || 0) <= now)) {
                return "fighting";
            }

            if (phase === "dead" || phase === "killed" || (Number(wb.hp) <= 0 && Number(wb.maxHp) > 0)) {
                return "dead";
            }

            return phase || "unknown";
        }

        function formatDuration(ms) {
            const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;

            if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;

            return `${m}m ${String(s).padStart(2, "0")}s`;
        }

        function formatDateTime(ms) {
            const value = Number(ms || 0);

            if (!value) return "";

            return new Date(value).toLocaleString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                month: "short",
                day: "2-digit",
            });
        }

        function summarizeWorldBoss(entryOrMessage) {
            const wb = getWorldBossPayload(entryOrMessage);

            if (!wb) return "";

            const state = inferWorldBossStateFromPayload(wb);
            const parts = [];

            parts.push(wb.name || "World Boss");
            parts.push(state);

            if (wb.level != null) parts.push(`Lv ${wb.level}`);
            if (wb.zoneId) parts.push(`zone=${wb.zoneId}`);

            if (state === "queued" && wb.fightStartsAt) {
                parts.push(`starts ${formatDateTime(wb.fightStartsAt)}`);
                parts.push(`in ${formatDuration(Number(wb.fightStartsAt) - Date.now())}`);
            }

            if (state === "fighting" && wb.hp != null && wb.maxHp != null) {
                parts.push(`HP ${formatCompact(wb.hp)}/${formatCompact(wb.maxHp)}`);
            }

            if (state === "corpse" && wb.corpseEndsAt) {
                parts.push(`corpse ends ${formatDateTime(wb.corpseEndsAt)}`);
                parts.push(`in ${formatDuration(Number(wb.corpseEndsAt) - Date.now())}`);
            }

            if (wb.queueCount != null) parts.push(`queue=${wb.queueCount}`);
            if (wb.participantCount != null) parts.push(`participants=${wb.participantCount}`);
            if (wb.combatCount != null) parts.push(`combat=${wb.combatCount}`);
            if (wb.lifeskillCount != null) parts.push(`gather=${wb.lifeskillCount}`);

            return parts.filter(Boolean).join(" · ");
        }

        function isWorldBossMessage(entry) {
            const msg = getMessageObject(entry);
            const wb = getWorldBossPayload(entry);

            if (wb) return true;

            const text = flattenForSearch(msg || entry.raw);

            if (
                text.includes("worldboss") ||
                text.includes("world boss") ||
                text.includes("wb-") ||
                text.includes("wb_") ||
                text.includes("bossfight") ||
                text.includes("boss_fight") ||
                text.includes("wb-dps") ||
                text.includes("corpse") ||
                text.includes("sky demon") ||
                text.includes("forest ancient")
            ) {
                return true;
            }

            if (msg && typeof msg === "object") {
                const type = String(msg.type || "").toLowerCase();

                if (type.includes("boss") || type.includes("worldboss") || type.includes("wb")) return true;

                const enemies = Array.isArray(msg.enemies) ? msg.enemies : [];
                if (enemies.some((enemy) => String(enemy?.name || enemy?.id || "").toLowerCase().includes("world boss"))) {
                    return true;
                }
            }

            return false;
        }

        function getMessageType(entry) {
            const msg = getMessageObject(entry);

            if (msg && !Array.isArray(msg)) {
                return msg.type || entry.type || "object";
            }

            if (Array.isArray(msg)) return "array";

            return entry.parseError ? "raw" : (entry.type || "unknown");
        }

        function getSummary(entry) {
            const wbSummary = summarizeWorldBoss(entry);

            if (wbSummary) return wbSummary;

            const msg = getMessageObject(entry);

            if (msg && typeof msg === "object" && !Array.isArray(msg)) {
                const parts = [];

                if (msg.type) parts.push(`type=${msg.type}`);
                if (msg.name) parts.push(`name=${msg.name}`);
                if (msg.zoneId) parts.push(`zone=${msg.zoneId}`);
                if (msg.lastZoneId) parts.push(`lastZone=${msg.lastZoneId}`);
                if (msg.killedEnemyName) parts.push(`killed=${msg.killedEnemyName}`);
                if (msg.killThisTick) parts.push("killThisTick");
                if (msg.tier != null) parts.push(`tier=${msg.tier}`);

                const enemies = Array.isArray(msg.enemies) ? msg.enemies : [];
                const wbEnemy = enemies.find((enemy) => String(enemy?.name || "").toLowerCase().includes("world boss"));
                if (wbEnemy) parts.push(`enemy=${wbEnemy.name}`);

                if (parts.length) return parts.join(" · ");
            }

            if (entry.parseError) return `parse error · ${entry.parseError}`;

            return clean(String(entry.raw || "")).slice(0, 140) || "message";
        }

        function addEntry(payload) {
            if (state.paused) return;
            if (!payload) return;
            if (!state.captureOut && payload.direction === "OUT") return;
            if (!state.captureRaw && !payload.parsed) return;

            const entry = {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                direction: payload.direction || "?",
                url: payload.url || "",
                ts: payload.ts || Date.now(),
                raw: payload.raw,
                rawType: payload.rawType || "",
                parseError: payload.parseError || "",
                parsed: payload.parsed,
                type: payload.type || "",
                worldBoss: false,
            };

            entry.worldBoss = isWorldBossMessage(entry);
            entry.summary = getSummary(entry);

            state.logs.unshift(entry);

            if (state.logs.length > MAX_LOGS) {
                state.logs.length = MAX_LOGS;
            }

            if (!state.selectedId && entry.worldBoss) {
                state.selectedId = entry.id;
            }
        }

        function getFilteredLogs() {
            const search = String(state.search || "").trim().toLowerCase();

            return state.logs.filter((entry) => {
                if (state.filter === "worldBoss" && !entry.worldBoss) return false;
                if (state.filter === "in" && entry.direction !== "IN") return false;
                if (state.filter === "out" && entry.direction !== "OUT") return false;
                if (state.filter === "parsed" && !entry.parsed) return false;
                if (state.filter === "raw" && entry.parsed) return false;

                if (search) {
                    const haystack = [
                        entry.direction,
                        entry.type,
                        entry.summary,
                        entry.url,
                        flattenForSearch(entry.parsed || entry.raw),
                    ].join(" ").toLowerCase();

                    if (!haystack.includes(search)) return false;
                }

                return true;
            });
        }

        function getSelectedEntry() {
            return state.logs.find((entry) => entry.id === state.selectedId) || getFilteredLogs()[0] || null;
        }

        function renderStyles() {
            return `
      <style>
        .wss-toolbar {
          display:flex;
          flex-wrap:wrap;
          gap:7px;
          align-items:center;
          margin-bottom:9px;
        }

        .wss-input,
        .wss-select {
          background:rgba(0,0,0,0.25);
          color:#e5e7eb;
          border:1px solid rgba(255,255,255,0.14);
          border-radius:7px;
          padding:5px 7px;
          font-size:11px;
          outline:none;
        }

        .wss-input {
          min-width:180px;
          flex:1;
        }

        .wss-grid {
          display:grid;
          grid-template-columns:minmax(260px, 38%) 1fr;
          gap:9px;
          min-height:420px;
        }

        .wss-list,
        .wss-detail {
          border:1px solid rgba(255,255,255,0.08);
          border-radius:10px;
          background:rgba(255,255,255,0.035);
          overflow:auto;
          max-height:490px;
          overscroll-behavior:contain;
          scrollbar-gutter:stable;
        }

        .wss-row {
          display:grid;
          grid-template-columns:22px 62px 38px 1fr;
          gap:6px;
          padding:7px;
          border-bottom:1px solid rgba(255,255,255,0.06);
          cursor:pointer;
        }

        .wss-row:hover {
          background:rgba(255,255,255,0.055);
        }

        .wss-row.active {
          background:rgba(56,189,248,0.13);
        }

        .wss-time {
          color:rgba(229,231,235,0.55);
          font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
          font-size:10px;
        }

        .wss-dir-in { color:#4ade80; font-weight:800; }
        .wss-dir-out { color:#60a5fa; font-weight:800; }
        .wss-wb { color:#fbbf24; font-weight:800; }
        .wss-muted { color:rgba(229,231,235,0.55); }

        .wss-summary {
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }

        .wss-pre {
          margin:0;
          padding:10px;
          white-space:pre-wrap;
          word-break:break-word;
          font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
          font-size:11px;
          line-height:1.35;
          color:rgba(229,231,235,0.82);
        }

        .wss-card {
          padding:9px;
          border-bottom:1px solid rgba(255,255,255,0.08);
        }

        @media (max-width: 800px) {
          .wss-grid {
            grid-template-columns:1fr;
          }
        }
      </style>
    `;
        }

        function render() {
            const filtered = getFilteredLogs();
            const selected = getSelectedEntry();

            return `
      ${renderStyles()}

      <div class="wss-toolbar" data-wss-controls>
        <select class="wss-select" data-wss-filter>
          ${[
                ["worldBoss", "World Boss"],
                ["all", "All"],
                ["in", "IN only"],
                ["out", "OUT only"],
                ["parsed", "Parsed JSON"],
                ["raw", "Raw / parse errors"],
            ].map(([value, label]) => `<option value="${value}" ${state.filter === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>

        <input class="wss-input" data-wss-search placeholder="Search messages/type/name..." value="${escapeHtml(state.search)}" />

        <button class="vim-btn" data-wss-pause>${state.paused ? "Resume" : "Pause"}</button>
        <button class="vim-btn" data-wss-copy>Copy Selected</button>
        <button class="vim-btn" data-wss-select-visible>Select Visible</button>
        <button class="vim-btn" data-wss-clear-selected>Clear Selected</button>
        <button class="vim-btn" data-wss-copy-wb>Copy WB Logs</button>
        <button class="vim-btn" data-wss-clear>Clear</button>

        <label class="vim-switch-row" title="Capture client to server messages">
          <input type="checkbox" data-wss-capture-out ${state.captureOut ? "checked" : ""} />
          <span>OUT</span>
        </label>

        <label class="vim-switch-row" title="Capture unparsed/raw messages">
          <input type="checkbox" data-wss-capture-raw ${state.captureRaw ? "checked" : ""} />
          <span>Raw</span>
        </label>
      </div>

      <div class="wss-card">
        <b>🛰️ WS Sniffer</b>
        <span class="wss-muted">
          Captured ${state.logs.length}/${MAX_LOGS} messages · ${state.logs.filter((entry) => entry.worldBoss).length} world-boss candidates · showing ${filtered.length} · selected ${state.selectedIds.size}
        </span>
      </div>

      <div class="wss-grid">
        <div class="wss-list">
          ${filtered.length ? filtered.slice(0, 180).map((entry) => `
            <div class="wss-row ${selected?.id === entry.id ? "active" : ""}" data-wss-select="${escapeHtml(entry.id)}">
              <div><input type="checkbox" data-wss-check="${escapeHtml(entry.id)}" ${state.selectedIds.has(entry.id) ? "checked" : ""} /></div>
              <div class="wss-time">${escapeHtml(formatTime(entry.ts))}</div>
              <div class="${entry.direction === "OUT" ? "wss-dir-out" : "wss-dir-in"}">${escapeHtml(entry.direction)}</div>
              <div class="wss-summary">
                ${entry.worldBoss ? `<span class="wss-wb">WB</span> ` : ""}
                <b>${escapeHtml(getMessageType(entry))}</b>
                <span class="wss-muted"> ${escapeHtml(entry.summary)}</span>
              </div>
            </div>
          `).join("") : `<div class="wss-card wss-muted">No messages match this filter yet. Keep this panel enabled while the boss queue/fight/corpse appears.</div>`}
        </div>

        <div class="wss-detail">
          ${selected ? `
            <div class="wss-card">
              <b>${escapeHtml(selected.direction)} ${escapeHtml(getMessageType(selected))}</b>
              ${selected.worldBoss ? `<span class="wss-wb"> · World Boss candidate</span>` : ""}
              <div class="wss-muted">${escapeHtml(formatTime(selected.ts))} · ${escapeHtml(selected.url || "unknown url")}</div>
            </div>
            <pre class="wss-pre">${escapeHtml(safeJson(selected.parsed || selected.raw))}</pre>
          ` : `<div class="wss-card wss-muted">Select a message to inspect it.</div>`}
        </div>
      </div>
    `;
        }

        function attachEvents(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            panel.querySelector("[data-wss-filter]")?.addEventListener("change", (event) => {
                state.filter = event.target.value;
                saveSettings();
                renderIntoPanel(app, { force: true });
            });

            panel.querySelector("[data-wss-search]")?.addEventListener("input", (event) => {
                state.search = event.target.value;
                saveSettings();
                renderIntoPanel(app, { force: true });
            });

            panel.querySelector("[data-wss-pause]")?.addEventListener("click", () => {
                state.paused = !state.paused;
                renderIntoPanel(app, { force: true });
            });

            panel.querySelector("[data-wss-clear]")?.addEventListener("click", () => {
                state.logs = [];
                state.selectedId = "";
                state.selectedIds.clear();
                renderIntoPanel(app, { force: true });
            });

            panel.querySelector("[data-wss-copy]")?.addEventListener("click", async () => {
                const checked = state.logs.filter((entry) => state.selectedIds.has(entry.id));
                const selected = checked.length ? checked : [getSelectedEntry()].filter(Boolean);

                const text = selected.length
                    ? selected.map((entry) => `[${formatTime(entry.ts)}] ${entry.direction} ${getMessageType(entry)} ${entry.worldBoss ? "(WB)" : ""}\n${safeJson(entry.parsed || entry.raw)}`).join("\n\n")
                    : "No selected message.";

                try {
                    await navigator.clipboard.writeText(text);
                } catch {
                    console.log(text);
                    alert("Could not copy automatically. Message printed to console.");
                }
            });

            panel.querySelector("[data-wss-select-visible]")?.addEventListener("click", () => {
                getFilteredLogs().slice(0, 180).forEach((entry) => state.selectedIds.add(entry.id));
                renderIntoPanel(app, { force: true });
            });

            panel.querySelector("[data-wss-clear-selected]")?.addEventListener("click", () => {
                state.selectedIds.clear();
                renderIntoPanel(app, { force: true });
            });

            panel.querySelector("[data-wss-copy-wb]")?.addEventListener("click", async () => {
                const text = state.logs
                    .filter((entry) => entry.worldBoss)
                    .slice(0, 80)
                    .map((entry) => `[${formatTime(entry.ts)}] ${entry.direction} ${getMessageType(entry)}\n${safeJson(entry.parsed || entry.raw)}`)
                    .join("\n\n");

                try {
                    await navigator.clipboard.writeText(text || "No world boss messages captured.");
                } catch {
                    console.log(text);
                    alert("Could not copy automatically. WB logs printed to console.");
                }
            });

            panel.querySelector("[data-wss-capture-out]")?.addEventListener("change", (event) => {
                state.captureOut = event.target.checked;
                saveSettings();
                renderIntoPanel(app, { force: true });
            });

            panel.querySelector("[data-wss-capture-raw]")?.addEventListener("change", (event) => {
                state.captureRaw = event.target.checked;
                saveSettings();
                renderIntoPanel(app, { force: true });
            });

            panel.querySelectorAll("[data-wss-check]").forEach((checkbox) => {
                checkbox.addEventListener("click", (event) => {
                    event.stopPropagation();

                    if (checkbox.checked) {
                        state.selectedIds.add(checkbox.dataset.wssCheck);
                    } else {
                        state.selectedIds.delete(checkbox.dataset.wssCheck);
                    }

                    state.selectedId = checkbox.dataset.wssCheck;
                    renderIntoPanel(app, { force: true });
                });
            });

            panel.querySelectorAll("[data-wss-select]").forEach((row) => {
                row.addEventListener("click", () => {
                    state.selectedId = row.dataset.wssSelect;
                    renderIntoPanel(app, { force: true });
                });
            });
        }

        function getScrollAnchor(scroller, selector, idAttr) {
            if (!scroller) return null;

            const scrollTop = scroller.scrollTop || 0;
            const rows = Array.from(scroller.querySelectorAll(selector));
            const firstVisible = rows.find((row) => row.offsetTop + row.offsetHeight >= scrollTop) || rows[0] || null;

            if (!firstVisible) {
                return {
                    id: "",
                    offset: 0,
                    scrollTop,
                };
            }

            return {
                id: firstVisible.getAttribute(idAttr) || "",
                offset: firstVisible.offsetTop - scrollTop,
                scrollTop,
            };
        }

        function restoreScrollAnchor(scroller, anchor, selector, idAttr) {
            if (!scroller || !anchor) return;

            if (anchor.id) {
                const escapedId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(anchor.id) : String(anchor.id).replace(/"/g, "\"");
                const row = scroller.querySelector(`${selector}[${idAttr}="${escapedId}"]`);

                if (row) {
                    scroller.scrollTop = Math.max(0, row.offsetTop - anchor.offset);
                    return;
                }
            }

            scroller.scrollTop = anchor.scrollTop || 0;
        }

        function renderIntoPanel(app, options = {}) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            const body = panel.querySelector(".vim-body");
            const footer = panel.querySelector(".vim-footer");

            if (!body || !footer) return;

            const previousBodyScroll = body.scrollTop;
            const previousList = body.querySelector(".wss-list");
            const previousDetail = body.querySelector(".wss-detail");
            const listAnchor = getScrollAnchor(previousList, "[data-wss-select]", "data-wss-select");
            const previousDetailScroll = previousDetail ? previousDetail.scrollTop : 0;

            const activeElement = document.activeElement;
            const controlsActive =
                !options.force &&
                activeElement &&
                panel.contains(activeElement) &&
                activeElement.closest("[data-wss-controls]");

            if (!controlsActive) {
                body.innerHTML = render();
                attachEvents(app);

                const nextList = body.querySelector(".wss-list");
                const nextDetail = body.querySelector(".wss-detail");

                if (previousBodyScroll > 0 || state.paused) body.scrollTop = previousBodyScroll;

                // The list receives new rows at the top. Restoring the raw scrollTop makes the viewport
                // appear to jump upward as new WS messages arrive. Restore by visible-row anchor instead.
                restoreScrollAnchor(nextList, listAnchor, "[data-wss-select]", "data-wss-select");

                if (nextDetail && (previousDetailScroll > 0 || state.paused)) nextDetail.scrollTop = previousDetailScroll;
            }

            footer.textContent =
                `${state.logs.length} messages | ${state.logs.filter((entry) => entry.worldBoss).length} WB candidates | ` +
                `${state.selectedIds.size} selected | ${state.paused ? "Paused" : "Live"} | Filter ${state.filter}`;
        }

        function queueRender(app) {
            if (state.updateQueued) return;

            state.updateQueued = true;

            setTimeout(() => {
                state.updateQueued = false;

                const panelState = getPanelState(app, definition.id);
                if (!panelState?.enabled) return;

                renderIntoPanel(app);
            }, 350);
        }

        return {
            ...definition,

            init(app) {
                loadSettings();

                app.events.on("socket:debug", (entry) => {
                    const panelState = getPanelState(app, definition.id);
                    if (!panelState?.enabled) return;

                    addEntry(entry);
                    queueRender(app);
                });
            },

            render() {
                return render();
            },
        };
    }

    function createBossTrackerModule(definition) {
        const STORAGE_KEY = "voididle.bossTracker.history.v1";
        const ROLE_STORAGE_KEY = "voididle.bossTracker.role.v1";
        const MAX_HISTORY = 80;

        const state = {
            history: [],
            activeBossId: "",
            selectedBossId: "",
            queuedBoss: null,
            corpse: null,
            role: loadBossTrackerRole(),
            activeTab: "active",
            updateQueued: false,
            scanTimer: null,
            observer: null,
            lastScanAt: 0,
            lastExportAt: null,
            message: "",
            messageColor: "#69f0ae",
            detailSubTab: "fighters",
            copyIds: new Set(),
        };

        let appRef = null;

        function loadBossTrackerRole() {
            try {
                const saved = localStorage.getItem(ROLE_STORAGE_KEY);
                return saved === "gathering" ? "gathering" : "fighting";
            } catch {
                return "fighting";
            }
        }

        function saveBossTrackerRole(role) {
            state.role = role === "gathering" ? "gathering" : "fighting";

            try {
                localStorage.setItem(ROLE_STORAGE_KEY, state.role);
            } catch { }
        }

        function roleLabel(role = state.role) {
            return role === "gathering" ? "Gathering" : "Fighting";
        }

        function phaseLabel(phase) {
            const value = clean(phase || "");
            if (value === "queue") return "Queue";
            if (value === "combat") return "Combat";
            if (value === "corpse") return "Corpse";
            if (value === "gathering") return "Gathering";
            if (value === "ended") return "Ended";
            return value || "—";
        }

        function now() {
            return Date.now();
        }

        function clean(value) {
            return String(value ?? "").replace(/\s+/g, " ").trim();
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

        function formatTime(ts) {
            if (!ts) return "—";

            return new Date(ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        }

        function formatDateTime(ts) {
            if (!ts) return "—";

            return new Date(ts).toLocaleString([], {
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        }

        function formatDuration(ms) {
            const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;

            if (minutes >= 60) {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return `${hours}h ${mins}m`;
            }

            return `${minutes}:${String(secs).padStart(2, "0")}`;
        }

        function parseNumberText(value) {
            const raw = String(value || "").trim().toUpperCase();
            if (!raw) return 0;

            let mult = 1;
            let s = raw;

            if (s.endsWith("B")) {
                mult = 1_000_000_000;
                s = s.slice(0, -1);
            } else if (s.endsWith("M")) {
                mult = 1_000_000;
                s = s.slice(0, -1);
            } else if (s.endsWith("K")) {
                mult = 1_000;
                s = s.slice(0, -1);
            }

            s = s.replace(/[^0-9.\-]/g, "");
            const n = Number.parseFloat(s);

            return Number.isFinite(n) ? n * mult : 0;
        }

        function formatCompactNumber(value) {
            const n = Number(value || 0);

            if (!Number.isFinite(n)) return "0";
            if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
            if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
            if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;

            return Math.round(n).toLocaleString();
        }

        function normalizeName(value) {
            return clean(value).toLowerCase();
        }

        function bossSignature(name, level, maxHp) {
            return `${clean(name).toLowerCase()}|${Number(level || 0)}|${Number(maxHp || 0)}`;
        }

        function bossSessionKey(data = {}) {
            const sourceId = clean(data.sourceId || data.worldBossId || data.serverId || "");
            if (sourceId) return `server:${sourceId}`;

            const name = normalizeName(data.name || "unknown-boss");
            const level = Number(data.level || 0);
            const anchorTs = Number(
                data.expectedSpawnAt ||
                data.fightStartsAt ||
                data.spawnedAt ||
                data.corpseAt ||
                data.killedAt ||
                data.endedAt ||
                data.firstSeenAt ||
                0
            );

            if (anchorTs) {
                return `dom:${name}|${level}|${Math.floor(anchorTs / 60000)}`;
            }

            return `dom:${name}|${level}|${Number(data.maxHp || 0)}`;
        }

        function mergeBossRecord(target, source) {
            const old = normalizeBossRecord(target);
            const incoming = normalizeBossRecord(source);

            return normalizeBossRecord({
                ...old,
                ...incoming,
                id: old.id || incoming.id,
                sourceId: old.sourceId || incoming.sourceId || "",
                sessionKey: old.sessionKey || incoming.sessionKey || bossSessionKey({ ...old, ...incoming }),
                name: incoming.name !== "Unknown Boss" ? incoming.name : old.name,
                level: incoming.level || old.level,
                maxHp: Math.max(old.maxHp || 0, incoming.maxHp || 0),
                currentHp: incoming.currentHp || old.currentHp,
                hpPct: incoming.hpPct || old.hpPct,
                queuedAt: old.queuedAt || incoming.queuedAt,
                expectedSpawnAt: old.expectedSpawnAt || incoming.expectedSpawnAt,
                spawnedAt: old.spawnedAt || incoming.spawnedAt,
                firstSeenAt: Math.min(old.firstSeenAt || incoming.firstSeenAt || now(), incoming.firstSeenAt || old.firstSeenAt || now()),
                lastSeenAt: Math.max(old.lastSeenAt || 0, incoming.lastSeenAt || 0),
                corpseAt: old.corpseAt || incoming.corpseAt,
                gatheringStartedAt: old.gatheringStartedAt || incoming.gatheringStartedAt,
                endedAt: old.endedAt || incoming.endedAt,
                killedAt: old.killedAt || incoming.killedAt,
                active: old.active || incoming.active,
                phase: incoming.phase || old.phase,
                fightersCount: Math.max(old.fightersCount || 0, incoming.fightersCount || 0),
                myName: old.myName || incoming.myName,
                myRank: old.myRank || incoming.myRank,
                myDamage: old.myDamage || incoming.myDamage,
                myDps: old.myDps || incoming.myDps,
                participants: [...(old.participants || []), ...(incoming.participants || [])],
                leaderboard: (incoming.leaderboard?.length ? incoming.leaderboard : old.leaderboard) || [],
                snapshots: [...(old.snapshots || []), ...(incoming.snapshots || [])].slice(-30),
            });
        }

        function dedupeBossHistory() {
            const byKey = new Map();

            for (const rawBoss of state.history || []) {
                const boss = normalizeBossRecord(rawBoss);
                const key = boss.sessionKey || bossSessionKey(boss);
                const existing = byKey.get(key);

                byKey.set(key, existing ? mergeBossRecord(existing, boss) : boss);
            }

            state.history = [...byKey.values()]
                .sort((a, b) => Number(b.lastSeenAt || b.firstSeenAt || 0) - Number(a.lastSeenAt || a.firstSeenAt || 0))
                .slice(0, MAX_HISTORY);

            const active = state.history.find((boss) => boss.active);
            state.activeBossId = active?.id || "";
            if (state.selectedBossId && !state.history.some((boss) => boss.id === state.selectedBossId)) {
                state.selectedBossId = state.history[0]?.id || "";
            }
        }

        function findRecentBossByName(name, level = 0) {
            const wanted = normalizeName(name);
            const lvl = Number(level || 0);
            const ts = now();

            return state.history.find((boss) => {
                if (normalizeName(boss.name) !== wanted) return false;
                if (lvl && Number(boss.level || 0) && Number(boss.level || 0) !== lvl) return false;

                const last = Number(boss.lastSeenAt || boss.corpseAt || boss.killedAt || boss.endedAt || boss.firstSeenAt || 0);
                return boss.active || !boss.endedAt || (last && ts - last < 10 * 60 * 1000);
            }) || null;
        }

        function loadHistory() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return;

                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return;

                state.history = parsed
                    .filter((boss) => boss && typeof boss === "object")
                    .map(normalizeBossRecord)
                    .slice(0, MAX_HISTORY * 3);

                dedupeBossHistory();
                saveHistory();

                const active = state.history.find((boss) => boss.active);
                state.activeBossId = active?.id || "";
                state.selectedBossId = state.history[0]?.id || "";
            } catch {
                state.history = [];
            }
        }

        function saveHistory() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history.slice(0, MAX_HISTORY)));
            } catch (err) {
                console.warn("[VoidIdle Boss Tracker] Could not save boss history", err);
            }
        }

        function normalizeBossRecord(boss) {
            return {
                id: String(boss.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
                sourceId: clean(boss.sourceId || boss.worldBossId || boss.serverId || ""),
                sessionKey: clean(boss.sessionKey || bossSessionKey(boss)),
                signature: String(boss.signature || bossSignature(boss.name, boss.level, boss.maxHp)),
                name: clean(boss.name || "Unknown Boss"),
                level: Number(boss.level || 0),
                maxHp: Number(boss.maxHp || 0),
                currentHp: Number(boss.currentHp || 0),
                hpPct: Number(boss.hpPct || 0),
                queuedAt: Number(boss.queuedAt || 0),
                expectedSpawnAt: Number(boss.expectedSpawnAt || 0),
                spawnedAt: Number(boss.spawnedAt || boss.firstSeenAt || now()),
                firstSeenAt: Number(boss.firstSeenAt || boss.spawnedAt || now()),
                lastSeenAt: Number(boss.lastSeenAt || now()),
                endedAt: Number(boss.endedAt || boss.killedAt || 0),
                killedAt: Number(boss.killedAt || boss.endedAt || 0),
                corpseAt: Number(boss.corpseAt || 0),
                gatheringStartedAt: Number(boss.gatheringStartedAt || 0),
                role: clean(boss.role || "fighting"),
                phase: clean(boss.phase || (boss.active ? "combat" : "ended")),
                active: boss.active === true,
                fightersCount: Number(boss.fightersCount || 0),
                myName: clean(boss.myName || ""),
                myRank: clean(boss.myRank || ""),
                myDamage: clean(boss.myDamage || ""),
                myDps: clean(boss.myDps || ""),
                participants: Array.isArray(boss.participants) ? boss.participants.map(normalizeParticipant) : [],
                leaderboard: Array.isArray(boss.leaderboard) ? boss.leaderboard.map(normalizeLeaderboardRow) : [],
                snapshots: Array.isArray(boss.snapshots) ? boss.snapshots.slice(-30) : [],
            };
        }

        function normalizeParticipant(participant) {
            return {
                name: clean(participant.name || ""),
                firstSeenAt: Number(participant.firstSeenAt || now()),
                lastSeenAt: Number(participant.lastSeenAt || now()),
                hpPct: Number(participant.hpPct || 0),
                isZerk: participant.isZerk === true,
                image: String(participant.image || ""),
            };
        }

        function normalizeLeaderboardRow(row) {
            return {
                rank: clean(row.rank || ""),
                name: clean(row.name || ""),
                damageText: clean(row.damageText || ""),
                damage: Number(row.damage || parseNumberText(row.damageText) || 0),
                dpsText: clean(row.dpsText || ""),
                dps: Number(row.dps || parseNumberText(String(row.dpsText || "").replace(/\/s$/i, "")) || 0),
                isYou: row.isYou === true,
            };
        }

        function findActiveBoss() {
            return state.history.find((boss) => boss.id === state.activeBossId) || null;
        }

        function findSelectedBoss() {
            return (
                state.history.find((boss) => boss.id === state.selectedBossId) ||
                findActiveBoss() ||
                state.history[0] ||
                null
            );
        }

        function showMessage(app, message, color = "#69f0ae") {
            state.message = message;
            state.messageColor = color;
            queueRender(app);

            setTimeout(() => {
                if (state.message === message) {
                    state.message = "";
                    queueRender(app);
                }
            }, 2200);
        }

        function getStyleUrl(el) {
            const bg = String(el?.style?.backgroundImage || "");
            const match = bg.match(/url\(["']?(.+?)["']?\)/i);
            return match ? match[1] : "";
        }

        function readHpPctFromFill(root, selector) {
            const fill = root.querySelector(selector);
            const width = String(fill?.style?.width || "").replace("%", "");
            const n = Number.parseFloat(width);
            return Number.isFinite(n) ? n : 0;
        }

        function parseHpText(text) {
            const match = String(text || "").match(/([\d.,]+)\s*\/\s*([\d.,]+)/);
            if (!match) {
                return {
                    currentHp: 0,
                    maxHp: 0,
                };
            }

            return {
                currentHp: parseNumberText(match[1]),
                maxHp: parseNumberText(match[2]),
            };
        }

        function parseCountdownMs(text) {
            const raw = clean(text);
            if (!raw) return 0;

            const timeMatch = raw.match(/(\d+)\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?/);
            if (timeMatch) {
                const first = Number(timeMatch[1] || 0);
                const second = Number(timeMatch[2] || 0);
                const third = Number(timeMatch[3] || 0);

                if (timeMatch[3] !== undefined) {
                    return ((first * 3600) + (second * 60) + third) * 1000;
                }

                return ((first * 60) + second) * 1000;
            }

            const minutes = Number(raw.match(/(\d+)\s*m/i)?.[1] || 0);
            const seconds = Number(raw.match(/(\d+)\s*s/i)?.[1] || 0);

            return ((minutes * 60) + seconds) * 1000;
        }

        function readWorldBossQueueBanner() {
            const banner = document.querySelector(".wb-banner");
            if (!banner) return null;

            const name = clean(banner.querySelector(".wb-name")?.textContent || "");
            if (!name) return null;

            const levelText = clean(banner.querySelector(".wb-level")?.textContent || "");
            const levelMatch = levelText.match(/(\d+)/);
            const level = levelMatch ? Number(levelMatch[1]) : 0;
            const timerText = clean(banner.querySelector(".wb-timer")?.textContent || banner.querySelector(".wb-btn--queued")?.textContent || "");
            const fightersText = clean(banner.querySelector(".wb-fighters")?.textContent || "");
            const fightersMatch = fightersText.match(/⚔\s*(\d+)/) || fightersText.match(/(\d+)/);
            const queuedMatch = fightersText.match(/🌾\s*(\d+)/) || fightersText.match(/(\d+)\s*queued/i);
            const countdownMs = parseCountdownMs(timerText);
            const ts = now();

            return {
                id: `queue:${bossSignature(name, level, 0)}`,
                name,
                level,
                timerText,
                fightersText,
                fightersCount: fightersMatch ? Number(fightersMatch[1]) : 0,
                queuedCount: queuedMatch ? Number(queuedMatch[1]) : 0,
                queuedAt: state.queuedBoss?.name === name && Number(state.queuedBoss?.level || 0) === level
                    ? Number(state.queuedBoss.queuedAt || ts)
                    : ts,
                expectedSpawnAt: countdownMs ? ts + countdownMs : Number(state.queuedBoss?.expectedSpawnAt || 0),
                image: String(banner.querySelector(".wb-banner-art img")?.getAttribute("src") || ""),
                lastSeenAt: ts,
            };
        }

        function expandWorldBossDpsList() {
            const root = document.querySelector(".combat-display.cc-boss-fight");
            if (!root) return false;

            const meter = root.querySelector(".wb-dps-meter");
            if (!meter) return false;

            if (meter.querySelector(".wb-dps-list")) return false;

            const toggle = meter.querySelector(".wb-dps-toggle");
            if (!toggle) return false;

            try {
                toggle.click();
                return true;
            } catch {
                return false;
            }
        }

        function readWorldBossCorpseDom() {
            const corpse = document.querySelector(".wb-corpse-mobcard");
            if (!corpse) return null;

            const rawName = clean(corpse.querySelector(".wb-corpse-mobcard-name")?.textContent || "");
            const name = clean(rawName.replace(/\s*[—-]\s*Corpse\s*$/i, ""));
            if (!name) return null;

            const hpText = clean(corpse.querySelector(".wb-hp-text")?.textContent || "");
            const hp = parseHpText(hpText);
            const hint = clean(corpse.querySelector(".wb-corpse-hint")?.textContent || "");
            const countdownMs = parseCountdownMs(hint);
            const existing = findActiveBoss() || state.history.find((boss) => normalizeName(boss.name) === normalizeName(name));
            const ts = now();

            return {
                name,
                rawName,
                level: Number(existing?.level || 0),
                currentHp: hp.currentHp,
                maxHp: hp.maxHp,
                hpPct: readHpPctFromFill(corpse, ".wb-corpse-fill") || 100,
                hint,
                opensAt: countdownMs ? ts + countdownMs : 0,
                image: String(corpse.querySelector(".wb-corpse-mobcard-img img")?.getAttribute("src") || ""),
                seenAt: ts,
            };
        }

        function readCurrentBossDom() {
            const root = document.querySelector(".combat-display.cc-boss-fight");
            if (!root) return null;

            expandWorldBossDpsList();

            const enemyCard = root.querySelector(".cc-enemy-card");
            const name = clean(enemyCard?.querySelector(".cc-enemy-name")?.textContent || "");
            if (!name) return null;

            const levelText = clean(enemyCard?.querySelector(".cc-lv")?.textContent || "");
            const levelMatch = levelText.match(/(\d+)/);
            const level = levelMatch ? Number(levelMatch[1]) : 0;

            const hpText = clean(enemyCard?.querySelector(".cc-bar-val-enemy")?.textContent || "");
            const hp = parseHpText(hpText);
            const hpPct = readHpPctFromFill(enemyCard || root, ".cc-hp-enemy");

            const fightersText = clean(root.querySelector(".cc-bp-count")?.textContent || "");
            const fightersMatch = fightersText.match(/(\d+)/);
            const fightersCount = fightersMatch ? Number(fightersMatch[1]) : 0;

            const myName = clean(root.querySelector(".cc-boss-you .cc-pm-name")?.textContent || "");
            const myLevel = clean(root.querySelector(".cc-boss-you .cc-pm-lv")?.textContent || "");
            const myAura = clean(root.querySelector(".cc-boss-you .cc-pm-aura")?.textContent || "");
            const myImbue = clean(root.querySelector(".cc-boss-you .cc-pm-imbue")?.textContent || "");

            const participants = [];

            if (myName) {
                participants.push({
                    name: myName,
                    hpPct: readHpPctFromFill(root, ".cc-boss-you .cc-hp-player"),
                    isZerk: !!root.querySelector(".cc-boss-you .cc-pm-zerk"),
                    image: getStyleUrl(root.querySelector(".cc-boss-you .cc-player-img")),
                    isYou: true,
                    level: myLevel,
                    aura: myAura,
                    imbue: myImbue,
                });
            }

            root.querySelectorAll(".cc-bp-card").forEach((card) => {
                const playerName = clean(card.querySelector(".cc-bp-name")?.textContent || "");
                if (!playerName) return;

                participants.push({
                    name: playerName,
                    hpPct: readHpPctFromFill(card, ".cc-bp-hp-fill"),
                    isZerk: card.classList.contains("cc-bp-zerk"),
                    image: getStyleUrl(card.querySelector(".cc-player-img")),
                    isYou: normalizeName(playerName) === normalizeName(myName),
                });
            });

            const leaderboard = [];

            root.querySelectorAll(".wb-dps-list .wb-dps-row").forEach((row) => {
                const rank = clean(row.querySelector(".wb-dps-rank")?.textContent || "");
                const playerName = clean(row.querySelector(".wb-dps-name")?.textContent || "");
                const damageText = clean(row.querySelector(".wb-dps-dmg")?.textContent || "");
                const dpsText = clean(row.querySelector(".wb-dps-val")?.textContent || "");

                if (!playerName) return;

                leaderboard.push({
                    rank,
                    name: playerName,
                    damageText,
                    damage: parseNumberText(damageText),
                    dpsText,
                    dps: parseNumberText(dpsText.replace(/\/s$/i, "")),
                    isYou: row.classList.contains("wb-dps-you") || normalizeName(playerName) === normalizeName(myName),
                });
            });

            const myLeaderboard = leaderboard.find((row) => row.isYou);
            const toggleRank = clean(root.querySelector(".wb-dps-my-rank")?.textContent || "");

            return {
                name,
                level,
                currentHp: hp.currentHp,
                maxHp: hp.maxHp,
                hpPct,
                phase: "combat",
                role: state.role,
                fightersCount: fightersCount || participants.length,
                myName,
                myRank: myLeaderboard?.rank || toggleRank.replace(/\s*—.*$/, ""),
                myDamage: myLeaderboard?.damageText || "",
                myDps: myLeaderboard?.dpsText || "",
                participants,
                leaderboard,
            };
        }

        function getOrCreateActiveBoss(snapshot) {
            const sig = bossSignature(snapshot.name, snapshot.level, snapshot.maxHp);
            const sessionKey = bossSessionKey(snapshot);
            let boss = findActiveBoss();

            if (boss && boss.sessionKey && sessionKey && boss.sessionKey !== sessionKey && boss.signature !== sig) {
                boss.active = false;
                boss.endedAt = boss.endedAt || now();
                boss = null;
            }

            if (!boss) {
                boss =
                    state.history.find((entry) => entry.sessionKey === sessionKey) ||
                    state.history.find((entry) => entry.sourceId && entry.sourceId === clean(snapshot.sourceId || snapshot.worldBossId || snapshot.serverId || "")) ||
                    state.history.find((entry) => entry.active && entry.signature === sig) ||
                    state.history.find((entry) => !entry.endedAt && entry.signature === sig) ||
                    findRecentBossByName(snapshot.name, snapshot.level);

                if (boss) {
                    boss.active = true;
                }
            }

            if (!boss) {
                boss = normalizeBossRecord({
                    id: sessionKey || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    sourceId: clean(snapshot.sourceId || snapshot.worldBossId || snapshot.serverId || ""),
                    sessionKey,
                    signature: sig,
                    name: snapshot.name,
                    level: snapshot.level,
                    maxHp: snapshot.maxHp,
                    currentHp: snapshot.currentHp,
                    hpPct: snapshot.hpPct,
                    queuedAt: state.queuedBoss?.name === snapshot.name && Number(state.queuedBoss?.level || 0) === Number(snapshot.level || 0)
                        ? Number(state.queuedBoss.queuedAt || 0)
                        : 0,
                    expectedSpawnAt: state.queuedBoss?.name === snapshot.name && Number(state.queuedBoss?.level || 0) === Number(snapshot.level || 0)
                        ? Number(state.queuedBoss.expectedSpawnAt || 0)
                        : 0,
                    spawnedAt: now(),
                    firstSeenAt: now(),
                    lastSeenAt: now(),
                    active: true,
                    role: state.role,
                    phase: "combat",
                    participants: [],
                    leaderboard: [],
                    snapshots: [],
                });

                state.history.unshift(boss);
                state.history = state.history.slice(0, MAX_HISTORY);
            }

            state.activeBossId = boss.id;
            state.selectedBossId = state.selectedBossId || boss.id;

            return boss;
        }

        function upsertParticipants(boss, participants) {
            const byName = new Map();

            for (const old of boss.participants || []) {
                if (!old.name) continue;
                byName.set(normalizeName(old.name), normalizeParticipant(old));
            }

            for (const incoming of participants || []) {
                if (!incoming.name) continue;

                const key = normalizeName(incoming.name);
                const existing = byName.get(key);

                byName.set(key, {
                    ...existing,
                    ...normalizeParticipant({
                        ...incoming,
                        firstSeenAt: existing?.firstSeenAt || now(),
                        lastSeenAt: now(),
                    }),
                });
            }

            boss.participants = [...byName.values()].sort((a, b) => {
                if (a.name === boss.myName) return -1;
                if (b.name === boss.myName) return 1;
                return a.name.localeCompare(b.name);
            });
        }

        function updateBossFromSnapshot(snapshot) {
            const boss = getOrCreateActiveBoss(snapshot);

            boss.sourceId = boss.sourceId || clean(snapshot.sourceId || snapshot.worldBossId || snapshot.serverId || "");
            boss.sessionKey = boss.sessionKey || bossSessionKey(snapshot);
            boss.name = snapshot.name;
            boss.level = snapshot.level;
            boss.maxHp = snapshot.maxHp;
            boss.currentHp = snapshot.currentHp;
            boss.hpPct = snapshot.hpPct;
            boss.fightersCount = Math.max(Number(snapshot.fightersCount || 0), Number(boss.fightersCount || 0));
            boss.myName = snapshot.myName || boss.myName || "";
            boss.myRank = snapshot.myRank || boss.myRank || "";
            boss.myDamage = snapshot.myDamage || boss.myDamage || "";
            boss.myDps = snapshot.myDps || boss.myDps || "";
            if (!boss.spawnedAt) boss.spawnedAt = boss.firstSeenAt || now();
            if (state.queuedBoss && state.queuedBoss.name === snapshot.name && Number(state.queuedBoss.level || 0) === Number(snapshot.level || 0)) {
                boss.queuedAt = boss.queuedAt || Number(state.queuedBoss.queuedAt || 0);
                boss.expectedSpawnAt = boss.expectedSpawnAt || Number(state.queuedBoss.expectedSpawnAt || 0);
                state.queuedBoss = null;
            }
            boss.lastSeenAt = now();
            boss.role = state.role;
            boss.phase = "combat";
            boss.active = true;
            boss.endedAt = 0;
            boss.killedAt = 0;

            upsertParticipants(boss, snapshot.participants);

            if (snapshot.leaderboard?.length) {
                boss.leaderboard = snapshot.leaderboard.map(normalizeLeaderboardRow);
            }

            boss.snapshots = [
                ...(boss.snapshots || []),
                {
                    ts: now(),
                    hpPct: snapshot.hpPct,
                    currentHp: snapshot.currentHp,
                    maxHp: snapshot.maxHp,
                    fightersCount: snapshot.fightersCount,
                    leaderboardCount: snapshot.leaderboard?.length || 0,
                    participantCount: snapshot.participants?.length || 0,
                },
            ].slice(-30);

            saveHistory();
        }

        function updateBossFromCorpse(corpse) {
            let boss = findActiveBoss();

            if (!boss || normalizeName(boss.name) !== normalizeName(corpse.name)) {
                boss = findRecentBossByName(corpse.name, corpse.level);
            }

            if (!boss) {
                const sessionKey = bossSessionKey(corpse);

                boss = normalizeBossRecord({
                    id: sessionKey || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    sessionKey,
                    signature: bossSignature(corpse.name, corpse.level, corpse.maxHp),
                    name: corpse.name,
                    level: corpse.level,
                    maxHp: corpse.maxHp,
                    currentHp: corpse.currentHp,
                    hpPct: corpse.hpPct,
                    spawnedAt: now(),
                    firstSeenAt: now(),
                    corpseAt: now(),
                    gatheringStartedAt: state.role === "gathering" ? now() : 0,
                    role: state.role,
                    phase: state.role === "gathering" ? "gathering" : "corpse",
                    active: state.role === "gathering",
                    participants: [],
                    leaderboard: [],
                    snapshots: [],
                });

                state.history.unshift(boss);
                state.history = state.history.slice(0, MAX_HISTORY);
            }

            boss.name = corpse.name;
            boss.level = boss.level || corpse.level || 0;
            boss.currentHp = corpse.currentHp || boss.currentHp || 0;
            boss.maxHp = corpse.maxHp || boss.maxHp || 0;
            boss.hpPct = corpse.hpPct || boss.hpPct || 100;
            boss.corpseAt = boss.corpseAt || now();
            boss.lastSeenAt = now();
            boss.role = state.role;

            if (state.role === "fighting") {
                boss.phase = "corpse";
                boss.active = false;
                boss.endedAt = boss.endedAt || boss.corpseAt;
                boss.killedAt = boss.killedAt || boss.corpseAt;
                state.activeBossId = "";
            } else {
                boss.phase = "gathering";
                boss.active = true;
                boss.gatheringStartedAt = boss.gatheringStartedAt || boss.corpseAt;
                boss.spawnedAt = boss.spawnedAt || boss.corpseAt;
                boss.firstSeenAt = boss.firstSeenAt || boss.corpseAt;
                boss.endedAt = 0;
                state.activeBossId = boss.id;
                state.selectedBossId = state.selectedBossId || boss.id;
            }

            boss.snapshots = [
                ...(boss.snapshots || []),
                {
                    ts: now(),
                    phase: boss.phase,
                    currentHp: boss.currentHp,
                    maxHp: boss.maxHp,
                    hpPct: boss.hpPct,
                    corpseHint: corpse.hint || "",
                },
            ].slice(-30);

            dedupeBossHistory();
            saveHistory();
            return boss;
        }

        function markNoActiveBoss() {
            const boss = findActiveBoss();
            if (!boss) return false;

            if (now() - Number(boss.lastSeenAt || 0) < 4500) {
                return false;
            }

            boss.active = false;
            boss.endedAt = boss.endedAt || Number(boss.lastSeenAt || now());

            if (boss.phase === "combat" || boss.role === "fighting") {
                boss.killedAt = boss.killedAt || boss.endedAt;
            }

            if (boss.phase === "gathering") {
                boss.phase = "ended";
            }

            state.activeBossId = "";
            saveHistory();

            return true;
        }


        function worldBossPhaseFromPayload(wb) {
            const phase = clean(wb.phase || "").toLowerCase();
            const ts = now();

            if (phase === "queuing" || wb.queued || Number(wb.fightStartsAt || 0) > ts) return "queue";
            if (phase === "corpse" || Number(wb.corpseEndsAt || 0) > ts || Number(wb.corpseMaxHp || 0) > 0) return state.role === "gathering" ? "gathering" : "corpse";
            if (phase === "fighting" || phase === "fight" || Number(wb.hp || 0) > 0) return "combat";
            if (phase === "dead" || phase === "ended") return "ended";

            return phase || "seen";
        }

        function updateBossFromWorldBossPayload(wb) {
            const phase = worldBossPhaseFromPayload(wb);
            const ts = now();
            const payload = {
                id: clean(wb.id || ""),
                sourceId: clean(wb.id || ""),
                worldBossId: clean(wb.id || ""),
                serverId: clean(wb.id || ""),
                sessionKey: bossSessionKey({
                    sourceId: wb.id,
                    name: wb.name,
                    level: wb.level,
                    maxHp: wb.maxHp,
                    fightStartsAt: wb.fightStartsAt,
                    expectedSpawnAt: wb.fightStartsAt,
                }),
                signature: bossSignature(wb.name, wb.level, wb.maxHp),
                name: clean(wb.name || "World Boss"),
                level: Number(wb.level || 0),
                maxHp: Number(wb.maxHp || 0),
                currentHp: Number(wb.hp || 0),
                hpPct: Number(wb.maxHp || 0) ? (Number(wb.hp || 0) / Number(wb.maxHp || 1)) * 100 : 0,
                queuedAt: phase === "queue" ? ts : 0,
                expectedSpawnAt: Number(wb.fightStartsAt || 0),
                spawnedAt: phase === "combat" ? Number(wb.fightStartsAt || ts) : 0,
                firstSeenAt: ts,
                lastSeenAt: ts,
                corpseAt: phase === "corpse" || phase === "gathering" ? ts : 0,
                endedAt: phase === "ended" || (phase === "corpse" && state.role === "fighting") ? ts : 0,
                killedAt: phase === "ended" || (phase === "corpse" && state.role === "fighting") ? ts : 0,
                role: state.role,
                phase,
                active: phase === "combat" || phase === "gathering",
                fightersCount: Number(wb.combatCount || 0),
                participants: Array.isArray(wb.participants)
                    ? wb.participants.map((p) => ({
                        name: clean(p.username || p.name || ""),
                        hpPct: Number(p.maxHp || 0) ? (Number(p.hp || 0) / Number(p.maxHp || 1)) * 100 : 0,
                        firstSeenAt: ts,
                        lastSeenAt: ts,
                        isZerk: p.zerkActive === true,
                    })).filter((p) => p.name)
                    : [],
                leaderboard: Array.isArray(wb.participants)
                    ? wb.participants
                        .filter((p) => clean(p.username || p.name || "") && Number(p.damage || p.contribution || 0) > 0)
                        .sort((a, b) => Number(b.damage || b.contribution || 0) - Number(a.damage || a.contribution || 0))
                        .map((p, index) => ({
                            rank: `#${index + 1}`,
                            name: clean(p.username || p.name || ""),
                            damage: Number(p.damage || p.contribution || 0),
                            damageText: formatCompactNumber(Number(p.damage || p.contribution || 0)),
                            dps: 0,
                            dpsText: "",
                        }))
                    : [],
                snapshots: [{
                    ts,
                    phase,
                    currentHp: Number(wb.hp || 0),
                    maxHp: Number(wb.maxHp || 0),
                    hpPct: Number(wb.maxHp || 0) ? (Number(wb.hp || 0) / Number(wb.maxHp || 1)) * 100 : 0,
                    queueCount: Number(wb.queueCount || 0),
                    participantCount: Number(wb.participantCount || 0),
                    combatCount: Number(wb.combatCount || 0),
                    lifeskillCount: Number(wb.lifeskillCount || 0),
                }],
            };

            if (phase === "queue") {
                state.queuedBoss = {
                    id: payload.id,
                    sourceId: payload.sourceId,
                    sessionKey: payload.sessionKey,
                    name: payload.name,
                    level: payload.level,
                    queuedAt: payload.queuedAt,
                    expectedSpawnAt: payload.expectedSpawnAt,
                    fightersCount: Number(wb.combatCount || 0),
                    queuedCount: Number(wb.queueCount || 0),
                    timerText: payload.expectedSpawnAt ? `Fight in ${formatDuration(payload.expectedSpawnAt - ts)}` : "Queued",
                    fightersText: `⚔ ${Number(wb.combatCount || 0)} · 🌾 ${Number(wb.lifeskillCount || 0)} queued`,
                    lastSeenAt: ts,
                };

                return true;
            }

            let boss =
                state.history.find((entry) => entry.sessionKey === payload.sessionKey) ||
                state.history.find((entry) => entry.sourceId && entry.sourceId === payload.sourceId) ||
                findRecentBossByName(payload.name, payload.level);

            if (!boss) {
                boss = normalizeBossRecord(payload);
                state.history.unshift(boss);
            } else {
                const merged = mergeBossRecord(boss, payload);
                Object.assign(boss, merged);
            }

            if (phase === "combat") {
                boss.active = true;
                boss.endedAt = 0;
                boss.killedAt = 0;
                state.activeBossId = boss.id;
                state.selectedBossId = state.selectedBossId || boss.id;
            }

            if (phase === "corpse" && state.role === "fighting") {
                boss.active = false;
                boss.endedAt = boss.endedAt || boss.corpseAt || ts;
                boss.killedAt = boss.killedAt || boss.endedAt;
                state.activeBossId = "";
            }

            if (phase === "gathering") {
                boss.active = true;
                state.activeBossId = boss.id;
                state.selectedBossId = state.selectedBossId || boss.id;
            }

            dedupeBossHistory();
            saveHistory();

            return true;
        }

        function scanBossDom() {
            const corpse = readWorldBossCorpseDom();
            const previousCorpseKey = state.corpse
                ? `${state.corpse.name}|${state.corpse.hint}|${state.corpse.currentHp}|${state.corpse.maxHp}`
                : "";

            state.corpse = corpse;

            if (corpse) {
                updateBossFromCorpse(corpse);

                const corpseKey = `${corpse.name}|${corpse.hint}|${corpse.currentHp}|${corpse.maxHp}`;
                return previousCorpseKey !== corpseKey;
            }

            const snapshot = readCurrentBossDom();

            if (snapshot) {
                const hadQueue = !!state.queuedBoss;

                if (state.role === "gathering") {
                    state.queuedBoss = null;
                    return hadQueue;
                }

                updateBossFromSnapshot(snapshot);
                return hadQueue || previousCorpseKey !== "";
            }

            const queued = readWorldBossQueueBanner();
            const previousQueueKey = state.queuedBoss
                ? `${state.queuedBoss.name}|${state.queuedBoss.level}|${state.queuedBoss.timerText}|${state.queuedBoss.fightersText}`
                : "";

            state.queuedBoss = queued;

            const queueKey = queued
                ? `${queued.name}|${queued.level}|${queued.timerText}|${queued.fightersText}`
                : "";

            const ended = markNoActiveBoss();

            return ended || previousQueueKey !== queueKey || previousCorpseKey !== "";
        }

        function renderStyles() {
            return `
                <style>
                    .bt-wrap {
                        color:#e5e7eb;
                        font-family:Arial,sans-serif;
                        font-size:12px;
                    }

                    .bt-top {
                        display:flex;
                        align-items:flex-start;
                        justify-content:space-between;
                        gap:10px;
                        padding:10px;
                        border-radius:10px;
                        background:rgba(255,255,255,0.045);
                        border:1px solid rgba(255,255,255,0.08);
                        margin-bottom:10px;
                    }

                    .bt-title {
                        font-size:14px;
                        font-weight:900;
                        margin-bottom:3px;
                    }

                    .bt-muted {
                        color:rgba(229,231,235,0.58);
                    }

                    .bt-good {
                        color:#4ade80;
                        font-weight:800;
                    }

                    .bt-warn {
                        color:#fbbf24;
                        font-weight:800;
                    }

                    .bt-bad {
                        color:#fb7185;
                        font-weight:800;
                    }

                    .bt-tabs {
                        display:flex;
                        gap:6px;
                        overflow-x:auto;
                        margin-bottom:10px;
                    }

                    .bt-tab {
                        background:rgba(255,255,255,0.08);
                        color:#e5e7eb;
                        border:1px solid rgba(255,255,255,0.14);
                        border-radius:7px;
                        padding:4px 8px;
                        font-size:11px;
                        cursor:pointer;
                    }

                    .bt-tab.active {
                        background:rgba(56,189,248,0.24);
                        border-color:rgba(56,189,248,0.55);
                    }

                    .bt-grid {
                        display:grid;
                        grid-template-columns:repeat(4,1fr);
                        gap:8px;
                        margin-bottom:10px;
                    }

                    .bt-card,
                    .bt-section {
                        background:rgba(255,255,255,0.045);
                        border:1px solid rgba(255,255,255,0.08);
                        border-radius:10px;
                        padding:9px;
                    }

                    .bt-card-label {
                        color:rgba(229,231,235,0.58);
                        font-size:10px;
                        margin-bottom:3px;
                    }

                    .bt-card-value {
                        font-size:15px;
                        font-weight:900;
                    }

                    .bt-section {
                        margin-top:10px;
                    }

                    .bt-section-title {
                        font-weight:900;
                        margin-bottom:7px;
                    }

                    .bt-actions {
                        display:flex;
                        gap:6px;
                        flex-wrap:wrap;
                        justify-content:flex-end;
                    }

                    .bt-table {
                        width:100%;
                        border-collapse:collapse;
                    }

                    .bt-table th,
                    .bt-table td {
                        padding:5px 6px;
                        border-bottom:1px solid rgba(255,255,255,0.07);
                        text-align:right;
                        white-space:nowrap;
                    }

                    .bt-table th:first-child,
                    .bt-table td:first-child {
                        text-align:left;
                    }

                    .bt-table th {
                        color:rgba(229,231,235,0.65);
                        background:rgba(8,10,15,0.72);
                        position:sticky;
                        top:0;
                    }

                    .bt-scroll {
                        max-height:280px;
                        overflow:auto;
                        border:1px solid rgba(255,255,255,0.08);
                        border-radius:8px;
                    }

                    .bt-row-btn {
                        width:100%;
                        text-align:left;
                        background:rgba(255,255,255,0.04);
                        color:#e5e7eb;
                        border:1px solid rgba(255,255,255,0.08);
                        border-radius:8px;
                        padding:8px;
                        margin-bottom:6px;
                        cursor:pointer;
                    }

                    .bt-row-btn:hover,
                    .bt-row-btn.active {
                        border-color:rgba(56,189,248,0.55);
                        background:rgba(56,189,248,0.10);
                    }

                    .bt-pill {
                        display:inline-block;
                        padding:2px 6px;
                        border-radius:999px;
                        background:rgba(255,255,255,0.08);
                        border:1px solid rgba(255,255,255,0.12);
                        font-size:10px;
                        margin:2px 4px 2px 0;
                    }

                    .bt-hp {
                        height:8px;
                        border-radius:999px;
                        background:rgba(255,255,255,0.10);
                        overflow:hidden;
                        margin-top:4px;
                    }

                    .bt-hp > div {
                        height:100%;
                        background:#fb7185;
                    }

                    .bt-role-row {
                        display:flex;
                        align-items:center;
                        gap:6px;
                        margin-top:8px;
                        flex-wrap:wrap;
                    }

                    .bt-select {
                        background:rgba(0,0,0,0.25);
                        color:#e5e7eb;
                        border:1px solid rgba(255,255,255,0.14);
                        border-radius:7px;
                        padding:4px 7px;
                        font-size:11px;
                        outline:none;
                    }

                    .bt-pre {
                        white-space:pre-wrap;
                        color:rgba(229,231,235,0.82);
                        font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                        font-size:11px;
                        line-height:1.35;
                        max-height:220px;
                        overflow:auto;
                        background:rgba(0,0,0,0.20);
                        border-radius:8px;
                        padding:8px;
                    }

                    @media (max-width: 700px) {
                        .bt-grid {
                            grid-template-columns:repeat(2,1fr);
                        }
                    }
                </style>
            `;
        }

        function card(label, value, cls = "") {
            return `
                <div class="bt-card">
                    <div class="bt-card-label">${escapeHtml(label)}</div>
                    <div class="bt-card-value ${cls}">${escapeHtml(value)}</div>
                </div>
            `;
        }

        function render() {
            return `
                ${renderStyles()}

                <div class="bt-wrap">
                    <div class="bt-top">
                        <div>
                            <div class="bt-title">👑 Boss Tracker</div>
                            <div class="bt-muted">Stores world boss participants and DPS leaderboard history locally.</div>
                            <div class="bt-role-row">
                                <span class="bt-muted">Mode:</span>
                                <b class="bt-good">Auto — queue, fight, corpse</b>
                            </div>
                            <div style="margin-top:5px;color:${escapeHtml(state.messageColor)};font-weight:800;">${escapeHtml(state.message)}</div>
                        </div>
                        <div class="bt-actions">
                            <button type="button" class="vim-btn" data-bt-scan>Scan Now</button>
                            <button type="button" class="vim-btn vim-btn-primary" data-bt-copy>Copy Selected / Checked</button>
                            <button type="button" class="vim-btn" data-bt-clear>Clear History</button>
                        </div>
                    </div>

                    <div class="bt-tabs">
                        ${tabButton("active", "Active")}
                        ${tabButton("history", `History (${state.history.length})`)}
                        ${tabButton("detail", "Selected")}
                    </div>

                    ${state.activeTab === "active" ? renderActiveTab() : ""}
                    ${state.activeTab === "history" ? renderHistoryTab() : ""}
                    ${state.activeTab === "detail" ? renderDetailTab() : ""}
                </div>
            `;
        }

        function tabButton(id, label) {
            return `<button type="button" class="bt-tab ${state.activeTab === id ? "active" : ""}" data-bt-tab="${id}">${escapeHtml(label)}</button>`;
        }

        function renderActiveTab() {
            const boss = findActiveBoss();

            if (!boss) {
                if (state.corpse) {
                    return renderCorpseStatus(state.corpse) + (state.history.length ? renderRecentHistory() : "");
                }

                if (state.queuedBoss) {
                    return renderQueuedBoss(state.queuedBoss) + (state.history.length ? renderRecentHistory() : "");
                }

                return `
                    <div class="bt-section">
                        <div class="bt-section-title">No active boss detected</div>
                        <div class="bt-muted">
                            Open or join a world boss fight. The tracker scans <code>.combat-display.cc-boss-fight</code>,
                            stores fighters, and updates the leaderboard when the DPS list is visible. Current mode: <b>${escapeHtml(roleLabel())}</b>.
                        </div>
                    </div>
                    ${state.history.length ? renderRecentHistory() : ""}
                `;
            }

            return renderBossSummary(boss) + renderBossDetail(boss, { compact: true });
        }

        function renderCorpseStatus(corpse) {
            const opensIn = corpse.opensAt
                ? formatDuration(Math.max(0, corpse.opensAt - now()))
                : "—";

            return `
                <div class="bt-section" style="margin-top:0;">
                    <div class="bt-section-title">Corpse Detected</div>
                    <div class="bt-grid">
                        ${card("Corpse", corpse.name, "bt-warn")}
                        ${card("Mode", roleLabel(), state.role === "gathering" ? "bt-good" : "bt-warn")}
                        ${card("Opens In", opensIn, "bt-warn")}
                        ${card("Seen", formatTime(corpse.seenAt))}
                        ${card("Corpse HP", `${formatCompactNumber(corpse.currentHp)} / ${formatCompactNumber(corpse.maxHp)}`)}
                        ${card("Phase", state.role === "gathering" ? "Gathering started" : "Fight ended")}
                    </div>
                    <div class="bt-muted">
                        ${state.role === "gathering"
                            ? "Gathering mode treats the corpse as the start of your tracked boss session."
                            : "Fighting mode treats the corpse as the end / kill time of the boss fight."
                        }
                    </div>
                </div>
            `;
        }

        function renderQueuedBoss(queue) {
            const untilText = queue.expectedSpawnAt
                ? formatDuration(Math.max(0, queue.expectedSpawnAt - now()))
                : "—";

            return `
                <div class="bt-section" style="margin-top:0;">
                    <div class="bt-section-title">Queued World Boss</div>
                    <div class="bt-grid">
                        ${card("Queued Boss", `${queue.name}${queue.level ? ` Lv ${queue.level}` : ""}`, "bt-warn")}
                        ${card("Fight Starts", queue.timerText || untilText, "bt-warn")}
                        ${card("Expected Spawn", queue.expectedSpawnAt ? formatDateTime(queue.expectedSpawnAt) : "—")}
                        ${card("Queued", String(queue.queuedCount || 0))}
                        ${card("Fighters", String(queue.fightersCount || 0))}
                        ${card("Queued Since", formatTime(queue.queuedAt))}
                        ${card("Last Seen", formatTime(queue.lastSeenAt))}
                        ${card("History", `${state.history.length} saved`)}
                    </div>
                    <div class="bt-muted">
                        The fight has not started yet. Once the combat screen appears, Boss Tracker will create or update the boss history entry and use the combat start as the spawned time.
                    </div>
                </div>
            `;
        }

        function renderRecentHistory() {
            return `
                <div class="bt-section">
                    <div class="bt-section-title">Recent Bosses</div>
                    ${state.history.slice(0, 5).map(renderHistoryButton).join("")}
                </div>
            `;
        }

        function renderHistoryTab() {
            if (!state.history.length) {
                return `<div class="bt-muted">No boss history yet.</div>`;
            }

            return `
                <div class="bt-section" style="margin-top:0;">
                    <div class="bt-section-title">Boss History</div>
                    ${state.history.map(renderHistoryButton).join("")}
                </div>
            `;
        }

        function renderHistoryButton(boss) {
            const active = boss.id === state.selectedBossId;
            const status = boss.active ? "Live" : boss.endedAt ? "Ended" : "Seen";
            const duration = formatDuration((boss.endedAt || boss.lastSeenAt || now()) - boss.firstSeenAt);

            return `
                <button type="button" class="bt-row-btn ${active ? "active" : ""}" data-bt-select="${escapeHtml(boss.id)}">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                        <b>${escapeHtml(boss.name)} ${boss.level ? `Lv ${boss.level}` : ""}</b>
                        <span class="${boss.active ? "bt-good" : "bt-muted"}">${escapeHtml(status)}</span>
                    </div>
                    <div class="bt-muted">
                        ${escapeHtml(roleLabel(boss.role))} · ${escapeHtml(phaseLabel(boss.phase))} · Spawned ${escapeHtml(formatDateTime(boss.spawnedAt || boss.firstSeenAt))}${boss.corpseAt ? ` · Corpse ${escapeHtml(formatDateTime(boss.corpseAt))}` : ""}${boss.killedAt ? ` · Killed ${escapeHtml(formatDateTime(boss.killedAt))}` : ""} · ${escapeHtml(duration)} ·
                        ${Number(boss.fightersCount || boss.participants.length || 0)} fighters ·
                        ${boss.leaderboard.length} leaderboard rows
                    </div>
                </button>
            `;
        }

        function renderDetailTab() {
            const boss = findSelectedBoss();

            if (!boss) {
                return `<div class="bt-muted">Select a boss from history.</div>`;
            }

            return renderBossSummary(boss) + renderBossDetail(boss);
        }

        function renderBossSummary(boss) {
            rebuildBossLeaderboards(boss);
            const duration = formatDuration((boss.endedAt || boss.lastSeenAt || now()) - (boss.spawnedAt || boss.firstSeenAt));
            const fighters = Number(boss.fightersCount || boss.participants.length || 0);
            const timeLeft = Number(boss.timeLeftMs || 0) > 0 ? formatDuration(Number(boss.timeLeftMs || 0)) : "—";

            return `
                <div class="bt-grid">
                    ${card("Boss", `${boss.name}${boss.level ? ` Lv ${boss.level}` : ""}`, boss.active ? "bt-good" : "")}
                    ${card("Mode", roleLabel(boss.role), boss.role === "gathering" ? "bt-good" : "")}
                    ${card("Phase", phaseLabel(boss.phase), boss.phase === "gathering" ? "bt-good" : boss.phase === "corpse" ? "bt-warn" : "")}
                    ${card("HP", `${Number(boss.hpPct || 0).toFixed(1)}%`)}
                    ${card("Fighters", String(fighters))}
                    ${card("Fight Time", duration)}
                    ${card("Time Left", timeLeft)}
                    ${card("Spawned", formatDateTime(boss.spawnedAt || boss.firstSeenAt))}
                    ${card("Corpse", boss.corpseAt ? formatDateTime(boss.corpseAt) : "—")}
                    ${card("Killed", boss.killedAt || boss.endedAt ? formatDateTime(boss.killedAt || boss.endedAt) : "—")}
                    ${card("Your Rank", boss.myRank || "—", boss.myRank ? "bt-warn" : "")}
                    ${card("Your DPS", boss.myDps || "—", boss.myDps ? "bt-good" : "")}
                </div>

                <div class="bt-section">
                    <div class="bt-section-title">Boss HP</div>
                    <div><b>${escapeHtml(formatCompactNumber(boss.currentHp))}</b> / ${escapeHtml(formatCompactNumber(boss.maxHp))}</div>
                    <div class="bt-hp"><div style="width:${Math.max(0, Math.min(100, Number(boss.hpPct || 0)))}%;"></div></div>
                </div>
            `;
        }

        function renderBossDetail(boss, options = {}) {
            return `
                ${renderLeaderboard(boss, options)}
                ${renderParticipants(boss, options)}
            `;
        }

        function renderLeaderboard(boss, options = {}) {
            if (!boss.leaderboard.length) {
                return `
                    <div class="bt-section">
                        <div class="bt-section-title">Leaderboard</div>
                        <div class="bt-muted">No leaderboard captured yet. Expand the in-game DPS list during the boss fight to record it.</div>
                    </div>
                `;
            }

            const rows = options.compact ? boss.leaderboard.slice(0, 20) : boss.leaderboard;

            return `
                <div class="bt-section">
                    <div class="bt-section-title">Leaderboard ${options.compact && boss.leaderboard.length > rows.length ? `(Top ${rows.length}/${boss.leaderboard.length})` : `(${boss.leaderboard.length})`}</div>
                    <div class="bt-scroll">
                        <table class="bt-table">
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Name</th>
                                    <th>Damage</th>
                                    <th>DPS</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map((row) => `
                                    <tr class="${row.isYou ? "bt-good" : ""}">
                                        <td>${escapeHtml(row.rank)}</td>
                                        <td>${escapeHtml(row.name)}</td>
                                        <td>${escapeHtml(row.damageText || formatCompactNumber(row.damage))}</td>
                                        <td>${escapeHtml(row.dpsText)}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        function renderParticipants(boss, options = {}) {
            const participants = options.compact ? boss.participants.slice(0, 80) : boss.participants;

            return `
                <div class="bt-section">
                    <div class="bt-section-title">Joined Fighters (${boss.participants.length})</div>
                    ${
                        participants.length
                            ? participants.map((player) => `
                                <span class="bt-pill" title="First seen ${escapeHtml(formatTime(player.firstSeenAt))} · Last seen ${escapeHtml(formatTime(player.lastSeenAt))}">
                                    ${player.isZerk ? "🔥 " : ""}${escapeHtml(player.name)}${player.hpPct ? ` · ${Number(player.hpPct).toFixed(0)}%` : ""}
                                </span>
                            `).join("")
                            : `<div class="bt-muted">No fighters captured yet.</div>`
                    }
                </div>
            `;
        }

        function bossToText(boss) {
            if (!boss) return "No boss selected.";

            const lines = [];

            lines.push(`Boss: ${boss.name}${boss.level ? ` Lv ${boss.level}` : ""}`);
            lines.push(`Mode: ${roleLabel(boss.role)}`);
            lines.push(`Phase: ${phaseLabel(boss.phase)}`);
            lines.push(`Spawned: ${formatDateTime(boss.spawnedAt || boss.firstSeenAt)}`);
            if (boss.corpseAt) lines.push(`Corpse: ${formatDateTime(boss.corpseAt)}`);
            if (boss.gatheringStartedAt) lines.push(`Gathering started: ${formatDateTime(boss.gatheringStartedAt)}`);
            lines.push(`Killed: ${boss.killedAt || boss.endedAt ? formatDateTime(boss.killedAt || boss.endedAt) : "active"}`);
            if (boss.queuedAt) lines.push(`Queued first seen: ${formatDateTime(boss.queuedAt)}`);
            if (boss.expectedSpawnAt) lines.push(`Expected spawn from queue: ${formatDateTime(boss.expectedSpawnAt)}`);
            lines.push(`Duration: ${formatDuration((boss.killedAt || boss.endedAt || boss.lastSeenAt || now()) - (boss.spawnedAt || boss.firstSeenAt))}`);
            lines.push(`HP: ${formatCompactNumber(boss.currentHp)} / ${formatCompactNumber(boss.maxHp)} (${Number(boss.hpPct || 0).toFixed(1)}%)`);
            lines.push(`Fighters: ${boss.fightersCount || boss.participants.length}`);
            if (boss.myName) lines.push(`You: ${boss.myName}${boss.myRank ? ` ${boss.myRank}` : ""}${boss.myDamage ? ` — ${boss.myDamage}` : ""}${boss.myDps ? ` (${boss.myDps})` : ""}`);

            lines.push("");
            lines.push("Leaderboard:");
            if (boss.leaderboard.length) {
                for (const row of boss.leaderboard) {
                    lines.push(`${row.rank || ""} ${row.name}: ${row.damageText || formatCompactNumber(row.damage)} ${row.dpsText ? `(${row.dpsText})` : ""}`.trim());
                }
            } else {
                lines.push("No leaderboard captured.");
            }

            lines.push("");
            lines.push("Joined Fighters:");
            if (boss.participants.length) {
                lines.push(boss.participants.map((player) => player.name).join(", "));
            } else {
                lines.push("No fighters captured.");
            }

            return lines.join("\n");
        }

        async function copySelectedBoss(app) {
            const boss = findSelectedBoss();

            try {
                await navigator.clipboard.writeText(bossToText(boss));
                state.lastExportAt = now();
                showMessage(app, "Copied selected boss.", "#69f0ae");
            } catch {
                console.log(bossToText(boss));
                alert("Could not copy automatically. Boss text was printed to console.");
            }
        }


        /******************************************************************
         * WORLD BOSS AUTO WS TRACKER — fight + corpse in one record
         ******************************************************************/

        function roleLabel(role = "auto") {
            const raw = clean(role).toLowerCase();
            if (!raw || raw === "auto") return "Auto";
            if (raw === "lifeskill") return "Lifeskill";
            if (raw === "combat") return "Fighter";
            if (raw === "gathering") return "Gathering";
            if (raw === "fighting") return "Fighting";
            return raw.replace(/\b\w/g, (c) => c.toUpperCase());
        }

        function wsRole(role, damage = 0, corpseDamage = 0) {
            const raw = clean(role).toLowerCase();
            if (raw === "lifeskill" || raw === "gathering") return "lifeskill";
            if (raw === "combat" || raw === "fighter" || raw === "fighting") return "combat";
            if (Number(corpseDamage || 0) > 0) return "lifeskill";
            if (Number(damage || 0) > 0) return "combat";
            return raw || "combat";
        }

        function participantKey(player) {
            return clean(player.playerId || "") || normalizeName(player.name || "");
        }

        function normalizeParticipant(participant) {
            const damage = Number(participant.damage || 0);
            const corpseDamage = Number(participant.corpseDamage || participant.harvestDamage || 0);
            return {
                playerId: clean(participant.playerId || participant.id || ""),
                name: clean(participant.name || participant.username || ""),
                level: Number(participant.level || 0),
                firstSeenAt: Number(participant.firstSeenAt || participant.joinedAt || now()),
                lastSeenAt: Number(participant.lastSeenAt || participant.lastAttackAt || participant.lastHarvestAt || now()),
                hpPct: Number(participant.hpPct || (Number(participant.maxHp || 0) ? (Number(participant.hp || 0) / Number(participant.maxHp || 1)) * 100 : 0)),
                hp: Number(participant.hp || 0),
                maxHp: Number(participant.maxHp || 0),
                isZerk: participant.isZerk === true || participant.zerkActive === true,
                image: String(participant.image || ""),
                role: wsRole(participant.role, damage, corpseDamage),
                damage,
                corpseDamage,
                contribution: Number(participant.contribution || 0),
                lastDmgTaken: Number(participant.lastDmgTaken || 0),
                lastDmgToBoss: Number(participant.lastDmgToBoss || 0),
                lastAttackAt: Number(participant.lastAttackAt || 0),
                attackSpeed: Number(participant.attackSpeed || 0),
                recovering: participant.recovering === true,
                lastHit: participant.lastHit === true,
                lastCrit: participant.lastCrit === true,
                lastHarvestAt: Number(participant.lastHarvestAt || 0),
                harvestTickMs: Number(participant.harvestTickMs || 0),
                isYou: participant.isYou === true,
            };
        }

        function normalizeLeaderboardRow(row) {
            return {
                rank: clean(row.rank || ""),
                name: clean(row.name || row.username || ""),
                playerId: clean(row.playerId || ""),
                damageText: clean(row.damageText || ""),
                damage: Number(row.damage || parseNumberText(row.damageText) || 0),
                corpseDamageText: clean(row.corpseDamageText || ""),
                corpseDamage: Number(row.corpseDamage || parseNumberText(row.corpseDamageText) || 0),
                contribution: Number(row.contribution || 0),
                dpsText: clean(row.dpsText || ""),
                dps: Number(row.dps || parseNumberText(String(row.dpsText || "").replace(/\/s$/i, "")) || 0),
                role: wsRole(row.role, row.damage, row.corpseDamage),
                isYou: row.isYou === true,
            };
        }

        function normalizeBossRecord(boss) {
            const record = {
                id: String(boss.id || boss.sourceId || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
                sourceId: clean(boss.sourceId || boss.worldBossId || boss.serverId || ""),
                sessionKey: clean(boss.sessionKey || bossSessionKey(boss)),
                signature: String(boss.signature || bossSignature(boss.name, boss.level, boss.maxHp)),
                name: clean(boss.name || "Unknown Boss"),
                level: Number(boss.level || 0),
                maxHp: Number(boss.maxHp || 0),
                currentHp: Number(boss.currentHp || 0),
                hpPct: Number(boss.hpPct || 0),
                corpseHp: Number(boss.corpseHp || boss.currentHp || 0),
                corpseMaxHp: Number(boss.corpseMaxHp || 0),
                corpseEndsAt: Number(boss.corpseEndsAt || 0),
                queuedAt: Number(boss.queuedAt || 0),
                expectedSpawnAt: Number(boss.expectedSpawnAt || 0),
                spawnedAt: Number(boss.spawnedAt || boss.firstSeenAt || now()),
                firstSeenAt: Number(boss.firstSeenAt || boss.spawnedAt || now()),
                lastSeenAt: Number(boss.lastSeenAt || now()),
                endedAt: Number(boss.endedAt || boss.killedAt || 0),
                killedAt: Number(boss.killedAt || boss.endedAt || 0),
                corpseAt: Number(boss.corpseAt || 0),
                gatheringStartedAt: Number(boss.gatheringStartedAt || 0),
                role: clean(boss.role || "auto"),
                phase: clean(boss.phase || (boss.active ? "combat" : "ended")),
                active: boss.active === true,
                fightersCount: Number(boss.fightersCount || 0),
                lifeskillCount: Number(boss.lifeskillCount || 0),
                participantCount: Number(boss.participantCount || 0),
                myName: clean(boss.myName || ""),
                myRank: clean(boss.myRank || ""),
                myDamage: clean(boss.myDamage || ""),
                myDps: clean(boss.myDps || ""),
                participants: Array.isArray(boss.participants) ? boss.participants.map(normalizeParticipant).filter((p) => p.name) : [],
                leaderboard: Array.isArray(boss.leaderboard) ? boss.leaderboard.map(normalizeLeaderboardRow).filter((p) => p.name) : [],
                lifeskillLeaderboard: Array.isArray(boss.lifeskillLeaderboard) ? boss.lifeskillLeaderboard.map(normalizeLeaderboardRow).filter((p) => p.name) : [],
                snapshots: Array.isArray(boss.snapshots) ? boss.snapshots.slice(-30) : [],
            };
            rebuildBossLeaderboards(record);
            return record;
        }

        function upsertParticipants(boss, participants, options = {}) {
            const byKey = new Map();
            for (const old of boss.participants || []) {
                const n = normalizeParticipant(old);
                const k = participantKey(n);
                if (k) byKey.set(k, n);
            }
            for (const raw of participants || []) {
                const n = normalizeParticipant(raw);
                const k = participantKey(n);
                if (!k) continue;
                const old = byKey.get(k);
                if (!old) {
                    byKey.set(k, n);
                    continue;
                }

                const merged = {
                    ...old,
                    ...n,
                    name: n.name || old.name,
                    playerId: n.playerId || old.playerId,
                    level: Math.max(Number(old.level || 0), Number(n.level || 0)),
                    firstSeenAt: Math.min(Number(old.firstSeenAt || now()), Number(n.firstSeenAt || now())),
                    lastSeenAt: Math.max(Number(old.lastSeenAt || 0), Number(n.lastSeenAt || 0)),
                    contribution: Math.max(Number(old.contribution || 0), Number(n.contribution || 0)),
                    isZerk: old.isZerk || n.isZerk,
                    isYou: old.isYou || n.isYou,
                };

                if (options.authoritativeDamage) merged.damage = Number(n.damage || 0);
                else if (options.addDamage) merged.damage = Number(old.damage || 0) + Number(n.damage || 0);
                else merged.damage = Math.max(Number(old.damage || 0), Number(n.damage || 0));

                if (options.authoritativeCorpseDamage) merged.corpseDamage = Number(n.corpseDamage || 0);
                else if (options.addCorpseDamage) merged.corpseDamage = Number(old.corpseDamage || 0) + Number(n.corpseDamage || 0);
                else merged.corpseDamage = Math.max(Number(old.corpseDamage || 0), Number(n.corpseDamage || 0));

                byKey.set(k, merged);
            }
            boss.participants = [...byKey.values()];
        }

        function bossElapsedSeconds(boss) {
            const started = Number(boss.spawnedAt || boss.firstSeenAt || 0);
            const ended = Number(boss.killedAt || boss.endedAt || boss.lastSeenAt || now());
            return Math.max(1, (ended - started) / 1000);
        }

        function rebuildBossLeaderboards(boss) {
            const elapsed = bossElapsedSeconds(boss);
            const combatSource = (boss.participants || []).filter((p) => Number(p.damage || 0) > 0 || p.role === "combat");
            const lifeSource = (boss.participants || []).filter((p) => Number(p.corpseDamage || 0) > 0 || p.role === "lifeskill");
            const totalDamage = combatSource.reduce((sum, p) => sum + Number(p.damage || 0), 0);
            const totalCorpseDamage = lifeSource.reduce((sum, p) => sum + Number(p.corpseDamage || 0), 0);

            boss.leaderboard = combatSource
                .map((p) => {
                    const damage = Number(p.damage || 0);
                    const dps = damage / elapsed;
                    const contribution = totalDamage > 0 ? damage / totalDamage : 0;
                    return { rank: "", name: p.name, playerId: p.playerId, damage, damageText: formatCompactNumber(damage), contribution, dps, dpsText: `${formatCompactNumber(dps)}/s`, role: "combat", isYou: p.isYou === true || (boss.myName && normalizeName(p.name) === normalizeName(boss.myName)) };
                })
                .sort((a, b) => Number(b.damage || 0) - Number(a.damage || 0))
                .map((r, i) => ({ ...r, rank: `#${i + 1}` }));

            boss.lifeskillLeaderboard = lifeSource
                .map((p) => {
                    const corpseDamage = Number(p.corpseDamage || 0);
                    const contribution = totalCorpseDamage > 0 ? corpseDamage / totalCorpseDamage : 0;
                    return { rank: "", name: p.name, playerId: p.playerId, corpseDamage, corpseDamageText: formatCompactNumber(corpseDamage), contribution, role: "lifeskill", isYou: p.isYou === true || (boss.myName && normalizeName(p.name) === normalizeName(boss.myName)) };
                })
                .sort((a, b) => Number(b.corpseDamage || 0) - Number(a.corpseDamage || 0))
                .map((r, i) => ({ ...r, rank: `#${i + 1}` }));

            const myRow = boss.leaderboard.find((r) => r.isYou) || null;
            boss.myName = myRow?.name || boss.myName || "";
            boss.myRank = myRow?.rank || "";
            boss.myDamage = myRow?.damageText || "";
            boss.myDps = myRow?.dpsText || "";
            boss.fightersCount = Math.max(Number(boss.fightersCount || 0), boss.leaderboard.length);
            boss.lifeskillCount = Math.max(Number(boss.lifeskillCount || 0), boss.lifeskillLeaderboard.length);
            boss.participantCount = Math.max(Number(boss.participantCount || 0), boss.participants.length);
        }

        function getOrCreateBossBySource(sourceId, seed = {}) {
            const cleanId = clean(sourceId || seed.sourceId || "");
            const sessionKey = bossSessionKey({ ...seed, sourceId: cleanId });
            let boss = (cleanId && state.history.find((b) => b.sourceId === cleanId)) || state.history.find((b) => b.sessionKey === sessionKey) || findActiveBoss();
            if (!boss) {
                boss = normalizeBossRecord({ ...seed, id: cleanId || seed.id, sourceId: cleanId, sessionKey, name: seed.name || "World Boss", role: "auto", firstSeenAt: now(), lastSeenAt: now(), active: true });
                state.history.unshift(boss);
            }
            if (cleanId && !boss.sourceId) boss.sourceId = cleanId;
            boss.role = "auto";
            return boss;
        }

        function worldBossPhaseFromPayload(wb) {
            const phase = clean(wb.phase || "").toLowerCase();
            const ts = now();
            if (phase === "queuing" || phase === "queue" || wb.queued || Number(wb.fightStartsAt || 0) > ts) return "queue";
            if (phase === "corpse" || Number(wb.corpseEndsAt || 0) > ts || Number(wb.corpseMaxHp || 0) > 0) return "corpse";
            if (phase === "fighting" || phase === "fight" || phase === "combat" || Number(wb.hp || 0) > 0) return "combat";
            if (phase === "dead" || phase === "ended") return "ended";
            return phase || "seen";
        }

        function updateBossFromWorldBossPayload(wb) {
            if (!wb || typeof wb !== "object") return false;
            const phase = worldBossPhaseFromPayload(wb);
            const ts = now();
            const sourceId = clean(wb.id || "");
            if (phase === "queue") {
                state.queuedBoss = { id: sourceId || `queue:${bossSignature(wb.name, wb.level, wb.maxHp)}`, sourceId, sessionKey: bossSessionKey({ sourceId, name: wb.name, level: wb.level, maxHp: wb.maxHp, fightStartsAt: wb.fightStartsAt }), name: clean(wb.name || "World Boss"), level: Number(wb.level || 0), queuedAt: ts, expectedSpawnAt: Number(wb.fightStartsAt || 0), fightersCount: Number(wb.combatCount || 0), queuedCount: Number(wb.queueCount || 0), timerText: wb.fightStartsAt ? `Fight in ${formatDuration(Number(wb.fightStartsAt) - ts)}` : "Queued", fightersText: `⚔ ${Number(wb.combatCount || 0)} · 🌾 ${Number(wb.lifeskillCount || 0)} queued`, lastSeenAt: ts };
                return true;
            }
            const boss = getOrCreateBossBySource(sourceId, { name: clean(wb.name || "World Boss"), level: Number(wb.level || 0), maxHp: Number(wb.maxHp || 0), spawnedAt: phase === "combat" ? Number(wb.fightStartsAt || ts) : 0 });
            boss.name = clean(wb.name || boss.name || "World Boss");
            boss.level = Number(wb.level || boss.level || 0);
            boss.maxHp = Math.max(Number(boss.maxHp || 0), Number(wb.maxHp || 0));
            boss.currentHp = Number(wb.hp ?? boss.currentHp ?? 0);
            boss.hpPct = boss.maxHp ? (boss.currentHp / boss.maxHp) * 100 : boss.hpPct;
            boss.phase = phase;
            boss.active = phase === "combat" || phase === "corpse";
            boss.lastSeenAt = ts;
            if (phase === "combat") { state.queuedBoss = null; state.activeBossId = boss.id; state.selectedBossId = state.selectedBossId || boss.id; boss.endedAt = 0; boss.killedAt = 0; }
            if (phase === "corpse") { boss.corpseAt = boss.corpseAt || ts; boss.killedAt = boss.killedAt || boss.corpseAt; boss.corpseEndsAt = Number(wb.corpseEndsAt || boss.corpseEndsAt || 0); boss.corpseHp = Number(wb.corpseHp || boss.corpseHp || 0); boss.corpseMaxHp = Number(wb.corpseMaxHp || boss.corpseMaxHp || 0); state.activeBossId = boss.id; }
            if (phase === "ended") { boss.active = false; boss.endedAt = boss.endedAt || ts; state.activeBossId = ""; }
            if (Array.isArray(wb.participants)) upsertParticipants(boss, wb.participants);
            rebuildBossLeaderboards(boss); dedupeBossHistory(); saveHistory(); return true;
        }

        function handleWorldBossSocketMessage(msg) {
            if (!msg || typeof msg !== "object") return false;
            const type = clean(msg.type);
            const ts = Number(msg.serverTs || Date.now());
            if (type === "worldBossTick") {
                const boss = getOrCreateBossBySource(msg.bossId, { firstSeenAt: ts, spawnedAt: ts, name: clean(msg.bossName || "World Boss"), level: Number(msg.bossLevel || 0), maxHp: Number(msg.bossMaxHp || 0) });
                boss.name = clean(msg.bossName || boss.name || "World Boss");
                boss.level = Number(msg.bossLevel || boss.level || 0);
                boss.maxHp = Math.max(Number(boss.maxHp || 0), Number(msg.bossMaxHp || 0));
                boss.currentHp = Number(msg.bossHp ?? boss.currentHp ?? 0);
                boss.hpPct = boss.maxHp ? (boss.currentHp / boss.maxHp) * 100 : boss.hpPct;
                boss.phase = msg.bossKilled || boss.currentHp <= 0 ? "ended" : "combat";
                boss.active = !msg.bossKilled && boss.currentHp > 0;
                boss.lastSeenAt = ts;
                boss.timeLeftMs = Number(msg.bossTimeLeft || boss.timeLeftMs || 0);
                boss.participantCount = Math.max(Number(boss.participantCount || 0), Number(msg.participantCount || 0));
                boss.sourceId = clean(msg.bossId || boss.sourceId || "");
                state.queuedBoss = null;
                state.activeBossId = boss.active ? boss.id : "";
                state.selectedBossId = state.selectedBossId || boss.id;

                const selfMatches = (p) => Number(p.hp || 0) === Number(msg.hp || 0) && Number(p.maxHp || 0) === Number(msg.maxHp || 0) && Number(p.attackSpeed || 0) === Number(msg.attackSpeed || 0);
                const participants = (Array.isArray(msg.participants) ? msg.participants : []).map((p) => ({ ...p, isYou: selfMatches(p), lastSeenAt: ts }));
                const self = participants.find((p) => p.isYou);
                if (self?.username) boss.myName = clean(self.username);
                if (participants.length) upsertParticipants(boss, participants, { authoritativeDamage: true, authoritativeCorpseDamage: true });
                rebuildBossLeaderboards(boss);
                saveHistory();
                return true;
            }
            if (type === "worldBossCombatTick") {
                const boss = getOrCreateBossBySource(msg.bossId, { spawnedAt: ts, firstSeenAt: ts, name: "World Boss" });
                boss.phase = "combat"; boss.active = true; boss.currentHp = Number(msg.bossHp ?? boss.currentHp ?? 0); boss.hpPct = boss.maxHp ? (boss.currentHp / boss.maxHp) * 100 : boss.hpPct; boss.lastSeenAt = ts; boss.endedAt = 0; boss.killedAt = 0; state.queuedBoss = null; state.activeBossId = boss.id; state.selectedBossId = state.selectedBossId || boss.id;
                upsertParticipants(boss, (Array.isArray(msg.hits) ? msg.hits : []).map((h) => ({ playerId: h.playerId, username: h.username, damage: Number(h.dmg || 0), role: "combat", lastDmgToBoss: Number(h.dmg || 0), lastAttackAt: ts, lastHit: true, lastCrit: h.crit === true, lastSeenAt: ts, firstSeenAt: ts })), { addDamage: true });
                rebuildBossLeaderboards(boss); saveHistory(); return true;
            }
            if (type === "worldBossPhase") {
                const boss = getOrCreateBossBySource(msg.bossId, { firstSeenAt: ts, name: "World Boss" });
                const phase = clean(msg.phase).toLowerCase(); boss.phase = phase === "corpse" ? "corpse" : (phase || boss.phase); boss.lastSeenAt = ts;
                if (phase === "corpse") { boss.active = true; boss.corpseAt = boss.corpseAt || ts; boss.killedAt = boss.killedAt || boss.corpseAt; boss.corpseEndsAt = Number(msg.corpseEndsAt || boss.corpseEndsAt || 0); boss.corpseHp = Number(msg.corpseHp || boss.corpseHp || 0); boss.corpseMaxHp = Number(msg.corpseMaxHp || boss.corpseMaxHp || 0); state.activeBossId = boss.id; state.selectedBossId = state.selectedBossId || boss.id; }
                saveHistory(); return true;
            }
            if (type === "worldBossCorpseTick") {
                const boss = getOrCreateBossBySource(msg.bossId, { firstSeenAt: ts, name: "World Boss" });
                boss.phase = "corpse"; boss.active = Number(msg.corpseEndsAt || 0) > Date.now() && Number(msg.corpseHp ?? 1) > 0; boss.corpseAt = boss.corpseAt || ts; boss.killedAt = boss.killedAt || boss.corpseAt; boss.lastSeenAt = ts; boss.corpseEndsAt = Number(msg.corpseEndsAt || boss.corpseEndsAt || 0); boss.corpseHp = Number(msg.corpseHp ?? boss.corpseHp ?? 0); boss.corpseMaxHp = Number(msg.corpseMaxHp || boss.corpseMaxHp || 0); state.activeBossId = boss.active ? boss.id : ""; state.selectedBossId = state.selectedBossId || boss.id;
                if (Array.isArray(msg.participants)) upsertParticipants(boss, msg.participants);
                upsertParticipants(boss, (Array.isArray(msg.harvests) ? msg.harvests : []).map((h) => ({ playerId: h.playerId, username: h.username, corpseDamage: Number(h.corpseDamage || h.dmg || 0), role: "lifeskill", lastHarvestAt: ts, lastSeenAt: ts, firstSeenAt: ts })), { addCorpseDamage: true });
                if (!boss.active) { boss.endedAt = boss.endedAt || ts; boss.phase = "ended"; }
                rebuildBossLeaderboards(boss); saveHistory(); return true;
            }
            return false;
        }

        function renderBossDetail(boss, options = {}) {
            return `<div class="bt-tabs" style="margin-top:10px;"><button type="button" class="bt-tab ${state.detailSubTab !== "lifeskill" ? "active" : ""}" data-bt-subtab="fighters">Fighters (${(boss.leaderboard || []).length})</button><button type="button" class="bt-tab ${state.detailSubTab === "lifeskill" ? "active" : ""}" data-bt-subtab="lifeskill">Lifeskillers (${(boss.lifeskillLeaderboard || []).length})</button></div>${state.detailSubTab === "lifeskill" ? renderLifeskillLeaderboard(boss, options) : renderLeaderboard(boss, options)}${renderParticipants(boss, options)}`;
        }

        function renderLeaderboard(boss, options = {}) {
            rebuildBossLeaderboards(boss);
            const rowsAll = (boss.leaderboard || []).slice().sort((a,b)=>Number(b.damage||0)-Number(a.damage||0));
            if (!rowsAll.length) return `<div class="bt-section"><div class="bt-section-title">Fighter Damage Leaderboard</div><div class="bt-muted">No fighter damage captured yet. Direct <code>worldBossCombatTick</code> and corpse participant packets will fill this table.</div></div>`;
            const rows = options.compact ? rowsAll.slice(0,25) : rowsAll;
            return `<div class="bt-section"><div class="bt-section-title">Fighter Damage Leaderboard ${options.compact && rowsAll.length > rows.length ? `(Top ${rows.length}/${rowsAll.length})` : `(${rowsAll.length})`}</div><div class="bt-scroll"><table class="bt-table"><thead><tr><th>Rank</th><th>Name</th><th>Damage</th><th>Contribution</th><th>DPS</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${r.isYou?"bt-good":""}"><td>${escapeHtml(r.rank || `#${i+1}`)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.damageText || formatCompactNumber(r.damage))}</td><td>${escapeHtml(r.contribution ? `${(Number(r.contribution)*100).toFixed(2)}%` : "—")}</td><td>${escapeHtml(r.dpsText || "—")}</td></tr>`).join("")}</tbody></table></div></div>`;
        }

        function renderLifeskillLeaderboard(boss, options = {}) {
            rebuildBossLeaderboards(boss);
            const rowsAll = (boss.lifeskillLeaderboard || []).slice().sort((a,b)=>Number(b.corpseDamage||0)-Number(a.corpseDamage||0));
            if (!rowsAll.length) return `<div class="bt-section"><div class="bt-section-title">Lifeskill Corpse Leaderboard</div><div class="bt-muted">No corpse harvesting captured yet. This fills from <code>worldBossCorpseTick.harvests</code> and corpse participants.</div></div>`;
            const rows = options.compact ? rowsAll.slice(0,25) : rowsAll;
            return `<div class="bt-section"><div class="bt-section-title">Lifeskill Corpse Leaderboard ${options.compact && rowsAll.length > rows.length ? `(Top ${rows.length}/${rowsAll.length})` : `(${rowsAll.length})`}</div><div class="bt-scroll"><table class="bt-table"><thead><tr><th>Rank</th><th>Name</th><th>Corpse Damage</th><th>Contribution</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${r.isYou?"bt-good":""}"><td>${escapeHtml(r.rank || `#${i+1}`)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.corpseDamageText || formatCompactNumber(r.corpseDamage))}</td><td>${escapeHtml(r.contribution ? `${(Number(r.contribution)*100).toFixed(2)}%` : "—")}</td></tr>`).join("")}</tbody></table></div></div>`;
        }

        function renderParticipants(boss, options = {}) {
            const mode = state.detailSubTab === "lifeskill" ? "lifeskill" : "combat";
            const listAll = (boss.participants || []).filter((p)=> mode === "lifeskill" ? (p.role === "lifeskill" || Number(p.corpseDamage||0)>0) : (p.role === "combat" || Number(p.damage||0)>0));
            const list = options.compact ? listAll.slice(0,120) : listAll;
            return `<div class="bt-section"><div class="bt-section-title">${mode === "lifeskill" ? "Joined Lifeskillers" : "Joined Fighters"} (${listAll.length})</div>${list.length ? list.map((p)=>`<span class="bt-pill" title="First seen ${escapeHtml(formatTime(p.firstSeenAt))} · Last seen ${escapeHtml(formatTime(p.lastSeenAt))}">${p.isZerk?"🔥 ":""}${escapeHtml(p.name)}${p.level?` · Lv ${Number(p.level)}`:""}${mode === "lifeskill" ? ` · ${formatCompactNumber(p.corpseDamage || 0)}` : ` · ${formatCompactNumber(p.damage || 0)}`}</span>`).join("") : `<div class="bt-muted">No ${mode === "lifeskill" ? "lifeskillers" : "fighters"} captured yet.</div>`}</div>`;
        }

        function renderHistoryButton(boss) {
            const active = boss.id === state.selectedBossId;
            const status = boss.active ? "Live" : boss.endedAt ? "Ended" : "Seen";
            const duration = formatDuration((boss.endedAt || boss.lastSeenAt || now()) - (boss.spawnedAt || boss.firstSeenAt));
            const checked = state.copyIds?.has?.(boss.id);
            return `<div style="display:flex;align-items:stretch;gap:6px;margin-bottom:6px;"><label class="bt-row-btn" style="width:auto;display:flex;align-items:center;margin:0;padding:0 8px;" title="Include in Copy Checked"><input type="checkbox" data-bt-copy-toggle="${escapeHtml(boss.id)}" ${checked ? "checked" : ""} /></label><button type="button" class="bt-row-btn ${active ? "active" : ""}" data-bt-select="${escapeHtml(boss.id)}" style="margin:0;"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;"><div><b>${escapeHtml(boss.name)}${boss.level ? ` Lv ${boss.level}` : ""}</b><br /><span class="bt-muted">${phaseLabel(boss.phase)} · Auto · Spawned ${formatDateTime(boss.spawnedAt || boss.firstSeenAt)} · Corpse ${boss.corpseAt ? formatDateTime(boss.corpseAt) : "—"} · Killed ${boss.killedAt || boss.endedAt ? formatDateTime(boss.killedAt || boss.endedAt) : "—"} · ${duration}</span><br /><span class="bt-muted">${boss.fightersCount || (boss.leaderboard || []).length} fighters · ${boss.lifeskillCount || (boss.lifeskillLeaderboard || []).length} lifeskillers · ${(boss.leaderboard || []).length} fighter rows · ${(boss.lifeskillLeaderboard || []).length} corpse rows</span></div><div class="${boss.active ? "bt-good" : "bt-muted"}">${status}</div></div></button></div>`;
        }

        function bossToText(boss) {
            if (!boss) return "No boss selected.";
            rebuildBossLeaderboards(boss);
            const lines = [`Boss: ${boss.name}${boss.level ? ` Lv ${boss.level}` : ""}`];
            if (boss.sourceId) lines.push(`Boss ID: ${boss.sourceId}`);
            lines.push(`Mode: Auto`, `Phase: ${phaseLabel(boss.phase)}`, `Spawned: ${formatDateTime(boss.spawnedAt || boss.firstSeenAt)}`);
            if (boss.corpseAt) lines.push(`Corpse: ${formatDateTime(boss.corpseAt)}`);
            lines.push(`Killed: ${boss.killedAt || boss.endedAt ? formatDateTime(boss.killedAt || boss.endedAt) : "active"}`);
            lines.push(`Duration: ${formatDuration((boss.killedAt || boss.endedAt || boss.lastSeenAt || now()) - (boss.spawnedAt || boss.firstSeenAt))}`);
            lines.push(`Boss HP: ${formatCompactNumber(boss.currentHp)} / ${formatCompactNumber(boss.maxHp)} (${Number(boss.hpPct || 0).toFixed(1)}%)`);
            if (boss.corpseMaxHp) lines.push(`Corpse HP: ${formatCompactNumber(boss.corpseHp)} / ${formatCompactNumber(boss.corpseMaxHp)}`);
            lines.push(`Fighters: ${boss.fightersCount || (boss.leaderboard || []).length}`, `Lifeskillers: ${boss.lifeskillCount || (boss.lifeskillLeaderboard || []).length}`, "", "Fighter Damage Leaderboard:");
            if ((boss.leaderboard || []).length) for (const row of boss.leaderboard) lines.push(`${row.rank || ""} ${row.name}: ${row.damageText || formatCompactNumber(row.damage)} damage${row.contribution ? ` · ${(Number(row.contribution)*100).toFixed(2)}%` : ""}${row.dpsText ? ` · ${row.dpsText}` : ""}`.trim()); else lines.push("No fighter leaderboard captured.");
            lines.push("", "Lifeskill Corpse Leaderboard:");
            if ((boss.lifeskillLeaderboard || []).length) for (const row of boss.lifeskillLeaderboard) lines.push(`${row.rank || ""} ${row.name}: ${row.corpseDamageText || formatCompactNumber(row.corpseDamage)} corpse damage${row.contribution ? ` · ${(Number(row.contribution)*100).toFixed(2)}%` : ""}`.trim()); else lines.push("No corpse leaderboard captured.");
            return lines.join("\n");
        }

        async function copySelectedBoss(app) {
            const ids = state.copyIds && state.copyIds.size ? [...state.copyIds] : [];
            const bosses = ids.length ? state.history.filter((b) => ids.includes(b.id)) : [findSelectedBoss()].filter(Boolean);
            const text = bosses.length ? bosses.map(bossToText).join("\n\n==============================\n\n") : "No boss selected.";
            try { await navigator.clipboard.writeText(text); state.lastExportAt = now(); showMessage(app, ids.length ? `Copied ${bosses.length} checked bosses.` : "Copied selected boss.", "#69f0ae"); }
            catch { console.log(text); alert("Could not copy automatically. Boss text was printed to console."); }
        }


        function clearHistory(app) {
            if (!confirm("Clear all boss tracker history?")) return;

            state.history = [];
            state.activeBossId = "";
            state.selectedBossId = "";
            saveHistory();
            showMessage(app, "Boss history cleared.", "#ffa726");
        }

        function attachEvents(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            if (panel.dataset.bossTrackerEventsBound === "1") return;
            panel.dataset.bossTrackerEventsBound = "1";

            panel.addEventListener("change", (event) => {
                const copyToggle = event.target.closest("[data-bt-copy-toggle]");
                if (copyToggle && panel.contains(copyToggle)) {
                    const id = copyToggle.dataset.btCopyToggle;
                    if (copyToggle.checked) state.copyIds.add(id);
                    else state.copyIds.delete(id);
                    renderIntoPanel(app);
                    return;
                }

                const roleSelect = event.target.closest("[data-bt-role]");
                if (!roleSelect || !panel.contains(roleSelect)) return;

                saveBossTrackerRole(roleSelect.value);
                scanBossDom();
                renderIntoPanel(app);
                showMessage(app, `Boss Tracker mode set to ${roleLabel()}.`, "#69f0ae");
            });

            panel.addEventListener("click", async (event) => {
                const target = event.target;

                const subtab = target.closest("[data-bt-subtab]");
                if (subtab && panel.contains(subtab)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.detailSubTab = subtab.dataset.btSubtab === "lifeskill" ? "lifeskill" : "fighters";
                    renderIntoPanel(app);
                    return;
                }

                const tab = target.closest("[data-bt-tab]");
                if (tab && panel.contains(tab)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.activeTab = tab.dataset.btTab;
                    renderIntoPanel(app);
                    return;
                }

                const select = target.closest("[data-bt-select]");
                if (select && panel.contains(select)) {
                    event.preventDefault();
                    event.stopPropagation();

                    state.selectedBossId = select.dataset.btSelect;
                    state.activeTab = "detail";
                    renderIntoPanel(app);
                    return;
                }

                const scan = target.closest("[data-bt-scan]");
                if (scan && panel.contains(scan)) {
                    event.preventDefault();
                    event.stopPropagation();

                    const changed = scanBossDom();
                    renderIntoPanel(app);
                    showMessage(app, changed ? (state.queuedBoss ? "World boss queue detected." : "Boss data scanned.") : "No active boss or queue found.", changed ? "#69f0ae" : "#ffa726");
                    return;
                }

                const copy = target.closest("[data-bt-copy]");
                if (copy && panel.contains(copy)) {
                    event.preventDefault();
                    event.stopPropagation();

                    await copySelectedBoss(app);
                    return;
                }

                const clear = target.closest("[data-bt-clear]");
                if (clear && panel.contains(clear)) {
                    event.preventDefault();
                    event.stopPropagation();

                    clearHistory(app);
                }
            });
        }


        function closestEventTarget(event, selector) {
            const rawTarget = event?.target;
            const target = rawTarget && rawTarget.nodeType === 1 ? rawTarget : rawTarget?.parentElement;
            return target?.closest ? target.closest(selector) : null;
        }

        function attachEvents(app) {
            // Bind at document level in capture phase. The panel body is re-rendered often
            // while WS/world-boss messages arrive, and binding to only the current panel node
            // can leave the new buttons inert. This keeps Active/History/Selected and row
            // selection clickable even after rapid renders.
            if (!app || state.bossTrackerGlobalEventsBound) return;
            state.bossTrackerGlobalEventsBound = true;

            const isInsideBossPanel = (event) => {
                const panel = app.panels?.get?.(definition.id);
                const rawTarget = event?.target;
                const target = rawTarget && rawTarget.nodeType === 1 ? rawTarget : rawTarget?.parentElement;
                return !!(panel && target && panel.contains(target));
            };

            const onChange = (event) => {
                if (!isInsideBossPanel(event)) return;

                const copyToggle = closestEventTarget(event, "[data-bt-copy-toggle]");
                if (copyToggle) {
                    const id = copyToggle.dataset.btCopyToggle;
                    if (copyToggle.checked) state.copyIds.add(id);
                    else state.copyIds.delete(id);
                    renderIntoPanel(app);
                    return;
                }

                const roleSelect = closestEventTarget(event, "[data-bt-role]");
                if (roleSelect) {
                    saveBossTrackerRole(roleSelect.value);
                    scanBossDom();
                    renderIntoPanel(app);
                    showMessage(app, `Boss Tracker mode set to ${roleLabel()}.`, "#69f0ae");
                }
            };

            const onClick = async (event) => {
                if (!isInsideBossPanel(event)) return;

                const subtab = closestEventTarget(event, "[data-bt-subtab]");
                if (subtab) {
                    event.preventDefault();
                    event.stopPropagation();
                    state.detailSubTab = subtab.dataset.btSubtab === "lifeskill" ? "lifeskill" : "fighters";
                    renderIntoPanel(app);
                    return;
                }

                const tab = closestEventTarget(event, "[data-bt-tab]");
                if (tab) {
                    event.preventDefault();
                    event.stopPropagation();
                    state.activeTab = tab.dataset.btTab || "active";
                    renderIntoPanel(app);
                    return;
                }

                const select = closestEventTarget(event, "[data-bt-select]");
                if (select) {
                    event.preventDefault();
                    event.stopPropagation();
                    state.selectedBossId = select.dataset.btSelect || "";
                    state.activeTab = "detail";
                    renderIntoPanel(app);
                    return;
                }

                const scan = closestEventTarget(event, "[data-bt-scan]");
                if (scan) {
                    event.preventDefault();
                    event.stopPropagation();
                    const changed = scanBossDom();
                    renderIntoPanel(app);
                    showMessage(app, changed ? (state.queuedBoss ? "World boss queue detected." : "Boss data scanned.") : "No active boss or queue found.", changed ? "#69f0ae" : "#ffa726");
                    return;
                }

                const copy = closestEventTarget(event, "[data-bt-copy]");
                if (copy) {
                    event.preventDefault();
                    event.stopPropagation();
                    await copySelectedBoss(app);
                    return;
                }

                const clear = closestEventTarget(event, "[data-bt-clear]");
                if (clear) {
                    event.preventDefault();
                    event.stopPropagation();
                    clearHistory(app);
                }
            };

            document.addEventListener("change", onChange, true);
            document.addEventListener("click", onClick, true);

            state.detachBossTrackerEvents = () => {
                document.removeEventListener("change", onChange, true);
                document.removeEventListener("click", onClick, true);
                state.bossTrackerGlobalEventsBound = false;
                state.detachBossTrackerEvents = null;
            };
        }

        function renderIntoPanel(app) {
            const panel = app.panels.get(definition.id);
            if (!panel) return;

            const body = panel.querySelector(".vim-body");
            const footer = panel.querySelector(".vim-footer");

            if (!body || !footer) return;

            body.innerHTML = render();

            const active = findActiveBoss();
            const selected = findSelectedBoss();

            footer.textContent =
                active
                    ? `Live: ${active.name} | ${active.fightersCount || active.participants.length} fighters | ${active.leaderboard.length} leaderboard rows`
                    : state.queuedBoss
                        ? `Queued: ${state.queuedBoss.name}${state.queuedBoss.level ? ` Lv ${state.queuedBoss.level}` : ""} | ${state.queuedBoss.timerText || "waiting"}`
                        : selected
                            ? `Selected: ${selected.name} | ${state.history.length} saved bosses`
                            : `${state.history.length} saved bosses`;

            attachEvents(app);
        }

        function queueRender(app) {
            if (!app || state.updateQueued) return;

            state.updateQueued = true;

            requestAnimationFrame(() => {
                state.updateQueued = false;
                renderIntoPanel(app);
            });
        }

        function startObserver(app) {
            if (state.observer || !document.body) return;

            state.observer = new MutationObserver(() => {
                const panelState = getPanelState(app, definition.id);
                if (!panelState?.enabled) return;

                const ts = now();
                if (ts - state.lastScanAt < 750) return;

                state.lastScanAt = ts;
                const changed = scanBossDom();
                if (changed) queueRender(app);
            });

            state.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["class", "style"],
            });
        }

        return {
            ...definition,

            init(app) {
                appRef = app;
                loadHistory();

                app.events.on("socket:any", (msg) => {
                    const wb = msg?.worldBoss || msg?.snapshot?.worldBoss;
                    if (!wb || typeof wb !== "object") return;

                    const changed = updateBossFromWorldBossPayload(wb);
                    if (changed) queueRender(app);
                });

                app.events.on("socket:any", (msg) => {
                    const changed = handleWorldBossSocketMessage(msg);
                    if (changed) queueRender(app);
                });

                const boot = () => {
                    // Module init runs before WindowManager.createModulePanel() creates this panel.
                    // Defer the first render/event bind until the next frame so the Boss Tracker
                    // body exists; otherwise the first History/Active/Selected buttons are inert
                    // until a later WS update happens to re-render the panel.
                    requestAnimationFrame(() => {
                        startObserver(app);
                        scanBossDom();
                        renderIntoPanel(app);
                    });
                };

                if (document.body) {
                    boot();
                } else {
                    window.addEventListener("DOMContentLoaded", boot, { once: true });
                }

                state.scanTimer = setInterval(() => {
                    const panelState = getPanelState(app, definition.id);
                    if (!panelState?.enabled) return;

                    const changed = scanBossDom();
                    if (changed) queueRender(app);
                }, 1500);
            },

            render() {
                return render();
            },

            destroy() {
                if (state.observer) {
                    state.observer.disconnect();
                    state.observer = null;
                }

                if (state.scanTimer) {
                    clearInterval(state.scanTimer);
                    state.scanTimer = null;
                }

                if (state.detachBossTrackerEvents) {
                    state.detachBossTrackerEvents();
                }
            },
        };
    }


    /**************************************************************************
     * STARTUP
     **************************************************************************/

    const App = createApp();

    for (const definition of MODULE_DEFINITIONS) {
        if (definition.id === "dpsCoach") {
            App.register(createDpsCoachModule(definition));
        }

        if (definition.id === "statGrabber") {
            App.register(createStatGrabberModule(definition));
        }

        if (definition.id === "itemShare") {
            App.register(createItemShareModule(definition));
        }

        if (definition.id === "runePlanner") {
            App.register(createRunePlannerModule(definition));
        }

        if (definition.id === "wsSniffer") {
            App.register(createWsSnifferModule(definition));
        }

        if (definition.id === "bossTracker") {
            App.register(createBossTrackerModule(definition));
        }
    }

    function start() {
        App.start();
    }

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
