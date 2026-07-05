export type ChatRunCancellationOptions = {
  fallbackTimeoutMs?: number;
  onCancelRun?: () => Promise<void> | void;
  onStopFrontend?: () => void;
};

export function performChatRunCancellation(
  options: ChatRunCancellationOptions,
): Promise<void> {
  if (!options.onCancelRun) {
    options.onStopFrontend?.();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let fallbackUsed = false;
    const fallback = () => {
      if (settled || fallbackUsed) {
        return;
      }
      fallbackUsed = true;
      options.onStopFrontend?.();
      resolve();
    };
    const timeout = setTimeout(fallback, options.fallbackTimeoutMs ?? 5000);

    try {
      void Promise.resolve(options.onCancelRun()).then(
        () => {
          settled = true;
          clearTimeout(timeout);
          resolve();
        },
        () => {
          clearTimeout(timeout);
          fallback();
        },
      );
    } catch {
      clearTimeout(timeout);
      fallback();
    }
  });
}

export function createChatStopHandler(
  options: ChatRunCancellationOptions,
): () => void {
  return () => {
    void performChatRunCancellation(options);
  };
}
