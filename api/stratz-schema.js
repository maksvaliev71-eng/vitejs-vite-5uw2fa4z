// Vercel serverless function → api/stratz-schema.js
// Показывает настоящую схему STRATZ: какие поля и аргументы существуют.
//   /api/stratz-schema?search=HeroStats
//   /api/stratz-schema?type=PlayerType

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

const Q_TYPE = `
  query T($name: String!) {
    __type(name: $name) {
      name
      fields {
        name
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
  const q = getQuery(req);
  const search = String(q.search || "").trim();
  const name = String(q.type || "").trim();

  if (!name && !search) {
    return sendJson(res, 400, {
      error: "Укажи ?type=ИмяТипа или ?search=часть_имени",
      examples: ["/api/stratz-schema?search=HeroStats", "/api/stratz-schema?type=PlayerType"],
    });
  }

  if (search) {
    const r = await stratzQuery(Q_ALL_TYPES);
    if (!r.ok) return sendJson(res, 502, { error: r.error });
    const all = (r.data && r.data.__schema && r.data.__schema.types) || [];
    const types = all
      .filter((t) => t.name && t.name.toLowerCase().includes(search.toLowerCase()))
      .map((t) => t.name)
      .slice(0, 60);
    return sendJson(res, 200, { search, types });
  }

  const r = await stratzQuery(Q_TYPE, { name });
  if (!r.ok) return sendJson(res, 502, { error: r.error });
  const t = r.data && r.data.__type;
  if (!t) return sendJson(res, 404, { error: `Тип ${name} не найден` });

  const fields = (t.fields || []).map((f) => ({
    field: f.name,
    returns: typeName(f.type),
    args: (f.args || []).map((a) => `${a.name}: ${typeName(a.type)}`),
  }));

  return sendJson(res, 200, { type: t.name, count: fields.length, fields });
}
