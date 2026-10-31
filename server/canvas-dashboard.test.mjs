import assert from "node:assert/strict";
import test from "node:test";
import { seal } from "./canvas-auth.mjs";
import { createSettingsStore } from "./settings-store.mjs";
import { createCanvasDashboardMiddleware, mergePartialDashboard, readCanvasDashboard, sortCanvasDashboard } from "./canvas-dashboard.mjs";

const origin = "https://canvas.example.edu";

test("sorts canvas records into classes, assignments, tests, and reminders", () => {
  const dashboard = sortCanvasDashboard({
    origin,
    courses: [
      { id: 7, name: "Biology", course_code: "BIO 1", workflow_state: "available" },
      { id: 8, name: "History", course_code: "HIST 2", workflow_state: "unpublished" },
      { id: 9, name: "<b>Studio</b>", course_code: "ART 3", workflow_state: "available" },
    ],
    assignments: [
      {
        id: 1,
        course_id: 7,
        name: "Lab report",
        due_at: "2026-11-02T18:00:00Z",
        html_url: "https://canvas.example.edu/courses/7/assignments/1",
        submission_types: ["online_upload"],
        published: true,
      },
      {
        id: 2,
        course_id: 7,
        name: "Midterm",
        due_at: "2026-11-04T18:00:00Z",
        html_url: "https://evil.example/phish",
        submission_types: ["online_quiz"],
        is_quiz_assignment: true,
        published: true,
      },
      {
        id: 3,
        course_id: 7,
        name: "Draft",
        due_at: "2026-11-01T18:00:00Z",
        published: false,
        submission_types: ["online_text_entry"],
      },
    ],
    quizzes: [
      {
        id: 20,
        course_id: 7,
        assignment_id: 2,
        title: "Midterm",
        due_at: "2026-11-04T18:00:00Z",
        html_url: "https://canvas.example.edu/courses/7/quizzes/20",
        published: true,
      },
      {
        id: 21,
        course_id: 9,
        title: "Critique quiz",
        due_at: "2026-11-08T18:00:00Z",
        html_url: "https://canvas.example.edu/courses/9/quizzes/21",
        published: true,
      },
    ],
    events: [
      {
        id: 4,
        title: "Studio hours",
        start_at: "2026-11-03T15:00:00Z",
        context_code: "course_9",
        html_url: "https://canvas.example.edu/calendar?event_id=4",
      },
      { id: 5, type: "assignment", title: "Lab report", start_at: "2026-11-02T18:00:00Z" },
    ],
    notes: [{ id: 6, title: "Bring samples", todo_date: "2026-11-03T12:00:00Z", course_id: 9 }],
  });

  assert.deepEqual(
    dashboard.classes.map((item) => item.title),
    ["Biology", "Studio"],
  );
  assert.equal(dashboard.classes[1].detail, "ART 3");
  assert.deepEqual(
    dashboard.assignments.map((item) => item.title),
    ["Lab report"],
  );
  assert.equal(dashboard.assignments[0].detail, "Biology · 2026-11-02");
  assert.deepEqual(
    dashboard.tests.map((item) => item.title),
    ["Midterm", "Critique quiz"],
  );
  assert.equal(dashboard.tests[0].url, null);
  assert.deepEqual(
    dashboard.reminders.map((item) => item.title),
    ["Bring samples", "Studio hours"],
  );
  assert.deepEqual(dashboard.exams, []);
  assert.equal(JSON.stringify(dashboard).includes("evil.example"), false);
  assert.equal(JSON.stringify(dashboard).includes("<b>"), false);
});

function jsonResponse(body, { status = 200, link = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "link" ? link : null) },
    json: async () => body,
  };
}

test("reads each canvas list with the user token and ignores off-host pages", async () => {
  const seen = [];
  const dashboard = await readCanvasDashboard(
    async (url, options) => {
      const href = String(url);
      seen.push({ href, authorization: options.headers.authorization });
      if (href.includes("/api/v1/courses?")) {
        return jsonResponse([{ id: 7, name: "Biology", course_code: "BIO 1", workflow_state: "available" }], {
          link: '<https://evil.example/api/v1/courses?page=2>; rel="next"',
        });
      }
      if (href.includes("/assignments")) {
        return jsonResponse([
          {
            id: 1,
            course_id: 7,
            name: "Lab report",
            due_at: "2026-11-02T18:00:00Z",
            html_url: "https://canvas.example.edu/courses/7/assignments/1",
            submission_types: ["online_upload"],
          },
        ]);
      }
      if (href.includes("/quizzes")) return jsonResponse([]);
      if (href.includes("/calendar_events")) {
        return jsonResponse([{ id: 4, title: "Office hours", start_at: "2026-11-03T15:00:00Z", context_code: "course_7" }]);
      }
      if (href.includes("/planner_notes")) return jsonResponse([{ id: 6, title: "Email the TA", todo_date: "2026-11-01T12:00:00Z", course_id: 7 }]);
      return jsonResponse([], { status: 404 });
    },
    { origin, accessToken: "access-token", canvasId: "42" },
  );

  assert.equal(seen.every((call) => call.href.startsWith(origin)), true);
  assert.equal(seen.every((call) => call.authorization === "Bearer access-token"), true);
  assert.equal(seen.some((call) => call.href.includes("evil.example")), false);
  assert.deepEqual(dashboard.classes.map((item) => item.title), ["Biology"]);
  assert.deepEqual(dashboard.assignments.map((item) => item.title), ["Lab report"]);
  assert.deepEqual(dashboard.reminders.map((item) => item.title), ["Email the TA", "Office hours"]);
  assert.equal(JSON.stringify(dashboard).includes("access-token"), false);
});

test("dashboard route stays blank without a session and does not call canvas", async () => {
  let called = false;
  const middleware = createCanvasDashboardMiddleware(
    {
      CANVAS_BASE_URL: origin,
      CANVAS_CLIENT_ID: "client-id",
      CANVAS_CLIENT_SECRET: "client-secret",
      CANVAS_REDIRECT_URI: "http://localhost:5174/api/auth/canvas/callback",
      SESSION_SECRET: "session-secret",
    },
    {
      fetch: async () => {
        called = true;
        throw new Error("unused");
      },
    },
  );

  const response = await new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: "",
      writeHead(code) {
        this.statusCode = code;
      },
      end(body) {
        this.body = body;
        resolve(this);
      },
    };
    middleware({ method: "GET", url: "/api/canvas/dashboard", headers: {} }, res, () => resolve({ statusCode: 404, body: "next" }));
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    classes: [],
    assignments: [],
    tests: [],
    reminders: [],
    exams: [],
  });
  assert.equal(called, false);
});

test("dashboard route reads canvas for the signed-in user and hides the token", async () => {
  const secret = "session-secret";
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
    secret,
  );
  const middleware = createCanvasDashboardMiddleware(
    {
      CANVAS_BASE_URL: origin,
      CANVAS_CLIENT_ID: "client-id",
      CANVAS_CLIENT_SECRET: "client-secret",
      CANVAS_REDIRECT_URI: "http://localhost:5174/api/auth/canvas/callback",
      SESSION_SECRET: secret,
    },
    {
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("/api/v1/courses?")) {
          return jsonResponse([{ id: 7, name: "Biology", course_code: "BIO 1", workflow_state: "available" }]);
        }
        return jsonResponse([]);
      },
    },
  );

  const response = await new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: "",
      writeHead(code) {
        this.statusCode = code;
      },
      end(body) {
        this.body = body;
        resolve(this);
      },
    };
    middleware(
      {
        method: "GET",
        url: "/api/canvas/dashboard?course_id=999",
        headers: { cookie: `canvi_session=${encodeURIComponent(session)}` },
      },
      res,
      () => resolve({ statusCode: 404, body: "next" }),
    );
  });

  const body = JSON.parse(response.body);
  assert.deepEqual(body.classes.map((item) => item.title), ["Biology"]);
  assert.equal(response.body.includes("access-token"), false);
  assert.deepEqual(body.assignments, []);
  assert.deepEqual(body.tests, []);
  assert.deepEqual(body.reminders, []);
});

test("a partial sync keeps syllabus exams for a course that failed", () => {
  const merged = mergePartialDashboard(
    {
      classes: [],
      assignments: [],
      tests: [],
      reminders: [],
      exams: [{ id: "exam:7:midterm:2026-10-15:midterm", title: "Midterm", courseId: "7", dueAt: "2026-10-15", examKind: "midterm" }],
    },
    {
      classes: [],
      assignments: [],
      tests: [],
      reminders: [],
      exams: [],
      failedCourseIds: ["7"],
      partial: true,
    },
  );
  assert.equal(merged.exams[0].title, "Midterm");
  assert.equal(merged.partial, true);
});

test("dashboard sync reads midterm and final dates from the syllabus", async () => {
  const secret = "session-secret";
  const store = createSettingsStore({ secret });
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
    secret,
  );
  const syllabus =
    "<p>Meet in room 12.</p><p>Midterm exam: October 15, 2026 at 10:00 AM.</p><p>The final project is due on December 1, 2026.</p><p>Final exam — December 10, 2026.</p>";
  const middleware = createCanvasDashboardMiddleware(
    {
      CANVAS_BASE_URL: origin,
      CANVAS_CLIENT_ID: "client-id",
      CANVAS_CLIENT_SECRET: "client-secret",
      CANVAS_REDIRECT_URI: "http://localhost:5174/api/auth/canvas/callback",
      SESSION_SECRET: secret,
    },
    {
      store,
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("/api/v1/courses?")) {
          return jsonResponse([
            {
              id: 7,
              name: "Biology",
              course_code: "BIO 1",
              workflow_state: "available",
              start_at: "2026-08-20T00:00:00Z",
              end_at: "2026-12-18T00:00:00Z",
            },
          ]);
        }
        if (href.includes("syllabus_body")) return jsonResponse({ id: 7, syllabus_body: syllabus });
        return jsonResponse([]);
      },
    },
  );

  const response = await new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: "",
      writeHead(code) {
        this.statusCode = code;
      },
      end(body) {
        this.body = body;
        resolve(this);
      },
    };
    middleware(
      { method: "GET", url: "/api/canvas/dashboard", headers: { cookie: `canvi_session=${encodeURIComponent(session)}` } },
      res,
      () => resolve({ statusCode: 404, body: "next" }),
    );
  });

  const body = JSON.parse(response.body);
  assert.deepEqual(
    body.exams.map((exam) => [exam.examKind, exam.dueAt, exam.title, exam.clock ?? ""]),
    [
      ["midterm", "2026-10-15", "Midterm exam", "10:00 AM"],
      ["final", "2026-12-10", "Final exam", ""],
    ],
  );
  assert.equal(body.exams[0].url, "https://canvas.example.edu/courses/7/assignments/syllabus");
  assert.equal(response.body.includes("room 12"), false);
  assert.equal(response.body.includes("December 1"), false);
  assert.equal(response.body.includes("access-token"), false);
  const cached = store.cacheFor({ canvasId: "42", host: "canvas.example.edu" });
  assert.equal(cached.exams[0].examKind, "midterm");
  assert.equal(JSON.stringify(cached).includes("room 12"), false);
});

test("a syllabus for a different course does not become an exam", async () => {
  const dashboard = await readCanvasDashboard(
    async (url) => {
      const href = String(url);
      if (href.includes("/api/v1/courses?")) {
        return jsonResponse([{ id: 7, name: "Biology", course_code: "BIO 1", workflow_state: "available" }]);
      }
      if (href.includes("syllabus_body")) {
        return jsonResponse({ id: 99, syllabus_body: "<p>Final exam: December 10, 2026</p>" });
      }
      return jsonResponse([]);
    },
    { origin, accessToken: "access-token", canvasId: "42" },
  );
  assert.deepEqual(dashboard.exams, []);
  assert.deepEqual(dashboard.syllabusFailedCourseIds, ["7"]);
});

test("an oversized syllabus does not become an exam", async () => {
  let parsed = false;
  const dashboard = await readCanvasDashboard(
    async (url) => {
      const href = String(url);
      if (href.includes("/api/v1/courses?")) {
        return jsonResponse([{ id: 7, name: "Biology", course_code: "BIO 1", workflow_state: "available" }]);
      }
      if (href.includes("syllabus_body")) {
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => (name.toLowerCase() === "content-length" ? "400000" : null) },
          json: async () => {
            parsed = true;
            return { id: 7, syllabus_body: "<p>Final exam: December 10, 2026</p>" };
          },
        };
      }
      return jsonResponse([]);
    },
    { origin, accessToken: "access-token", canvasId: "42" },
  );
  assert.equal(parsed, false);
  assert.deepEqual(dashboard.exams, []);
  assert.deepEqual(dashboard.syllabusFailedCourseIds, ["7"]);
});

test("a failed syllabus read keeps the stored exam", async () => {
  const secret = "session-secret";
  const store = createSettingsStore({ secret });
  const user = { canvasId: "42", host: "canvas.example.edu", accessToken: "access-token" };
  store.saveSync(user, {
    classes: [{ id: "7", title: "Biology", courseId: "7", canvasType: "course" }],
    assignments: [],
    tests: [],
    reminders: [],
    catalog: [],
    exams: [
      {
        id: "exam:7:final:2026-12-10:final",
        title: "Final",
        courseId: "7",
        dueAt: "2026-12-10",
        examKind: "final",
        canvasType: "syllabus_exam",
      },
    ],
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
    secret,
  );
  const middleware = createCanvasDashboardMiddleware(
    {
      CANVAS_BASE_URL: origin,
      CANVAS_CLIENT_ID: "client-id",
      CANVAS_CLIENT_SECRET: "client-secret",
      CANVAS_REDIRECT_URI: "http://localhost:5174/api/auth/canvas/callback",
      SESSION_SECRET: secret,
    },
    {
      store,
      fetch: async (url) => {
        const href = String(url);
        if (href.includes("/api/v1/courses?")) {
          return jsonResponse([{ id: 7, name: "Biology", course_code: "BIO 1", workflow_state: "available" }]);
        }
        if (href.includes("syllabus_body")) return jsonResponse({}, { status: 500 });
        return jsonResponse([]);
      },
    },
  );
  const response = await new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: "",
      writeHead(code) {
        this.statusCode = code;
      },
      end(body) {
        this.body = body;
        resolve(this);
      },
    };
    middleware(
      { method: "GET", url: "/api/canvas/dashboard", headers: { cookie: `canvi_session=${encodeURIComponent(session)}` } },
      res,
      () => resolve({ statusCode: 404, body: "next" }),
    );
  });
  const body = JSON.parse(response.body);
  assert.equal(body.exams[0].title, "Final");
  assert.equal(Object.hasOwn(body, "syllabusFailedCourseIds"), false);
  assert.equal(store.cacheFor(user).exams[0].title, "Final");
});
