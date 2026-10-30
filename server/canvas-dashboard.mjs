import { accessTokenUsable, canvasServerConfig, readStoredSession, sessionFromCookieHeader } from "./canvas-auth.mjs";
import { sanitizeExport } from "../src/settings/model.js";

const MAX_COURSES = 20;
const MAX_PAGES = 4;

export function emptyDashboard() {
  return {
    classes: [],
    assignments: [],
    tests: [],
    reminders: [],
  };
}

function text(value, max = 180) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function day(value) {
  if (typeof value !== "string") return "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function detail(parts) {
  return parts.filter(Boolean).join(" · ");
}

function canvasUrl(value, origin) {
  if (!origin || typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isTestAssignment(assignment) {
  if (assignment?.is_quiz_assignment === true || assignment?.is_quiz_lti_assignment === true) return true;
  const types = Array.isArray(assignment?.submission_types) ? assignment.submission_types : [];
  return types.includes("online_quiz");
}

function published(record) {
  return record?.published !== false && record?.workflow_state !== "unpublished" && record?.workflow_state !== "deleted";
}

function dueValue(value) {
  if (typeof value !== "string" || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function canvasSubmitted(record) {
  const submission = record?.submission;
  if (!submission || typeof submission !== "object") return false;
  if (typeof submission.submitted_at === "string" && submission.submitted_at) return true;
  return ["submitted", "graded", "pending_review"].includes(submission.workflow_state);
}

export function sortCanvasDashboard({
  origin,
  courses = [],
  assignments = [],
  quizzes = [],
  events = [],
  notes = [],
  includeConcluded = false,
  courseIds = null,
}) {
  const courseName = new Map();
  const classes = [];
  const catalog = [];
  const selected = Array.isArray(courseIds) ? new Set(courseIds) : null;

  for (const course of courses) {
    const id = course?.id == null ? "" : String(course.id);
    if (!/^[0-9]+$/.test(id)) continue;
    const concluded = course.workflow_state === "completed";
    if (course.workflow_state === "unpublished" || course.workflow_state === "deleted") continue;
    if (course.workflow_state && course.workflow_state !== "available" && !(includeConcluded && concluded)) continue;
    const name = text(course.name || course.course_code || `Course ${id}`);
    if (!name) continue;
    const entry = {
      id,
      title: name,
      detail: text(course.course_code),
      url: canvasUrl(course.html_url ?? `${origin}/courses/${id}`, origin),
      courseId: id,
      concluded,
      canvasType: "course",
    };
    catalog.push(entry);
    if (selected && !selected.has(id)) continue;
    courseName.set(id, name);
    classes.push(entry);
  }

  classes.sort((a, b) => a.title.localeCompare(b.title));
  catalog.sort((a, b) => a.title.localeCompare(b.title));

  const tests = [];
  const seenTests = new Set();
  const assignmentItems = [];

  function addTest(courseId, assignmentId, quizId, title, when, url, dueAt, submitted) {
    if (selected && !selected.has(courseId)) return;
    const key = assignmentId ? `${courseId}:a:${assignmentId}` : `${courseId}:q:${quizId}`;
    if (seenTests.has(key)) return;
    seenTests.add(key);
    tests.push({
      id: key,
      title,
      detail: detail([courseName.get(courseId), when]),
      url,
      when,
      courseId,
      dueAt,
      canvasType: "quiz",
      submitted: submitted === true,
    });
  }

  for (const assignment of assignments) {
    if (!published(assignment)) continue;
    const courseId = assignment?.course_id == null ? "" : String(assignment.course_id);
    const id = assignment?.id == null ? "" : String(assignment.id);
    if (!/^[0-9]+$/.test(courseId) || !/^[0-9]+$/.test(id)) continue;
    const title = text(assignment.name);
    if (!title) continue;
    if (selected && !selected.has(courseId)) continue;
    const when = day(assignment.due_at);
    const url = canvasUrl(assignment.html_url, origin);
    const dueAt = dueValue(assignment.due_at);
    const submitted = canvasSubmitted(assignment);
    if (isTestAssignment(assignment)) {
      addTest(courseId, id, null, title, when, url, dueAt, submitted);
      continue;
    }
    assignmentItems.push({
      id: `${courseId}:${id}`,
      title,
      detail: detail([courseName.get(courseId), when]),
      url,
      when,
      courseId,
      dueAt,
      canvasType: "assignment",
      submitted,
    });
  }

  for (const quiz of quizzes) {
    if (!published(quiz)) continue;
    const courseId = quiz?.course_id == null ? "" : String(quiz.course_id);
    const id = quiz?.id == null ? "" : String(quiz.id);
    if (!/^[0-9]+$/.test(courseId) || !/^[0-9]+$/.test(id)) continue;
    const title = text(quiz.title);
    if (!title) continue;
    const assignmentId = quiz.assignment_id == null ? "" : String(quiz.assignment_id);
    addTest(
      courseId,
      /^[0-9]+$/.test(assignmentId) ? assignmentId : "",
      id,
      title,
      day(quiz.due_at),
      canvasUrl(quiz.html_url, origin),
      dueValue(quiz.due_at),
      canvasSubmitted(quiz),
    );
  }

  const reminders = [];
  for (const event of events) {
    if (event?.type === "assignment" || event?.assignment) continue;
    const id = event?.id == null ? "" : String(event.id);
    const title = text(event?.title);
    if (!title) continue;
    const contextId = String(event?.context_code ?? "").replace(/^course_/, "");
    const courseId = /^[0-9]+$/.test(contextId) ? contextId : "";
    if (selected && courseId && !selected.has(courseId)) continue;
    const when = day(event?.start_at || event?.end_at);
    reminders.push({
      id: `event:${id || title}`,
      title,
      detail: detail([courseName.get(contextId), when]),
      url: canvasUrl(event?.html_url, origin),
      when,
      courseId,
      dueAt: dueValue(event?.start_at || event?.end_at),
      canvasType: "calendar_event",
      submitted: false,
    });
  }

  for (const note of notes) {
    const id = note?.id == null ? "" : String(note.id);
    const title = text(note?.title);
    if (!title) continue;
    const courseId = note?.course_id == null ? "" : String(note.course_id);
    if (selected && /^[0-9]+$/.test(courseId) && !selected.has(courseId)) continue;
    const when = day(note?.todo_date);
    reminders.push({
      id: `note:${id || title}`,
      title,
      detail: detail([courseName.get(courseId), when]),
      url: null,
      when,
      courseId: /^[0-9]+$/.test(courseId) ? courseId : "",
      dueAt: dueValue(note?.todo_date),
      canvasType: "planner_note",
      submitted: false,
    });
  }

  const byWhen = (a, b) => {
    if (!a.when && !b.when) return a.title.localeCompare(b.title);
    if (!a.when) return 1;
    if (!b.when) return -1;
    return a.when.localeCompare(b.when) || a.title.localeCompare(b.title);
  };

  const publish = (item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    url: item.url,
    courseId: item.courseId || "",
    dueAt: item.dueAt || null,
    canvasType: item.canvasType || "",
    submitted: item.submitted === true,
    concluded: item.concluded === true,
  });

  return {
    classes: classes.map(publish),
    catalog: catalog.map(publish),
    assignments: assignmentItems.sort(byWhen).map(publish),
    tests: tests.sort(byWhen).map(publish),
    reminders: reminders.sort(byWhen).map(publish),
  };
}

export function mergePartialDashboard(previous, next) {
  const failed = new Set((next?.failedCourseIds ?? []).filter((id) => /^[0-9]+$/.test(id)));
  if (!previous || failed.size === 0) return next;
  const kept = (key) => (previous[key] ?? []).filter((item) => failed.has(item.courseId));
  const fresh = (key) => (next[key] ?? []).filter((item) => !failed.has(item.courseId));
  return {
    ...next,
    classes: [...fresh("classes"), ...kept("classes")],
    catalog: next.catalog?.length ? next.catalog : previous.catalog ?? [],
    assignments: [...fresh("assignments"), ...kept("assignments")],
    tests: [...fresh("tests"), ...kept("tests")],
    reminders: [...fresh("reminders"), ...kept("reminders")],
    partial: true,
    failedCourseIds: [...failed],
  };
}

function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function canvasList(fetchImpl, origin, accessToken, path) {
  const items = [];
  let url = new URL(path, origin);
  if (!url.searchParams.has("per_page")) url.searchParams.set("per_page", "50");

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (url.origin !== origin) break;
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) {
      const error = new Error("unauthorized");
      error.code = "unauthorized";
      throw error;
    }
    if (response.status === 403 || response.status >= 500) {
      const error = new Error("canvas_error");
      error.code = "canvas_error";
      throw error;
    }
    if (!response.ok) return items;
    const body = await response.json();
    if (Array.isArray(body)) items.push(...body);
    const next = nextLink(response.headers?.get?.("link") ?? response.headers?.get?.("Link"));
    if (!next) break;
    url = new URL(next);
  }

  return items;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function dateWindow() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 14);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 120);
  const format = (date) => date.toISOString().slice(0, 10);
  return { start: format(start), end: format(end) };
}

function unavailableDashboard() {
  const dashboard = emptyDashboard();
  dashboard.syncError = "unavailable";
  return dashboard;
}

export async function readCanvasDashboard(fetchImpl, { origin, accessToken, canvasId, includeConcluded = false, courseIds = null }) {
  try {
    const active = await canvasList(
      fetchImpl,
      origin,
      accessToken,
      "/api/v1/courses?enrollment_state=active&state[]=available&per_page=50",
    );
    let courses = active.filter((course) => course?.id != null).slice(0, MAX_COURSES);
    let concludedError = false;
    if (includeConcluded) {
      try {
        const extra = await canvasList(
          fetchImpl,
          origin,
          accessToken,
          "/api/v1/courses?enrollment_state=completed&state[]=completed&per_page=50",
        );
        const seen = new Set(courses.map((course) => String(course.id)));
        for (const course of extra) {
          if (course?.id == null || seen.has(String(course.id))) continue;
          courses.push(course);
          if (courses.length >= MAX_COURSES * 2) break;
        }
      } catch (error) {
        if (error?.code === "unauthorized") throw error;
        concludedError = true;
      }
    }

    const selected = Array.isArray(courseIds) ? new Set(courseIds.map(String)) : null;
    const toFetch = courses
      .filter((course) => !selected || selected.has(String(course.id)))
      .slice(0, MAX_COURSES);
    const failedCourseIds = [];
    const collected = await mapPool(toFetch, 4, async (course) => {
      const id = encodeURIComponent(course.id);
      try {
        const [assignments, quizzes] = await Promise.all([
          canvasList(
            fetchImpl,
            origin,
            accessToken,
            `/api/v1/courses/${id}/assignments?order_by=due_at&include[]=submission&per_page=50`,
          ),
          canvasList(fetchImpl, origin, accessToken, `/api/v1/courses/${id}/quizzes?per_page=50`),
        ]);
        return { assignments, quizzes };
      } catch (error) {
        if (error?.code === "unauthorized") throw error;
        failedCourseIds.push(String(course.id));
        return { assignments: [], quizzes: [] };
      }
    });

    const { start, end } = dateWindow();
    const codes = [`user_${canvasId}`, ...toFetch.map((course) => `course_${course.id}`)];
    const events = [];
    let listError = false;
    try {
      for (let i = 0; i < codes.length; i += 10) {
        const params = new URLSearchParams({ type: "event", start_date: start, end_date: end, per_page: "50" });
        for (const code of codes.slice(i, i + 10)) params.append("context_codes[]", code);
        events.push(...(await canvasList(fetchImpl, origin, accessToken, `/api/v1/calendar_events?${params}`)));
      }
    } catch (error) {
      if (error?.code === "unauthorized") throw error;
      listError = true;
    }
    let notes = [];
    try {
      notes = await canvasList(
        fetchImpl,
        origin,
        accessToken,
        `/api/v1/planner_notes?start_date=${start}&end_date=${end}&per_page=50`,
      );
    } catch (error) {
      if (error?.code === "unauthorized") throw error;
      listError = true;
    }

    const dashboard = sortCanvasDashboard({
      origin,
      courses,
      assignments: collected.flatMap((entry) => entry.assignments),
      quizzes: collected.flatMap((entry) => entry.quizzes),
      events,
      notes,
      includeConcluded,
      courseIds,
    });
    dashboard.failedCourseIds = failedCourseIds;
    dashboard.partial = failedCourseIds.length > 0 || concludedError || listError;
    return dashboard;
  } catch (error) {
    if (error?.code === "unauthorized") throw error;
    return unavailableDashboard();
  }
}

function json(res, body) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function clientDashboard(dashboard) {
  if (!dashboard) return emptyDashboard();
  const copy = sanitizeExport({ ...dashboard });
  delete copy.syncError;
  return copy;
}

export async function refreshCanvasCache(fetchImpl, { origin, session, store }) {
  const prefs = store.settingsFor(session);
  const cached = store.cacheFor(session);
  if (prefs.canvas.disconnected || !accessTokenUsable(session)) {
    return { dashboard: cached, error: prefs.canvas.disconnected ? "disconnected" : "expired", preserved: Boolean(cached) };
  }
  try {
    const dashboard = await readCanvasDashboard(fetchImpl, {
      origin,
      accessToken: session.accessToken,
      canvasId: session.canvasId,
      includeConcluded: prefs.canvas.includeConcluded === true,
      courseIds: prefs.canvas.courseIds,
    });
    const body = JSON.stringify(dashboard);
    if (session.accessToken && body.includes(session.accessToken)) {
      store.markSync(session, { error: "unavailable" });
      return { dashboard: cached, error: "unavailable", preserved: Boolean(cached) };
    }
    if (dashboard.syncError) {
      store.markSync(session, { error: dashboard.syncError });
      return { dashboard: cached, error: dashboard.syncError, preserved: Boolean(cached) };
    }
    const merged = mergePartialDashboard(cached, dashboard);
    const error = merged.partial ? "partial" : null;
    store.saveSync(session, merged, { error });
    return { dashboard: merged, error, preserved: false };
  } catch (error) {
    const code = error?.code === "unauthorized" ? "expired" : "unavailable";
    store.markSync(session, { error: code });
    return { dashboard: cached, error: code, preserved: Boolean(cached) };
  }
}

export function createCanvasDashboardMiddleware(env, { fetch: fetchImpl = fetch, store = null } = {}) {
  const config = canvasServerConfig(env);

  return function canvasDashboard(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/canvas/dashboard") return next();
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(emptyDashboard()));
      return;
    }
    if (!config) return json(res, emptyDashboard());

    const session = store
      ? readStoredSession(req.headers.cookie, config.sessionSecret)
      : sessionFromCookieHeader(req.headers.cookie, config.sessionSecret);
    if (!session || session.host !== new URL(config.origin).host) return json(res, emptyDashboard());

    if (!store) {
      return readCanvasDashboard(fetchImpl, {
        origin: config.origin,
        accessToken: session.accessToken,
        canvasId: session.canvasId,
      })
        .then((dashboard) => {
          const body = JSON.stringify(dashboard);
          if (session.accessToken && body.includes(session.accessToken)) return json(res, emptyDashboard());
          if (dashboard.syncError) return json(res, emptyDashboard());
          json(res, clientDashboard(dashboard));
        })
        .catch(() => json(res, emptyDashboard()));
    }

    return refreshCanvasCache(fetchImpl, { origin: config.origin, session, store }).then((result) => {
      json(res, clientDashboard(result.dashboard) ?? emptyDashboard());
    });
  };
}
