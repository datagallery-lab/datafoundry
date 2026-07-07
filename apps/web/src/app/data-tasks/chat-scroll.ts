function isScrollableOverflow(overflowY: string): boolean {
  return overflowY === "auto" || overflowY === "scroll";
}

function readOverflowY(element: HTMLElement): string {
  const inlineOverflowY = element.style?.overflowY;
  if (inlineOverflowY) {
    return inlineOverflowY;
  }
  if (typeof getComputedStyle === "function") {
    return getComputedStyle(element).overflowY;
  }
  return "";
}

function isRendered(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.style?.display === "none") {
      return false;
    }
    if (typeof getComputedStyle === "function") {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
    }
    current = current.parentElement;
  }
  return true;
}

function findScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  let fallback: HTMLElement | null = null;
  while (current) {
    if (isScrollableOverflow(readOverflowY(current))) {
      fallback ??= current;
      if (current.scrollHeight > current.clientHeight) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return fallback;
}

export function findCopilotChatScrollContainer(
  root: ParentNode = document,
): HTMLElement | null {
  const contents = root.querySelectorAll('[data-testid="copilot-scroll-content"]');
  for (const content of contents) {
    if (typeof content !== "object" || !("parentElement" in content)) {
      continue;
    }
    const element = content as HTMLElement;
    if (!isRendered(element)) {
      continue;
    }
    const scrollContainer = findScrollableAncestor(element);
    if (scrollContainer) {
      return scrollContainer;
    }
  }

  return null;
}

export function scrollCopilotChatToBottom(
  root: ParentNode = document,
  behavior: ScrollBehavior = "auto",
): boolean {
  const container = findCopilotChatScrollContainer(root);
  if (!container) {
    return false;
  }

  const previousScrollBehavior = container.style.scrollBehavior;
  if (behavior === "auto") {
    container.style.scrollBehavior = "auto";
  }
  container.scrollTop = container.scrollHeight;
  container.scrollTo({
    top: container.scrollHeight,
    behavior,
  });
  if (behavior === "auto") {
    container.style.scrollBehavior = previousScrollBehavior;
  }
  return true;
}

export function scrollCopilotChatToBottomWithRetries(input?: {
  root?: ParentNode;
  attempts?: number;
  intervalMs?: number;
  schedule?: (callback: () => void) => void;
  delay?: (callback: () => void, intervalMs: number) => number;
}): () => void {
  const {
    root = document,
    attempts = 8,
    intervalMs = 50,
    schedule = (callback) => requestAnimationFrame(callback),
    delay = (callback, waitMs) => window.setTimeout(callback, waitMs),
  } = input ?? {};

  let cancelled = false;
  let attempt = 0;

  const tick = () => {
    if (cancelled) {
      return;
    }
    scrollCopilotChatToBottom(root, "auto");
    attempt += 1;
    if (attempt < attempts) {
      delay(tick, intervalMs);
    }
  };

  schedule(tick);

  return () => {
    cancelled = true;
  };
}
