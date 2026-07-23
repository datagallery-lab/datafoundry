import { TuiCookieJar } from "./cookie-jar.js";
import { normalizeApiBaseUrl } from "./session-store.js";
import type { AuthStatus, StoredTuiSession, TuiUser, TuiWorkspace } from "./types.js";

export type TuiAuthClientOptions = {
  apiBaseUrl: string;
  cookieJar: TuiCookieJar;
  fetchImpl?: typeof fetch;
};

export class TuiAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TuiAuthError";
    this.status = status;
    this.code = code;
  }
}

export class TuiAuthClient {
  readonly apiBaseUrl: string;
  readonly cookieJar: TuiCookieJar;
  readonly fetchImpl: typeof fetch;

  constructor(options: TuiAuthClientOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.cookieJar = options.cookieJar;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getStatus(): Promise<AuthStatus> {
    const body = await this.requestJson("GET", "/api/v1/auth/status");
    const data = asRecord(body.data);
    const publicBaseUrl = asString(data?.publicBaseUrl);
    if (!publicBaseUrl) {
      throw new TuiAuthError(500, "INVALID_STATUS", "Auth status missing publicBaseUrl.");
    }
    return {
      publicBaseUrl,
      registrationEnabled: Boolean(data?.registrationEnabled),
    };
  }

  async login(email: string, password: string): Promise<StoredTuiSession> {
    const response = await this.rawRequest("POST", "/api/v1/auth/login", {
      email,
      password,
      client: "tui",
    });
    this.cookieJar.absorbSetCookie(response.headers);
    const body = await readJson(response);
    if (!response.ok) {
      throw errorFromBody(response.status, body);
    }

    const data = asRecord(body.data);
    const user = parseUser(data?.user);
    const workspace = parseWorkspace(data?.workspace);
    const session = asRecord(data?.session);
    const expiresAt = asString(session?.expiresAt);
    if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) {
      throw new TuiAuthError(
        500,
        "INVALID_LOGIN_RESPONSE",
        "Login response missing session.expiresAt.",
      );
    }

    return {
      apiBaseUrl: this.apiBaseUrl,
      cookies: this.cookieJar.snapshot(),
      user,
      workspace,
      expiresAt,
    };
  }

  async me(): Promise<TuiUser & { workspace: TuiWorkspace }> {
    const body = await this.requestJson("GET", "/api/v1/me");
    const data = asRecord(body.data);
    const user = parseUser(data?.user);
    const workspace = parseWorkspace(data?.workspace);
    return { ...user, workspace };
  }

  async refreshCsrf(): Promise<void> {
    const response = await this.rawRequest("POST", "/api/v1/auth/csrf/refresh");
    this.cookieJar.absorbSetCookie(response.headers);
    if (!response.ok) {
      throw errorFromBody(response.status, await readJson(response));
    }
  }

  async logout(): Promise<void> {
    const response = await this.rawRequest("POST", "/api/v1/auth/logout");
    this.cookieJar.absorbSetCookie(response.headers);
    if (!response.ok && response.status !== 401) {
      throw errorFromBody(response.status, await readJson(response));
    }
    this.cookieJar.clear();
  }

  private async requestJson(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data?: unknown; error?: { code?: string; message?: string } }> {
    const response = await this.rawRequest(method, path, body);
    this.cookieJar.absorbSetCookie(response.headers);
    const json = await readJson(response);
    if (!response.ok) {
      throw errorFromBody(response.status, json);
    }
    return json;
  }

  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = resolveApiUrl(this.apiBaseUrl, path);
    const headers = new Headers();
    const cookieHeader = this.cookieJar.headerValue();
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
    if (method !== "GET" && method !== "HEAD") {
      headers.set("content-type", "application/json");
      const csrf = this.cookieJar.csrfToken();
      if (csrf) {
        headers.set("x-csrf-token", csrf);
      }
    }
    return this.fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}

function resolveApiUrl(apiBaseUrl: string, path: string): string {
  const base = new URL(apiBaseUrl);
  const prefix = base.pathname.replace(/\/?$/, "/");
  const resolved = new URL(path.replace(/^\/+/, ""), `https://resolve.invalid${prefix}`);
  base.pathname = resolved.pathname;
  base.search = resolved.search;
  base.hash = "";
  return base.toString();
}

function parseUser(value: unknown): TuiUser {
  const record = asRecord(value);
  const id = asString(record?.id);
  const email = asString(record?.email);
  if (!id || !email) {
    throw new TuiAuthError(500, "INVALID_USER", "Auth response missing user identity.");
  }
  const displayName = asString(record?.displayName);
  return {
    id,
    email,
    ...(displayName ? { displayName } : {}),
  };
}

function parseWorkspace(value: unknown): TuiWorkspace {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!id) {
    throw new TuiAuthError(500, "INVALID_WORKSPACE", "Auth response missing workspace id.");
  }
  const name = asString(record?.name);
  return {
    id,
    ...(name ? { name } : {}),
  };
}

function errorFromBody(
  status: number,
  body: { error?: { code?: string; message?: string } },
): TuiAuthError {
  return new TuiAuthError(
    status,
    body.error?.code ?? "HTTP_ERROR",
    body.error?.message ?? `Request failed with status ${status}`,
  );
}

async function readJson(
  response: Response,
): Promise<{ data?: unknown; error?: { code?: string; message?: string } }> {
  try {
    return await response.json() as {
      data?: unknown;
      error?: { code?: string; message?: string };
    };
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
