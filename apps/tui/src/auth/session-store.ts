import { lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import type { StoredTuiSession } from "./types.js";

export type SessionStorePlatformEnv = {
  platform?: NodeJS.Platform;
  homedir?: () => string;
  env?: NodeJS.ProcessEnv;
};

type SessionFile = {
  version: 1;
  sessions: Record<string, StoredTuiSession>;
};

export function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  if (url.pathname === "/") {
    return `${url.protocol}//${url.host}`;
  }
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export function resolveTuiAuthStorePath(env: SessionStorePlatformEnv = {}): string {
  const osPlatform = env.platform ?? platform();
  const home = (env.homedir ?? homedir)();
  const processEnv = env.env ?? process.env;

  if (osPlatform === "win32") {
    const appData = processEnv.APPDATA?.trim();
    if (!appData) {
      throw new Error("APPDATA is required to locate the TUI auth store on Windows.");
    }
    return join(appData, "DataFoundry", "tui-auth.json");
  }

  if (osPlatform === "darwin") {
    return join(home, "Library", "Application Support", "DataFoundry", "tui-auth.json");
  }

  const xdg = processEnv.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    return join(xdg, "datafoundry", "tui-auth.json");
  }
  return join(home, ".config", "datafoundry", "tui-auth.json");
}

export class TuiSessionStore {
  private readonly filePath: string;
  private readonly platformEnv: SessionStorePlatformEnv;

  constructor(options?: { filePath?: string; platformEnv?: SessionStorePlatformEnv }) {
    this.platformEnv = options?.platformEnv ?? {};
    this.filePath = options?.filePath ?? resolveTuiAuthStorePath(this.platformEnv);
  }

  async load(apiBaseUrl: string): Promise<StoredTuiSession | undefined> {
    const key = normalizeApiBaseUrl(apiBaseUrl);
    const file = await this.readFile();
    const session = file.sessions[key];
    if (!session) {
      return undefined;
    }
    return {
      ...session,
      apiBaseUrl: key,
    };
  }

  async save(session: StoredTuiSession): Promise<void> {
    const key = normalizeApiBaseUrl(session.apiBaseUrl);
    const file = await this.readFile();
    file.sessions[key] = {
      ...session,
      apiBaseUrl: key,
    };
    await this.writeFileAtomic(file);
  }

  async remove(apiBaseUrl: string): Promise<void> {
    const key = normalizeApiBaseUrl(apiBaseUrl);
    const file = await this.readFile();
    if (!(key in file.sessions)) {
      return;
    }
    delete file.sessions[key];
    await this.writeFileAtomic(file);
  }

  private async readFile(): Promise<SessionFile> {
    try {
      await this.assertSafePath();
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isSessionFile(parsed)) {
        await this.quarantineCorrupt();
        return { version: 1, sessions: {} };
      }
      return parsed;
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") {
        return { version: 1, sessions: {} };
      }
      if (error instanceof SyntaxError) {
        await this.quarantineCorrupt();
        return { version: 1, sessions: {} };
      }
      throw error;
    }
  }

  private async writeFileAtomic(file: SessionFile): Promise<void> {
    await this.ensureParentDir();
    await this.assertSafePath({ allowMissing: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(file, null, 2)}\n`;
    const handle = await open(tempPath, "w", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, this.filePath);
    await chmodSafe(this.filePath, 0o600);
  }

  private async ensureParentDir(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmodSafe(dir, 0o700);
  }

  private async quarantineCorrupt(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptPath = `${this.filePath}.${stamp}.corrupt`;
    try {
      await rename(this.filePath, corruptPath);
    } catch {
      // ignore rename races
    }
    await writeFile(this.filePath, `${JSON.stringify({ version: 1, sessions: {} }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  private async assertSafePath(options?: { allowMissing?: boolean }): Promise<void> {
    try {
      const info = await lstat(this.filePath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error("TUI auth store path must be a regular file.");
      }
    } catch (error) {
      if (options?.allowMissing && isErrno(error) && error.code === "ENOENT") {
        return;
      }
      if (isErrno(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

function isSessionFile(value: unknown): value is SessionFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !record.sessions || typeof record.sessions !== "object") {
    return false;
  }
  return true;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}

async function chmodSafe(path: string, mode: number): Promise<void> {
  if (platform() === "win32") {
    return;
  }
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(path, mode);
  } catch {
    // best effort on platforms without unix modes
  }
}
