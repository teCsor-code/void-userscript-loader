# VoidIdle Userscript Modular Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 13,467-line VoidIdle userscript into a stable `loader.user.js` (core embedded) and 6 remote feature modules, loaded dynamically from GitHub via a `manifest.json` registry.

**Architecture:** The Tampermonkey loader hooks `window.WebSocket` synchronously at `document-start`, then waits for DOM to fetch `manifest.json`, evaluate remote module files via `new Function(code)()`, and call `module.init(appContext)` per module. One module failure does not affect others. Offline fallback uses `localStorage` cache of last successful manifest and module sources.

**Tech Stack:** Plain JavaScript (ES2017), Tampermonkey, GitHub raw files, localStorage.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `loader.user.js` | Create | Tampermonkey install file — all core embedded |
| `manifest.json` | Create | Module registry — only file to edit for updates |
| `modules/ws-sniffer.js` | Create | Extracted from `userscript.js` lines 10416–11138 |
| `modules/boss-tracker.js` | Create | Extracted from `userscript.js` lines 11139–end |
| `modules/rune-planner.js` | Create | Extracted from `userscript.js` lines 6304–6941 |
| `modules/stat-grabber.js` | Create | Extracted from `userscript.js` lines 6942–10415 |
| `modules/dps-coach.js` | Create | Extracted from `userscript.js` lines 1301–5580 |
| `modules/item-share.js` | Create | Extracted from `userscript.js` lines 5581–6303 |
| `archive/userscript-pre-modular.js` | Create | Original monolith moved here at end |
| `userscript.js` | Delete (at end) | Replaced by the above |

---

## Phase 1 — Repository and Scaffolding

---

### Task 1: Create GitHub repository and folder structure

**Files:**
- Create: `void-userscript-loader` GitHub repository
- Create: `modules/`, `archive/`, `docs/` folders
- Create: `README.md`

- [ ] **Step 1: Create the GitHub repo**

Option A (gh CLI — recommended):
```bash
gh repo create void-userscript-loader --public --description "VoidIdle modular Tampermonkey userscript loader"
```

Option B: Create manually at https://github.com/new with the name `void-userscript-loader`, set to Public.

- [ ] **Step 2: Initialize local git and link to the new repo**

Run from `c:\Users\josep\void_userscript_loader\`:
```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/void-userscript-loader.git
git branch -M main
```

Replace `YOUR_USERNAME` with your actual GitHub username. This is the only place you need to substitute it — every other URL in the project is derived from it.

- [ ] **Step 3: Create folder structure**

```bash
mkdir -p modules archive docs/superpowers/specs docs/superpowers/plans
```

On Windows (PowerShell):
```powershell
New-Item -ItemType Directory -Force -Path modules, archive, docs/superpowers/specs, docs/superpowers/plans
```

- [ ] **Step 4: Create README.md**

```markdown
# VoidIdle Userscript Loader

Modular Tampermonkey userscript for [Void Idle](https://voididle.com).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Click **[Install Loader](https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/loader.user.js)**

## Update a Module

Edit `manifest.json` and bump the module's `version` field. No reinstall needed.

## Add a Community Module

Add an entry to `manifest.json` pointing to any hosted `.js` file.
```

- [ ] **Step 5: Move the spec and this plan into the repo**

```bash
cp -r docs/ docs/
```
(The `docs/` folder already exists from brainstorming — it is already in `c:\Users\josep\void_userscript_loader\docs\`)

- [ ] **Step 6: Initial commit and push**

```bash
git add .
git commit -m "chore: initialize repo with folder structure and docs"
git push -u origin main
```

Expected output ends with: `Branch 'main' set up to track remote branch 'main' from 'origin'.`

---

### Task 2: Write manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Write manifest.json**

Replace `YOUR_USERNAME` with your GitHub username:

```json
{
  "version": "2026-04-30.1",
  "modules": [
    {
      "id": "ws-sniffer",
      "name": "WS Sniffer",
      "icon": "🛰️",
      "description": "Capture WebSocket messages with filters for world boss debugging.",
      "url": "https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/modules/ws-sniffer.js",
      "version": "2026-04-30.1",
      "enabled": true,
      "dependencies": ["core"]
    },
    {
      "id": "boss-tracker",
      "name": "Boss Tracker",
      "icon": "👑",
      "description": "Tracks world boss history, fighters, and DPS leaderboards.",
      "url": "https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/modules/boss-tracker.js",
      "version": "2026-04-30.1",
      "enabled": true,
      "dependencies": ["core"]
    },
    {
      "id": "rune-planner",
      "name": "Rune Planner",
      "icon": "◈",
      "description": "Plan and export rune loadouts by type and tier.",
      "url": "https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/modules/rune-planner.js",
      "version": "2026-04-30.1",
      "enabled": true,
      "dependencies": ["core"]
    },
    {
      "id": "stat-grabber",
      "name": "Stat Grabber",
      "icon": "📊",
      "description": "Stats, gear comparison, roll quality, filters, and scoring.",
      "url": "https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/modules/stat-grabber.js",
      "version": "2026-04-30.1",
      "enabled": true,
      "dependencies": ["core"]
    },
    {
      "id": "dps-coach",
      "name": "DPS Coach",
      "icon": "🎯",
      "description": "Personal and team DPS tools.",
      "url": "https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/modules/dps-coach.js",
      "version": "2026-04-30.1",
      "enabled": true,
      "dependencies": ["core"]
    },
    {
      "id": "item-share",
      "name": "Item Share",
      "icon": "🎁",
      "description": "Item sharing, mail automation, and salvage tools.",
      "url": "https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/modules/item-share.js",
      "version": "2026-04-30.1",
      "enabled": true,
      "dependencies": ["core"]
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "feat: add manifest.json with 6 module entries"
git push
```

---

## Phase 2 — Core Loader

---

### Task 3: Write loader.user.js — header, CONFIG, Logger, Storage helpers

**Files:**
- Create: `loader.user.js`

- [ ] **Step 1: Create loader.user.js with UserScript header, CONFIG, Logger, and Storage helpers**

```js
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
    manifestUrl: 'https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/manifest.json',
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
```

- [ ] **Step 2: Verify the file opens without syntax errors**

Paste it into https://jshint.com or open browser DevTools → Sources → paste → look for red squiggles. Fix any syntax issues before continuing.

- [ ] **Step 3: Commit**

```bash
git add loader.user.js
git commit -m "feat: loader scaffold — CONFIG, Logger, Storage helpers"
```

---

### Task 4: Add EventBus to loader.user.js

**Files:**
- Modify: `loader.user.js` (append before the closing `})();`)

- [ ] **Step 1: Copy EventBus from userscript.js lines 193–218 and append**

The existing EventBus is identical to what we need. Open `userscript.js`, find `function createEventBus()` (line 193), copy through the closing `}` of the returned object (line 218), and append it to `loader.user.js` before the closing `})();`:

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add loader.user.js
git commit -m "feat: add EventBus to loader"
```

---

### Task 5: Add SocketCore and RelayCore to loader.user.js

**Files:**
- Modify: `loader.user.js` (append)

- [ ] **Step 1: Copy SocketCore from userscript.js lines 273–379 and append**

Open `userscript.js`. Find `const SocketCore = {` (line 273). Copy through the closing `};` (line 379). Append verbatim to `loader.user.js`.

No code changes required — `CONFIG.socketMessageTypes` and `app.events` references already match.

- [ ] **Step 2: Copy RelayCore from userscript.js lines 381–720 and append**

Open `userscript.js`. Find `const RelayCore = {` (line 381). Copy through the closing `};` (line 720). Append verbatim.

No code changes required.

- [ ] **Step 3: Commit**

```bash
git add loader.user.js
git commit -m "feat: add SocketCore and RelayCore to loader (verbatim copy)"
```

---

### Task 6: Add DomHelper and ApiHelper to loader.user.js

**Files:**
- Modify: `loader.user.js` (append)

- [ ] **Step 1: Append DomHelper**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add loader.user.js
git commit -m "feat: add DomHelper and ApiHelper to loader"
```

---

### Task 7: Add Styles and WindowManager to loader.user.js

**Files:**
- Modify: `loader.user.js` (append)

- [ ] **Step 1: Copy Styles from userscript.js lines 726–922 and append**

Find `const Styles = {` (line 726), copy through closing `};` (line 922). Append verbatim. No changes needed — `CONFIG.appId` references already match.

- [ ] **Step 2: Copy WindowManager from userscript.js lines 927–1296 and append**

Find `const WindowManager = {` (line 927), copy through closing `};` (line 1296). Append, then make **two targeted edits** before continuing:

**Edit A — rename the hardcoded `'master'` panel id throughout WindowManager.**

In the pasted WindowManager code, search for every occurrence of the string `'master'` (including inside `renderTray`, `setModuleEnabled`, `applyStartupOpenRules`, and any helper that reads `getPanelState(app, 'master')`). Replace each with:
```js
`${CONFIG.appId}-manager`
```

This is necessary because the old loader called its built-in panel `'master'`; the new loader calls it `voididle-loader-manager`.

Example: if `renderTray` contains:
```js
{ id: 'master', icon: '⚙️', label: CONFIG.title, open: isPanelOpen(app, 'master') },
```
Change to:
```js
{ id: `${CONFIG.appId}-manager`, icon: '⚙️', label: CONFIG.title || 'Scripts', open: isPanelOpen(app, `${CONFIG.appId}-manager`) },
```

**Edit B — remove `applyStartupOpenRules` call if it references `app.modules`.**

If the pasted code contains a standalone `applyStartupOpenRules(app)` function that iterates `app.modules`, move its logic inside the `WindowManager` object or delete it — remote modules are not in `app.modules` at startup (they're added after init), so the function would silently no-op anyway.

- [ ] **Step 3: Add two new methods to the WindowManager object**

Open `loader.user.js`. Find the closing `};` of `WindowManager`. Insert these two methods immediately before that closing `};`:

```js
    // createPanel — used for built-in panels (e.g. the manager UI).
    // Takes a flat config instead of a module object.
    createPanel(app, { id, icon, title, bodyHtml, footer }) {
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
```

- [ ] **Step 4: Commit**

```bash
git add loader.user.js
git commit -m "feat: add Styles and WindowManager (+ createPanel, registerModulePanel) to loader"
```

---

### Task 8: Add ModuleRegistry and ModuleLoader to loader.user.js

**Files:**
- Modify: `loader.user.js` (append)

- [ ] **Step 1: Append ModuleRegistry**

```js
  // ─── MODULE REGISTRY ────────────────────────────────────────────────────────
  // Tracks load state of every module the loader attempted to initialize.
  const ModuleRegistry = {
    _records: new Map(), // id → { module, entry, status, error, loadedAt }

    register(id, module, entry, status, error = null) {
      this._records.set(id, { module, entry, status, error, loadedAt: Date.now() });
    },

    get(id)    { return this._records.get(id); },
    getAll()   { return [...this._records.values()]; },
    has(id)    { return this._records.has(id); },
    delete(id) { this._records.delete(id); },
  };
```

- [ ] **Step 2: Append ModuleLoader**

```js
  // ─── MODULE LOADER ──────────────────────────────────────────────────────────
  const ModuleLoader = {
    _offline: false,

    async start(app) {
      logger.log('ModuleLoader starting…');

      // 1 — Fetch manifest (fall back to cache if network fails)
      let manifest;
      try {
        manifest = await this._fetchManifest();
        this._offline = false;
        logger.log('Manifest fetched:', manifest.version);
        app.events.emit('loader:manifest', { manifest, offline: false });
      } catch (err) {
        logger.warn('Manifest fetch failed, checking cache:', err.message);
        manifest = this._loadCachedManifest();
        if (!manifest) {
          logger.error('No cached manifest — cannot load modules.');
          app.events.emit('loader:error', { type: 'manifest', message: err.message });
          return;
        }
        this._offline = true;
        logger.log('Using cached manifest (offline):', manifest.version);
        app.events.emit('loader:manifest', { manifest, offline: true });
      }

      // 2 — Resolve per-module enabled overrides set by the user in-game
      const userSettings = this._loadUserSettings();

      // 3 — Load modules; two passes for dependency resolution
      const results = { loaded: [], failed: [], skipped: [] };
      let queue = [...manifest.modules];

      for (let pass = 0; pass < 2 && queue.length > 0; pass++) {
        const deferred = [];

        for (const entry of queue) {
          // User override takes precedence over manifest enabled flag
          const enabled = entry.id in userSettings
            ? userSettings[entry.id]
            : entry.enabled;

          if (!enabled) {
            logger.log('Module skipped (disabled):', entry.id);
            results.skipped.push(entry.id);
            app.events.emit('loader:module:skipped', { id: entry.id });
            continue;
          }

          // 'core' is always satisfied (embedded in loader). Check others.
          const unmet = (entry.dependencies || [])
            .filter(d => d !== 'core' && !results.loaded.includes(d));

          if (unmet.length > 0 && pass === 0) {
            deferred.push(entry);
            continue;
          }

          if (unmet.length > 0) {
            const msg = `Unmet dependencies: ${unmet.join(', ')}`;
            logger.warn(`Module skipped (${entry.id}):`, msg);
            results.failed.push({ id: entry.id, error: msg });
            app.events.emit('loader:module:failed', { id: entry.id, error: msg });
            continue;
          }

          const result = await this._loadOne(app, entry);
          if (result.ok) {
            results.loaded.push(entry.id);
            app.events.emit('loader:module:loaded', { id: entry.id, version: entry.version });
          } else {
            results.failed.push({ id: entry.id, error: result.error });
            app.events.emit('loader:module:failed', { id: entry.id, error: result.error });
          }
        }

        queue = deferred;
      }

      logger.log(
        `Load complete — loaded: ${results.loaded.length},`,
        `failed: ${results.failed.length},`,
        `skipped: ${results.skipped.length}`
      );
      app.events.emit('loader:complete', results);
    },

    // reload — destroy existing instance, clear cache entry, re-fetch, re-init
    async reload(app, id) {
      const record = ModuleRegistry.get(id);
      if (record?.module) {
        try { record.module.destroy?.(); } catch {}
      }
      ModuleRegistry.delete(id);

      const manifest = this._loadCachedManifest();
      const entry = manifest?.modules?.find(m => m.id === id);
      if (!entry) {
        logger.warn(`Cannot reload "${id}" — not found in cached manifest`);
        return { ok: false, error: 'Not in manifest' };
      }

      // Clear source cache so next _loadOne fetches fresh from network
      localStorage.removeItem(CONFIG.cache.moduleKey(id, entry.version));

      const result = await this._loadOne(app, entry);
      app.events.emit('loader:module:reloaded', { id, ok: result.ok, error: result.error });
      return result;
    },

    async _fetchManifest() {
      // Use cached version as the cache-buster so GitHub CDN serves fresh content
      // when the version changes, but does not hammer the API on every page load.
      const cached = this._loadCachedManifest();
      const buster = cached?.version
        ? encodeURIComponent(cached.version)
        : String(Date.now());
      const res = await fetch(`${CONFIG.manifestUrl}?v=${buster}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json();
      try { localStorage.setItem(CONFIG.cache.manifest, JSON.stringify(manifest)); } catch {}
      return manifest;
    },

    _loadCachedManifest() {
      try {
        const raw = localStorage.getItem(CONFIG.cache.manifest);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },

    _loadUserSettings() {
      try {
        const raw = localStorage.getItem(CONFIG.cache.settings);
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    },

    saveUserSetting(id, enabled) {
      const s = this._loadUserSettings();
      s[id] = enabled;
      try { localStorage.setItem(CONFIG.cache.settings, JSON.stringify(s)); } catch {}
    },

    async _loadOne(app, entry) {
      const cacheKey = CONFIG.cache.moduleKey(entry.id, entry.version);
      let source;

      // Try network first
      try {
        const url = `${entry.url}?v=${encodeURIComponent(entry.version)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        source = await res.text();
        try { localStorage.setItem(cacheKey, source); } catch {}
        logger.log(`Module fetched: ${entry.id}@${entry.version}`);
        this._pruneOldCache(entry.id, entry.version);
      } catch (fetchErr) {
        logger.warn(`Module fetch failed (${entry.id}):`, fetchErr.message, '— trying cache');
        source = localStorage.getItem(cacheKey);
        if (!source) {
          return { ok: false, error: `Fetch failed, no cache: ${fetchErr.message}` };
        }
        logger.log(`Module loaded from cache: ${entry.id}@${entry.version}`);
      }

      // Evaluate
      try {
        const fn = new Function(source); // eslint-disable-line no-new-func
        fn();
      } catch (evalErr) {
        return { ok: false, error: `Eval failed: ${evalErr.message}` };
      }

      // Validate
      const mod = window.VoidIdleModules?.[entry.id];
      if (!mod) {
        return {
          ok: false,
          error: `window.VoidIdleModules['${entry.id}'] was not assigned after eval`,
        };
      }
      if (typeof mod.init !== 'function') {
        return { ok: false, error: `Module '${entry.id}' is missing an init() function` };
      }

      // Init
      const ctx = this._buildContext(app, entry);
      try {
        await mod.init(ctx);
        ModuleRegistry.register(entry.id, mod, entry, 'loaded');
        // Add to app.modules so WindowManager.renderTray can build tray buttons.
        // The module object must expose id, name, icon, shortName (shortName is optional).
        app.modules.set(entry.id, mod);
        logger.log(`Module initialized: ${entry.id}`);
        return { ok: true };
      } catch (initErr) {
        try { mod.destroy?.(); } catch {}
        ModuleRegistry.register(entry.id, mod, entry, 'failed', initErr.message);
        return { ok: false, error: `Init failed: ${initErr.message}` };
      }
    },

    _buildContext(app, entry) {
      return {
        events:  app.events,
        socket:  app.socket,
        relay:   app.relay,
        storage: createModuleStorage(entry.id),
        logger:  createLogger(entry.id),
        api:     ApiHelper,
        dom:     DomHelper,
        ui: {
          registerPanel: (config) =>
            WindowManager.registerModulePanel(app, entry.id, config),
          getPanel: (id) =>
            document.getElementById(`vim-panel-${id || entry.id}`),
        },
        meta: {
          id:          entry.id,
          name:        entry.name,
          version:     entry.version,
          description: entry.description || '',
          icon:        entry.icon || '🔧',
        },
      };
    },

    _pruneOldCache(id, currentVersion) {
      const prefix = `voididle.loader.module.${id}@`;
      const current = CONFIG.cache.moduleKey(id, currentVersion);
      const old = Object.keys(localStorage)
        .filter(k => k.startsWith(prefix) && k !== current)
        .sort(); // lexicographic sort works for date-version strings
      // Delete all but the most recent previous version (keep 1 rollback slot)
      old.slice(0, -1).forEach(k => localStorage.removeItem(k));
    },
  };
```

- [ ] **Step 3: Commit**

```bash
git add loader.user.js
git commit -m "feat: add ModuleRegistry and ModuleLoader to loader"
```

---

### Task 9: Add ManagerUI and bootstrap to loader.user.js

**Files:**
- Modify: `loader.user.js` (append, then close the outer IIFE)

- [ ] **Step 1: Append ManagerUI**

```js
  // ─── MANAGER UI ─────────────────────────────────────────────────────────────
  // In-game panel: module list, status, per-module reload, debug log.
  const ManagerUI = {
    _bodyId: `${CONFIG.appId}-manager-body`,

    init(app) {
      app.events.on('loader:manifest',        () => this._refresh(app));
      app.events.on('loader:module:loaded',   () => this._refresh(app));
      app.events.on('loader:module:failed',   () => this._refresh(app));
      app.events.on('loader:module:skipped',  () => this._refresh(app));
      app.events.on('loader:module:reloaded', () => this._refresh(app));
      app.events.on('loader:complete',        () => this._refresh(app));
      app.events.on('loader:error',           () => this._refresh(app));
    },

    _refresh(app) {
      const body = document.getElementById(this._bodyId);
      if (!body) return;
      const html = this._renderBody(app);
      body.innerHTML = html;
      this._attachHandlers(app, body);
    },

    _renderBody(app) {
      const records  = ModuleRegistry.getAll();
      const manifest = ModuleLoader._loadCachedManifest();
      const entries  = manifest?.modules || [];

      const nLoaded = records.filter(r => r.status === 'loaded').length;
      const nFailed = records.filter(r => r.status === 'failed').length;
      const statusText = records.length === 0
        ? 'Loading modules…'
        : `${nLoaded} loaded${nFailed ? ` / ${nFailed} ❌` : ''}`;

      const offlineBadge = ModuleLoader._offline
        ? '<span style="color:#f59e0b;margin-left:6px;">● Offline (cached)</span>'
        : '';

      const rows = entries.map(entry => {
        const rec = ModuleRegistry.get(entry.id);

        if (!rec) {
          const label = entry.enabled ? 'Loading…' : '⏭ Disabled in manifest';
          return `<div class="vim-row">
            <div class="vim-row-main">
              <div class="vim-row-title">${escapeHtml(entry.icon || '')} ${escapeHtml(entry.name)}</div>
              <div class="vim-muted">${label}</div>
            </div>
          </div>`;
        }

        const icon  = rec.status === 'loaded' ? '✅' : '❌';
        const label = rec.status === 'loaded'
          ? `v${escapeHtml(String(rec.entry.version))}`
          : escapeHtml(rec.error || 'error');

        const actionBtn = rec.status === 'loaded'
          ? `<button class="vim-btn" data-vim-open="${escapeHtml(entry.id)}">Open</button>`
          : `<button class="vim-btn" data-vim-details="${escapeHtml(entry.id)}">Details</button>`;

        return `<div class="vim-row">
          <div class="vim-row-main">
            <div class="vim-row-title">${icon} ${escapeHtml(entry.icon || '')} ${escapeHtml(entry.name)}</div>
            <div class="vim-muted">${label}</div>
          </div>
          <div class="vim-actions">
            ${actionBtn}
            <button class="vim-btn" data-vim-reload="${escapeHtml(entry.id)}">↺</button>
          </div>
        </div>`;
      });

      return `
        <div style="margin-bottom:8px;color:rgba(229,231,235,0.7);font-size:11px;">
          ${escapeHtml(statusText)}${offlineBadge}
        </div>
        ${rows.join('')}
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="vim-btn vim-btn-primary" data-vim-reload-all>↺ Reload All</button>
          <button class="vim-btn" data-vim-toggle-log>▾ Debug Log</button>
        </div>
        <div id="${CONFIG.appId}-debug-log"
             style="display:none;margin-top:8px;max-height:180px;overflow-y:auto;
                    font-size:10px;font-family:monospace;background:rgba(0,0,0,0.32);
                    padding:6px;border-radius:6px;white-space:pre-wrap;"></div>
      `;
    },

    _attachHandlers(app, body) {
      // Open a module's panel
      body.querySelectorAll('[data-vim-open]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id    = btn.dataset.vimOpen;
          const panel = document.getElementById(`vim-panel-${id}`);
          if (panel) {
            panel.classList.add('vim-open');
            if (app.settings.panels[id]) {
              app.settings.panels[id].open = true;
              PanelStorage.save(app.settings);
            }
          }
        });
      });

      // Show last error for a failed module
      body.querySelectorAll('[data-vim-details]').forEach(btn => {
        btn.addEventListener('click', () => {
          const rec = ModuleRegistry.get(btn.dataset.vimDetails);
          if (rec?.error) alert(`[${btn.dataset.vimDetails}] ${rec.error}`);
        });
      });

      // Reload one module
      body.querySelectorAll('[data-vim-reload]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.vimReload;
          btn.disabled = true;
          btn.textContent = '…';
          await ModuleLoader.reload(app, id);
          btn.disabled = false;
          btn.textContent = '↺';
        });
      });

      // Reload all modules
      body.querySelector('[data-vim-reload-all]')?.addEventListener('click', async () => {
        const manifest = ModuleLoader._loadCachedManifest();
        if (!manifest) return;
        for (const entry of manifest.modules) {
          await ModuleLoader.reload(app, entry.id);
        }
      });

      // Toggle debug log
      body.querySelector('[data-vim-toggle-log]')?.addEventListener('click', () => {
        const logEl = document.getElementById(`${CONFIG.appId}-debug-log`);
        if (!logEl) return;
        const showing = logEl.style.display !== 'none';
        logEl.style.display = showing ? 'none' : 'block';
        if (!showing) {
          logEl.innerHTML = logger.getLog()
            .map(e => {
              const color = e.level === 'error' ? '#f87171'
                : e.level === 'warn'  ? '#fbbf24'
                : '#9ca3af';
              const time = new Date(e.ts).toLocaleTimeString();
              return `<div style="color:${color}">${escapeHtml(time)} ${escapeHtml(e.line)}</div>`;
            })
            .join('');
          logEl.scrollTop = logEl.scrollHeight;
        }
      });
    },
  };
```

- [ ] **Step 2: Append createApp and the bootstrap IIFE, then close the outer IIFE**

```js
  // ─── APP FACTORY ────────────────────────────────────────────────────────────
  function createApp() {
    const settings = PanelStorage.load();
    const events   = createEventBus();
    return {
      events,
      settings,
      socket: SocketCore,
      relay:  RelayCore,
      config: CONFIG,
      logger,
      // WindowManager.renderAll / renderTray iterate app.modules.values().
      // Remote modules are added here after successful init so tray buttons appear.
      modules: new Map(),
    };
  }

  // ─── BOOTSTRAP ──────────────────────────────────────────────────────────────
  (function bootstrap() {
    // Phase 1 — synchronous. WebSocket hook must be installed before any await.
    window.VoidIdleModules = window.VoidIdleModules || {};
    const app = createApp();
    app.socket.init(app); // patches window.WebSocket NOW

    // Phase 2 — async. Runs after the DOM is available.
    function onReady() {
      Styles.inject();
      WindowManager.init(app);

      // Create the built-in manager panel.
      WindowManager.createPanel(app, {
        id:       `${CONFIG.appId}-manager`,
        icon:     '⚙️',
        title:    `VoidIdle Loader v${CONFIG.version}`,
        bodyHtml: `<div id="${CONFIG.appId}-manager-body">Loading modules…</div>`,
        footer:   'Remote modules loaded from manifest.json',
      });

      ManagerUI.init(app);
      WindowManager.renderAll(app);
      PanelStorage.save(app.settings);

      // Re-render the tray after all modules load so their buttons appear.
      app.events.on('loader:complete', () => WindowManager.renderTray(app));

      // Start async module loading — errors are caught inside, never propagate here.
      ModuleLoader.start(app).catch(err =>
        logger.error('ModuleLoader.start threw unexpectedly:', err.message)
      );
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  })();

})(); // ← closes the loader IIFE
```

- [ ] **Step 3: Commit**

```bash
git add loader.user.js
git commit -m "feat: add ManagerUI, createApp, bootstrap — loader is functionally complete"
git push
```

---

### Task 10: Install and smoke-test the empty loader in Tampermonkey

**Files:**
- Modify: `loader.user.js` — replace `YOUR_USERNAME` with real GitHub username

- [ ] **Step 1: Set real GitHub username in CONFIG.manifestUrl**

In `loader.user.js`, find:
```js
manifestUrl: 'https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/manifest.json',
```
Replace `YOUR_USERNAME` with your actual GitHub username. Commit and push.

```bash
git add loader.user.js
git commit -m "chore: set real manifestUrl"
git push
```

- [ ] **Step 2: Install loader in Tampermonkey**

In your browser, navigate to:
```
https://raw.githubusercontent.com/YOUR_USERNAME/void-userscript-loader/main/loader.user.js
```
Tampermonkey will intercept it and show the install dialog. Click **Install**.

- [ ] **Step 3: Disable the old userscript in Tampermonkey**

Open Tampermonkey Dashboard → find "VoidIdle Master Modular Base" → toggle the enable switch **OFF**. Do not uninstall it yet — keep it as a reference.

- [ ] **Step 4: Open voididle.com and check the browser console**

Expected console output (no modules exist yet so all fail, that is fine):
```
[VoidIdle] ModuleLoader starting…
[VoidIdle] Manifest fetched: 2026-04-30.1
[VoidIdle]:ws-sniffer Module fetch failed (ws-sniffer): HTTP 404 — trying cache
[VoidIdle]:ws-sniffer Module loaded from cache: ...   OR   Fetch failed, no cache: HTTP 404
...
[VoidIdle] Load complete — loaded: 0, failed: 6, skipped: 0
```

- [ ] **Step 5: Verify WebSocket hook is installed**

In the browser console:
```js
window.WebSocket.__voididleMasterHooked // → true
```

- [ ] **Step 6: Verify the manager tray button and panel appear**

A tray button labelled "⚙️" (or the loader icon) should appear in the bottom-right corner. Clicking it should open the manager panel showing "Loading modules…" or the failed module list.

If the panel does not appear, open the console and check for JS errors. The most common cause is a syntax error introduced when copying SocketCore or WindowManager — paste the loader into jshint.com to find it.

---

## Phase 3 — Module Migrations

One module at a time. Test each one before moving to the next. The migration order is safest-first.

---

### Task 11: Migrate ws-sniffer (first module)

**Files:**
- Create: `modules/ws-sniffer.js`

Migration source: `userscript.js` lines 10416–11138 (`createWsSnifferModule` and all its inner helpers).

- [ ] **Step 1: Create modules/ws-sniffer.js**

```js
// modules/ws-sniffer.js
(function () {
  'use strict';

  // ─── PASTE createWsSnifferModule and ALL its private helpers below ───────────
  // Source: userscript.js lines 10416–11138
  // Rule: do NOT change any internal logic in this step.
  // Only required change: if init(app) calls SocketCore.init(app) or patches
  // window.WebSocket directly, DELETE that call — the loader already did it.

  function createWsSnifferModule(definition) {
    // [paste verbatim from userscript.js]
  }
  // ─────────────────────────────────────────────────────────────────────────────

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['ws-sniffer'] = createWsSnifferModule({
    id:          'ws-sniffer',
    name:        'WS Sniffer',
    icon:        '🛰️',
    description: 'Capture WebSocket messages with filters for world boss debugging.',
  });
})();
```

**What to check before saving:**
- Search the pasted `createWsSnifferModule` body for any of these — delete them if found:
  - `SocketCore.init(app)` or `SocketCore.init(this)`
  - `window.WebSocket = ` (any re-patching of WebSocket)
  - Direct `new WebSocket(...)` calls for the game socket (relay connects separately via `app.relay`)

- [ ] **Step 2: Push**

```bash
git add modules/ws-sniffer.js
git commit -m "feat: migrate ws-sniffer module"
git push
```

- [ ] **Step 3: Test in browser**

Reload voididle.com. Expected console:
```
[VoidIdle] Module fetched: ws-sniffer@2026-04-30.1
[VoidIdle] Module initialized: ws-sniffer
```

Open the manager panel → ws-sniffer shows ✅ → click Open → WS Sniffer panel opens and logs socket messages.

- [ ] **Step 4: Debug if ❌ appears**

Click `[Details]` in the manager panel.

| Error message | Fix |
|---|---|
| `window.VoidIdleModules['ws-sniffer'] not assigned after eval` | The `window.VoidIdleModules['ws-sniffer'] = ...` line is missing or uses wrong id |
| `Eval failed: Unexpected token` | Syntax error in the paste — find the module boundary in userscript.js and check for missing `}` |
| `Init failed: app.events is not a function` | Module is using old app shape — check if it expects different property names |
| `Init failed: Cannot read properties of undefined` | A variable from the old global scope is missing — check for standalone references to `SocketCore`, `RelayCore`, `WindowManager` |

- [ ] **Step 5: Remove ws-sniffer factory from loader.user.js**

In `loader.user.js`, delete the `createWsSnifferModule` function and remove `wsSniffer` from `MODULE_DEFINITIONS` (if it still exists there). Do not delete any core infrastructure.

```bash
git add loader.user.js
git commit -m "refactor: remove ws-sniffer from loader (now a remote module)"
git push
```

---

### Task 12: Migrate boss-tracker

**Files:**
- Create: `modules/boss-tracker.js`

Migration source: `userscript.js` lines 11139–end (`createBossTrackerModule`).

- [ ] **Step 1: Create modules/boss-tracker.js**

```js
// modules/boss-tracker.js
(function () {
  'use strict';

  // ─── PASTE createBossTrackerModule and ALL its private helpers below ─────────
  // Source: userscript.js lines 11139 to end of file

  function createBossTrackerModule(definition) {
    // [paste verbatim]
  }
  // ─────────────────────────────────────────────────────────────────────────────

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['boss-tracker'] = createBossTrackerModule({
    id:          'boss-tracker',
    name:        'Boss Tracker',
    icon:        '👑',
    description: 'Tracks world boss history, fighters, and DPS leaderboards.',
  });
})();
```

Apply the same checks as Task 11 Step 1 (no duplicate WebSocket patch, no stale global references).

- [ ] **Step 2: Push, test, confirm ✅ in manager panel**

```bash
git add modules/boss-tracker.js
git commit -m "feat: migrate boss-tracker module"
git push
```

Reload voididle.com. Both ws-sniffer and boss-tracker should show ✅.

- [ ] **Step 3: Remove boss-tracker factory from loader.user.js and commit**

```bash
git add loader.user.js
git commit -m "refactor: remove boss-tracker from loader (now remote)"
git push
```

---

### Task 13: Migrate rune-planner

**Files:**
- Create: `modules/rune-planner.js`

Migration source: `userscript.js` lines 6304–6941 (`createRunePlannerModule`).

- [ ] **Step 1: Create modules/rune-planner.js**

```js
// modules/rune-planner.js
(function () {
  'use strict';

  // ─── PASTE createRunePlannerModule and ALL its private helpers below ─────────
  // Source: userscript.js lines 6304–6941

  function createRunePlannerModule(definition) {
    // [paste verbatim]
  }
  // ─────────────────────────────────────────────────────────────────────────────

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['rune-planner'] = createRunePlannerModule({
    id:          'rune-planner',
    name:        'Rune Planner',
    icon:        '◈',
    description: 'Plan and export rune loadouts by type and tier.',
  });
})();
```

- [ ] **Step 2: Push, test, confirm ✅, remove from loader.user.js, commit**

```bash
git add modules/rune-planner.js
git commit -m "feat: migrate rune-planner module"
git push
# test in browser
git add loader.user.js
git commit -m "refactor: remove rune-planner from loader (now remote)"
git push
```

---

### Task 14: Migrate stat-grabber

**Files:**
- Create: `modules/stat-grabber.js`

Migration source: `userscript.js` lines 6942–10415 (`createStatGrabberModule`). Large module — take care with the boundary.

- [ ] **Step 1: Locate the exact boundary in userscript.js**

In your editor, search for `function createStatGrabberModule` (line 6942). The function ends where `function createWsSnifferModule` begins (line 10416). Copy lines 6942–10414.

- [ ] **Step 2: Create modules/stat-grabber.js**

```js
// modules/stat-grabber.js
(function () {
  'use strict';

  // ─── PASTE createStatGrabberModule and ALL its private helpers below ─────────
  // Source: userscript.js lines 6942–10414

  function createStatGrabberModule(definition) {
    // [paste verbatim]
  }
  // ─────────────────────────────────────────────────────────────────────────────

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['stat-grabber'] = createStatGrabberModule({
    id:          'stat-grabber',
    name:        'Stat Grabber',
    icon:        '📊',
    description: 'Stats, gear comparison, roll quality, filters, and scoring.',
  });
})();
```

- [ ] **Step 3: Push, test, confirm ✅, remove from loader.user.js, commit**

```bash
git add modules/stat-grabber.js
git commit -m "feat: migrate stat-grabber module"
git push
# test in browser — all 4 modules should show ✅
git add loader.user.js
git commit -m "refactor: remove stat-grabber from loader (now remote)"
git push
```

---

### Task 15: Migrate dps-coach

**Files:**
- Create: `modules/dps-coach.js`

Migration source: `userscript.js` lines 1301–5580 (`createDpsCoachModule`). This is the most complex module — it contains relay session logic and references to RelayCore.

- [ ] **Step 1: Scan for stale global references before pasting**

Before creating the file, search the `createDpsCoachModule` body for these identifiers used as standalone globals (not via `app.*`):

```
RelayCore
SocketCore
WindowManager
Storage (capital S)
Styles
MODULE_DEFINITIONS
```

For each one found, replace with the `app.*` equivalent:
- `RelayCore.connect(key)` → `app.relay.connect(key)`
- `RelayCore.disconnect()` → `app.relay.disconnect()`
- `RelayCore.send(payload)` → `app.relay.send(payload)`
- `RelayCore.isConnected()` → `app.relay.isConnected()`
- `SocketCore.xxx` → `app.socket.xxx` (rare)
- `WindowManager.xxx` → the module should use `app.ui.registerPanel` instead

If a reference cannot be cleanly replaced in Phase 1, leave it and add a `// TODO Phase 2:` comment. Phase 1 goal is just to get the module loading — not to be perfect.

- [ ] **Step 2: Create modules/dps-coach.js**

```js
// modules/dps-coach.js
(function () {
  'use strict';

  // ─── PASTE createDpsCoachModule and ALL its private helpers below ────────────
  // Source: userscript.js lines 1301–5580
  // Required: replace any standalone RelayCore/SocketCore/WindowManager references
  // with app.relay / app.socket / app.ui (see Task 15 Step 1 checklist above).

  function createDpsCoachModule(definition) {
    // [paste verbatim, with fixes applied]
  }
  // ─────────────────────────────────────────────────────────────────────────────

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['dps-coach'] = createDpsCoachModule({
    id:          'dps-coach',
    name:        'DPS Coach',
    icon:        '🎯',
    description: 'Personal and team DPS tools.',
  });
})();
```

- [ ] **Step 3: Push, test, confirm ✅, remove from loader.user.js, commit**

```bash
git add modules/dps-coach.js
git commit -m "feat: migrate dps-coach module"
git push
# test in browser — relay connect/disconnect should work
git add loader.user.js
git commit -m "refactor: remove dps-coach from loader (now remote)"
git push
```

---

### Task 16: Migrate item-share

**Files:**
- Create: `modules/item-share.js`

Migration source: `userscript.js` lines 5581–6303 (`createItemShareModule`). Contains mail automation and salvage.

- [ ] **Step 1: Create modules/item-share.js**

```js
// modules/item-share.js
(function () {
  'use strict';

  // ─── PASTE createItemShareModule and ALL its private helpers below ───────────
  // Source: userscript.js lines 5581–6303

  function createItemShareModule(definition) {
    // [paste verbatim]
  }
  // ─────────────────────────────────────────────────────────────────────────────

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['item-share'] = createItemShareModule({
    id:          'item-share',
    name:        'Item Share',
    icon:        '🎁',
    description: 'Item sharing, mail automation, and salvage tools.',
  });
})();
```

- [ ] **Step 2: Fix salvage to use the per-item endpoint**

Find the salvage handler inside the pasted `createItemShareModule`. Look for the function that calls the salvage API. Replace any bulk call with a per-item loop:

```js
// Replace any call to /api/inventory/salvage-selected or similar with this:
async function salvageItems(itemIds, appCtx) {
  const results = [];
  for (const itemId of itemIds) {
    try {
      const res = await appCtx.api.fetch(`/inventory/${itemId}/salvage`, { method: 'POST' });
      appCtx.logger.log(`Salvaged ${itemId}:`, JSON.stringify(res));
      results.push({ itemId, ok: true, res });
    } catch (err) {
      appCtx.logger.error(`Salvage FAILED for ${itemId}:`, err.message);
      results.push({ itemId, ok: false, error: err.message });
    }
  }
  return results;
}
```

If the module does not yet have access to `appCtx` inside its salvage handler (because Phase 1 didn't refactor internals), add a `// TODO Phase 2: wire appCtx.api and appCtx.logger here` comment and leave the existing call in place. The important thing is having the per-item loop available for Phase 2.

- [ ] **Step 3: Push, test, confirm ✅, remove from loader.user.js, commit**

```bash
git add modules/item-share.js
git commit -m "feat: migrate item-share module (+ per-item salvage fix)"
git push
# test in browser — mail and salvage flows
git add loader.user.js
git commit -m "refactor: remove item-share from loader (now remote)"
git push
```

---

## Phase 4 — Final Cleanup

---

### Task 17: Archive the monolith and clean up loader.user.js

**Files:**
- Modify: `loader.user.js`
- Create: `archive/userscript-pre-modular.js`
- Delete: `userscript.js` (after archiving)

- [ ] **Step 1: Verify no module factories remain in loader.user.js**

```bash
grep -n "createDpsCoachModule\|createBossTrackerModule\|createStatGrabberModule\|createItemShareModule\|createRunePlannerModule\|createWsSnifferModule" loader.user.js
```

Expected output: nothing. If any lines are found, remove that factory and its definition row.

- [ ] **Step 2: Remove MODULE_DEFINITIONS from loader.user.js if it still exists**

Search for `const MODULE_DEFINITIONS`. If found, delete it — module metadata now lives exclusively in `manifest.json`.

- [ ] **Step 3: Archive the original monolith**

```bash
cp userscript.js archive/userscript-pre-modular.js
git add archive/userscript-pre-modular.js
```

- [ ] **Step 4: Remove userscript.js from the repo**

```bash
git rm userscript.js
```

- [ ] **Step 5: Final commit and push**

```bash
git add loader.user.js
git commit -m "chore: archive original monolith — Phase 1 migration complete"
git push
```

- [ ] **Step 6: Full browser verification**

Reload voididle.com. Open the browser console and verify:

```
[VoidIdle] ModuleLoader starting…
[VoidIdle] Manifest fetched: 2026-04-30.1
[VoidIdle] Module fetched: ws-sniffer@2026-04-30.1
[VoidIdle] Module initialized: ws-sniffer
[VoidIdle] Module fetched: boss-tracker@2026-04-30.1
[VoidIdle] Module initialized: boss-tracker
[VoidIdle] Module fetched: rune-planner@2026-04-30.1
[VoidIdle] Module initialized: rune-planner
[VoidIdle] Module fetched: stat-grabber@2026-04-30.1
[VoidIdle] Module initialized: stat-grabber
[VoidIdle] Module fetched: dps-coach@2026-04-30.1
[VoidIdle] Module initialized: dps-coach
[VoidIdle] Module fetched: item-share@2026-04-30.1
[VoidIdle] Module initialized: item-share
[VoidIdle] Load complete — loaded: 6, failed: 0, skipped: 0
```

WebSocket hook check:
```js
window.WebSocket.__voididleMasterHooked // → true
```

Manager panel shows all 6 modules as ✅. All module panels open normally.

- [ ] **Step 7: Uninstall the old userscript from Tampermonkey**

Open Tampermonkey Dashboard → find "VoidIdle Master Modular Base" → click **Delete**. The loader now replaces it entirely.

---

## Conventions Reference

| Thing | Convention |
|---|---|
| Bump a module | Edit `version` in that module's `manifest.json` entry |
| Bump manifest | Edit top-level `version` in `manifest.json` |
| Add a new module | Add entry to `manifest.json`, create `modules/{id}.js` |
| Disable a module | Set `"enabled": false` in `manifest.json` (or toggle in-game via manager) |
| Module file name | `kebab-case.js` exactly matching manifest `id` |
| Module storage keys | `voididle.module.{id}.{camelCaseKey}` |
| Loader cache keys | `voididle.loader.*` |
| Socket events | `socket:message`, `socket:any`, `socket:debug` |
| Relay events | `relay:status`, `relay:ready`, `relay:peers`, `relay:{payloadType}` |
| Loader events | `loader:manifest`, `loader:complete`, `loader:module:loaded`, `loader:module:failed` |
| DOM panel IDs | `vim-panel-{moduleId}` |
| CSS classes | `vim-{semanticName}` |
| Log prefix | `[VoidIdle:{moduleId}]` in console |

---

## Phase 2 Notes (not in scope for this plan)

These are explicitly deferred. Do not attempt them during Phase 1.

- Replace per-module `escapeHtml`, `sleep`, `waitForSelector` duplicates with `app.dom.*`
- Replace per-module `localStorage` calls with `app.storage.*`
- Fix scroll position in log panels: preserve `scrollTop` unless user is within 40px of bottom before re-render
- Fully wire `appCtx.api` and `appCtx.logger` into mail and salvage handlers
- Split `item-share` into separate `mail-sender` and `salvage-selected` modules if desired
