# Configuration Test Result Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a persistent inline result below configuration test actions.

**Architecture:** Keep test API calls in `WorkspaceConfigPanel`; store the returned payload and error in panel-local state; pass a presentation-ready result to the detail view. Render it below the action buttons so a status refresh does not hide it.

**Tech Stack:** React, TypeScript, Vitest, Tailwind CSS.

---

### Task 1: Test-result presentation helper

**Files:**
- Modify: `apps/web/src/app/data-tasks/page.tsx`
- Test: `apps/web/src/app/data-tasks/__tests__/config-test-result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(formatConfigTestResult("llm", {
  model: "qwen-plus", latencyMs: 1200, response: "OK", status: "connected",
})).toEqual({ tone: "success", title: "测试成功", details: ["模型：qwen-plus", "耗时：1200 ms", "响应：OK"] });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace @open-data-agent/web run test -- config-test-result.test.ts`

- [ ] **Step 3: Implement the formatter and inline result card**

```tsx
{testResult ? <ConfigTestResultCard result={testResult} /> : null}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm --workspace @open-data-agent/web run test -- config-test-result.test.ts`

### Task 2: Wire test actions to the result card

**Files:**
- Modify: `apps/web/src/app/data-tasks/page.tsx`
- Test: `apps/web/src/app/data-tasks/__tests__/config-test-result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(formatConfigTestError(new Error("PROVIDER_TEST_FAILED: timeout"))).toEqual({ tone: "error", title: "测试失败", details: ["PROVIDER_TEST_FAILED: timeout"] });
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm --workspace @open-data-agent/web run test -- config-test-result.test.ts`

- [ ] **Step 3: Save success or failure result in the panel test handler**

```tsx
const response = await onTestItem(detailItem.id);
setTestResult(formatConfigTestResult(panel, response));
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm --workspace @open-data-agent/web run test -- config-test-result.test.ts`

Run: `npm run build`
