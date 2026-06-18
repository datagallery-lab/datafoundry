import {
  RunEventWriter,
  createMetadataStore
} from "../packages/metadata/dist/index.js";

const databasePath = `storage/metadata/metadata-smoke-${Date.now()}.sqlite`;
const store = createMetadataStore({ database_path: databasePath });

try {
  const userId = "dev-user";
  const sessionId = "session-smoke";
  const runId = "run-smoke";

  store.sessions.create({
    user_id: userId,
    id: sessionId,
    title: "metadata smoke"
  });
  store.runs.create({
    user_id: userId,
    id: runId,
    session_id: sessionId,
    user_input: "metadata smoke",
    status: "running"
  });

  const writer = new RunEventWriter(store.runEvents);
  writer.write({
    user_id: userId,
    run_id: runId,
    session_id: sessionId,
    type: "plan.update",
    payload: {
      tasks: [{ id: "metadata", title: "metadata smoke", status: "completed" }]
    }
  });
  writer.write({
    user_id: userId,
    run_id: runId,
    session_id: sessionId,
    type: "done",
    payload: { status: "completed" }
  });

  const replayed = writer.replay({ user_id: userId, run_id: runId });
  const otherUserReplay = writer.replay({ user_id: "other-user", run_id: runId });

  if (replayed.length !== 2) {
    throw new Error(`Expected 2 replayed events, got ${replayed.length}`);
  }

  if (otherUserReplay.length !== 0) {
    throw new Error("Expected user-scoped replay to hide another user's run events");
  }

  console.log(`Metadata smoke OK: session=${sessionId}, run=${runId}, replayed=${replayed.length}`);
} finally {
  store.close();
}
