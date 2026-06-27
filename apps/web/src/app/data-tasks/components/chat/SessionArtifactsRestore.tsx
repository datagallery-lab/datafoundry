"use client";

import { useEffect, useRef } from "react";
import { configApi } from "../../../../lib/config-api";
import { hasCapability } from "../../data-task-state";
import { reconcileLiveRunArtifacts, reduceLiveRunEvent } from "../../live-run-state";
import { useLiveRunSetters } from "../../use-data-agent-run";

export function SessionArtifactsRestore({
  capabilitiesReady,
  threadId,
}: {
  capabilitiesReady: boolean;
  threadId?: string | null;
}) {
  const { setLiveRun } = useLiveRunSetters();
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!threadId || !capabilitiesReady || !hasCapability("artifact.list")) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let cancelled = false;

    void configApi.listSessionArtifacts(threadId)
      .then((response) => {
        if (cancelled || requestIdRef.current !== requestId) return;
        setLiveRun((current) =>
          reconcileLiveRunArtifacts(
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
