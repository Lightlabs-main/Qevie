import React from "react";
import { NavLink } from "react-router-dom";

interface Tab {
  to: string;
  icon: React.ReactElement;
  label: string;
  center?: boolean;
}

const TABS: readonly Tab[] = [
  {
    to: "/",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    label: "Home",
  },
  {
    to: "/send",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    ),
    label: "Send",
  },
  {
    to: "/links",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
      </svg>
    ),
    label: "Links",
    center: true,
  },
  {
    to: "/dashboard",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
    ),
    label: "Wallet",
  },
  {
    to: "/profile",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
    label: "Profile",
  },
];

export default function BottomNav(): React.ReactElement {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {TABS.map((tab) =>
        tab.center ? (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `nav-item nav-item-center${isActive ? " active" : ""}`}
            aria-label={tab.label}
          >
            <div className="nav-icon-wrap">{tab.icon}</div>
            <span>{tab.label}</span>
          </NavLink>
        ) : (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            aria-label={tab.label}
          >
            <span className="nav-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </NavLink>
        )
      )}
    </nav>
  );
}
