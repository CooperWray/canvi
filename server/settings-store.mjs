import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { open, seal } from "./canvas-auth.mjs";
import { defaultSettings, normalizeSettings, sanitizeExport } from "../src/settings/model.js";

function userKey(session) {
  return `${session.host}\n${session.canvasId}`;
}

function emptyRecord() {
  return { settings: defaultSettings(), cache: null, catalog: [] };
}

function writeAtomic(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temp, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, filePath);
}

export function createSettingsStore({ secret, filePath = null, load, save, now = () => new Date().toISOString() } = {}) {
  if (!secret) throw new Error("missing_secret");
  const users = new Map();
  const read = load ?? (filePath
    ? () => {
        try {
          return readFileSync(filePath, "utf8");
        } catch {
          return "";
        }
      }
    : () => "");
  const write = save ?? (filePath ? (contents) => writeAtomic(filePath, contents) : null);

  const raw = read();
  if (raw) {
    const stored = open(String(raw), secret);
    if (stored?.users && typeof stored.users === "object") {
      for (const [key, value] of Object.entries(stored.users)) {
        if (!value || typeof value !== "object") continue;
        users.set(key, {
          settings: normalizeSettings(value.settings),
          cache: value.cache ?? null,
          catalog: Array.isArray(value.catalog) ? value.catalog : [],
        });
      }
    }
  }

  function persist() {
    if (!write) return;
    const payload = { v: 1, users: Object.fromEntries(users) };
    write(seal(payload, secret));
  }

  function update(session, mutator) {
    const key = userKey(session);
    const before = users.has(key) ? structuredClone(users.get(key)) : null;
    const record = before ? structuredClone(before) : emptyRecord();
    mutator(record);
    record.settings = normalizeSettings(record.settings);
    users.set(key, record);
    try {
      persist();
    } catch (error) {
      if (before) users.set(key, before);
      else users.delete(key);
      throw error;
    }
    return structuredClone(record);
  }

  return {
    settingsFor(session) {
      const record = users.get(userKey(session));
      return normalizeSettings(record?.settings);
    },

    cacheFor(session) {
      return structuredClone(users.get(userKey(session))?.cache ?? null);
    },

    catalogFor(session) {
      const record = users.get(userKey(session));
      return structuredClone(record?.catalog ?? record?.cache?.catalog ?? []);
    },

    update(session, mutator) {
      return update(session, mutator);
    },

    replaceSettings(session, settings) {
      return update(session, (record) => {
        const previous = record.settings.canvas;
        record.settings = settings;
        record.settings.canvas.disconnected = previous.disconnected;
        record.settings.canvas.lastSyncAt = previous.lastSyncAt;
        record.settings.canvas.lastSyncError = previous.lastSyncError;
      });
    },

    saveSync(session, dashboard, { error = null } = {}) {
      return update(session, (record) => {
        const safe = sanitizeExport(dashboard ?? {});
        record.cache = {
          classes: Array.isArray(safe.classes) ? safe.classes : [],
          assignments: Array.isArray(safe.assignments) ? safe.assignments : [],
          tests: Array.isArray(safe.tests) ? safe.tests : [],
          reminders: Array.isArray(safe.reminders) ? safe.reminders : [],
          catalog: Array.isArray(safe.catalog) ? safe.catalog : [],
          partial: safe.partial === true,
          failedCourseIds: Array.isArray(safe.failedCourseIds) ? safe.failedCourseIds : [],
        };
        record.catalog = record.cache.catalog;
        record.settings.canvas.lastSyncAt = now();
        record.settings.canvas.lastSyncError = error;
      });
    },

    markSync(session, { error }) {
      return update(session, (record) => {
        record.settings.canvas.lastSyncError = error;
      });
    },

    markConnected(session) {
      return update(session, (record) => {
        record.settings.canvas.disconnected = false;
      });
    },

    disconnect(session) {
      return update(session, (record) => {
        record.settings.canvas.disconnected = true;
      });
    },

    removeImported(session) {
      return update(session, (record) => {
        record.cache = null;
        record.catalog = [];
        record.settings.canvas.lastSyncAt = null;
        record.settings.canvas.lastSyncError = null;
      });
    },
  };
}
