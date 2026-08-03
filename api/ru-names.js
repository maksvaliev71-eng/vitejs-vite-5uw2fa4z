// Vercel serverless function.
// В репозитории: api/ru-names.js
//
// Русские названия и описания предметов, героев и способностей через STRATZ.
// Нужна та же переменная STRATZ_API_TOKEN, что уже настроена для матчапов.
//
// Каждый запрос отправляется отдельно: если у одного не совпадёт схема,
// остальные всё равно вернутся, а текст ошибки придёт наружу для починки.

import { stratzQuery, cacheGet, cacheSet } from "./_stratz.js";

export const config = { maxDuration: 30 };

const Q_ITEMS = `{ constants { items(language: RUSSIAN) { id name displayName } } }`;
const Q_HEROES = `{ constants { heroes(language: RUSSIAN) { id shortName displayName } } }`;
const Q_ABILITIES = `{ constants { abilities(language: RUSSIAN) { id name language { displayName description } } } }`;

export default async function handler(req, res) {
  // Описания способностей — самая тяжёлая часть ответа. Отдаём по частям,
  // чтобы названия предметов и героев появлялись почти сразу.
  const part = String(req.query.part || "all");
  const wantItems = part === "all" || part === "names";
  const wantAbilities = part === "all" || part === "abilities";

  const diagnostics = {};
  const items = {};
  const heroes = {};
  const abilities = {};

  const [ri, rh, ra] = await Promise.all([
    wantItems ? stratzQuery(Q_ITEMS) : Promise.resolve({ ok: true, data: null }),
    wantItems ? stratzQuery(Q_HEROES) : Promise.resolve({ ok: true, data: null }),
    wantAbilities ? stratzQuery(Q_ABILITIES) : Promise.resolve({ ok: true, data: null }),
  ]);

  if (ri.ok) {
    (ri.data?.constants?.items || []).forEach((it) => {
      if (!it || !it.displayName) return;
      // ключи dotaconstants выглядят как "blink", у STRATZ — "item_blink"
      const key = String(it.name || "").replace(/^item_/, "");
      if (key) items[key] = it.displayName;
    });
  } else {
    diagnostics.items = ri.error;
  }

  if (rh.ok) {
    (rh.data?.constants?.heroes || []).forEach((h) => {
      if (!h || !h.displayName) return;
      if (h.shortName) heroes[`npc_dota_hero_${h.shortName}`] = h.displayName;
    });
  } else {
    diagnostics.heroes = rh.error;
  }

  if (ra.ok) {
    (ra.data?.constants?.abilities || []).forEach((a) => {
      if (!a || !a.name) return;
      const loc = a.language || {};
      if (loc.displayName) abilities[`n:${a.name}`] = loc.displayName;
      if (loc.description) {
        const desc = Array.isArray(loc.description) ? loc.description.join(" ") : loc.description;
        abilities[`d:${a.name}`] = String(desc).replace(/<[^>]+>/g, "").trim();
      }
    });
  } else {
    diagnostics.abilities = ra.error;
  }

  const anything = Object.keys(items).length + Object.keys(heroes).length + Object.keys(abilities).length;
  if (anything === 0) {
    const stale = await cacheGet(`ru_names_${part}`);
    if (stale) {
      res.setHeader("Cache-Control", "public, s-maxage=600");
      return res.status(200).json({ ...stale, stale: true, diagnostics });
    }
    return res.status(502).json({ error: "STRATZ не вернул локализацию", diagnostics, part });
  }

  const payload = {
    part,
    items,
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
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json(payload);
}
