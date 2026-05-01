(function () {
  'use strict';

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

    // formatCompact was called in the original monolith but never defined there.
    function formatCompact(value) {
      const n = Number(value || 0);
      if (!Number.isFinite(n)) return "0";
      if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
      if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
      if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return Math.round(n).toLocaleString();
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
      const wbState = inferWorldBossStateFromPayload(wb);
      const parts = [];
      parts.push(wb.name || "World Boss");
      parts.push(wbState);
      if (wb.level != null) parts.push(`Lv ${wb.level}`);
      if (wb.zoneId) parts.push(`zone=${wb.zoneId}`);
      if (wbState === "queued" && wb.fightStartsAt) {
        parts.push(`starts ${formatDateTime(wb.fightStartsAt)}`);
        parts.push(`in ${formatDuration(Number(wb.fightStartsAt) - Date.now())}`);
      }
      if (wbState === "fighting" && wb.hp != null && wb.maxHp != null) {
        parts.push(`HP ${formatCompact(wb.hp)}/${formatCompact(wb.maxHp)}`);
      }
      if (wbState === "corpse" && wb.corpseEndsAt) {
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
          .wss-toolbar { display:flex; flex-wrap:wrap; gap:7px; align-items:center; margin-bottom:9px; }
          .wss-input, .wss-select { background:rgba(0,0,0,0.25); color:#e5e7eb; border:1px solid rgba(255,255,255,0.14); border-radius:7px; padding:5px 7px; font-size:11px; outline:none; }
          .wss-input { min-width:180px; flex:1; }
          .wss-grid { display:grid; grid-template-columns:minmax(260px, 38%) 1fr; gap:9px; min-height:420px; }
          .wss-list, .wss-detail { border:1px solid rgba(255,255,255,0.08); border-radius:10px; background:rgba(255,255,255,0.035); overflow:auto; max-height:490px; overscroll-behavior:contain; scrollbar-gutter:stable; }
          .wss-row { display:grid; grid-template-columns:22px 62px 38px 1fr; gap:6px; padding:7px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer; }
          .wss-row:hover { background:rgba(255,255,255,0.055); }
          .wss-row.active { background:rgba(56,189,248,0.13); }
          .wss-time { color:rgba(229,231,235,0.55); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:10px; }
          .wss-dir-in { color:#4ade80; font-weight:800; }
          .wss-dir-out { color:#60a5fa; font-weight:800; }
          .wss-wb { color:#fbbf24; font-weight:800; }
          .wss-muted { color:rgba(229,231,235,0.55); }
          .wss-summary { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .wss-pre { margin:0; padding:10px; white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; line-height:1.35; color:rgba(229,231,235,0.82); }
          .wss-card { padding:9px; border-bottom:1px solid rgba(255,255,255,0.08); }
          @media (max-width: 800px) { .wss-grid { grid-template-columns:1fr; } }
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
            `).join("") : `<div class="wss-card wss-muted">No messages match this filter yet.</div>`}
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
      const panel = app.ui.getPanel(definition.id);
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
      if (!firstVisible) return { id: "", offset: 0, scrollTop };
      return { id: firstVisible.getAttribute(idAttr) || "", offset: firstVisible.offsetTop - scrollTop, scrollTop };
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
      const panel = app.ui.getPanel(definition.id);
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
        if (!app.ui.isPanelEnabled(definition.id)) return;
        renderIntoPanel(app);
      }, 350);
    }

    return {
      ...definition,

      init(app) {
        loadSettings();

        app.ui.registerPanel({
          id:     definition.id,
          title:  definition.name,
          icon:   definition.icon || '🛰️',
          render: () => render(),
          footer: '',
        });

        app.events.on("socket:debug", (entry) => {
          if (!app.ui.isPanelEnabled(definition.id)) return;
          addEntry(entry);
          queueRender(app);
        });
      },

      render() {
        return render();
      },
    };
  }

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['ws-sniffer'] = createWsSnifferModule({
    id:          'ws-sniffer',
    name:        'WS Sniffer',
    icon:        '🛰️',
    description: 'Capture WebSocket messages with filters for world boss debugging.',
  });
})();
