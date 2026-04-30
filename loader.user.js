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
      remove(key) { localStorage.removeItem(pfx + key); },
      clear() {
        Object.keys(localStorage)
          .filter(k => k.startsWith(pfx))
          .forEach(k => localStorage.removeItem(k));
      },
    };
  }

  // ─── GENERAL STORAGE HELPERS ────────────────────────────────────────────────
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function deepMerge(base, incoming) {
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
      .replace(/"/g, '&quot;');
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
      catch {}
    },
  };

  // (Tasks 4–9 will append more sections here before the closing })(); )

})();
