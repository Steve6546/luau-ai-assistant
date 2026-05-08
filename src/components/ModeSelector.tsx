import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHAT_MODES, useChatMode, type ChatMode } from "@/contexts/ChatModeContext";

interface ModeMeta {
  value: ChatMode;
  icon: string;
  label: string;
  description: string;
}

const MODES: ModeMeta[] = [
  {
    value: "plan",
    icon: "📋",
    label: "Plan",
    description: "Read-only planning, no writes",
  },
  {
    value: "agent",
    icon: "🤖",
    label: "Agent",
    description: "Plan + execute with approval",
  },
  {
    value: "auto_safe",
    icon: "🛡️",
    label: "Auto Safe",
    description: "Auto-read, manual approve writes",
  },
];

const MODE_BY_VALUE: Record<ChatMode, ModeMeta> = MODES.reduce(
  (acc, m) => {
    acc[m.value] = m;
    return acc;
  },
  {} as Record<ChatMode, ModeMeta>,
);

export interface ModeSelectorProps {
  className?: string;
}

/**
 * Compact dropdown that shows and switches the current chat mode.
 *
 * Designed to sit next to the chat input — visually small and dark — but
 * can be dropped anywhere that has access to `ChatModeProvider`. This
 * component is intentionally not yet mounted in the chat input; that
 * integration ships in a later step.
 */
export function ModeSelector({ className }: ModeSelectorProps) {
  const { mode, setMode } = useChatMode();
  const current = MODE_BY_VALUE[mode] ?? MODE_BY_VALUE.agent;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Chat mode: ${current.label}`}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-[#0a0a0a] px-2.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <span aria-hidden="true">{current.icon}</span>
          <span>{current.label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[12rem]">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(next) => {
            // Radix's onValueChange signature is (value: string), so guard
            // before narrowing back to ChatMode.
            if ((CHAT_MODES as readonly string[]).includes(next)) {
              setMode(next as ChatMode);
            }
          }}
        >
          {MODES.map((m) => (
            <DropdownMenuRadioItem
              key={m.value}
              value={m.value}
              className="flex flex-col items-start gap-0.5 pl-8"
            >
              <span className="flex items-center gap-2 text-sm">
                <span aria-hidden="true">{m.icon}</span>
                <span>{m.label}</span>
              </span>
              <span className="text-xs text-muted-foreground">{m.description}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
