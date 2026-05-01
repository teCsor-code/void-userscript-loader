(function () {
  'use strict';

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
                const panel = app.ui.getPanel(definition.id);
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
            const panel = app.ui.getPanel(definition.id);
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
                if (!app.ui.isPanelEnabled(definition.id)) return;

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

                app.ui.registerPanel({
                    id:     definition.id,
                    title:  definition.name,
                    icon:   definition.icon || '👑',
                    render: () => render(),
                    footer: '',
                });

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
                    if (!app.ui.isPanelEnabled(definition.id)) return;

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

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['boss-tracker'] = createBossTrackerModule({
    id:          'boss-tracker',
    name:        'Boss Tracker',
    icon:        '👑',
    description: 'Tracks world boss history, fighters, and DPS leaderboards.',
  });
})();
