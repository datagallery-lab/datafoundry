export function createChatStopHandler(options: {
  onCancelRun?: () => Promise<void> | void;
  onStopFrontend?: () => void;
}): () => void {
  return () => {
    options.onStopFrontend?.();
    void options.onCancelRun?.();
  };
}
