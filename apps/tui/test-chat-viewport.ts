#!/usr/bin/env node
/**
 * Verify the line-based chat viewport:
 * - text measurement is CJK-aware (wide chars count as two columns),
 * - row counts are exact (so they match what Ink renders),
 * - the scroll window is a deterministic, stable slice (no overlap/garble).
 *
 * Run after `npm run build` with: `npx tsx test-chat-viewport.ts`.
 */
import { buildChatLines, countChatLines, chatContentWidth } from './dist/ui/transcript-lines.js';
import { textWidth, wrapToWidth, truncateToWidth } from './dist/ui/text-width.js';
import { chatViewportRows } from './dist/ui/workspace-layout.js';
import type { DisplayMessage } from './dist/state/index.js';

let failures = 0;
function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`✓ ${message}`);
  } else {
    failures += 1;
    console.error(`✗ ${message}`);
  }
}

function eq<T>(actual: T, expected: T): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function textMessage(id: string, content: string): DisplayMessage {
  return {
    id,
    role: 'assistant',
    timestamp: Date.now(),
    isStreaming: false,
    elements: [{ type: 'text', content, timestamp: Date.now() }],
  };
}

// --- text width ---
check(textWidth('abc') === 3, 'ASCII width is 1 per char');
check(textWidth('中文') === 4, 'CJK width is 2 per char');
check(textWidth('a中b') === 4, 'mixed CJK/ASCII width adds up');
check(textWidth('e\u0301') === 1, 'combining mark is zero width');
check(textWidth('🌐') === 2, 'emoji width is 2');

// --- wrapping ---
check(eq(wrapToWidth('aaaa', 2), ['aa', 'aa']), 'wrap hard-breaks ASCII at width');
check(eq(wrapToWidth('中中中', 4), ['中中', '中']), 'wrap respects CJK display width');
check(eq(wrapToWidth('hello world', 5), ['hello', 'world']), 'wrap breaks at spaces with no empty rows');
check(wrapToWidth('', 10).length === 1, 'empty line still yields one row');
check(textWidth(truncateToWidth('中文测试内容很长', 5)) <= 5, 'truncate fits within width');

// --- layout constants (unchanged) ---
check(chatContentWidth(120) === 116, 'content width is columns - 4');
check(chatViewportRows(40, { commandNotice: false, activeTab: 'chat' }) === 36, 'chat viewport for 40 rows is 36');
check(chatViewportRows(40, { commandNotice: true, activeTab: 'chat' }) === 35, 'chat viewport with notice is 35');

// --- exact line counts ---
const columns = 120;
check(
  countChatLines({ messages: [textMessage('m1', 'hello')], artifacts: [], columns }) === 3,
  'short message = header + 1 line + trailing blank (3 rows)',
);

// bodyWidth = 116 - 2 = 114 -> 57 CJK chars per row -> 60 chars wrap to 2 rows.
check(
  countChatLines({ messages: [textMessage('m2', '中'.repeat(60))], artifacts: [], columns }) === 4,
  '60 CJK chars wrap to 2 rows (header + 2 + blank = 4)',
);

// The previous length-based estimate would have counted this as a single row,
// which is exactly the drift that garbled scrolling. Guard against regressing.
check(
  countChatLines({ messages: [textMessage('m3', '中'.repeat(60))], artifacts: [], columns }) >
    countChatLines({ messages: [textMessage('m3b', 'x'.repeat(60))], artifacts: [], columns }),
  'CJK content is taller than equal-length ASCII content',
);

// --- deterministic, stable slicing ---
const manyMessages: DisplayMessage[] = Array.from({ length: 8 }, (_, index) =>
  textMessage(`mm${index}`, `line ${index}`),
);
const lines = buildChatLines({ messages: manyMessages, artifacts: [], columns });
const total = lines.length;
const viewport = 5;

function windowKeys(scrollback: number): string[] {
  const maxScroll = Math.max(0, total - viewport);
  const safe = Math.max(0, Math.min(scrollback, maxScroll));
  const top = Math.max(0, total - viewport - safe);
  return lines.slice(top, top + viewport).map((line) => line.key);
}

check(windowKeys(0).length === viewport, 'bottom window fills the viewport');
check(eq(windowKeys(0), lines.slice(total - viewport).map((line) => line.key)), 'scrollback 0 shows the newest rows');
check(
  eq(windowKeys(3), lines.slice(total - viewport - 3, total - 3).map((line) => line.key)),
  'scrollback 3 is an exact shifted slice',
);
check(new Set(lines.map((line) => line.key)).size === total, 'all line keys are unique (no duplicate rows)');

console.log();
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ all chat viewport checks passed');
