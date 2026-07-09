import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";

/**
 * Streamdown (via CopilotKit MarkdownRenderer) ships `cpk:*` utilities that only
 * apply under `[data-copilotkit]`. Without that scope, long paragraphs do not wrap
 * and get clipped by the Outputs pane's overflow-x-hidden.
 */
const markdownTypographyClass =
  [
    "min-w-0 w-full max-w-full break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]",
    "[&_*]:max-w-full [&_p]:whitespace-normal [&_p]:break-words [&_li]:break-words",
    "[&_h1]:mb-2 [&_h1]:break-words [&_h1]:text-base [&_h1]:font-semibold",
    "[&_h2]:mb-2 [&_h2]:break-words [&_h2]:text-sm [&_h2]:font-semibold",
    "[&_h3]:mb-1 [&_h3]:break-words [&_h3]:text-sm [&_h3]:font-semibold",
    "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2",
    "[&_code]:rounded [&_code]:bg-surface-subtle [&_code]:px-1 [&_code]:break-words",
    "[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-subtle [&_pre]:p-2",
    "[&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto",
    "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  ].join(" ");

/** Card chrome + height cap — used for inline/embedded previews, not the peer page. */
const markdownChromeClass = "max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3";

export function isMarkdownFilePath(path: string): boolean {
  return /\.(?:md|markdown|mdx)$/iu.test(path);
}

/**
 * `bare` renders the markdown flush (no bordered box, no height cap) so a
 * dedicated peer page can use the full available height.
 */
export function ArtifactMarkdownPreview({
  content,
  bare = false,
}: {
  content: string;
  bare?: boolean;
}) {
  return (
    <div
      data-copilotkit
      className={bare ? markdownTypographyClass : `${markdownChromeClass} ${markdownTypographyClass}`}
    >
      <CopilotChatAssistantMessage.MarkdownRenderer
        content={content}
        className="cpk:prose cpk:max-w-full cpk:break-words cpk:dark:prose-invert"
      />
    </div>
  );
}
