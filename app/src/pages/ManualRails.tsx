import React from "react";
import { Link } from "react-router-dom";

const RAILS = [
  {
    to: "/send",
    name: "Send Rail",
    desc: "One-off QUSDC transfer outside Autopilot.",
    icon: "↑",
    color: "var(--accent)",
  },
  {
    to: "/batch",
    name: "Batch Rail",
    desc: "Multi-recipient QUSDC execution for agent or manual workflows.",
    icon: "⇶",
    color: "#f59e0b",
  },
  {
    to: "/links",
    name: "Payment Link Rail",
    desc: "Create shareable requests that agents can generate from commands.",
    icon: "🔗",
    color: "#38bdf8",
  },
  {
    to: "/scan",
    name: "QR Rail",
    desc: "Receive or pay through readable mobile-first payment URIs.",
    icon: "▦",
    color: "#a78bfa",
  },
  {
    to: "/request",
    name: "Request Rail",
    desc: "Create payable obligations for counterparties.",
    icon: "↓",
    color: "#22c55e",
  },
  {
    to: "/subscriptions",
    name: "Subscription Rail",
    desc: "Create recurring obligations Autopilot can monitor.",
    icon: "↻",
    color: "#818cf8",
  },
];

export default function ManualRails(): React.ReactElement {
  return (
    <main className="page fade-in">
      <div className="page-header">
        <div>
          <div className="section-label">Execution rails</div>
          <h2 className="page-title">Manual Rails</h2>
        </div>
      </div>

      <p className="text-muted" style={{ fontSize: "0.875rem" }}>
        These are the execution rails Qevie agents can call. Use them directly
        when you want manual control, or let Autopilot call them for you.
      </p>

      <div className="tight-stack" style={{ marginTop: "var(--s-3)" }}>
        {RAILS.map((rail) => (
          <Link key={rail.to} to={rail.to} style={{ textDecoration: "none" }}>
            <div className="surface-card" style={{ display: "flex", gap: "var(--s-3)", alignItems: "center" }}>
              <div style={{
                width: 40, height: 40, borderRadius: "10px", flexShrink: 0,
                background: rail.color + "15", color: rail.color,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.125rem", border: `1px solid ${rail.color}30`,
              }}>{rail.icon}</div>
              <div>
                <div style={{ fontWeight: 700 }}>{rail.name}</div>
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>{rail.desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
