import assert from "node:assert/strict";
import test from "node:test";
import { extractSyllabusExams } from "./syllabus-exams.mjs";

const course = { courseId: "7", startAt: "2026-08-20T00:00:00Z", endAt: "2026-12-18T00:00:00Z" };

test("reads a midterm date and a final date from syllabus html", () => {
  const exams = extractSyllabusExams(
    "<h2>Exams</h2><p>Midterm exam: October 15, 2026 at 10:00 AM.</p><table><tr><td>Final exam</td><td>December 10, 2026</td></tr></table>",
    course,
  );
  assert.deepEqual(
    exams.map((exam) => [exam.examKind, exam.dueAt, exam.title, exam.clock]),
    [
      ["midterm", "2026-10-15", "Midterm exam", "10:00 AM"],
      ["final", "2026-12-10", "Final exam", ""],
    ],
  );
});

test("ignores a final project, a review session, and a date in a script", () => {
  const exams = extractSyllabusExams(
    [
      "<p>The final project is due on December 1, 2026.</p>",
      "<p>Midterm review: October 13, 2026.</p>",
      "<p>Final exam — December 10, 2026.</p>",
      "<script>var when = '1999-01-01';</script>",
    ].join(""),
    course,
  );
  assert.deepEqual(
    exams.map((exam) => [exam.examKind, exam.dueAt]),
    [["final", "2026-12-10"]],
  );
});

test("uses the course term when the syllabus omits the year", () => {
  const fall = extractSyllabusExams("<p>Midterm: October 15</p>", course);
  assert.equal(fall[0].dueAt, "2026-10-15");

  const year = extractSyllabusExams("<p>Final exam: January 12</p>", {
    courseId: "7",
    startAt: "2026-08-20T00:00:00Z",
    endAt: "2027-05-10T00:00:00Z",
  });
  assert.equal(year[0].dueAt, "2027-01-12");

  const far = extractSyllabusExams("<p>Midterm: March 2</p>", course);
  assert.deepEqual(far, []);
});

test("keeps two midterms and a numeric date", () => {
  const exams = extractSyllabusExams(
    "<p>Midterm 1 is on 10/01/2026. Midterm 2 is on November 5, 2026.</p>",
    course,
  );
  assert.deepEqual(
    exams.map((exam) => [exam.title, exam.dueAt]),
    [
      ["Midterm 1", "2026-10-01"],
      ["Midterm 2", "2026-11-05"],
    ],
  );
});

test("reads a date on the next line and a date written before the label", () => {
  const exams = extractSyllabusExams("<p>Midterm exam</p><p>October 15, 2026</p><p>December 10, 2026 — Final</p>", course);
  assert.deepEqual(
    exams.map((exam) => [exam.examKind, exam.dueAt]),
    [
      ["midterm", "2026-10-15"],
      ["final", "2026-12-10"],
    ],
  );
});

test("ignores a date inside an unclosed script", () => {
  const exams = extractSyllabusExams(
    "<p>Final exam: December 10, 2026</p><script>Midterm exam: October 15, 2026",
    course,
  );
  assert.deepEqual(exams.map((exam) => exam.dueAt), ["2026-12-10"]);
});

test("ignores a date in an html comment", () => {
  const exams = extractSyllabusExams(
    "<p>Final exam: December 10, 2026</p><!-- Midterm exam: October 15, 2026 -->",
    course,
  );
  assert.deepEqual(exams.map((exam) => exam.dueAt), ["2026-12-10"]);
});

test("ignores a date past the syllabus size cap", () => {
  const exams = extractSyllabusExams(`${"a".repeat(200_000)}<p>Final exam: December 10, 2026</p>`, course);
  assert.deepEqual(exams, []);
});

test("returns no exams for a blank syllabus or a bad course id", () => {
  assert.deepEqual(extractSyllabusExams("", course), []);
  assert.deepEqual(extractSyllabusExams("<p>Final exam: December 10, 2026</p>", { courseId: "bio" }), []);
  assert.deepEqual(extractSyllabusExams("<p>Final exam: February 31, 2026</p>", course), []);
});
