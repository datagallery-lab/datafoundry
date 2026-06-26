"use client";

import { useEffect, useRef } from "react";
import { configApi } from "../../../../lib/config-api";
import { hasCapability } from "../../data-task-state";
import { reduceLiveRunEvent } from "../../live-run-state";
import { useLiveRunSetters } from "../../use-data-agent-run";

export function SessionArtifactsRestore({
  capabilitiesReady,
  threadId,
}: {
  capabilitiesReady: boolean;
  threadId?: string | null;
}) {
  const { setLiveRun } = useLiveRunSetters();
  const restoredThreadIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!threadId || !capabilitiesReady || !hasCapability("artifact.list")) {
      return;
    }
    if (restoredThreadIdsRef.current.has(threadId)) {
      return;
    }

    let cancelled = false;
    restoredThreadIdsRef.current.add(threadId);
    void configApi.listSessionArtifacts(threadId)
      .then((response) => {
        if (cancelled) return;
        setLiveRun((current) =>
          (response.artifacts ?? []).reduce(
            (state, artifact) =>
              reduceLiveRunEvent(state, {
                type: "CUSTOM",
                name: "artifact",
                value: {
                  id: artifact.id,
                  type: artifact.type,
                  name: artifact.name,
                  title: artifact.name,
                  file_id: artifact.fileId,
                  download_url: artifact.downloadUrl,
                  preview_json: artifact.preview_json,
                  preview_available: artifact.preview_json !== undefined,
                },
              }),
            current,
          ),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [capabilitiesReady, setLiveRun, threadId]);

  return null;
}
