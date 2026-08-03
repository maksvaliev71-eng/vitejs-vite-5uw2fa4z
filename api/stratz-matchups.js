// Vercel serverless function.
// В репозитории: api/stratz-matchups.js
//
// Матчапы по ОБЫЧНЫМ матчам через STRATZ GraphQL.
// Нужна переменная окружения STRATZ_API_TOKEN (бесплатный токен на stratz.com/api).
//
// Вызов: GET /api/stratz-matchups?heroId=1
// Ответ: { rows: [{ hero_id, games_played, wins }], source: "stratz" }

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
  const token = process.env.STRATZ_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "STRATZ_API_TOKEN не настроен" });
  }

  const heroId = Number(req.query.heroId);
  if (!heroId || heroId < 1) {
    return res.status(400).json({ error: "Не указан heroId" });
  }

  try {
    const r = await fetch("https://api.stratz.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        // STRATZ требует именно этот User-Agent для доступа к API
        "User-Agent": "STRATZ_API",
      },
      body: JSON.stringify({ query: QUERY, variables: { heroId } }),
    });

    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "STRATZ вернул не-JSON", detail: text.slice(0, 300) });
    }

    // если схема не совпала — отдаём текст ошибки, чтобы починить с первого раза
    if (json.errors && json.errors.length) {
      return res.status(502).json({
        error: "Ошибка запроса к STRATZ",
        detail: json.errors.map((e) => e.message).join(" | ").slice(0, 500),
      });
    }

    const matchUp = json?.data?.heroStats?.matchUp;
    if (!Array.isArray(matchUp) || matchUp.length === 0) {
      return res.status(502).json({ error: "STRATZ не вернул матчапы", detail: text.slice(0, 300) });
    }

    const vs = matchUp[0]?.vs || [];
    const rows = vs
      .filter((v) => v && v.heroId2 && v.matchCount)
      .map((v) => ({
        hero_id: v.heroId2,
        games_played: v.matchCount,
        wins: v.winCount,
      }));

    if (rows.length === 0) {
      return res.status(502).json({ error: "Пустой список матчапов", detail: text.slice(0, 300) });
    }

    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ rows, source: "stratz" });
  } catch (e) {
    return res.status(500).json({ error: "Запрос к STRATZ не удался", detail: String(e.message || e) });
  }
}
