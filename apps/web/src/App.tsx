import { useEffect, useState } from "react";
import { HashRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "@/store/app";

import DecksScreen from "./screens/Decks";
import ReviewScreen from "./screens/Review";
import SettingsScreen from "./screens/Settings";
import StatsScreen from "./screens/Stats";
import TodayScreen from "./screens/Today";

function Nav() {
  const items = [
    { to: "/", label: "Today", icon: "⌂" },
    { to: "/review", label: "Review", icon: "◔" },
    { to: "/decks", label: "Decks", icon: "▤" },
    { to: "/stats", label: "Stats", icon: "▦" },
    { to: "/settings", label: "Settings", icon: "⚙" },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur md:top-0 md:bottom-auto md:border-b md:border-t-0">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-around gap-1 px-2 md:justify-start md:gap-2">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-xs transition-colors md:flex-row md:gap-1.5 md:text-sm ${
                isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
              }`
            }
          >
            <span className="text-base leading-none">{it.icon}</span>
            <span>{it.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default function App() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("lernweb:dark") !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("lernweb:dark", dark ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [dark]);

  return (
    <AppProvider>
      <HashRouter>
        <div className="min-h-dvh pb-20 md:pb-8">
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-6">
            <Routes>
              <Route path="/" element={<TodayScreen />} />
              <Route path="/review" element={<ReviewScreen />} />
              <Route path="/decks" element={<DecksScreen />} />
              <Route path="/stats" element={<StatsScreen />} />
              <Route path="/settings" element={<SettingsScreen dark={dark} onToggleDark={() => setDark((d) => !d)} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </HashRouter>
    </AppProvider>
  );
}
