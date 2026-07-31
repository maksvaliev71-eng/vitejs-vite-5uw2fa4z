Skip to content
maksvaliev71-eng
vitejs-vite-5uw2fa4z
Repository navigation
Code
Issues
Pull requests
Actions
Projects
Wiki
Security and quality
Insights
Settings
Files
Go to file
t
T
src content loaded
public
src
assets
App.css
App.jsx
index.css
main.jsx
.gitignore
README.md
_oxlintrc.json
index.html
package-lock.json
package.json
vite.config.js
vitejs-vite-5uw2fa4z/src
/
App.jsx
in
main

Edit

Preview
Indent mode

Spaces
Indent size

2
Line wrap mode

No wrap
Editing App.jsx file contents
  1
  2
  3
  4
  5
  6
  7
  8
  9
 10
 11
 12
 13
 14
 15
 16
 17
 18
 19
 20
 21
 22
 23
 24
 25
 26
 27
 28
 29
 30
 31
 32
 33
 34
 35
 36
 37
 38
 39
 40
 41
 42
 43
 44
 45
 46
 47
 48
 49
 50
 51
 52
 53
 54
 55
 56
 57
 58
 59
 60
 61
 62
 63
 64
import { useState, useEffect, useMemo } from "react";
import {
  Search, Swords, TrendingUp, TrendingDown, Loader2, Info,
  ChevronDown, ArrowUpDown, ZoomIn, ZoomOut, RotateCcw,
  IdCard, Network, Table2, Crown, Star, X, Plus, Users, Sparkles,
  Home, Menu, ArrowRight,
} from "lucide-react";

/* ---------- shared design tokens ---------- */

const ATTR = {
  str: { label: "Сила", color: "#E2574C" },
  agi: { label: "Ловкость", color: "#5FCB8E" },
  int: { label: "Интеллект", color: "#5B9FE0" },
  all: { label: "Универсал", color: "#B24BF3" },
};

const ROLE_RU = {
  Carry: "Керри", Support: "Саппорт", Nuker: "Нюкер", Disabler: "Дизейблер",
  Jungler: "Джанглер", Durable: "Танк", Escape: "Побег", Pusher: "Пушер",
  Initiator: "Инициатор",
};

function img(path) {
  return `https://cdn.cloudflare.steamstatic.com${path}`;
}

function HeroIcon({ hero, field = "icon", style, alt }) {
  const [failed, setFailed] = useState(false);
  const a = ATTR[hero.primary_attr] || ATTR.all;
  if (failed) {
    return (
      <div
        style={{
          ...style,
          background: `linear-gradient(135deg, ${a.color}, #6D28D9)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#0A0611",
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 700,
          fontSize: (parseInt(style?.width, 10) || 24) * 0.5,
          flexShrink: 0,
        }}
      >
        {hero.localized_name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={img(hero[field])}
      alt={alt || ""}
      style={style}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function counterScore(winRate) {
  const deviation = Math.abs(winRate - 0.5);
  return Math.min(100, Math.round(deviation * 500));
Use Control + Shift + m to toggle the tab key moving focus. Alternatively, use esc then tab to move to the next interactive element on the page.
src content loaded
