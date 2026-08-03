// Vercel serverless function → api/stratz-matchups.js
// Матчапы по обычным матчам через STRATZ. Один запрос на героя.

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

const QUERY = `
  query Matchups($heroId: Short!) {
    heroStats {
      matchUp(heroId: $heroId, take: 200) {
        heroId
        vs { heroId2 matchCount winCount }
      }
    }
  }
`;

export default async function handler(req, res) {
  const heroId = Number(getQuery(req).heroId);
  if (!heroId || heroId < 1) return sendJson(res, 400, { error: "Не указан heroId" });

  const cacheKey = `stratz_mu_${heroId}`;
  const r = await stratzQuery(QUERY, { heroId });

  if (r.ok) {
    const matchUp = r.data && r.data.heroStats && r.data.heroStats.matchUp;
    const vs = Array.isArray(matchUp) && matchUp[0] ? matchUp[0].vs || [] : [];
    const rows = vs
      .filter((v) => v && v.heroId2 && v.matchCount)
      .map((v) => ({ hero_id: v.heroId2, games_played: v.matchCount, wins: v.winCount }));

    if (rows.length > 0) {
      await cacheSet(cacheKey, rows);
      return sendJson(res, 200, { rows, source: "stratz" },
        "public, s-maxage=21600, stale-while-revalidate=604800");
    }
  }

  const stale = await cacheGet(cacheKey);
  if (stale && stale.length) {
    return sendJson(res, 200, { rows: stale, stale: true, detail: r.ok ? "пустой ответ" : r.error },
      "public, s-maxage=600");
  }

  return sendJson(res, 502, { error: "Не удалось получить матчапы", detail: r.ok ? "пустой ответ" : r.error });
}
