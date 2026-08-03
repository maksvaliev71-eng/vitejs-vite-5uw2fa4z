// Vercel serverless function.
// В репозитории: api/stratz-matchups.js
//
// Матчапы по обычным матчам через STRATZ. Требует api/_stratz.js рядом.
// Удачный ответ кэшируется: если STRATZ откажет (ограничение по IP), отдаётся сохранённый.

import { stratzQuery, cacheGet, cacheSet } from "./_stratz.js";

export const config = { maxDuration: 30 };

const QUERY = `
  query Matchups($heroId: Short!) {
    heroStats {
      matchUp(heroId: $heroId, take: 200) {
        heroId
        vs {
          heroId2
          matchCount
          winCount
        }
      }
    }
  }
`;

export default async function handler(req, res) {
  const heroId = Number(req.query.heroId);
  if (!heroId || heroId < 1) {
    return res.status(400).json({ error: "Не указан heroId" });
  }

  const cacheKey = `stratz_mu_${heroId}`;
  const r = await stratzQuery(QUERY, { heroId });

  if (r.ok) {
    const matchUp = r.data?.heroStats?.matchUp;
    const vs = Array.isArray(matchUp) && matchUp[0] ? matchUp[0].vs || [] : [];
    const rows = vs
      .filter((v) => v && v.heroId2 && v.matchCount)
      .map((v) => ({ hero_id: v.heroId2, games_played: v.matchCount, wins: v.winCount }));

    if (rows.length > 0) {
      await cacheSet(cacheKey, rows);
      res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=604800");
      return res.status(200).json({ rows, source: "stratz" });
    }
  }

  const stale = await cacheGet(cacheKey);
  if (stale && stale.length) {
    res.setHeader("Cache-Control", "public, s-maxage=600");
    return res.status(200).json({ rows: stale, stale: true, detail: r.ok ? "пустой ответ" : r.error });
  }

  return res.status(502).json({ error: "Не удалось получить матчапы", detail: r.ok ? "пустой ответ" : r.error });
}
