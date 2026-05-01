(function () {
  'use strict';
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
    const panel = app.ui.getPanel(definition.id);
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
      app.ui.registerPanel({
        id: definition.id,
        title: definition.name,
        icon: definition.icon || '📊',
        render: () => render(),
        footer: '',
      });

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
        if (!app.ui.isPanelEnabled(definition.id)) return;
        tick(app);
      }, 1000);
    },

    render() {
      return render();
    },
  };

  }

  window.VoidIdleModules = window.VoidIdleModules || {};
  window.VoidIdleModules['stat-grabber'] = createStatGrabberModule({
    id: 'stat-grabber',
    name: 'Stat Grabber',
    icon: '📊',
    description: 'Fetches and displays player stats, gear, and inventory data.',
  });
})();