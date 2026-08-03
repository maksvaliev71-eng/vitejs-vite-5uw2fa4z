// Vercel serverless function.
// В репозитории: api/stratz-positions.js
//
// Винрейт героев по НАСТОЯЩИМ позициям 1–5 (у OpenDota такого нет — только теги ролей).
// Нужна переменная STRATZ_API_TOKEN.
//
// Вызов: GET /api/stratz-positions
// Ответ: { rows: [{ heroId, position, matchCount, winCount }] }

export const config = { maxDuration: 30 };

async function gql(token, query) {
  const r = await fetch("https://api.stratz.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "STRATZ_API",
    },
    body: JSON.stringify({ query }),
  });

  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `не-JSON: ${text.slice(0, 200)}` };
  }
  if (json.errors && json.errors.length) {
    return { ok: false, error: json.errors.map((e) => e.message).join(" | ").slice(0, 400) };
  }
  return { ok: true, data: json.data };
}

// схему STRATZ проверить заранее нельзя, поэтому пробуем несколько вариантов запроса
const VARIANTS = [
  {
    name: "stats+groupByPosition",
    query: `{ heroStats { stats(groupByPosition: true) { heroId position matchCount winCount } } }`,
    pick: (d) => d?.heroStats?.stats,
  },
  {
    name: "stats",
    query: `{ heroStats { stats { heroId position matchCount winCount } } }`,
    pick: (d) => d?.heroStats?.stats,
  },
  {
    name: "winMonth+position",
    query: `{ heroStats { winMonth(take: 2000) { heroId position matchCount winCount } } }`,
    pick: (d) => d?.heroStats?.winMonth,
  },
];

export default async function handler(req, res) {
  const token = process.env.STRATZ_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "STRATZ_API_TOKEN не настроен" });
  }

  const tried = [];

  for (const v of VARIANTS) {
    const r = await gql(token, v.query);
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

    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ rows, variant: v.name });
  }

  return res.status(502).json({ error: "STRATZ не вернул статистику по позициям", tried });
}

