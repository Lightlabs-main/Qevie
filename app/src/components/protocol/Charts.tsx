import React from "react";

/**
 * Lightweight, dependency-free chart primitives (SVG/CSS only — no charting
 * library added). Each renders an honest empty state when there is no data.
 */

interface Segment {
  label: string;
  value: number;
  color: string;
}

/** Donut ring for a small set of mutually-exclusive counts (e.g. policy states). */
export function StatusRing({ segments, centerLabel }: { segments: Segment[]; centerLabel?: string }): React.ReactElement {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", flexWrap: "wrap" }}>
      <svg width={110} height={110} viewBox="0 0 110 110" role="img" aria-label="Status ring">
        <circle cx={55} cy={55} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={12} />
        {total > 0 &&
          segments.map((seg) => {
            const len = (seg.value / total) * circumference;
            const dash = `${len} ${circumference - len}`;
            const el = (
              <circle
                key={seg.label}
                cx={55}
                cy={55}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={12}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform="rotate(-90 55 55)"
              />
            );
            offset += len;
            return el;
          })}
        <text x={55} y={52} textAnchor="middle" fill="var(--text-pure)" fontSize="18" fontWeight="800">
          {total}
        </text>
        <text x={55} y={68} textAnchor="middle" fill="var(--text-muted)" fontSize="9">
          {centerLabel ?? "total"}
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            <span style={{ color: "var(--text-muted)" }}>{seg.label}</span>
            <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--text-pure)" }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal split bar for proportions (e.g. paymaster mode usage). */
export function ModeSplit({ segments }: { segments: Segment[] }): React.ReactElement {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
      <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "var(--surface-3)" }}>
        {total > 0 &&
          segments.map((seg) => (
            <div
              key={seg.label}
              style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }}
              title={`${seg.label}: ${seg.value}`}
            />
          ))}
      </div>
      <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
        {segments.map((seg) => (
          <span key={seg.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.6875rem", color: "var(--text-muted)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            {seg.label} <strong style={{ color: "var(--text-pure)" }}>{seg.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Simple vertical bars for time-bucketed values (e.g. 24h vs 7d volume). */
export function VolumeBars({ bars }: { bars: Array<{ label: string; value: number; display: string }> }): React.ReactElement {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--s-3)", height: 96 }}>
      {bars.map((b) => (
        <div key={b.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-pure)" }}>{b.display}</div>
          <div
            style={{
              width: "100%",
              maxWidth: 56,
              height: `${Math.max(6, (b.value / max) * 64)}px`,
              background: "linear-gradient(180deg, var(--accent-light), var(--accent))",
              borderRadius: "6px 6px 0 0",
            }}
          />
          <div style={{ fontSize: "0.625rem", color: "var(--text-muted)" }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}
