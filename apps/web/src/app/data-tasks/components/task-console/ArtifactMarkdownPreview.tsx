import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";

const markdownPreviewClass =
  "max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-sm leading-6 text-foreground [&_code]:rounded [&_code]:bg-surface-subtle [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-subtle [&_pre]:p-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5";

export function isMarkdownFilePath(path: string): boolean {
  return /\.(?:md|markdown|mdx)$/iu.test(path);
}

export function ArtifactMarkdownPreview({ content }: { content: string }) {
  return (
    <div className={markdownPreviewClass}>
      <CopilotChatAssistantMessage.MarkdownRenderer content={content} />
    </div>
  );
}
