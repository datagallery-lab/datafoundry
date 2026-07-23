import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TuiAuthClient, TuiAuthError } from "./auth-client.js";
import { TuiCookieJar } from "./cookie-jar.js";

describe("TuiAuthClient", () => {
  it("calls status/login/me/csrf/logout with expected URLs and methods", async () => {
    const jar = new TuiCookieJar();
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const client = new TuiAuthClient({
      apiBaseUrl: "http://127.0.0.1:8787",
      cookieJar: jar,
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = String(init?.method ?? "GET");
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/api/v1/auth/status")) {
          return json(200, {
            success: true,
            data: { publicBaseUrl: "http://127.0.0.1:3000", registrationEnabled: true },
          });
        }
        if (url.endsWith("/api/v1/auth/login")) {
          return json(
            200,
            {
              success: true,
              data: {
                user: { id: "u1", email: "a@example.com" },
                workspace: { id: "w1" },
                session: { expiresAt: "2099-01-01T00:00:00.000Z" },
              },
            },
            [
              "df_session=sess; Path=/; HttpOnly",
              "df_csrf=csrf; Path=/",
            ],
          );
        }
        if (url.endsWith("/api/v1/me")) {
          return json(200, {
            success: true,
            data: { user: { id: "u1", email: "a@example.com" }, workspace: { id: "w1" } },
          });
        }
        if (url.endsWith("/api/v1/auth/csrf/refresh")) {
          return json(200, { success: true, data: { csrfToken: "new" } }, ["df_csrf=new; Path=/"]);
        }
        if (url.endsWith("/api/v1/auth/logout")) {
          return json(200, { success: true, data: { ok: true } });
        }
        return json(404, { success: false, error: { code: "NOT_FOUND", message: "missing" } });
      },
    });

    await client.getStatus();
    await client.login("a@example.com", "password");
    await client.me();
    await client.refreshCsrf();
    await client.logout();

    assert.deepEqual(
      calls.map((call) => ({ method: call.method, path: new URL(call.url).pathname })),
      [
        { method: "GET", path: "/api/v1/auth/status" },
        { method: "POST", path: "/api/v1/auth/login" },
        { method: "GET", path: "/api/v1/me" },
        { method: "POST", path: "/api/v1/auth/csrf/refresh" },
        { method: "POST", path: "/api/v1/auth/logout" },
      ],
    );
    assert.equal((calls[1]?.body as { client?: string } | undefined)?.client, "tui");
    assert.equal(
      calls.some((call) => call.url.includes("/api/v1/auth/me")),
      false,
    );
  });

  it("requires session.expiresAt from login response", async () => {
    const client = new TuiAuthClient({
      apiBaseUrl: "http://127.0.0.1:8787",
      cookieJar: new TuiCookieJar(),
      fetchImpl: async () =>
        json(200, {
          success: true,
          data: {
            user: { id: "u1", email: "a@example.com" },
            workspace: { id: "w1" },
            session: {},
          },
        }),
    });

    await assert.rejects(
      () => client.login("a@example.com", "password"),
      (error: unknown) => error instanceof TuiAuthError && error.code === "INVALID_LOGIN_RESPONSE",
    );
  });
});

function json(status: number, body: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}
