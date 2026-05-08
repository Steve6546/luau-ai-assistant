/**
 * Display-only preview of a `TaskPlan` envelope (Phase 2, Step 2).
 *
 * Renders the plan's title, summary, scaffold tree, task list, and
 * suggested-next chips in a dark card. Approve / Cancel buttons surface
 * intent only — this component does **not** call the bridge or mutate
 * any state. The host (chat panel, etc.) wires the callbacks to the
 * actual approval / dispatch flow in a later step.
 */
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMode } from "@/contexts/ChatModeContext";
import type { ScaffoldEntry, TaskCategory, TaskPlan } from "@/utils/parseTaskPlan";

export interface PlanPreviewCardProps {
  plan: TaskPlan;
  onApprove: () => void;
  onCancel: () => void;
  mode: ChatMode;
  className?: string;
}

type RiskLevel = "low" | "medium" | "high";

interface RiskMeta {
  label: string;
  icon: string;
  className: string;
}

const RISK_META: Record<RiskLevel, RiskMeta> = {
  low: {
    label: "Low",
    icon: "🟢",
    className: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  },
  medium: {
    label: "Medium",
    icon: "🟡",
    className: "bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30",
  },
  high: {
    label: "High",
    icon: "🔴",
    className: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
  },
};

interface CategoryMeta {
  label: string;
  className: string;
}

const CATEGORY_META: Record<TaskCategory, CategoryMeta> = {
  read: { label: "Safe", className: "bg-blue-500/20 text-blue-400" },
  write: { label: "Write ✋", className: "bg-yellow-500/20 text-yellow-400" },
  runtime: { label: "Runtime", className: "bg-orange-500/20 text-orange-400" },
  destructive: { label: "Destructive", className: "bg-red-500/20 text-red-400" },
};

function computeRisk(plan: TaskPlan): RiskLevel {
  let hasWrite = false;
  for (const t of plan.tasks) {
    if (t.category === "destructive" || t.category === "runtime") return "high";
    if (t.category === "write") hasWrite = true;
  }
  return hasWrite ? "medium" : "low";
}

function isFolderType(type: string): boolean {
  return type.toLowerCase() === "folder";
}

interface ScaffoldRow {
  entry: ScaffoldEntry;
  depth: number;
  leaf: string;
  icon: string;
}

function buildScaffoldRows(scaffold: ScaffoldEntry[]): ScaffoldRow[] {
  // Roblox instance paths are dot-separated (e.g.
  // `ServerScriptService.Combat.HitDetection`). We render each scaffold
  // entry on its own row, indented by depth, showing the leaf name only.
  // Building a full nested tree is intentionally avoided — scaffolds
  // typically list only the leaves the assistant plans to create, and a
  // flat-with-indent rendering preserves the spec without inventing
  // intermediate nodes that aren't in the plan.
  return scaffold.map((entry) => {
    const segments = entry.path.split(".").filter(Boolean);
    const leaf = segments[segments.length - 1] ?? entry.path;
    const depth = Math.max(0, segments.length - 1);
    const icon = isFolderType(entry.type) ? "📁" : "📄";
    return { entry, depth, leaf, icon };
  });
}

export function PlanPreviewCard({
  plan,
  onApprove,
  onCancel,
  mode,
  className,
}: PlanPreviewCardProps) {
  const risk = useMemo(() => computeRisk(plan), [plan]);
  const riskMeta = RISK_META[risk];

  const scaffoldRows = useMemo(
    () => (plan.scaffold ? buildScaffoldRows(plan.scaffold) : []),
    [plan.scaffold],
  );

  const stats = useMemo(() => {
    let approvals = 0;
    let snapshots = 0;
    for (const t of plan.tasks) {
      if (t.requiresApproval) approvals++;
      if (t.requiresSnapshot) snapshots++;
    }
    return { steps: plan.tasks.length, approvals, snapshots };
  }, [plan.tasks]);

  const isPlanMode = mode === "plan";
  const approveLabel = isPlanMode ? "📋 Save Plan" : "✅ Approve Plan";

  return (
    <div
      role="region"
      aria-label={`Task plan: ${plan.title}`}
      className={cn(
        "rounded-xl border border-indigo-500/30 bg-[#0b0b13] p-4 text-slate-200 shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-white">
          <span aria-hidden="true">📋</span>
          <span>{plan.title}</span>
        </h3>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
            riskMeta.className,
          )}
          title={`Risk: ${riskMeta.label}`}
        >
          <span aria-hidden="true">{riskMeta.icon}</span>
          <span>{riskMeta.label}</span>
        </span>
      </div>

      {/* Summary */}
      <p className="mt-2 text-sm text-slate-400">{plan.summary}</p>

      {/* Scaffold */}
      {scaffoldRows.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Files to create:</div>
          <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-slate-300">
            {scaffoldRows.map((row, i) => (
              <li
                key={`${row.entry.path}-${i}`}
                style={{ paddingLeft: `${row.depth}rem` }}
                className="flex items-center gap-1.5"
                title={`${row.entry.path} (${row.entry.type})`}
              >
                <span aria-hidden="true">{row.icon}</span>
                <span className="truncate">{row.leaf}</span>
                <span className="text-slate-600">— {row.entry.type}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Tasks */}
      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Steps:</div>
        <ol className="mt-1.5 space-y-1.5">
          {plan.tasks.map((task, i) => {
            const cat = CATEGORY_META[task.category];
            return (
              <li
                key={task.id}
                className="flex items-start gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5"
              >
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    cat.className,
                  )}
                >
                  {cat.label}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="text-slate-500">{i + 1}.</span>{" "}
                  <span className="text-slate-200">{task.title}</span>
                  <span className="text-slate-500"> — </span>
                  <code className="text-xs text-slate-400">{task.tool}</code>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Stats */}
      <div className="mt-3 text-xs text-slate-500">
        Steps: {stats.steps} &nbsp;|&nbsp; Approvals: {stats.approvals} &nbsp;|&nbsp; Snapshots:{" "}
        {stats.snapshots}
      </div>

      {/* Buttons */}
      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onApprove}
          className="bg-indigo-500 text-white hover:bg-indigo-400"
        >
          {approveLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          ✕ Cancel
        </Button>
      </div>

      {/* Suggested next */}
      {plan.suggested_next && plan.suggested_next.length > 0 ? (
        <div className="mt-4 border-t border-white/5 pt-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Suggested next steps:
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {plan.suggested_next.map((s, i) => (
              <span
                key={`${s}-${i}`}
                className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-slate-300 ring-1 ring-white/10"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
