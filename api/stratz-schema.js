// Vercel serverless function.
// В репозитории: api/stratz-schema.js
//
// Показывает НАСТОЯЩУЮ схему STRATZ — какие поля и аргументы реально существуют.
// Нужен, чтобы не угадывать названия полей, а писать запросы по факту.
//
// Примеры:
//   /api/stratz-schema?type=HeroStatsQuery     — что доступно в heroStats
//   /api/stratz-schema?type=PlayerType         — что есть у игрока
//   /api/stratz-schema?search=matchUp          — найти тип по названию поля

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


const Q_TYPE = `
  query T($name: String!) {
    __type(name: $name) {
      name
      fields {
        name
        description
        args { name type { name kind ofType { name kind } } }
        type { name kind ofType { name kind ofType { name kind } } }
      }
    }
  }
`;

const Q_ALL_TYPES = `{ __schema { types { name kind } } }`;

function typeName(t) {
  if (!t) return "?";
  return t.name || typeName(t.ofType) || t.kind;
}

export default async function handler(req, res) {
  const search = String(req.query.search || "").trim();
  const name = String(req.query.type || "").trim();

  if (!name && !search) {
    return res.status(400).json({
      error: "Укажи ?type=ИмяТипа или ?search=часть_имени",
      examples: [
        "/api/stratz-schema?search=HeroStats",
        "/api/stratz-schema?type=HeroStatsQuery",
        "/api/stratz-schema?type=PlayerType",
      ],
    });
  }

  if (search) {
    const r = await stratzQuery(Q_ALL_TYPES);
    if (!r.ok) return res.status(502).json({ error: r.error });
    const types = (r.data?.__schema?.types || [])
      .filter((t) => t.name && t.name.toLowerCase().includes(search.toLowerCase()))
      .map((t) => t.name)
      .slice(0, 60);
    return res.status(200).json({ search, types });
  }

  const r = await stratzQuery(Q_TYPE, { name });
  if (!r.ok) return res.status(502).json({ error: r.error });
  if (!r.data?.__type) return res.status(404).json({ error: `Тип ${name} не найден` });

  const fields = (r.data.__type.fields || []).map((f) => ({
    field: f.name,
    returns: typeName(f.type),
    args: (f.args || []).map((a) => `${a.name}: ${typeName(a.type)}`),
    description: f.description || undefined,
  }));

  return res.status(200).json({ type: r.data.__type.name, count: fields.length, fields });
}
