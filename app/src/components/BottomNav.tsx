import React from "react";
import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/", label: "Home", icon: "⌂" },
  { to: "/send", label: "Send", icon: "↗" },
  { to: "/scan", label: "Scan", icon: "⊞" },
  { to: "/dashboard", label: "Wallet", icon: "◈" },
  { to: "/profile", label: "Profile", icon: "◉" },
] as const;

export default function BottomNav(): React.ReactElement {
  return (
    <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          className={({ isActive }) => (isActive ? "active" : "")}
          aria-label={tab.label}
        >
          <span style={{ fontSize: "1.25rem" }}>{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
