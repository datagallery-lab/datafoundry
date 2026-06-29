#!/usr/bin/env node
import { render, type Instance } from "ink";
import { randomUUID } from "node:crypto";
import React from "react";
import { ConfigClient } from "./config/index.js";
import { CopilotKitClient } from "./protocol/copilotkit-client.js";
import { DemoCopilotKitClient } from "./protocol/demo-client.js";
import { seedDemoState } from "./state/demo-state.js";
import { store } from "./state/store.js";
import { App } from "./ui/App.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
DataAgent TUI - Terminal User Interface for DataAgent

Usage:
  dataagent-tui [options]

Options:
  --runtime-url <url>     CopilotKit runtime URL
                          (default: http://127.0.0.1:8787/api/copilotkit)
  --datasource-id <id>    Datasource ID
                          (default: api-duckdb-demo)
  --agent <name>          Agent name
                          (default: dataAgent)
  --resume [sessionId]    Resume the latest server session, or a specific session
  --demo                  Show mock messages and use a local mock stream
  --help, -h              Show this help message

Examples:
  dataagent-tui
  dataagent-tui --runtime-url http://localhost:8787/api/copilotkit
  dataagent-tui --datasource-id my-database
  dataagent-tui --resume
  dataagent-tui --resume thread-001
  dataagent-tui --demo
`);
  process.exit(0);
}

function getArg(name: string, defaultValue: string): string {
  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

function getOptionalArg(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  const next = args[index + 1];
  return next && !next.startsWith("-") ? next : undefined;
}

function resolveResumeRequest(): { enabled: boolean; sessionId?: string | undefined } | undefined {
  if (args.includes("--resume")) {
    return {
      enabled: true,
      ...(getOptionalArg("--resume") ? { sessionId: getOptionalArg("--resume") } : {}),
    };
  }
  const explicit = getOptionalArg("--resume-session");
  return explicit ? { enabled: true, sessionId: explicit } : undefined;
}

function configBaseUrlFromRuntime(runtimeUrl: string): string {
  const apiIndex = runtimeUrl.indexOf("/api/");
  if (apiIndex >= 0) {
    return runtimeUrl.slice(0, apiIndex);
  }
  return runtimeUrl.replace(/\/$/, "");
}

const runtimeUrl = getArg(
  "--runtime-url",
  "http://127.0.0.1:8787/api/copilotkit"
);
const datasourceId = getArg("--datasource-id", "api-duckdb-demo");
const agent = getArg("--agent", "dataAgent");
const demoMode = args.includes("--demo");
const initialResume = resolveResumeRequest();
const configClient = demoMode
  ? undefined
  : new ConfigClient({
      baseUrl: configBaseUrlFromRuntime(runtimeUrl),
    });

const client = demoMode
  ? new DemoCopilotKitClient()
  : new CopilotKitClient({
      runtimeUrl,
      agent,
      onConnectionStatusChange: (status) => {
        store.setConnectionStatus(status === "reconnecting" ? "disconnected" : status);
      },
    });

let appInstance: Instance | undefined;
let renderGeneration = 0;
let staticOutputResetScheduled = false;

function clearTerminal(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
}

function createAppElement(): React.ReactElement {
  return React.createElement(App, {
    key: renderGeneration,
    client,
    datasourceId,
    ...(configClient ? { configClient } : {}),
    ...(initialResume && renderGeneration === 0 ? { initialResume } : {}),
    onStaticOutputReset: resetStaticOutput,
  });
}

function mountApp(): void {
  appInstance = render(createAppElement());
}

function resetStaticOutput(): void {
  if (staticOutputResetScheduled) return;
  staticOutputResetScheduled = true;

  queueMicrotask(() => {
    try {
      const previousInstance = appInstance;
      renderGeneration += 1;

      previousInstance?.unmount();
      clearTerminal();
      mountApp();
    } finally {
      staticOutputResetScheduled = false;
    }
  });
}

try {
  store.setConnectionStatus(demoMode ? "connected" : "disconnected");
  if (!initialResume?.enabled) {
    store.setThreadId(randomUUID());
  }
  if (demoMode) {
    seedDemoState(datasourceId);
  }

  mountApp();
} catch (error) {
  console.error("Failed to start TUI:", error);
  process.exit(1);
}
