// Vercel serverless function.
// В репозитории: api/stratz-schema.js
//
// Показывает НАСТОЯЩУЮ схему STRATZ — какие поля и аргументы реально существуют.
// Нужен, чтобы не угадывать названия полей, а писать запросы по факту.
//
// Примеры:
//   /api/stratz-schema?type=HeroStatsQuery     — что доступно в heroStats
//   /api/stratz-schema?type=PlayerType         — что есть у игрока
//   /api/stratz-schema?search=matchUp          — найти тип по названию поля

import { stratzQuery } from "./_stratz.js";

export const config = { maxDuration: 30 };

const Q_TYPE = `
  query T($name: String!) {
    __type(name: $name) {
      name
      fields {
        name
        description
        args { name type { name kind ofType { name kind } } }
        type { name kind ofType { name kind ofType { name kind } } }
      }
    }
  }
`;

const Q_ALL_TYPES = `{ __schema { types { name kind } } }`;

function typeName(t) {
  if (!t) return "?";
  return t.name || typeName(t.ofType) || t.kind;
}

export default async function handler(req, res) {
  const search = String(req.query.search || "").trim();
  const name = String(req.query.type || "").trim();

  if (!name && !search) {
    return res.status(400).json({
      error: "Укажи ?type=ИмяТипа или ?search=часть_имени",
      examples: [
        "/api/stratz-schema?search=HeroStats",
        "/api/stratz-schema?type=HeroStatsQuery",
        "/api/stratz-schema?type=PlayerType",
      ],
    });
  }

  if (search) {
    const r = await stratzQuery(Q_ALL_TYPES);
    if (!r.ok) return res.status(502).json({ error: r.error });
    const types = (r.data?.__schema?.types || [])
      .filter((t) => t.name && t.name.toLowerCase().includes(search.toLowerCase()))
      .map((t) => t.name)
      .slice(0, 60);
    return res.status(200).json({ search, types });
  }

  const r = await stratzQuery(Q_TYPE, { name });
  if (!r.ok) return res.status(502).json({ error: r.error });
  if (!r.data?.__type) return res.status(404).json({ error: `Тип ${name} не найден` });

  const fields = (r.data.__type.fields || []).map((f) => ({
    field: f.name,
    returns: typeName(f.type),
    args: (f.args || []).map((a) => `${a.name}: ${typeName(a.type)}`),
    description: f.description || undefined,
  }));

  return res.status(200).json({ type: r.data.__type.name, count: fields.length, fields });
}

