// Vercel serverless function.
// В репозитории: api/ru-abilities.js
//
// Отдаёт русские названия и описания способностей/предметов от Valve.
// Файл разбирается на сервере и кладётся в кэш (Vercel CDN + KV, если он подключён),
// поэтому медленным будет только самый первый запрос.

export const config = { maxDuration: 60 };

// только компактный файл со способностями и предметами — полный dota_russian.txt
// весит в разы больше и не успевает разобраться за отведённое время
const SOURCES = [
  "https://raw.githubusercontent.com/SteamTracking/GameTracking-Dota2/master/game/dota/pak01_dir/resource/localization/abilities_russian.txt",
  "https://raw.githubusercontent.com/SteamDatabase/GameTracking-Dota2/master/game/dota/pak01_dir/resource/localization/abilities_russian.txt",
];

const KV_KEY = "ru_abilities_v1";

async function kvGet() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${KV_KEY}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.result ? JSON.parse(data.result) : null;
  } catch {
    return null;
  }
}

async function kvSet(value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${KV_KEY}?EX=604800`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(JSON.stringify(value)),
    });
  } catch {
    // кэш необязателен
  }
}

function decodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}

function stripMarkup(s) {
  return s.replace(/<[^>]+>/g, "").replace(/%%/g, "%").replace(/\\n/g, " ").trim();
}

// построчный разбор заметно быстрее регулярки по всему файлу
function parseLines(text) {
  const out = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf("DOTA_Tooltip_") === -1) continue;

    const firstQuote = line.indexOf('"');
    if (firstQuote === -1) continue;
    const secondQuote = line.indexOf('"', firstQuote + 1);
    if (secondQuote === -1) continue;
    const key = line.slice(firstQuote + 1, secondQuote);

    const thirdQuote = line.indexOf('"', secondQuote + 1);
    if (thirdQuote === -1) continue;
    const lastQuote = line.lastIndexOf('"');
    if (lastQuote <= thirdQuote) continue;
    const value = line.slice(thirdQuote + 1, lastQuote);

    if (key.endsWith("_Description")) {
      const m = key.match(/^DOTA_Tooltip_[Aa]bility_(.+)_Description$/);
      if (m) out[`d:${m[1]}`] = stripMarkup(value);
    } else {
      const m = key.match(/^DOTA_Tooltip_[Aa]bility_([a-z0-9_]+)$/);
      if (m) out[`n:${m[1]}`] = stripMarkup(value);
    }
  }
  return out;
}

export default async function handler(req, res) {
  const cached = await kvGet();
  if (cached) {
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=604800");
    return res.status(200).json({ count: Object.keys(cached).length, cached: true, strings: cached });
  }

  const tried = [];
  let text = null;
  for (const url of SOURCES) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        tried.push(`${r.status} ${url}`);
        continue;
      }
      const candidate = decodeBuffer(await r.arrayBuffer());
      if (candidate && candidate.includes("DOTA_Tooltip")) {
        text = candidate;
        break;
      }
      tried.push(`формат не подошёл: ${url}`);
    } catch {
      tried.push(`сеть: ${url}`);
    }
  }

  if (!text) {
    return res.status(502).json({ error: "Не удалось получить локализацию", tried });
  }

  const strings = parseLines(text);
  if (Object.keys(strings).length === 0) {
    return res.status(502).json({ error: "Файл получен, но строк не найдено", tried });
  }

  await kvSet(strings);

  res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=604800");
  return res.status(200).json({ count: Object.keys(strings).length, cached: false, strings });
}
