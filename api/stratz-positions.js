// Vercel serverless function.
// В репозитории: api/stratz-positions.js
//
// Винрейт героев по позициям 1–5. Требует api/_stratz.js рядом.

import { stratzQuery, cacheGet, cacheSet } from "./_stratz.js";

export const config = { maxDuration: 30 };

const CACHE_KEY = "stratz_positions_v1";

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
    name: "winMonth",
    query: `{ heroStats { winMonth(take: 2000) { heroId position matchCount winCount } } }`,
    pick: (d) => d?.heroStats?.winMonth,
  },
];

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
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=604800");
    return res.status(200).json({ rows, variant: v.name });
  }

  // STRATZ отказал — отдаём последний удачный ответ, если он сохранён
  const stale = await cacheGet(CACHE_KEY);
  if (stale && stale.length) {
    res.setHeader("Cache-Control", "public, s-maxage=600");
    return res.status(200).json({ rows: stale, stale: true, tried });
  }

  return res.status(502).json({ error: "STRATZ не вернул статистику по позициям", tried });
}
