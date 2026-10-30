import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OAUTH_COOKIE = "canvi_oauth";
export const SESSION_COOKIE = "canvi_session";
const OAUTH_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

const AUTH_ERRORS = {
  not_configured: "Canvas sign-in is not configured on this server yet.",
  access_denied: "Canvas did not grant access.",
  invalid_state: "This sign-in attempt expired. Try again.",
  invalid_scope: "The Canvas developer key rejected the requested scopes.",
  token_exchange_failed: "Canvas did not return a session. Check the developer key and redirect URI.",
  missing_canvas_id: "Canvas did not return a user id.",
  oauth_error: "Canvas could not complete sign-in.",
};

export function authErrorMessage(code) {
  return AUTH_ERRORS[code] ?? null;
}

export function canvasOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_host");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("invalid_host");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("invalid_host");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
  throw new Error("invalid_host");
}

export function assertRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_redirect");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || url.search || url.hash) throw new Error("invalid_redirect");
  if (url.pathname !== "/api/auth/canvas/callback") throw new Error("invalid_redirect");
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.toString();
  throw new Error("invalid_redirect");
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}

export function createState() {
  return randomBytes(32).toString("base64url");
}

export function buildAuthorizeUrl({ origin, clientId, redirectUri, state, codeChallenge, scopes }) {
  const url = new URL("/login/oauth2/auth", origin);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("purpose", "Canvi");
  if (scopes) url.searchParams.set("scope", scopes);
  return url.toString();
}

export function identityFromToken(payload) {
  const user = payload?.user;
  const canvasId = user?.id == null ? "" : String(user.id).trim();
  if (!/^[0-9]+$/.test(canvasId)) throw new Error("missing_canvas_id");
  const name = typeof user.name === "string" && user.name.trim() ? user.name.trim() : `Canvas ${canvasId}`;
  return {
    canvasId,
    name,
    accessToken: typeof payload.access_token === "string" && payload.access_token ? payload.access_token : null,
    refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : null,
    expiresIn: Number.isFinite(Number(payload.expires_in)) ? Number(payload.expires_in) : null,
  };
}

export function publicIdentity(session) {
  return {
    canvasId: session.canvasId,
    name: session.name,
    host: session.host,
  };
}

function keyFromSecret(secret) {
  return createHash("sha256").update(secret).digest();
}

export function seal(payload, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64url");
}

export function open(token, secret) {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      cookies[key] = "";
    }
  }
  return cookies;
}

function cookie(name, value, { maxAge, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function readConfig(env) {
  return {
    baseUrl: env.CANVAS_BASE_URL?.trim() ?? "",
    clientId: env.CANVAS_CLIENT_ID?.trim() ?? "",
    clientSecret: env.CANVAS_CLIENT_SECRET?.trim() ?? "",
    redirectUri: env.CANVAS_REDIRECT_URI?.trim() ?? "",
    scopes: env.CANVAS_OAUTH_SCOPES?.trim() ?? "",
    sessionSecret: env.SESSION_SECRET?.trim() ?? "",
  };
}

export function canvasServerConfig(env) {
  return configured(readConfig(env));
}

export function sessionFromCookieHeader(cookieHeader, secret) {
  if (!secret) return null;
  const cookies = parseCookies(cookieHeader);
  const session = open(cookies[SESSION_COOKIE] ?? "", secret);
  if (!session?.canvasId || !session.accessToken || !session.host) return null;
  if (session.expiresAt && session.expiresAt <= Date.now() + 30_000) return null;
  return session;
}

function configured(config) {
  if (!config.clientId || !config.clientSecret || !config.sessionSecret || !config.redirectUri) return null;
  try {
    return {
      ...config,
      origin: canvasOrigin(config.baseUrl),
      redirectUri: assertRedirectUri(config.redirectUri),
    };
  } catch {
    return null;
  }
}

function hostOf(origin) {
  return new URL(origin).host;
}

function secureRequest(req) {
  return Boolean(req.socket?.encrypted);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function redirect(res, location, cookies = []) {
  const headers = {
    Location: location,
    "Cache-Control": "no-store",
  };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function json(res, status, body, cookies = []) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function mappedOAuthError(code) {
  if (code === "access_denied" || code === "invalid_scope") return code;
  return "oauth_error";
}

async function postToken(fetchImpl, origin, params) {
  const response = await fetchImpl(`${origin}/login/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("token_exchange_failed");
  return response.json();
}

export async function revokeAccessToken(fetchImpl, origin, accessToken) {
  if (!accessToken) return;
  try {
    await fetchImpl(`${origin}/login/oauth2/token`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Revocation is best-effort. The local session is cleared either way.
  }
}

export function readStoredSession(cookieHeader, secret) {
  if (!secret) return null;
  const cookies = parseCookies(cookieHeader);
  const session = open(cookies[SESSION_COOKIE] ?? "", secret);
  if (!session?.canvasId || !session.host) return null;
  if (!/^[0-9]+$/.test(String(session.canvasId))) return null;
  return session;
}

export function accessTokenUsable(session, now = Date.now()) {
  if (!session?.accessToken || typeof session.accessToken !== "string") return false;
  if (session.expiresAt && session.expiresAt <= now + 30_000) return false;
  return true;
}

export function sealSessionCookie(session, secret, { secure }) {
  return cookie(SESSION_COOKIE, seal(session, secret), { maxAge: SESSION_TTL_SECONDS, secure });
}

function sessionFromIdentity(identity, host) {
  const expiresAt = identity.accessToken && identity.expiresIn ? Date.now() + identity.expiresIn * 1000 : null;
  return {
    v: 1,
    canvasId: identity.canvasId,
    name: identity.name,
    host,
    accessToken: identity.accessToken,
    refreshToken: identity.refreshToken,
    expiresAt,
  };
}

export function createCanvasAuthMiddleware(env, { fetch: fetchImpl = fetch, onSession } = {}) {
  const config = configured(readConfig(env));

  return function canvasAuth(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const isAuthRoute =
      path === "/api/auth/canvas/config" ||
      path === "/api/auth/canvas/start" ||
      path === "/api/auth/canvas/callback" ||
      path === "/api/auth/canvas/logout" ||
      path === "/api/auth/session";
    if (!isAuthRoute) return next();

    const secure = secureRequest(req);
    const cookies = parseCookies(req.headers.cookie);

    if (path === "/api/auth/canvas/config" && req.method === "GET") {
      return json(res, 200, {
        configured: Boolean(config),
        host: config ? hostOf(config.origin) : null,
      });
    }

    if (path === "/api/auth/canvas/start" && req.method === "GET") {
      if (!config) return redirect(res, "/?auth_error=not_configured");
      const state = createState();
      const pkce = createPkcePair();
      const pending = seal(
        { v: 1, state, verifier: pkce.verifier, exp: Date.now() + OAUTH_TTL_MS },
        config.sessionSecret,
      );
      const location = buildAuthorizeUrl({
        origin: config.origin,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
        codeChallenge: pkce.challenge,
        scopes: config.scopes,
      });
      return redirect(res, location, [cookie(OAUTH_COOKIE, pending, { maxAge: OAUTH_TTL_MS / 1000, secure })]);
    }

    if (path === "/api/auth/canvas/callback" && req.method === "GET") {
      const clearPending = cookie(OAUTH_COOKIE, "", { maxAge: 0, secure });
      if (!config) return redirect(res, "/?auth_error=not_configured", [clearPending]);

      const pending = open(cookies[OAUTH_COOKIE] ?? "", config.sessionSecret);
      const stateOk = pending && pending.exp > Date.now() && safeEqual(pending.state, url.searchParams.get("state") ?? "");
      if (!stateOk) return redirect(res, "/?auth_error=invalid_state", [clearPending]);

      const oauthError = url.searchParams.get("error");
      if (oauthError) return redirect(res, `/?auth_error=${mappedOAuthError(oauthError)}`, [clearPending]);

      const code = url.searchParams.get("code");
      if (!code) return redirect(res, "/?auth_error=oauth_error", [clearPending]);

      return postToken(fetchImpl, config.origin, {
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: pending.verifier,
      })
        .then((payload) => {
          const identity = identityFromToken(payload);
          const session = sessionFromIdentity(identity, hostOf(config.origin));
          if (onSession) onSession(session);
          const sealed = seal(session, config.sessionSecret);
          return redirect(res, "/", [
            clearPending,
            cookie(SESSION_COOKIE, sealed, { maxAge: SESSION_TTL_SECONDS, secure }),
          ]);
        })
        .catch((error) => {
          const codeName = error?.message === "missing_canvas_id" ? "missing_canvas_id" : "token_exchange_failed";
          return redirect(res, `/?auth_error=${codeName}`, [clearPending]);
        });
    }

    if (path === "/api/auth/session" && req.method === "GET") {
      if (!config) return json(res, 200, { user: null });
      const session = open(cookies[SESSION_COOKIE] ?? "", config.sessionSecret);
      if (!session?.canvasId) return json(res, 200, { user: null });

      const needsRefresh = session.accessToken && session.expiresAt && session.expiresAt <= Date.now() + 30_000;
      if (!needsRefresh || !session.refreshToken) return json(res, 200, { user: publicIdentity(session) });

      return postToken(fetchImpl, config.origin, {
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        refresh_token: session.refreshToken,
      })
        .then((payload) => {
          const identity = identityFromToken(payload);
          const next = sessionFromIdentity(
            { ...identity, refreshToken: identity.refreshToken ?? session.refreshToken },
            session.host,
          );
          return json(res, 200, { user: publicIdentity(next) }, [
            cookie(SESSION_COOKIE, seal(next, config.sessionSecret), { maxAge: SESSION_TTL_SECONDS, secure }),
          ]);
        })
        .catch(() => json(res, 200, { user: null }, [cookie(SESSION_COOKIE, "", { maxAge: 0, secure })]));
    }

    if (path === "/api/auth/canvas/logout" && req.method === "POST") {
      if (!sameOrigin(req)) return json(res, 403, { ok: false });
      const clearSession = cookie(SESSION_COOKIE, "", { maxAge: 0, secure });
      if (!config) return json(res, 200, { ok: true }, [clearSession]);
      const session = open(cookies[SESSION_COOKIE] ?? "", config.sessionSecret);
      return revokeAccessToken(fetchImpl, config.origin, session?.accessToken).then(() =>
        json(res, 200, { ok: true }, [clearSession]),
      );
    }

    return json(res, 405, { ok: false });
  };
}
