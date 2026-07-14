#!/usr/bin/env node
import { render } from "ink";
import { randomUUID } from "node:crypto";
import React from "react";
import { ConfigClient } from "./config/index.js";
import { CopilotKitClient } from "./protocol/copilotkit-client.js";
import { DemoCopilotKitClient } from "./protocol/demo-client.js";
import { seedDemoState } from "./state/demo-state.js";
import { store } from "./state/store.js";
import { installTerminalRedrawOptimizer } from "./terminal-redraw-optimizer.js";
import { withAlternateScreen } from "./terminal-screen.js";
import { App } from "./ui/App.js";

const args = process.argv.slice(2);
const STARTUP_PREFLIGHT_TIMEOUT_MS = 1200;

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
DataFoundry TUI - Terminal User Interface for DataFoundry

Usage:
  datafoundry-tui [options]

Options:
  --runtime-url <url>     CopilotKit runtime URL
                          (default: http://127.0.0.1:8787/api/copilotkit)
  --datasource-id <id>    Datasource ID
                          (default: backend run-defaults; demo: api-duckdb-demo)
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

async function fetchWithStartupTimeout(url: string): Promise<Response | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STARTUP_PREFLIGHT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function preflightRuntimeConnection(runtimeUrl: string): Promise<boolean> {
  const response = await fetchWithStartupTimeout(runtimeUrl.replace(/\/api\/.*$/, "/healthz"));
  return response?.ok === true;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function datasourceIdFromRunDefaults(value: unknown): string | undefined {
  const envelope = objectRecord(value);
  const data = objectRecord(envelope?.success === true ? envelope.data : value);
  const activeDatasourceId = data?.activeDatasourceId;

  if (typeof activeDatasourceId === "string" && activeDatasourceId.trim()) {
    return activeDatasourceId;
  }

  const enabledDatasourceIds = data?.enabledDatasourceIds;
  if (Array.isArray(enabledDatasourceIds)) {
    const firstEnabled = enabledDatasourceIds.find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    return firstEnabled;
  }

  return undefined;
}

async function preflightDefaultDatasourceId(baseUrl: string): Promise<string | undefined> {
  const response = await fetchWithStartupTimeout(`${baseUrl}/api/v1/run-defaults`);
  if (!response?.ok) {
    return undefined;
  }

  try {
    return datasourceIdFromRunDefaults(await response.json());
  } catch {
    return undefined;
  }
}

const runtimeUrl = getArg(
  "--runtime-url",
  "http://127.0.0.1:8787/api/copilotkit"
);
const configBaseUrl = configBaseUrlFromRuntime(runtimeUrl);
const explicitDatasourceId = getOptionalArg("--datasource-id");
const agent = getArg("--agent", "dataFoundry");
const demoMode = args.includes("--demo");
const demoDatasourceId = explicitDatasourceId ?? "api-duckdb-demo";
const datasourceId = demoMode ? demoDatasourceId : explicitDatasourceId;
let initialDatasourceId = datasourceId;
const initialResume = resolveResumeRequest();
const configClient = demoMode
  ? undefined
  : new ConfigClient({
      baseUrl: configBaseUrl,
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
    initialDatasourceId,
    ...(configClient ? { configClient } : {}),
    ...(initialResume ? { initialResume } : {}),
  });
}

async function main(): Promise<void> {
  try {
    const [runtimeConnected, preflightDatasourceId] = await Promise.all([
      demoMode ? Promise.resolve(true) : preflightRuntimeConnection(runtimeUrl),
      !demoMode && !initialDatasourceId
        ? preflightDefaultDatasourceId(configBaseUrl)
        : Promise.resolve(undefined),
    ]);

    if (!initialDatasourceId && preflightDatasourceId) {
      initialDatasourceId = preflightDatasourceId;
    }

    store.setConnectionStatus(runtimeConnected ? "connected" : "disconnected");
    if (!initialResume?.enabled) {
      store.setThreadId(randomUUID());
    }
    if (demoMode) {
      seedDemoState(demoDatasourceId);
    }

    const restoreTerminalRedrawOptimizer = process.stdout.isTTY
      ? installTerminalRedrawOptimizer(process.stdout)
      : () => {};

    try {
      await withAlternateScreen(async () => {
        const instance = render(createAppElement(), {
          exitOnCtrlC: false,
          // Ink 7 fixes the trailing-newline cursor offset in its line-diff
          // renderer. Keep an opt-out for terminal-specific rendering issues.
          incrementalRendering:
            process.env.DATAFOUNDRY_TUI_INCREMENTAL_RENDERING !== "0",
          maxFps: 30,
          patchConsole: false,
        });
        await instance.waitUntilExit();
      });
    } finally {
      restoreTerminalRedrawOptimizer();
    }
  } catch (error) {
    console.error("Failed to start TUI:", error);
    process.exitCode = 1;
  }
}

await main();
