import {
  classRoster,
  dueDateKey,
  normalizeSettings,
  resolveTimeZone,
  zonedDateKey,
} from "../settings/model.js";

const KIND_LABEL = {
  assignment: "Due",
  test: "Test",
  reminder: "Reminder",
  midterm: "Midterm",
  final: "Final",
};

const KIND_RANK = { final: 0, midterm: 1, test: 2, assignment: 3, reminder: 4 };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value) {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isMonthKey(value) {
  return typeof value === "string" && isDateKey(`${value}-01`);
}

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function listedCourses(canvas) {
  const map = new Map();
  for (const course of [...(canvas?.catalog ?? []), ...(canvas?.classes ?? [])]) {
    if (!course?.id) continue;
    map.set(course.id, course);
  }
  return [...map.values()];
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekdayLabels(weekStartsOn) {
  if (weekStartsOn === "sunday") return WEEKDAYS;
  return [...WEEKDAYS.slice(1), WEEKDAYS[0]];
}

function monthLabel(year, month) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

function monthGrid(year, month, weekStartsOn) {
  const first = `${year}-${pad(month)}-01`;
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = weekStartsOn === "sunday" ? firstWeekday : (firstWeekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let index = 0; index < lead; index += 1) cells.push(dayCell(addDays(first, index - lead), false));
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(dayCell(`${year}-${pad(month)}-${pad(day)}`, true));
  while (cells.length % 7 !== 0) cells.push(dayCell(addDays(cells[cells.length - 1].dateKey, 1), false));
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

function dayCell(dateKey, inMonth) {
  return { dateKey, inMonth, day: Number(dateKey.slice(8)), events: [], isToday: false };
}

function hiddenCourse(course) {
  return course?.prefs.hidden === true || course?.prefs.archived === true;
}

export function shiftMonth(monthKey, delta) {
  if (!isMonthKey(monthKey)) return monthKey;
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

export function buildCalendar({ canvas, settings, now = new Date(), deviceZone = "UTC", month = null } = {}) {
  const current = normalizeSettings(settings);
  const timeZone = resolveTimeZone(current, deviceZone);
  const today = zonedDateKey(now, timeZone);
  const monthKey = isMonthKey(month) ? month : today.slice(0, 7);
  const [year, monthNumber] = monthKey.split("-").map(Number);
  const roster = classRoster(listedCourses(canvas), current);
  const byId = new Map(roster.map((course) => [course.id, course]));
  const labels = new Set(current.work.testLabels);
  const events = [];

  function push(item, kind) {
    if (!item?.title || !item.dueAt || !KIND_LABEL[kind]) return;
    const course = item.courseId ? byId.get(item.courseId) : null;
    if (item.courseId && hiddenCourse(course)) return;
    const dateKey = dueDateKey(item.dueAt, timeZone);
    if (!dateKey) return;
    events.push({
      id: item.id,
      title: item.title,
      dateKey,
      kind,
      kindLabel: KIND_LABEL[kind],
      courseId: item.courseId || "",
      classTitle: course?.displayTitle || "",
      color: course?.color?.value || "",
      url: safeHttpUrl(item.url),
      submitted: item.submitted === true,
      clock: typeof item.clock === "string" ? item.clock : "",
    });
  }

  for (const item of canvas?.assignments ?? []) push(item, labels.has(item.id) ? "test" : "assignment");
  for (const item of canvas?.tests ?? []) push(item, "test");
  for (const item of current.manualTests) push(item, "test");
  for (const item of canvas?.reminders ?? []) push(item, "reminder");
  for (const item of current.personalReminders) push(item, "reminder");
  for (const item of canvas?.exams ?? []) {
    if (item.examKind === "midterm" || item.examKind === "final") push(item, item.examKind);
  }

  events.sort(
    (left, right) =>
      left.dateKey.localeCompare(right.dateKey) ||
      (KIND_RANK[left.kind] ?? 9) - (KIND_RANK[right.kind] ?? 9) ||
      left.title.localeCompare(right.title),
  );

  const byDay = new Map();
  for (const event of events) {
    if (!byDay.has(event.dateKey)) byDay.set(event.dateKey, []);
    byDay.get(event.dateKey).push(event);
  }
  const weeks = monthGrid(year, monthNumber, current.work.weekStartsOn);
  for (const week of weeks) {
    for (const day of week) {
      day.events = byDay.get(day.dateKey) ?? [];
      day.isToday = day.dateKey === today;
    }
  }

  return {
    timeZone,
    today,
    label: monthLabel(year, monthNumber),
    monthKey,
    weekdays: weekdayLabels(current.work.weekStartsOn),
    classes: roster
      .filter((course) => !hiddenCourse(course))
      .map((course) => ({
        id: course.id,
        title: course.displayTitle,
        color: course.color.value,
        concluded: course.concluded === true,
      })),
    exams: events.filter((event) => event.kind === "midterm" || event.kind === "final"),
    weeks,
    events,
  };
}
