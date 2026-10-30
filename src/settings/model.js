export const LIMITS = {
  emailEdit: false,
  profilePhoto: false,
  emailDelivery: false,
  backgroundScheduler: false,
  accountDeletion: false,
};

export const CLASS_COLORS = [
  { id: "gold", label: "Gold", value: "#8d6b2b" },
  { id: "pine", label: "Pine", value: "#1f6b45" },
  { id: "sea", label: "Sea", value: "#1d5f86" },
  { id: "plum", label: "Plum", value: "#68407a" },
  { id: "clay", label: "Clay", value: "#8a4a32" },
  { id: "ink", label: "Ink", value: "#334155" },
  { id: "berry", label: "Berry", value: "#8e3d5a" },
  { id: "olive", label: "Olive", value: "#4f6724" },
];

export const CLASS_ICONS = [
  { id: "", label: "None" },
  { id: "book", label: "Book" },
  { id: "beaker", label: "Beaker" },
  { id: "pencil", label: "Pencil" },
  { id: "globe", label: "Globe" },
  { id: "note", label: "Note" },
  { id: "star", label: "Star" },
];

export const REMINDER_TIMINGS = [
  { id: "1h", label: "1 hour before" },
  { id: "1d", label: "1 day before" },
  { id: "3d", label: "3 days before" },
];

const TIMING_MS = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
};

const LEAD_WINDOW_MS = 30 * 60 * 1000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const COURSE_ID = /^[0-9]+$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const ITEM_ID = /^[A-Za-z0-9:_-]{1,80}$/;
const SECRET_KEY = /token|secret|cookie|authorization|password/i;

const VIEWS = ["upcoming", "today", "week", "all"];
const SORTS = ["due", "class", "priority"];
const GROUPS = ["date", "class"];
const WEEKDAYS = ["sunday", "monday"];
const THEMES = ["light", "dark", "system"];
const DENSITIES = ["comfortable", "compact"];
const LANDINGS = ["dashboard", "settings"];
const REMINDER_MODES = ["inherit", "on", "off"];
const SECTION_IDS = ["classes", "assignments", "tests", "reminders"];

export function defaultClassPrefs() {
  return {
    hidden: false,
    displayName: "",
    color: "gold",
    icon: "",
    archived: false,
    reminders: "inherit",
  };
}

export function defaultSettings() {
  return {
    version: 1,
    account: {
      displayName: "",
      timeZone: "UTC",
      timeZoneSet: false,
      dateFormat: "ymd",
      timeFormat: "12",
    },
    canvas: {
      disconnected: false,
      includeConcluded: false,
      courseIds: null,
      lastSyncAt: null,
      lastSyncError: null,
    },
    classes: {},
    classOrder: [],
    work: {
      defaultView: "upcoming",
      sort: "due",
      showSubmitted: false,
      showCompletedTasks: false,
      showOverdue: true,
      showUndated: true,
      groupBy: "date",
      weekStartsOn: "monday",
      importantIds: [],
      completedIds: [],
      testLabels: [],
    },
    manualTests: [],
    personalReminders: [],
    reminders: {
      enabled: true,
      assignments: true,
      tests: true,
      personal: true,
      timings: ["1d"],
      digestEnabled: false,
      digestTime: "08:00",
      quietStart: "",
      quietEnd: "",
      browserEnabled: false,
    },
    appearance: {
      theme: "system",
      density: "comfortable",
      landing: "dashboard",
      sections: {
        classes: true,
        assignments: true,
        tests: true,
        reminders: true,
      },
      sectionOrder: [...SECTION_IDS],
    },
  };
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectSecrets(value, depth = 0) {
  if (depth > 8 || !value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (SECRET_KEY.test(key)) throw fail("invalid_patch");
    rejectSecrets(value[key], depth + 1);
  }
}

function expectBoolean(value) {
  if (typeof value !== "boolean") throw fail("invalid_choice");
  return value;
}

function expectEnum(value, allowed) {
  if (!allowed.includes(value)) throw fail("invalid_choice");
  return value;
}

function cleanText(value, max) {
  if (typeof value !== "string") throw fail("invalid_patch");
  const text = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (text.length > max) throw fail("too_large");
  return text;
}

function expectIdList(value, max, pattern) {
  if (!Array.isArray(value) || value.length > max) throw fail("too_large");
  const next = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !pattern.test(entry) || next.includes(entry)) throw fail("invalid_patch");
    next.push(entry);
  }
  return next;
}

function expectClock(value) {
  if (typeof value !== "string" || !CLOCK.test(value)) throw fail("invalid_choice");
  return value;
}

function expectDue(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw fail("invalid_patch");
  if (DATE_KEY.test(value)) return value;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw fail("invalid_patch");
  return new Date(time).toISOString();
}

function expectCourseId(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !COURSE_ID.test(value)) throw fail("invalid_patch");
  return value;
}

let timeZones;

function knownZones() {
  if (!timeZones) {
    timeZones = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"]);
    timeZones.add("UTC");
  }
  return timeZones;
}

export function isTimeZone(value) {
  return typeof value === "string" && knownZones().has(value);
}

function expectTimeZone(value) {
  if (!isTimeZone(value)) throw fail("invalid_time_zone");
  return value;
}

function classPrefsPatch(value) {
  if (!isPlainObject(value)) throw fail("invalid_patch");
  const next = {};
  if ("hidden" in value) next.hidden = expectBoolean(value.hidden);
  if ("archived" in value) next.archived = expectBoolean(value.archived);
  if ("displayName" in value) next.displayName = cleanText(value.displayName, 80);
  if ("color" in value) {
    if (!CLASS_COLORS.some((color) => color.id === value.color)) throw fail("invalid_choice");
    next.color = value.color;
  }
  if ("icon" in value) {
    if (!CLASS_ICONS.some((icon) => icon.id === value.icon)) throw fail("invalid_choice");
    next.icon = value.icon;
  }
  if ("reminders" in value) next.reminders = expectEnum(value.reminders, REMINDER_MODES);
  return next;
}

function manualTestPatch(value) {
  if (!isPlainObject(value)) throw fail("invalid_patch");
  return {
    id: cleanText(value.id ?? "", 80),
    title: cleanText(value.title ?? "", 140),
    courseId: expectCourseId(value.courseId),
    dueAt: expectDue(value.dueAt),
  };
}

function assertItemId(value) {
  if (typeof value !== "string" || !ITEM_ID.test(value)) throw fail("invalid_patch");
  return value;
}

function manualTestsPatch(value) {
  if (!Array.isArray(value) || value.length > 100) throw fail("too_large");
  return value.map((entry) => {
    const item = manualTestPatch(entry);
    item.id = assertItemId(item.id);
    if (!item.title) throw fail("invalid_patch");
    return item;
  });
}

function personalPatch(value) {
  if (!Array.isArray(value) || value.length > 100) throw fail("too_large");
  return value.map((entry) => {
    const item = manualTestPatch(entry);
    item.id = assertItemId(item.id);
    if (!item.title) throw fail("invalid_patch");
    return item;
  });
}

export function applyPatch(current, patch) {
  if (!isPlainObject(patch)) throw fail("invalid_patch");
  rejectSecrets(patch);
  const next = normalizeSettings(current);

  if ("account" in patch) {
    if (!isPlainObject(patch.account)) throw fail("invalid_patch");
    const account = patch.account;
    if ("displayName" in account) next.account.displayName = cleanText(account.displayName, 80);
    if ("timeZone" in account) {
      next.account.timeZone = expectTimeZone(account.timeZone);
      next.account.timeZoneSet = true;
    }
    if ("timeZoneSet" in account) next.account.timeZoneSet = expectBoolean(account.timeZoneSet);
    if ("dateFormat" in account) next.account.dateFormat = expectEnum(account.dateFormat, ["ymd", "mdy", "dmy"]);
    if ("timeFormat" in account) next.account.timeFormat = expectEnum(account.timeFormat, ["12", "24"]);
  }

  if ("canvas" in patch) {
    if (!isPlainObject(patch.canvas)) throw fail("invalid_patch");
    const canvas = patch.canvas;
    if ("disconnected" in canvas || "lastSyncAt" in canvas || "lastSyncError" in canvas) throw fail("invalid_patch");
    if ("includeConcluded" in canvas) next.canvas.includeConcluded = expectBoolean(canvas.includeConcluded);
    if ("courseIds" in canvas) {
      next.canvas.courseIds = canvas.courseIds == null ? null : expectIdList(canvas.courseIds, 20, COURSE_ID);
    }
  }

  if ("classes" in patch) {
    if (!isPlainObject(patch.classes)) throw fail("invalid_patch");
    for (const [id, value] of Object.entries(patch.classes)) {
      if (!COURSE_ID.test(id)) throw fail("invalid_patch");
      next.classes[id] = { ...defaultClassPrefs(), ...next.classes[id], ...classPrefsPatch(value) };
    }
  }

  if ("classOrder" in patch) next.classOrder = expectIdList(patch.classOrder, 50, COURSE_ID);

  if ("work" in patch) {
    if (!isPlainObject(patch.work)) throw fail("invalid_patch");
    const work = patch.work;
    if ("defaultView" in work) next.work.defaultView = expectEnum(work.defaultView, VIEWS);
    if ("sort" in work) next.work.sort = expectEnum(work.sort, SORTS);
    if ("showSubmitted" in work) next.work.showSubmitted = expectBoolean(work.showSubmitted);
    if ("showCompletedTasks" in work) next.work.showCompletedTasks = expectBoolean(work.showCompletedTasks);
    if ("showOverdue" in work) next.work.showOverdue = expectBoolean(work.showOverdue);
    if ("showUndated" in work) next.work.showUndated = expectBoolean(work.showUndated);
    if ("groupBy" in work) next.work.groupBy = expectEnum(work.groupBy, GROUPS);
    if ("weekStartsOn" in work) next.work.weekStartsOn = expectEnum(work.weekStartsOn, WEEKDAYS);
    if ("importantIds" in work) next.work.importantIds = expectIdList(work.importantIds, 200, ITEM_ID);
    if ("completedIds" in work) next.work.completedIds = expectIdList(work.completedIds, 400, ITEM_ID);
    if ("testLabels" in work) next.work.testLabels = expectIdList(work.testLabels, 200, ITEM_ID);
  }

  if ("manualTests" in patch) next.manualTests = manualTestsPatch(patch.manualTests);
  if ("personalReminders" in patch) next.personalReminders = personalPatch(patch.personalReminders);

  if ("reminders" in patch) {
    if (!isPlainObject(patch.reminders)) throw fail("invalid_patch");
    const reminders = patch.reminders;
    if ("enabled" in reminders) next.reminders.enabled = expectBoolean(reminders.enabled);
    if ("assignments" in reminders) next.reminders.assignments = expectBoolean(reminders.assignments);
    if ("tests" in reminders) next.reminders.tests = expectBoolean(reminders.tests);
    if ("personal" in reminders) next.reminders.personal = expectBoolean(reminders.personal);
    if ("timings" in reminders) {
      const timings = expectIdList(reminders.timings, 3, /^(1h|1d|3d)$/);
      if (!timings.length) throw fail("invalid_choice");
      next.reminders.timings = REMINDER_TIMINGS.map((item) => item.id).filter((id) => timings.includes(id));
    }
    if ("digestEnabled" in reminders) next.reminders.digestEnabled = expectBoolean(reminders.digestEnabled);
    if ("digestTime" in reminders) next.reminders.digestTime = expectClock(reminders.digestTime);
    if ("quietStart" in reminders || "quietEnd" in reminders) {
      const start = "quietStart" in reminders ? reminders.quietStart : next.reminders.quietStart;
      const end = "quietEnd" in reminders ? reminders.quietEnd : next.reminders.quietEnd;
      if (start === "" && end === "") {
        next.reminders.quietStart = "";
        next.reminders.quietEnd = "";
      } else {
        next.reminders.quietStart = expectClock(start);
        next.reminders.quietEnd = expectClock(end);
        if (next.reminders.quietStart === next.reminders.quietEnd) throw fail("invalid_choice");
      }
    }
    if ("browserEnabled" in reminders) next.reminders.browserEnabled = expectBoolean(reminders.browserEnabled);
    if ("emailEnabled" in reminders) throw fail("invalid_patch");
  }

  if ("appearance" in patch) {
    if (!isPlainObject(patch.appearance)) throw fail("invalid_patch");
    const appearance = patch.appearance;
    if ("theme" in appearance) next.appearance.theme = expectEnum(appearance.theme, THEMES);
    if ("density" in appearance) next.appearance.density = expectEnum(appearance.density, DENSITIES);
    if ("landing" in appearance) next.appearance.landing = expectEnum(appearance.landing, LANDINGS);
    if ("sections" in appearance) {
      if (!isPlainObject(appearance.sections)) throw fail("invalid_patch");
      for (const id of SECTION_IDS) {
        if (id in appearance.sections) next.appearance.sections[id] = expectBoolean(appearance.sections[id]);
      }
    }
    if ("sectionOrder" in appearance) {
      const order = expectIdList(appearance.sectionOrder, 4, /^(classes|assignments|tests|reminders)$/);
      if (order.length !== 4 || new Set(order).size !== 4) throw fail("invalid_choice");
      next.appearance.sectionOrder = order;
    }
  }

  return next;
}

function coerceText(value, max, fallback) {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function coerceIdList(value, max, pattern, fallback) {
  if (!Array.isArray(value)) return fallback;
  const next = [];
  for (const entry of value) {
    if (typeof entry === "string" && pattern.test(entry) && !next.includes(entry)) next.push(entry);
    if (next.length >= max) break;
  }
  return next;
}

export function normalizeSettings(input) {
  const base = defaultSettings();
  if (!isPlainObject(input)) return base;
  const account = isPlainObject(input.account) ? input.account : {};
  base.account.displayName = coerceText(account.displayName, 80, "");
  base.account.timeZone = isTimeZone(account.timeZone) ? account.timeZone : "UTC";
  base.account.timeZoneSet = account.timeZoneSet === true;
  base.account.dateFormat = ["ymd", "mdy", "dmy"].includes(account.dateFormat) ? account.dateFormat : "ymd";
  base.account.timeFormat = account.timeFormat === "24" ? "24" : "12";

  const canvas = isPlainObject(input.canvas) ? input.canvas : {};
  base.canvas.disconnected = canvas.disconnected === true;
  base.canvas.includeConcluded = canvas.includeConcluded === true;
  base.canvas.courseIds = canvas.courseIds == null ? null : coerceIdList(canvas.courseIds, 20, COURSE_ID, null);
  base.canvas.lastSyncAt = typeof canvas.lastSyncAt === "string" && Number.isFinite(Date.parse(canvas.lastSyncAt)) ? canvas.lastSyncAt : null;
  base.canvas.lastSyncError = ["partial", "expired", "unavailable"].includes(canvas.lastSyncError) ? canvas.lastSyncError : null;

  const classes = isPlainObject(input.classes) ? input.classes : {};
  for (const [id, value] of Object.entries(classes)) {
    if (!COURSE_ID.test(id) || !isPlainObject(value)) continue;
    const prefs = defaultClassPrefs();
    prefs.hidden = value.hidden === true;
    prefs.archived = value.archived === true;
    prefs.displayName = coerceText(value.displayName, 80, "");
    prefs.color = CLASS_COLORS.some((color) => color.id === value.color) ? value.color : "gold";
    prefs.icon = CLASS_ICONS.some((icon) => icon.id === value.icon) ? value.icon : "";
    prefs.reminders = REMINDER_MODES.includes(value.reminders) ? value.reminders : "inherit";
    base.classes[id] = prefs;
  }

  base.classOrder = coerceIdList(input.classOrder, 50, COURSE_ID, []);
  const work = isPlainObject(input.work) ? input.work : {};
  base.work.defaultView = VIEWS.includes(work.defaultView) ? work.defaultView : "upcoming";
  base.work.sort = SORTS.includes(work.sort) ? work.sort : "due";
  base.work.showSubmitted = work.showSubmitted === true;
  base.work.showCompletedTasks = work.showCompletedTasks === true;
  base.work.showOverdue = work.showOverdue !== false;
  base.work.showUndated = work.showUndated !== false;
  base.work.groupBy = GROUPS.includes(work.groupBy) ? work.groupBy : "date";
  base.work.weekStartsOn = work.weekStartsOn === "sunday" ? "sunday" : "monday";
  base.work.importantIds = coerceIdList(work.importantIds, 200, ITEM_ID, []);
  base.work.completedIds = coerceIdList(work.completedIds, 400, ITEM_ID, []);
  base.work.testLabels = coerceIdList(work.testLabels, 200, ITEM_ID, []);

  const healItems = (value) => {
    if (!Array.isArray(value)) return [];
    const items = [];
    for (const entry of value) {
      if (!isPlainObject(entry) || items.length >= 100) continue;
      const id = typeof entry.id === "string" && ITEM_ID.test(entry.id) ? entry.id : "";
      const title = coerceText(entry.title, 140, "");
      if (!id || !title) continue;
      items.push({
        id,
        title,
        courseId: typeof entry.courseId === "string" && COURSE_ID.test(entry.courseId) ? entry.courseId : "",
        dueAt: expectDueSafe(entry.dueAt),
      });
    }
    return items;
  };
  base.manualTests = healItems(input.manualTests);
  base.personalReminders = healItems(input.personalReminders);

  const reminders = isPlainObject(input.reminders) ? input.reminders : {};
  base.reminders.enabled = reminders.enabled !== false;
  base.reminders.assignments = reminders.assignments !== false;
  base.reminders.tests = reminders.tests !== false;
  base.reminders.personal = reminders.personal !== false;
  const timings = coerceIdList(reminders.timings, 3, /^(1h|1d|3d)$/, ["1d"]);
  base.reminders.timings = timings.length ? REMINDER_TIMINGS.map((item) => item.id).filter((id) => timings.includes(id)) : ["1d"];
  base.reminders.digestEnabled = reminders.digestEnabled === true;
  base.reminders.digestTime = typeof reminders.digestTime === "string" && CLOCK.test(reminders.digestTime) ? reminders.digestTime : "08:00";
  const quietStart = typeof reminders.quietStart === "string" && CLOCK.test(reminders.quietStart) ? reminders.quietStart : "";
  const quietEnd = typeof reminders.quietEnd === "string" && CLOCK.test(reminders.quietEnd) ? reminders.quietEnd : "";
  if (quietStart && quietEnd && quietStart !== quietEnd) {
    base.reminders.quietStart = quietStart;
    base.reminders.quietEnd = quietEnd;
  }
  base.reminders.browserEnabled = reminders.browserEnabled === true;

  const appearance = isPlainObject(input.appearance) ? input.appearance : {};
  base.appearance.theme = THEMES.includes(appearance.theme) ? appearance.theme : "system";
  base.appearance.density = appearance.density === "compact" ? "compact" : "comfortable";
  base.appearance.landing = appearance.landing === "settings" ? "settings" : "dashboard";
  const sections = isPlainObject(appearance.sections) ? appearance.sections : {};
  for (const id of SECTION_IDS) base.appearance.sections[id] = sections[id] !== false;
  const order = coerceIdList(appearance.sectionOrder, 4, /^(classes|assignments|tests|reminders)$/, []);
  base.appearance.sectionOrder = order.length === 4 && new Set(order).size === 4 ? order : [...SECTION_IDS];
  return base;
}

function expectDueSafe(value) {
  try {
    return expectDue(value);
  } catch {
    return "";
  }
}

export function resetPreferences(current) {
  const next = defaultSettings();
  const settings = normalizeSettings(current);
  next.manualTests = settings.manualTests;
  next.personalReminders = settings.personalReminders;
  next.work.completedIds = settings.work.completedIds.filter((id) =>
    settings.manualTests.some((item) => item.id === id) || settings.personalReminders.some((item) => item.id === id),
  );
  next.canvas.disconnected = settings.canvas.disconnected;
  next.canvas.lastSyncAt = settings.canvas.lastSyncAt;
  next.canvas.lastSyncError = settings.canvas.lastSyncError;
  return next;
}

export async function commitChange({ current, save }) {
  try {
    const saved = await save();
    return { ok: true, settings: saved, status: "saved" };
  } catch (error) {
    return { ok: false, settings: current, status: "error", error };
  }
}

export function moveId(order, id, direction) {
  const ids = order.slice();
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const [item] = ids.splice(index, 1);
  ids.splice(target, 0, item);
  return ids;
}

export function reminderSentStorageKey(canvasId) {
  if (!COURSE_ID.test(String(canvasId ?? ""))) throw fail("invalid_user");
  return `canvi.reminderSent.${canvasId}`;
}

export const APPEARANCE_STORAGE_KEY = "canvi.appearance";

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function zonedDateKey(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function dueDateKey(dueAt, timeZone) {
  if (!dueAt) return "";
  if (DATE_KEY.test(dueAt)) return dueAt;
  const time = Date.parse(dueAt);
  if (!Number.isFinite(time)) return "";
  return zonedDateKey(new Date(time), timeZone);
}

export function zonedTimeToUtc(dateKey, clock, timeZone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    const delta = target - shown;
    if (delta === 0) break;
    utc += delta;
  }
  return utc;
}

export function resolveTimeZone(settings, deviceZone) {
  if (settings?.account?.timeZoneSet && isTimeZone(settings.account.timeZone)) return settings.account.timeZone;
  if (isTimeZone(deviceZone)) return deviceZone;
  return "UTC";
}

function formatDateKey(dateKey, dateFormat) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (dateFormat === "ymd") return dateKey;
  const monthName = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  if (dateFormat === "dmy") return `${day} ${monthName} ${year}`;
  return `${monthName} ${day}, ${year}`;
}

export function formatDue(dueAt, { timeZone, dateFormat = "ymd", timeFormat = "12" } = {}) {
  if (!dueAt) return { dueAt: null, label: "" };
  if (DATE_KEY.test(dueAt)) return { dueAt, label: formatDateKey(dueAt, dateFormat) };
  const time = Date.parse(dueAt);
  if (!Number.isFinite(time)) return { dueAt: null, label: "" };
  const parts = zonedParts(new Date(time), timeZone);
  const dateLabel = formatDateKey(`${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, dateFormat);
  let hours = parts.hour;
  let suffix = "";
  if (timeFormat !== "24") {
    suffix = hours >= 12 ? " PM" : " AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
  }
  const label = `${dateLabel}, ${timeFormat === "24" ? pad(hours) : hours}:${pad(parts.minute)}${suffix}`;
  return { dueAt, label };
}

export function isQuietAt(date, { start, end, timeZone }) {
  if (!start || !end || start === end || !CLOCK.test(start) || !CLOCK.test(end)) return false;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startMin = startHour * 60 + startMinute;
  const endMin = endHour * 60 + endMinute;
  const parts = zonedParts(date, timeZone);
  const current = parts.hour * 60 + parts.minute;
  if (startMin < endMin) return current >= startMin && current < endMin;
  return current >= startMin || current < endMin;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function weekdayIndex(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekRange(dateKey, weekStartsOn) {
  const index = weekdayIndex(dateKey);
  const offset = weekStartsOn === "sunday" ? index : (index + 6) % 7;
  const start = addDays(dateKey, -offset);
  return { start, end: addDays(start, 6) };
}

function colorOf(id) {
  return CLASS_COLORS.find((color) => color.id === id) ?? CLASS_COLORS[0];
}

function iconOf(id) {
  return CLASS_ICONS.find((icon) => icon.id === id) ?? CLASS_ICONS[0];
}

export function orderClasses(courses, classOrder) {
  const rank = new Map((classOrder ?? []).map((id, index) => [id, index]));
  return courses.slice().sort((left, right) => {
    const leftRank = rank.has(left.id) ? rank.get(left.id) : 10000;
    const rightRank = rank.has(right.id) ? rank.get(right.id) : 10000;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.title.localeCompare(right.title);
  });
}

export function classRoster(courses, settings) {
  return orderClasses(courses ?? [], settings.classOrder).map((course) => {
    const prefs = { ...defaultClassPrefs(), ...settings.classes[course.id] };
    return {
      ...course,
      prefs,
      displayTitle: prefs.displayName || course.title,
      color: colorOf(prefs.color),
      icon: iconOf(prefs.icon),
    };
  });
}

function courseMap(courses, settings) {
  const map = new Map();
  for (const course of classRoster(courses, settings)) map.set(course.id, course);
  return map;
}

function isOverdue(dueAt, now, timeZone) {
  if (!dueAt) return false;
  if (DATE_KEY.test(dueAt)) return dueAt < zonedDateKey(now, timeZone);
  const time = Date.parse(dueAt);
  return Number.isFinite(time) && time < now.getTime();
}

function inView(dueAt, view, now, timeZone, weekStartsOn, showUndated) {
  if (!dueAt) return showUndated && (view === "all" || view === "upcoming");
  if (view === "all") return true;
  const today = zonedDateKey(now, timeZone);
  const dueKey = dueDateKey(dueAt, timeZone);
  if (!dueKey) return false;
  if (view === "today") return dueKey === today;
  if (view === "upcoming") return dueKey >= today;
  if (view === "week") {
    const range = weekRange(today, weekStartsOn);
    return dueKey >= range.start && dueKey <= range.end;
  }
  return true;
}

function typeLabel(item) {
  if (item.origin === "manual") return "You added this test in Canvi.";
  if (item.origin === "personal") return "Personal reminder";
  if (item.labeledTest) return "Canvas assignment. You labeled this as a test.";
  if (item.canvasType === "quiz") return "Canvas quiz";
  if (item.canvasType === "assignment") return "Canvas assignment";
  if (item.canvasType === "calendar_event") return "Canvas calendar event";
  if (item.canvasType === "planner_note") return "Canvas planner note";
  return "Canvas item";
}

function decorate(item, settings, courses, timeZone) {
  const course = item.courseId ? courses.get(item.courseId) : null;
  const formatted = formatDue(item.dueAt, {
    timeZone,
    dateFormat: settings.account.dateFormat,
    timeFormat: settings.account.timeFormat,
  });
  const classTitle = course?.displayTitle || "";
  const detail = [classTitle, formatted.label].filter(Boolean).join(" · ");
  return {
    ...item,
    dueAt: item.dueAt || null,
    title: item.title,
    detail,
    classTitle,
    url: item.url || null,
    color: course?.color?.value || "",
    icon: course?.icon?.id || "",
    important: settings.work.importantIds.includes(item.id),
    completed: settings.work.completedIds.includes(item.id),
    typeLabel: typeLabel(item),
  };
}

function sortItems(items, sort) {
  const copy = items.slice();
  copy.sort((left, right) => {
    if (sort === "priority" && left.important !== right.important) return left.important ? -1 : 1;
    if (sort === "class" && left.classTitle !== right.classTitle) return left.classTitle.localeCompare(right.classTitle);
    if (!left.dueAt && !right.dueAt) return left.title.localeCompare(right.title);
    if (!left.dueAt) return 1;
    if (!right.dueAt) return -1;
    const due = String(left.dueAt).localeCompare(String(right.dueAt));
    return due || left.title.localeCompare(right.title);
  });
  return copy;
}

function groupItems(items, groupBy, timeZone, dateFormat) {
  if (groupBy === "class") {
    const groups = new Map();
    for (const item of items) {
      const heading = item.classTitle || "No class";
      if (!groups.has(heading)) groups.set(heading, []);
      groups.get(heading).push(item);
    }
    return [...groups.entries()].map(([heading, group]) => ({ heading, items: group }));
  }
  const groups = new Map();
  for (const item of items) {
    const key = item.dueAt ? dueDateKey(item.dueAt, timeZone) : "";
    const heading = key ? formatDateKey(key, dateFormat) : "No due date";
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(item);
  }
  return [...groups.entries()].map(([heading, group]) => ({ heading, items: group }));
}

function visibleCourse(course) {
  return course && !course.prefs.hidden && !course.prefs.archived;
}

export function presentDashboard(canvas, settings, now, deviceZone) {
  const current = normalizeSettings(settings);
  const timeZone = resolveTimeZone(current, deviceZone);
  const courses = courseMap([...(canvas?.catalog ?? []), ...(canvas?.classes ?? [])], current);
  const labels = new Set(current.work.testLabels);
  const completed = new Set(current.work.completedIds);
  const view = current.work.defaultView;

  function accept(item, { personal = false } = {}) {
    if (item.courseId && courses.has(item.courseId) && !visibleCourse(courses.get(item.courseId))) return false;
    if (!current.work.showSubmitted && item.submitted) return false;
    if (!current.work.showCompletedTasks && (personal || completed.has(item.id)) && completed.has(item.id)) return false;
    if (!personal && !current.work.showCompletedTasks && completed.has(item.id)) return false;
    if (!current.work.showOverdue && isOverdue(item.dueAt, now, timeZone)) return false;
    return inView(item.dueAt, view, now, timeZone, current.work.weekStartsOn, current.work.showUndated);
  }

  const assignments = [];
  const tests = [];
  for (const item of canvas?.assignments ?? []) {
    const labeled = labels.has(item.id);
    const next = { ...item, origin: "canvas", labeledTest: labeled };
    if (!accept(next)) continue;
    if (labeled) tests.push(next);
    else assignments.push(next);
  }
  for (const item of canvas?.tests ?? []) {
    const next = { ...item, origin: "canvas", labeledTest: false };
    if (accept(next)) tests.push(next);
  }
  for (const item of current.manualTests) {
    const next = { ...item, origin: "manual", canvasType: "manual_test", url: null, submitted: false, labeledTest: false };
    if (accept(next, { personal: true })) tests.push(next);
  }

  const reminders = [];
  for (const item of canvas?.reminders ?? []) {
    const next = { ...item, origin: "canvas" };
    if (item.courseId && courses.has(item.courseId) && !visibleCourse(courses.get(item.courseId))) continue;
    reminders.push(next);
  }
  for (const item of current.personalReminders) {
    const next = { ...item, origin: "personal", canvasType: "personal", url: null, submitted: false };
    if (!current.work.showCompletedTasks && completed.has(item.id)) continue;
    if (item.courseId && courses.has(item.courseId) && !visibleCourse(courses.get(item.courseId))) continue;
    reminders.push(next);
  }

  const decorateList = (items) => sortItems(items.map((item) => decorate(item, current, courses, timeZone)), current.work.sort);
  const sectionItems = {
    classes: classRoster(canvas?.classes ?? [], current)
      .filter((course) => visibleCourse(course))
      .map((course) => ({
        id: course.id,
        title: course.displayTitle,
        detail: course.concluded ? `${course.detail || "Canvas course"} · Concluded` : course.detail || "Canvas course",
        url: course.url || null,
        color: course.color.value,
        icon: course.icon.id,
        canvasType: "course",
        typeLabel: "Canvas course",
        dueAt: null,
        submitted: false,
        completed: false,
        important: false,
      })),
    assignments: decorateList(assignments),
    tests: decorateList(tests),
    reminders: decorateList(reminders),
  };

  const titles = {
    classes: "Classes",
    assignments: "Assignments",
    tests: "Tests",
    reminders: "Reminders",
  };

  function rawCount(id) {
    if (id === "classes") return (canvas?.classes ?? []).length;
    if (id === "assignments") return (canvas?.assignments ?? []).filter((item) => !labels.has(item.id)).length;
    if (id === "tests") {
      const labeled = (canvas?.assignments ?? []).filter((item) => labels.has(item.id)).length;
      return (canvas?.tests ?? []).length + current.manualTests.length + labeled;
    }
    return (canvas?.reminders ?? []).length + current.personalReminders.length;
  }

  const sections = current.appearance.sectionOrder
    .filter((id) => current.appearance.sections[id] !== false)
    .map((id) => ({
      id,
      title: titles[id],
      empty: sectionItems[id].length ? "" : rawCount(id) ? "Nothing matches these settings." : "Canvi has no items here yet.",
      groups:
        id === "classes"
          ? [{ heading: "", items: sectionItems[id] }]
          : groupItems(sectionItems[id], current.work.groupBy, timeZone, current.account.dateFormat),
    }));

  return {
    timeZone,
    timeZoneSet: current.account.timeZoneSet === true,
    sections,
  };
}

function channelOn(settings, courseId, channel) {
  if (!settings.reminders.enabled) return false;
  const mode = courseId ? settings.classes[courseId]?.reminders ?? "inherit" : "inherit";
  if (mode === "off") return false;
  if (mode === "on") return true;
  return settings.reminders[channel] !== false;
}

function dueInstant(dueAt, timeZone) {
  if (!dueAt) return null;
  if (DATE_KEY.test(dueAt)) return zonedTimeToUtc(dueAt, "09:00", timeZone);
  const time = Date.parse(dueAt);
  return Number.isFinite(time) ? time : null;
}

function leadReady(now, dueAt, timing, timeZone) {
  const due = dueInstant(dueAt, timeZone);
  const offset = TIMING_MS[timing];
  if (due == null || !offset || due <= now) return false;
  const trigger = due - offset;
  return now >= trigger && now < Math.min(trigger + LEAD_WINDOW_MS, due);
}

export function collectDueReminders({ settings, canvas, now, deviceZone, sent }) {
  const current = normalizeSettings(settings);
  const timeZone = resolveTimeZone(current, deviceZone);
  const quiet = {
    start: current.reminders.quietStart,
    end: current.reminders.quietEnd,
    timeZone,
  };
  if (!current.reminders.enabled || isQuietAt(now, quiet)) return [];
  const delivered = sent instanceof Set ? sent : new Set(sent ?? []);
  const due = [];

  function pushItem(item, channel) {
    if (!item?.dueAt || !channelOn(current, item.courseId, channel)) return;
    if (item.submitted) return;
    if (current.work.completedIds.includes(item.id)) return;
    for (const timing of current.reminders.timings) {
      const key = `${item.id}:${timing}`;
      if (delivered.has(key)) continue;
      if (!leadReady(now.getTime(), item.dueAt, timing, timeZone)) continue;
      due.push({
        key,
        title: item.title,
        body: `${REMINDER_TIMINGS.find((entry) => entry.id === timing)?.label ?? timing}. This reminder does not submit work.`,
        channel,
      });
    }
  }

  const labels = new Set(current.work.testLabels);
  for (const item of canvas?.assignments ?? []) {
    if (labels.has(item.id)) pushItem(item, "tests");
    else pushItem(item, "assignments");
  }
  for (const item of canvas?.tests ?? []) pushItem(item, "tests");
  for (const item of current.manualTests) pushItem({ ...item, submitted: false }, "tests");
  for (const item of current.personalReminders) pushItem({ ...item, submitted: false }, "personal");

  if (current.reminders.digestEnabled) {
    const dayKey = zonedDateKey(now, timeZone);
    const key = `digest:${dayKey}`;
    const target = zonedTimeToUtc(dayKey, current.reminders.digestTime, timeZone);
    const stamp = now.getTime();
    if (!delivered.has(key) && stamp >= target && stamp < target + LEAD_WINDOW_MS) {
      due.push({
        key,
        title: "Daily digest",
        body: "Open Canvi to review your assignments, tests, and reminders.",
        channel: "digest",
      });
    }
  }

  return due;
}

export function sanitizeExport(value) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeExport(entry));
  if (!isPlainObject(value)) return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    next[key] = sanitizeExport(entry);
  }
  return next;
}

export function exportPayload({ settings, cache, catalog, host, exportedAt }) {
  const current = normalizeSettings(settings);
  return sanitizeExport({
    exportedAt,
    host: typeof host === "string" ? host : "",
    account: current.account,
    preferences: {
      canvas: {
        includeConcluded: current.canvas.includeConcluded,
        courseIds: current.canvas.courseIds,
        lastSyncAt: current.canvas.lastSyncAt,
        disconnected: current.canvas.disconnected,
      },
      classes: current.classes,
      classOrder: current.classOrder,
      work: current.work,
      reminders: current.reminders,
      appearance: current.appearance,
    },
    manualTests: current.manualTests,
    personalReminders: current.personalReminders,
    catalog: Array.isArray(catalog) ? catalog : [],
    imported: cache ?? { classes: [], assignments: [], tests: [], reminders: [] },
  });
}

export function describeConnection({ settings, usable, host, url }) {
  const current = normalizeSettings(settings);
  const base = {
    host: host || "",
    url: url || "",
    lastSyncAt: current.canvas.lastSyncAt,
  };
  if (current.canvas.disconnected) {
    return {
      ...base,
      status: "disconnected",
      message: "Canvas sync is off. Imported data stays until you remove it.",
    };
  }
  if (!usable) {
    return {
      ...base,
      status: "expired",
      message: "The Canvas connection expired. Reconnect to sync. Imported data stays here.",
    };
  }
  if (current.canvas.lastSyncError === "partial") {
    return {
      ...base,
      status: "error",
      message: "Some courses did not sync. Canvi kept the last good data for those courses.",
    };
  }
  if (current.canvas.lastSyncError === "expired") {
    return {
      ...base,
      status: "expired",
      message: "The Canvas connection expired. Reconnect to sync. Imported data stays here.",
    };
  }
  if (current.canvas.lastSyncError) {
    return {
      ...base,
      status: "error",
      message: "The last sync failed. Imported data from the last good sync stays here.",
    };
  }
  if (!current.canvas.lastSyncAt) {
    return {
      ...base,
      status: "connected",
      message: "Canvas is connected. Choose Sync now to import courses.",
    };
  }
  return {
    ...base,
    status: "connected",
    message: "Canvas is connected.",
  };
}

export const CONFIRM_REMOVE_CANVAS = "remove-canvas-data";
export const CONFIRM_RESET = "reset-preferences";
export const CONFIRM_DISCONNECT = "disconnect-canvas";
