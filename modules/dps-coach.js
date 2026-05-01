(function () {
  'use strict';

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
            const panel = app.ui.getPanel(definition.id);
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
            const panel = app.ui.getPanel(definition.id);
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
            const panel = app.ui.getPanel(definition.id);
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

                const panel = app.ui.getPanel(definition.id);
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
                app.ui.registerPanel({
                  id: definition.id,
                  title: definition.name,
                  icon: definition.icon || '🎯',
                  render: () => render(),
                  footer: '',
                });

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

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['dps-coach'] = createDpsCoachModule({
    id: 'dps-coach',
    name: 'DPS Coach',
    icon: '🎯',
    description: 'Personal and team DPS tracking with relay support.',
  });
})();