import { useState, useEffect, useMemo } from "react";
import {
  Search, Swords, TrendingUp, TrendingDown, Loader2, Info,
  ChevronDown, ArrowUpDown, ZoomIn, ZoomOut, RotateCcw,
  IdCard, Network, Table2, Crown, Star, X, Plus, Users, Sparkles,
  Home, Menu, ArrowRight,
} from "lucide-react";

/* ---------- shared design tokens ---------- */

const ATTR = {
  str: { label: "Сила", color: "#E2574C" },
  agi: { label: "Ловкость", color: "#5FCB8E" },
  int: { label: "Интеллект", color: "#5B9FE0" },
  all: { label: "Универсал", color: "#B24BF3" },
};

const ROLE_RU = {
  Carry: "Керри", Support: "Саппорт", Nuker: "Нюкер", Disabler: "Дизейблер",
  Jungler: "Джанглер", Durable: "Танк", Escape: "Побег", Pusher: "Пушер",
  Initiator: "Инициатор",
};

function img(path) {
  return `https://cdn.cloudflare.steamstatic.com${path}`;
}

function HeroIcon({ hero, field = "icon", style, alt }) {
  const [failed, setFailed] = useState(false);
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

function readLocalCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
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

async function getMatchups(heroId) {
  if (matchupsCache.has(heroId)) return matchupsCache.get(heroId);
  const cacheKey = `dw_matchups_${heroId}`;
  const cached = readLocalCache(cacheKey);
  if (cached) {
    matchupsCache.set(heroId, cached);
    return cached;
  }
  const r = await fetch(`https://api.opendota.com/api/heroes/${heroId}/matchups`);
  if (!r.ok) throw new Error("network");
  const data = await r.json();
  matchupsCache.set(heroId, data);
  writeLocalCache(cacheKey, data);
  return data;
}

function useMatchups(heroId) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  useEffect(() => {
    if (!heroId) return;
    if (matchupsCache.has(heroId)) {
      setState({ loading: false, data: matchupsCache.get(heroId), error: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    getMatchups(heroId)
      .then((data) => {
        if (!cancelled) setState({ loading: false, data, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, data: null, error: "Не удалось загрузить матчапы." });
      });
    return () => {
      cancelled = true;
    };
  }, [heroId]);
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
];

export default function App() {
  const [heroes, setHeroes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("home");
  const [selectedId, setSelectedId] = useState(null);

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
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body { overflow-x: hidden; max-width: 100%; margin: 0; padding: 0; }
        body { display: block !important; place-items: initial !important; min-width: 0 !important; }
        #root { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 0 !important; text-align: left !important; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #3A2857; border-radius: 4px; }
        button { font-family: 'Inter', sans-serif; }
        input:focus-visible, button:focus-visible { outline: 2px solid #B24BF3; outline-offset: 2px; }
        .row:hover { background: #171C24 !important; }
        .hero-chip:hover { border-color: #3A404C !important; }
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
        @keyframes floatHero {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); }
          50% { opacity: 1; transform: translateX(-50%) scale(1.1); }
        }
        .home-card:hover { transform: translateY(-3px); box-shadow: 0 0 40px rgba(178,75,243,0.25) !important; }
        @media (max-width: 860px) {
          .layout-cols { grid-template-columns: 1fr !important; }
          .toolbar { flex-direction: column !important; align-items: stretch !important; }
          .draft-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <header style={styles.header}>
        <div style={styles.brandRow}>
          <div>
            <div style={styles.brandWordmark}>DRAFTHEX</div>
            <div style={styles.brandSub}>Драфт и контрпики Dota 2</div>
          </div>
        </div>
        <PageMenu tab={tab} setTab={setTab} />
      </header>

      {loading && (
        <div style={styles.centerMsg}>
          <Loader2 className="spin" size={22} color="#B24BF3" />
          <span style={{ marginLeft: 10 }}>Загружаю данные OpenDota…</span>
        </div>
      )}

      {error && <div style={styles.errorBox}>{error}</div>}

      {!loading && !error && selected && (
        <>
          {tab === "home" && <HomeTab heroes={heroes} setTab={setTab} />}
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
        </>
      )}

      <footer style={styles.footer}>Данные: OpenDota API</footer>
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

const HOME_CARDS = [
  { key: "card", title: "Карточка героя", desc: "Статы, роли и матчапы одного героя", icon: IdCard },
  { key: "table", title: "Таблица контрпиков", desc: "Кто кого контрит и насколько сильно", icon: Table2 },
  { key: "web", title: "Паутина", desc: "Все контрпики на одном интерактивном графе", icon: Network },
  { key: "roles", title: "Топ по ролям", desc: "Лучшие герои по позициям и рангам", icon: Crown },
  { key: "draft", title: "Драфт 5×5", desc: "Собери команды и получи рекомендацию пика", icon: Users },
];

function HomeTab({ heroes, setTab }) {
  const featured = useMemo(() => heroes.find((h) => h.localized_name === "Pudge") || heroes[0], [heroes]);

  return (
    <div style={styles.homeWrap}>
      <div style={styles.homeHero}>
        <div style={styles.homeGlow} />
        {featured && (
          <div style={styles.homePortraitWrap}>
            <HeroIcon hero={featured} field="img" style={styles.homePortrait} alt={featured.localized_name} />
          </div>
        )}
        <h1 style={styles.homeTitle}>DRAFTHEX</h1>
        <p style={styles.homeTagline}>
          Реальная статистика OpenDota вместо догадок: контрпики, драфт 5×5 и мета — на живых данных,
          без выдуманных советов.
        </p>
        <button style={styles.homeCta} onClick={() => setTab("card")}>
          Начать <ArrowRight size={16} />
        </button>
      </div>

      <div style={styles.homeGrid}>
        {HOME_CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <button key={c.key} className="home-card" style={styles.homeCard} onClick={() => setTab(c.key)}>
              <Icon size={22} color="#B24BF3" />
              <div style={styles.homeCardTitle}>{c.title}</div>
              <div style={styles.homeCardDesc}>{c.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HeroCardTab({ heroes, selected, selectedId, setSelectedId }) {
  const [query, setQuery] = useState("");
  const { data: matchups, loading: matchupsLoading } = useMatchups(selectedId);

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
  const proWinRate = selected.pro_pick ? (selected.pro_win / selected.pro_pick) * 100 : null;
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
                <span style={{ ...styles.attrDot, background: a.color }} />
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
            <RatingGauge value={proWinRate} color={attr.color} />
          </div>
          <div style={styles.statsGrid}>
            <Stat label="Проф. винрейт" value={proWinRate ? `${proWinRate.toFixed(1)}%` : "нет данных"} />
            <Stat label="Проф. пики" value={selected.pro_pick ?? "—"} />
            <Stat label="Проф. баны" value={selected.pro_ban ?? "—"} />
            <Stat label="Тип атаки" value={selected.attack_type === "Melee" ? "Ближний бой" : "Дальний бой"} />
          </div>
        </div>

        <div style={styles.twoCol}>
          <MatchupPanel
            title="Худшие матчапы"
            icon={<TrendingDown size={16} color="#E2574C" />}
            accent="#E2574C"
            items={worst}
            loading={matchupsLoading}
            heroById={heroById}
            labelFor={(m) => `${(m.winRate * 100).toFixed(0)}% побед против`}
          />
          <MatchupPanel
            title="Лучшие матчапы"
            icon={<TrendingUp size={16} color="#5FCB8E" />}
            accent="#5FCB8E"
            items={best}
            loading={matchupsLoading}
            heroById={heroById}
            labelFor={(m) => `${(m.winRate * 100).toFixed(0)}% побед против`}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={styles.statBox}>
      <div style={styles.statValue}>{value}</div>
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
      {loading && <div style={styles.mutedText}>Загрузка…</div>}
      {!loading && items.length === 0 && <div style={styles.mutedText}>Недостаточно данных про-матчей.</div>}
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
  { key: "pro", label: "Про", pickField: "pro_pick", winField: "pro_win", minPicks: 5 },
  { key: "1", label: "Herald", pickField: "1_pick", winField: "1_win", minPicks: 40 },
  { key: "2", label: "Guardian", pickField: "2_pick", winField: "2_win", minPicks: 40 },
  { key: "3", label: "Crusader", pickField: "3_pick", winField: "3_win", minPicks: 40 },
  { key: "4", label: "Archon", pickField: "4_pick", winField: "4_win", minPicks: 40 },
  { key: "5", label: "Legend", pickField: "5_pick", winField: "5_win", minPicks: 40 },
  { key: "6", label: "Ancient", pickField: "6_pick", winField: "6_win", minPicks: 40 },
  { key: "7", label: "Divine", pickField: "7_pick", winField: "7_win", minPicks: 40 },
  { key: "8", label: "Immortal", pickField: "8_pick", winField: "8_win", minPicks: 40 },
];

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

function DraftTab({ heroes, onOpenCard }) {
  const [radiant, setRadiant] = useState([null, null, null, null, null]);
  const [dire, setDire] = useState([null, null, null, null, null]);
  const [pool, togglePool] = useHeroPool();
  const [picker, setPicker] = useState(null); // { side, index } | null
  const [pickerQuery, setPickerQuery] = useState("");
  const [poolOnly, setPoolOnly] = useState(false);
  const [, forceRerender] = useState(0);

  const heroById = (id) => heroes.find((h) => h.id === id);
  const pickedIds = useMemo(() => [...radiant, ...dire].filter(Boolean), [radiant, dire]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of pickedIds) {
        if (!matchupsCache.has(id)) {
          try {
            await getMatchups(id);
            if (!cancelled) forceRerender((v) => v + 1);
          } catch {
            // hero's matchups failed to load — pairs involving it just stay "unknown"
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedIds.join(",")]);

  function pairWinRate(aId, bId) {
    const aData = matchupsCache.get(aId);
    if (aData) {
      const e = aData.find((m) => m.hero_id === bId);
      if (e && e.games_played > 0) return e.wins / e.games_played;
    }
    const bData = matchupsCache.get(bId);
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

  function suggestions(side) {
    const enemyIds = (side === "radiant" ? dire : radiant).filter(Boolean);
    if (enemyIds.length === 0) return [];
    const taken = new Set(pickedIds);
    let candidates = heroes.filter((h) => !taken.has(h.id));
    if (poolOnly && pool.length) candidates = candidates.filter((h) => pool.includes(h.id));
    const scored = candidates
      .map((h) => {
        const rates = enemyIds.map((eid) => pairWinRate(h.id, eid)).filter((v) => v != null);
        if (rates.length === 0) return null;
        return {
          hero: h,
          score: rates.reduce((s, v) => s + v, 0) / rates.length,
          coverage: rates.length,
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
                <div style={styles.vsPct}>{(radiantEstimate * 100).toFixed(0)}%</div>
                <div style={styles.mutedText}>перевес Radiant</div>
                <div style={{ ...styles.mutedText, fontSize: 11, marginTop: 4 }}>
                  {matchupPairs.length} / {totalPossiblePairs} пар с известной статистикой
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

      <div style={styles.twoCol}>
        <SuggestionPanel title="Лучший пик за Radiant" color="#5FCB8E" items={suggestions("radiant")} onOpenCard={onOpenCard} />
        <SuggestionPanel title="Лучший пик за Dire" color="#E2574C" items={suggestions("dire")} onOpenCard={onOpenCard} />
      </div>

      <div style={styles.methodNote}>
        <Info size={13} color="#9C8FB0" style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Перевес и рекомендации считаются как среднее реальных винрейтов между выбранными героями (проф. матчи).
          Это не учитывает синергию союзников, предметы и стадию игры (линия/мид/лейт) — таких данных в открытом
          API нет, добавлять их выдумкой не буду.
        </span>
      </div>

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
                    <Star size={15} fill={pool.includes(h.id) ? "#B24BF3" : "none"} color="#B24BF3" />
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
        return (
          <div key={i} style={styles.slotRow}>
            {h ? (
              <>
                <HeroIcon hero={h} style={styles.matchupIcon} />
                <span style={styles.matchupName}>{h.localized_name}</span>
                <button style={styles.slotClear} onClick={() => onClear(i)}><X size={13} /></button>
              </>
            ) : (
              <button style={styles.slotEmpty} onClick={() => onSlotClick(i)}>
                <Plus size={14} /> Выбрать героя
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SuggestionPanel({ title, color, items, onOpenCard }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <Sparkles size={16} color={color} />
        <span style={{ ...styles.panelTitle, color }}>{title}</span>
      </div>
      {items.length === 0 && (
        <div style={styles.mutedText}>Добавь хотя бы одного героя в команду соперника, чтобы увидеть рекомендации.</div>
      )}
      {items.map(({ hero, score, coverage }) => (
        <div key={hero.id} style={styles.roleRow} onClick={() => onOpenCard(hero.id)}>
          <HeroIcon hero={hero} style={styles.matchupIcon} />
          <span style={styles.matchupName}>{hero.localized_name}</span>
          <span style={{ ...styles.rolePct, color }}>{(score * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function RolesTab({ heroes, onPick }) {
  const [bracketKey, setBracketKey] = useState("pro");
  const bracket = BRACKETS.find((b) => b.key === bracketKey);

  const byRole = useMemo(() => {
    const map = {};
    ROLE_ORDER.forEach((r) => (map[r] = []));
    heroes.forEach((h) => {
      const picks = h[bracket.pickField];
      const wins = h[bracket.winField];
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

      <div style={styles.methodNote}>
        <Info size={13} color="#9C8FB0" style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Ранжирование по винрейту в ранге «{bracket.label}» среди героев с {bracket.minPicks}+ пиками в этом
          ранге. OpenDota не делит героев на позиции 1–5 (керри/мид/оффлейн/сапорт-4/сапорт-5) — здесь показаны
          реальные теги ролей из их базы. Точное деление на позиции — отдельная задача на будущее.
        </span>
      </div>

      <div style={styles.roleGrid}>
        {ROLE_ORDER.map((role) => {
          const list = byRole[role].slice(0, 5);
          return (
            <div key={role} style={styles.panel}>
              <div style={styles.panelHeader}>
                <Crown size={16} color="#B24BF3" />
                <span style={{ ...styles.panelTitle, color: "#B24BF3" }}>{ROLE_RU[role] || role}</span>
              </div>
              {list.length === 0 && <div style={styles.mutedText}>Недостаточно данных для этого ранга.</div>}
              {list.map(({ hero, winRate }, i) => (
                <div key={hero.id} style={styles.roleRow} onClick={() => onPick(hero.id)}>
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

  const { data: matchups, loading, error } = useMatchups(selectedId);
  const heroById = (id) => heroes.find((h) => h.id === id);

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
          <div style={styles.centerMsg}>
            <Loader2 className="spin" size={18} color="#B24BF3" />
            <span style={{ marginLeft: 10 }}>Считаю матчапы…</span>
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

      <div style={styles.methodNote}>
        <Info size={13} color="#9C8FB0" style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Скор контра считается по отклонению винрейта от 50% (0 — нейтрально, 100 — сильный перекос). «Тип контра»
          подключим, когда доберёмся до анализа способностей и предметов.
        </span>
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
const MIN_GAMES_EDGE = 20;
const EDGE_WINRATE_THRESHOLD = 0.53;

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
  const [zoom, setZoom] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? 0.5 : 1
  );

  async function buildGraph(nextScope) {
    const opt = SCOPE_OPTIONS.find((o) => o.key === nextScope);
    const sorted = [...heroes].sort((a, b) => (b.pro_pick || 0) - (a.pro_pick || 0));
    const selection = opt.count === Infinity ? heroes : sorted.slice(0, opt.count);
    setGraphHeroes(selection);
    setBuildProgress({ done: 0, total: selection.length });
    setActiveId(null);

    const toFetch = selection.filter((h) => !matchupsCache.has(h.id) && !readLocalCache(`dw_matchups_${h.id}`));
    if (toFetch.length) {
      let done = selection.length - toFetch.length;
      setBuildProgress({ done, total: selection.length });
      for (const h of toFetch) {
        try {
          await getMatchups(h.id);
        } catch {
          // skip hero on failure, graph just won't show its edges
        }
        done += 1;
        setBuildProgress({ done, total: selection.length });
        await new Promise((res) => setTimeout(res, 220));
      }
    } else {
      // everything already cached (memory or localStorage) — load instantly
      selection.forEach((h) => {
        if (!matchupsCache.has(h.id)) {
          const cached = readLocalCache(`dw_matchups_${h.id}`);
          if (cached) matchupsCache.set(h.id, cached);
        }
      });
      setBuildProgress({ done: selection.length, total: selection.length });
    }

    const map = {};
    const validIds = new Set(selection.map((h) => h.id));
    selection.forEach((h) => {
      const data = matchupsCache.get(h.id);
      if (!data) return;
      map[h.id] = data
        .filter((m) => m.games_played >= MIN_GAMES_EDGE && validIds.has(m.hero_id))
        .map((m) => ({ targetId: m.hero_id, winRate: m.wins / m.games_played, games: m.games_played }));
    });
    setEdgesByHero(map);
    setBuildProgress(null);
    setBuilt(nextScope);
  }

  useEffect(() => {
    if (heroes.length && built === null) buildGraph(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroes]);

  const heroById = (id) => graphHeroes.find((h) => h.id === id);

  const nodes = useMemo(() => {
    const grouped = { str: [], agi: [], int: [], all: [] };
    graphHeroes.forEach((h) => grouped[ATTR[h.primary_attr] ? h.primary_attr : "all"].push(h));
    const ordered = [...grouped.str, ...grouped.agi, ...grouped.int, ...grouped.all];
    const n = ordered.length;
    const size = 720, center = size / 2, radius = size / 2 - 46;
    return ordered.map((h, i) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      return { hero: h, x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
    });
  }, [graphHeroes]);

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
  const size = 720;

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
          <Loader2 className="spin" size={16} color="#B24BF3" />
          <span>Строю граф: {buildProgress.done} / {buildProgress.total} героев</span>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${(buildProgress.done / buildProgress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {!buildProgress && graphHeroes.length > 0 && (
        <div className="layout-cols" style={styles.webLayout}>
          <div style={styles.graphPanel}>
            <div style={styles.zoomControls}>
              <button style={styles.zoomBtn} onClick={() => setZoom((z) => Math.min(2, z + 0.2))}><ZoomIn size={14} /></button>
              <button style={styles.zoomBtn} onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}><ZoomOut size={14} /></button>
              <button style={styles.zoomBtn} onClick={() => setZoom(1)}><RotateCcw size={14} /></button>
            </div>
            <div style={styles.svgScroll}>
              <div style={{ position: "relative", width: size * zoom, height: size * zoom, flexShrink: 0 }}>
                <svg width={size * zoom} height={size * zoom} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", top: 0, left: 0 }}>
                  {activeHero &&
                    activeEdges.map((e) => {
                      const from = nodePos[activeId], to = nodePos[e.targetId];
                      if (!from || !to) return null;
                      const isCounter = e.winRate < 0.5;
                      return (
                        <line
                          className="edge-line" key={e.targetId} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                          stroke={isCounter ? "#E2574C" : "#5FCB8E"}
                          strokeWidth={Math.max(1, counterScore(e.winRate) / 18)} opacity={0.75}
                        />
                      );
                    })}
                  {nodes.map(({ hero, x, y }) => (
                    <NodeRing
                      key={hero.id}
                      x={x} y={y}
                      isActive={hero.id === activeId}
                      color={(ATTR[hero.primary_attr] || ATTR.all).color}
                      dimmed={activeId && hero.id !== activeId && !activeEdges.find((e) => e.targetId === hero.id)}
                      onClick={() => { setActiveId(hero.id === activeId ? null : hero.id); onPick(hero.id); }}
                    />
                  ))}
                </svg>
                {nodes.map(({ hero, x, y }) => (
                  <NodeIcon
                    key={hero.id}
                    hero={hero}
                    x={x} y={y}
                    zoom={zoom}
                    isActive={hero.id === activeId}
                    dimmed={activeId && hero.id !== activeId && !activeEdges.find((e) => e.targetId === hero.id)}
                    onClick={() => { setActiveId(hero.id === activeId ? null : hero.id); onPick(hero.id); }}
                  />
                ))}
              </div>
            </div>
            <div style={styles.legend}>
              <span style={styles.legendItem}><span style={{ ...styles.legendLine, background: "#E2574C" }} /> контрит выбранного</span>
              <span style={styles.legendItem}><span style={{ ...styles.legendLine, background: "#5FCB8E" }} /> кого он контрит</span>
              <span style={styles.legendItem}>толщина = сила контра</span>
            </div>
          </div>

          <div style={styles.sidePanel}>
            {!activeHero && (
              <div style={styles.hintBox}>
                <Info size={16} color="#9C8FB0" />
                <span>Нажми на героя в паутине — откроется в карточке и таблице тоже.</span>
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
                      <div key={e.targetId} style={styles.sideRow}>
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
                      <div key={e.targetId} style={styles.sideRow}>
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

const styles = {
  page: {
    minHeight: "100vh",
    width: "100%",
    maxWidth: "100vw",
    overflowX: "hidden",
    background: "radial-gradient(circle at 15% 0%, rgba(109,40,217,0.14), transparent 45%), radial-gradient(circle at 85% 20%, rgba(178,75,243,0.10), transparent 40%), #07050D",
    color: "#F2EAFB",
    fontFamily: "'Inter', sans-serif",
    padding: "20px",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 20 },
  brandRow: { display: "flex", alignItems: "center", gap: 12 },
  brandWordmark: {
    fontFamily: "'Cinzel', serif", fontWeight: 900, fontSize: 26, letterSpacing: "0.06em",
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
    position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50, minWidth: 220,
    background: "#150C24", border: "1px solid #2F1F49", borderRadius: 12, padding: 6,
    boxShadow: "0 20px 50px rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", gap: 2,
  },
  menuItem: {
    display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none",
    color: "#9C8FB0", fontSize: 13, padding: "10px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left",
  },
  menuItemActive: { background: "#2C1C42", color: "#F2EAFB" },

  centerMsg: { display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "#9C8FB0" },
  errorBox: { background: "#1F1518", border: "1px solid #E2574C", color: "#F0B6AF", borderRadius: 8, padding: 16 },

  homeWrap: { maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 },
  homeHero: {
    position: "relative", textAlign: "center", padding: "48px 20px 40px",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 14, overflow: "hidden",
  },
  homeGlow: {
    position: "absolute", top: "10%", left: "50%", width: 360, height: 360, transform: "translateX(-50%)",
    background: "radial-gradient(circle, rgba(178,75,243,0.35), transparent 70%)",
    filter: "blur(10px)", zIndex: 0, animation: "pulseGlow 4s ease-in-out infinite",
  },
  homePortraitWrap: { position: "relative", zIndex: 1, animation: "floatHero 5s ease-in-out infinite" },
  homePortrait: {
    width: 160, height: 160, borderRadius: "50%", objectFit: "cover",
    border: "2px solid #B24BF3", boxShadow: "0 0 40px rgba(178,75,243,0.55)",
  },
  homeTitle: {
    position: "relative", zIndex: 1, fontFamily: "'Cinzel', serif", fontWeight: 900,
    fontSize: "clamp(36px, 7vw, 64px)", letterSpacing: "0.06em", margin: 0,
    background: "linear-gradient(135deg, #F2EAFB, #C084FC 50%, #6D28D9)",
    WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
    textShadow: "0 0 40px rgba(178,75,243,0.4)",
  },
  homeTagline: { position: "relative", zIndex: 1, maxWidth: 520, fontSize: 15, color: "#C9BEDD", lineHeight: 1.6 },
  homeCta: {
    position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8, marginTop: 8,
    background: "linear-gradient(135deg, #C084FC, #6D28D9)", border: "none", color: "#fff",
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15, padding: "12px 26px",
    borderRadius: 999, cursor: "pointer", boxShadow: "0 0 24px rgba(178,75,243,0.5)",
  },
  homeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 },
  homeCard: {
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, textAlign: "left",
    background: "#140B22", border: "1px solid #2F1F49", borderRadius: 14, padding: 20, cursor: "pointer",
    boxShadow: "0 0 30px rgba(109,40,217,0.1)", transition: "transform 0.15s ease, box-shadow 0.15s ease",
  },
  homeCardTitle: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 16, color: "#F2EAFB" },
  homeCardDesc: { fontSize: 12, color: "#9C8FB0", lineHeight: 1.4 },

  layout: { display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "start" },
  sidebar: { background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 10, padding: 8, display: "flex", flexDirection: "column", gap: 8 },
  chipList: { display: "flex", flexDirection: "column", gap: 4, maxHeight: "calc(100vh - 220px)", overflowY: "auto" },
  heroChip: {
    display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, border: "1px solid #2F1F49",
    cursor: "pointer", textAlign: "left", color: "#F2EAFB",
  },
  heroChipIcon: { width: 24, height: 24, borderRadius: 4, flexShrink: 0 },
  heroChipName: { fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  attrDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  detail: { display: "flex", flexDirection: "column", gap: 16 },
  card: { background: "#140B22", border: "1px solid #2F1F49", borderRadius: 12, padding: 20, boxShadow: "0 0 40px rgba(109,40,217,0.12)" },
  cardTop: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" },
  portrait: { width: 76, height: 76, borderRadius: 10, objectFit: "cover", flexShrink: 0 },
  heroName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "0.01em" },
  tagRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 },
  tag: { fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid", fontWeight: 600 },
  tagMuted: { fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid #3A2857", color: "#9C8FB0" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginTop: 20 },
  statBox: { background: "#0F1319", border: "1px solid #2C1C42", borderRadius: 8, padding: "10px 12px" },
  statValue: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18 },
  statLabel: { fontSize: 11, color: "#9C8FB0", marginTop: 2 },
  gaugeLabel: {
    position: "absolute", top: 0, left: 0, width: 76, height: 76, display: "flex", alignItems: "center",
    justifyContent: "center", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15,
  },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  panel: { background: "#140B22", border: "1px solid #2F1F49", borderRadius: 12, padding: 16, boxShadow: "0 0 30px rgba(109,40,217,0.10)" },
  panelHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  panelTitle: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: "0.03em" },
  mutedText: { fontSize: 12, color: "#9C8FB0" },
  matchupRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" },
  matchupIcon: { width: 22, height: 22, borderRadius: 4 },
  matchupName: { fontSize: 13, flex: 1 },
  matchupPct: { fontSize: 12, fontWeight: 600 },
  body: { maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  heroSelectWrap: { position: "relative", display: "flex", alignItems: "center", gap: 10 },
  heroSelectLabel: { fontSize: 13, color: "#9C8FB0" },
  heroSelectBtn: {
    display: "flex", alignItems: "center", gap: 8, background: "#140B22", border: "1px solid", borderRadius: 8,
    padding: "6px 10px", cursor: "pointer", color: "#F2EAFB",
  },
  heroSelectIcon: { width: 24, height: 24, borderRadius: 4 },
  heroSelectName: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, fontSize: 15 },
  dropdown: {
    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 10, width: 280, background: "#150C24",
    border: "1px solid #2F1F49", borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.5)", overflow: "hidden",
  },
  dropdownSearch: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #2F1F49" },
  dropdownInput: { background: "transparent", border: "none", outline: "none", color: "#F2EAFB", fontSize: 13, width: "100%" },
  dropdownList: { maxHeight: 260, overflowY: "auto" },
  dropdownItem: { display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer" },
  dropdownIcon: { width: 22, height: 22, borderRadius: 4 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  segment: {
    display: "flex", gap: 6, background: "#0E081A", border: "1px solid #2C1C42", borderRadius: 8, padding: 4,
    overflowX: "auto", WebkitOverflowScrolling: "touch", maxWidth: "100%",
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
  emptyState: { padding: "30px 14px", textAlign: "center", color: "#6E5F86", fontSize: 13 },
  methodNote: { display: "flex", gap: 8, fontSize: 12, color: "#9C8FB0", background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 8, padding: 12 },
  roleGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  roleRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer" },
  roleRank: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 13, color: "#6E5F86", width: 14 },
  rolePct: { fontSize: 12, fontWeight: 600, color: "#B24BF3", marginLeft: "auto" },
  draftToolbar: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  poolToggle: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#9C8FB0", cursor: "pointer" },
  draftGrid: { display: "grid", gridTemplateColumns: "1fr 160px 1fr", gap: 16, alignItems: "start" },
  vsCol: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", paddingTop: 30 },
  vsGauge: {
    background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 12, padding: "20px 14px",
    textAlign: "center", boxShadow: "0 0 30px rgba(109,40,217,0.12)", width: "100%",
  },
  vsPct: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 32, color: "#B24BF3" },
  slotRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", minHeight: 32 },
  slotEmpty: {
    display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px dashed #3A2857",
    color: "#6E5F86", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", width: "100%",
  },
  slotClear: { marginLeft: "auto", background: "transparent", border: "none", color: "#6E5F86", cursor: "pointer", display: "flex" },
  pickerOverlay: {
    position: "fixed", inset: 0, background: "rgba(5,3,10,0.7)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20,
  },
  pickerModal: {
    background: "#150C24", border: "1px solid #2F1F49", borderRadius: 14, width: 360, maxHeight: "70vh",
    display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  },
  pickerHeader: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid #2F1F49" },
  pickerClose: { marginLeft: "auto", background: "transparent", border: "none", color: "#9C8FB0", cursor: "pointer", display: "flex" },
  pickerList: { overflowY: "auto", padding: 6 },
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
  webLayout: { display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, maxWidth: 1100 },
  graphPanel: { background: "#0E081A", border: "1px solid #2A1A40", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  zoomControls: { display: "flex", gap: 6, justifyContent: "flex-end" },
  zoomBtn: { background: "#140B22", border: "1px solid #2F1F49", color: "#F2EAFB", borderRadius: 6, padding: 6, cursor: "pointer", display: "flex" },
  svgScroll: { overflow: "auto", WebkitOverflowScrolling: "touch", maxHeight: "65vh", maxWidth: "100%" },
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
  sideRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" },
  sideRowIcon: { width: 22, height: 22, borderRadius: 4 },
  sideRowName: { fontSize: 13, flex: 1 },
  sideRowScore: { fontSize: 12, fontWeight: 700, fontFamily: "'Rajdhani', sans-serif" },
  footer: { marginTop: 24, fontSize: 11, color: "#6E5F86", textAlign: "center" },
};
