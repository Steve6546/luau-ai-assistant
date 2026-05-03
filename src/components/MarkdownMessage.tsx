import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

function isArabic(text: string) {
  return /[\u0600-\u06FF]/.test(text);
}

export function MarkdownMessage({ content }: { content: string }) {
  const dir = isArabic(content) ? "rtl" : "ltr";
  return (
    <div dir={dir} className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-pre:my-2 prose-pre:bg-transparent prose-pre:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match?.[1] || "";
            if (!inline && (match || (children + "").includes("\n"))) {
              return (
                <div className="rounded-lg overflow-hidden my-2 border border-border bg-[#1e1e1e]">
                  {lang && <div className="text-xs text-muted-foreground px-3 py-1 border-b border-border bg-card/50">{lang}</div>}
                  <SyntaxHighlighter
                    language={lang === "luau" ? "lua" : lang || "lua"}
                    style={oneDark}
                    PreTag="div"
                    customStyle={{ margin: 0, background: "transparent", padding: "0.75rem" }}
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}