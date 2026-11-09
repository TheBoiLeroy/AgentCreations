"use client";
import { useEffect, useState } from "react";
import { Box, Moon, Sun } from "lucide-react";
const links = [
  ["/", "The workshop"],
  ["/explore", "Explore setups"],
  ["/me", "My setups"],
] as const;
/** Top bar for the pages outside the workshop. Shares the workshop's saved theme. */
export function SiteHeader({ active }: { active?: (typeof links)[number][0] }) {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    let theme: string | null = null;
    try {
      theme = localStorage.getItem("agent-creations:theme");
    } catch {
      /* Keep the default dark theme when storage is blocked. */
    }
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    setDark(theme !== "light");
  }, []);
  const toggle = () => {
    const theme = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("agent-creations:theme", theme);
    } catch {
      /* Theme still works for this session. */
    }
  };
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Agent Creations home">
        <span className="brand-mark">
          <Box size={21} />
        </span>
        agent<span>creations</span>
        <small>LAB</small>
      </a>
      <nav aria-label="Main">
        {links.map(([href, label]) => (
          <a key={href} href={href} className={active === href ? "active" : ""} aria-current={active === href ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <div className="top-actions">
        <button className="icon-button" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
