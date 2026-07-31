// Vercel serverless function.
// В репозитории этот файл должен лежать по пути: api/explain.js
// (папка "api" — на одном уровне с "src" и package.json, НЕ внутри src)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { heroName, enemyNames } = req.body || {};
  if (!heroName || !Array.isArray(enemyNames) || enemyNames.length === 0) {
    return res.status(400).json({ error: "Missing heroName or enemyNames" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });
  }

  const prompt =
    `Кратко (2-3 предложения, на русском языке, без markdown-разметки) объясни, ` +
    `почему герой "${heroName}" может быть хорошим пиком в Dota 2 против команды соперника: ${enemyNames.join(", ")}. ` +
    `Опирайся только на общие игровые механики (способности, тип героя, роль). ` +
    `Не выдумывай точные цифры винрейтов — их у тебя нет.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: "Anthropic API error", details: errText });
    }

    const data = await r.json();
    const textBlock = (data.content || []).find((c) => c.type === "text");
    const explanation = textBlock ? textBlock.text : "Не удалось получить объяснение.";

    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: "Request to Anthropic failed" });
  }
}

