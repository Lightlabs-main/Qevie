import React from "react";

export interface PipelineStage {
  name: string;
  desc: string;
}

/**
 * The real stages the Autopilot loop runs, in order. These mirror what the
 * executor actually does (paymaster-service/src/autopilot-executor.ts), so the
 * pipeline reflects reality rather than being a decorative diagram.
 */
export const AGENT_STAGES: PipelineStage[] = [
  { name: "Watcher", desc: "Finds due intents and reloads the policy." },
  { name: "Strategist", desc: "Composes the workflow and selects the gas mode." },
  { name: "Guardian", desc: "Enforces onchain caps, recipient scope, and expiry." },
  { name: "Executor", desc: "Submits the scoped session key UserOp." },
  { name: "Receipt / Passport", desc: "Writes the audit trail and history." },
];

type StageStatus = "done" | "active" | "pending";

export interface AgentPipelineProps {
  /** Index of the stage currently acting; -1 means idle (nothing acting). */
  activeStage: number;
  /** When true, the active stage pulses to signal work happening right now. */
  live?: boolean;
  /** Optional short status label shown on the active stage (e.g. a tx state). */
  activeLabel?: string;
  stages?: PipelineStage[];
}

export default function AgentPipeline({
  activeStage,
  live = false,
  activeLabel,
  stages = AGENT_STAGES,
}: AgentPipelineProps): React.ReactElement {
  const statusFor = (i: number): StageStatus => {
    if (activeStage < 0) return "pending";
    if (i < activeStage) return "done";
    if (i === activeStage) return "active";
    return "pending";
  };
  return (
    <div className="agent-pipeline">
      {stages.map((stage, i) => {
        const status = statusFor(i);
        const isLive = status === "active" && live;
        return (
          <div key={stage.name} className={`agent-stage is-${status}${isLive ? " is-live" : ""}`}>
            <span className="agent-stage-dot">{status === "done" ? "✓" : i + 1}</span>
            <div className="agent-stage-body">
              <strong>{stage.name}</strong>
              <span className="text-muted">{stage.desc}</span>
            </div>
            {status === "active" && activeLabel !== undefined && (
              <span className={`chip agent-stage-chip ${live ? "chip-accent" : "chip-success"}`}>{activeLabel}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
