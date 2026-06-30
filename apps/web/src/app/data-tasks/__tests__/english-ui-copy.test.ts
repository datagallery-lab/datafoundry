import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dataTasksRoot = join(process.cwd(), "src/app/data-tasks");

const runtimeFiles = [
  "components/JobProgressBanner.tsx",
  "components/SchemaBrowserPanel.tsx",
  "components/chat/AttachmentChips.tsx",
  "components/chat/SessionConfigBar.tsx",
  "components/chat/SessionResourceSummary.tsx",
  "components/chat/chat-add-actions.ts",
  "components/chat/collaboration-responses.tsx",
  "components/task-console/TaskConsole.tsx",
  "components/task-console/TaskConsoleDrawer.tsx",
  "components/task-console/TraceList.tsx",
  "config-test-result.ts",
  "data-task-state.ts",
  "live-run-state.ts",
  "page.tsx",
  "process-tool-groups.ts",
  "step-display-label.ts",
  "tool-call-display.ts",
  "trace-timeline.ts",
];

describe("English UI copy", () => {
  it("keeps runtime data task layout copy in English", () => {
    const offenders = runtimeFiles.flatMap((file) => {
      const content = readFileSync(join(dataTasksRoot, file), "utf8");
      return content
        .split("\n")
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /[\u4e00-\u9fff]/.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`);
    });

    expect(offenders).toEqual([]);
  });
});
