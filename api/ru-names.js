// Vercel serverless function → api/ru-names.js
// Русские названия предметов, героев и способностей через STRATZ.
//   ?part=names      только предметы и герои (быстро)
//   ?part=abilities  только способности
//   без параметра    всё сразу

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

const Q_ITEMS = `{ constants { items(language: RUSSIAN) { id name displayName language { displayName description } } } }`;
const Q_HEROES = `{ constants { heroes(language: RUSSIAN) { id shortName displayName } } }`;
const Q_ABILITIES = `{ constants { abilities(language: RUSSIAN) { id name language { displayName description } } } }`;

function clean(v) {
  if (!v) return null;
  const text = Array.isArray(v) ? v.join(" ") : v;
  return String(text).replace(/<[^>]+>/g, "").trim() || null;
}

export default async function handler(req, res) {
  const part = String(getQuery(req).part || "all");
  const wantNames = part === "all" || part === "names";
  const wantAbilities = part === "all" || part === "abilities";

  const diagnostics = {};
  const items = {};
  const itemDescriptions = {};
  const heroes = {};
  const abilities = {};

  const [ri, rh, ra] = await Promise.all([
    wantNames ? stratzQuery(Q_ITEMS) : Promise.resolve({ ok: true, data: null }),
    wantNames ? stratzQuery(Q_HEROES) : Promise.resolve({ ok: true, data: null }),
    wantAbilities ? stratzQuery(Q_ABILITIES) : Promise.resolve({ ok: true, data: null }),
  ]);

  if (ri.ok) {
    const list = (ri.data && ri.data.constants && ri.data.constants.items) || [];
    list.forEach((it) => {
      if (!it) return;
      const key = String(it.name || "").replace(/^item_/, "");
      if (!key) return;
      const loc = it.language || {};
      const nm = loc.displayName || it.displayName;
      if (nm) items[key] = nm;
      const d = clean(loc.description);
      if (d) itemDescriptions[key] = d;
    });
  } else {
    diagnostics.items = ri.error;
  }

  if (rh.ok) {
    const list = (rh.data && rh.data.constants && rh.data.constants.heroes) || [];
    list.forEach((h) => {
      if (h && h.shortName && h.displayName) heroes[`npc_dota_hero_${h.shortName}`] = h.displayName;
    });
  } else {
    diagnostics.heroes = rh.error;
  }

  if (ra.ok) {
    const list = (ra.data && ra.data.constants && ra.data.constants.abilities) || [];
    list.forEach((a) => {
      if (!a || !a.name) return;
      const loc = a.language || {};
      if (loc.displayName) abilities[`n:${a.name}`] = loc.displayName;
      const d = clean(loc.description);
      if (d) abilities[`d:${a.name}`] = d;
    });
  } else {
    diagnostics.abilities = ra.error;
  }

  const total = Object.keys(items).length + Object.keys(heroes).length + Object.keys(abilities).length;
  if (total === 0) {
    const stale = await cacheGet(`ru_names_${part}`);
    if (stale) return sendJson(res, 200, Object.assign({}, stale, { stale: true, diagnostics }), "public, s-maxage=600");
    return sendJson(res, 502, { error: "STRATZ не вернул локализацию", diagnostics, part });
  }

  const payload = {
    part,
    items,
    itemDescriptions,
    heroes,
    abilities,
    counts: {
      items: Object.keys(items).length,
      heroes: Object.keys(heroes).length,
      abilities: Object.keys(abilities).length,
    },
    diagnostics,
  };

  await cacheSet(`ru_names_${part}`, payload);
  return sendJson(res, 200, payload, "public, s-maxage=86400, stale-while-revalidate=604800");
}
