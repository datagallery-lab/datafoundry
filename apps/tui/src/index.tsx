#!/usr/bin/env node
import { render } from "ink";
import { randomUUID } from "node:crypto";
import React from "react";
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
  --demo                  Show mock messages and use a local mock stream
  --help, -h              Show this help message

Examples:
  dataagent-tui
  dataagent-tui --runtime-url http://localhost:8787/api/copilotkit
  dataagent-tui --datasource-id my-database
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

const runtimeUrl = getArg(
  "--runtime-url",
  "http://127.0.0.1:8787/api/copilotkit"
);
const datasourceId = getArg("--datasource-id", "api-duckdb-demo");
const agent = getArg("--agent", "dataAgent");
const demoMode = args.includes("--demo");

const client = demoMode
  ? new DemoCopilotKitClient()
  : new CopilotKitClient({
      runtimeUrl,
      agent,
      onConnectionStatusChange: (status) => {
        store.setConnectionStatus(status === "reconnecting" ? "disconnected" : status);
      },
    });

try {
  store.setConnectionStatus(demoMode ? "connected" : "disconnected");
  store.setThreadId(randomUUID());
  if (demoMode) {
    seedDemoState(datasourceId);
  }

  render(
    React.createElement(App, {
      client,
      datasourceId,
    }),
  );
} catch (error) {
  console.error("Failed to start TUI:", error);
  process.exit(1);
}
