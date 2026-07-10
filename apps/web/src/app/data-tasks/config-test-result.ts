import type { WorkspaceConfigKind } from "./data-task-state";
import { ConfigApiError } from "../../lib/config-api";

export type ConfigTestPresentation = {
  tone: "success" | "error";
  title: string;
  details: string[];
};

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function humanizeProviderTestMessage(message: string): string {
  const trimmed = message.trim();
  const missing = /^PROVIDER_CONFIG_MISSING:(.+)$/u.exec(trimmed);
  if (missing) {
    const profile = missing[1]?.trim() || "this model profile";
    return `Model provider configuration is incomplete for "${profile}". Check the API key, base URL, and model name.`;
  }
  const providerFailed = /^PROVIDER_TEST_FAILED:(.+)$/u.exec(trimmed);
  if (providerFailed) {
    return providerFailed[1]?.trim() || trimmed;
  }
  const datasourceFailed = /^DATASOURCE_TEST_FAILED:(.+)$/u.exec(trimmed);
  if (datasourceFailed) {
    return datasourceFailed[1]?.trim() || trimmed;
  }
  const mcpFailed = /^MCP_TEST_FAILED:(.+)$/u.exec(trimmed);
  if (mcpFailed) {
    return mcpFailed[1]?.trim() || trimmed;
  }
  if (trimmed === "MCP_SERVER_CONFIG_INVALID") {
    return "MCP server configuration is incomplete. Check the URL/command and transport.";
  }
  if (trimmed === "MCP_STDIO_COMMAND_REQUIRED") {
    return "MCP stdio transport requires a command.";
  }
  if (trimmed.startsWith("MCP_SERVER_") || trimmed.startsWith("MCP_STDIO_")) {
    return trimmed.replace(/^MCP_[A-Z0-9_]+:?/u, "").trim() || trimmed;
  }
  if (
    trimmed === "REVISION_CONFLICT"
    || trimmed.startsWith("REVISION_CONFLICT:")
    || trimmed.includes("REVISION_CONFLICT")
  ) {
    return "Configuration was updated while testing. Refresh and try again.";
  }
  if (
    trimmed.includes("CONFIG_RESOURCE_NOT_FOUND")
    || trimmed.includes("RESOURCE_NOT_FOUND")
    || /not found/iu.test(trimmed)
  ) {
    return "This configuration was deleted while testing. Refresh and try again.";
  }
  return trimmed;
}

export function formatConfigTestResult(
  kind: WorkspaceConfigKind,
  result: Record<string, unknown>,
): ConfigTestPresentation {
  if (result.tested === false) {
    const reason =
      stringValue(result.reason) ?? "Connectivity probe is not available for this resource type.";
    return {
      tone: "success",
      title: "Test skipped",
      details: [reason],
    };
  }

  const details: string[] = [];
  const reason = stringValue(result.reason);
  const model = stringValue(result.model);
  const latencyMs = stringValue(result.latencyMs);
  const response = stringValue(result.response);
  const status = stringValue(result.status);

  if (reason) details.push(reason);
  if (kind === "llm" && model && !reason) details.push(`Model: ${model}`);
  if (latencyMs) details.push(`Duration: ${latencyMs} ms`);
  if (kind === "llm" && response && !reason) details.push(`Response: ${response}`);
  if (details.length === 0 && status) details.push(`Status: ${status}`);
  if (details.length === 0) details.push("Connection test completed.");

  return { tone: "success", title: "Test succeeded", details };
}

export function formatConfigTestError(error: unknown): ConfigTestPresentation {
  if (error instanceof ConfigApiError) {
    const raw =
      error.code === "REVISION_CONFLICT" && !error.message.includes("REVISION_CONFLICT")
        ? `REVISION_CONFLICT:${error.message}`
        : error.message || error.code;
    return {
      tone: "error",
      title: "Test failed",
      details: [humanizeProviderTestMessage(raw)],
    };
  }
  const message = error instanceof Error ? error.message : "Test failed";
  return {
    tone: "error",
    title: "Test failed",
    details: [humanizeProviderTestMessage(message)],
  };
}
