# VoidIdle Userscript Modular Architecture — Design Spec
**Date:** 2026-04-30  
**Status:** Approved  
**Author:** Josep (with Claude)

---

## Overview

Refactor the existing 13,467-line monolithic Tampermonkey userscript into a modular architecture. A stable core is embedded in a single `loader.user.js` Tampermonkey file. Feature modules live as separate `.js` files hosted on GitHub, discovered via a `manifest.json` registry, and loaded dynamically at runtime.

**Goals:**
- Keep Tampermonkey as the only required browser extension
- One `.user.js` file to install; updates to feature modules require no reinstall
- Modules can be added, disabled, or replaced without touching the loader
- One broken module must not break the rest
- WebSocket interception runs before the game opens its socket connection
- Free hosting via GitHub raw / GitHub Pages

**Non-goals (Phase 1):**
- Rewriting feature logic
- Removing per-module helper duplication
- Build steps, npm, TypeScript

---

## Repository Structure

```
void-userscript-loader/               ← GitHub repo (new)
├── loader.user.js                    ← Tampermonkey install file (core embedded)
├── manifest.json                     ← Module registry; only file to edit for updates
├── modules/
│   ├── dps-coach.js
│   ├── boss-tracker.js
│   ├── zone-tracker.js
│   ├── stat-grabber.js
│   ├── gear-scoring.js
│   ├── mail-sender.js
│   ├── salvage-selected.js
│   └── ws-sniffer.js
└── README.md
```

---

## Startup Sequence

### Phase 1 — Synchronous (document-start, no awaits)
1. Install WebSocket hook (`SocketCore.init`) — **must be first**, before any async work
2. Create `EventBus`
3. Create `app` shell object

### Phase 2 — Async (DOMContentLoaded)
4. Inject base styles
5. Initialize `WindowManager`
6. Show manager panel with "Loading modules…" state
7. Fetch `manifest.json?v={manifestVersion}`
   - Success → parse, save to `localStorage` cache
   - Failure → load from `localStorage` cache
     - Cache hit → use cache, show amber "offline" warning in manager panel
     - Cache miss → show error, halt module loading
8. For each `enabled: true` module in manifest (in declaration order):
   - Fetch `url?v={module.version}`
     - Success → save to per-module `localStorage` cache
     - Failure → try `localStorage` cache for `{id}@{version}`
   - `new Function(code)()` to evaluate
   - Validate `window.VoidIdleModules[id]` exists and has `init` function
   - `try { module.init(appContext) }` — error isolated per module
     - Success → register in `ModuleRegistry`, mark ✅ in manager
     - Failure → call `destroy()` if present, log error, mark ❌ in manager, continue
9. Manager panel updates to final state

**Key invariant:** Steps 1–3 are synchronous and complete before any `fetch` or `await`.

---

## Core Sections in loader.user.js

| Section | Responsibility |
|---|---|
| `CONFIG` | appId, manifest URL, storage keys, log prefix |
| `Logger` | Prefixed console wrapper + in-game ring buffer (last 100 lines) |
| `EventBus` | `on(type, handler)` / `off` / `emit`; per-handler error isolation |
| `Storage` | `localStorage` helpers + `deepMerge` |
| `SocketCore` | Patches `window.WebSocket`; emits `socket:message`, `socket:any`, `socket:debug` |
| `RelayCore` | WSS relay client; emits `relay:*` events; auto-reconnects |
| `DomHelper` | `waitForSelector`, `clickByText`, `clickButtonByText`, `setNativeInputValue`, `waitForStableElement`, `sleep` |
| `ApiHelper` | `fetch` wrapper that reads auth from game's live cookies/headers (no hardcoded tokens) |
| `Styles` | Base CSS for all panels (`.vim-panel`, `.vim-btn`, etc.) |
| `WindowManager` | Panel create/open/close/drag/resize/tray buttons |
| `ModuleLoader` | Fetch manifest → fetch modules → eval → validate → init |
| `ModuleRegistry` | `Map` of loaded module instances + per-module error state |
| `ManagerUI` | In-game panel: module list, status, reload, error log |

---

## AppContext

Every module receives an `appContext` object in `init(app)`:

```js
{
  events,      // EventBus  — on(type, handler) returns unsub fn
  socket,      // SocketCore — use via events, not direct
  relay,       // RelayCore  — connect(roomKey) / disconnect() / send(payload)
  storage,     // Namespaced to module: get(key, fallback) / set(key, val) / remove(key) / clear()
  logger,      // Namespaced to module: log(...) / warn(...) / error(...)
  api,         // ApiHelper  — fetch(path, options) using game session
  dom,         // DomHelper  — waitForSelector / clickByText / etc.
  ui: {
    registerPanel(config),   // add resizable/draggable panel to WindowManager
    getPanel(id),            // get panel DOM element
  },
  meta: {                    // from manifest entry
    id, name, version, description
  }
}
```

### Namespacing

Storage keys are automatically prefixed: `voididle.module.{id}.{key}`  
Logger prefixes all output: `[VoidIdle:{id}]`  
Modules cannot read or write each other's storage keys.

---

## Module Contract

### File shape

```js
// modules/dps-coach.js
(function () {
  'use strict';

  function createDpsCoachModule(def) {
    let _app;
    const _unsubs = [];

    return {
      id:          def.id,
      name:        def.name,
      icon:        def.icon        || '🎯',
      description: def.description || '',

      init(app) {
        _app = app;
        _unsubs.push(app.events.on('socket:message', onMessage));
        // render() is passed to registerPanel; WindowManager calls it when building panel HTML
        app.ui.registerPanel({ id: def.id, title: def.name, render });
      },

      destroy() {
        _unsubs.forEach(fn => fn());
        _unsubs.length = 0;
      },

      // Exposed as a method for convenience; WindowManager calls this via registerPanel config
      render() {
        return '<div>…</div>';
      }
    };

    function onMessage(msg) { /* … */ }
  }

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['dps-coach'] = createDpsCoachModule({
    id: 'dps-coach',
    name: 'DPS Coach',
    icon: '🎯',
    description: 'Personal and team DPS tools.'
  });
})();
```

### Rules for module authors
- Assign to `window.VoidIdleModules[id]` — `id` must exactly match the manifest entry
- Must export `id` (string) and `init(app)` (function)
- `destroy()` is expected — loader calls it on reload/disable
- Communicate with other modules only via `app.events`, never direct references
- Use `app.storage` for persistent state (survives page reload)
- Use closure variables for ephemeral state (lost on module reload)
- Do not patch `window.WebSocket` — use `app.events.on('socket:message', …)`

---

## Manifest Schema

```json
{
  "version": "2026-04-30.1",
  "manifestUrl": "https://raw.githubusercontent.com/<user>/<repo>/main/manifest.json",
  "modules": [
    {
      "id": "dps-coach",
      "name": "DPS Coach",
      "url": "https://raw.githubusercontent.com/<user>/<repo>/main/modules/dps-coach.js",
      "version": "2026-04-30.1",
      "enabled": true,
      "dependencies": ["core"],
      "description": "Personal and team DPS tools.",
      "icon": "🎯"
    }
  ]
}
```

**Cache busting:** the loader appends `?v={module.version}` to every fetch URL. To force a re-fetch, bump the `version` field in `manifest.json`. The manifest itself is fetched using the top-level `version` field.

**Dependencies:** `"core"` is always considered satisfied (it is embedded in the loader). Any other dependency ID must refer to a module `id` that has already loaded successfully. If a dependency is not yet loaded, the loader defers the dependent module to the end of the load queue and retries once. If still unmet, the module is skipped and marked ❌.

**User overrides:** the loader stores per-module enabled/disabled overrides in `localStorage` (`voididle.loader.settings.v1`). User overrides take precedence over manifest `enabled` field.

---

## Error Isolation

| Layer | Mechanism |
|---|---|
| Manifest fetch failure | Falls back to `localStorage` cache; shows amber "offline" status |
| Module fetch failure | Falls back to module-specific `localStorage` cache; marks ⚠️ if stale |
| Module eval failure | `try/catch` around `new Function(code)()`; marks ❌, continues loop |
| Module init failure | `try/catch`; calls `destroy()` if present; marks ❌, continues loop |
| Module runtime error | `EventBus` catches per-handler errors, logs them, does not rethrow |
| RelayCore/SocketCore error | Already isolated internally; never propagates to modules |

---

## localStorage Cache Keys

| Key | Content |
|---|---|
| `voididle.loader.manifest.v1` | Last successful manifest JSON string |
| `voididle.loader.module.{id}@{ver}` | Source code string for that exact module version |
| `voididle.loader.settings.v1` | User-level module enabled/disabled overrides |

**Pruning:** when a module loads successfully at a new version, cache entries for versions older than the previous one are deleted (keep at most 2 versions per module).

---

## Manager UI

```
╔══ VoidIdle Loader v2026-04-30.1 ═══════════════════╗
║  Manifest: 2026-04-30.1    5 loaded / 1 ❌          ║
╠═════════════════════════════════════════════════════╣
║  ✅ DPS Coach       v2026-04-30.1  [Open] [↺]       ║
║  ✅ Boss Tracker    v2026-04-30.1  [Open] [↺]       ║
║  ❌ Stat Grabber    init failed    [Details] [↺]    ║
║  ⏭  WS Sniffer     disabled                        ║
╠═════════════════════════════════════════════════════╣
║  [↺ Reload All]                   [▾ Debug Log]     ║
╚═════════════════════════════════════════════════════╝
```

- `[↺]` per module: calls `destroy()`, re-fetches (network then cache), re-evals, re-inits
- `[↺ Reload All]`: same for all modules in sequence
- `[Details]`: expands last error message inline (no popup)
- `[▾ Debug Log]`: collapsible panel showing last 100 loader log lines
- Offline mode: status bar turns amber, shows "Using cached modules (offline)"
- Module rows are rendered from `ModuleRegistry` state, not re-fetched on each render

---

## Migration Plan

### Phase 1 — Mechanical split (low risk, no logic changes)

For each module factory (`createDpsCoachModule`, `createBossTrackerModule`, etc.):
1. Create GitHub repo (`void-userscript-loader`)
2. Copy the factory function + all its private helpers verbatim into `modules/{id}.js`
3. Wrap in `(function () { 'use strict'; … })();`
4. Add `window.VoidIdleModules['{id}'] = createXxxModule({…})` at the bottom
5. Add the manifest entry to `manifest.json`
6. Strip the factory from `loader.user.js`
7. Test one module at a time before moving to the next

Migration order (safest first):
1. `ws-sniffer` — self-contained, no DOM sequencing
2. `boss-tracker` — read-only data display
3. `zone-tracker` — similar
4. `stat-grabber` — more complex but still read-mostly
5. `dps-coach` — complex, has relay logic
6. `gear-scoring` — can be part of stat-grabber or separate
7. `mail-sender` — complex DOM sequencing, migrate last
8. `salvage-selected` — fix per-item endpoint during migration

### Phase 2 — Adopt shared helpers (after Phase 1 is stable)

- Replace per-module `escapeHtml`, `sleep`, `waitForSelector` with `app.dom.*`
- Replace per-module `localStorage` reads with `app.storage.*`
- Fix scroll position: log panels must preserve `scrollTop` unless user is within 40px of bottom
- Fix mail automation DOM sequencing using `app.dom.waitForSelector` + `app.dom.waitForStableElement`
- Fix salvage to call `/api/inventory/{itemId}/salvage` per item with per-item logging

**Phase 2 is not required to ship Phase 1.** The split is valid even if modules still contain internal copies of helpers.

---

## Conventions

| Thing | Convention |
|---|---|
| Module file names | `kebab-case.js` matching manifest `id` |
| Module IDs | `kebab-case`, matches `window.VoidIdleModules` key |
| Storage keys | `voididle.module.{id}.{camelCaseKey}` |
| Event names | `socket:message`, `relay:status`, `module:{id}:{event}` |
| DOM element IDs | `vim-{moduleId}-{element}` |
| CSS classes | `vim-{semanticName}` |
| Log prefix | `[VoidIdle:{id}]` |
| Panel `data-` attrs | `data-vim-module="{id}"` |

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Core vs remote split | Core embedded in loader; only feature modules are remote |
| Cache busting | `manifest.json` version field; `?v={version}` query param on module URLs |
| Module contract | Option C: module object pattern, IIFE assigns to `window.VoidIdleModules[id]` |
| Eval mechanism | `new Function(code)()` — sync, no CSP issues on voididle.com |
| Module loading | fetch → cache → eval → validate → init, error-isolated per module |
