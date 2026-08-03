import { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Search, Swords, TrendingUp, TrendingDown, Loader2, Info,
  ChevronDown, ArrowUpDown, ZoomIn, ZoomOut, RotateCcw,
  IdCard, Network, Table2, Crown, Star, X, Plus, Users, Sparkles,
  Home, Menu, ArrowRight, ShoppingBag, BarChart3, User, MessageCircleQuestion, Lock,
  GitCompare, BookOpen, History, Gem, Check, Handshake,
} from "lucide-react";

/* ---------- shared design tokens ---------- */

const ATTR = {
  str: { label: "Сила", color: "#E2574C" },
  agi: { label: "Ловкость", color: "#5FCB8E" },
  int: { label: "Интеллект", color: "#5B9FE0" },
  all: { label: "Универсал", color: "#C084FC" },
};

const ROLE_RU = {
  Carry: "Керри", Support: "Саппорт", Nuker: "Нюкер", Disabler: "Дизейблер",
  Jungler: "Джанглер", Durable: "Танк", Escape: "Побег", Pusher: "Пушер",
  Initiator: "Инициатор",
};

function img(path) {
  return `https://cdn.cloudflare.steamstatic.com${path}`;
}

/* ---------- shared UI: skeletons + toasts ---------- */

function SkeletonLine({ width = "100%", height = 12, style }) {
  return <div className="skeleton" style={{ width, height, borderRadius: 6, ...style }} />;
}

function SkeletonRows({ count = 5 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SkeletonLine width={22} height={22} style={{ borderRadius: 4, flexShrink: 0 }} />
          <SkeletonLine width={`${45 + ((i * 13) % 35)}%`} />
          <SkeletonLine width={38} style={{ marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}

function SkeletonBlock({ height = 200 }) {
  return <div className="skeleton" style={{ width: "100%", height, borderRadius: 10 }} />;
}

// module-level pub/sub so any hook can raise a toast without prop drilling
let toastListener = null;
function notify(message) {
  if (toastListener) toastListener(message);
}

function Toast({ message, onClose }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [message, onClose]);

  if (!message) return null;
  return (
    <div style={styles.toast} role="status">
      <Info size={15} color="#E2574C" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{message}</span>
      <button style={styles.toastClose} onClick={onClose} aria-label="Закрыть"><X size={14} /></button>
    </div>
  );
}

function HeroIcon({ hero, field = "icon", style, alt }) {
  const [failed, setFailed] = useState(false);
  if (!hero) return <span style={{ ...style, background: "#2A1A40", display: "inline-block" }} />;
  const a = ATTR[hero.primary_attr] || ATTR.all;
  if (failed) {
    return (
      <div
        style={{
          ...style,
          background: `linear-gradient(135deg, ${a.color}, #6D28D9)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#0A0611",
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 700,
          fontSize: (parseInt(style?.width, 10) || 24) * 0.5,
          flexShrink: 0,
        }}
      >
        {hero.localized_name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={img(hero[field])}
      alt={alt || ""}
      style={style}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function counterScore(winRate) {
  const deviation = Math.abs(winRate - 0.5);
  return Math.min(100, Math.round(deviation * 500));
}

/* ---------- localStorage-backed cache (survives page reloads, TTL-based) ---------- */

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function readLocalCache(key, ttlMs = CACHE_TTL_MS) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttlMs) return null;
    return data;
  } catch {
    return null;
  }
}

function writeLocalCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // storage full or unavailable — silently skip, network fetch still works
  }
}

/* ---------- shared matchups cache (persists across tab switches + reloads) ---------- */

const matchupsCache = new Map();

/* OpenDota's free tier rate-limits bulk requests. Without pacing, a burst gets 429s
   and heroes silently end up with no matchup data (= no edges in the graph).
   This paces requests inside a rolling window and retries once on 429. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 45;
const rateTimestamps = [];

async function rateLimitedFetch(url, attempt = 0) {
  const now = Date.now();
  while (rateTimestamps.length && now - rateTimestamps[0] > RATE_WINDOW_MS) rateTimestamps.shift();
  if (rateTimestamps.length >= RATE_MAX) {
    const waitMs = RATE_WINDOW_MS - (now - rateTimestamps[0]) + 50;
    await new Promise((res) => setTimeout(res, waitMs));
    return rateLimitedFetch(url, attempt);
  }
  rateTimestamps.push(Date.now());
  const r = await fetch(url);
  if (r.status === 429 && attempt < 2) {
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    return rateLimitedFetch(url, attempt + 1);
  }
  return r;
}

async function getMatchups(heroId) {
  if (matchupsCache.has(heroId)) return matchupsCache.get(heroId);
  const cacheKey = `dw_matchups_${heroId}`;
  const cached = readLocalCache(cacheKey);
  if (cached) {
    matchupsCache.set(heroId, cached);
    return cached;
  }
  const r = await rateLimitedFetch(`https://api.opendota.com/api/heroes/${heroId}/matchups`);
  if (!r.ok) throw new Error("network");
  const data = await r.json();
  matchupsCache.set(heroId, data);
  matchupsMeta.set(heroId, { source: "pro", scope: "про-матчи", stale: false, fetchedAt: Date.now() });
  writeLocalCache(cacheKey, data);
  return data;
}

/* Matchups from ordinary public games, via STRATZ (our backend holds the token).
   OpenDota's endpoint only covers pro matches, which is a tiny and unrepresentative
   sample, so public is the default everywhere and pro is an explicit choice. */
const publicMatchupsCache = new Map();
/* Что именно показано: охват выборки и не устаревшая ли копия. Без этого два человека
   могли видеть разные цифры и не понимать почему. */
const matchupsMeta = new Map();

async function getPublicMatchups(heroId) {
  if (publicMatchupsCache.has(heroId)) return publicMatchupsCache.get(heroId);
  const cacheKey = `dw_stratz_mu_${heroId}`;
  const cached = readLocalCache(cacheKey, CACHE_TTL_MS);
  if (cached && cached.rows) {
    publicMatchupsCache.set(heroId, cached.rows);
    matchupsMeta.set(heroId, cached.meta || null);
    return cached.rows;
  }

  const r = await fetch(`/api/stratz-matchups?heroId=${heroId}`);
  const json = await r.json().catch(() => null);
  if (!r.ok || !json || !json.rows) {
    const err = new Error("stratz failed");
    err.detail = json && (json.detail || json.error) ? String(json.detail || json.error) : `HTTP ${r.status}`;
    throw err;
  }

  const meta = { source: "public", scope: json.scope || null, stale: !!json.stale, fetchedAt: Date.now() };
  publicMatchupsCache.set(heroId, json.rows);
  matchupsMeta.set(heroId, meta);
  try {
    writeLocalCache(cacheKey, { rows: json.rows, meta });
  } catch {
    // quota — refetched next session, backend still caches it
  }
  return json.rows;
}

/* source: "public" (STRATZ, ordinary games) or "pro" (OpenDota pro matches) */
function useMatchups(heroId, source = "public", refreshKey = 0) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  useEffect(() => {
    if (!heroId) return;

    const memCache = source === "pro" ? matchupsCache : publicMatchupsCache;
    if (memCache.has(heroId)) {
      setState({ loading: false, data: memCache.get(heroId), error: null });
      return;
    }

    let cancelled = false;
    setState({ loading: true, data: null, error: null });

    const load = source === "pro" ? getMatchups(heroId) : getPublicMatchups(heroId);
    load
      .then((data) => {
        if (!cancelled) {
          setState({ loading: false, data, error: null, fellBack: false, meta: matchupsMeta.get(heroId) || null });
        }
      })
      .catch((e) => {
        // if the public source isn't available yet, show pro data rather than an empty table
        if (source === "pro") {
          if (!cancelled) {
            setState({ loading: false, data: null, error: "Не удалось загрузить матчапы." });
          }
          return;
        }
        getMatchups(heroId)
          .then((data) => {
            if (!cancelled) {
              setState({
                loading: false,
                data,
                error: null,
                fellBack: true,
                fallbackReason: e && e.detail ? String(e.detail) : null,
                meta: matchupsMeta.get(heroId) || null,
              });
            }
          })
          .catch(() => {
            if (!cancelled) {
              setState({
                loading: false,
                data: null,
                error: `Не удалось загрузить матчапы${e && e.detail ? `: ${e.detail}` : ""}`,
              });
            }
          });
      });

    return () => {
      cancelled = true;
    };
  }, [heroId, source, refreshKey]);
  return state;
}

/* ---------- item catalog (dotaconstants) + item popularity per hero (OpenDota, real purchase data) ---------- */

let itemsCatalogPromise = null;

async function getItemsCatalog() {
  if (itemsCatalogPromise) return itemsCatalogPromise;
  const cached = readLocalCache("dw_items_catalog");
  if (cached) {
    itemsCatalogPromise = Promise.resolve(cached);
    return cached;
  }
  itemsCatalogPromise = (async () => {
    const [itemsRes, idsRes] = await Promise.all([
      fetch("https://unpkg.com/dotaconstants@latest/build/items.json"),
      fetch("https://unpkg.com/dotaconstants@latest/build/item_ids.json"),
    ]);
    if (!itemsRes.ok || !idsRes.ok) throw new Error("network");
    const items = await itemsRes.json(); // { item_key: { dname, cost, img, ... } }
    const ids = await idsRes.json(); // { "1": "blink", "2": "blades_of_attack", ... }
    const data = { items, ids };
    writeLocalCache("dw_items_catalog", data);
    return data;
  })();
  return itemsCatalogPromise;
}

let patchNotesPromise = null;

async function getPatchNotes() {
  if (patchNotesPromise) return patchNotesPromise;
  const cached = readLocalCache("dw_patchnotes");
  if (cached) {
    patchNotesPromise = Promise.resolve(cached);
    return cached;
  }
  patchNotesPromise = (async () => {
    const r = await fetch("https://unpkg.com/dotaconstants@latest/build/patchnotes.json");
    if (!r.ok) throw new Error("network");
    const data = await r.json();
    try {
      writeLocalCache("dw_patchnotes", data);
    } catch {
      // may exceed storage quota — fine, we just refetch next time
    }
    return data;
  })();
  return patchNotesPromise;
}

/* patchnotes.json groups changes by patch, then by hero/item key. The exact nesting has
   changed across versions, so this flattens whatever shape it finds into printable lines
   instead of assuming one structure. */
/* Структура patchnotes.json менялась между версиями, поэтому вытаскиваем все строковые
   значения из любой вложенности, а не рассчитываем на конкретную форму. */
function flattenPatchSection(value, depth = 0) {
  if (value == null || depth > 6) return [];
  if (typeof value === "string") {
    const s = value.trim();
    return s ? [s] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap((v) => flattenPatchSection(v, depth + 1));
  if (typeof value === "object") {
    // у объектов-заметок текст лежит в одном из этих полей
    const direct = value.note ?? value.info ?? value.text ?? value.description;
    if (typeof direct === "string" && direct.trim()) return [direct.trim()];
    return Object.values(value).flatMap((v) => flattenPatchSection(v, depth + 1));
  }
  return [];
}

/* Valve ships an official Russian localization. The raw file is several MB of KeyValues,
   so we parse it once, keep only ability/item name+description keys, and cache that subset.
   Loaded lazily (only when the reference tab asks for it) and always optional: if anything
   fails, the UI falls back to the English names from dotaconstants. */
let ruLocalePromise = null;

function resetRuLocale() {
  ruLocalePromise = null;
}

/* Загружается в два этапа: сначала лёгкие названия предметов и героев (появляются почти
   сразу), затем описания способностей — они весят заметно больше. Таймаут охватывает и
   чтение тела ответа: раньше он снимался раньше времени и загрузка могла висеть вечно. */
async function fetchRuPart(part, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`/api/ru-names?part=${part}`, { signal: controller.signal });
    const json = await r.json().catch(() => null);
    if (!r.ok || !json) {
      const detail =
        json && json.diagnostics
          ? Object.entries(json.diagnostics).map(([k, v]) => `${k}: ${v}`)
          : [`HTTP ${r.status}`];
      throw Object.assign(new Error("part failed"), { tried: detail });
    }
    return json;
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw Object.assign(new Error("timeout"), { tried: [`${part}: превышено время ожидания`] });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getRuLocale(onPartial) {
  if (ruLocalePromise) return ruLocalePromise;

  const cached = readLocalCache("dw_ru_all_v2");
  const cachedIsUsable =
    cached && (Object.keys(cached.items || {}).length > 0 || Object.keys(cached.abilities || {}).length > 0);
  if (cachedIsUsable) {
    ruLocalePromise = Promise.resolve(cached);
    return cached;
  }

  ruLocalePromise = (async () => {
    const names = await fetchRuPart("names", 25000);

    const partial = {
      partial: true,
      items: names.items || {},
      itemDescriptions: names.itemDescriptions || {},
      heroes: names.heroes || {},
      abilities: {},
      counts: { items: Object.keys(names.items || {}).length, heroes: Object.keys(names.heroes || {}).length, abilities: 0 },
      diagnostics: names.diagnostics || {},
    };
    if (onPartial) onPartial(partial);

    // описания способностей грузим следом; если не выйдет — оставляем то, что уже есть
    let abilities = {};
    let abilitiesError = null;
    try {
      const ab = await fetchRuPart("abilities", 40000);
      abilities = ab.abilities || {};
    } catch (e) {
      abilitiesError = e && e.tried ? e.tried.join(" | ") : "не загрузились";
    }

    const data = {
      items: partial.items,
      itemDescriptions: partial.itemDescriptions,
      heroes: partial.heroes,
      abilities,
      counts: {
        items: Object.keys(partial.items).length,
        heroes: Object.keys(partial.heroes).length,
        abilities: Object.keys(abilities).length,
      },
      diagnostics: abilitiesError
        ? { ...partial.diagnostics, abilities: abilitiesError }
        : partial.diagnostics,
    };

    const hasContent = data.counts.items > 0 || data.counts.abilities > 0;
    if (hasContent) {
      try {
        writeLocalCache("dw_ru_all_v2", data);
      } catch {
        // quota — server still caches it
      }
    }
    return data;
  })();

  ruLocalePromise.catch(() => {
    ruLocalePromise = null;
  });
  return ruLocalePromise;
}

function ruName(ru, key, isItem) {
  if (!ru) return null;
  if (isItem) return ru.items?.[key] || null;
  return ru.abilities?.[`n:${key}`] || null;
}

function ruDesc(ru, key, isItem) {
  if (!ru) return null;
  if (isItem) return ru.itemDescriptions?.[key] || null;
  return ru.abilities?.[`d:${key}`] || null;
}

let abilitiesCatalogPromise = null;

async function getAbilitiesCatalog() {
  if (abilitiesCatalogPromise) return abilitiesCatalogPromise;
  const cached = readLocalCache("dw_abilities_catalog");
  if (cached) {
    abilitiesCatalogPromise = Promise.resolve(cached);
    return cached;
  }
  abilitiesCatalogPromise = (async () => {
    const [abRes, heroAbRes] = await Promise.all([
      fetch("https://unpkg.com/dotaconstants@latest/build/abilities.json"),
      fetch("https://unpkg.com/dotaconstants@latest/build/hero_abilities.json"),
    ]);
    if (!abRes.ok || !heroAbRes.ok) throw new Error("network");
    const abilities = await abRes.json(); // { ability_key: { dname, desc, img, ... } }
    const heroAbilities = await heroAbRes.json(); // { npc_dota_hero_x: { abilities: [...], talents: [...] } }
    const data = { abilities, heroAbilities };
    writeLocalCache("dw_abilities_catalog", data);
    return data;
  })();
  return abilitiesCatalogPromise;
}

const itemPopularityCache = new Map();

async function getItemPopularity(heroId) {
  if (itemPopularityCache.has(heroId)) return itemPopularityCache.get(heroId);
  const cacheKey = `dw_itempop_${heroId}`;
  const cached = readLocalCache(cacheKey);
  if (cached) {
    itemPopularityCache.set(heroId, cached);
    return cached;
  }
  const r = await fetch(`https://api.opendota.com/api/heroes/${heroId}/itemPopularity`);
  if (!r.ok) throw new Error("network");
  const data = await r.json();
  itemPopularityCache.set(heroId, data);
  writeLocalCache(cacheKey, data);
  return data;
}

function useHeroItems(heroId) {
  const [state, setState] = useState({ loading: false, popularity: null, catalog: null, error: null });
  useEffect(() => {
    if (!heroId) return;
    let cancelled = false;
    setState({ loading: true, popularity: null, catalog: null, error: null });
    Promise.all([getItemPopularity(heroId), getItemsCatalog()])
      .then(([popularity, catalog]) => {
        if (!cancelled) setState({ loading: false, popularity, catalog, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ loading: false, popularity: null, catalog: null, error: "Не удалось загрузить данные по предметам." });
          notify("Данные по предметам не загрузились.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [heroId]);
  return state;
}

/* ---------- lane role win rates (real OpenDota scenario data) ---------- */

const LANE_LABELS = { 1: "Сейф-лейн", 2: "Мид", 3: "Оффлейн", 4: "Джунгли" };

async function getLaneRoles(heroId) {
  const cacheKey = `dw_laneroles_${heroId}`;
  const cached = readLocalCache(cacheKey);
  if (cached) return cached;
  const r = await fetch(`https://api.opendota.com/api/scenarios/laneRoles?hero_id=${heroId}`);
  if (!r.ok) throw new Error("network");
  const data = await r.json();
  writeLocalCache(cacheKey, data);
  return data;
}

function useLaneRoles(heroId) {
  const [state, setState] = useState({ loading: false, rows: null, error: null });
  useEffect(() => {
    if (!heroId) return;
    let cancelled = false;
    setState({ loading: true, rows: null, error: null });
    getLaneRoles(heroId)
      .then((rows) => {
        if (!cancelled) setState({ loading: false, rows, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, rows: null, error: "Не удалось загрузить данные по линиям." });
      });
    return () => {
      cancelled = true;
    };
  }, [heroId]);
  return state;
}

/* ---------- experimental: win rate strictly since the current patch (via Explorer SQL) ---------- */

let latestPatchPromise = null;

async function getLatestPatch() {
  if (latestPatchPromise) return latestPatchPromise;
  const cached = readLocalCache("dw_latest_patch");
  if (cached) {
    latestPatchPromise = Promise.resolve(cached);
    return cached;
  }
  latestPatchPromise = (async () => {
    const r = await fetch("https://api.opendota.com/api/constants/patch");
    if (!r.ok) throw new Error("network");
    const patches = await r.json(); // [{ name, date }, ...] chronological
    const latest = patches[patches.length - 1];
    const ts = Math.floor(new Date(latest.date).getTime() / 1000);
    const data = { name: latest.name, ts };
    writeLocalCache("dw_latest_patch", data);
    return data;
  })();
  return latestPatchPromise;
}

/* Matchups from ordinary public games instead of the tiny pro sample. There is no simple
   endpoint for this, so it goes through Explorer SQL: unnest the opposing team of every
   public match the hero appears in and count wins per enemy. Heavier and slower than the
   pro endpoint, hence the explicit toggle and long cache. */
async function getPatchWinRate(heroId) {
  const patch = await getLatestPatch();
  const cacheKey = `dw_patchwr_${heroId}_${patch.name}`;
  const cached = readLocalCache(cacheKey);
  if (cached) return { ...cached, patchName: patch.name };

  const sql = `
    SELECT
      COUNT(*) AS games,
      SUM(CASE WHEN
        (radiant_win AND ${heroId} = ANY(string_to_array(radiant_team, ',')::int[]))
        OR (NOT radiant_win AND ${heroId} = ANY(string_to_array(dire_team, ',')::int[]))
      THEN 1 ELSE 0 END) AS wins
    FROM public_matches
    WHERE start_time >= ${patch.ts}
    AND (${heroId} = ANY(string_to_array(radiant_team, ',')::int[]) OR ${heroId} = ANY(string_to_array(dire_team, ',')::int[]))
  `.replace(/\s+/g, " ").trim();

  const r = await fetch(`https://api.opendota.com/api/explorer?sql=${encodeURIComponent(sql)}`);
  if (!r.ok) throw new Error("network");
  const json = await r.json();
  const row = json.rows && json.rows[0];
  if (!row) throw new Error("no data");
  const data = { games: Number(row.games) || 0, wins: Number(row.wins) || 0 };
  writeLocalCache(cacheKey, data);
  return { ...data, patchName: patch.name };
}

/* ---------- experimental: global monthly win-rate trend for a hero (via Explorer SQL) ---------- */

async function getHeroMonthlyTrend(heroId) {
  const cacheKey = `dw_monthly_${heroId}`;
  const cached = readLocalCache(cacheKey, PLAYER_TTL_MS * 4); // ~1h, this data doesn't need to be ultra-fresh
  if (cached) return cached;

  const sql = `
    SELECT
      date_trunc('month', to_timestamp(start_time)) AS month,
      COUNT(*) AS games,
      SUM(CASE WHEN
        (radiant_win AND ${heroId} = ANY(string_to_array(radiant_team, ',')::int[]))
        OR (NOT radiant_win AND ${heroId} = ANY(string_to_array(dire_team, ',')::int[]))
      THEN 1 ELSE 0 END) AS wins
    FROM public_matches
    WHERE start_time >= extract(epoch FROM now() - interval '6 months')
    AND (${heroId} = ANY(string_to_array(radiant_team, ',')::int[]) OR ${heroId} = ANY(string_to_array(dire_team, ',')::int[]))
    GROUP BY month
    ORDER BY month ASC
  `.replace(/\s+/g, " ").trim();

  const r = await fetch(`https://api.opendota.com/api/explorer?sql=${encodeURIComponent(sql)}`);
  if (!r.ok) throw new Error("network");
  const json = await r.json();
  const rows = (json.rows || []).map((row) => {
    const d = new Date(row.month);
    return {
      label: `${MONTH_RU[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
      games: Number(row.games) || 0,
      winRate: Number(row.games) > 0 ? Math.round((Number(row.wins) / Number(row.games)) * 1000) / 10 : 0,
    };
  });
  writeLocalCache(cacheKey, rows);
  return rows;
}

function useHeroMonthlyTrend(heroId) {
  const [state, setState] = useState({ loading: false, rows: null, error: null });
  useEffect(() => {
    if (!heroId) return;
    let cancelled = false;
    setState({ loading: true, rows: null, error: null });
    getHeroMonthlyTrend(heroId)
      .then((rows) => {
        if (!cancelled) setState({ loading: false, rows, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, rows: null, error: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [heroId]);
  return state;
}

function usePatchWinRate(heroId) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  useEffect(() => {
    if (!heroId) return;
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    getPatchWinRate(heroId)
      .then((data) => {
        if (!cancelled) setState({ loading: false, data, error: null });
      })
      .catch(() => {
        // experimental feature — fail silently, rest of the page stays unaffected
        if (!cancelled) setState({ loading: false, data: null, error: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [heroId]);
  return state;
}

/* ---------- personal profile (public OpenDota player data, Steam32 account id — no login needed) ---------- */

function steam64To32(id64str) {
  try {
    const id64 = BigInt(id64str);
    const base = 76561197960265728n;
    if (id64 < base) return null;
    return (id64 - base).toString();
  } catch {
    return null;
  }
}

function parseSteamAccountId(raw) {
  const trimmed = (raw || "").trim();
  const profileMatch = trimmed.match(/\/profiles\/(\d{17})/);
  if (profileMatch) return steam64To32(profileMatch[1]);
  if (/^\d{17}$/.test(trimmed)) return steam64To32(trimmed);
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

const PLAYER_TTL_MS = 15 * 60 * 1000; // 15 minutes — personal data changes often

async function fetchPlayerBundle(accountId) {
  const cacheKey = `dw_player_${accountId}`;
  const cached = readLocalCache(cacheKey, PLAYER_TTL_MS);
  if (cached) return cached;

  const [profileRes, wlRes, heroesRes, matchesRes, peersRes] = await Promise.all([
    fetch(`https://api.opendota.com/api/players/${accountId}`),
    // lobby_type=7 — рейтинговые матчи; wl без limit даёт статистику за всё время
    fetch(`https://api.opendota.com/api/players/${accountId}/wl?lobby_type=7`),
    fetch(`https://api.opendota.com/api/players/${accountId}/heroes?lobby_type=7`),
    // gpm/xpm/last_hits/lane_role приходят только если запросить их явно
    fetch(
      `https://api.opendota.com/api/players/${accountId}/matches?limit=300&lobby_type=7` +
        "&project=kills&project=deaths&project=assists" +
        "&project=gold_per_min&project=xp_per_min&project=last_hits" +
        "&project=lane_role&project=duration&project=hero_damage&project=tower_damage" +
        "&project=hero_id&project=start_time&project=radiant_win&project=player_slot"
    ),
    fetch(`https://api.opendota.com/api/players/${accountId}/peers?lobby_type=7`),
  ]);
  if (!profileRes.ok || !wlRes.ok || !heroesRes.ok || !matchesRes.ok) throw new Error("network");

  const profile = await profileRes.json();
  const wl = await wlRes.json();
  const heroesPlayed = await heroesRes.json();
  const matches = await matchesRes.json();
  const peers = peersRes.ok ? await peersRes.json() : [];

  const data = { profile, wl, heroesPlayed, matches, peers };
  writeLocalCache(cacheKey, data);
  return data;
}

function usePlayerBundle(accountId) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  useEffect(() => {
    if (!accountId) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    fetchPlayerBundle(accountId)
      .then((data) => {
        if (!cancelled) setState({ loading: false, data, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ loading: false, data: null, error: "Не удалось загрузить профиль. Проверь ID или настройки приватности матчей в Dota 2." });
          notify("Профиль не загрузился — проверь ID и приватность матчей.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return state;
}

/* ---------- root app ---------- */

const TABS = [
  { key: "home", label: "Главная", icon: Home },
  { key: "card", label: "Карточка героя", icon: IdCard },
  { key: "table", label: "Таблица контрпиков", icon: Table2 },
  { key: "web", label: "Паутина", icon: Network },
  { key: "roles", label: "Топ по ролям", icon: Crown },
  { key: "draft", label: "Драфт 5×5", icon: Users },
  { key: "compare", label: "Сравнить героев", icon: GitCompare },
  { key: "reference", label: "Справочник", icon: BookOpen },
  { key: "patches", label: "Патчи", icon: History },
  { key: "profile", label: "Мой профиль", icon: User },
  { key: "pricing", label: "Тарифы", icon: Gem },
];

export default function App() {
  const [heroes, setHeroes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [steamIdFromUrl] = useState(() => {
    if (typeof window === "undefined") return null;
    const id = new URLSearchParams(window.location.search).get("steamid");
    if (id) window.history.replaceState({}, "", window.location.pathname);
    return id;
  });
  const [tab, setTabState] = useState(() => {
    if (steamIdFromUrl) return "profile";
    try {
      const saved = localStorage.getItem("dw_last_tab");
      if (saved && TABS.some((t) => t.key === saved)) return saved;
    } catch {
      // storage unavailable — fall back to home
    }
    return "home";
  });

  function setTab(next) {
    setTabState(next);
    try {
      localStorage.setItem("dw_last_tab", next);
    } catch {
      // storage unavailable — tab just won't persist
    }
  }
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);
  const [showTour, setShowTour] = useState(() => {
    try {
      return !localStorage.getItem("dw_tour_seen_v1");
    } catch {
      return false;
    }
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [tab]);

  useEffect(() => {
    toastListener = setToast;
    return () => {
      toastListener = null;
    };
  }, []);

  function closeTour() {
    setShowTour(false);
    try {
      localStorage.setItem("dw_tour_seen_v1", "1");
    } catch {
      // storage unavailable — tour will just show again next time
    }
  }

  useEffect(() => {
    const cached = readLocalCache("dw_hero_stats");
    if (cached) {
      setHeroes(cached);
      setLoading(false);
      if (cached.length) setSelectedId(cached[0].id);
      return; // instant load, skip network — refreshes again after TTL expires
    }
    fetch("https://api.opendota.com/api/heroStats")
      .then((r) => {
        if (!r.ok) throw new Error("network");
        return r.json();
      })
      .then((data) => {
        writeLocalCache("dw_hero_stats", data);
        setHeroes(data);
        setLoading(false);
        if (data.length) setSelectedId(data[0].id);
      })
      .catch(() => {
        setError("Не удалось загрузить данные OpenDota. Проверь подключение к интернету и обнови страницу.");
        setLoading(false);
      });
  }, []);

  const heroById = (id) => heroes.find((h) => h.id === id);
  const selected = selectedId ? heroById(selectedId) : null;

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,600;1,700;1,900&family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body { overflow-x: hidden; max-width: 100%; margin: 0; padding: 0; }
        body { display: block !important; place-items: initial !important; min-width: 0 !important; }
        #root { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 0 !important; text-align: left !important; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #3A2857; border-radius: 4px; }
        button { font-family: 'Inter', sans-serif; }
        input:focus-visible, button:focus-visible { outline: 2px solid #B24BF3; outline-offset: 2px; }
        .row, .role-row, .matchup-row, .side-row, .hero-chip, .suggestion-item {
          transition: background-color 0.18s ease-out, border-color 0.18s ease-out;
        }
        .row:hover { background: #171C24 !important; }
        .hero-chip:hover { background: #17102A !important; border-color: #3A404C !important; }
        .node-btn {
          cursor: pointer;
          transition: transform 0.15s ease;
          transform-box: fill-box;
          transform-origin: center;
          will-change: transform;
        }
        .node-btn:hover { transform: scale(1.15); }
        .edge-line { transition: opacity 0.25s ease, stroke-width 0.25s ease; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .tab-content { animation: fadeInUp 0.2s ease-out; }
        .role-row:hover, .side-row:hover { background: #17102A; }
        .panel, .card { transition: border-color 0.18s ease-out; }
        @keyframes floatHero {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); }
          50% { opacity: 1; transform: translateX(-50%) scale(1.1); }
        }
        @keyframes spinSlow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes nodePulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.6); }
        }
        .hex-node { animation: nodePulse 2.4s ease-in-out infinite; transform-box: fill-box; }
        .home-card { transition: transform 0.18s ease-out, border-color 0.18s ease-out; will-change: transform; }
        .home-card:hover { transform: translateY(-3px); border-color: #B24BF3 !important; }
        .stat-box { transition: border-color 0.18s ease-out; }
        .stat-box:hover { border-color: #B24BF3 !important; }
        .btn-lift { transition: transform 0.15s ease-out; }
        .btn-lift:hover { transform: translateY(-1px); }
        .skeleton {
          background: linear-gradient(90deg, #1A1030 25%, #2A1A40 50%, #1A1030 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s ease-in-out infinite;
        }
        @keyframes shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
        .recharts-wrapper, .recharts-surface, .recharts-wrapper svg,
        .recharts-sector, .recharts-rectangle, .recharts-layer, .recharts-pie {
          outline: none !important;
        }
        .recharts-wrapper *:focus, .recharts-wrapper *:focus-visible { outline: none !important; }
        .recharts-tooltip-wrapper { outline: none !important; }
        input, select, textarea { font-size: 16px !important; }
        .home-text-col { text-align: left; }
        .rank-scroll { overflow-x: auto; scrollbar-width: none; }
        .rank-scroll::-webkit-scrollbar { display: none; }
        @media (max-width: 860px) {
          .layout-cols { grid-template-columns: 1fr !important; }
          .two-col { grid-template-columns: 1fr !important; }
          .role-grid { grid-template-columns: 1fr !important; }
          .toolbar { flex-direction: column !important; align-items: stretch !important; }
          .draft-grid { grid-template-columns: 1fr !important; }
          .two-col { grid-template-columns: 1fr !important; }
          .rank-scroll { overflow-x: auto; }
          .home-hero { flex-direction: column !important; gap: 20px !important; }
          .hero-portrait-wrap { margin: 0 !important; }
          .home-text-col { text-align: center !important; }
          .home-text-col p { margin-left: auto !important; margin-right: auto !important; }
          .home-text-col button { margin-left: auto !important; margin-right: auto !important; }
        }
      `}</style>

      <header style={styles.header}>
        <div style={styles.brandRow}>
          <div style={{ visibility: tab === "home" ? "hidden" : "visible" }}>
            <div style={styles.brandWordmark}>DRAFTHEX</div>
            <div style={styles.brandSub}>Драфт и контрпики Dota 2</div>
          </div>
        </div>
        <PageMenu tab={tab} setTab={setTab} />
      </header>

      {loading && (
        <div style={styles.centerMsg}>
          <Loader2 className="spin" size={22} color="#C084FC" />
          <span style={{ marginLeft: 10 }}>Загружаю данные OpenDota…</span>
        </div>
      )}

      {error && <div style={styles.errorBox}>{error}</div>}

      {!loading && !error && selected && (
        <div key={tab} className="tab-content">
          {tab === "home" && <HomeTab heroes={heroes} setTab={setTab} onOpenHero={(id) => { setSelectedId(id); setTab("card"); }} />}
          {tab === "card" && (
            <HeroCardTab
              heroes={heroes}
              selected={selected}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
            />
          )}
          {tab === "table" && (
            <CounterTableTab
              heroes={heroes}
              selected={selected}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
            />
          )}
          {tab === "web" && <CounterWebTab heroes={heroes} onPick={(id) => setSelectedId(id)} />}
          {tab === "roles" && <RolesTab heroes={heroes} onPick={(id) => { setSelectedId(id); setTab("card"); }} />}
          {tab === "draft" && <DraftTab heroes={heroes} onOpenCard={(id) => { setSelectedId(id); setTab("card"); }} />}
          {tab === "compare" && <CompareTab heroes={heroes} />}
          {tab === "reference" && <ReferenceTab heroes={heroes} />}
          {tab === "patches" && <PatchesTab />}
          {tab === "profile" && <ProfileTab heroes={heroes} steamIdFromUrl={steamIdFromUrl} onOpenCard={(id) => { setSelectedId(id); setTab("card"); }} />}
          {tab === "pricing" && <PricingTab />}
        </div>
      )}

      <Toast message={toast} onClose={() => setToast(null)} />
      {showTour && <TourOverlay onClose={closeTour} onGo={(k) => { setTab(k); closeTour(); }} />}

    </div>
  );
}

/* ---------- first-visit tour ---------- */

const TOUR_STEPS = [
  { icon: IdCard, title: "Карточка героя", text: "Статы, роли, лучшие и худшие матчапы, популярные предметы и графики по линиям.", go: "card" },
  { icon: Table2, title: "Таблица контрпиков", text: "Полный список: кто контрит героя и кого контрит он, с реальным винрейтом и фильтрами.", go: "table" },
  { icon: Network, title: "Паутина", text: "Все связи между героями на одном графе. Тяни холст, крути колесо, ищи героя в поиске.", go: "web" },
  { icon: Users, title: "Драфт 5×5", text: "Собери обе команды — увидишь перевес, лучший следующий пик и план на игру.", go: "draft" },
  { icon: User, title: "Мой профиль", text: "Войди через Steam — подтянется твоя статистика: винрейт по месяцам и топ героев.", go: "profile" },
];

function TourOverlay({ onClose, onGo }) {
  const [step, setStep] = useState(0);
  const s = TOUR_STEPS[step];
  const Icon = s.icon;
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div style={styles.tourBackdrop} onClick={onClose}>
      <div style={styles.tourCard} onClick={(e) => e.stopPropagation()}>
        <button style={styles.tourClose} onClick={onClose} aria-label="Закрыть"><X size={16} /></button>

        <div style={styles.tourIconBadge}><Icon size={22} color="#C084FC" /></div>
        <div style={styles.tourTitle}>{s.title}</div>
        <div style={styles.tourText}>{s.text}</div>

        <div style={styles.tourDots}>
          {TOUR_STEPS.map((_, i) => (
            <span key={i} style={{ ...styles.tourDot, background: i === step ? "#B24BF3" : "#3A2857" }} />
          ))}
        </div>

        <div style={styles.tourBtnRow}>
          <button style={styles.tourSkip} onClick={onClose}>Пропустить</button>
          <button style={styles.tourGo} onClick={() => onGo(s.go)}>Открыть</button>
          {!isLast && (
            <button className="btn-lift" style={styles.homeCta} onClick={() => setStep((v) => v + 1)}>
              Далее <ArrowRight size={15} />
            </button>
          )}
          {isLast && (
            <button className="btn-lift" style={styles.homeCta} onClick={onClose}>
              Понятно <Check size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- tab 1: hero card ---------- */

/* ---------- page navigation dropdown ---------- */

function PageMenu({ tab, setTab }) {
  const [open, setOpen] = useState(false);
  const current = TABS.find((t) => t.key === tab) || TABS[0];
  const CurrentIcon = current.icon;

  return (
    <div style={{ position: "relative" }}>
      <button style={styles.menuTrigger} onClick={() => setOpen((v) => !v)}>
        <Menu size={16} />
        <CurrentIcon size={15} />
        <span>{current.label}</span>
        <ChevronDown size={15} style={{ marginLeft: 4, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
      </button>
      {open && (
        <>
          <div style={styles.menuBackdrop} onClick={() => setOpen(false)} />
          <div style={styles.menuDropdown}>
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  style={{ ...styles.menuItem, ...(active ? styles.menuItemActive : {}) }}
                  onClick={() => { setTab(t.key); setOpen(false); }}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- home / landing tab ---------- */


function HexVisual() {
  const nodes = useMemo(() => {
    const count = 9;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const r = 78 + (i % 3) * 16;
      return {
        x: 150 + r * Math.cos(angle),
        y: 150 + r * Math.sin(angle),
        delay: (i * 0.35).toFixed(2),
      };
    });
  }, []);

  function hexPoints(cx, cy, r) {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(" ");
  }

  return (
    <svg viewBox="0 0 300 300" style={styles.hexVisual}>
      <g style={{ transformOrigin: "150px 150px", animation: "spinSlow 50s linear infinite" }}>
        {nodes.map((n, i) => (
          <line key={`c-${i}`} x1={150} y1={150} x2={n.x} y2={n.y} stroke="#6D28D9" strokeWidth="1" opacity="0.4" />
        ))}
        {nodes.map((n, i) => {
          const next = nodes[(i + 1) % nodes.length];
          return <line key={`r-${i}`} x1={n.x} y1={n.y} x2={next.x} y2={next.y} stroke="#B24BF3" strokeWidth="1" opacity="0.2" />;
        })}
        <polygon points={hexPoints(150, 150, 46)} fill="rgba(178,75,243,0.06)" stroke="#C084FC" strokeWidth="2" />
        {nodes.map((n, i) => (
          <circle
            key={`n-${i}`} cx={n.x} cy={n.y} r="5" fill="#C084FC"
            className="hex-node" style={{ animationDelay: `${n.delay}s`, transformOrigin: `${n.x}px ${n.y}px` }}
          />
        ))}
      </g>
      <polygon points={hexPoints(150, 150, 22)} fill="#B24BF3" opacity="0.9" />
    </svg>
  );
}

function HomeTab({ heroes, setTab, onOpenHero }) {
  const [query, setQuery] = useState("");
  const [patch, setPatch] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getLatestPatch()
      .then((p) => { if (!cancelled) setPatch(p); })
      .catch(() => { /* patch label is decorative here */ });
    return () => { cancelled = true; };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return heroes.filter((h) => h.localized_name.toLowerCase().includes(q)).slice(0, 6);
  }, [heroes, query]);

  const topMeta = useMemo(() => {
    return heroes
      .map((h) => {
        const s = bracketStats(h, BRACKETS[0]);
        return { hero: h, picks: s.picks, winRate: s.picks ? s.wins / s.picks : 0 };
      })
      .filter((x) => x.picks >= 5000)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 5);
  }, [heroes]);

  const topPicked = useMemo(() => {
    return heroes
      .map((h) => {
        const s = bracketStats(h, BRACKETS[0]);
        return { hero: h, picks: s.picks, winRate: s.picks ? s.wins / s.picks : 0 };
      })
      .sort((a, b) => b.picks - a.picks)
      .slice(0, 5);
  }, [heroes]);

  const topBanned = useMemo(() => {
    return [...heroes].filter((h) => h.pro_ban).sort((a, b) => b.pro_ban - a.pro_ban).slice(0, 5);
  }, [heroes]);

  function openHero(id) {
    setQuery("");
    onOpenHero(id);
  }

  return (
    <div style={styles.homeWrap}>
      <div className="home-hero" style={styles.homeHero}>
        <div style={styles.homeGlow} />

        <div className="home-text-col" style={styles.homeTextCol}>
          <h1 style={styles.homeTitle}>DraftHex</h1>
          <p style={styles.homeTagline}>
            Контрпики, драфт и мета Dota 2 на живой статистике обычных матчей.
          </p>

          <div style={styles.homeSearchWrap}>
            <Search size={16} color="#9C8FB0" />
            <input
              style={styles.homeSearchInput}
              placeholder="Введи героя — откроется его карточка"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.length) openHero(matches[0].id);
                if (e.key === "Escape") setQuery("");
              }}
            />
          </div>

          {matches.length > 0 && (
            <div style={styles.homeSearchResults}>
              {matches.map((h) => (
                <div key={h.id} style={styles.dropdownItem} onClick={() => openHero(h.id)}>
                  <HeroIcon hero={h} style={styles.dropdownIcon} />
                  <span style={{ fontSize: 13 }}>{h.localized_name}</span>
                </div>
              ))}
            </div>
          )}

          {patch && (
            <div style={styles.patchChip}>
              <History size={12} color="#C084FC" /> Текущий патч {patch.name}
            </div>
          )}
        </div>

        <div className="hero-portrait-wrap" style={styles.homePortraitWrap}>
          <HexVisual />
        </div>
      </div>

      <div style={styles.homeGrid}>
        <DashCard
          title="Лучший винрейт"
          icon={TrendingUp}
          color="#5FCB8E"
          rows={topMeta.map((x) => ({ hero: x.hero, value: `${(x.winRate * 100).toFixed(1)}%` }))}
          onOpenHero={openHero}
        />
        <DashCard
          title="Чаще всего берут"
          icon={Crown}
          color="#C084FC"
          rows={topPicked.map((x) => ({
            hero: x.hero,
            value: x.picks > 1000 ? `${Math.round(x.picks / 1000)}k` : String(x.picks),
          }))}
          onOpenHero={openHero}
        />
        <DashCard
          title="Чаще всего банят"
          icon={Swords}
          color="#E2574C"
          rows={topBanned.map((h) => ({ hero: h, value: String(h.pro_ban) }))}
          onOpenHero={openHero}
        />
      </div>

      <div style={styles.homeActions}>
        <button className="btn-lift" style={styles.homeCta} onClick={() => setTab("draft")}>
          Собрать драфт <ArrowRight size={16} />
        </button>
        <button style={styles.homeSecondary} onClick={() => setTab("web")}>Паутина контрпиков</button>
        <button style={styles.homeSecondary} onClick={() => setTab("profile")}>Мой профиль</button>
      </div>
    </div>
  );
}

function DashCard({ title, icon: Icon, color, rows, onOpenHero }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <Icon size={16} color={color} />
        <span style={{ ...styles.panelTitle, color }}>{title}</span>
      </div>
      {rows.length === 0 && <SkeletonRows count={4} />}
      {rows.map(({ hero, value }, i) => (
        <div key={hero.id} className="role-row" style={styles.roleRow} onClick={() => onOpenHero(hero.id)}>
          <span style={styles.roleRank}>{i + 1}</span>
          <HeroIcon hero={hero} style={styles.matchupIcon} />
          <span style={styles.matchupName}>{hero.localized_name}</span>
          <span style={{ ...styles.rolePct, color }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

const MONTH_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function ProfileTab({ heroes, steamIdFromUrl, onOpenCard }) {
  const [premium] = usePremium();
  const [input, setInput] = useState("");
  const [accountId, setAccountId] = useState(null);
  const [parseError, setParseError] = useState(null);
  const { loading, data, error } = usePlayerBundle(accountId);

  useEffect(() => {
    if (!steamIdFromUrl) return;
    const id = parseSteamAccountId(steamIdFromUrl);
    if (id) {
      setAccountId(id);
      setInput(steamIdFromUrl);
    }
    checkServerPremium(steamIdFromUrl).then((res) => {
      if (!res) return;
      try {
        if (res.premium) localStorage.setItem("dw_premium_paid", "1");
        else localStorage.removeItem("dw_premium_paid");
      } catch {
        // storage unavailable — premium just won't persist between visits
      }
    });
  }, [steamIdFromUrl]);

  const heroById = (id) => heroes.find((h) => h.id === id);

  function handleSubmit(e) {
    e.preventDefault();
    const id = parseSteamAccountId(input);
    if (!id) {
      setParseError("Не удалось распознать ID. Вставь числовой Steam32 ID или ссылку вида steamcommunity.com/profiles/7656119...");
      setAccountId(null);
      return;
    }
    setParseError(null);
    setAccountId(id);
  }

  const topHeroes = useMemo(() => {
    if (!data?.heroesPlayed) return [];
    return [...data.heroesPlayed]
      .filter((h) => h.games >= 3)
      .sort((a, b) => b.games - a.games)
      .slice(0, 10)
      .map((h) => ({ ...h, hero: heroById(h.hero_id), winRate: h.games > 0 ? h.win / h.games : 0 }))
      .filter((h) => h.hero);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, heroes]);

  const monthlyTrend = useMemo(() => {
    if (!data?.matches) return [];
    const byMonth = {};
    data.matches.forEach((m) => {
      if (m.start_time == null || m.player_slot == null || m.radiant_win == null) return;
      const won = m.player_slot < 128 === m.radiant_win;
      const d = new Date(m.start_time * 1000);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!byMonth[key]) byMonth[key] = { games: 0, wins: 0, year: d.getFullYear(), month: d.getMonth() };
      byMonth[key].games += 1;
      if (won) byMonth[key].wins += 1;
    });
    return Object.values(byMonth)
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map((v) => ({
        label: `${MONTH_RU[v.month]} ${String(v.year).slice(2)}`,
        winRate: Math.round((v.wins / v.games) * 1000) / 10,
        games: v.games,
      }));
  }, [data]);

  return (
    <div style={styles.body}>

      <form onSubmit={handleSubmit} style={styles.profileForm}>
        <input
          style={styles.profileInput}
          placeholder="Steam32 ID или ссылка на профиль…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-lift" style={styles.homeCta}>
          Показать <ArrowRight size={16} />
        </button>
        <a href="/api/steam-login" className="btn-lift" style={styles.steamLoginBtn}>
          Войти через Steam
        </a>
      </form>
      <div style={{ ...styles.mutedText, fontSize: 11 }}>
        Кнопка "Войти через Steam" работает только после настройки backend (см. инструкцию) — до этого пользуйся полем выше.
      </div>
      {parseError && <div style={styles.errorBox}>{parseError}</div>}

      {loading && (
        <div style={styles.panel}>
          <SkeletonRows count={5} />
        </div>
      )}
      {error && <div style={styles.errorBox}>{error}</div>}

      {!loading && !error && data && (
        <>
          <div style={styles.panel}>
            <div style={styles.profileHeader}>
              {data.profile?.profile?.avatarfull && (
                <img src={data.profile.profile.avatarfull} alt="" style={styles.profileAvatar} />
              )}
              <div>
                <div style={styles.profileName}>{data.profile?.profile?.personaname || "Игрок"}</div>
                <div style={styles.mutedText}>
                  {data.wl.win + data.wl.lose > 0
                    ? `${data.wl.win} побед / ${data.wl.lose} поражений (${((data.wl.win / (data.wl.win + data.wl.lose)) * 100).toFixed(1)}%)`
                    : "Нет данных о матчах"}
                </div>
              </div>
            </div>
          </div>

          <ProfileCharts matches={data.matches} wl={data.wl} heroes={heroes} onOpenCard={onOpenCard} />

          {monthlyTrend.length > 0 && (
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <BarChart3 size={16} color="#C084FC" />
                <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Винрейт по месяцам</span>
              </div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={monthlyTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip
                      contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                      labelStyle={{ color: "#F2EAFB" }}
                      formatter={(value, name, props) => [`${value}% (${props.payload.games} игр)`, "Винрейт"]}
                    />
                    <Line type="monotone" dataKey="winRate" stroke="#B24BF3" strokeWidth={2} dot={{ fill: "#C084FC", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <Crown size={16} color="#C084FC" />
              <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Топ героев по количеству игр</span>
            </div>
            {topHeroes.length === 0 && <div style={styles.mutedText}>Недостаточно данных.</div>}
            {topHeroes.map((h) => (
              <div key={h.hero_id} className="role-row" style={styles.roleRow} onClick={() => onOpenCard(h.hero.id)}>
                <HeroIcon hero={h.hero} style={styles.matchupIcon} />
                <span style={styles.matchupName}>{h.hero.localized_name}</span>
                <span style={styles.mutedText}>{h.games} игр</span>
                <span style={{ ...styles.rolePct, color: h.winRate >= 0.5 ? "#5FCB8E" : "#E2574C" }}>
                  {(h.winRate * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>

          <PeersPanel peers={data.peers} />

          {premium ? (
            <PremiumProfilePanels matches={data.matches} accountId={accountId} heroes={heroes} />
          ) : (
            <PremiumLock
              title="Разбор по позициям и форма"
              text="Винрейт и KDA по каждой позиции, графики золота и опыта за минуту по последним матчам. Входит в Premium — включить демо можно на вкладке «Тарифы»."
            />
          )}
        </>
      )}
    </div>
  );
}

const WEEKDAY_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const MIX_COLORS = ["#C084FC", "#5FCB8E", "#E5B33D", "#5B9FE0", "#E2574C", "#8B5CF6"];

/* Иконка героя ставится снаружи своего сегмента кольца. Мелкие сегменты пропускаем —
   иначе картинки налезают друг на друга. */
function renderHeroSliceIcon(props) {
  const { cx, cy, midAngle, outerRadius, payload, percent } = props;
  if (!payload || !payload.icon || percent < 0.06) return null;
  const RAD = Math.PI / 180;
  const r = outerRadius + 20;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  const size = 26;
  return (
    <g>
      <circle cx={x} cy={y} r={size / 2 + 2} fill="#140B22" stroke={payload.color} strokeWidth={1.5} />
      <clipPath id={`mix-clip-${payload.heroId}`}>
        <circle cx={x} cy={y} r={size / 2} />
      </clipPath>
      <image
        href={payload.icon}
        x={x - size / 2}
        y={y - size / 2}
        width={size}
        height={size}
        clipPath={`url(#mix-clip-${payload.heroId})`}
      />
    </g>
  );
}

function HeroMixPanel({ heroCount, heroes, onOpenCard }) {
  const data = useMemo(() => {
    const rows = Object.entries(heroCount || {})
      .map(([id, v]) => ({ hero: heroes.find((h) => h.id === Number(id)), games: v.games, wins: v.wins }))
      .filter((r) => r.hero)
      .sort((a, b) => b.games - a.games);

    const top = rows.slice(0, 6);
    const restGames = rows.slice(6).reduce((s, r) => s + r.games, 0);
    const out = top.map((r, i) => ({
      name: r.hero.localized_name,
      value: r.games,
      winRate: r.games ? r.wins / r.games : 0,
      heroId: r.hero.id,
      icon: img(r.hero.icon),
      color: MIX_COLORS[i % MIX_COLORS.length],
    }));
    if (restGames > 0) out.push({ name: "Прочие", value: restGames, color: "#3A2857", heroId: null });
    return out;
  }, [heroCount, heroes]);

  if (data.length === 0) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <Crown size={16} color="#C084FC" />
        <span style={{ ...styles.panelTitle, color: "#C084FC" }}>На ком играешь</span>
      </div>
      <div style={{ width: "100%", height: 230 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={46}
              outerRadius={72}
              paddingAngle={2}
              stroke="none"
              labelLine={false}
              label={renderHeroSliceIcon}
              isAnimationActive={false}
            >
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
              itemStyle={{ color: "#F2EAFB" }}
              cursor={false}
              formatter={(v, n) => [`${v} игр`, n]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {data.filter((d) => d.heroId).map((d) => (
        <div key={d.name} className="role-row" style={styles.roleRow} onClick={() => onOpenCard(d.heroId)}>
          <span style={{ ...styles.mixDot, background: d.color }} />
          <HeroIcon hero={heroes.find((h) => h.id === d.heroId)} style={styles.matchupIcon} />
          <span style={styles.matchupName}>{d.name}</span>
          <span style={styles.mutedText}>{d.value} игр</span>
          <span style={{ ...styles.rolePct, color: d.winRate >= 0.5 ? "#5FCB8E" : "#E2574C" }}>
            {(d.winRate * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function RecentMatchesPanel({ recent, heroes, onOpenCard }) {
  if (!recent || recent.length === 0) return null;
  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <History size={16} color="#C084FC" />
        <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Последние матчи</span>
      </div>
      {recent.map((m) => {
        const hero = heroes.find((h) => h.id === m.heroId);
        if (!hero) return null;
        const kda = m.deaths > 0 ? ((m.kills + m.assists) / m.deaths).toFixed(1) : "∞";
        return (
          <div
            key={m.matchId}
            className="role-row"
            style={{ ...styles.roleRow, borderLeft: `3px solid ${m.won ? "#5FCB8E" : "#E2574C"}`, paddingLeft: 8 }}
            onClick={() => onOpenCard(hero.id)}
          >
            <HeroIcon hero={hero} style={styles.matchupIcon} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.matchupName}>{hero.localized_name}</div>
              <div style={{ ...styles.mutedText, fontSize: 11 }}>
                {m.kills}/{m.deaths}/{m.assists} · KDA {kda} · {Math.round(m.duration / 60)} мин
              </div>
            </div>
            <span style={{ ...styles.rolePct, color: m.won ? "#5FCB8E" : "#E2574C" }}>
              {m.won ? "Победа" : "Пораж."}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProfileCharts({ matches, wl, heroes, onOpenCard }) {
  const stats = useMemo(() => {
    const list = Array.isArray(matches) ? matches.filter((m) => m.player_slot != null && m.radiant_win != null) : [];
    if (list.length === 0) return null;

    const won = (m) => (m.player_slot < 128) === m.radiant_win;

    let kills = 0, deaths = 0, assists = 0, gpm = 0, xpm = 0, lh = 0, durationSum = 0;
    const byWeekday = WEEKDAY_RU.map((d) => ({ day: d, games: 0, wins: 0 }));
    const buckets = [
      { label: "<25 мин", max: 25 * 60, games: 0, wins: 0 },
      { label: "25–35", max: 35 * 60, games: 0, wins: 0 },
      { label: "35–45", max: 45 * 60, games: 0, wins: 0 },
      { label: "45+", max: Infinity, games: 0, wins: 0 },
    ];

    list.forEach((m) => {
      const w = won(m);
      kills += m.kills || 0;
      deaths += m.deaths || 0;
      assists += m.assists || 0;
      gpm += m.gold_per_min || 0;
      xpm += m.xp_per_min || 0;
      lh += m.last_hits || 0;
      durationSum += m.duration || 0;

      if (m.start_time) {
        const d = new Date(m.start_time * 1000).getDay();
        byWeekday[d].games += 1;
        if (w) byWeekday[d].wins += 1;
      }
      const b = buckets.find((x) => (m.duration || 0) < x.max);
      if (b) {
        b.games += 1;
        if (w) b.wins += 1;
      }
    });

    // longest streaks, oldest match first
    const chrono = [...list].sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
    let bestWin = 0, bestLose = 0, curWin = 0, curLose = 0;
    chrono.forEach((m) => {
      if (won(m)) {
        curWin += 1; curLose = 0;
        if (curWin > bestWin) bestWin = curWin;
      } else {
        curLose += 1; curWin = 0;
        if (curLose > bestLose) bestLose = curLose;
      }
    });

    // распределение по героям
    const heroCount = {};
    list.forEach((m) => {
      if (!m.hero_id) return;
      if (!heroCount[m.hero_id]) heroCount[m.hero_id] = { games: 0, wins: 0 };
      heroCount[m.hero_id].games += 1;
      if (won(m)) heroCount[m.hero_id].wins += 1;
    });

    // винрейт по времени суток
    const dayParts = [
      { key: "night", label: "Ночь 0–6", from: 0, to: 6, games: 0, wins: 0 },
      { key: "morning", label: "Утро 6–12", from: 6, to: 12, games: 0, wins: 0 },
      { key: "day", label: "День 12–18", from: 12, to: 18, games: 0, wins: 0 },
      { key: "evening", label: "Вечер 18–24", from: 18, to: 24, games: 0, wins: 0 },
    ];
    list.forEach((m) => {
      if (!m.start_time) return;
      const h = new Date(m.start_time * 1000).getHours();
      const part = dayParts.find((x) => h >= x.from && h < x.to);
      if (!part) return;
      part.games += 1;
      if (won(m)) part.wins += 1;
    });

    const recent = [...list]
      .filter((m) => m.start_time)
      .sort((a, b) => b.start_time - a.start_time)
      .slice(0, 10)
      .map((m) => ({
        matchId: m.match_id,
        heroId: m.hero_id,
        won: won(m),
        kills: m.kills || 0,
        deaths: m.deaths || 0,
        assists: m.assists || 0,
        gpm: m.gold_per_min || 0,
        duration: m.duration || 0,
        startTime: m.start_time,
      }));

    const n = list.length;
    return {
      n,
      heroCount,
      recent,
      dayParts: dayParts
        .filter((x) => x.games >= 2)
        .map((x) => ({ label: x.label, winRate: Math.round((x.wins / x.games) * 1000) / 10, games: x.games })),
      kda: deaths > 0 ? ((kills + assists) / deaths).toFixed(2) : "—",
      avgKills: (kills / n).toFixed(1),
      avgDeaths: (deaths / n).toFixed(1),
      avgAssists: (assists / n).toFixed(1),
      avgGpm: Math.round(gpm / n),
      avgXpm: Math.round(xpm / n),
      avgLh: Math.round(lh / n),
      avgDuration: Math.round(durationSum / n / 60),
      bestWin,
      bestLose,
      weekday: byWeekday
        .filter((d) => d.games >= 2)
        .map((d) => ({ day: d.day, winRate: Math.round((d.wins / d.games) * 1000) / 10, games: d.games })),
      duration: buckets
        .filter((b) => b.games >= 2)
        .map((b) => ({ label: b.label, winRate: Math.round((b.wins / b.games) * 1000) / 10, games: b.games })),
    };
  }, [matches]);

  if (!stats) return null;

  const wins = wl?.win || 0;
  const losses = wl?.lose || 0;
  const pie = [
    { name: "Победы", value: wins, color: "#5FCB8E" },
    { name: "Поражения", value: losses, color: "#E2574C" },
  ];
  const total = wins + losses;

  return (
    <>
      <div className="two-col" style={styles.twoCol}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <BarChart3 size={16} color="#C084FC" />
            <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Победы и поражения</span>
          </div>
          {total > 0 ? (
            <div style={{ position: "relative", width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pie}
                    dataKey="value"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={false}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={styles.donutCenter}>
                <div
                  style={{
                    ...styles.donutValue,
                    color: wins / total >= 0.5 ? "#5FCB8E" : "#E2574C",
                  }}
                >
                  {((wins / total) * 100).toFixed(1)}%
                </div>
                <div style={styles.donutSub}>{wins} побед · {losses} поражений</div>
              </div>
            </div>
          ) : (
            <div style={styles.emptyState}>Нет данных о матчах.</div>
          )}
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <Gem size={16} color="#C084FC" />
            <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Средние показатели</span>
          </div>
          <div style={styles.statsGrid}>
            <Stat label="KDA" value={stats.kda} />
            <Stat label="Убийства" value={stats.avgKills} />
            <Stat label="Смерти" value={stats.avgDeaths} />
            <Stat label="Помощь" value={stats.avgAssists} />
            <Stat label="Золото/мин" value={stats.avgGpm} />
            <Stat label="Опыт/мин" value={stats.avgXpm} />
            <Stat label="Добито" value={stats.avgLh} />
            <Stat label="Длина игры" value={`${stats.avgDuration} мин`} />
          </div>
          <div style={styles.streakRow}>
            <span style={{ ...styles.streakChip, borderColor: "#5FCB8E", color: "#5FCB8E" }}>
              Серия побед: {stats.bestWin}
            </span>
            <span style={{ ...styles.streakChip, borderColor: "#E2574C", color: "#E2574C" }}>
              Серия поражений: {stats.bestLose}
            </span>
          </div>
        </div>
      </div>

      <div className="two-col" style={styles.twoCol}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <BarChart3 size={16} color="#C084FC" />
            <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Винрейт по дням недели</span>
          </div>
          {stats.weekday.length === 0 ? (
            <div style={styles.emptyState}>Мало данных.</div>
          ) : (
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={stats.weekday} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                    labelStyle={{ color: "#F2EAFB" }}
                    formatter={(v, n, p) => [`${v}% (${p.payload.games} игр)`, "Винрейт"]}
                  />
                  <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                    {stats.weekday.map((d) => (
                      <Cell key={d.day} fill={d.winRate >= 50 ? "#5FCB8E" : "#E2574C"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <BarChart3 size={16} color="#C084FC" />
            <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Винрейт по времени суток</span>
          </div>
          {stats.dayParts.length === 0 ? (
            <div style={styles.emptyState}>Мало данных.</div>
          ) : (
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={stats.dayParts} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#9C8FB0", fontSize: 10 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                    labelStyle={{ color: "#F2EAFB" }}
                    formatter={(v, n, p) => [`${v}% (${p.payload.games} игр)`, "Винрейт"]}
                  />
                  <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                    {stats.dayParts.map((d) => (
                      <Cell key={d.label} fill={d.winRate >= 50 ? "#5FCB8E" : "#E2574C"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="two-col" style={styles.twoCol}>
        <HeroMixPanel heroCount={stats.heroCount} heroes={heroes} onOpenCard={onOpenCard} />
        <RecentMatchesPanel recent={stats.recent} heroes={heroes} onOpenCard={onOpenCard} />
      </div>

      <div className="two-col" style={styles.twoCol}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <BarChart3 size={16} color="#C084FC" />
            <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Винрейт по длине игры</span>
          </div>
          {stats.duration.length === 0 ? (
            <div style={styles.emptyState}>Мало данных.</div>
          ) : (
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={stats.duration} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                    labelStyle={{ color: "#F2EAFB" }}
                    formatter={(v, n, p) => [`${v}% (${p.payload.games} игр)`, "Винрейт"]}
                  />
                  <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                    {stats.duration.map((d) => (
                      <Cell key={d.label} fill={d.winRate >= 50 ? "#5FCB8E" : "#E2574C"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PeersPanel({ peers }) {
  const top = useMemo(() => {
    if (!Array.isArray(peers)) return [];
    return peers
      .filter((p) => p.games >= 5 && p.personaname)
      .map((p) => ({ ...p, winRate: p.win / p.games }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);
  }, [peers]);

  if (top.length === 0) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <Handshake size={16} color="#C084FC" />
        <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Синергия с союзниками</span>
      </div>
      {top.map((p) => (
        <div key={p.account_id} style={styles.roleRow}>
          {p.avatar ? (
            <img src={p.avatar} alt="" style={styles.matchupIcon} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          ) : (
            <div style={{ ...styles.matchupIcon, background: "#2A1A40" }} />
          )}
          <span style={styles.matchupName}>{p.personaname}</span>
          <span style={styles.mutedText}>{p.games} игр</span>
          <span style={{ ...styles.rolePct, color: p.winRate >= 0.5 ? "#5FCB8E" : "#E2574C" }}>
            {(p.winRate * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function HeroCardTab({ heroes, selected, selectedId, setSelectedId }) {
  const [query, setQuery] = useState("");
  const [cardBracket, setCardBracket] = useState("all");
  const { data: matchups, loading: matchupsLoading } = useMatchups(
    selectedId,
    cardBracket === "pro" ? "pro" : "public"
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((h) => h.localized_name.toLowerCase().includes(q));
  }, [heroes, query]);

  const heroById = (id) => heroes.find((h) => h.id === id);

  const ranked = useMemo(() => {
    if (!matchups) return [];
    return matchups
      .filter((m) => m.games_played >= 30)
      .map((m) => ({ ...m, winRate: m.wins / m.games_played }))
      .sort((a, b) => a.winRate - b.winRate);
  }, [matchups]);

  const worst = ranked.slice(0, 5);
  const best = [...ranked].sort((a, b) => b.winRate - a.winRate).slice(0, 5);
  const bracket = BRACKETS.find((b) => b.key === cardBracket) || BRACKETS[0];
  const bStats = bracketStats(selected, bracket);
  const cardWinRate = bStats.picks ? (bStats.wins / bStats.picks) * 100 : null;
  const attr = ATTR[selected.primary_attr] || ATTR.all;

  return (
    <div className="layout-cols" style={styles.layout}>
      <div style={styles.sidebar}>
        <div style={styles.searchWrap}>
          <Search size={14} color="#9C8FB0" />
          <input
            style={styles.searchInput}
            placeholder="Найти героя…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={styles.chipList}>
          {filtered.map((h) => {
            const isActive = h.id === selectedId;
            const a = ATTR[h.primary_attr] || ATTR.all;
            return (
              <button
                key={h.id}
                className="hero-chip"
                onClick={() => setSelectedId(h.id)}
                style={{
                  ...styles.heroChip,
                  borderColor: isActive ? a.color : "#2F1F49",
                  background: isActive ? "#2A1A40" : "#140B22",
                }}
              >
                <HeroIcon hero={h} style={styles.heroChipIcon} />
                <span style={styles.heroChipName}>{h.localized_name}</span>
                <span
                  style={{ ...styles.attrBadge, color: a.color, borderColor: a.color }}
                  title={a.label}
                >
                  {a.label[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={styles.detail}>
        <div style={{ ...styles.card, borderLeft: `4px solid ${attr.color}` }}>
          <div style={styles.cardTop}>
            <HeroIcon hero={selected} field="img" style={styles.portrait} alt={selected.localized_name} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.heroName}>{selected.localized_name}</div>
              <div style={styles.tagRow}>
                <span style={{ ...styles.tag, color: attr.color, borderColor: attr.color }}>{attr.label}</span>
                {selected.roles.slice(0, 3).map((r) => (
                  <span key={r} style={styles.tagMuted}>{ROLE_RU[r] || r}</span>
                ))}
              </div>
            </div>
            <RatingGauge value={cardWinRate} color={attr.color} />
          </div>

          <div className="rank-scroll" style={styles.segment}>
            {BRACKETS.map((b) => (
              <button
                key={b.key}
                style={{ ...styles.segmentBtn, ...(cardBracket === b.key ? styles.segmentBtnActive : {}) }}
                onClick={() => setCardBracket(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div style={styles.statsGrid}>
            <Stat label="Винрейт" value={cardWinRate ? `${cardWinRate.toFixed(1)}%` : "нет данных"} />
            <Stat label="Матчей" value={bStats.picks ? bStats.picks.toLocaleString("ru-RU") : "—"} />
            <Stat label="Баны в про" value={selected.pro_ban ?? "—"} />
            <Stat label="Тип атаки" value={selected.attack_type === "Melee" ? "Ближний бой" : "Дальний бой"} />
          </div>
        </div>

        <PatchWinRateBadge heroId={selectedId} />

        <div className="two-col" style={styles.twoCol}>
          <MatchupPanel
            title="Худшие матчапы"
            icon={<TrendingDown size={16} color="#E2574C" />}
            accent="#E2574C"
            items={worst}
            loading={matchupsLoading}
            heroById={heroById}
            labelFor={(m) => `${(m.winRate * 100).toFixed(0)}%`}
          />
          <MatchupPanel
            title="Лучшие матчапы"
            icon={<TrendingUp size={16} color="#5FCB8E" />}
            accent="#5FCB8E"
            items={best}
            loading={matchupsLoading}
            heroById={heroById}
            labelFor={(m) => `${(m.winRate * 100).toFixed(0)}%`}
          />
        </div>

        <div className="two-col" style={styles.twoCol}>
          <ItemsPanel heroId={selectedId} />
          <LaneRoleChart heroId={selectedId} />
        </div>

        <HeroMonthlyTrendChart heroId={selectedId} />
      </div>
    </div>
  );
}

const ITEM_CATEGORIES = [
  { key: "start_game_items", label: "Стартовые" },
  { key: "early_game_items", label: "Ранняя игра" },
  { key: "mid_game_items", label: "Середина игры" },
  { key: "late_game_items", label: "Поздняя игра" },
];

function PatchWinRateBadge({ heroId }) {
  const { loading, data, error } = usePatchWinRate(heroId);

  // fails silently and disappears — this is an experimental Explorer-based query,
  // rest of the hero card must never break because of it
  if (error) return null;
  if (!heroId) return null;

  return (
    <div style={styles.patchBadge}>
      <Sparkles size={14} color="#C084FC" />
      {loading && <span style={styles.mutedText}>Считаю статистику с текущего патча…</span>}
      {!loading && data && (
        <span style={styles.mutedText}>
          С текущего патча{data.patchName ? ` (${data.patchName})` : ""}:{" "}
          <b style={{ color: "#F2EAFB" }}>
            {data.games > 0 ? `${((data.wins / data.games) * 100).toFixed(1)}% побед из ${data.games} игр` : "данных пока нет"}
          </b>
          {" "}<span style={{ fontSize: 10 }}>(экспериментально)</span>
        </span>
      )}
    </div>
  );
}

function HeroMonthlyTrendChart({ heroId }) {
  const { loading, rows, error } = useHeroMonthlyTrend(heroId);

  // experimental Explorer-based feature — hide entirely on failure, never break the page
  if (error) return null;
  if (!heroId) return null;

  const hasData = rows && rows.some((r) => r.games > 0);

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <BarChart3 size={16} color="#C084FC" />
        <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Тренд по месяцам (все игроки)</span>
      </div>
      {loading && <div style={styles.mutedText}>Считаю тренд…</div>}
      {!loading && !hasData && <div style={styles.mutedText}>Недостаточно данных за последние месяцы.</div>}
      {!loading && hasData && (
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip
                contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                labelStyle={{ color: "#F2EAFB" }}
                formatter={(value, name, props) => [`${value}% (${props.payload.games} игр)`, "Винрейт"]}
              />
              <Line type="monotone" dataKey="winRate" stroke="#B24BF3" strokeWidth={2} dot={{ fill: "#C084FC", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ItemsPanel({ heroId }) {
  const { loading, popularity, catalog, error } = useHeroItems(heroId);
  if (!heroId) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <ShoppingBag size={16} color="#C084FC" />
        <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Популярные предметы</span>
      </div>
      {loading && <SkeletonRows count={4} />}
      {error && <div style={styles.mutedText}>{error}</div>}
      {!loading && !error && popularity && catalog && (
        <div style={styles.itemCatGrid}>
          {ITEM_CATEGORIES.map((cat) => {
            const counts = popularity[cat.key] || {};
            const rows = Object.entries(counts)
              .map(([id, count]) => {
                const key = catalog.ids[id];
                const item = key ? catalog.items[key] : null;
                return item ? { item, count } : null;
              })
              .filter(Boolean)
              .sort((a, b) => b.count - a.count)
              .slice(0, 4);
            return (
              <div key={cat.key} style={styles.itemCatCol}>
                <div style={styles.itemCatLabel}>{cat.label}</div>
                {rows.length === 0 && <div style={{ ...styles.mutedText, fontSize: 11 }}>Нет данных</div>}
                {rows.map(({ item }) => (
                  <div key={item.dname} style={styles.itemRow}>
                    <img
                      src={img(item.img)}
                      alt=""
                      style={styles.itemIcon}
                      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                    />
                    <span style={styles.itemName}>{item.dname}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LaneRoleChart({ heroId }) {
  const { loading, rows, error } = useLaneRoles(heroId);

  const chartData = useMemo(() => {
    if (!rows) return [];
    const byLane = {};
    rows
      .filter((r) => r.hero_id === heroId)
      .forEach((r) => {
        const key = r.lane_role;
        if (!byLane[key]) byLane[key] = { games: 0, wins: 0 };
        byLane[key].games += Number(r.games) || 0;
        byLane[key].wins += Number(r.wins) || 0;
      });
    return Object.entries(byLane)
      .map(([lane, v]) => ({
        lane: LANE_LABELS[lane] || `Роль ${lane}`,
        winRate: v.games > 0 ? Math.round((v.wins / v.games) * 1000) / 10 : 0,
        games: v.games,
      }))
      .filter((d) => d.games >= 20)
      .sort((a, b) => b.games - a.games);
  }, [rows, heroId]);

  if (!heroId) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <BarChart3 size={16} color="#C084FC" />
        <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Винрейт по линиям</span>
      </div>
      {loading && <SkeletonRows count={4} />}
      {error && <div style={styles.mutedText}>{error}</div>}
      {!loading && !error && chartData.length === 0 && (
        <div style={styles.mutedText}>Недостаточно данных по линиям для этого героя.</div>
      )}
      {!loading && !error && chartData.length > 0 && (
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
              <XAxis dataKey="lane" tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip
                contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                labelStyle={{ color: "#F2EAFB" }}
                formatter={(value, name, props) => [`${value}% (${props.payload.games} игр)`, "Винрейт"]}
              />
              <Bar dataKey="winRate" fill="#B24BF3" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* Числа «докручиваются» от нуля при появлении. Нечисловые значения показываются как есть. */
function useCountUp(value, duration = 700) {
  const raw = String(value);
  const hasDigit = /\d/.test(raw);
  const numeric = typeof value === "number" ? value : Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
  const isNumber = hasDigit && Number.isFinite(numeric);
  const [shown, setShown] = useState(isNumber ? 0 : null);

  useEffect(() => {
    if (!isNumber) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(numeric);
      return;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(numeric * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [numeric, isNumber, duration]);

  if (!isNumber) return null;
  return shown;
}

function Stat({ label, value }) {
  const animated = useCountUp(value);
  let display = value;
  if (animated != null) {
    const raw = String(value);
    const decimals = (raw.split(".")[1] || "").replace(/[^\d]/g, "").length;
    const suffix = raw.replace(/^[\d\s.,-]+/, "");
    display = `${animated.toLocaleString("ru-RU", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix ? ` ${suffix}` : ""}`.trim();
  }
  return (
    <div className="stat-box" style={styles.statBox}>
      <div style={styles.statValue}>{display}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function RatingGauge({ value, color }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 30;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div style={{ position: "relative", width: 76, height: 76, flexShrink: 0 }}>
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r={r} fill="none" stroke="#2F1F49" strokeWidth="6" />
        <circle
          cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 38 38)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div style={styles.gaugeLabel}>{value == null ? "—" : `${pct.toFixed(0)}%`}</div>
    </div>
  );
}

function MatchupPanel({ title, icon, accent, items, loading, heroById, labelFor }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        {icon}
        <span style={{ ...styles.panelTitle, color: accent }}>{title}</span>
      </div>
      {loading && <SkeletonRows count={4} />}
      {!loading && items.length === 0 && <div style={styles.emptyState}>Недостаточно данных про-матчей.</div>}
      {!loading &&
        items.map((m) => {
          const enemy = heroById(m.hero_id);
          if (!enemy) return null;
          return (
            <div key={m.hero_id} style={styles.matchupRow}>
              <HeroIcon hero={enemy} style={styles.matchupIcon} />
              <span style={styles.matchupName}>{enemy.localized_name}</span>
              <span style={{ ...styles.matchupPct, color: accent }}>{labelFor(m)}</span>
            </div>
          );
        })}
    </div>
  );
}

/* ---------- tab 2: counter table ---------- */

/* ---------- tab 4: top heroes by role ---------- */

const ROLE_ORDER = ["Carry", "Support", "Nuker", "Disabler", "Initiator", "Durable", "Escape", "Pusher", "Jungler"];

const BRACKETS = [
  { key: "all", label: "Все ранги", minPicks: 200 },
  { key: "1", label: "Рекрут", pickField: "1_pick", winField: "1_win", minPicks: 40 },
  { key: "2", label: "Страж", pickField: "2_pick", winField: "2_win", minPicks: 40 },
  { key: "3", label: "Рыцарь", pickField: "3_pick", winField: "3_win", minPicks: 40 },
  { key: "4", label: "Герой", pickField: "4_pick", winField: "4_win", minPicks: 40 },
  { key: "5", label: "Легенда", pickField: "5_pick", winField: "5_win", minPicks: 40 },
  { key: "6", label: "Властелин", pickField: "6_pick", winField: "6_win", minPicks: 40 },
  { key: "7", label: "Божество", pickField: "7_pick", winField: "7_win", minPicks: 40 },
  { key: "8", label: "Титан", pickField: "8_pick", winField: "8_win", minPicks: 40 },
  { key: "pro", label: "Про-сцена", pickField: "pro_pick", winField: "pro_win", minPicks: 5 },
];

const RANK_FIELDS = ["1", "2", "3", "4", "5", "6", "7", "8"];

/* "Все ранги" = sum of every public rank bracket. Public matches are what most players
   actually queue into, so this is the default rather than the tiny pro sample. */
function bracketStats(hero, bracket) {
  if (!hero) return { picks: 0, wins: 0 };
  if (bracket.key === "all") {
    let picks = 0;
    let wins = 0;
    RANK_FIELDS.forEach((n) => {
      picks += hero[`${n}_pick`] || 0;
      wins += hero[`${n}_win`] || 0;
    });
    return { picks, wins };
  }
  return { picks: hero[bracket.pickField] || 0, wins: hero[bracket.winField] || 0 };
}

/* ---------- hero pool (persisted in localStorage) ---------- */

function useHeroPool() {
  const [pool, setPool] = useState(() => {
    try {
      const raw = localStorage.getItem("dw_pool_v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const toggle = (id) => {
    setPool((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("dw_pool_v1", JSON.stringify(next));
      } catch {
        // storage unavailable — pool just won't persist across reloads
      }
      return next;
    });
  };
  return [pool, toggle];
}

/* ---------- tab 5: draft 5x5 ---------- */

const POSITIONS = [
  { label: "Позиция 1", hint: "Керри" },
  { label: "Позиция 2", hint: "Мидлейнер" },
  { label: "Позиция 3", hint: "Оффлейнер" },
  { label: "Позиция 4", hint: "Саппорт" },
  { label: "Позиция 5", hint: "Хард-саппорт" },
];

function DraftTab({ heroes, onOpenCard }) {
  const [radiant, setRadiant] = useState([null, null, null, null, null]);
  const [dire, setDire] = useState([null, null, null, null, null]);
  const [pool, togglePool] = useHeroPool();
  const [picker, setPicker] = useState(null); // { side, index } | null
  const [pickerQuery, setPickerQuery] = useState("");
  const [poolOnly, setPoolOnly] = useState(false);
  const [, forceRerender] = useState(0);
  const [premium] = usePremium();
  const [savedDrafts, setSavedDrafts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("dw_saved_drafts") || "[]");
    } catch {
      return [];
    }
  });

  function persistDrafts(next) {
    setSavedDrafts(next);
    try {
      localStorage.setItem("dw_saved_drafts", JSON.stringify(next));
    } catch {
      notify("Не удалось сохранить драфт — хранилище браузера переполнено.");
    }
  }

  function saveCurrentDraft() {
    if (radiant.every((x) => !x) && dire.every((x) => !x)) {
      notify("Сначала выбери хотя бы одного героя.");
      return;
    }
    const entry = { id: Date.now(), radiant: [...radiant], dire: [...dire] };
    persistDrafts([entry, ...savedDrafts].slice(0, 20));
  }

  function loadDraft(entry) {
    setRadiant(entry.radiant);
    setDire(entry.dire);
  }

  const heroById = (id) => heroes.find((h) => h.id === id);
  const pickedIds = useMemo(() => [...radiant, ...dire].filter(Boolean), [radiant, dire]);

  /* Драфт считается по обычным матчам, как и остальные разделы. На про-сцене выборки
     крошечные, и оценка по ним получалась недостоверной. При отказе источника обычных
     игр подставляются про-данные, чтобы расчёт не пропадал совсем. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of pickedIds) {
        if (publicMatchupsCache.has(id) || matchupsCache.has(id)) continue;
        try {
          await getPublicMatchups(id);
          if (!cancelled) forceRerender((v) => v + 1);
        } catch {
          try {
            await getMatchups(id);
            if (!cancelled) forceRerender((v) => v + 1);
          } catch {
            // hero's matchups unavailable — pairs involving it stay "unknown"
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedIds.join(",")]);

  function matchupsFor(id) {
    return publicMatchupsCache.get(id) || matchupsCache.get(id) || null;
  }

  function pairWinRate(aId, bId) {
    const aData = matchupsFor(aId);
    if (aData) {
      const e = aData.find((m) => m.hero_id === bId);
      if (e && e.games_played > 0) return e.wins / e.games_played;
    }
    const bData = matchupsFor(bId);
    if (bData) {
      const e = bData.find((m) => m.hero_id === aId);
      if (e && e.games_played > 0) return 1 - e.wins / e.games_played;
    }
    return null;
  }

  const matchupPairs = useMemo(() => {
    const rows = [];
    radiant.forEach((r) => {
      if (!r) return;
      dire.forEach((d) => {
        if (!d) return;
        const wr = pairWinRate(r, d);
        if (wr != null) rows.push({ r, d, wr });
      });
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiant, dire, pickedIds.join(",")]);

  const totalPossiblePairs = radiant.filter(Boolean).length * dire.filter(Boolean).length;
  const radiantEstimate =
    matchupPairs.length > 0 ? matchupPairs.reduce((s, x) => s + x.wr, 0) / matchupPairs.length : null;

  const verdict = useMemo(() => {
    if (radiantEstimate == null) return null;
    const radiantFavoured = radiantEstimate >= 0.5;
    const pct = Math.round((radiantFavoured ? radiantEstimate : 1 - radiantEstimate) * 100);
    const margin = Math.abs(radiantEstimate - 0.5) * 200; // 0..100
    let title;
    if (margin < 3) title = "Примерно равны";
    else title = `Впереди ${radiantFavoured ? "Radiant" : "Dire"}`;
    return {
      pct,
      title,
      color: margin < 3 ? "#C084FC" : radiantFavoured ? "#5FCB8E" : "#E2574C",
      radiantFavoured,
      margin,
    };
  }, [radiantEstimate]);

  /* Короткое объяснение строится только из посчитанных пар: какие матчапы дали перевес
     и какой герой соперника тянет вниз. Ничего додуманного. */
  const reasons = useMemo(() => {
    if (!verdict || matchupPairs.length === 0) return [];
    const favoured = verdict.radiantFavoured;
    const scored = matchupPairs.map((x) => ({
      ...x,
      edge: favoured ? x.wr - 0.5 : 0.5 - x.wr,
    }));

    const best = [...scored].sort((a, b) => b.edge - a.edge).slice(0, 2);
    const worst = [...scored].sort((a, b) => a.edge - b.edge)[0];

    const out = [];
    best.forEach((b) => {
      if (b.edge <= 0.02) return;
      const mine = heroById(favoured ? b.r : b.d);
      const theirs = heroById(favoured ? b.d : b.r);
      if (mine && theirs) {
        out.push(`${mine.localized_name} уверенно играет против ${theirs.localized_name} — ${Math.round((favoured ? b.wr : 1 - b.wr) * 100)}%`);
      }
    });
    if (worst && worst.edge < -0.02) {
      const mine = heroById(favoured ? worst.r : worst.d);
      const theirs = heroById(favoured ? worst.d : worst.r);
      if (mine && theirs) {
        out.push(`Слабое место: ${mine.localized_name} против ${theirs.localized_name} — ${Math.round((favoured ? worst.wr : 1 - worst.wr) * 100)}%`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict, matchupPairs, heroes]);

  function biggestThreat(myTeam, enemyTeam) {
    const myIds = myTeam.filter(Boolean);
    const enemyIds = enemyTeam.filter(Boolean);
    if (!myIds.length || !enemyIds.length) return null;
    let worst = null;
    enemyIds.forEach((eid) => {
      const rates = myIds.map((mid) => pairWinRate(mid, eid)).filter((v) => v != null);
      if (!rates.length) return;
      const avg = rates.reduce((s, v) => s + v, 0) / rates.length;
      if (!worst || avg < worst.avg) worst = { heroId: eid, avg, coverage: rates.length, total: myIds.length };
    });
    return worst;
  }

  function bestOpportunity(myTeam, enemyTeam) {
    const myIds = myTeam.filter(Boolean);
    const enemyIds = enemyTeam.filter(Boolean);
    if (!myIds.length || !enemyIds.length) return null;
    let best = null;
    myIds.forEach((mid) => {
      const rates = enemyIds.map((eid) => pairWinRate(mid, eid)).filter((v) => v != null);
      if (!rates.length) return;
      const avg = rates.reduce((s, v) => s + v, 0) / rates.length;
      if (!best || avg > best.avg) best = { heroId: mid, avg, coverage: rates.length, total: enemyIds.length };
    });
    return best;
  }

  function farmPriority(myTeam) {
    const myIds = myTeam.filter(Boolean);
    const carries = myIds
      .map((id) => heroById(id))
      .filter((h) => h && h.roles && h.roles.includes("Carry") && h.pro_pick);
    if (!carries.length) return null;
    const ranked = carries.map((h) => ({ hero: h, wr: h.pro_win / h.pro_pick })).sort((a, b) => b.wr - a.wr);
    return ranked[0];
  }

  function gamePlanFor(myTeam, enemyTeam) {
    return {
      threat: biggestThreat(myTeam, enemyTeam),
      opportunity: bestOpportunity(myTeam, enemyTeam),
      farm: farmPriority(myTeam),
    };
  }

  function suggestions(side) {
    const enemyIds = (side === "radiant" ? dire : radiant).filter(Boolean);
    if (enemyIds.length === 0) return [];
    const taken = new Set(pickedIds);
    let candidates = heroes.filter((h) => !taken.has(h.id));
    if (poolOnly && pool.length) candidates = candidates.filter((h) => pool.includes(h.id));
    const scored = candidates
      .map((h) => {
        const breakdown = enemyIds
          .map((eid) => ({ enemyId: eid, rate: pairWinRate(h.id, eid) }))
          .filter((b) => b.rate != null);
        if (breakdown.length === 0) return null;
        return {
          hero: h,
          score: breakdown.reduce((s, b) => s + b.rate, 0) / breakdown.length,
          coverage: breakdown.length,
          total: enemyIds.length,
          breakdown,
        };
      })
      .filter(Boolean);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5);
  }

  const filteredPicker = useMemo(() => {
    const taken = new Set(pickedIds);
    let list = heroes.filter((h) => !taken.has(h.id));
    if (poolOnly && pool.length) list = list.filter((h) => pool.includes(h.id));
    const q = pickerQuery.trim().toLowerCase();
    if (q) list = list.filter((h) => h.localized_name.toLowerCase().includes(q));
    return list;
  }, [heroes, pickedIds, poolOnly, pool, pickerQuery]);

  function assign(heroId) {
    if (!picker) return;
    const setTeam = picker.side === "radiant" ? setRadiant : setDire;
    setTeam((prev) => {
      const next = [...prev];
      next[picker.index] = heroId;
      return next;
    });
    setPicker(null);
    setPickerQuery("");
  }

  function clearSlot(side, index) {
    const setTeam = side === "radiant" ? setRadiant : setDire;
    setTeam((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }

  return (
    <div style={styles.body}>
      <div style={styles.draftToolbar}>
        <label style={styles.poolToggle}>
          <input type="checkbox" checked={poolOnly} onChange={(e) => setPoolOnly(e.target.checked)} />
          Подбирать только из моего пула {pool.length ? `(${pool.length})` : "(пусто)"}
        </label>
        {radiant.every((x) => !x) && dire.every((x) => !x) && pool.length === 0 && (
          <span style={styles.mutedText}>
            Совет: отметь звёздочкой своих героев в списке ниже — они появятся в фильтре пула.
          </span>
        )}
      </div>

      <div className="draft-grid" style={styles.draftGrid}>
        <TeamPanel
          title="Radiant"
          color="#5FCB8E"
          team={radiant}
          heroById={heroById}
          onSlotClick={(i) => setPicker({ side: "radiant", index: i })}
          onClear={(i) => clearSlot("radiant", i)}
        />
        <div style={styles.vsCol}>
          <div style={styles.vsGauge}>
            {radiantEstimate == null ? (
              <span style={styles.mutedText}>Выбери героев в обеих командах</span>
            ) : (
              <>
                <div style={{ ...styles.vsPct, color: verdict.color }}>
                  {verdict.pct}%
                </div>
                <div style={{ ...styles.vsWinner, color: verdict.color }}>{verdict.title}</div>
                <div style={{ ...styles.mutedText, fontSize: 11, marginTop: 4 }}>
                  по {matchupPairs.length} парам из {totalPossiblePairs}
                </div>
              </>
            )}
          </div>
        </div>
        <TeamPanel
          title="Dire"
          color="#E2574C"
          team={dire}
          heroById={heroById}
          onSlotClick={(i) => setPicker({ side: "dire", index: i })}
          onClear={(i) => clearSlot("dire", i)}
        />
      </div>

      {reasons.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <Info size={16} color="#C084FC" />
            <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Почему так</span>
          </div>
          {reasons.map((r, i) => (
            <div key={i} style={styles.reasonRow}>
              <span style={styles.patchBullet} />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}

      <div className="two-col" style={styles.twoCol}>
        <SuggestionPanel title="Лучший пик за Radiant" color="#5FCB8E" items={suggestions("radiant")} heroById={heroById} onOpenCard={onOpenCard} />
        <SuggestionPanel title="Лучший пик за Dire" color="#E2574C" items={suggestions("dire")} heroById={heroById} onOpenCard={onOpenCard} />
      </div>

      <div className="two-col" style={styles.twoCol}>
        <GamePlanPanel title="План игры — Radiant" color="#5FCB8E" plan={gamePlanFor(radiant, dire)} heroById={heroById} onOpenCard={onOpenCard} />
        <GamePlanPanel title="План игры — Dire" color="#E2574C" plan={gamePlanFor(dire, radiant)} heroById={heroById} onOpenCard={onOpenCard} />
      </div>

      {premium && <TimelineForecast radiant={radiant} dire={dire} heroById={heroById} />}

      {premium ? (
        <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
          <div style={styles.panelHeader}>
            <Gem size={16} color="#E5B33D" />
            <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>История драфтов</span>
            <button style={{ ...styles.tourGo, marginLeft: "auto" }} onClick={saveCurrentDraft}>
              Сохранить текущий
            </button>
          </div>
          {savedDrafts.length === 0 && <div style={styles.emptyState}>Пока ничего не сохранено.</div>}
          {savedDrafts.map((entry) => (
            <div key={entry.id} style={styles.savedDraftRow}>
              <div style={styles.savedDraftIcons}>
                {entry.radiant.filter(Boolean).map((id) => {
                  const h = heroById(id);
                  return h ? <HeroIcon key={`r${id}`} hero={h} style={styles.savedDraftIcon} /> : null;
                })}
                <span style={styles.savedVs}>vs</span>
                {entry.dire.filter(Boolean).map((id) => {
                  const h = heroById(id);
                  return h ? <HeroIcon key={`d${id}`} hero={h} style={styles.savedDraftIcon} /> : null;
                })}
              </div>
              <span style={{ ...styles.mutedText, fontSize: 11 }}>
                {new Date(entry.id).toLocaleDateString("ru-RU")}
              </span>
              <button style={styles.tourGo} onClick={() => loadDraft(entry)}>Открыть</button>
              <button
                style={styles.slotClear}
                onClick={() => persistDrafts(savedDrafts.filter((d) => d.id !== entry.id))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <PremiumLock
          title="История драфтов"
          text="Прогноз по ходу игры (до 10, около 30 и 60+ минут) и история сохранённых драфтов. Входит в Premium — включить демо можно на вкладке «Тарифы»."
        />
      )}

      {picker && (
        <div style={styles.pickerOverlay} onClick={() => setPicker(null)}>
          <div style={styles.pickerModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.pickerHeader}>
              <Search size={14} color="#9C8FB0" />
              <input
                autoFocus
                style={styles.dropdownInput}
                placeholder={`Герой для ${picker.side === "radiant" ? "Radiant" : "Dire"}…`}
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
              />
              <button style={styles.pickerClose} onClick={() => setPicker(null)}><X size={16} /></button>
            </div>
            <div style={styles.pickerList}>
              {filteredPicker.map((h) => (
                <div key={h.id} style={styles.pickerItem}>
                  <div style={styles.pickerItemMain} onClick={() => assign(h.id)}>
                    <HeroIcon hero={h} style={styles.dropdownIcon} />
                    <span style={{ fontSize: 13 }}>{h.localized_name}</span>
                  </div>
                  <button
                    style={styles.starBtn}
                    onClick={(e) => { e.stopPropagation(); togglePool(h.id); }}
                    title="В мой пул"
                  >
                    <Star size={15} fill={pool.includes(h.id) ? "#B24BF3" : "none"} color="#C084FC" />
                  </button>
                </div>
              ))}
              {filteredPicker.length === 0 && (
                <div style={{ ...styles.mutedText, padding: 16, textAlign: "center" }}>Никого не нашлось.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamPanel({ title, color, team, heroById, onSlotClick, onClear }) {
  return (
    <div style={{ ...styles.panel, borderTop: `3px solid ${color}` }}>
      <div style={{ ...styles.panelTitle, color, marginBottom: 10 }}>{title}</div>
      {team.map((id, i) => {
        const h = id ? heroById(id) : null;
        const pos = POSITIONS[i];
        return (
          <div key={i} style={styles.slotRow}>
            <span style={styles.slotPos}>{pos.label}</span>
            {h ? (
              <>
                <HeroIcon hero={h} style={styles.matchupIcon} />
                <span style={styles.matchupName}>{h.localized_name}</span>
                <button style={styles.slotClear} onClick={() => onClear(i)}><X size={13} /></button>
              </>
            ) : (
              <button style={styles.slotEmpty} onClick={() => onSlotClick(i)}>
                <Plus size={14} /> {pos.hint}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Прогноз по минутам строится на реальной статистике: OpenDota отдаёт винрейт каждого
   героя по длительности матча. Складываем показатели команд в трёх точках игры. */
const durationsCache = new Map();

async function getHeroDurations(heroId) {
  if (durationsCache.has(heroId)) return durationsCache.get(heroId);
  const cacheKey = `dw_dur_${heroId}`;
  const cached = readLocalCache(cacheKey);
  if (cached) {
    durationsCache.set(heroId, cached);
    return cached;
  }
  const r = await rateLimitedFetch(`https://api.opendota.com/api/heroes/${heroId}/durations`);
  if (!r.ok) throw new Error("network");
  const data = await r.json();
  durationsCache.set(heroId, data);
  try {
    writeLocalCache(cacheKey, data);
  } catch {
    // quota — refetched later
  }
  return data;
}

const TIME_POINTS = [
  { label: "до 10 мин", maxBin: 900, hint: "ранняя стадия" },
  { label: "около 30 мин", minBin: 1500, maxBin: 2400, hint: "середина игры" },
  { label: "60+ мин", minBin: 3600, hint: "затяжная игра" },
];

function TimelineForecast({ radiant, dire, heroById }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const ids = [...radiant, ...dire].filter(Boolean);
  const key = ids.join(",");

  useEffect(() => {
    if (ids.length < 2) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, data: null, error: null });

    Promise.all(ids.map((id) => getHeroDurations(id).catch(() => null)))
      .then((all) => {
        if (cancelled) return;
        const byHero = {};
        ids.forEach((id, i) => (byHero[id] = all[i]));

        const rows = TIME_POINTS.map((tp) => {
          function sideRate(side) {
            let games = 0;
            let wins = 0;
            side.filter(Boolean).forEach((id) => {
              (byHero[id] || []).forEach((bin) => {
                const b = Number(bin.duration_bin);
                if (tp.minBin && b < tp.minBin) return;
                if (tp.maxBin && b > tp.maxBin) return;
                games += Number(bin.games_played) || 0;
                wins += Number(bin.wins) || 0;
              });
            });
            return games > 0 ? wins / games : null;
          }
          const r = sideRate(radiant);
          const d = sideRate(dire);
          if (r == null || d == null) return { ...tp, known: false };
          // нормируем: чья сумма винрейтов выше в этом отрезке
          const share = r / (r + d);
          return { ...tp, known: true, radiantShare: share };
        });

        setState({ loading: false, data: rows, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, data: null, error: "Не удалось построить прогноз." });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (ids.length < 2) return null;

  return (
    <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
      <div style={styles.panelHeader}>
        <Gem size={16} color="#E5B33D" />
        <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>Прогноз по ходу игры</span>
      </div>

      {state.loading && <SkeletonRows count={3} />}
      {state.error && <div style={styles.emptyState}>{state.error}</div>}

      {state.data && state.data.map((row) => {
        if (!row.known) {
          return (
            <div key={row.label} style={styles.forecastRow}>
              <span style={styles.forecastLabel}>{row.label}</span>
              <span style={styles.mutedText}>нет данных</span>
            </div>
          );
        }
        const radiantPct = Math.round(row.radiantShare * 100);
        const leader = radiantPct >= 50 ? "Radiant" : "Dire";
        const leaderPct = radiantPct >= 50 ? radiantPct : 100 - radiantPct;
        const color = Math.abs(radiantPct - 50) < 2 ? "#C084FC" : radiantPct >= 50 ? "#5FCB8E" : "#E2574C";
        return (
          <div key={row.label} style={styles.forecastRow}>
            <span style={styles.forecastLabel}>{row.label}</span>
            <div style={styles.forecastBarTrack}>
              <div style={{ ...styles.forecastBarFill, width: `${radiantPct}%` }} />
            </div>
            <span style={{ ...styles.forecastValue, color }}>
              {Math.abs(radiantPct - 50) < 2 ? "равно" : `${leader} ${leaderPct}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function GamePlanPanel({ title, color, plan, heroById, onOpenCard }) {
  const { threat, opportunity, farm } = plan;
  const hasAny = threat || opportunity || farm;

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <Swords size={16} color={color} />
        <span style={{ ...styles.panelTitle, color }}>{title}</span>
      </div>

      {!hasAny && (
        <div style={styles.mutedText}>Собери обе команды хотя бы частично, чтобы увидеть план.</div>
      )}

      {threat && (
        <PlanLine
          icon={<TrendingDown size={14} color="#E2574C" />}
          label="Главная угроза"
          hero={heroById(threat.heroId)}
          note={`в среднем контрит команду на ${((0.5 - threat.avg) * 200).toFixed(0)}%`}
          onOpenCard={onOpenCard}
        />
      )}
      {opportunity && (
        <PlanLine
          icon={<TrendingUp size={14} color="#5FCB8E" />}
          label="Лучший шанс"
          hero={heroById(opportunity.heroId)}
          note={`перевес против соперника ${(opportunity.avg * 100).toFixed(0)}%`}
          onOpenCard={onOpenCard}
        />
      )}
      {farm && (
        <PlanLine
          icon={<Crown size={14} color="#C084FC" />}
          label="Приоритет фарма"
          hero={farm.hero}
          note={`лучший проф. винрейт среди керри команды (${(farm.wr * 100).toFixed(0)}%)`}
          onOpenCard={onOpenCard}
        />
      )}
    </div>
  );
}

function PlanLine({ icon, label, hero, note, onOpenCard }) {
  if (!hero) return null;
  return (
    <div style={styles.planLine}>
      <div style={styles.planLineHeader}>
        {icon}
        <span style={styles.planLineLabel}>{label}</span>
      </div>
      <div style={styles.planLineRow} onClick={() => onOpenCard(hero.id)}>
        <HeroIcon hero={hero} style={styles.matchupIcon} />
        <span style={styles.matchupName}>{hero.localized_name}</span>
      </div>
      <div style={styles.planLineNote}>{note}</div>
    </div>
  );
}

function SuggestionPanel({ title, color, items, heroById, onOpenCard }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <Sparkles size={16} color={color} />
        <span style={{ ...styles.panelTitle, color }}>{title}</span>
      </div>
      {items.length === 0 && (
        <div style={styles.mutedText}>Добавь хотя бы одного героя в команду соперника, чтобы увидеть рекомендации.</div>
      )}
      {items.map(({ hero, score, coverage, total, breakdown }) => {
        const tier = trustTier(coverage, total);
        const reasons = [...breakdown]
          .sort((a, b) => b.rate - a.rate)
          .slice(0, 2)
          .map((b) => heroById(b.enemyId)?.localized_name)
          .filter(Boolean);
        return (
          <div key={hero.id} style={styles.suggestionItem} onClick={() => onOpenCard(hero.id)}>
            <div style={styles.roleRow}>
              <HeroIcon hero={hero} style={styles.matchupIcon} />
              <span style={styles.matchupName}>{hero.localized_name}</span>
              <span style={{ ...styles.rolePct, color }}>{(score * 100).toFixed(0)}%</span>
            </div>
            <div style={styles.suggestionMeta}>
              {reasons.length > 0 && (
                <span style={styles.suggestionReason}>Хорошо против: {reasons.join(", ")}</span>
              )}
              <span style={{ ...styles.trustBadge, color: tier.color, borderColor: tier.color }}>
                {tier.emoji} {coverage}/{total} данных
              </span>
            </div>
            <AiExplainButton />
          </div>
        );
      })}
    </div>
  );
}

function AiExplainButton() {
  const [showTeaser, setShowTeaser] = useState(false);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {!showTeaser && (
        <button style={styles.premiumBtn} onClick={() => setShowTeaser(true)}>
          <Lock size={11} /> Почему AI? <span style={styles.premiumTag}>PREMIUM</span>
        </button>
      )}
      {showTeaser && (
        <div style={styles.premiumTeaser}>
          <Sparkles size={12} color="#E5B33D" />
          AI-объяснение пика — часть Premium-подписки. Пока в разработке.
        </div>
      )}
    </div>
  );
}

function trustTier(coverage, total) {
  const ratio = total > 0 ? coverage / total : 0;
  if (ratio >= 0.8) return { emoji: "🟢", label: "высокое доверие", color: "#5FCB8E" };
  if (ratio >= 0.4) return { emoji: "🟡", label: "среднее доверие", color: "#E5B33D" };
  return { emoji: "🔴", label: "низкое доверие", color: "#E2574C" };
}

const POSITION_LABELS = {
  POSITION_1: "Позиция 1 — керри",
  POSITION_2: "Позиция 2 — мид",
  POSITION_3: "Позиция 3 — оффлейн",
  POSITION_4: "Позиция 4 — саппорт",
  POSITION_5: "Позиция 5 — хард-саппорт",
};
const POSITION_ORDER = ["POSITION_1", "POSITION_2", "POSITION_3", "POSITION_4", "POSITION_5"];
const MIN_MATCHES_POSITION = 500;

/* Real 1–5 positions come from STRATZ. OpenDota only has role tags (Carry/Support/...),
   which a hero can carry several of at once, so they never told you where a hero is
   actually played. */
function usePositionStats() {
  const [state, setState] = useState({ loading: true, rows: null, error: null, tried: null });

  useEffect(() => {
    let cancelled = false;
    const cached = readLocalCache("dw_positions_v1");
    if (cached) {
      setState({ loading: false, rows: cached, error: null, tried: null });
      return;
    }
    fetch("/api/stratz-positions")
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok || !json || !json.rows) {
          const detail = json && json.tried ? json.tried : [`HTTP ${r.status}`];
          throw Object.assign(new Error("positions failed"), { tried: detail });
        }
        try {
          writeLocalCache("dw_positions_v1", json.rows);
        } catch {
          // quota — server cache still helps
        }
        if (!cancelled) setState({ loading: false, rows: json.rows, error: null, tried: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({ loading: false, rows: null, error: "Не удалось загрузить статистику по позициям", tried: e.tried });
        }
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}

function RolesTab({ heroes, onPick }) {
  const [mode, setMode] = useState("positions");
  const [bracketKey, setBracketKey] = useState("all");
  const bracket = BRACKETS.find((b) => b.key === bracketKey);
  const positions = usePositionStats();

  const heroById = (id) => heroes.find((h) => h.id === id);

  const byPosition = useMemo(() => {
    const map = {};
    POSITION_ORDER.forEach((pos) => (map[pos] = []));
    (positions.rows || []).forEach((row) => {
      const bucket = map[row.position];
      if (!bucket) return;
      if (!row.matchCount || row.matchCount < MIN_MATCHES_POSITION) return;
      const hero = heroById(row.heroId);
      if (!hero) return;
      bucket.push({ hero, winRate: row.winCount / row.matchCount, matches: row.matchCount });
    });
    Object.keys(map).forEach((pos) => map[pos].sort((a, b) => b.winRate - a.winRate));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.rows, heroes]);

  const byRole = useMemo(() => {
    const map = {};
    ROLE_ORDER.forEach((r) => (map[r] = []));
    heroes.forEach((h) => {
      const { picks, wins } = bracketStats(h, bracket);
      if (!picks || picks < bracket.minPicks) return;
      const winRate = wins / picks;
      (h.roles || []).forEach((r) => {
        if (map[r]) map[r].push({ hero: h, winRate, picks });
      });
    });
    Object.keys(map).forEach((r) => map[r].sort((a, b) => b.winRate - a.winRate));
    return map;
  }, [heroes, bracket]);

  return (
    <div style={styles.body}>
      <div style={styles.segment}>
        <button
          style={{ ...styles.segmentBtn, ...(mode === "positions" ? styles.segmentBtnActive : {}) }}
          onClick={() => setMode("positions")}
        >
          Позиции 1–5
        </button>
        <button
          style={{ ...styles.segmentBtn, ...(mode === "roles" ? styles.segmentBtnActive : {}) }}
          onClick={() => setMode("roles")}
        >
          По ролям и рангам
        </button>
      </div>

      {mode === "positions" && (
        <>
          {positions.loading && (
            <div style={styles.roleGrid}>
              {POSITION_ORDER.map((pos) => (
                <div key={pos} style={styles.panel}><SkeletonRows count={5} /></div>
              ))}
            </div>
          )}

          {positions.error && (
            <div style={styles.localeError}>
              <div>{positions.error}</div>
              {positions.tried && (
                <div style={styles.localeTried}>
                  {positions.tried.map((t, i) => <div key={i}>{t}</div>)}
                </div>
              )}
            </div>
          )}

          {!positions.loading && !positions.error && (
            <div style={styles.roleGrid}>
              {POSITION_ORDER.map((pos) => {
                const list = byPosition[pos].slice(0, 5);
                return (
                  <div key={pos} style={styles.panel}>
                    <div style={styles.panelHeader}>
                      <Crown size={16} color="#C084FC" />
                      <span style={{ ...styles.panelTitle, color: "#C084FC" }}>{POSITION_LABELS[pos]}</span>
                    </div>
                    {list.length === 0 && <div style={styles.emptyState}>Недостаточно данных.</div>}
                    {list.map(({ hero, winRate, matches }, i) => (
                      <div key={hero.id} className="role-row" style={styles.roleRow} onClick={() => onPick(hero.id)}>
                        <span style={styles.roleRank}>{i + 1}</span>
                        <HeroIcon hero={hero} style={styles.matchupIcon} />
                        <span style={styles.matchupName}>{hero.localized_name}</span>
                        <span style={{ ...styles.mutedText, fontSize: 11 }}>
                          {matches > 1000 ? `${Math.round(matches / 1000)}k` : matches}
                        </span>
                        <span style={styles.rolePct}>{(winRate * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {mode === "roles" && (
        <>
          <div className="rank-scroll" style={styles.segment}>
            {BRACKETS.map((b) => (
              <button
                key={b.key}
                style={{ ...styles.segmentBtn, ...(bracketKey === b.key ? styles.segmentBtnActive : {}) }}
                onClick={() => setBracketKey(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>

          {bracketKey === "pro" && <TopBansPanel heroes={heroes} onPick={onPick} />}

          <div style={styles.roleGrid}>
            {ROLE_ORDER.map((role) => {
              const list = byRole[role].slice(0, 5);
              return (
                <div key={role} style={styles.panel}>
                  <div style={styles.panelHeader}>
                    <Crown size={16} color="#C084FC" />
                    <span style={{ ...styles.panelTitle, color: "#C084FC" }}>{ROLE_RU[role] || role}</span>
                  </div>
                  {list.length === 0 && <div style={styles.emptyState}>Недостаточно данных для этого ранга.</div>}
                  {list.map(({ hero, winRate }, i) => (
                    <div key={hero.id} className="role-row" style={styles.roleRow} onClick={() => onPick(hero.id)}>
                      <span style={styles.roleRank}>{i + 1}</span>
                      <HeroIcon hero={hero} style={styles.matchupIcon} />
                      <span style={styles.matchupName}>{hero.localized_name}</span>
                      <span style={styles.rolePct}>{(winRate * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TopBansPanel({ heroes, onPick }) {
  const topBanned = useMemo(() => {
    return [...heroes]
      .filter((h) => h.pro_ban)
      .sort((a, b) => b.pro_ban - a.pro_ban)
      .slice(0, 10);
  }, [heroes]);

  if (topBanned.length === 0) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <Swords size={16} color="#E2574C" />
        <span style={{ ...styles.panelTitle, color: "#E2574C" }}>Топ банов в про-сцене</span>
      </div>
      <div style={styles.banGrid}>
        {topBanned.map((h, i) => (
          <div key={h.id} className="role-row" style={styles.roleRow} onClick={() => onPick(h.id)}>
            <span style={styles.roleRank}>{i + 1}</span>
            <HeroIcon hero={h} style={styles.matchupIcon} />
            <span style={styles.matchupName}>{h.localized_name}</span>
            <span style={{ ...styles.rolePct, color: "#E2574C" }}>{h.pro_ban}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CounterTableTab({ heroes, selected, selectedId, setSelectedId }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [heroQuery, setHeroQuery] = useState("");
  const [search, setSearch] = useState("");
  const [minGames, setMinGames] = useState(30);
  const [direction, setDirection] = useState("counters");
  const [sortDesc, setSortDesc] = useState(true);
  const [source, setSource] = useState("public");
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: matchups, loading, error, fellBack, fallbackReason, meta } = useMatchups(selectedId, source, refreshKey);

  const heroById = (id) => heroes.find((h) => h.id === id);

  function refreshMatchups() {
    publicMatchupsCache.delete(selectedId);
    matchupsCache.delete(selectedId);
    matchupsMeta.delete(selectedId);
    try {
      localStorage.removeItem(`dw_stratz_mu_${selectedId}`);
      localStorage.removeItem(`dw_matchups_${selectedId}`);
    } catch {
      // storage unavailable — in-memory reset is enough for this session
    }
    setRefreshKey((k) => k + 1);
  }

  const rows = useMemo(() => {
    if (!matchups) return [];
    let list = matchups
      .filter((m) => m.games_played >= minGames)
      .map((m) => {
        const enemy = heroById(m.hero_id);
        const winRate = m.wins / m.games_played;
        return { enemy, games: m.games_played, winRate, score: counterScore(winRate) };
      })
      .filter((r) => r.enemy);

    list = direction === "counters" ? list.filter((r) => r.winRate < 0.5) : list.filter((r) => r.winRate > 0.5);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.enemy.localized_name.toLowerCase().includes(q));
    }

    list.sort((a, b) => (sortDesc ? b.score - a.score : a.score - b.score));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchups, minGames, direction, search, sortDesc]);

  const filteredHeroList = useMemo(() => {
    const q = heroQuery.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((h) => h.localized_name.toLowerCase().includes(q));
  }, [heroes, heroQuery]);

  const attr = ATTR[selected.primary_attr] || ATTR.all;

  return (
    <div style={styles.body}>
      <div style={styles.heroSelectWrap}>
        <span style={styles.heroSelectLabel}>Анализируем героя:</span>
        <button style={{ ...styles.heroSelectBtn, borderColor: attr.color }} onClick={() => setPickerOpen((v) => !v)}>
          <HeroIcon hero={selected} style={styles.heroSelectIcon} />
          <span style={styles.heroSelectName}>{selected.localized_name}</span>
          <ChevronDown size={16} color="#9C8FB0" />
        </button>
        {pickerOpen && (
          <div style={styles.dropdown}>
            <div style={styles.dropdownSearch}>
              <Search size={14} color="#9C8FB0" />
              <input
                autoFocus
                style={styles.dropdownInput}
                placeholder="Найти героя…"
                value={heroQuery}
                onChange={(e) => setHeroQuery(e.target.value)}
              />
            </div>
            <div style={styles.dropdownList}>
              {filteredHeroList.map((h) => (
                <div
                  key={h.id}
                  style={styles.dropdownItem}
                  onClick={() => {
                    setSelectedId(h.id);
                    setPickerOpen(false);
                    setHeroQuery("");
                  }}
                >
                  <HeroIcon hero={h} style={styles.dropdownIcon} />
                  <span style={{ fontSize: 13 }}>{h.localized_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rank-scroll" style={styles.segment}>
        <button
          style={{ ...styles.segmentBtn, ...(source === "public" ? styles.segmentBtnActive : {}) }}
          onClick={() => setSource("public")}
        >
          Обычные матчи
        </button>
        <button
          style={{ ...styles.segmentBtn, ...(source === "pro" ? styles.segmentBtnActive : {}) }}
          onClick={() => setSource("pro")}
        >
          Про-сцена
        </button>
      </div>

      <div style={styles.sourceBar}>
        <span style={styles.sourceDot} />
        <span>
          {fellBack
            ? `Обычные матчи недоступны — показаны данные про-сцены${fallbackReason ? `: ${fallbackReason}` : ""}`
            : meta && meta.source === "pro"
            ? "Про-матчи"
            : `Обычные матчи${meta && meta.scope ? ` · ${meta.scope}` : ""}`}
        </span>
        {meta && meta.stale && <span style={styles.sourceStale}>сохранённая копия</span>}
        {meta && meta.fetchedAt && (
          <span style={styles.sourceTime}>
            обновлено {new Date(meta.fetchedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button style={styles.sourceRefresh} onClick={refreshMatchups}>Обновить</button>
      </div>

      <div className="toolbar" style={styles.toolbar}>
        <div style={styles.segment}>
          <button
            style={{ ...styles.segmentBtn, ...(direction === "counters" ? styles.segmentBtnActive : {}) }}
            onClick={() => setDirection("counters")}
          >
            Кто контрит {selected.localized_name}
          </button>
          <button
            style={{ ...styles.segmentBtn, ...(direction === "beaten" ? styles.segmentBtnActive : {}) }}
            onClick={() => setDirection("beaten")}
          >
            Кого контрит {selected.localized_name}
          </button>
        </div>
        <div className="controls" style={styles.controls}>
          <div style={styles.searchWrap}>
            <Search size={14} color="#9C8FB0" />
            <input
              style={styles.searchInput}
              placeholder="Фильтр по герою…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label style={styles.gamesLabel}>
            Мин. игр: {minGames}
            <input
              type="range" min="10" max="200" step="10" value={minGames}
              onChange={(e) => setMinGames(Number(e.target.value))}
              style={styles.slider}
            />
          </label>
        </div>
      </div>

      <div style={styles.tableWrap}>
        {loading && (
          <div style={{ padding: 14 }}>
            <SkeletonRows count={6} />
          </div>
        )}
        {error && <div style={styles.errorBox}>{error}</div>}
        {!loading && !error && (
          <div style={styles.tableInner}>
            <div style={styles.tableHeader}>
              <span style={{ flex: 1 }}>Герой</span>
              <span style={styles.colGames}>Игр</span>
              <span style={styles.colWinrate}>Винрейт {direction === "counters" ? "врага" : selected.localized_name}</span>
              <button style={styles.colScoreHeader} onClick={() => setSortDesc((v) => !v)}>
                Скор контра <ArrowUpDown size={12} />
              </button>
            </div>
            {rows.length === 0 && (
              <div style={styles.emptyState}>Нет пар с таким числом игр. Понизь порог «мин. игр» или смени фильтр.</div>
            )}
            {rows.map((r) => {
              const enemyWinRate = direction === "counters" ? 1 - r.winRate : r.winRate;
              const barColor = direction === "counters" ? "#E2574C" : "#5FCB8E";
              return (
                <div className="row" key={r.enemy.id} style={styles.row}>
                  <div style={styles.enemyCell}>
                    <HeroIcon hero={r.enemy} style={styles.enemyIcon} />
                    <span style={styles.enemyName}>{r.enemy.localized_name}</span>
                  </div>
                  <span style={styles.colGames}>{r.games}</span>
                  <span style={styles.colWinrate}>{(enemyWinRate * 100).toFixed(1)}%</span>
                  <div style={styles.colScore}>
                    <div style={styles.scoreBarTrack}>
                      <div style={{ ...styles.scoreBarFill, width: `${r.score}%`, background: barColor }} />
                    </div>
                    <span style={styles.scoreNum}>{r.score}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- tab 3: counter web ---------- */

const SCOPE_OPTIONS = [
  { key: "top24", label: "Топ-24 меты", count: 24 },
  { key: "top48", label: "Топ-48 меты", count: 48 },
  { key: "all", label: "Все герои", count: Infinity },
];
const MIN_GAMES_EDGE = 200;
const EDGE_WINRATE_THRESHOLD = 0.55;

function NodeRing({ x, y, isActive, color, dimmed, onClick }) {
  return (
    <circle
      cx={x} cy={y} r={isActive ? 19 : 15}
      fill="#140B22" stroke={color} strokeWidth={isActive ? 3 : 1.5}
      opacity={dimmed ? 0.28 : 1}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    />
  );
}

function NodeIcon({ hero, x, y, zoom, isActive, dimmed, onClick }) {
  const a = ATTR[hero.primary_attr] || ATTR.all;
  const d = (isActive ? 30 : 24);
  return (
    <div
      className="node-btn"
      onClick={onClick}
      style={{
        position: "absolute",
        left: x * zoom,
        top: y * zoom,
        width: d,
        height: d,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        overflow: "hidden",
        cursor: "pointer",
        opacity: dimmed ? 0.28 : 1,
        pointerEvents: "auto",
        boxShadow: isActive ? `0 0 10px ${a.color}` : "none",
      }}
    >
      <HeroIcon hero={hero} style={{ width: d, height: d, display: "block", objectFit: "cover" }} />
    </div>
  );
}

function CounterWebTab({ heroes, onPick }) {
  const [scope, setScope] = useState("top24");
  const [graphHeroes, setGraphHeroes] = useState([]);
  const [edgesByHero, setEdgesByHero] = useState({});
  const [buildProgress, setBuildProgress] = useState(null);
  const [built, setBuilt] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [missingCount, setMissingCount] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef(null);
  const dragState = useRef(null);
  const didDragRef = useRef(false);

  async function buildGraph(nextScope) {
    const opt = SCOPE_OPTIONS.find((o) => o.key === nextScope);
    const sorted = [...heroes].sort((a, b) => (b.pro_pick || 0) - (a.pro_pick || 0));
    const selection = opt.count === Infinity ? heroes : sorted.slice(0, opt.count);
    setGraphHeroes(selection);
    setBuildProgress({ done: 0, total: selection.length });
    setActiveId(null);

    // паутина строится на обычных матчах, как и остальные разделы; про-данные —
    // запасной вариант, если источник обычных игр не ответит
    const toFetch = selection.filter((h) => !publicMatchupsCache.has(h.id) && !matchupsCache.has(h.id));
    let failed = 0;
    if (toFetch.length) {
      const doneBase = selection.length - toFetch.length;
      setBuildProgress({ done: doneBase, total: selection.length });
      let completed = 0;
      const CONCURRENCY = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < toFetch.length) {
          const h = toFetch[cursor++];
          try {
            await getPublicMatchups(h.id);
          } catch {
            try {
              await getMatchups(h.id);
            } catch {
              failed += 1; // counted and surfaced below, not silently dropped
            }
          }
          completed += 1;
          setBuildProgress({ done: doneBase + completed, total: selection.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));
    } else {
      setBuildProgress({ done: selection.length, total: selection.length });
    }

    const map = {};
    const validIds = new Set(selection.map((h) => h.id));
    let noData = 0;
    selection.forEach((h) => {
      const data = publicMatchupsCache.get(h.id) || matchupsCache.get(h.id);
      if (!data) {
        noData += 1;
        return;
      }
      map[h.id] = data
        .filter((m) => m.games_played >= MIN_GAMES_EDGE && validIds.has(m.hero_id))
        .map((m) => ({ targetId: m.hero_id, winRate: m.wins / m.games_played, games: m.games_played }));
    });
    setEdgesByHero(map);
    setMissingCount(noData);
    setBuildProgress(null);
    setBuilt(nextScope);
    if (failed > 0) {
      notify(`${failed} героев не загрузились (лимит запросов OpenDota) — нажми «сбросить» в графе, чтобы дозагрузить.`);
    }
  }

  useEffect(() => {
    if (heroes.length && built === null) buildGraph(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroes]);

  const heroById = (id) => graphHeroes.find((h) => h.id === id);

  const size = useMemo(() => {
    const n = graphHeroes.length || 24;
    // area needed scales with node count; phyllotaxis fills the disc evenly
    const area = n * 950;
    const radius = Math.max(280, Math.sqrt(area / Math.PI));
    return Math.round(radius * 2 + 70);
  }, [graphHeroes.length]);

  const nodes = useMemo(() => {
    const n = graphHeroes.length;
    if (n === 0) return [];
    const center = size / 2;
    const maxRadius = size / 2 - 35;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.5°
    return graphHeroes.map((h, i) => {
      const r = maxRadius * Math.sqrt((i + 0.5) / n);
      const angle = i * goldenAngle;
      return { hero: h, x: center + r * Math.cos(angle), y: center + r * Math.sin(angle) };
    });
  }, [graphHeroes, size]);

  // Auto-fit the graph to the container. A ResizeObserver is required here: the graph panel
  // is unmounted while the build progress bar shows, so a one-shot measurement would run
  // against a null/zero-size container and leave the graph pinned to the top-left corner.
  useEffect(() => {
    if (!autoFit) return;
    const el = containerRef.current;
    if (!el) return;

    function fit() {
      const availW = el.clientWidth;
      const availH = el.clientHeight;
      if (availW > 0 && availH > 0) {
        const z = Math.max(0.3, Math.min(1.8, Math.min(availW / size, availH / size)));
        setZoom(z);
        setPan({ x: (availW - size * z) / 2, y: (availH - size * z) / 2 });
      }
    }

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [size, autoFit, buildProgress]);

  // Track every active pointer so two-finger pinch works on touch, not just drag.
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  function pointerDistance() {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function onPointerDown(e) {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      // second finger down — switch from panning to pinching
      dragState.current = null;
      pinchRef.current = { startDist: pointerDistance(), startZoom: zoom };
      setAutoFit(false);
    } else if (pointersRef.current.size === 1) {
      onDragStart(e.clientX, e.clientY);
    }
  }

  function onPointerMove(e) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const dist = pointerDistance();
      if (dist > 0 && pinchRef.current.startDist > 0) {
        const next = pinchRef.current.startZoom * (dist / pinchRef.current.startDist);
        setZoom(Math.max(0.2, Math.min(2.5, next)));
        didDragRef.current = true;
      }
      return;
    }
    onDragMove(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) onDragEnd();
  }

  function onDragStart(clientX, clientY) {
    dragState.current = { startX: clientX, startY: clientY, panX: pan.x, panY: pan.y };
    didDragRef.current = false;
  }
  function onDragMove(clientX, clientY) {
    if (!dragState.current) return;
    const dx = clientX - dragState.current.startX;
    const dy = clientY - dragState.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDragRef.current = true;
    setPan({ x: dragState.current.panX + dx, y: dragState.current.panY + dy });
  }
  function onDragEnd() {
    dragState.current = null;
  }

  function handleNodeClick(heroId) {
    if (didDragRef.current) return;
    setActiveId((prev) => (prev === heroId ? null : heroId));
    onPick(heroId);
  }

  const nodePos = useMemo(() => {
    const map = {};
    nodes.forEach((n) => (map[n.hero.id] = n));
    return map;
  }, [nodes]);

  const activeEdges = useMemo(() => {
    if (!activeId || !edgesByHero[activeId]) return [];
    return edgesByHero[activeId].filter(
      (e) => Math.max(e.winRate, 1 - e.winRate) >= EDGE_WINRATE_THRESHOLD && nodePos[e.targetId]
    );
  }, [activeId, edgesByHero, nodePos]);

  const activeHero = activeId ? heroById(activeId) : null;
  const beatsMe = activeEdges.filter((e) => e.winRate < 0.5).sort((a, b) => a.winRate - b.winRate);
  const iBeat = activeEdges.filter((e) => e.winRate > 0.5).sort((a, b) => b.winRate - a.winRate);

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return new Set(graphHeroes.filter((h) => h.localized_name.toLowerCase().includes(q)).map((h) => h.id));
  }, [searchQuery, graphHeroes]);

  function handleSearchKeyDown(e) {
    if (e.key === "Enter" && searchMatches && searchMatches.size > 0) {
      const firstId = [...searchMatches][0];
      setActiveId(firstId);
      onPick(firstId);
      setSearchQuery("");
    } else if (e.key === "Escape") {
      setSearchQuery("");
    }
  }

  return (
    <div>
      <div style={styles.scopeRow}>
        {SCOPE_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => { setScope(o.key); buildGraph(o.key); }}
            disabled={!!buildProgress}
            style={{ ...styles.scopeBtn, ...(scope === o.key ? styles.scopeBtnActive : {}), opacity: buildProgress ? 0.5 : 1 }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {buildProgress && (
        <div style={styles.progressBox}>
          <Loader2 className="spin" size={16} color="#C084FC" />
          <span>Строю граф: {buildProgress.done} / {buildProgress.total} героев</span>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${(buildProgress.done / buildProgress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {!buildProgress && graphHeroes.length > 0 && (
        <div className="layout-cols" style={styles.webLayout}>
          <div style={styles.graphPanel}>
            <div style={styles.graphToolbar}>
              <div style={styles.graphSearchWrap}>
                <Search size={14} color="#9C8FB0" />
                <input
                  style={styles.dropdownInput}
                  placeholder="Найти героя…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
              <div style={styles.zoomControls}>
                <button style={styles.zoomBtn} onClick={() => { setAutoFit(false); setZoom((z) => Math.min(2.5, z + 0.2)); }}><ZoomIn size={14} /></button>
                <button style={styles.zoomBtn} onClick={() => { setAutoFit(false); setZoom((z) => Math.max(0.2, z - 0.2)); }}><ZoomOut size={14} /></button>
                <button
                  style={styles.zoomBtn}
                  title="Сбросить вид и дозагрузить недостающих героев"
                  onClick={() => { setAutoFit(true); if (missingCount > 0) buildGraph(scope); }}
                ><RotateCcw size={14} /></button>
              </div>
            </div>
            <div
              style={{ ...styles.svgScroll, cursor: dragState.current ? "grabbing" : "grab", touchAction: "none" }}
              ref={containerRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              onWheel={(e) => { e.preventDefault(); setAutoFit(false); setZoom((z) => Math.max(0.2, Math.min(2.5, z - e.deltaY * 0.001))); }}
            >
              <div style={{ position: "absolute", width: size, height: size, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}>
                  <defs>
                    <marker id="arrowhead-red" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#E2574C" />
                    </marker>
                    <marker id="arrowhead-green" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#5FCB8E" />
                    </marker>
                  </defs>
                  {activeHero &&
                    activeEdges.map((e) => {
                      const from = nodePos[activeId], to = nodePos[e.targetId];
                      if (!from || !to) return null;
                      const isCounter = e.winRate < 0.5;
                      return (
                        <line
                          className="edge-line" key={e.targetId} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                          stroke={isCounter ? "#E2574C" : "#5FCB8E"}
                          strokeWidth={Math.max(1, counterScore(e.winRate) / 18)} opacity={0.8}
                          markerEnd={`url(#arrowhead-${isCounter ? "red" : "green"})`}
                        />
                      );
                    })}
                  {nodes.map(({ hero, x, y }) => (
                    <NodeRing
                      key={hero.id}
                      x={x} y={y}
                      isActive={hero.id === activeId}
                      color={(ATTR[hero.primary_attr] || ATTR.all).color}
                      dimmed={
                        (activeId && hero.id !== activeId && !activeEdges.find((e) => e.targetId === hero.id)) ||
                        (searchMatches && !searchMatches.has(hero.id))
                      }
                      onClick={() => handleNodeClick(hero.id)}
                    />
                  ))}
                </svg>
                {nodes.map(({ hero, x, y }) => (
                  <NodeIcon
                    key={hero.id}
                    hero={hero}
                    x={x} y={y}
                    zoom={1}
                    isActive={hero.id === activeId}
                    dimmed={
                      (activeId && hero.id !== activeId && !activeEdges.find((e) => e.targetId === hero.id)) ||
                      (searchMatches && !searchMatches.has(hero.id))
                    }
                    onClick={() => handleNodeClick(hero.id)}
                  />
                ))}
              </div>
            </div>
            <div style={styles.legend}>
              <span style={styles.legendItem}><span style={{ ...styles.legendLine, background: "#E2574C" }} /> контрит выбранного</span>
              <span style={styles.legendItem}><span style={{ ...styles.legendLine, background: "#5FCB8E" }} /> кого он контрит</span>
              <span style={styles.legendItem}>толщина = сила контра · тяни холст, крути колесо/кнопки для масштаба</span>
            </div>
          </div>

          <div style={styles.sidePanel}>
            {!activeHero && (
              <div style={styles.hintBox}>
                <Info size={16} color="#9C8FB0" />
                <span>
                  Нажми на героя в паутине — откроется в карточке и таблице тоже.
                  {missingCount > 0 && ` У ${missingCount} героев данные не догрузились — нажми «сбросить».`}
                </span>
              </div>
            )}
            {activeHero && beatsMe.length === 0 && iBeat.length === 0 && (
              <div style={styles.emptyState}>
                У {activeHero.localized_name} нет связей выше {Math.round(EDGE_WINRATE_THRESHOLD * 100)}%
                при {MIN_GAMES_EDGE}+ совместных проф. матчах. Это не баг: в про-сцене этот герой либо
                играется редко, либо ни с кем не даёт заметного перекоса.
              </div>
            )}
            {activeHero && (
              <>
                <div style={styles.sideHeroRow}>
                  <HeroIcon hero={activeHero} style={styles.sideHeroIcon} />
                  <span style={styles.sideHeroName}>{activeHero.localized_name}</span>
                </div>
                <div style={styles.sideSection}>
                  <div style={{ ...styles.sideSectionTitle, color: "#E2574C" }}>Контрят его ({beatsMe.length})</div>
                  {beatsMe.map((e) => {
                    const h = heroById(e.targetId);
                    if (!h) return null;
                    return (
                      <div key={e.targetId} className="side-row" style={styles.sideRow}>
                        <HeroIcon hero={h} style={styles.sideRowIcon} />
                        <span style={styles.sideRowName}>{h.localized_name}</span>
                        <span style={{ ...styles.sideRowScore, color: "#E2574C" }}>{((1 - e.winRate) * 100).toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
                <div style={styles.sideSection}>
                  <div style={{ ...styles.sideSectionTitle, color: "#5FCB8E" }}>Он контрит ({iBeat.length})</div>
                  {iBeat.map((e) => {
                    const h = heroById(e.targetId);
                    if (!h) return null;
                    return (
                      <div key={e.targetId} className="side-row" style={styles.sideRow}>
                        <HeroIcon hero={h} style={styles.sideRowIcon} />
                        <span style={styles.sideRowName}>{h.localized_name}</span>
                        <span style={{ ...styles.sideRowScore, color: "#5FCB8E" }}>{(e.winRate * 100).toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- styles ---------- */

/* ---------- premium ---------- */

/* No payment provider is wired up yet, so this is a local demo flag: it lets the premium
   sections be built and reviewed without pretending a purchase happened. */
/* Server-checked subscription, tied to the Steam id from login. Falls back to the local
   demo flag while no payment provider is connected. */
async function checkServerPremium(steamId64) {
  if (!steamId64) return null;
  try {
    const r = await fetch(`/api/premium-status?steamid=${encodeURIComponent(steamId64)}`);
    if (!r.ok) return null;
    const data = await r.json();
    if (data.reason === "storage_not_configured") return null;
    return data;
  } catch {
    return null;
  }
}

function usePremium() {
  const [premium, setPremium] = useState(() => {
    try {
      return localStorage.getItem("dw_premium_demo") === "1" || localStorage.getItem("dw_premium_paid") === "1";
    } catch {
      return false;
    }
  });
  const toggle = (on) => {
    setPremium(on);
    try {
      if (on) localStorage.setItem("dw_premium_demo", "1");
      else localStorage.removeItem("dw_premium_demo");
    } catch {
      // storage unavailable — flag just won't persist
    }
  };
  return [premium, toggle];
}

function PremiumLock({ title, text }) {
  return (
    <div style={styles.premiumLockCard}>
      <div style={styles.premiumLockHead}>
        <Lock size={14} color="#E5B33D" />
        <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>{title}</span>
        <span style={styles.premiumTag}>PREMIUM</span>
      </div>
      <div style={{ ...styles.mutedText, fontSize: 12 }}>{text}</div>
    </div>
  );
}

const LANE_ROLE_LABELS = { 1: "Сейф-лейн", 2: "Мид", 3: "Оффлейн", 4: "Джунгли" };

/* Hero-pair synergy needs the full roster of each match, which the match-list endpoint
   doesn't include — so it pulls per-match details. That's one request per match, hence the
   explicit opt-in button, the progress bar and a cap on how many matches are analysed. */
const SYNERGY_MATCH_LIMIT = 40;

async function fetchAllySynergy(accountId, matches, onProgress) {
  const cacheKey = `dw_synergy_${accountId}`;
  const cached = readLocalCache(cacheKey, PLAYER_TTL_MS * 8);
  if (cached) return cached;

  const recent = [...matches]
    .filter((m) => m.match_id && m.player_slot != null && m.radiant_win != null)
    .sort((a, b) => (b.start_time || 0) - (a.start_time || 0))
    .slice(0, SYNERGY_MATCH_LIMIT);

  const acc = {};
  let analysed = 0;
  let failed = 0;

  for (let i = 0; i < recent.length; i++) {
    const m = recent[i];
    try {
      const r = await rateLimitedFetch(`https://api.opendota.com/api/matches/${m.match_id}`);
      if (!r.ok) throw new Error("network");
      const detail = await r.json();
      const players = detail.players || [];
      const me = players.find((p) => String(p.account_id) === String(accountId));
      const mySlot = me ? me.player_slot : m.player_slot;
      const iAmRadiant = mySlot < 128;
      const won = iAmRadiant === detail.radiant_win;

      players.forEach((p) => {
        if (!p.hero_id) return;
        const sameTeam = (p.player_slot < 128) === iAmRadiant;
        if (!sameTeam) return;
        if (p.player_slot === mySlot) return; // skip the player themselves
        if (!acc[p.hero_id]) acc[p.hero_id] = { games: 0, wins: 0 };
        acc[p.hero_id].games += 1;
        if (won) acc[p.hero_id].wins += 1;
      });
      analysed += 1;
    } catch {
      failed += 1;
    }
    onProgress(i + 1, recent.length);
  }

  const result = { acc, analysed, failed, total: recent.length };
  try {
    writeLocalCache(cacheKey, result);
  } catch {
    // quota — recalculated next time
  }
  return result;
}

function HeroSynergyPanel({ accountId, matches, heroes }) {
  const [state, setState] = useState({ status: "idle", data: null, progress: null });

  const heroById = (id) => heroes.find((h) => h.id === id);

  async function run() {
    setState({ status: "loading", data: null, progress: { done: 0, total: SYNERGY_MATCH_LIMIT } });
    try {
      const data = await fetchAllySynergy(accountId, matches, (done, total) =>
        setState((s) => ({ ...s, progress: { done, total } }))
      );
      setState({ status: "done", data, progress: null });
      if (data.failed > 0) notify(`${data.failed} матчей не удалось разобрать — показываю остальные.`);
    } catch {
      setState({ status: "error", data: null, progress: null });
      notify("Не удалось посчитать синергию по героям.");
    }
  }

  const rows = useMemo(() => {
    if (!state.data) return [];
    return Object.entries(state.data.acc)
      .map(([heroId, v]) => ({ hero: heroById(Number(heroId)), games: v.games, winRate: v.wins / v.games }))
      .filter((r) => r.hero && r.games >= 3)
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
      .slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data, heroes]);

  return (
    <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
      <div style={styles.panelHeader}>
        <Handshake size={16} color="#E5B33D" />
        <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>Синергия по героям союзников</span>
        {state.status === "idle" && (
          <button style={{ ...styles.tourGo, marginLeft: "auto" }} onClick={run}>Посчитать</button>
        )}
        {state.status === "done" && (
          <button style={{ ...styles.tourGo, marginLeft: "auto" }} onClick={run}>Пересчитать</button>
        )}
      </div>

      {state.status === "idle" && (
        <div style={{ ...styles.mutedText, fontSize: 12 }}>
          Разберём последние {SYNERGY_MATCH_LIMIT} матчей и посмотрим, с какими героями в союзниках
          ты выигрываешь чаще. Это по одному запросу на матч, поэтому займёт около минуты.
        </div>
      )}

      {state.status === "loading" && (
        <>
          <div style={{ ...styles.mutedText, fontSize: 12, marginBottom: 8 }}>
            Разбираю матчи: {state.progress?.done ?? 0} / {state.progress?.total ?? 0}
          </div>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${((state.progress?.done ?? 0) / (state.progress?.total || 1)) * 100}%`,
              }}
            />
          </div>
        </>
      )}

      {state.status === "error" && <div style={styles.emptyState}>Не удалось посчитать. Попробуй позже.</div>}

      {state.status === "done" && rows.length === 0 && (
        <div style={styles.emptyState}>
          Нет героев, которые встречались в союзниках хотя бы 3 раза за последние {state.data.analysed} матчей.
        </div>
      )}

      {state.status === "done" && rows.map((r) => (
        <div key={r.hero.id} style={styles.roleRow}>
          <HeroIcon hero={r.hero} style={styles.matchupIcon} />
          <span style={styles.matchupName}>{r.hero.localized_name}</span>
          <span style={styles.mutedText}>{r.games} игр</span>
          <span style={{ ...styles.rolePct, color: r.winRate >= 0.5 ? "#5FCB8E" : "#E2574C" }}>
            {(r.winRate * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function PremiumProfilePanels({ matches, accountId, heroes }) {
  const byLane = useMemo(() => {
    if (!Array.isArray(matches)) return [];
    const acc = {};
    matches.forEach((m) => {
      if (!m.lane_role || m.player_slot == null || m.radiant_win == null) return;
      const won = (m.player_slot < 128) === m.radiant_win;
      const key = m.lane_role;
      if (!acc[key]) acc[key] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
      acc[key].games += 1;
      if (won) acc[key].wins += 1;
      acc[key].kills += m.kills || 0;
      acc[key].deaths += m.deaths || 0;
      acc[key].assists += m.assists || 0;
    });
    return Object.entries(acc)
      .filter(([, v]) => v.games >= 3)
      .map(([lane, v]) => ({
        lane: LANE_ROLE_LABELS[lane] || `Роль ${lane}`,
        games: v.games,
        winRate: Math.round((v.wins / v.games) * 1000) / 10,
        kda: v.deaths > 0 ? ((v.kills + v.assists) / v.deaths).toFixed(2) : "—",
      }))
      .sort((a, b) => b.games - a.games);
  }, [matches]);

  const form = useMemo(() => {
    if (!Array.isArray(matches)) return [];
    const recent = [...matches]
      .filter((m) => m.start_time)
      .sort((a, b) => a.start_time - b.start_time)
      .slice(-40);
    return recent.map((m, i) => ({
      idx: i + 1,
      gpm: m.gold_per_min || 0,
      xpm: m.xp_per_min || 0,
    }));
  }, [matches]);

  return (
    <>
      <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
        <div style={styles.panelHeader}>
          <Gem size={16} color="#E5B33D" />
          <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>Разбор по позициям</span>
        </div>
        {byLane.length === 0 && <div style={styles.emptyState}>Недостаточно матчей с определённой позицией.</div>}
        {byLane.map((l) => (
          <div key={l.lane} style={styles.roleRow}>
            <span style={styles.matchupName}>{l.lane}</span>
            <span style={styles.mutedText}>{l.games} игр</span>
            <span style={{ ...styles.mutedText, minWidth: 74, textAlign: "right" }}>KDA {l.kda}</span>
            <span style={{ ...styles.rolePct, color: l.winRate >= 50 ? "#5FCB8E" : "#E2574C" }}>
              {l.winRate}%
            </span>
          </div>
        ))}
      </div>

      <HeroSynergyPanel accountId={accountId} matches={matches} heroes={heroes} />

      {form.length > 3 && (
        <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
          <div style={styles.panelHeader}>
            <Gem size={16} color="#E5B33D" />
            <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>Форма: золото и опыт в минуту</span>
          </div>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={form} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
                <XAxis dataKey="idx" tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
                <YAxis tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                  labelStyle={{ color: "#F2EAFB" }}
                  labelFormatter={(v) => `Матч ${v}`}
                />
                <Line type="monotone" dataKey="gpm" name="GPM" stroke="#E5B33D" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="xpm" name="XPM" stroke="#B24BF3" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...styles.mutedText, fontSize: 11, marginTop: 6 }}>
            Золото (жёлтая) и опыт (фиолетовая) в минуту.
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- tab: reference (abilities + items, from dotaconstants) ---------- */

function ReferenceTab({ heroes }) {
  const [mode, setMode] = useState("abilities");
  const [heroId, setHeroId] = useState(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: true, abilities: null, items: null, error: null });
  const [lang, setLang] = useState("ru");
  const [locale, setLocale] = useState({ loading: false, data: null, failed: false });

  useEffect(() => {
    if (heroes.length && heroId == null) setHeroId(heroes[0].id);
  }, [heroes, heroId]);

  // Russian pack is a one-time download, fetched only when RU is actually selected
  useEffect(() => {
    if (lang !== "ru" || locale.loading || locale.failed || (locale.data && !locale.data.partial)) return;
    let cancelled = false;
    setLocale((s) => ({ ...s, loading: true }));
    getRuLocale((partial) => {
      // показываем названия предметов и героев, не дожидаясь описаний способностей
      if (!cancelled) setLocale({ loading: true, data: partial, failed: false, tried: null });
    })
      .then((data) => {
        if (!cancelled) setLocale({ loading: false, data, failed: false, tried: null });
      })
      .catch((e) => {
        if (!cancelled) setLocale({ loading: false, data: null, failed: true, tried: e && e.tried });
      });
    return () => { cancelled = true; };
  }, [lang, locale.data, locale.loading, locale.failed]);

  function selectRu() {
    setLang("ru");
    // clear a previous failure so pressing RU actually retries
    if (locale.failed) setLocale({ loading: false, data: null, failed: false, tried: null });
  }

  function resetLocale() {
    try {
      localStorage.removeItem("dw_ru_all_v2");
    } catch {
      // storage unavailable — the in-memory reset below still applies
    }
    resetRuLocale();
    setLocale({ loading: false, data: null, failed: false, tried: null });
    setLang("ru");
  }

  const ru = lang === "ru" ? locale.data : null;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([getAbilitiesCatalog(), getItemsCatalog()])
      .then(([ab, it]) => {
        if (!cancelled) setState({ loading: false, abilities: ab, items: it, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, abilities: null, items: null, error: "Не удалось загрузить справочник." });
        notify("Справочник не загрузился — проверь подключение.");
      });
    return () => { cancelled = true; };
  }, []);

  const hero = heroes.find((h) => h.id === heroId) || null;

  const heroAbilityList = useMemo(() => {
    if (!state.abilities || !hero) return [];
    const entry = state.abilities.heroAbilities[hero.name];
    if (!entry || !entry.abilities) return [];
    return entry.abilities
      .map((key) => ({ key, data: state.abilities.abilities[key] }))
      .filter((a) => a.data && a.data.dname);
  }, [state.abilities, hero]);

  const itemList = useMemo(() => {
    if (!state.items) return [];
    const q = query.trim().toLowerCase();
    return Object.entries(state.items.items)
      .map(([key, data]) => ({ key, data }))
      .filter((i) => i.data && i.data.dname && i.data.cost)
      .filter((i) => {
        if (!q) return true;
        const rn = ruName(ru, i.key, true);
        return i.data.dname.toLowerCase().includes(q) || (rn ? rn.toLowerCase().includes(q) : false);
      })
      .sort((a, b) => (b.data.cost || 0) - (a.data.cost || 0))
      .slice(0, 60);
  }, [state.items, query, ru]);

  return (
    <div style={styles.body}>
      <div style={styles.segment}>
        <button
          style={{ ...styles.segmentBtn, ...(mode === "abilities" ? styles.segmentBtnActive : {}) }}
          onClick={() => setMode("abilities")}
        >
          Способности
        </button>
        <button
          style={{ ...styles.segmentBtn, ...(mode === "items" ? styles.segmentBtnActive : {}) }}
          onClick={() => setMode("items")}
        >
          Предметы
        </button>
        <span style={styles.langDivider} />
        <button
          style={{ ...styles.segmentBtn, ...(lang === "ru" ? styles.segmentBtnActive : {}) }}
          onClick={selectRu}
        >
          RU
        </button>
        <button
          style={{ ...styles.segmentBtn, ...(lang === "en" ? styles.segmentBtnActive : {}) }}
          onClick={() => setLang("en")}
        >
          EN
        </button>
      </div>

      {lang === "ru" && (locale.loading || locale.failed) && (
        <div style={locale.failed ? styles.localeError : styles.localeStatus}>
          <div>
            {locale.loading && !locale.data && "Перевод загружается — пока показаны оригинальные названия"}
            {locale.loading && locale.data && "Названия переведены, догружаю описания…"}
            {locale.failed && "Перевод недоступен — показаны оригинальные названия"}
          </div>
          {locale.data && locale.data.counts && (
            <div style={{ marginTop: 4 }}>
              Предметы: {locale.data.counts.items || 0} · Герои: {locale.data.counts.heroes || 0} ·
              Способности: {locale.data.counts.abilities || 0}
            </div>
          )}
          {locale.data && locale.data.diagnostics && Object.keys(locale.data.diagnostics).length > 0 && (
            <div style={styles.localeTried}>
              {Object.entries(locale.data.diagnostics).map(([k, v]) => <div key={k}>{k}: {v}</div>)}
            </div>
          )}
          {locale.tried && locale.tried.length > 0 && (
            <div style={styles.localeTried}>
              {locale.tried.map((t, i) => <div key={i}>{t}</div>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {locale.failed && (
              <button style={styles.tourGo} onClick={selectRu}>Повторить</button>
            )}
            <button style={styles.tourGo} onClick={resetLocale}>Сбросить кэш и загрузить заново</button>
          </div>
        </div>
      )}

      {state.loading && <SkeletonBlock height={260} />}
      {state.error && <div style={styles.emptyState}>{state.error}</div>}

      {!state.loading && !state.error && mode === "abilities" && hero && (
        <>
          <div style={styles.heroSelectWrap}>
            <span style={styles.heroSelectLabel}>Герой:</span>
            <ComparePicker heroes={heroes} selectedId={heroId} onSelect={setHeroId} align="left" />
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <BookOpen size={16} color="#C084FC" />
              <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Способности {hero.localized_name}</span>
            </div>
            {heroAbilityList.length === 0 && <div style={styles.emptyState}>Нет данных по способностям этого героя.</div>}
            {heroAbilityList.map(({ key, data }) => (
              <div key={key} style={styles.abilityRow}>
                {data.img && (
                  <img
                    src={img(data.img)}
                    alt=""
                    style={styles.abilityIcon}
                    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={styles.abilityName}>{ruName(ru, key, false) || data.dname}</div>
                  {ruName(ru, key, false) && <div style={styles.origName}>{data.dname}</div>}
                  {(ruDesc(ru, key, false) || data.desc) && (
                    <div style={styles.abilityDesc}>{ruDesc(ru, key, false) || data.desc}</div>
                  )}
                  {data.dmg_type && <div style={styles.abilityMeta}>Тип урона: {data.dmg_type}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!state.loading && !state.error && mode === "items" && (
        <>
          <div style={styles.searchWrap}>
            <Search size={14} color="#9C8FB0" />
            <input
              style={styles.searchInput}
              placeholder="Найти предмет…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <ShoppingBag size={16} color="#C084FC" />
              <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Предметы</span>
            </div>
            {itemList.length === 0 && <div style={styles.emptyState}>Ничего не нашлось.</div>}
            {itemList.map(({ key, data }) => (
              <div key={key} style={styles.abilityRow}>
                {data.img && (
                  <img
                    src={img(data.img)}
                    alt=""
                    style={styles.itemIconLg}
                    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={styles.abilityName}>
                    {ruName(ru, key, true) || data.dname}
                    <span style={styles.itemCost}>{data.cost} золота</span>
                  </div>
                  {ruName(ru, key, true) && <div style={styles.origName}>{data.dname}</div>}
                  {(ruDesc(ru, key, true) || data.desc || data.notes) && (
                    <div style={styles.abilityDesc}>{ruDesc(ru, key, true) || data.desc || data.notes}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- tab: patch history ---------- */

function PatchesTab() {
  const [state, setState] = useState({ loading: true, patches: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const cached = readLocalCache("dw_all_patches");
    if (cached) {
      setState({ loading: false, patches: cached, error: null });
      return;
    }
    fetch("https://api.opendota.com/api/constants/patch")
      .then((r) => {
        if (!r.ok) throw new Error("network");
        return r.json();
      })
      .then((data) => {
        writeLocalCache("dw_all_patches", data);
        if (!cancelled) setState({ loading: false, patches: data, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, patches: null, error: "Не удалось загрузить список патчей." });
        notify("Список патчей не загрузился.");
      });
    return () => { cancelled = true; };
  }, []);

  const list = useMemo(() => {
    if (!state.patches) return [];
    return [...state.patches].reverse().slice(0, 40);
  }, [state.patches]);

  return (
    <div style={styles.body}>
      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <History size={16} color="#C084FC" />
          <span style={{ ...styles.panelTitle, color: "#C084FC" }}>История патчей</span>
        </div>
        {state.loading && <SkeletonRows count={6} />}
        {state.error && <div style={styles.emptyState}>{state.error}</div>}
        {!state.loading && !state.error && list.map((p, i) => (
          <PatchRow key={p.name} patch={p} isLatest={i === 0} />
        ))}
      </div>
    </div>
  );
}

function PatchRow({ patch, isLatest }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState({ loading: false, data: null, error: false });
  const d = patch.date ? new Date(patch.date) : null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !notes.data && !notes.loading) {
      setNotes({ loading: true, data: null, error: false });
      getPatchNotes()
        .then((all) => setNotes({ loading: false, data: all[patch.name] || null, error: false }))
        .catch(() => setNotes({ loading: false, data: null, error: true }));
    }
  }

  const sections = useMemo(() => {
    if (!notes.data) return [];
    if (Array.isArray(notes.data)) {
      const lines = flattenPatchSection(notes.data);
      return lines.length ? [{ title: "Изменения", lines }] : [];
    }
    return Object.entries(notes.data)
      .map(([key, value]) => ({ title: prettifyPatchKey(key), lines: flattenPatchSection(value) }))
      .filter((s) => s.lines.length > 0);
  }, [notes.data]);

  return (
    <div style={styles.patchBlock}>
      <button style={styles.patchRowBtn} onClick={toggle}>
        <span style={{ ...styles.patchDot, background: isLatest ? "#B24BF3" : "#3A2857" }} />
        <span style={styles.patchName}>{patch.name}</span>
        {isLatest && <span style={styles.patchCurrent}>текущий</span>}
        <span style={styles.patchDate}>
          {d ? d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "—"}
        </span>
        <ChevronDown
          size={15}
          color="#9C8FB0"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s ease", flexShrink: 0 }}
        />
      </button>

      {open && (
        <div style={styles.patchBody}>
          {notes.loading && <SkeletonRows count={3} />}
          {notes.error && <div style={styles.emptyState}>Не удалось загрузить изменения этого патча.</div>}
          {!notes.loading && !notes.error && sections.length === 0 && (
            <div style={styles.emptyState}>
              Для этого патча разобранных изменений нет.
              {notes.data && (
                <div style={{ ...styles.localeTried, textAlign: "left" }}>
                  Полученные разделы: {Object.keys(notes.data).slice(0, 12).join(", ") || "пусто"}
                </div>
              )}
            </div>
          )}
          {sections.map((s) => (
            <div key={s.title} style={styles.patchSection}>
              <div style={styles.patchSectionTitle}>{s.title}</div>
              {s.lines.slice(0, 40).map((line, idx) => (
                <div key={idx} style={styles.patchLine}>
                  <span style={styles.patchBullet} />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function prettifyPatchKey(key) {
  if (key === "general" || key === "generic") return "Общие изменения";
  if (key === "items") return "Предметы";
  if (key === "heroes") return "Герои";
  return key
    .replace(/^npc_dota_hero_/, "")
    .replace(/^item_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------- tab: pricing ---------- */

const FREE_FEATURES = [
  "Карточка героя: статы, роли, матчапы",
  "Таблица контрпиков с фильтрами",
  "Интерактивная паутина",
  "Топ по ролям и топ банов",
  "Драфт 5×5: перевес и рекомендация пика",
  "Справочник способностей и предметов",
  "Базовый профиль по Steam",
];

const PRO_FEATURES = [
  "AI-разбор всего драфта целиком, а не одного пика",
  "Углублённый профиль: тренды по позициям и периодам",
  "Синергия с конкретными союзниками",
  "История сохранённых драфтов",
  "Помесячные тренды и статистика по патчам",
  "Безлимитный пул героев",
];

function PricingTab() {
  const [premium, setPremium] = usePremium();
  return (
    <div style={styles.body}>
      <div style={styles.pricingHead}>
        <h2 style={styles.pricingTitle}>Тарифы</h2>
        <p style={styles.mutedText}>
          Всё, что работает на открытых данных, остаётся бесплатным. Платное — то, что стоит
          вычислительных ресурсов: AI-разборы и тяжёлые запросы к базе.
        </p>
      </div>

      <div style={styles.pricingGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <Check size={16} color="#5FCB8E" />
            <span style={{ ...styles.panelTitle, color: "#5FCB8E" }}>Бесплатно</span>
          </div>
          <div style={styles.pricingPrice}>0 ₽<span style={styles.pricingPer}> / навсегда</span></div>
          {FREE_FEATURES.map((f) => (
            <div key={f} style={styles.pricingRow}>
              <Check size={14} color="#5FCB8E" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{f}</span>
            </div>
          ))}
        </div>

        <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
          <div style={styles.panelHeader}>
            <Gem size={16} color="#E5B33D" />
            <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>Premium</span>
          </div>
          <div style={styles.pricingPrice}>
            скоро<span style={styles.pricingPer}> / в разработке</span>
          </div>
          {PRO_FEATURES.map((f) => (
            <div key={f} style={styles.pricingRow}>
              <Gem size={13} color="#E5B33D" style={{ flexShrink: 0, marginTop: 3 }} />
              <span>{f}</span>
            </div>
          ))}
          <button
            style={{ ...styles.premiumBtn, marginLeft: 0, marginTop: 14 }}
            onClick={() => setPremium(!premium)}
          >
            {premium ? <><Check size={11} /> Демо включено — выключить</> : <><Gem size={11} /> Включить демо-режим</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- tab: compare two heroes ---------- */

function CompareTab({ heroes }) {
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);

  useEffect(() => {
    if (heroes.length && leftId == null) {
      setLeftId(heroes[0].id);
      setRightId(heroes[1] ? heroes[1].id : heroes[0].id);
    }
  }, [heroes, leftId]);

  const left = heroes.find((h) => h.id === leftId) || null;
  const right = heroes.find((h) => h.id === rightId) || null;

  const [premium] = usePremium();
  const { data: leftMatchups, loading: leftLoading } = useMatchups(leftId);
  const { data: rightMatchups } = useMatchups(rightId);

  const headToHead = useMemo(() => {
    if (!leftMatchups || !rightId) return null;
    const m = leftMatchups.find((x) => x.hero_id === rightId);
    if (!m || !m.games_played) return null;
    return { winRate: m.wins / m.games_played, games: m.games_played };
  }, [leftMatchups, rightId]);

  function publicWr(h) {
    const s = bracketStats(h, BRACKETS[0]);
    return s.picks ? (s.wins / s.picks) * 100 : null;
  }
  function publicPicks(h) {
    return h ? bracketStats(h, BRACKETS[0]).picks || null : null;
  }

  const rows = [
    { label: "Винрейт (все ранги)", l: publicWr(left), r: publicWr(right), fmt: (v) => (v == null ? "—" : `${v.toFixed(1)}%`), higher: true },
    { label: "Матчей", l: publicPicks(left), r: publicPicks(right), fmt: (v) => (v == null ? "—" : v.toLocaleString("ru-RU")), higher: true },
    { label: "Баны в про", l: left?.pro_ban ?? null, r: right?.pro_ban ?? null, fmt: (v) => (v == null ? "—" : v), higher: true },
    { label: "Базовое здоровье", l: left?.base_health ?? null, r: right?.base_health ?? null, fmt: (v) => v ?? "—", higher: true },
    { label: "Базовая броня", l: left?.base_armor ?? null, r: right?.base_armor ?? null, fmt: (v) => v ?? "—", higher: true },
    { label: "Скорость передвижения", l: left?.move_speed ?? null, r: right?.move_speed ?? null, fmt: (v) => v ?? "—", higher: true },
    { label: "Дальность атаки", l: left?.attack_range ?? null, r: right?.attack_range ?? null, fmt: (v) => v ?? "—", higher: true },
  ];

  if (!left || !right) return null;

  return (
    <div style={styles.body}>
      <div style={styles.compareHeadRow}>
        <ComparePicker heroes={heroes} selectedId={leftId} onSelect={setLeftId} align="left" />
        <div style={styles.compareVs}>VS</div>
        <ComparePicker heroes={heroes} selectedId={rightId} onSelect={setRightId} align="right" />
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <Swords size={16} color="#C084FC" />
          <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Прямой матчап</span>
        </div>
        {leftLoading && <SkeletonRows count={1} />}
        {!leftLoading && !headToHead && (
          <div style={styles.emptyState}>Нет данных по этой конкретной паре героев.</div>
        )}
        {!leftLoading && headToHead && (
          <div style={styles.h2hRow}>
            <span style={{ ...styles.h2hSide, color: headToHead.winRate >= 0.5 ? "#5FCB8E" : "#9C8FB0" }}>
              {(headToHead.winRate * 100).toFixed(1)}%
            </span>
            <div style={styles.h2hBarTrack}>
              <div style={{ ...styles.h2hBarFill, width: `${headToHead.winRate * 100}%` }} />
            </div>
            <span style={{ ...styles.h2hSide, color: headToHead.winRate < 0.5 ? "#5FCB8E" : "#9C8FB0" }}>
              {((1 - headToHead.winRate) * 100).toFixed(1)}%
            </span>
          </div>
        )}
        {headToHead && (
          <div style={{ ...styles.mutedText, fontSize: 11, textAlign: "center", marginTop: 6 }}>
            По {headToHead.games} проф. матчам, где герои встречались
          </div>
        )}
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <BarChart3 size={16} color="#C084FC" />
          <span style={{ ...styles.panelTitle, color: "#C084FC" }}>Характеристики</span>
        </div>
        {rows.map((row) => {
          const lWins = row.l != null && row.r != null && row.l !== row.r && (row.higher ? row.l > row.r : row.l < row.r);
          const rWins = row.l != null && row.r != null && row.l !== row.r && !lWins;
          return (
            <div key={row.label} style={styles.compareRow}>
              <span style={{ ...styles.compareVal, color: lWins ? "#5FCB8E" : "#F2EAFB", fontWeight: lWins ? 700 : 500 }}>
                {row.fmt(row.l)}
              </span>
              <span style={styles.compareLabel}>{row.label}</span>
              <span style={{ ...styles.compareVal, textAlign: "right", color: rWins ? "#5FCB8E" : "#F2EAFB", fontWeight: rWins ? 700 : 500 }}>
                {row.fmt(row.r)}
              </span>
            </div>
          );
        })}
      </div>

      {premium ? (
        <DeepComparePanels
          left={left}
          right={right}
          leftMatchups={leftMatchups}
          rightMatchups={rightMatchups}
          heroes={heroes}
        />
      ) : (
        <PremiumLock
          title="Глубокое сравнение"
          text="Винрейт обоих героев по каждому рангу, общие уязвимости и общие жертвы — кого они оба обыгрывают и кому оба проигрывают. Входит в Premium — включить демо можно на вкладке «Тарифы»."
        />
      )}
    </div>
  );
}

function DeepComparePanels({ left, right, leftMatchups, rightMatchups, heroes }) {
  const heroById = (id) => heroes.find((h) => h.id === id);

  const rankData = useMemo(() => {
    return BRACKETS.filter((b) => b.key !== "all" && b.key !== "pro").map((b) => {
      const ls = bracketStats(left, b);
      const rs = bracketStats(right, b);
      return {
        rank: b.label,
        [left.localized_name]: ls.picks ? Math.round((ls.wins / ls.picks) * 1000) / 10 : 0,
        [right.localized_name]: rs.picks ? Math.round((rs.wins / rs.picks) * 1000) / 10 : 0,
      };
    });
  }, [left, right]);

  const { shared, victims } = useMemo(() => {
    if (!leftMatchups || !rightMatchups) return { shared: [], victims: [] };
    const rMap = new Map(rightMatchups.filter((m) => m.games_played >= 10).map((m) => [m.hero_id, m]));
    const bad = [];
    const good = [];
    leftMatchups
      .filter((m) => m.games_played >= 10)
      .forEach((lm) => {
        const rm = rMap.get(lm.hero_id);
        if (!rm) return;
        const lw = lm.wins / lm.games_played;
        const rw = rm.wins / rm.games_played;
        const enemy = heroById(lm.hero_id);
        if (!enemy || enemy.id === left.id || enemy.id === right.id) return;
        if (lw < 0.47 && rw < 0.47) bad.push({ enemy, lw, rw, avg: (lw + rw) / 2 });
        if (lw > 0.53 && rw > 0.53) good.push({ enemy, lw, rw, avg: (lw + rw) / 2 });
      });
    bad.sort((a, b) => a.avg - b.avg);
    good.sort((a, b) => b.avg - a.avg);
    return { shared: bad.slice(0, 8), victims: good.slice(0, 8) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftMatchups, rightMatchups, left, right, heroes]);

  return (
    <>
      <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
        <div style={styles.panelHeader}>
          <Gem size={16} color="#E5B33D" />
          <span style={{ ...styles.panelTitle, color: "#E5B33D" }}>Винрейт по рангам</span>
        </div>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={rankData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A1A40" vertical={false} />
              <XAxis dataKey="rank" tick={{ fill: "#9C8FB0", fontSize: 10 }} axisLine={{ stroke: "#2A1A40" }} tickLine={false} />
              <YAxis domain={[0, 70]} tick={{ fill: "#9C8FB0", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip
                contentStyle={{ background: "#150C24", border: "1px solid #2F1F49", borderRadius: 10, fontSize: 12, padding: "8px 12px" }}
                    itemStyle={{ color: "#F2EAFB" }}
                    cursor={{ fill: "rgba(178,75,243,0.10)" }}
                labelStyle={{ color: "#F2EAFB" }}
              />
              <Bar dataKey={left.localized_name} fill="#B24BF3" radius={[3, 3, 0, 0]} />
              <Bar dataKey={right.localized_name} fill="#E5B33D" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={styles.compareLegend}>
          <span style={styles.legendItem}><span style={{ ...styles.legendLine, background: "#B24BF3" }} /> {left.localized_name}</span>
          <span style={styles.legendItem}><span style={{ ...styles.legendLine, background: "#E5B33D" }} /> {right.localized_name}</span>
        </div>
      </div>

      <div className="two-col" style={styles.twoCol}>
        <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
          <div style={styles.panelHeader}>
            <TrendingDown size={16} color="#E2574C" />
            <span style={{ ...styles.panelTitle, color: "#E2574C" }}>Общие проблемы</span>
          </div>
          {shared.length === 0 && <div style={styles.emptyState}>Общих сложных матчапов не нашлось.</div>}
          {shared.map((s) => (
            <div key={s.enemy.id} style={styles.roleRow}>
              <HeroIcon hero={s.enemy} style={styles.matchupIcon} />
              <span style={styles.matchupName}>{s.enemy.localized_name}</span>
              <span style={{ ...styles.matchupPct, color: "#E2574C" }}>
                {(s.lw * 100).toFixed(0)}% / {(s.rw * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>

        <div style={{ ...styles.panel, border: "1px solid #4A3D1E" }}>
          <div style={styles.panelHeader}>
            <TrendingUp size={16} color="#5FCB8E" />
            <span style={{ ...styles.panelTitle, color: "#5FCB8E" }}>Общие жертвы</span>
          </div>
          {victims.length === 0 && <div style={styles.emptyState}>Общих удобных матчапов не нашлось.</div>}
          {victims.map((s) => (
            <div key={s.enemy.id} style={styles.roleRow}>
              <HeroIcon hero={s.enemy} style={styles.matchupIcon} />
              <span style={styles.matchupName}>{s.enemy.localized_name}</span>
              <span style={{ ...styles.matchupPct, color: "#5FCB8E" }}>
                {(s.lw * 100).toFixed(0)}% / {(s.rw * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ComparePicker({ heroes, selectedId, onSelect, align }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hero = heroes.find((h) => h.id === selectedId);
  const attr = hero ? ATTR[hero.primary_attr] || ATTR.all : ATTR.all;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((h) => h.localized_name.toLowerCase().includes(q));
  }, [heroes, query]);

  if (!hero) return null;

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button
        style={{ ...styles.compareCard, borderColor: attr.color, alignItems: align === "right" ? "flex-end" : "flex-start" }}
        onClick={() => setOpen((v) => !v)}
      >
        <HeroIcon hero={hero} field="img" style={styles.comparePortrait} alt={hero.localized_name} />
        <span style={styles.compareName}>{hero.localized_name}</span>
        <span style={{ ...styles.tag, color: attr.color, borderColor: attr.color }}>{attr.label}</span>
      </button>

      {open && (
        <>
          <div style={styles.menuBackdrop} onClick={() => setOpen(false)} />
          <div style={{ ...styles.dropdown, left: align === "right" ? "auto" : 0, right: align === "right" ? 0 : "auto" }}>
            <div style={styles.dropdownSearch}>
              <Search size={14} color="#9C8FB0" />
              <input
                autoFocus
                style={styles.dropdownInput}
                placeholder="Найти героя…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div style={styles.dropdownList}>
              {filtered.map((h) => (
                <div
                  key={h.id}
                  style={styles.dropdownItem}
                  onClick={() => { onSelect(h.id); setOpen(false); setQuery(""); }}
                >
                  <HeroIcon hero={h} style={styles.dropdownIcon} />
                  <span style={{ fontSize: 13 }}>{h.localized_name}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* Единая шкала цвета текста — на все страницы:
   #F2EAFB  заголовки, значения, важные числа
   #C4B8D8  основной текст, описания
   #9C8FB0  подписи, второстепенное
   #C084FC  акцент (заголовки разделов, иконки)
   #5FCB8E / #E2574C  положительное / отрицательное
   #E5B33D  премиум
   Цвета атрибутов героев (ATTR) — отдельная смысловая шкала, к тексту не относится. */
const styles = {
  /* toast */
  toast: {
    position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 200,
    display: "flex", alignItems: "center", gap: 10, background: "#1B0F1A", border: "1px solid #5A2430",
    color: "#F2EAFB", borderRadius: 10, padding: "11px 14px", fontSize: 13,
    boxShadow: "0 12px 30px rgba(0,0,0,0.55)", maxWidth: "min(420px, calc(100vw - 32px))",
    animation: "toastIn 0.2s ease-out",
  },
  toastClose: { background: "transparent", border: "none", color: "#9C8FB0", cursor: "pointer", display: "flex", padding: 2 },

  /* tour */
  tourBackdrop: {
    position: "fixed", inset: 0, background: "rgba(5,3,10,0.78)", zIndex: 150,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
  },
  tourCard: {
    position: "relative", background: "#150C24", border: "1px solid #2F1F49", borderRadius: 16,
    padding: "28px 26px 22px", width: "min(420px, 92vw)", textAlign: "center",
    boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
  },
  tourClose: {
    position: "absolute", top: 12, right: 12, background: "transparent", border: "none",
    color: "#9C8FB0", cursor: "pointer", display: "flex", padding: 4,
  },
  tourIconBadge: {
    width: 52, height: 52, borderRadius: 14, margin: "0 auto 14px",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg, rgba(178,75,243,0.2), rgba(109,40,217,0.08))",
    border: "1px solid #3A2857",
  },
  tourTitle: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 8 },
  tourText: { fontSize: 13, color: "#C4B8D8", lineHeight: 1.55 },
  tourDots: { display: "flex", gap: 6, justifyContent: "center", margin: "18px 0 16px" },
  tourDot: { width: 7, height: 7, borderRadius: "50%" },
  tourBtnRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" },
  tourSkip: { background: "transparent", border: "none", color: "#9C8FB0", fontSize: 12, cursor: "pointer" },
  tourGo: {
    background: "transparent", border: "1px solid #3A2857", color: "#C4B8D8", fontSize: 12,
    padding: "9px 14px", borderRadius: 999, cursor: "pointer",
  },

  /* compare */
  compareHeadRow: { display: "flex", alignItems: "center", gap: 12 },
  compareLegend: { display: "flex", gap: 16, justifyContent: "center", fontSize: 11, color: "#9C8FB0", marginTop: 6, flexWrap: "wrap" },
  compareVs: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18, color: "#9C8FB0", flexShrink: 0,
  },
  compareCard: {
    width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 16,
    background: "#140B22", border: "1px solid", borderRadius: 14, cursor: "pointer", color: "#F2EAFB",
  },
  comparePortrait: { width: 64, height: 64, borderRadius: 10, objectFit: "cover" },
  compareName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 17 },
  compareRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #241636",
  },
  compareVal: { fontSize: 14, width: 90, flexShrink: 0, fontFamily: "'Rajdhani', sans-serif" },
  compareLabel: { flex: 1, textAlign: "center", fontSize: 12, color: "#9C8FB0" },
  h2hRow: { display: "flex", alignItems: "center", gap: 12 },
  h2hSide: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 17, width: 62, flexShrink: 0 },
  h2hBarTrack: { flex: 1, height: 8, borderRadius: 4, background: "#E2574C", overflow: "hidden" },
  h2hBarFill: { height: "100%", background: "#5FCB8E" },

  /* reference */
  abilityRow: {
    display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid #241636", alignItems: "flex-start",
  },
  abilityIcon: { width: 42, height: 42, borderRadius: 8, flexShrink: 0, background: "#0E081A" },
  itemIconLg: { width: 48, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0, background: "#0E081A" },
  abilityName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 },
  abilityDesc: { fontSize: 12, color: "#9C8FB0", lineHeight: 1.5 },
  abilityMeta: { fontSize: 11, color: "#9C8FB0", marginTop: 4 },
  itemCost: { fontSize: 11, color: "#E5B33D", fontWeight: 600, marginLeft: 6 },

  /* patches */
  patchBlock: { borderBottom: "1px solid #241636" },
  patchRowBtn: {
    display: "flex", alignItems: "center", gap: 10, padding: "11px 0", width: "100%",
    background: "transparent", border: "none", color: "#F2EAFB", cursor: "pointer", textAlign: "left",
  },
  patchBody: { padding: "2px 0 14px 18px" },
  patchSection: { marginBottom: 12 },
  patchSectionTitle: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 13, color: "#C084FC",
    marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em",
  },
  patchLine: { display: "flex", gap: 8, fontSize: 12, color: "#C4B8D8", lineHeight: 1.5, padding: "2px 0" },
  patchBullet: {
    width: 4, height: 4, borderRadius: "50%", background: "#6E5F86", flexShrink: 0, marginTop: 7,
  },
  langDivider: { width: 1, background: "#2F1F49", margin: "2px 4px" },
  localeStatus: {
    background: "#0E081A", border: "1px solid #2C1C42", borderRadius: 10, padding: 12,
    fontSize: 12, color: "#9C8FB0",
  },
  localeError: {
    background: "#1F1518", border: "1px solid #5A2430", borderRadius: 10, padding: 12,
    fontSize: 12, color: "#F2EAFB",
  },
  localeTried: { marginTop: 6, fontSize: 10, color: "#C4B8D8", wordBreak: "break-all", lineHeight: 1.5 },
  origName: { fontSize: 11, color: "#9C8FB0", marginBottom: 4 },

  /* premium */
  premiumLockCard: {
    background: "linear-gradient(160deg, #1A1508, #120D06)", border: "1px dashed #4A3D1E",
    borderRadius: 14, padding: 18,
  },
  premiumLockHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  savedDraftRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #241636" },
  savedDraftIcons: { display: "flex", alignItems: "center", gap: 3, flex: 1, flexWrap: "wrap", minWidth: 0 },
  savedDraftIcon: { width: 20, height: 20, borderRadius: 4 },
  savedVs: { fontSize: 10, color: "#9C8FB0", margin: "0 4px" },

  /* patches (legacy row, kept for spacing) */
  patchRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #241636" },
  patchDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  patchName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 14 },
  patchCurrent: {
    fontSize: 9, color: "#C084FC", border: "1px solid #B24BF3", borderRadius: 999,
    padding: "1px 7px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
  },
  patchDate: { marginLeft: "auto", fontSize: 12, color: "#9C8FB0" },

  /* pricing */
  pricingHead: { textAlign: "center", maxWidth: 560, margin: "0 auto" },
  pricingTitle: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 30, margin: "0 0 8px" },
  pricingGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 },
  pricingPrice: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 28, marginBottom: 14 },
  pricingPer: { fontSize: 12, color: "#9C8FB0", fontWeight: 500 },
  pricingRow: { display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, padding: "6px 0", lineHeight: 1.45 },

  page: {
    minHeight: "100vh",
    width: "100%",
    maxWidth: "100vw",
    overflowX: "hidden",
    backgroundColor: "#07050D",
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='30' height='52'%3E%3Cpath d='M15 1 L29 9 V35 L15 43 L1 35 V9 Z' fill='none' stroke='rgba(178,75,243,0.045)' stroke-width='1'/%3E%3C/svg%3E\"), " +
      "radial-gradient(circle at 15% 0%, rgba(109,40,217,0.14), transparent 45%), " +
      "radial-gradient(circle at 85% 20%, rgba(178,75,243,0.10), transparent 40%)",
    backgroundSize: "30px 52px, auto, auto",
    backgroundRepeat: "repeat, no-repeat, no-repeat",
    color: "#F2EAFB",
    fontFamily: "'Inter', sans-serif",
    padding: "20px",
  },
  header: {
    position: "sticky", top: 0, zIndex: 60,
    display: "flex", justifyContent: "space-between", alignItems: "center",
    flexWrap: "nowrap", gap: 16, height: 64, marginBottom: 20,
    background: "rgba(7,5,13,0.82)", backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    borderBottom: "1px solid #1D1230",
    maxWidth: "100%", minWidth: 0,
  },
  brandRow: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 },
  brandWordmark: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 24, letterSpacing: "0.08em",
    background: "linear-gradient(135deg, #E9D5FF, #B24BF3 55%, #6D28D9)",
    WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
    textShadow: "0 0 24px rgba(178,75,243,0.35)",
  },
  brandSub: { fontSize: 12, color: "#9C8FB0", fontFamily: "'Inter', sans-serif" },

  menuTrigger: {
    display: "flex", alignItems: "center", gap: 8, background: "#0E081A", border: "1px solid #2C1C42",
    borderRadius: 10, padding: "9px 14px", color: "#F2EAFB", fontSize: 13, cursor: "pointer",
    boxShadow: "0 0 14px rgba(178,75,243,0.12)",
  },
  menuBackdrop: { position: "fixed", inset: 0, zIndex: 40 },
  menuDropdown: {
    position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50, minWidth: 220, maxWidth: "calc(100vw - 32px)",
    background: "#150C24", border: "1px solid #2F1F49", borderRadius: 12, padding: 6,
    boxShadow: "0 20px 50px rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", gap: 2,
  },
  menuItem: {
    display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none",
    color: "#9C8FB0", fontSize: 13, padding: "10px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left",
  },
  menuItemActive: { background: "#2C1C42", color: "#F2EAFB" },

  centerMsg: { display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "#9C8FB0" },
  errorBox: { background: "#1F1518", border: "1px solid #E2574C", color: "#F2EAFB", borderRadius: 8, padding: 16 },

  homeWrap: { maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 },
  homeHero: {
    position: "relative", padding: "40px 20px",
    display: "flex", alignItems: "center", gap: 40,
  },
  homeGlow: {
    position: "absolute", top: "10%", left: "18%", width: 360, height: 360, transform: "translateX(-50%)",
    background: "radial-gradient(circle, rgba(178,75,243,0.35), transparent 70%)",
    filter: "blur(10px)", zIndex: 0, animation: "pulseGlow 4s ease-in-out infinite",
  },
  homePortraitWrap: {
    position: "relative", zIndex: 1, flexShrink: 0,
    animation: "floatHero 6s ease-in-out infinite", pointerEvents: "none",
  },
  hexVisual: {
    width: "clamp(220px, 26vw, 320px)", height: "auto",
    filter: "drop-shadow(0 0 25px rgba(178,75,243,0.35))",
  },
  homePortrait: {
    width: 260, height: "auto", maxHeight: 380, objectFit: "contain",
    filter: "drop-shadow(0 0 45px rgba(178,75,243,0.5))",
  },
  homeTextCol: { position: "relative", zIndex: 1, flex: 1, minWidth: 0 },
  homeTitle: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
    fontSize: "clamp(38px, 6.5vw, 64px)", letterSpacing: "0.06em", margin: 0, lineHeight: 1.1,
    background: "linear-gradient(135deg, #F2EAFB, #C084FC 50%, #6D28D9)",
    WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
    textShadow: "0 0 40px rgba(178,75,243,0.4)",
  },
  homeTagline: { maxWidth: 480, fontSize: 15, color: "#C4B8D8", lineHeight: 1.6, marginTop: 14 },
  homeCta: {
    display: "flex", alignItems: "center", gap: 8, marginTop: 20,
    background: "linear-gradient(135deg, #C084FC, #6D28D9)", border: "none", color: "#fff",
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15, padding: "12px 26px",
    borderRadius: 999, cursor: "pointer", boxShadow: "0 0 24px rgba(178,75,243,0.5)",
  },
  homeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  homeSearchWrap: {
    display: "flex", alignItems: "center", gap: 10, marginTop: 18, background: "#140B22",
    border: "1px solid #2F1F49", borderRadius: 999, padding: "12px 18px", maxWidth: 420,
  },
  homeSearchInput: {
    background: "transparent", border: "none", outline: "none", color: "#F2EAFB",
    fontSize: 14, width: "100%", fontFamily: "'Inter', sans-serif",
  },
  homeSearchResults: {
    marginTop: 8, background: "#150C24", border: "1px solid #2F1F49", borderRadius: 12,
    padding: 6, maxWidth: 420,
  },
  patchChip: {
    display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 12,
    color: "#C4B8D8", background: "#0E081A", border: "1px solid #2C1C42", borderRadius: 999,
    padding: "6px 12px",
  },
  homeActions: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  homeSecondary: {
    background: "transparent", border: "1px solid #3A2857", color: "#C4B8D8",
    fontSize: 13, padding: "11px 18px", borderRadius: 999, cursor: "pointer",
  },
  homeCard: {
    position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, textAlign: "left",
    background: "linear-gradient(160deg, #170D28, #120A1E)", border: "1px solid #2F1F49", borderRadius: 14, padding: 20,
    cursor: "pointer", overflow: "hidden",
    boxShadow: "0 0 30px rgba(109,40,217,0.1)",
  },
  homeCardIconBadge: {
    display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 10,
    background: "linear-gradient(135deg, rgba(178,75,243,0.18), rgba(109,40,217,0.08))",
    border: "1px solid #3A2857",
  },
  homeCardTitle: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 16, color: "#F2EAFB" },
  homeCardDesc: { fontSize: 12, color: "#9C8FB0", lineHeight: 1.4 },

  layout: { display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 20, alignItems: "start" },
  sidebar: { background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 10, padding: 8, display: "flex", flexDirection: "column", gap: 8 },
  chipList: { display: "flex", flexDirection: "column", gap: 4, maxHeight: "calc(100vh - 220px)", overflowY: "auto" },
  heroChip: {
    display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, border: "1px solid #2F1F49",
    cursor: "pointer", textAlign: "left", color: "#F2EAFB",
  },
  heroChipIcon: { width: 24, height: 24, borderRadius: 4, flexShrink: 0 },
  heroChipName: { fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  attrBadge: {
    width: 18, height: 18, borderRadius: 5, border: "1px solid", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 11, lineHeight: 1,
  },
  detail: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 },
  card: { background: "#140B22", border: "1px solid #2F1F49", borderRadius: 16, padding: 22, boxShadow: "0 0 40px rgba(109,40,217,0.12)", minWidth: 0, overflow: "hidden" },
  cardTop: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" },
  portrait: { width: 76, height: 76, borderRadius: 10, objectFit: "cover", flexShrink: 0 },
  heroName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "0.01em" },
  tagRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 },
  tag: { fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid", fontWeight: 600 },
  tagMuted: { fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid #3A2857", color: "#9C8FB0" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginTop: 20 },
  statBox: {
    background: "linear-gradient(160deg, #14101F, #0F1319)", border: "1px solid #2C1C42", borderRadius: 10,
    padding: "12px 14px", transition: "border-color 0.15s ease",
  },
  statValue: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18 },
  statLabel: { fontSize: 11, color: "#9C8FB0", marginTop: 2 },
  gaugeLabel: {
    position: "absolute", top: 0, left: 0, width: 76, height: 76, display: "flex", alignItems: "center",
    justifyContent: "center", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15,
  },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, minWidth: 0 },
  panel: { background: "#140B22", border: "1px solid #2F1F49", borderRadius: 14, padding: 18, boxShadow: "0 0 30px rgba(109,40,217,0.10)", minWidth: 0, overflow: "hidden" },
  panelHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #1D1230" },
  panelTitle: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: "0.04em" },
  mutedText: { fontSize: 12, color: "#9C8FB0" },
  matchupRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" },
  matchupIcon: { width: 22, height: 22, borderRadius: 4 },
  itemCatGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginTop: 4 },
  itemCatCol: { display: "flex", flexDirection: "column", gap: 6 },
  itemCatLabel: { fontSize: 11, color: "#9C8FB0", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 },
  itemRow: { display: "flex", alignItems: "center", gap: 8 },
  itemIcon: { width: 28, height: 21, borderRadius: 4, objectFit: "cover", flexShrink: 0, background: "#0E081A" },
  itemName: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  matchupName: { fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  matchupPct: { fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'Rajdhani', sans-serif" },
  body: { maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20, minWidth: 0, width: "100%" },
  heroSelectWrap: { position: "relative", display: "flex", alignItems: "center", gap: 10 },
  heroSelectLabel: { fontSize: 13, color: "#9C8FB0" },
  heroSelectBtn: {
    display: "flex", alignItems: "center", gap: 8, background: "#140B22", border: "1px solid", borderRadius: 8,
    padding: "6px 10px", cursor: "pointer", color: "#F2EAFB",
  },
  heroSelectIcon: { width: 24, height: 24, borderRadius: 4 },
  heroSelectName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, fontSize: 15 },
  dropdown: {
    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 45, width: "min(280px, 90vw)", background: "#150C24",
    border: "1px solid #2F1F49", borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.5)", overflow: "hidden",
  },
  dropdownSearch: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #2F1F49" },
  dropdownInput: { background: "transparent", border: "none", outline: "none", color: "#F2EAFB", fontSize: 13, width: "100%" },
  dropdownList: { maxHeight: 260, overflowY: "auto" },
  dropdownItem: { display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer" },
  dropdownIcon: { width: 22, height: 22, borderRadius: 4 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  sourceBar: {
    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    fontSize: 12, color: "#9C8FB0", background: "#0E081A",
    border: "1px solid #2C1C42", borderRadius: 8, padding: "8px 12px",
  },
  sourceDot: { width: 7, height: 7, borderRadius: "50%", background: "#5FCB8E", flexShrink: 0 },
  sourceStale: {
    fontSize: 10, color: "#E5B33D", border: "1px solid #4A3D1E", borderRadius: 999, padding: "1px 7px",
  },
  sourceTime: { fontSize: 11, color: "#9C8FB0" },
  sourceRefresh: {
    marginLeft: "auto", background: "transparent", border: "1px solid #3A2857",
    color: "#C4B8D8", fontSize: 11, padding: "4px 10px", borderRadius: 999, cursor: "pointer",
  },
  segment: {
    display: "flex", gap: 6, background: "#0E081A", border: "1px solid #2C1C42", borderRadius: 8, padding: 4,
    overflowX: "auto", WebkitOverflowScrolling: "touch", maxWidth: "100%", minWidth: 0,
    scrollbarWidth: "none",
  },
  segmentBtn: {
    background: "transparent", border: "none", color: "#9C8FB0", fontSize: 12, padding: "6px 10px", borderRadius: 6,
    cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
  },
  segmentBtnActive: { background: "#2C1C42", color: "#F2EAFB" },
  controls: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "#140B22", border: "1px solid #2F1F49", borderRadius: 8, padding: "6px 10px" },
  searchInput: { background: "transparent", border: "none", outline: "none", color: "#F2EAFB", fontSize: 13, width: 150 },
  gamesLabel: { fontSize: 12, color: "#9C8FB0", display: "flex", alignItems: "center", gap: 8 },
  slider: { accentColor: "#B24BF3" },
  tableWrap: { background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 10, overflowX: "auto", overflowY: "hidden" },
  tableInner: { minWidth: 480 },
  tableHeader: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #2C1C42",
    fontSize: 11, color: "#9C8FB0", textTransform: "uppercase", letterSpacing: "0.04em",
  },
  colGames: { width: 60, textAlign: "right" },
  colWinrate: { width: 130, textAlign: "right" },
  colScoreHeader: {
    width: 150, textAlign: "right", background: "transparent", border: "none", color: "#9C8FB0", fontSize: 11,
    textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "flex-end", gap: 4,
  },
  colType: { width: 100, textAlign: "right" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid #241636" },
  enemyCell: { flex: "1 1 140px", display: "flex", alignItems: "center", gap: 10, minWidth: 100 },
  enemyIcon: { width: 24, height: 24, borderRadius: 4, flexShrink: 0 },
  enemyName: { fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  colScore: { width: 150, display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" },
  scoreBarTrack: { width: 80, height: 5, borderRadius: 3, background: "#2C1C42", overflow: "hidden" },
  scoreBarFill: { height: "100%", borderRadius: 3 },
  scoreNum: { fontSize: 12, fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, width: 24, textAlign: "right" },
  emptyState: {
    padding: "26px 14px", textAlign: "center", color: "#9C8FB0", fontSize: 13,
    border: "1px dashed #2A1A40", borderRadius: 10, margin: "4px 0",
  },
  methodNote: { display: "flex", gap: 8, fontSize: 12, color: "#9C8FB0", background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 8, padding: 12 },
  patchBadge: { display: "flex", alignItems: "center", gap: 8, fontSize: 12 },
  profileForm: { display: "flex", gap: 10, flexWrap: "wrap" },
  profileInput: {
    flex: 1, minWidth: 220, background: "#140B22", border: "1px solid #2F1F49", borderRadius: 8,
    padding: "10px 14px", color: "#F2EAFB", fontSize: 13, outline: "none",
  },
  steamLoginBtn: {
    display: "flex", alignItems: "center", gap: 8, background: "#140B22", border: "1px solid #3A2857",
    color: "#F2EAFB", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 14, padding: "11px 20px",
    borderRadius: 999, textDecoration: "none", cursor: "pointer",
  },
  profileHeader: { display: "flex", alignItems: "center", gap: 14 },
  profileAvatar: { width: 56, height: 56, borderRadius: 12, border: "2px solid #B24BF3" },
  donutCenter: {
    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", pointerEvents: "none",
  },
  donutValue: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 30, letterSpacing: "0.01em",
    lineHeight: 1.1,
  },
  donutSub: { fontSize: 11, color: "#9C8FB0", marginTop: 2 },
  mixDot: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  streakRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 },
  streakChip: {
    fontSize: 11, padding: "5px 11px", borderRadius: 999, border: "1px solid", fontWeight: 600,
  },
  profileName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18 },
  roleGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  banGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 4, columnGap: 24 },
  roleRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", margin: "0 -8px", cursor: "pointer" },
  suggestionItem: { padding: "6px 0", borderBottom: "1px solid #241636", cursor: "pointer" },
  suggestionMeta: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4, marginLeft: 30 },
  suggestionReason: { fontSize: 11, color: "#9C8FB0" },
  trustBadge: {
    fontSize: 10, padding: "2px 7px", borderRadius: 999, border: "1px solid", fontWeight: 600, marginLeft: "auto",
  },
  premiumBtn: {
    display: "flex", alignItems: "center", gap: 5, marginLeft: 30, marginTop: 6, background: "transparent",
    border: "1px solid #4A3D1E", color: "#C4B8D8", fontSize: 11, padding: "4px 9px", borderRadius: 999, cursor: "pointer",
  },
  premiumTag: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.05em",
    color: "#E5B33D", marginLeft: 2,
  },
  premiumTeaser: {
    display: "flex", alignItems: "center", gap: 6, marginLeft: 30, marginTop: 6, fontSize: 11, color: "#C4B8D8",
    background: "#1A1508", border: "1px solid #4A3D1E", borderRadius: 8, padding: "6px 10px", lineHeight: 1.4,
  },
  roleRank: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 13, color: "#9C8FB0", width: 14 },
  rolePct: { fontSize: 13, fontWeight: 700, color: "#C084FC", marginLeft: "auto", whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'Rajdhani', sans-serif" },
  draftToolbar: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  poolToggle: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#9C8FB0", cursor: "pointer" },
  draftGrid: { display: "grid", gridTemplateColumns: "1fr 160px 1fr", gap: 16, alignItems: "start" },
  vsCol: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", paddingTop: 30 },
  vsGauge: {
    background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 12, padding: "20px 14px",
    textAlign: "center", boxShadow: "0 0 30px rgba(109,40,217,0.12)", width: "100%",
  },
  vsPct: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 34, lineHeight: 1.1 },
  vsWinner: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 14, marginTop: 2 },
  forecastRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #241636" },
  forecastLabel: { fontSize: 12, color: "#C4B8D8", width: 96, flexShrink: 0 },
  forecastBarTrack: { flex: 1, height: 8, borderRadius: 4, background: "#E2574C", overflow: "hidden", minWidth: 60 },
  forecastBarFill: { height: "100%", background: "#5FCB8E" },
  forecastValue: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 13, width: 96,
    textAlign: "right", flexShrink: 0, whiteSpace: "nowrap",
  },
  reasonRow: { display: "flex", gap: 8, fontSize: 13, color: "#C4B8D8", lineHeight: 1.5, padding: "5px 0" },
  slotRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", minHeight: 32 },
  slotPos: { fontSize: 10, color: "#9C8FB0", width: 62, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.03em" },
  planLine: { padding: "10px 0", borderBottom: "1px solid #241636" },
  planLineHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 },
  planLineLabel: { fontSize: 11, color: "#9C8FB0", textTransform: "uppercase", letterSpacing: "0.03em" },
  planLineRow: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  planLineNote: { fontSize: 11, color: "#9C8FB0", marginTop: 4, marginLeft: 30 },
  slotEmpty: {
    display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px dashed #3A2857",
    color: "#9C8FB0", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", width: "100%",
  },
  slotClear: { marginLeft: "auto", background: "transparent", border: "none", color: "#9C8FB0", cursor: "pointer", display: "flex" },
  pickerOverlay: {
    position: "fixed", inset: 0, background: "rgba(5,3,10,0.7)", display: "flex",
    alignItems: "flex-start", justifyContent: "center", zIndex: 50, padding: "5vh 16px 16px",
  },
  pickerModal: {
    background: "#150C24", border: "1px solid #2F1F49", borderRadius: 14, width: "min(360px, 92vw)",
    // фиксированная высота: список виден сразу, не нужно листать после открытия клавиатуры
    height: "min(560px, 78vh)",
    display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  },
  pickerHeader: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid #2F1F49" },
  pickerClose: { marginLeft: "auto", background: "transparent", border: "none", color: "#9C8FB0", cursor: "pointer", display: "flex" },
  pickerList: { overflowY: "auto", padding: 6, flex: 1, WebkitOverflowScrolling: "touch" },
  pickerItem: { display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 6 },
  pickerItemMain: { display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer", padding: "5px 0" },
  starBtn: { background: "transparent", border: "none", cursor: "pointer", display: "flex", padding: 6 },
  scopeRow: { display: "flex", gap: 6, background: "#0E081A", border: "1px solid #2C1C42", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: 14 },
  scopeBtn: { background: "transparent", border: "none", color: "#9C8FB0", fontSize: 12, padding: "6px 10px", borderRadius: 6, cursor: "pointer" },
  scopeBtnActive: { background: "#2C1C42", color: "#F2EAFB" },
  progressBox: {
    display: "flex", alignItems: "center", gap: 10, background: "#0E081A", border: "1px solid #2C1C42", borderRadius: 8,
    padding: "12px 16px", fontSize: 13, flexWrap: "wrap", maxWidth: 980,
  },
  progressTrack: { flex: 1, minWidth: 120, height: 6, background: "#2C1C42", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: "#B24BF3", transition: "width 0.2s ease" },
  webLayout: { display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 },
  graphPanel: { background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  zoomControls: { display: "flex", gap: 6, justifyContent: "flex-end", flexShrink: 0 },
  graphToolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  graphSearchWrap: {
    display: "flex", alignItems: "center", gap: 8, background: "#150C24", border: "1px solid #2F1F49",
    borderRadius: 8, padding: "6px 10px", minWidth: 180, flex: 1, maxWidth: 260,
  },
  zoomBtn: { background: "#140B22", border: "1px solid #2F1F49", color: "#F2EAFB", borderRadius: 6, padding: 6, cursor: "pointer", display: "flex" },
  svgScroll: { overflow: "hidden", position: "relative", height: "65vh", maxWidth: "100%", background: "#0A0614", borderRadius: 8 },
  legend: { display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "#9C8FB0", justifyContent: "center" },
  legendItem: { display: "flex", alignItems: "center", gap: 6 },
  legendLine: { width: 16, height: 3, borderRadius: 2, display: "inline-block" },
  sidePanel: { background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 12, padding: 16, height: "fit-content" },
  hintBox: { display: "flex", gap: 8, fontSize: 13, color: "#9C8FB0", alignItems: "flex-start" },
  sideHeroRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 },
  sideHeroIcon: { width: 36, height: 36, borderRadius: 6 },
  sideHeroName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18 },
  sideSection: { marginBottom: 16 },
  sideSectionTitle: { fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.03em" },
  sideRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", margin: "0 -8px" },
  sideRowIcon: { width: 22, height: 22, borderRadius: 4 },
  sideRowName: { fontSize: 13, flex: 1 },
  sideRowScore: { fontSize: 12, fontWeight: 700, fontFamily: "'Rajdhani', sans-serif" },
  footer: { marginTop: 24, fontSize: 11, color: "#9C8FB0", textAlign: "center" },
};
