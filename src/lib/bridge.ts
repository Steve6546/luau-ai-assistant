/**
 * Legacy bridge API — now a thin compatibility shim over the central
 * `bridgeClient` (src/services/bridgeClient.ts). Existing call sites
 * (`bridge.send`, `bridge.onPush`, `useBridge`) continue to work, but
 * every WebSocket frame goes through ONE shared connection.
 *
 * Also re-exports the MCP tool catalog from src/lib/mcp-tools so older
 * imports keep working.
 */
import { useSyncExternalStore } from "react";
import {
  bridgeClient,
  DEFAULT_BRIDGE_URL as CLIENT_DEFAULT_URL,
  type BridgeEnvelope,
  type StudioLogEvent,
  type HeartbeatEvent,
} from "@/services/bridgeClient";

export {
  MCP_TOOL_ALLOWLIST,
  isAllowedTool,
  PUBLIC_MCP_TOOLS,
  INFRA_TOOLS,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  TEST_TOOLS,
  TOOL_DESCRIPTIONS,
  type McpTool,
} from "@/lib/mcp-tools";
import { isAllowedTool } from "@/lib/mcp-tools";

export const DEFAULT_BRIDGE_URL = CLIENT_DEFAULT_URL;

export function getBridgeUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BRIDGE_URL;
  return localStorage.getItem("bridge_url") || DEFAULT_BRIDGE_URL;
}

export function setBridgeUrl(url: string) {
  if (typeof window !== "undefined") localStorage.setItem("bridge_url", url);
  try {
    bridgeClient.disconnect();
    bridgeClient.connect().catch(() => {});
  } catch {
    /* defensive */
  }
}

export type BridgeStatus = "connected" | "reconnecting" | "disconnected";

export interface BridgeMessage {
  requestId: string;
  tool: string;
  name?: string;
  code?: string;
  arguments?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
  requestId: string;
  status?: "ok" | "error";
  output?: unknown;
  error?: string;
  result?: unknown;
  mcp?: string;
  studio?: string;
}

export interface BridgePushEvent {
  type?: string;
  event?: string;
  level?: string;
  message?: string;
  text?: string;
  source?: string;
  [k: string]: unknown;
}

interface State {
  status: BridgeStatus;
  latency: number | null;
}

class LegacyBridge {
  private listeners = new Set<() => void>();
  private pushListeners = new Set<(ev: BridgePushEvent) => void>();
  private state: State = { status: "disconnected", latency: null };
  private started = false;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    // Map central client lifecycle → legacy state.
    bridgeClient.subscribeLifecycle((ev) => {
      if (ev === "connected" || ev === "reconnected") {
        this.setState({ status: "connected" });
      } else if (ev === "connecting" || ev === "reconnecting") {
        this.setState({ status: "reconnecting" });
      } else {
        this.setState({ status: "disconnected", latency: null });
      }
    });

    bridgeClient.subscribeStudioLog((ev: StudioLogEvent) => {
      this.pushListeners.forEach((l) => {
        try {
          l({
            type: "studio_log",
            level: ev.level,
            message: ev.message,
            source: ev.source,
            ...ev,
          });
        } catch {
          /* listener errors swallowed */
        }
      });
    });

    bridgeClient.subscribeHeartbeat((ev: HeartbeatEvent) => {
      this.pushListeners.forEach((l) => {
        try {
          l({ type: "heartbeat", ...ev });
        } catch {
          /* swallow */
        }
      });
    });

    bridgeClient.connect().catch(() => {
      /* lifecycle handler will reflect failure */
    });
    if (bridgeClient.isConnected()) this.setState({ status: "connected" });
  }

  reconnect() {
    bridgeClient.disconnect();
    bridgeClient.connect().catch(() => {});
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  onPush = (cb: (ev: BridgePushEvent) => void): (() => void) => {
    this.pushListeners.add(cb);
    return () => {
      this.pushListeners.delete(cb);
    };
  };

  getSnapshot = () => this.state;

  private setState(next: Partial<State>) {
    const merged = { ...this.state, ...next };
    if (merged.status === this.state.status && merged.latency === this.state.latency) return;
    this.state = merged;
    this.listeners.forEach((l) => l());
  }

  async send(
    msg: BridgeMessage,
    _timeoutMs?: number,
  ): Promise<BridgeResponse & { durationMs: number }> {
    if (msg.tool === "call_tool" && (!msg.name || !isAllowedTool(msg.name))) {
      throw new Error(`Tool '${msg.name}' is not in the MCP allowlist`);
    }
    const extra: Record<string, unknown> = {};
    if (msg.name !== undefined) extra.name = msg.name;
    if (msg.arguments !== undefined) extra.arguments = msg.arguments;
    if (msg.code !== undefined) extra.code = msg.code;
    if (msg.params !== undefined) extra.params = msg.params;

    const env: BridgeEnvelope = await bridgeClient.send(msg.tool, extra);

    // Update latency from the most recent round-trip.
    if (typeof env.durationMs === "number") {
      this.setState({ latency: Math.round(env.durationMs) });
    }

    return {
      requestId: env.requestId,
      status: env.status === "success" ? "ok" : "error",
      output: env.output,
      error: env.error ?? undefined,
      result: env.output,
      durationMs: env.durationMs ?? 0,
    };
  }
}

export const bridge = new LegacyBridge();
if (typeof window !== "undefined") bridge.start();

export function useBridge() {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
  return {
    status: state.status,
    latency: state.latency,
    send: bridge.send.bind(bridge),
    reconnect: () => bridge.reconnect(),
  };
}
