// Vercel serverless function.
// В репозитории: api/steam-callback.js (папка "api" в корне, рядом с "src")
//
// Тот же STEAM_API_KEY, что и в api/steam-login.js

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
    const user = await steam.authenticate(req);
    // user.steamid — 17-значный SteamID64, конвертацию в 32-битный ID
    // (нужный формат для OpenDota) сайт делает сам на фронтенде
    res.writeHead(302, { Location: `${baseUrl}/?steamid=${user.steamid}` });
    res.end();
  } catch (e) {
    res.writeHead(302, { Location: `${baseUrl}/?steamAuthError=1` });
    res.end();
  }
}

