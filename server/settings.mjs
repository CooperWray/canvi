import { accessTokenUsable, readStoredSession, revokeAccessToken, sealSessionCookie } from "./canvas-auth.mjs";
import { canvasServerConfig } from "./canvas-auth.mjs";
import { refreshCanvasCache } from "./canvas-dashboard.mjs";
import {
  CONFIRM_DISCONNECT,
  CONFIRM_REMOVE_CANVAS,
  CONFIRM_RESET,
  LIMITS,
  applyPatch,
  describeConnection,
  exportPayload,
  resetPreferences,
} from "../src/settings/model.js";

const ROUTES = new Set([
  "/api/settings",
  "/api/settings/reset",
  "/api/settings/export",
  "/api/canvas/sync",
  "/api/canvas/disconnect",
  "/api/canvas/data/remove",
  "/api/canvas/connection",
]);

const MESSAGES = {
  invalid_patch: "Canvi could not use those settings.",
  invalid_choice: "Canvi could not use that choice.",
  invalid_time_zone: "Choose a time zone from the list.",
  too_large: "That change is too large.",
  confirmation_required: "Confirm this action before Canvi changes your data.",
  disconnected: "Canvas sync is off. Reconnect before you sync.",
  sign_in: "Sign in again to change settings.",
  not_configured: "Settings storage is not configured on this server.",
  save_failed: "Canvi could not save settings.",
  forbidden: "Canvi refused this request.",
};

function json(res, status, body, cookies = []) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function fail(res, status, code, cookies = []) {
  return json(res, status, { ok: false, error: code, message: MESSAGES[code] ?? MESSAGES.invalid_patch }, cookies);
}

function secureRequest(req) {
  return Boolean(req.socket?.encrypted);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readBody(req, limit = 100_000) {
  if (Object.prototype.hasOwnProperty.call(req, "body")) return Promise.resolve(req.body ?? null);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error("too_large"), { code: "too_large" }));
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      if (!chunks.length) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("invalid_patch"), { code: "invalid_patch" }));
      }
    });
    req.on("error", () => reject(Object.assign(new Error("invalid_patch"), { code: "invalid_patch" })));
  });
}

function snapshot(store, session, config) {
  const settings = store.settingsFor(session);
  const host = new URL(config.origin).host;
  return {
    ok: true,
    settings,
    catalog: store.catalogFor(session),
    connection: describeConnection({
      settings,
      usable: accessTokenUsable(session) && !settings.canvas.disconnected,
      host,
      url: config.origin,
    }),
    limits: LIMITS,
  };
}

export function createSettingsMiddleware(env, { fetch: fetchImpl = fetch, store = null } = {}) {
  const config = canvasServerConfig(env);

  return function settings(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!ROUTES.has(url.pathname)) return next();
    if (!config || !store) return fail(res, 503, "not_configured");

    const session = readStoredSession(req.headers.cookie, config.sessionSecret);
    if (!session || session.host !== new URL(config.origin).host) return fail(res, 401, "sign_in");

    const method = req.method ?? "GET";
    const secure = secureRequest(req);
    const mutating = method !== "GET";
    if (mutating && !originAllowed(req)) return fail(res, 403, "forbidden");

    const send = (status, extra = {}, cookies = []) =>
      json(res, status, { ...snapshot(store, session, config), ok: status < 400, ...extra }, cookies);

    if (url.pathname === "/api/settings" && method === "GET") return send(200);
    if (url.pathname === "/api/canvas/connection" && method === "GET") return send(200);

    if (url.pathname === "/api/settings" && method === "PUT") {
      return readBody(req)
        .then((patch) => {
          const next = applyPatch(store.settingsFor(session), patch ?? {});
          store.replaceSettings(session, next);
          return send(200);
        })
        .catch((error) => fail(res, error?.code === "too_large" ? 413 : 400, error?.code || "invalid_patch"));
    }

    if (url.pathname === "/api/settings/reset" && method === "POST") {
      return readBody(req)
        .then((body) => {
          if (body?.confirm !== CONFIRM_RESET) return fail(res, 400, "confirmation_required");
          store.replaceSettings(session, resetPreferences(store.settingsFor(session)));
          return send(200);
        })
        .catch((error) => fail(res, 400, error?.code || "invalid_patch"));
    }

    if (url.pathname === "/api/settings/export" && method === "POST") {
      const settings = store.settingsFor(session);
      const payload = exportPayload({
        settings,
        cache: store.cacheFor(session),
        catalog: store.catalogFor(session),
        host: session.host,
        exportedAt: new Date().toISOString(),
      });
      return json(res, 200, payload);
    }

    if (url.pathname === "/api/canvas/sync" && method === "POST") {
      const settings = store.settingsFor(session);
      if (settings.canvas.disconnected) return fail(res, 409, "disconnected");
      if (!accessTokenUsable(session)) {
        store.markSync(session, { error: "expired" });
        return send(409, { error: "expired", preserved: Boolean(store.cacheFor(session)) });
      }
      return refreshCanvasCache(fetchImpl, { origin: config.origin, session, store }).then((result) => {
        const status = result.error && result.error !== "partial" ? 502 : 200;
        return send(status, {
          error: result.error,
          preserved: result.preserved,
          dashboard: result.dashboard,
          message: snapshot(store, session, config).connection.message,
        });
      });
    }

    if (url.pathname === "/api/canvas/disconnect" && method === "POST") {
      return readBody(req)
        .then(async (body) => {
          if (body?.confirm !== CONFIRM_DISCONNECT) return fail(res, 400, "confirmation_required");
          store.disconnect(session);
          await revokeAccessToken(fetchImpl, config.origin, session.accessToken);
          const cleared = sealSessionCookie(
            { v: 1, canvasId: session.canvasId, name: session.name, host: session.host },
            config.sessionSecret,
            { secure },
          );
          return send(200, { preserved: Boolean(store.cacheFor(session)) }, [cleared]);
        })
        .catch(() => fail(res, 500, "save_failed"));
    }

    if (url.pathname === "/api/canvas/data/remove" && method === "POST") {
      return readBody(req)
        .then((body) => {
          if (body?.confirm !== CONFIRM_REMOVE_CANVAS) return fail(res, 400, "confirmation_required");
          const personal = store.settingsFor(session).personalReminders;
          store.removeImported(session);
          const after = store.settingsFor(session);
          if (JSON.stringify(after.personalReminders) !== JSON.stringify(personal)) {
            return fail(res, 500, "save_failed");
          }
          return send(200);
        })
        .catch(() => fail(res, 500, "save_failed"));
    }

    return fail(res, 405, "invalid_patch");
  };
}
