import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL_CONNECT_TIMEOUT_MS,
  createModelProviderFromConfig,
  normalizeModelConnectTimeoutMs,
} from "../packages/providers/dist/index.js";

test("model providers install a fetch transport with a controlled connect timeout", () => {
  const provider = createModelProviderFromConfig({
    provider: "openai-compatible",
    model: "transport-test-model",
    base_url: "https://provider.invalid/v1",
    api_key: "test-key",
  });

  assert.equal(provider.kind, "openai-compatible");
  assert.equal(typeof provider.model.config.fetch, "function");
});

test("model connect timeout defaults above Undici's 10 second default and stays bounded", () => {
  assert.equal(DEFAULT_MODEL_CONNECT_TIMEOUT_MS, 30_000);
  assert.equal(normalizeModelConnectTimeoutMs(undefined), 30_000);
  assert.equal(normalizeModelConnectTimeoutMs(Number.NaN), 30_000);
  assert.equal(normalizeModelConnectTimeoutMs(250), 1_000);
  assert.equal(normalizeModelConnectTimeoutMs(45_678.9), 45_678);
  assert.equal(normalizeModelConnectTimeoutMs(300_000), 120_000);
});

test("persisted profiles can override the model connect timeout independently of run timeout", () => {
  const provider = createModelProviderFromConfig({
    provider: "openai-compatible",
    model: "transport-test-model",
    base_url: "https://provider.invalid/v1",
    api_key: "test-key",
    connect_timeout_ms: 45_000,
  });

  assert.equal(provider.kind, "openai-compatible");
  assert.equal(provider.connect_timeout_ms, 45_000);
});
