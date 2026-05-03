/**
 * Roblox Studio MCP bridge over WebSocket.
 * Default to remote Cloudflare tunnel; configurable via localStorage.
 */
import { useEffect, useRef, useState, useCallback } from "react";

export const DEFAULT_BRIDGE_URL =
  "wss://martial-trembl-coupon-demonstrated.trycloudflare.com?token=test-token-roblox";

export function getBridgeUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BRIDGE_URL;
  return localStorage.getItem("bridge_url") || DEFAULT_BRIDGE_URL;
}

export function setBridgeUrl(url: string) {
  localStorage.setItem("bridge_url", url);
}

export type BridgeStatus = "connected" | "bridge-only" | "offline";

interface PendingResolver {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  startedAt: number;
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
}

export function useBridge() {
  const [status, setStatus] = useState<BridgeStatus>("offline");
  const [latency, setLatency] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingResolver>>(new Map());

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const url = getBridgeUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        setStatus("bridge-only");
        // ping to determine if Studio is connected
        const id = `ping-${Date.now()}`;
        const start = performance.now();
        const handler = (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data);
            if (data.requestId === id) {
              setLatency(Math.round(performance.now() - start));
              setStatus(data.error ? "bridge-only" : "connected");
              ws.removeEventListener("message", handler);
            }
          } catch {}
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ requestId: id, tool: "ping" }));
      };
      ws.onmessage = (ev) => {
        try {
          const data: BridgeResponse = JSON.parse(ev.data);
          const p = pendingRef.current.get(data.requestId);
          if (p) {
            pendingRef.current.delete(data.requestId);
            p.resolve(data);
          }
        } catch (e) {
          console.error("bridge parse error", e);
        }
      };
      ws.onclose = () => { setStatus("offline"); };
      ws.onerror = () => { setStatus("offline"); };
    } catch (e) {
      console.error("bridge connect failed", e);
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  const send = useCallback((msg: BridgeMessage, timeoutMs = 30000): Promise<BridgeResponse & { durationMs: number }> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Bridge not connected"));
        return;
      }
      const startedAt = performance.now();
      pendingRef.current.set(msg.requestId, {
        resolve: (v: BridgeResponse) => resolve({ ...v, durationMs: Math.round(performance.now() - startedAt) }),
        reject,
        startedAt,
      });
      ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (pendingRef.current.has(msg.requestId)) {
          pendingRef.current.delete(msg.requestId);
          reject(new Error("Bridge request timed out"));
        }
      }, timeoutMs);
    });
  }, []);

  return { status, latency, send, reconnect: connect };
}