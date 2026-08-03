// Vercel serverless function.
// В репозитории: api/stratz-matchups.js
//
// Матчапы по обычным матчам через STRATZ. Файл самодостаточный.
// Удачный ответ кэшируется: если STRATZ откажет (ограничение по IP), отдаётся сохранённый.

/* --- вспомогательные функции (встроены, чтобы не зависеть от других файлов) --- */

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
      // ограничение по IP приходит обычным текстом, не JSON
      return { ok: false, error: text.slice(0, 200) };
    }
    if (json.errors && json.errors.length) {
      return { ok: false, error: json.errors.map((e) => e.message).join(" | ").slice(0, 400) };
    }
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export const config = { maxDuration: 30 };

/* --- общий код внутри каждой функции: Vercel не подключает файлы с _ в начале --- */

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
      return { ok: false, error: text.slice(0, 200) };
    }
    if (json.errors && json.errors.length) {
      return { ok: false, error: json.errors.map((e) => e.message).join(" | ").slice(0, 400) };
    }
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}


// Пробуем ограничить выборку текущим патчем. Если такого параметра в схеме нет —
// падаем на запрос без него, чтобы матчапы всё равно работали.
const Q_VERSION = `{ constants { gameVersions { id name } } }`;

const Q_WITH_PATCH = `
  query Matchups($heroId: Short!, $gameVersionId: Short!) {
    heroStats {
      matchUp(heroId: $heroId, take: 200, gameVersionId: $gameVersionId) {
        heroId
        vs { heroId2 matchCount winCount }
      }
    }
  }
`;

const Q_PLAIN = `
  query Matchups($heroId: Short!) {
    heroStats {
      matchUp(heroId: $heroId, take: 200) {
        heroId
        vs { heroId2 matchCount winCount }
      }
    }
  }
`;

function extractRows(data) {
  const matchUp = data?.heroStats?.matchUp;
  const vs = Array.isArray(matchUp) && matchUp[0] ? matchUp[0].vs || [] : [];
  return vs
    .filter((v) => v && v.heroId2 && v.matchCount)
    .map((v) => ({ hero_id: v.heroId2, games_played: v.matchCount, wins: v.winCount }));
}

export default async function handler(req, res) {
  const heroId = Number(req.query.heroId);
  if (!heroId || heroId < 1) {
    return res.status(400).json({ error: "Не указан heroId" });
  }

  const cacheKey = `stratz_mu_${heroId}`;
  let lastError = null;
  let patchName = null;

  // 1) последний игровой патч
  const patchKnownUnsupported = (await cacheGet("stratz_patch_supported")) === "no";
  let gameVersionId = patchKnownUnsupported ? null : await cacheGet("stratz_latest_version");
  if (!gameVersionId && !patchKnownUnsupported) {
    const v = await stratzQuery(Q_VERSION);
    if (v.ok) {
      const versions = v.data?.constants?.gameVersions || [];
      if (versions.length) {
        // список приходит от новых к старым
        gameVersionId = versions[0].id;
        patchName = versions[0].name;
        await cacheSet("stratz_latest_version", gameVersionId, 86400);
        await cacheSet("stratz_latest_version_name", patchName, 86400);
      }
    } else {
      lastError = v.error;
    }
  } else {
    patchName = await cacheGet("stratz_latest_version_name");
  }

  // 2) Ограничение по патчу пробуем ОДИН раз на всё приложение: если параметра нет в схеме,
  // запоминаем это и больше не тратим лишний запрос — каждый лишний вызов повышает шанс
  // упереться в ограничение STRATZ по IP.
  const patchSupported = await cacheGet("stratz_patch_supported");
  const attempts = [];
  if (gameVersionId && patchSupported !== "no") {
    attempts.push({ q: Q_WITH_PATCH, vars: { heroId, gameVersionId }, scope: patchName || "патч", isPatch: true });
  }
  attempts.push({ q: Q_PLAIN, vars: { heroId }, scope: "все матчи" });

  for (const a of attempts) {
    const r = await stratzQuery(a.q, a.vars);
    if (!r.ok) {
      lastError = r.error;
      // схема не приняла параметр патча — запоминаем, чтобы не пробовать снова
      if (a.isPatch && /gameVersionId|Unknown argument|Cannot query/i.test(r.error || "")) {
        await cacheSet("stratz_patch_supported", "no", 604800);
      }
      continue;
    }
    if (a.isPatch) await cacheSet("stratz_patch_supported", "yes", 604800);
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      await cacheSet(cacheKey, rows);
      res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=604800");
      return res.status(200).json({ rows, source: "stratz", scope: a.scope });
    }
    lastError = "пустой ответ";
  }
  const r = { ok: false, error: lastError };

  const stale = await cacheGet(cacheKey);
  if (stale && stale.length) {
    res.setHeader("Cache-Control", "public, s-maxage=600");
    return res.status(200).json({ rows: stale, stale: true, detail: r.ok ? "пустой ответ" : r.error });
  }

  return res.status(502).json({ error: "Не удалось получить матчапы", detail: r.ok ? "пустой ответ" : r.error });
}
