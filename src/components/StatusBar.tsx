/**
 * Persistent 28px status bar mounted at the bottom of the app shell.
 *
 * Talks to the central bridge client only — never opens its own WebSocket.
 * Shows: bridge connection · studio session · tool count · latency
 * Right side: AI provider/model placeholder · current mode placeholder.
 *
 * The "Gemini Flash" and "Agent Mode" labels are placeholders until Phase 2
 * adds the Mode Selector and AI provider context.
 */
import { useEffect, useRef, useState } from "react";
import { bridgeClient, type BridgeEnvelope, type HeartbeatEvent } from "@/services/bridgeClient";

type ConnState = "connected" | "disconnected" | "reconnecting";

interface DeepHealth {
  bridgeVersion: string;
  bridgeOk: boolean;
  studioOk: boolean;
  studioName: string | null;
  toolsCount: number | null;
  mcpOk: boolean;
  latencyMs: number | null;
}

const REFRESH_INTERVAL_MS = 30_000;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickBool(o: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.toLowerCase();
      if (
        s === "ok" ||
        s === "online" ||
        s === "ready" ||
        s === "connected" ||
        s === "loaded" ||
        s === "true"
      ) {
        return true;
      }
      if (
        s === "down" ||
        s === "offline" ||
        s === "false" ||
        s === "missing" ||
        s === "unavailable" ||
        s === "disconnected"
      ) {
        return false;
      }
    }
  }
  return null;
}

function pickNum(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function parseDeepHealth(env: BridgeEnvelope): DeepHealth {
  const out = isObject(env.output) ? env.output : {};
  const bridgeBlock = isObject(out.bridge) ? out.bridge : out;
  const studioBlock = isObject(out.studio) ? out.studio : out;
  const mcpBlock = isObject(out.mcp) ? out.mcp : out;
  const toolsBlock = isObject(out.tools) ? out.tools : out;

  const toolsArrayLen = Array.isArray(out.tools) ? (out.tools as unknown[]).length : null;
  const toolsCount =
    pickNum(toolsBlock, "count", "loaded") ??
    toolsArrayLen ??
    pickNum(out, "tools_count", "toolsCount");

  return {
    bridgeVersion: env.bridgeVersion || (pickStr(out, "bridgeVersion") ?? ""),
    bridgeOk: env.status === "success" && (pickBool(bridgeBlock, "status", "ok", "online") ?? true),
    studioOk: pickBool(studioBlock, "status", "connected", "online") ?? false,
    studioName:
      pickStr(studioBlock, "name", "place", "title") ?? pickStr(out, "studio_name", "studioName"),
    toolsCount,
    mcpOk: pickBool(mcpBlock, "status", "ready", "ok") ?? false,
    latencyMs: pickNum(out, "latency_ms", "latencyMs", "latency") ?? env.durationMs,
  };
}

export function StatusBar() {
  const [state, setState] = useState<ConnState>("disconnected");
  const [health, setHealth] = useState<DeepHealth | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (!bridgeClient.isConnected()) return;
      try {
        const env = await bridgeClient.healthDeep();
        if (cancelled) return;
        setHealth(parseDeepHealth(env));
      } catch {
        // Keep last known health values during temporary disconnects.
      }
    };

    const offLifecycle = bridgeClient.subscribeLifecycle((ev) => {
      if (ev === "connected" || ev === "reconnected") {
        setState("connected");
        refresh();
      } else if (ev === "reconnecting") {
        setState("reconnecting");
      } else if (ev === "disconnected") {
        setState("disconnected");
      }
    });

    const offHeartbeat = bridgeClient.subscribeHeartbeat((hb: HeartbeatEvent) => {
      // Heartbeats keep the studio name fresh between health refreshes.
      if (typeof hb.studio === "string" && hb.studio) {
        const studioName = hb.studio;
        setHealth((prev) => (prev ? { ...prev, studioName, studioOk: true } : prev));
      }
    });

    bridgeClient.connect().catch(() => {
      // Lifecycle listener handles state transitions.
    });
    if (bridgeClient.isConnected()) setState("connected");

    refresh();
    refreshTimer.current = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      offLifecycle();
      offHeartbeat();
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, []);

  const bridgeVersion = health?.bridgeVersion?.trim() || "0.3.0";
  const bridgeLabel =
    state === "connected"
      ? `🟢 Bridge v${bridgeVersion}`
      : state === "reconnecting"
        ? "🟡 Reconnecting..."
        : "🔴 Bridge Offline";

  const studioLabel =
    state === "connected" && health?.studioOk
      ? `🟢 Studio: ${health.studioName ?? "Connected"}`
      : "🔴 Studio: Offline";

  const toolsLabel = health?.toolsCount != null ? `Tools: ${health.toolsCount}` : "Tools: —";

  const latencyLabel = health?.latencyMs != null ? `${Math.round(health.latencyMs)}ms` : "—";

  return (
    <div
      role="status"
      aria-label="Bridge status"
      className="fixed bottom-0 left-0 right-0 z-50 flex h-7 select-none items-center justify-between gap-3 px-3 text-[11px] text-slate-400"
      style={{
        background: "#0a0a0a",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 truncate">
        <span title="Bridge connection status">{bridgeLabel}</span>
        <span className="text-slate-700">·</span>
        <span title="Roblox Studio session" className="truncate">
          {studioLabel}
        </span>
        <span className="text-slate-700">·</span>
        <span title="Tool registry">{toolsLabel}</span>
        <span className="text-slate-700">·</span>
        <span title="Latency">{latencyLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span title="Active AI provider/model (placeholder)">Gemini Flash</span>
        <span className="text-slate-700">·</span>
        <span title="Active mode (placeholder until Phase 2)">Agent Mode</span>
      </div>
    </div>
  );
}
