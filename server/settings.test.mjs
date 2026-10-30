import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { seal } from "./canvas-auth.mjs";
import { createCanvasDashboardMiddleware } from "./canvas-dashboard.mjs";
import { createSettingsMiddleware } from "./settings.mjs";
import { createSettingsStore } from "./settings-store.mjs";
import { CONFIRM_DISCONNECT, CONFIRM_REMOVE_CANVAS, CONFIRM_RESET } from "../src/settings/model.js";

const secret = "session-secret";
const env = {
  CANVAS_BASE_URL: "https://canvas.example.edu",
  CANVAS_CLIENT_ID: "client-id",
  CANVAS_CLIENT_SECRET: "client-secret",
  CANVAS_REDIRECT_URI: "http://localhost:5174/api/auth/canvas/callback",
  SESSION_SECRET: secret,
};

function sessionFor(canvasId, token = "access-token") {
  return seal(
    {
      v: 1,
      canvasId,
      name: "Student",
      host: "canvas.example.edu",
      accessToken: token,
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60_000,
    },
    secret,
  );
}

function invoke(middleware, { method = "GET", url = "/api/settings", cookie = "", body, origin = "http://localhost:5174" } = {}) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: {
        cookie: cookie ? `canvi_session=${encodeURIComponent(cookie)}` : "",
        origin,
        host: "localhost:5174",
      },
      socket: {},
      body,
    };
    const res = {
      statusCode: 0,
      headers: {},
      body: "",
      writeHead(code, headers) {
        this.statusCode = code;
        this.headers = headers;
      },
      end(payload) {
        this.body = payload ?? "";
        resolve(this);
      },
    };
    middleware(req, res, () => resolve({ statusCode: 404, headers: {}, body: "next" }));
  });
}

function jsonBody(response) {
  return JSON.parse(response.body);
}

test("settings persist for one student and stay hidden from another", async () => {
  const store = createSettingsStore({ secret });
  const middleware = createSettingsMiddleware(env, { store, fetch: async () => { throw new Error("unused"); } });
  const saved = await invoke(middleware, {
    method: "PUT",
    cookie: sessionFor("42"),
    body: { account: { displayName: "Avery" } },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(jsonBody(saved).settings.account.displayName, "Avery");

  const other = await invoke(middleware, { cookie: sessionFor("7") });
  assert.equal(jsonBody(other).settings.account.displayName, "");

  const again = await invoke(middleware, { cookie: sessionFor("42") });
  assert.equal(jsonBody(again).settings.account.displayName, "Avery");
});

test("a rejected save does not replace stored settings", async () => {
  const store = createSettingsStore({ secret });
  const middleware = createSettingsMiddleware(env, { store, fetch: async () => { throw new Error("unused"); } });
  const cookie = sessionFor("42");
  await invoke(middleware, { method: "PUT", cookie, body: { account: { displayName: "Avery" } } });
  const rejected = await invoke(middleware, {
    method: "PUT",
    cookie,
    body: { account: { timeZone: "Not/AZone", displayName: "Changed" } },
  });
  assert.equal(rejected.statusCode, 400);
  const again = await invoke(middleware, { cookie });
  assert.equal(jsonBody(again).settings.account.displayName, "Avery");
  assert.equal(jsonBody(again).settings.account.timeZone, "UTC");
});

test("a disk failure rolls the save back", () => {
  let writes = 0;
  const store = createSettingsStore({
    secret,
    save() {
      writes += 1;
      if (writes > 1) throw new Error("disk");
    },
  });
  const session = { canvasId: "42", host: "canvas.example.edu" };
  store.replaceSettings(session, { ...store.settingsFor(session), account: { ...store.settingsFor(session).account, displayName: "Avery" } });
  assert.throws(() => store.replaceSettings(session, { ...store.settingsFor(session), account: { displayName: "Changed" } }));
  assert.equal(store.settingsFor(session).account.displayName, "Avery");
});

test("destructive actions wait for confirmation and keep personal reminders", async () => {
  const store = createSettingsStore({ secret });
  const middleware = createSettingsMiddleware(env, { store, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  const cookie = sessionFor("42");
  const session = { canvasId: "42", host: "canvas.example.edu", accessToken: "access-token" };
  store.update(session, (record) => {
    record.settings.personalReminders = [{ id: "p-remind-1", title: "Pack the lab book", courseId: "", dueAt: "2026-11-02" }];
  });
  store.saveSync(session, {
    classes: [{ id: "7", title: "Biology", detail: "BIO", url: null, courseId: "7" }],
    assignments: [],
    tests: [],
    reminders: [],
    catalog: [{ id: "7", title: "Biology", detail: "BIO", url: null, courseId: "7" }],
  });

  const blocked = await invoke(middleware, { method: "POST", url: "/api/canvas/data/remove", cookie, body: {} });
  assert.equal(blocked.statusCode, 400);
  assert.equal(store.cacheFor(session).classes[0].title, "Biology");

  const removed = await invoke(middleware, {
    method: "POST",
    url: "/api/canvas/data/remove",
    cookie,
    body: { confirm: CONFIRM_REMOVE_CANVAS },
  });
  assert.equal(removed.statusCode, 200);
  assert.equal(store.cacheFor(session), null);
  assert.equal(jsonBody(removed).settings.personalReminders[0].title, "Pack the lab book");

  const resetBlocked = await invoke(middleware, { method: "POST", url: "/api/settings/reset", cookie, body: {} });
  assert.equal(resetBlocked.statusCode, 400);
  const reset = await invoke(middleware, {
    method: "POST",
    url: "/api/settings/reset",
    cookie,
    body: { confirm: CONFIRM_RESET },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(jsonBody(reset).settings.personalReminders[0].title, "Pack the lab book");
});

test("a failed sync keeps the last import and a disconnect stops the next fetch", async () => {
  const store = createSettingsStore({ secret });
  const session = { canvasId: "42", host: "canvas.example.edu", accessToken: "access-token" };
  store.saveSync(session, {
    classes: [{ id: "7", title: "Biology", detail: "BIO", url: null, courseId: "7" }],
    assignments: [],
    tests: [],
    reminders: [],
    catalog: [],
  });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 500, headers: { get: () => null }, json: async () => [] };
  };
  const dashboard = createCanvasDashboardMiddleware(env, { store, fetch: fetchImpl });
  const cookie = sessionFor("42");
  const failed = await invoke(dashboard, { url: "/api/canvas/dashboard", cookie });
  assert.equal(jsonBody(failed).classes[0].title, "Biology");
  assert.equal(store.settingsFor(session).canvas.lastSyncError, "unavailable");
  assert.ok(calls > 0);

  const settings = createSettingsMiddleware(env, { store, fetch: fetchImpl });
  const disconnect = await invoke(settings, {
    method: "POST",
    url: "/api/canvas/disconnect",
    cookie,
    body: { confirm: CONFIRM_DISCONNECT },
  });
  assert.equal(disconnect.statusCode, 200);
  assert.equal(jsonBody(disconnect).connection.status, "disconnected");
  const afterDisconnect = calls;
  const next = await invoke(dashboard, { url: "/api/canvas/dashboard", cookie });
  assert.equal(calls, afterDisconnect);
  assert.equal(jsonBody(next).classes[0].title, "Biology");
});

test("sync does not store a payload that contains the access token", async () => {
  const store = createSettingsStore({ secret });
  const session = { canvasId: "42", host: "canvas.example.edu", accessToken: "access-token" };
  store.saveSync(session, {
    classes: [{ id: "7", title: "Biology", detail: "", url: null, courseId: "7" }],
    assignments: [],
    tests: [],
    reminders: [],
    catalog: [],
  });
  const dashboard = createCanvasDashboardMiddleware(env, {
    store,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [{ id: 9, name: "access-token", workflow_state: "available" }],
    }),
  });
  const response = await invoke(dashboard, { url: "/api/canvas/dashboard", cookie: sessionFor("42") });
  assert.equal(response.body.includes("access-token"), false);
  assert.equal(store.cacheFor(session).classes[0].title, "Biology");
});

test("a settings file reloads for the same student only", () => {
  const dir = mkdtempSync(join(tmpdir(), "canvi-settings-"));
  try {
    const filePath = join(dir, "settings.json");
    const first = createSettingsStore({ secret, filePath });
    const session = { canvasId: "42", host: "canvas.example.edu" };
    first.replaceSettings(session, {
      ...first.settingsFor(session),
      account: { ...first.settingsFor(session).account, displayName: "Avery" },
    });
    const second = createSettingsStore({ secret, filePath });
    assert.equal(second.settingsFor(session).account.displayName, "Avery");
    assert.equal(second.settingsFor({ canvasId: "7", host: "canvas.example.edu" }).account.displayName, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
