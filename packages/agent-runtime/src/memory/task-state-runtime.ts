import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TaskStateRuntime = {
  memory: Memory;
  storage: LibSQLStore;
  close(): Promise<void>;
};

/** Create application-scoped Mastra storage used only for durable thread task state. */
export const createTaskStateRuntime = async (databasePath: string): Promise<TaskStateRuntime> => {
  const absolutePath = resolve(databasePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const storage = new LibSQLStore({
    id: "data-agent-task-state",
    url: `file:${absolutePath}`
  });
  await storage.init();

  const memory = new Memory({
    storage,
    vector: false,
    options: {
      generateTitle: false,
      lastMessages: false,
      observationalMemory: false,
      readOnly: true,
      semanticRecall: false,
      workingMemory: { enabled: false }
    }
  });

  return {
    memory,
    storage,
    close: () => storage.close()
  };
};
