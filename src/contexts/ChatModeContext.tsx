import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Chat modes supported by the assistant.
 *
 * - `plan`      — read-only planning, never executes write tools.
 * - `agent`     — plan + execute with explicit user approval (default).
 * - `auto_safe` — auto-approve read tools; writes still require approval.
 */
export type ChatMode = "plan" | "agent" | "auto_safe";

export const CHAT_MODES: ChatMode[] = ["plan", "agent", "auto_safe"];

const STORAGE_KEY = "chat_mode";
const DEFAULT_MODE: ChatMode = "agent";

interface ChatModeContextValue {
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
}

const ChatModeContext = createContext<ChatModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
});

function isChatMode(value: unknown): value is ChatMode {
  return typeof value === "string" && (CHAT_MODES as readonly string[]).includes(value);
}

function readStoredMode(): ChatMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isChatMode(raw)) return raw;
  } catch {
    // localStorage may be unavailable (SSR, sandboxed iframe, privacy mode).
  }
  return DEFAULT_MODE;
}

export function ChatModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ChatMode>(DEFAULT_MODE);

  // Hydrate from localStorage on mount. We start with DEFAULT_MODE on the
  // server / first paint to keep SSR markup stable, then sync once the
  // client mounts.
  useEffect(() => {
    const stored = readStoredMode();
    if (stored !== mode) setModeState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist + cross-tab sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore quota / privacy errors — context still works in-memory.
    }
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (isChatMode(e.newValue)) {
        setModeState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMode = useCallback((next: ChatMode) => {
    if (!isChatMode(next)) return;
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ChatModeContext.Provider value={value}>{children}</ChatModeContext.Provider>;
}

export function useChatMode(): ChatModeContextValue {
  return useContext(ChatModeContext);
}
