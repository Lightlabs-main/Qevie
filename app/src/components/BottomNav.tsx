import React from "react";
import { Link, useLocation } from "react-router-dom";

export default function BottomNav(): React.ReactElement {
  const location = useLocation();

  const items = [
    {
      path: "/", label: "Autopilot", icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><line x1="12" y1="3" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="21" />
        </svg>
      )
    },
    {
      path: "/autopilot/policies", label: "Policies", icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" />
        </svg>
      )
    },
    {
      path: "/agent", label: "Command", isCenter: true, icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      )
    },
    {
      path: "/passport", label: "Passport", icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="2.5" /><path d="M8.5 17a3.5 3.5 0 0 1 7 0" />
        </svg>
      )
    },
    {
      path: "/rails", label: "Rails", icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="21" /><line x1="18" y1="3" x2="18" y2="21" /><line x1="3" y1="8" x2="21" y2="8" /><line x1="3" y1="16" x2="21" y2="16" />
        </svg>
      )
    },
  ];

  return (
    <div className="bottom-nav-wrap">
      <nav className="bottom-nav">
        {items.map((item) => {
          const isActive = item.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive ? "active" : ""} ${item.isCenter ? "nav-item-center" : ""}`}
            >
              {item.icon}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
