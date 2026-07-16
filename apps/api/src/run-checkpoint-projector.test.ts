import { createCustomEvent } from "@datafoundry/agent-runtime";
import { createMetadataStore, RunEventWriter } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RunCheckpointProjector } from "./run-checkpoint-projector.js";

describe("RunCheckpointProjector protocol events", () => {
  it("projects protocol phase entry against the referenced latest ContextPackage", () => {
    const root = mkdtempSync(join(tmpdir(), "protocol-checkpoint-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Protocol" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "test",
        status: "running"
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        package_id: "context-1",
        revision: 2,
        payload: {}
      });
      const envelope = new RunEventWriter(metadata.runEvents).write({
        user_id: "dev-user",
        run_id: "run-1",
        session_id: "session-1",
        event: createCustomEvent("protocol.phase.entered", {
          eventId: "event-1",
          payload: { phase: "query_planning" }
        })
      });

      new RunCheckpointProjector(metadata, "dev-user").observe(envelope);

      expect(metadata.checkpoints.latestByRun({ user_id: "dev-user", run_id: "run-1" })).toMatchObject({
        kind: "protocol-phase",
        label: "Protocol phase: query_planning",
        context_package_revision: 2
      });
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
