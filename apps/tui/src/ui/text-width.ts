/**
 * CJK-aware terminal text measurement and wrapping.
 *
 * Terminal cells are not 1:1 with JS string length: CJK ideographs and most
 * emoji occupy two columns, while combining marks and variation selectors
 * occupy zero. The chat viewport slices the transcript into exact visual rows,
 * so it must wrap using the same display width the terminal will actually use.
 * Doing the wrapping here (and emitting one pre-wrapped string per row) means
 * Ink never re-wraps, so the rendered row count equals the number of lines we
 * produce - which is what keeps scrolling stable.
 */

type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

type GraphemeSegmenterCtor = new (
  locales?: string | undefined,
  options?: { granularity?: string },
) => GraphemeSegmenter;

const segmenter: GraphemeSegmenter | null = createSegmenter();

function createSegmenter(): GraphemeSegmenter | null {
  const ctor = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
  if (typeof ctor !== "function") {
    return null;
  }
  try {
    return new ctor(undefined, { granularity: "grapheme" });
  } catch {
    return null;
  }
}

/** Split a string into grapheme clusters (falls back to code points). */
export function graphemes(input: string): string[] {
  if (input.length === 0) {
    return [];
  }
  const normalized = input.normalize("NFC");
  if (segmenter) {
    const result: string[] = [];
    for (const piece of segmenter.segment(normalized)) {
      result.push(piece.segment);
    }
    return result;
  }
  return Array.from(normalized);
}

/** Display width of a single grapheme cluster (0, 1, or 2 columns). */
export function graphemeWidth(segment: string): number {
  if (!segment) {
    return 0;
  }
  // ZWJ emoji sequences (e.g. family emoji) collapse to a single 2-wide glyph.
  if (segment.includes("\u200d")) {
    return 2;
  }
  let width = 0;
  for (const char of Array.from(segment)) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || isZeroWidthCodePoint(codePoint)) {
      continue;
    }
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return Math.max(0, Math.min(width, 2));
}

/** Total terminal display width of a string. */
export function textWidth(input: string): number {
  let width = 0;
  for (const segment of graphemes(input)) {
    width += graphemeWidth(segment);
  }
  return width;
}

/**
 * Wrap a single logical line to `width` display columns.
 *
 * Greedy and grapheme-safe: prefers to break at the last space that fits,
 * otherwise hard-breaks. Every returned chunk has display width <= width
 * (except a single grapheme that is itself wider than `width`, which is
 * unavoidable). Always returns at least one entry (possibly empty).
 */
export function wrapToWidth(text: string, width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  if (text.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  let lastSpaceIndex = -1;

  const pushCurrent = (value: string) => {
    lines.push(value);
  };

  for (const segment of graphemes(text)) {
    const segmentWidth = graphemeWidth(segment);

    if (currentWidth + segmentWidth > safeWidth && current.length > 0) {
      if (lastSpaceIndex >= 0 && lastSpaceIndex < current.length) {
        const head = current.slice(0, lastSpaceIndex);
        const tail = current.slice(lastSpaceIndex + 1);
        pushCurrent(head);
        current = tail;
        currentWidth = textWidth(tail);
      } else {
        pushCurrent(current);
        current = "";
        currentWidth = 0;
      }
      lastSpaceIndex = -1;
    }

    // Don't carry the breaking space to the start of a continuation line.
    if (segment === " " && current.length === 0 && lines.length > 0) {
      continue;
    }

    current += segment;
    currentWidth += segmentWidth;
    if (segment === " ") {
      lastSpaceIndex = current.length - 1;
    }
  }

  if (current.length > 0 || lines.length === 0) {
    pushCurrent(current);
  }

  return lines;
}

/**
 * Truncate a string to at most `width` display columns, appending an ellipsis
 * when content is dropped. The result is guaranteed to fit within `width`.
 */
export function truncateToWidth(text: string, width: number, ellipsis = "…"): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) {
    return "";
  }
  if (textWidth(text) <= safeWidth) {
    return text;
  }

  const ellipsisWidth = textWidth(ellipsis);
  const budget = Math.max(0, safeWidth - ellipsisWidth);
  let result = "";
  let used = 0;
  for (const segment of graphemes(text)) {
    const segmentWidth = graphemeWidth(segment);
    if (used + segmentWidth > budget) {
      break;
    }
    result += segment;
    used += segmentWidth;
  }
  return `${result}${ellipsis}`;
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    codePoint === 0x200d
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2329 && codePoint <= 0x232a) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );
}
