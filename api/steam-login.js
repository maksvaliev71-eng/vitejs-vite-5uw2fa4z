// Vercel serverless function.
// В репозитории: api/steam-login.js (папка "api" в корне, рядом с "src")
//
// Требует пакет node-steam-openid — добавь в package.json:
//   "node-steam-openid": "^2.0.4"
// и переменную окружения STEAM_API_KEY в настройках Vercel
// (ключ бесплатно на https://steamcommunity.com/dev/apikey)

import SteamAuth from "node-steam-openid";

export default async function handler(req, res) {
  const host = req.headers.host;
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const steam = new SteamAuth({
    realm: baseUrl,
    returnUrl: `${baseUrl}/api/steam-callback`,
    apiKey: process.env.STEAM_API_KEY,
  });

  try {
    const redirectUrl = await steam.getRedirectUrl();
    res.writeHead(302, { Location: redirectUrl });
    res.end();
  } catch (e) {
    res.status(500).json({ error: "Steam login init failed", details: String(e) });
  }
}

