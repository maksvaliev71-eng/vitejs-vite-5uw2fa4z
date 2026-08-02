// Vercel serverless function.
// В репозитории: api/ru-names.js  (папка "api" в корне, рядом с "src")
//
// Отдаёт официальные русские названия предметов и героев напрямую от Valve.
// Использует тот же STEAM_API_KEY, что уже настроен для входа через Steam.
// Ответ кэшируется на стороне Vercel на сутки, чтобы не дёргать Steam на каждый заход.

export default async function handler(req, res) {
  const key = process.env.STEAM_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "STEAM_API_KEY не настроен" });
  }

  try {
    const [itemsRes, heroesRes] = await Promise.all([
      fetch(`https://api.steampowered.com/IEconDOTA2_570/GetGameItems/v1/?key=${key}&language=ru`),
      fetch(`https://api.steampowered.com/IEconDOTA2_570/GetHeroes/v1/?key=${key}&language=ru&itemizedonly=0`),
    ]);

    if (!itemsRes.ok || !heroesRes.ok) {
      return res.status(502).json({ error: "Steam API вернул ошибку" });
    }

    const itemsJson = await itemsRes.json();
    const heroesJson = await heroesRes.json();

    // Steam отдаёт name вида "item_blink" — приводим к ключам dotaconstants ("blink")
    const items = {};
    (itemsJson?.result?.items || []).forEach((it) => {
      if (!it.name || !it.localized_name) return;
      items[it.name.replace(/^item_/, "")] = it.localized_name;
    });

    // Герои приходят как "npc_dota_hero_antimage"
    const heroes = {};
    (heroesJson?.result?.heroes || []).forEach((h) => {
      if (!h.name || !h.localized_name) return;
      heroes[h.name] = h.localized_name;
    });

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ items, heroes });
  } catch (e) {
    return res.status(500).json({ error: "Не удалось получить данные от Steam" });
  }
}

