// Vercel serverless function.
// В репозитории: api/premium-status.js
//
// Проверяет, есть ли активная подписка у игрока по его Steam ID.
// Хранилище — Vercel KV (Storage → Create Database → KV). После создания Vercel сам
// добавит переменные KV_REST_API_URL и KV_REST_API_TOKEN, ставить npm-пакеты не нужно.
//
// Вызов: GET /api/premium-status?steamid=76561198...

async function kvGet(key) {
  // Upstash-интеграция кладёт переменные под разными именами — поддерживаем оба
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.result ?? null;
}

export default async function handler(req, res) {
  const steamid = String(req.query.steamid || "").trim();
  if (!/^\d{5,20}$/.test(steamid)) {
    return res.status(400).json({ error: "Некорректный steamid" });
  }

  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
    // хранилище ещё не подключено — отвечаем честно, а не выдаём премиум всем подряд
    return res.status(200).json({ premium: false, reason: "storage_not_configured" });
  }

  try {
    const raw = await kvGet(`premium:${steamid}`);
    if (!raw) return res.status(200).json({ premium: false });

    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    const until = record?.until ? new Date(record.until) : null;
    const active = until ? until.getTime() > Date.now() : false;

    return res.status(200).json({
      premium: active,
      until: until ? until.toISOString() : null,
    });
  } catch (e) {
    return res.status(500).json({ error: "Не удалось проверить подписку" });
  }
}
