(function () {
  'use strict';

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
            const panel = app.ui.getPanel(definition.id);
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
            const panel = app.ui.getPanel(definition.id);
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
                app.ui.registerPanel({
                  id: definition.id,
                  title: definition.name,
                  icon: definition.icon || '🔗',
                  render: () => render(),
                  footer: '',
                });

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
                    if (!app.ui.isPanelEnabled(definition.id)) return;

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

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['item-share'] = createItemShareModule({
    id: 'item-share',
    name: 'Item Share',
    icon: '🔗',
    description: 'Share and compare item tooltips in chat and party.',
  });
})();