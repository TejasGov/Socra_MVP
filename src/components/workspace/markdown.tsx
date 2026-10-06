import ReactMarkdown from "react-markdown";

/**
 * Markdown renderer for assignment prompts and Socra turns. Raw HTML is not rendered (react-markdown default).
 * `noCopyCode` disables selection on code blocks (Socra snippets in graded contexts, DESIGN_GUARDRAILS §5.8).
 */
export function Markdown({
  children,
  noCopyCode = false,
  className = "",
}: {
  children: string;
  noCopyCode?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[
        "text-fg text-sm",
        "[&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
        "[&_code]:font-mono [&_code]:text-[13px]",
        "[&_:not(pre)>code]:bg-surface-2 [&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px",
        "[&_pre]:border-border [&_pre]:bg-surface-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:p-3 [&_pre]:leading-5",
        noCopyCode ? "[&_pre]:select-none" : "",
        "[&_blockquote]:border-border-strong [&_blockquote]:text-fg-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
        "[&_td]:border-border [&_th]:border-border [&_th]:bg-surface-2 [&_table]:my-2 [&_table]:text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        className,
      ].join(" ")}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
