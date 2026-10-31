import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasDashboardAdapter } from "./canvas-dashboard.js";

test("the canvas adapter keeps a syllabus exam and drops an unsafe url", async () => {
  const adapter = createCanvasDashboardAdapter({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        classes: [{ id: "7", title: "Biology", courseId: "7", canvasType: "course" }],
        exams: [
          {
            id: "exam:7:final:2026-12-10:final-exam",
            title: "Final exam",
            courseId: "7",
            dueAt: "2026-12-10",
            examKind: "final",
            clock: "8:00 AM",
            canvasType: "syllabus_exam",
            url: "https://canvas.example.edu/courses/7/assignments/syllabus",
          },
          {
            id: "exam:7:bad",
            title: "Midterm",
            courseId: "7",
            dueAt: "2026-10-15",
            examKind: "script",
            clock: "noon",
            url: "javascript:alert(1)",
          },
        ],
      }),
    }),
  });

  const body = await adapter.load();
  assert.equal(body.classes[0].title, "Biology");
  assert.equal(body.exams[0].examKind, "final");
  assert.equal(body.exams[0].dueAt, "2026-12-10");
  assert.equal(body.exams[0].clock, "8:00 AM");
  assert.equal(body.exams[0].url, "https://canvas.example.edu/courses/7/assignments/syllabus");
  assert.equal(body.exams[1].examKind, "");
  assert.equal(body.exams[1].clock, "");
  assert.equal(body.exams[1].url, null);
});
