type MessageLike = {
  id?: string;
  role?: string;
  content?: unknown;
};

export function messageTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("type" in part)) return "";
      const typed = part as { type?: unknown; text?: unknown };
      if (typed.type === "text" && typeof typed.text === "string") return typed.text;
      return "";
    })
    .join("")
    .trim();
}

/** Some thinking models emit the same block twice in one assistant message. */
export function dedupeRepeatedText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length % 2 !== 0) return trimmed;

  const half = trimmed.length / 2;
  if (trimmed.slice(0, half) === trimmed.slice(half)) {
    return trimmed.slice(0, half);
  }

  return trimmed;
}

export function resolveAssistantThoughtContent(
  message: MessageLike,
  messages: MessageLike[],
): string {
  const assistantText = messageTextContent(message.content);
  const messageIndex = messages.findIndex((item) => item.id === message.id);

  const reasoningTexts: string[] = [];
  if (messageIndex > 0) {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (item?.role === "reasoning") {
        const text = messageTextContent(item.content);
        if (text) reasoningTexts.unshift(text);
        continue;
      }
      if (item?.role === "assistant" || item?.role === "user") break;
    }
  }

  const reasoningText = reasoningTexts.join("\n\n").trim();
  if (reasoningText) return reasoningText;

  return dedupeRepeatedText(assistantText);
}
