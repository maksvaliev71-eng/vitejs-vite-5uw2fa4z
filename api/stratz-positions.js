// Vercel serverless function → api/stratz-positions.js
// Винрейт героев по позициям 1–5.

export const config = { maxDuration: 30 };

/* --- всё необходимое внутри файла: Vercel не подключает файлы с _ в начале,
       а req.query / res.status в этом проекте недоступны --- */

function getQuery(req) {
  try {
    const host = (req.headers && req.headers.host) || "localhost";
    const u = new URL(req.url, `http://${host}`);
    const out = {};
    u.searchParams.forEach((v, k) => { out[k] = v; });
    return out;
  } catch {
    return {};
  }
}

function sendJson(res, status, obj, cacheHeader) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cacheHeader) res.setHeader("Cache-Control", cacheHeader);
  res.end(JSON.stringify(obj));
}

function kvCreds() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function cacheGet(key) {
  const { url, token } = kvCreds();
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.result ? JSON.parse(data.result) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds = 604800) {
  const { url, token } = kvCreds();
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(JSON.stringify(value)),
    });
  } catch {
    // кэш необязателен
  }
}

async function stratzQuery(query, variables) {
  const token = process.env.STRATZ_API_TOKEN;
  if (!token) return { ok: false, error: "STRATZ_API_TOKEN не настроен" };
  try {
    const r = await fetch("https://api.stratz.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "STRATZ_API",
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    if (json.errors && json.errors.length) {
      return { ok: false, error: json.errors.map((e) => e.message).join(" | ").slice(0, 400) };
    }
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

const VARIANTS = [
  {
    name: "stats+groupByPosition",
    query: `{ heroStats { stats(groupByPosition: true) { heroId position matchCount winCount } } }`,
    pick: (d) => d && d.heroStats && d.heroStats.stats,
  },
  {
    name: "stats",
    query: `{ heroStats { stats { heroId position matchCount winCount } } }`,
    pick: (d) => d && d.heroStats && d.heroStats.stats,
  },
  {
    name: "winMonth",
    query: `{ heroStats { winMonth(take: 2000) { heroId position matchCount winCount } } }`,
    pick: (d) => d && d.heroStats && d.heroStats.winMonth,
  },
];

const CACHE_KEY = "stratz_positions_v1";

export default async function handler(req, res) {
  const tried = [];

  for (const v of VARIANTS) {
    const r = await stratzQuery(v.query);
    if (!r.ok) {
      tried.push(`${v.name}: ${r.error}`);
      continue;
    }
    const raw = v.pick(r.data);
    if (!Array.isArray(raw) || raw.length === 0) {
      tried.push(`${v.name}: пустой ответ`);
      continue;
    }
    const rows = raw
      .filter((x) => x && x.heroId && x.position && x.matchCount)
      .map((x) => ({
        heroId: x.heroId,
        position: String(x.position),
        matchCount: x.matchCount,
        winCount: x.winCount,
      }));
    if (rows.length === 0) {
      tried.push(`${v.name}: нет строк с позицией`);
      continue;
    }
    await cacheSet(CACHE_KEY, rows);
    return sendJson(res, 200, { rows, variant: v.name },
      "public, s-maxage=21600, stale-while-revalidate=604800");
  }

  const stale = await cacheGet(CACHE_KEY);
  if (stale && stale.length) {
    return sendJson(res, 200, { rows: stale, stale: true, tried }, "public, s-maxage=600");
  }
  return sendJson(res, 502, { error: "STRATZ не вернул статистику по позициям", tried });
}
