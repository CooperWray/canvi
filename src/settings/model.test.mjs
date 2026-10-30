import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPatch,
  classRoster,
  collectDueReminders,
  commitChange,
  defaultClassPrefs,
  defaultSettings,
  exportPayload,
  formatDue,
  isQuietAt,
  presentDashboard,
  reminderSentStorageKey,
  weekRange,
} from "./model.js";

const dueAt = "2026-11-02T18:00:00Z";

test("time zone changes the shown deadline and keeps the timestamp", () => {
  const east = formatDue(dueAt, { timeZone: "America/New_York", dateFormat: "mdy", timeFormat: "12" });
  const tokyo = formatDue(dueAt, { timeZone: "Asia/Tokyo", dateFormat: "ymd", timeFormat: "24" });
  assert.equal(east.dueAt, dueAt);
  assert.equal(tokyo.dueAt, dueAt);
  assert.equal(east.label, "Nov 2, 2026, 1:00 PM");
  assert.equal(tokyo.label, "2026-11-03, 03:00");
});

test("quiet hours include a range that crosses midnight and a daylight saving change", () => {
  const overnight = { start: "22:00", end: "07:00", timeZone: "UTC" };
  assert.equal(isQuietAt(new Date("2026-01-15T23:30:00Z"), overnight), true);
  assert.equal(isQuietAt(new Date("2026-01-16T03:00:00Z"), overnight), true);
  assert.equal(isQuietAt(new Date("2026-01-15T12:00:00Z"), overnight), false);
  assert.equal(isQuietAt(new Date("2026-01-15T07:00:00Z"), overnight), false);

  const zone = { start: "22:00", end: "07:00", timeZone: "America/New_York" };
  assert.equal(isQuietAt(new Date("2026-03-08T06:30:00Z"), zone), true);
  assert.equal(isQuietAt(new Date("2026-03-08T12:00:00Z"), zone), false);
});

test("a failed save restores the previous settings", async () => {
  const current = defaultSettings();
  current.account.displayName = "Avery";
  const result = await commitChange({
    current,
    save: async () => {
      throw new Error("disk");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.settings.account.displayName, "Avery");
});

test("an invalid time zone does not change stored settings", () => {
  const current = defaultSettings();
  current.account.displayName = "Avery";
  assert.throws(() => applyPatch(current, { account: { timeZone: "Not/AZone" } }), /invalid_time_zone/);
  assert.equal(current.account.displayName, "Avery");
  assert.equal(current.account.timeZone, "UTC");
});

test("week boundaries follow the chosen start day", () => {
  assert.deepEqual(weekRange("2026-10-28", "monday"), { start: "2026-10-26", end: "2026-11-01" });
  assert.deepEqual(weekRange("2026-10-28", "sunday"), { start: "2026-10-25", end: "2026-10-31" });
});

function sampleCanvas() {
  return {
    classes: [{ id: "7", title: "Biology", detail: "BIO", url: null, courseId: "7", concluded: false }],
    catalog: [{ id: "7", title: "Biology", detail: "BIO", url: null, courseId: "7", concluded: false }],
    assignments: [
      {
        id: "7:1",
        title: "Lab",
        detail: "",
        url: null,
        courseId: "7",
        dueAt: "2026-10-25T15:00:00Z",
        canvasType: "assignment",
        submitted: false,
      },
      {
        id: "7:2",
        title: "Essay",
        detail: "",
        url: null,
        courseId: "7",
        dueAt: "2026-10-28T15:00:00Z",
        canvasType: "assignment",
        submitted: true,
      },
    ],
    tests: [],
    reminders: [],
  };
}

function titles(view, id) {
  const section = view.sections.find((entry) => entry.id === id);
  return section.groups.flatMap((group) => group.items.map((item) => item.title));
}

test("dashboard filters use the week start, submission, and a hidden class", () => {
  const settings = defaultSettings();
  settings.account.timeZone = "UTC";
  settings.account.timeZoneSet = true;
  settings.work.defaultView = "week";
  settings.work.showSubmitted = true;
  const now = new Date("2026-10-28T12:00:00Z");
  const monday = presentDashboard(sampleCanvas(), settings, now, "UTC");
  assert.deepEqual(titles(monday, "assignments"), ["Essay"]);

  settings.work.weekStartsOn = "sunday";
  const sunday = presentDashboard(sampleCanvas(), settings, now, "UTC");
  assert.deepEqual(titles(sunday, "assignments"), ["Lab", "Essay"]);

  settings.work.showSubmitted = false;
  const hiddenSubmitted = presentDashboard(sampleCanvas(), settings, now, "UTC");
  assert.deepEqual(titles(hiddenSubmitted, "assignments"), ["Lab"]);

  settings.classes["7"] = { ...defaultClassPrefs(), hidden: true };
  const hidden = presentDashboard(sampleCanvas(), settings, now, "UTC");
  assert.deepEqual(titles(hidden, "classes"), []);
  assert.equal(hidden.sections.find((section) => section.id === "classes").empty, "Nothing matches these settings.");
  const blank = presentDashboard({ classes: [], assignments: [], tests: [], reminders: [] }, settings, now, "UTC");
  assert.equal(blank.sections.find((section) => section.id === "classes").empty, "Canvi has no items here yet.");
  assert.deepEqual(
    classRoster(sampleCanvas().catalog, settings).map((course) => course.title),
    ["Biology"],
  );
});

test("a Canvi complete mark stays separate from a Canvas submission", () => {
  const settings = defaultSettings();
  settings.account.timeZone = "UTC";
  settings.account.timeZoneSet = true;
  settings.work.defaultView = "all";
  settings.work.showSubmitted = true;
  settings.work.showCompletedTasks = true;
  settings.work.completedIds = ["7:1"];
  const view = presentDashboard(sampleCanvas(), settings, new Date("2026-10-28T12:00:00Z"), "UTC");
  const lab = view.sections
    .find((section) => section.id === "assignments")
    .groups.flatMap((group) => group.items)
    .find((item) => item.id === "7:1");
  assert.equal(lab.completed, true);
  assert.equal(lab.submitted, false);
  assert.equal(lab.dueAt, "2026-10-25T15:00:00Z");
});

test("quiet hours, submitted work, and sent keys suppress reminders", () => {
  const settings = defaultSettings();
  settings.account.timeZone = "UTC";
  settings.account.timeZoneSet = true;
  settings.reminders.timings = ["1h"];
  const due = new Date("2026-10-28T18:00:00Z");
  const now = new Date(due.getTime() - 50 * 60 * 1000);
  const canvas = {
    assignments: [
      { id: "7:1", title: "Lab", courseId: "7", dueAt: due.toISOString(), submitted: false },
      { id: "7:2", title: "Essay", courseId: "7", dueAt: due.toISOString(), submitted: true },
    ],
    tests: [],
  };
  const first = collectDueReminders({ settings, canvas, now, deviceZone: "UTC", sent: new Set() });
  assert.deepEqual(first.map((item) => item.key), ["7:1:1h"]);

  const again = collectDueReminders({ settings, canvas, now, deviceZone: "UTC", sent: new Set(["7:1:1h"]) });
  assert.deepEqual(again, []);

  settings.reminders.quietStart = "00:00";
  settings.reminders.quietEnd = "23:00";
  const quiet = collectDueReminders({ settings, canvas, now, deviceZone: "UTC", sent: new Set() });
  assert.deepEqual(quiet, []);
});

test("hidden classes can still produce reminders", () => {
  const settings = defaultSettings();
  settings.account.timeZone = "UTC";
  settings.account.timeZoneSet = true;
  settings.reminders.timings = ["1h"];
  settings.classes["7"] = { ...defaultClassPrefs(), hidden: true, reminders: "on" };
  const due = new Date("2026-10-28T18:00:00Z");
  const now = new Date(due.getTime() - 50 * 60 * 1000);
  const dueItems = collectDueReminders({
    settings,
    canvas: { assignments: [{ id: "7:1", title: "Lab", courseId: "7", dueAt: due.toISOString(), submitted: false }] },
    now,
    deviceZone: "UTC",
    sent: new Set(),
  });
  assert.equal(dueItems.length, 1);
});

test("export removes secret fields and reminder keys stay per student", () => {
  const payload = exportPayload({
    settings: defaultSettings(),
    cache: { classes: [], assignments: [{ title: "Lab", accessToken: "secret-token" }], tests: [], reminders: [] },
    catalog: [],
    host: "canvas.example.edu",
    exportedAt: "2026-10-29T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(payload).includes("secret-token"), false);
  assert.equal(JSON.stringify(payload).includes("accessToken"), false);
  assert.equal(reminderSentStorageKey("42"), "canvi.reminderSent.42");
  assert.notEqual(reminderSentStorageKey("42"), reminderSentStorageKey("7"));
  assert.throws(() => reminderSentStorageKey("nope"), /invalid_user/);
});
