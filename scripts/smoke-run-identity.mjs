import { EventType } from "@ag-ui/core";

import {
  createRunRequestFingerprint,
  resolveExistingRun,
  validateParentRun
} from "../apps/api/dist/run-identity.js";
import { RunEventWriter, createMetadataStore } from "../packages/metadata/dist/index.js";

const databasePath = `storage/metadata/run-identity-smoke-${Date.now()}.sqlite`;
const store = createMetadataStore({ database_path: databasePath });

try {
  const userId = "dev-user";
  const sessionId = "identity-session";
  const runId = "identity-run";
  const requestInput = {
    threadId: sessionId,
    runId,
    messages: [{ id: "message-1", role: "user", content: "inspect orders" }],
    tools: [],
    context: []
  };
  const reorderedRequestInput = {
    context: [],
    tools: [],
    messages: [{ content: "inspect orders", role: "user", id: "message-1" }],
    runId,
    threadId: sessionId
  };
  const fingerprint = createRunRequestFingerprint(requestInput, "api-duckdb-demo");
  const reorderedFingerprint = createRunRequestFingerprint(reorderedRequestInput, "api-duckdb-demo");

  if (fingerprint !== reorderedFingerprint) {
    throw new Error("Expected semantically identical request objects to have the same fingerprint");
  }

  store.sessions.create({ user_id: userId, id: sessionId, title: "identity smoke" });
  store.runs.create({
    user_id: userId,
    id: runId,
    session_id: sessionId,
    request_fingerprint: fingerprint,
    user_input: "inspect orders",
    status: "running"
  });

  const writer = new RunEventWriter(store.runEvents);
  writer.write({
    user_id: userId,
    run_id: runId,
    session_id: sessionId,
    event: { type: EventType.RUN_STARTED, threadId: sessionId, runId }
  });

  assertThrows(
    () =>
      resolveExistingRun({
        existingRun: store.runs.get({ user_id: userId, run_id: runId }),
        requestFingerprint: fingerprint,
        runEventWriter: writer,
        sessionId
      }),
    "RUN_ALREADY_ACTIVE"
  );

  writer.write({
    user_id: userId,
    run_id: runId,
    session_id: sessionId,
    event: { type: EventType.RUN_FINISHED, threadId: sessionId, runId }
  });
  const completedRun = store.runs.updateStatus({ user_id: userId, run_id: runId, status: "completed" });
  const replayedEvents = resolveExistingRun({
    existingRun: completedRun,
    requestFingerprint: fingerprint,
    runEventWriter: writer,
    sessionId
  });

  if (replayedEvents.length !== 2 || replayedEvents[1].type !== EventType.RUN_FINISHED) {
    throw new Error("Expected a completed duplicate run to replay its persisted AG-UI events");
  }

  assertThrows(
    () =>
      resolveExistingRun({
        existingRun: completedRun,
        requestFingerprint: "different-request",
        runEventWriter: writer,
        sessionId
      }),
    "RUN_REQUEST_MISMATCH"
  );
  assertThrows(
    () =>
      resolveExistingRun({
        existingRun: completedRun,
        requestFingerprint: fingerprint,
        runEventWriter: writer,
        sessionId: "different-session"
      }),
    "RUN_SESSION_MISMATCH"
  );

  validateParentRun({ metadataStore: store, parentRunId: runId, sessionId, userId });
  assertThrows(
    () => validateParentRun({ metadataStore: store, parentRunId: runId, sessionId: "different-session", userId }),
    "PARENT_RUN_SESSION_MISMATCH"
  );

  console.log(`Run identity smoke OK: fingerprint=${fingerprint.slice(0, 12)}, replayed=${replayedEvents.length}`);
} finally {
  store.close();
}

function assertThrows(callback, expectedMessage) {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }
    throw error;
  }

  throw new Error(`Expected error containing: ${expectedMessage}`);
}
