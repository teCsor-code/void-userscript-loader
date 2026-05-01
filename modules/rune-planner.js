(function () {
  'use strict';

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
          background:rgba(255,255,255,0.03);
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
      const panel = app.ui.getPanel(definition.id);
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
      const panel = app.ui.getPanel(definition.id);
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
        app.ui.registerPanel({
          id: definition.id,
          title: definition.name,
          icon: definition.icon || '◈',
          render: () => render(),
          footer: '',
        });
        queueRender(app);
      },

      render() {
        return render();
      },
    };
  }

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['rune-planner'] = createRunePlannerModule({
    id: 'rune-planner',
    name: 'Rune Planner',
    icon: '◈',
    description: 'Plan rune loadouts by type and tier, then copy the list for Discord or notes.',
  });
})();
