import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../settings/model.js";
import { buildCalendar } from "./model.js";

const now = new Date("2026-10-31T18:00:00Z");

function canvas() {
  return {
    classes: [
      { id: "7", title: "Biology", courseId: "7", canvasType: "course" },
      { id: "8", title: "History", courseId: "8", canvasType: "course" },
    ],
    catalog: [],
    assignments: [
      { id: "7:1", title: "Lab report", courseId: "7", dueAt: "2026-11-02T03:00:00Z", submitted: true, canvasType: "assignment" },
      { id: "8:2", title: "Essay", courseId: "8", dueAt: "2026-11-03T18:00:00Z", submitted: false, canvasType: "assignment" },
    ],
    tests: [],
    reminders: [{ id: "event:4", title: "Office hours", courseId: "7", dueAt: "2026-11-03T15:00:00Z", canvasType: "calendar_event" }],
    exams: [
      { id: "exam:7:final:2026-12-10:final-exam", title: "Final exam", courseId: "7", dueAt: "2026-12-10", examKind: "final", canvasType: "syllabus_exam" },
      { id: "exam:8:midterm:2026-10-15:midterm", title: "Midterm", courseId: "8", dueAt: "2026-10-15", examKind: "midterm", canvasType: "syllabus_exam" },
    ],
  };
}

function settings(patch = {}) {
  return { ...defaultSettings(), ...patch, account: { ...defaultSettings().account, ...patch.account }, work: { ...defaultSettings().work, ...patch.work } };
}

test("places a due time on the student local date", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings({ account: { timeZone: "America/Los_Angeles", timeZoneSet: true } }),
    now,
    deviceZone: "UTC",
    month: "2026-11",
  });
  const day = view.weeks.flat().find((cell) => cell.dateKey === "2026-11-01");
  assert.equal(day.events.some((event) => event.id === "7:1" && event.kind === "assignment"), true);
});

test("hides a class the student hid", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings({ classes: { "8": { hidden: true } } }),
    now,
    deviceZone: "UTC",
  });
  assert.equal(view.classes.some((course) => course.id === "8"), false);
  assert.equal(view.events.some((event) => event.courseId === "8"), false);
});

test("keeps a submitted due date on the calendar", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings(),
    now,
    deviceZone: "UTC",
    month: "2026-11",
  });
  const day = view.weeks.flat().find((cell) => cell.events.some((event) => event.id === "7:1"));
  assert.equal(day.events.find((event) => event.id === "7:1").submitted, true);
});

test("puts a syllabus final on its date", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings(),
    now,
    deviceZone: "UTC",
    month: "2026-12",
  });
  const day = view.weeks.flat().find((cell) => cell.dateKey === "2026-12-10");
  assert.equal(day.events[0].kind, "final");
  assert.equal(day.events[0].classTitle, "Biology");
});

test("starts the week on the day from settings", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings({ work: { weekStartsOn: "monday" } }),
    now,
    deviceZone: "UTC",
    month: "2026-10",
  });
  assert.deepEqual(view.weekdays, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.equal(view.weeks[0][0].dateKey, "2026-09-28");
  assert.equal(view.weeks[0][3].dateKey, "2026-10-01");
  assert.equal(view.weeks[0][3].inMonth, true);
});

test("keeps a labeled assignment as a test", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings({ work: { testLabels: ["7:1"] } }),
    now,
    deviceZone: "UTC",
  });
  assert.equal(view.events.find((event) => event.id === "7:1").kind, "test");
});

test("lists a class once when the catalog repeats it", () => {
  const view = buildCalendar({
    canvas: {
      ...canvas(),
      catalog: [{ id: "7", title: "Biology old", courseId: "7", canvasType: "course" }],
    },
    settings: settings(),
    now,
    deviceZone: "UTC",
  });
  assert.deepEqual(
    view.classes.map((course) => course.id),
    ["7", "8"],
  );
  assert.equal(view.classes.find((course) => course.id === "7").title, "Biology");
});

test("drops an unsafe event url", () => {
  const source = canvas();
  source.assignments[0].url = "javascript:alert(1)";
  const view = buildCalendar({
    canvas: source,
    settings: settings(),
    now,
    deviceZone: "UTC",
  });
  assert.equal(view.events.find((event) => event.id === "7:1").url, null);
});

test("uses the current month when the requested month is invalid", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings(),
    now,
    deviceZone: "UTC",
    month: "2026-13",
  });
  assert.equal(view.monthKey, "2026-10");
});

test("keeps dates the student added", () => {
  const view = buildCalendar({
    canvas: canvas(),
    settings: settings({
      manualTests: [{ id: "manual-1", title: "Quiz retake", courseId: "7", dueAt: "2026-11-06" }],
      personalReminders: [{ id: "note-1", title: "Pack the lab book", courseId: "", dueAt: "2026-11-06" }],
    }),
    now,
    deviceZone: "UTC",
    month: "2026-11",
  });
  const day = view.weeks.flat().find((cell) => cell.dateKey === "2026-11-06");
  assert.deepEqual(
    day.events.map((event) => event.title),
    ["Quiz retake", "Pack the lab book"],
  );
});
