import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, X, FileCode } from "lucide-react";

interface Props {
  scriptPath: string;
  originalContent: string;
  newContent: string;
  onApprove: () => void;
  onCancel: () => void;
  busy?: boolean;
}

type Row =
  | { kind: "ctx"; ln: number; text: string }
  | { kind: "del"; ln: number; text: string }
  | { kind: "add"; ln: number; text: string };

/** Tiny LCS-based line diff (good enough for short scripts). */
function diffLines(a: string[], b: string[]): Row[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: Row[] = [];
  let i = 0, j = 0, lnA = 1, lnB = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ kind: "ctx", ln: lnB, text: a[i] }); i++; j++; lnA++; lnB++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ kind: "del", ln: lnA, text: a[i] }); i++; lnA++; }
    else { rows.push({ kind: "add", ln: lnB, text: b[j] }); j++; lnB++; }
  }
  while (i < n) { rows.push({ kind: "del", ln: lnA, text: a[i] }); i++; lnA++; }
  while (j < m) { rows.push({ kind: "add", ln: lnB, text: b[j] }); j++; lnB++; }
  return rows;
}

export function ScriptDiffViewer({ scriptPath, originalContent, newContent, onApprove, onCancel, busy }: Props) {
  const rows = useMemo(
    () => diffLines(originalContent.split("\n"), newContent.split("\n")),
    [originalContent, newContent]
  );
  const adds = rows.filter((r) => r.kind === "add").length;
  const dels = rows.filter((r) => r.kind === "del").length;

  return (
    <Card className="overflow-hidden border-border bg-background/40">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/60">
        <FileCode className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium truncate flex-1" title={scriptPath}>{scriptPath}</span>
        <span className="text-[10px] font-mono text-emerald-400">+{adds}</span>
        <span className="text-[10px] font-mono text-red-400">-{dels}</span>
      </div>
      <div className="max-h-72 overflow-auto font-mono text-[11px]">
        {rows.map((r, idx) => {
          const bg = r.kind === "del"
            ? "bg-red-500/10"
            : r.kind === "add"
            ? "bg-emerald-500/10"
            : "";
          const prefix = r.kind === "del" ? "-" : r.kind === "add" ? "+" : " ";
          const prefixColor = r.kind === "del" ? "text-red-400" : r.kind === "add" ? "text-emerald-400" : "text-muted-foreground";
          return (
            <div key={idx} className={`flex ${bg}`}>
              <span className="w-10 text-right pr-2 text-muted-foreground select-none shrink-0">{r.ln}</span>
              <span className={`w-4 text-center shrink-0 ${prefixColor}`}>{prefix}</span>
              <pre className="flex-1 whitespace-pre-wrap break-all pr-2">{r.text}</pre>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border bg-card/60">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy} className="h-7 text-xs">
          <X className="w-3 h-3 mr-1" /> Cancel
        </Button>
        <Button size="sm" onClick={onApprove} disabled={busy} className="h-7 text-xs">
          <Check className="w-3 h-3 mr-1" /> Apply
        </Button>
      </div>
    </Card>
  );
}