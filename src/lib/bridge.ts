/**
 * Roblox Studio MCP bridge over WebSocket.
 * Singleton connection with auto-reconnect (exponential backoff),
 * 5s heartbeat ping, latency tracking, request timeouts, and a
 * tool allowlist enforced before any send().
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export const DEFAULT_BRIDGE_URL =
  "wss://martial-trembl-coupon-demonstrated.trycloudflare.com?token=test-token-roblox";

export function getBridgeUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BRIDGE_URL;
  return localStorage.getItem("bridge_url") || DEFAULT_BRIDGE_URL;
}

export function setBridgeUrl(url: string) {
  localStorage.setItem("bridge_url", url);
  bridge.reconnect();
}

export type BridgeStatus = "connected" | "reconnecting" | "disconnected";

/** Whitelisted MCP tool names that may be invoked via call_tool. */
export const MCP_TOOL_ALLOWLIST = [
  "execute_luau",
  "script_read",
  "multi_edit",
  "search_game_tree",
  "inspect_instance",
  "start_stop_play",
  "screen_capture",
  "list_roblox_studios",
  "snapshot",
  "batch_execute",
  "watch_console",
  "run_code",
  "set_property",
  "get_hierarchy",
  "get_scripts",
  "insert_instance",
  "delete_instance",
  "rename_instance",
  "move_instance",
  "studio_log",
] as const;
export type McpTool = (typeof MCP_TOOL_ALLOWLIST)[number];

export function isAllowedTool(name: string): name is McpTool {
  return (MCP_TOOL_ALLOWLIST as readonly string[]).includes(name);
}

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

interface State {
  status: BridgeStatus;
  latency: number | null;
}

interface Pending {
  resolve: (v: BridgeResponse & { durationMs: number }) => void;
  reject: (e: Error) => void;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Unsolicited push event from bridge (e.g. studio_log stream). */
export interface BridgePushEvent {
  type?: string;
  event?: string;
  level?: string;
  message?: string;
  text?: string;
  source?: string;
  [k: string]: unknown;
}

class BridgeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private pushListeners = new Set<(ev: BridgePushEvent) => void>();
  private state: State = { status: "disconnected", latency: null };
  private pending = new Map<string, Pending>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private started = false;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.connect();
  }

  reconnect() {
    this.cleanup();
    this.reconnectAttempt = 0;
    this.connect();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  /** Subscribe to unsolicited push events (studio_log, console, etc.). */
  onPush = (cb: (ev: BridgePushEvent) => void): (() => void) => {
    this.pushListeners.add(cb);
    return () => { this.pushListeners.delete(cb); };
  };

  getSnapshot = () => this.state;

  private setState(next: Partial<State>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  private cleanup() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    if (this.ws) {
      try { this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null; this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    this.setState({ status: "reconnecting" });
    const delay = Math.min(30000, 500 * Math.pow(2, this.reconnectAttempt++));
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private connect() {
    this.cleanup();
    this.setState({ status: "reconnecting" });
    let ws: WebSocket;
    try { ws = new WebSocket(getBridgeUrl()); }
    catch { this.setState({ status: "disconnected" }); this.scheduleReconnect(); return; }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.lastPongAt = Date.now();
      this.ping();
      // Subscribe to live studio logs (best-effort; ignored if unsupported)
      try {
        ws.send(JSON.stringify({
          requestId: "studio_log_subscribe",
          tool: "call_tool",
          name: "studio_log",
          arguments: { subscribe: true, stream: true },
        }));
      } catch {}
      this.heartbeat = setInterval(() => {
        // missed pong watchdog
        if (Date.now() - this.lastPongAt > 12000) {
          this.setState({ status: "reconnecting", latency: null });
          ws.close();
          return;
        }
        this.ping();
      }, 5000);
    };
    ws.onmessage = (ev) => {
      let data: BridgeResponse;
      try { data = JSON.parse(ev.data); } catch { return; }
      const p = this.pending.get(data.requestId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(data.requestId);
        p.resolve({ ...data, durationMs: Math.round(performance.now() - p.startedAt) });
        return;
      }
      if (data.requestId === "ping") {
        this.lastPongAt = Date.now();
        const studioOk = !data.studio || data.studio === "connected";
        const mcpOk = !data.mcp || data.mcp === "ready";
        this.setState({ status: studioOk && mcpOk ? "connected" : "reconnecting" });
        return;
      }
      // Treat as push event (studio_log, console, etc.)
      const evt = data as unknown as BridgePushEvent;
      this.pushListeners.forEach((l) => { try { l(evt); } catch {} });
    };
    ws.onclose = () => { this.setState({ status: "disconnected", latency: null }); this.failPending("connection closed"); this.scheduleReconnect(); };
    ws.onerror = () => { this.setState({ status: "disconnected" }); };
  }

  private failPending(reason: string) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
  }

  private pingStart = 0;
  private ping() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pingStart = performance.now();
    try {
      this.ws.send(JSON.stringify({ requestId: "ping", tool: "ping" }));
      // latency updated on response
      const start = this.pingStart;
      const onMsg = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.requestId === "ping") {
            this.setState({ latency: Math.round(performance.now() - start) });
            this.ws?.removeEventListener("message", onMsg);
          }
        } catch {}
      };
      this.ws.addEventListener("message", onMsg);
    } catch {}
  }

  send(msg: BridgeMessage, timeoutMs = 30000): Promise<BridgeResponse & { durationMs: number }> {
    return new Promise((resolve, reject) => {
      // Enforce allowlist for call_tool
      if (msg.tool === "call_tool" && (!msg.name || !isAllowedTool(msg.name))) {
        reject(new Error(`Tool '${msg.name}' is not in the MCP allowlist`));
        return;
      }
      if (this.state.status !== "connected") {
        reject(new Error("Bridge not connected"));
        return;
      }
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Bridge socket not open"));
        return;
      }
      const startedAt = performance.now();
      const timer = setTimeout(() => {
        if (this.pending.has(msg.requestId)) {
          this.pending.delete(msg.requestId);
          reject(new Error("Bridge request timed out"));
        }
      }, timeoutMs);
      this.pending.set(msg.requestId, { resolve, reject, startedAt, timer });
      try { ws.send(JSON.stringify(msg)); }
      catch (e) { clearTimeout(timer); this.pending.delete(msg.requestId); reject(e as Error); }
    });
  }
}

export const bridge = new BridgeClient();
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

// keep useEffect/useState used (avoid unused import warnings if tree-shaken)
void useEffect; void useState;