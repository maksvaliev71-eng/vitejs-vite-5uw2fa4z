// Vercel serverless function.
// В репозитории: api/premium-grant.js
//
// Выдаёт подписку игроку вручную. Пока не подключена оплата — это способ выдать премиум
// себе и тестерам. Позже сюда же будет писать вебхук платёжной системы.
//
// Нужны переменные окружения:
//   KV_REST_API_URL, KV_REST_API_TOKEN — появятся сами после создания KV в Vercel
//   ADMIN_SECRET — придумай длинную случайную строку и добавь вручную
//
// Вызов:
//   POST /api/premium-grant
//   { "secret": "<ADMIN_SECRET>", "steamid": "76561198...", "days": 30 }

async function kvSet(key, value) {
  // Upstash-интеграция кладёт переменные под разными именами — поддерживаем оба
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV не настроен");

  const r = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error("KV write failed");
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Только POST" });
  }

  const { secret, steamid, days } = req.body || {};

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: "ADMIN_SECRET не настроен" });
  }
  if (secret !== adminSecret) {
    return res.status(403).json({ error: "Неверный секрет" });
  }
  if (!/^\d{5,20}$/.test(String(steamid || ""))) {
    return res.status(400).json({ error: "Некорректный steamid" });
  }

  const period = Number(days) > 0 ? Number(days) : 30;
  const until = new Date(Date.now() + period * 24 * 60 * 60 * 1000).toISOString();

  try {
    await kvSet(`premium:${steamid}`, JSON.stringify({ until, grantedAt: new Date().toISOString() }));
    return res.status(200).json({ ok: true, steamid, until });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
