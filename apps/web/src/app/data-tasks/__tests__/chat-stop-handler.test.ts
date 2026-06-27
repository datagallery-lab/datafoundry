import { describe, expect, it, vi } from "vitest";
import { createChatStopHandler } from "../components/chat/chat-stop-handler";

describe("createChatStopHandler", () => {
  it("stops the frontend stream and requests backend cancellation", () => {
    const onStopFrontend = vi.fn();
    const onCancelRun = vi.fn();
    const stop = createChatStopHandler({ onCancelRun, onStopFrontend });

    stop();

    expect(onStopFrontend).toHaveBeenCalledTimes(1);
    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });

  it("still stops the frontend stream when backend cancel is unavailable", () => {
    const onStopFrontend = vi.fn();
    const stop = createChatStopHandler({ onStopFrontend });

    stop();

    expect(onStopFrontend).toHaveBeenCalledTimes(1);
  });

  it("requests backend cancellation when frontend stop is unavailable", () => {
    const onCancelRun = vi.fn();
    const stop = createChatStopHandler({ onCancelRun });

    stop();

    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });
});
