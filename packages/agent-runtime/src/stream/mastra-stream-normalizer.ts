export type MastraStreamChunk = {
  type?: string;
  payload?: unknown;
  data?: unknown;
  runId?: string;
  from?: string;
  [key: string]: unknown;
};

export type MastraStreamNormalizerHooks = {
  onChunk?: (chunk: MastraStreamChunk) => void;
  onDataChunk?: (chunk: MastraStreamChunk) => void;
  onQuarantine?: (chunk: MastraStreamChunk) => void;
};

/** Normalize Mastra fullStream chunks before @ag-ui/mastra consumes them. */
export async function* normalizeMastraFullStream(
  stream: AsyncIterable<MastraStreamChunk>,
  hooks: MastraStreamNormalizerHooks = {}
): AsyncGenerator<MastraStreamChunk> {
  const quarantined = new Set<string>();

  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== "object") {
      continue;
    }
    hooks.onChunk?.(chunk);

    const type = typeof chunk.type === "string" ? chunk.type : undefined;

    // Mastra workspace tools emit data-* chunks (e.g. data-workspace-metadata) via
    // writer.custom() with a `data` field and no `payload`. @ag-ui/mastra rejects
    // chunks without payload, so route all data-* chunks out-of-band before AG-UI.
    if (type?.startsWith("data-")) {
      hooks.onDataChunk?.(chunk);
      continue;
    }

    if (type === "finish-step") {
      continue;
    }

    if (type === "tool-error" && isRecord(chunk.payload)) {
      const payload = chunk.payload;
      yield {
        ...chunk,
        type: "tool-result",
        payload: {
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          result: {
            error: stringifyStreamError(payload.error),
            isError: true
          }
        }
      };
      continue;
    }

    if (chunk.payload === undefined) {
      const key = type ?? "unknown";
      if (!quarantined.has(key)) {
        quarantined.add(key);
        hooks.onQuarantine?.(chunk);
      }
      continue;
    }

    yield chunk;
  }
}

/** Wrap a local Mastra Agent so only fullStream is normalized for AG-UI consumption. */
export function wrapAgentForAgUi<TAgent extends object>(
  agent: TAgent,
  hooks: MastraStreamNormalizerHooks = {}
): TAgent {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === "stream" && typeof value === "function") {
        return async (...args: unknown[]) => {
          const response = await value.apply(target, args);
          if (!response || typeof response !== "object") {
            return response;
          }

          return new Proxy(response as object, {
            get(responseTarget, responseProp, responseReceiver) {
              if (responseProp === "fullStream") {
                const fullStream = Reflect.get(responseTarget, responseProp, responseReceiver);
                if (fullStream && typeof (fullStream as AsyncIterable<MastraStreamChunk>)[Symbol.asyncIterator] === "function") {
                  return normalizeMastraFullStream(fullStream as AsyncIterable<MastraStreamChunk>, hooks);
                }
                return fullStream;
              }
              return Reflect.get(responseTarget, responseProp, responseReceiver);
            }
          });
        };
      }

      if (typeof value === "function") {
        return value.bind(target);
      }

      return value;
    }
  }) as TAgent;
}

const stringifyStreamError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
