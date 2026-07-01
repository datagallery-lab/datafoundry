#!/usr/bin/env node
import { render } from "ink";
import { randomUUID } from "node:crypto";
import React from "react";
import { ConfigClient } from "./config/index.js";
import { CopilotKitClient } from "./protocol/copilotkit-client.js";
import { DemoCopilotKitClient } from "./protocol/demo-client.js";
import { seedDemoState } from "./state/demo-state.js";
import { store } from "./state/store.js";
import { withAlternateScreen } from "./terminal-screen.js";
import { App } from "./ui/App.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
DataFoundry TUI - Terminal User Interface for DataFoundry

Usage:
  datafoundry-tui [options]

Options:
  --runtime-url <url>     CopilotKit runtime URL
                          (default: http://127.0.0.1:8787/api/copilotkit)
  --datasource-id <id>    Datasource ID
                          (default: api-duckdb-demo)
  --agent <name>          Agent name
                          (default: dataFoundry)
  --resume [sessionId]    Resume the latest server session, or a specific session
  --demo                  Show mock messages and use a local mock stream
  --help, -h              Show this help message

Examples:
  datafoundry-tui
  datafoundry-tui --runtime-url http://localhost:8787/api/copilotkit
  datafoundry-tui --datasource-id my-database
  datafoundry-tui --resume
  datafoundry-tui --resume thread-001
  datafoundry-tui --demo
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
const agent = getArg("--agent", "dataFoundry");
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

function createAppElement(): React.ReactElement {
  return React.createElement(App, {
    client,
    datasourceId,
    ...(configClient ? { configClient } : {}),
    ...(initialResume ? { initialResume } : {}),
  });
}

async function main(): Promise<void> {
  try {
    store.setConnectionStatus(demoMode ? "connected" : "disconnected");
    if (!initialResume?.enabled) {
      store.setThreadId(randomUUID());
    }
    if (demoMode) {
      seedDemoState(datasourceId);
    }

    await withAlternateScreen(async () => {
      const instance = render(createAppElement());
      await instance.waitUntilExit();
    });
  } catch (error) {
    console.error("Failed to start TUI:", error);
    process.exitCode = 1;
  }
}

await main();
