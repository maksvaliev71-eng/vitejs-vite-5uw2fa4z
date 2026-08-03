// Vercel serverless function.
// В репозитории: api/ru-abilities.js
//
// Зачем: файл локализации Valve весит несколько мегабайт и лежит в кодировке UTF-16.
// Тянуть и разбирать его в браузере медленно. Здесь он скачивается и разбирается на
// сервере один раз, а наружу отдаётся компактный JSON (сотни килобайт), который Vercel
// держит в кэше сутки — на сайте загрузка становится мгновенной.

const SOURCES = [
  "https://raw.githubusercontent.com/SteamTracking/GameTracking-Dota2/master/game/dota/pak01_dir/resource/localization/abilities_russian.txt",
  "https://raw.githubusercontent.com/SteamDatabase/GameTracking-Dota2/master/game/dota/pak01_dir/resource/localization/abilities_russian.txt",
  "https://raw.githubusercontent.com/SteamTracking/GameTracking-Dota2/master/game/dota/pak01_dir/resource/localization/dota_russian.txt",
];

function decodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}

function stripMarkup(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/%%/g, "%")
    .replace(/\\n/g, "\n")
    .replace(/\t/g, " ")
    .trim();
}

export default async function handler(req, res) {
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
    } catch (e) {
      tried.push(`сеть: ${url}`);
    }
  }

  if (!text) {
    return res.status(502).json({ error: "Не удалось получить локализацию", tried });
  }

  const out = {};
  const re = /"([^"\r\n]+)"\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const value = m[2];
    const mDesc = key.match(/^DOTA_Tooltip_[Aa]bility_([a-z0-9_]+)_Description$/);
    const mName = key.match(/^DOTA_Tooltip_[Aa]bility_([a-z0-9_]+)$/);
    if (mDesc) out[`d:${mDesc[1]}`] = stripMarkup(value);
    else if (mName) out[`n:${mName[1]}`] = stripMarkup(value);
  }

  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({ count: Object.keys(out).length, strings: out });
}

