import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertRedirectUri,
  buildAuthorizeUrl,
  canvasOrigin,
  createCanvasAuthMiddleware,
  createPkcePair,
  identityFromToken,
  open,
  seal,
} from "./canvas-auth.mjs";

const env = {
  CANVAS_BASE_URL: "https://canvas.example.edu",
  CANVAS_CLIENT_ID: "client-id",
  CANVAS_CLIENT_SECRET: "client-secret",
  CANVAS_REDIRECT_URI: "http://localhost:5174/api/auth/canvas/callback",
  SESSION_SECRET: "session-secret",
};

function invoke(middleware, { method = "GET", url = "/", headers = {}, socket = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, url, headers, socket };
    const res = {
      statusCode: 0,
      headers: {},
      body: "",
      writeHead(code, responseHeaders) {
        this.statusCode = code;
        for (const [key, value] of Object.entries(responseHeaders)) this.headers[key.toLowerCase()] = value;
      },
      end(body) {
        this.body = body ?? "";
        resolve(this);
      },
    };
    middleware(req, res, () => resolve({ statusCode: 404, headers: {}, body: "next" }));
  });
}

function cookiesOf(response) {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return Object.fromEntries(
    list.map((line) => {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      return [pair.slice(0, idx), decodeURIComponent(pair.slice(idx + 1))];
    }),
  );
}

test("canvas origin rejects user-controlled urls that could receive the client secret", () => {
  assert.equal(canvasOrigin("https://canvas.example.edu"), "https://canvas.example.edu");
  assert.equal(canvasOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.throws(() => canvasOrigin("http://evil.example/steal"), /invalid_host/);
  assert.throws(() => canvasOrigin("https://canvas.example.edu/login"), /invalid_host/);
  assert.throws(() => canvasOrigin("https://user:pass@canvas.example.edu"), /invalid_host/);
});

test("redirect uri is pinned to the callback path", () => {
  assert.equal(
    assertRedirectUri("http://localhost:5174/api/auth/canvas/callback"),
    "http://localhost:5174/api/auth/canvas/callback",
  );
  assert.throws(() => assertRedirectUri("https://evil.example/api/auth/canvas/callback?next=1"), /invalid_redirect/);
  assert.throws(() => assertRedirectUri("http://canvas.example.edu/api/auth/canvas/callback"), /invalid_redirect/);
});

test("authorize url carries pkce and state and never the client secret", () => {
  const pkce = createPkcePair();
  assert.equal(createHash("sha256").update(pkce.verifier).digest("base64url"), pkce.challenge);
  const url = new URL(
    buildAuthorizeUrl({
      origin: "https://canvas.example.edu",
      clientId: "client-id",
      redirectUri: "http://localhost:5174/api/auth/canvas/callback",
      state: "state-value",
      codeChallenge: pkce.challenge,
      scopes: "",
    }),
  );
  assert.equal(url.origin + url.pathname, "https://canvas.example.edu/login/oauth2/auth");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("client_secret"), null);
  assert.equal(url.toString().includes("client-secret"), false);
});

test("token payload identity is the numeric canvas id", () => {
  const identity = identityFromToken({
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 3600,
    user: { id: 42, name: "Jimi Hendrix" },
  });
  assert.deepEqual(identity, {
    canvasId: "42",
    name: "Jimi Hendrix",
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 3600,
  });
  const userinfo = identityFromToken({ access_token: null, user: { id: 7, name: "Ada" } });
  assert.equal(userinfo.canvasId, "7");
  assert.equal(userinfo.accessToken, null);
  assert.throws(() => identityFromToken({ user: { id: "nope", name: "Ada" } }), /missing_canvas_id/);
});

test("session cookie round-trips and rejects tampering", () => {
  const token = seal({ canvasId: "42", accessToken: "secret-token" }, "session-secret");
  assert.equal(open(token, "session-secret").accessToken, "secret-token");
  assert.equal(open(token, "other-secret"), null);
  assert.equal(open(`${token}x`, "session-secret"), null);
});

test("start redirects to the configured canvas and ignores a caller-supplied host", async () => {
  const middleware = createCanvasAuthMiddleware(env, { fetch: async () => { throw new Error("unused"); } });
  const response = await invoke(middleware, { url: "/api/auth/canvas/start?host=https://evil.example" });
  assert.equal(response.statusCode, 302);
  const location = new URL(response.headers.location);
  assert.equal(location.origin, "https://canvas.example.edu");
  assert.equal(location.pathname, "/login/oauth2/auth");
  assert.equal(location.searchParams.get("client_secret"), null);
  assert.ok(cookiesOf(response).canvi_oauth);
});

test("callback rejects a missing or mismatched state before talking to canvas", async () => {
  let called = false;
  const middleware = createCanvasAuthMiddleware(env, {
    fetch: async () => {
      called = true;
      throw new Error("should not fetch");
    },
  });
  const response = await invoke(middleware, { url: "/api/auth/canvas/callback?code=abc&state=nope" });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/?auth_error=invalid_state");
  assert.equal(called, false);
});

test("callback stores the canvas id and the session endpoint does not return the token", async () => {
  const middleware = createCanvasAuthMiddleware(env, {
    fetch: async (_url, options) => {
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("client_secret"), "client-secret");
      assert.equal(params.get("code"), "auth-code");
      assert.ok(params.get("code_verifier"));
      return {
        ok: true,
        json: async () => ({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          user: { id: 42, name: "Jimi Hendrix" },
        }),
      };
    },
  });

  const start = await invoke(middleware, { url: "/api/auth/canvas/start" });
  const pending = cookiesOf(start).canvi_oauth;
  const state = new URL(start.headers.location).searchParams.get("state");
  const callback = await invoke(middleware, {
    url: `/api/auth/canvas/callback?code=auth-code&state=${state}`,
    headers: { cookie: `canvi_oauth=${encodeURIComponent(pending)}` },
  });
  assert.equal(callback.headers.location, "/");
  const session = cookiesOf(callback).canvi_session;
  const stored = open(session, env.SESSION_SECRET);
  assert.equal(stored.canvasId, "42");
  assert.equal(stored.accessToken, "access-token");

  const me = await invoke(middleware, {
    url: "/api/auth/session",
    headers: { cookie: `canvi_session=${encodeURIComponent(session)}` },
  });
  const body = JSON.parse(me.body);
  assert.deepEqual(body.user, {
    canvasId: "42",
    name: "Jimi Hendrix",
    host: "canvas.example.edu",
  });
  assert.equal(me.body.includes("access-token"), false);
});

test("unconfigured server refuses to start and does not invent a canvas host", async () => {
  const middleware = createCanvasAuthMiddleware({}, { fetch: async () => { throw new Error("unused"); } });
  const config = await invoke(middleware, { url: "/api/auth/canvas/config" });
  assert.deepEqual(JSON.parse(config.body), { configured: false, host: null });
  const start = await invoke(middleware, { url: "/api/auth/canvas/start" });
  assert.equal(start.headers.location, "/?auth_error=not_configured");
});

test("logout revokes the canvas token and clears the session", async () => {
  const seen = [];
  const middleware = createCanvasAuthMiddleware(env, {
    fetch: async (url, options) => {
      seen.push({ url, method: options.method, authorization: options.headers.authorization });
      return { ok: true, json: async () => ({}) };
    },
  });
  const session = seal(
    {
      v: 1,
      canvasId: "42",
      name: "Jimi Hendrix",
      host: "canvas.example.edu",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60_000,
    },
    env.SESSION_SECRET,
  );
  const response = await invoke(middleware, {
    method: "POST",
    url: "/api/auth/canvas/logout",
    headers: {
      origin: "http://localhost:5174",
      host: "localhost:5174",
      cookie: `canvi_session=${encodeURIComponent(session)}`,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(cookiesOf(response).canvi_session, "");
  assert.equal(seen[0].method, "DELETE");
  assert.equal(seen[0].url, "https://canvas.example.edu/login/oauth2/token");
  assert.equal(seen[0].authorization, "Bearer access-token");
});
