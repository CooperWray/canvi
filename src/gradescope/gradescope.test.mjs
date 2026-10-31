import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import path from "node:path";
import { createGradescopeAdapter } from "./adapter.js";
import { applyPageClicks, designateQuestions } from "./designate.js";
import { pdfFromJpegs } from "./pdf-pages.js";
import { resolveOcrOptions } from "./photo-reader.js";

const outline = [
  { id: "11", label: "Question 1" },
  { id: "12", label: "Question 2" },
  { id: "13", label: "Question 3" },
];

test("a continuation page stays with the open question and an instruction page stays free", () => {
  const result = designateQuestions(outline, [
    { text: "Read every question before you start." },
    { text: "Question 1\nThe integral is 4." },
    { text: "1. more working for the same answer\n2. the next step" },
    { text: "Question 2\nfirst part\nQuestion 3\nsecond part" },
    { text: "the rest of question 3" },
  ]);
  assert.deepEqual(result.assignments.map((item) => item.pages), [[2, 3], [4], [4, 5]]);
  assert.deepEqual(result.unmatchedPages, [1]);
  assert.deepEqual(result.unmatchedQuestions, []);
  assert.equal(result.sequential, false);
});

test("a specific subquestion beats its parent and question 1 does not take question 10", () => {
  const questions = [
    { id: "1", title: "1" },
    { id: "2", title: "1.1" },
    { id: "3", label: "10" },
  ];
  const specific = designateQuestions(questions, [{ text: "Question 1.1\nUse the parent method." }]);
  assert.deepEqual(specific.assignments.map((item) => item.pages), [[], [1], []]);

  const tens = designateQuestions(
    [
      { id: "1", label: "1" },
      { id: "10", label: "10" },
    ],
    [{ text: "Question 10\nThe later answer." }],
  );
  assert.deepEqual(tens.assignments.map((item) => item.pages), [[], [1]]);
});

test("pages assign in outline order only when no heading exists and the counts match", () => {
  const photos = [{ text: "see scan" }, { text: "see scan" }];
  const matched = designateQuestions(outline.slice(0, 2), photos);
  assert.equal(matched.sequential, true);
  assert.deepEqual(matched.assignments.map((item) => item.pages), [[1], [2]]);

  const unmatched = designateQuestions(outline, photos);
  assert.equal(unmatched.sequential, false);
  assert.deepEqual(unmatched.unmatchedQuestions, ["11", "12", "13"]);
  assert.deepEqual(unmatched.unmatchedPages, [1, 2]);

  const marked = designateQuestions(outline.slice(0, 2), [
    { text: "Question 99\nnot on this outline" },
    { text: "see scan" },
  ]);
  assert.equal(marked.sequential, false);
  assert.deepEqual(marked.unmatchedQuestions, ["11", "12"]);
  assert.deepEqual(marked.unmatchedPages, [1, 2]);
});

test("page clicks select each question, then its pages, then submit", () => {
  const designation = designateQuestions(outline.slice(0, 2), [
    { text: "Question 1\nAnswer" },
    { text: "still question 1" },
    { text: "Question 2\nAnswer" },
  ]);
  const seen = [];
  applyPageClicks(
    {
      selectQuestion(id) {
        seen.push(`q${id}`);
      },
      selectPage(page) {
        seen.push(`p${page}`);
      },
      submit() {
        seen.push("submit");
      },
    },
    designation,
  );
  assert.deepEqual(seen, ["q11", "p1", "p2", "q12", "p3", "submit"]);
});

test("an unread question blocks the upload", async () => {
  let called = false;
  const adapter = createGradescopeAdapter({
    fetchImpl: async () => {
      called = true;
      return { ok: true, text: async () => "" };
    },
  });
  const result = await adapter.submitPhotos({
    courseId: "9",
    assignmentId: "8",
    questions: outline.slice(0, 2),
    photos: [{ text: "Question 1\nonly the first answer" }],
  });
  assert.equal(called, false);
  assert.equal(result.submitted, false);
  assert.equal(result.outlineStored, false);
  assert.deepEqual(result.designation.unmatchedQuestions, ["12"]);
});

test("a photo upload uses the student form and does not send a password", async () => {
  const calls = [];
  const adapter = createGradescopeAdapter({
    toPdf: () => Buffer.from("%PDF-1.4\n"),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).endsWith("/submissions")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ success: true, url: "/courses/9/assignments/8/submissions/3" }),
        };
      }
      return { ok: true, text: async () => '<meta name="csrf-token" content="tok">' };
    },
  });
  const result = await adapter.submitPhotos({
    courseId: "9",
    assignmentId: "8",
    questions: outline.slice(0, 1),
    photos: [{ text: "Question 1\nAnswer" }],
    allowUnmatched: true,
  });
  assert.equal(result.submitted, true);
  assert.equal(result.outlineStored, false);
  assert.equal(result.selectUrl, "/courses/9/assignments/8/submissions/3");
  assert.deepEqual(result.designation.assignments[0].pages, [1]);
  assert.equal(calls[0].url, "https://www.gradescope.com/courses/9/assignments/8");
  const fields = [...calls[1].options.body.entries()];
  const names = fields.map(([name]) => name);
  assert.deepEqual(names, ["utf8", "authenticity_token", "submission[method]", "submission[files][]"]);
  assert.equal(fields[1][1], "tok");
  assert.equal(fields[2][1], "upload");
  assert.equal(fields[3][1].type, "application/pdf");
  assert.equal(fields[3][1].name, "submission.pdf");
  assert.equal(JSON.stringify(names).includes("password"), false);
});

test("a course id with a path is refused before any request", async () => {
  let called = false;
  const adapter = createGradescopeAdapter({
    fetchImpl: async () => {
      called = true;
      return { ok: false, text: async () => "" };
    },
  });
  await assert.rejects(
    () => adapter.submitPhotos({ courseId: "9/other", assignmentId: "8", questions: outline, photos: [{ text: "Question 1" }] }),
    /invalid_id/,
  );
  assert.equal(called, false);
});

test("jpeg photos become one pdf page per photo", () => {
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/fyiiigD/9k=",
    "base64",
  );
  const pdf = Buffer.from(pdfFromJpegs([{ bytes: jpeg }, { bytes: jpeg }]));
  assert.equal(pdf.includes(jpeg), true);
  assert.match(pdf.toString("latin1"), /\/Count 2/);
  assert.match(pdf.toString("latin1"), /\/ColorSpace \/DeviceRGB/);
  assert.equal(pdf.toString("latin1").startsWith("%PDF-1.4"), true);

  const gray = Buffer.from(pdfFromJpegs([{ bytes: sampleJpeg({ components: 1, orientation: 6 }) }]));
  assert.match(gray.toString("latin1"), /\/ColorSpace \/DeviceGray/);
  assert.match(gray.toString("latin1"), /\/Rotate 90/);
  assert.throws(() => pdfFromJpegs([{ bytes: sampleJpeg({ components: 4 }) }]), /invalid_jpeg/);
  assert.throws(() => pdfFromJpegs([{ bytes: sampleJpeg({ components: 1, orientation: 2 }) }]), /invalid_jpeg/);
});

function sampleJpeg({ components, orientation }) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation) {
    const exif = Buffer.from([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49, 0x2a, 0x00,
      0x08, 0x00, 0x00, 0x00,
      0x01, 0x00,
      0x12, 0x01,
      0x03, 0x00,
      0x01, 0x00, 0x00, 0x00,
      orientation, 0x00, 0x00, 0x00,
    ]);
    const app = Buffer.alloc(4 + exif.length);
    app[0] = 0xff;
    app[1] = 0xe1;
    app.writeUInt16BE(exif.length + 2, 2);
    exif.copy(app, 4);
    parts.push(app);
  }
  const sofLength = 8 + components * 3;
  const sof = Buffer.alloc(2 + sofLength);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(sofLength, 2);
  sof[4] = 8;
  sof.writeUInt16BE(1, 5);
  sof.writeUInt16BE(1, 7);
  sof[9] = components;
  for (let index = 0; index < components; index += 1) {
    const at = 10 + index * 3;
    sof[at] = index + 1;
    sof[at + 1] = 0x11;
    sof[at + 2] = 0;
  }
  parts.push(sof);
  return Buffer.concat(parts);
}

test("an html page is not a successful submission", async () => {
  const adapter = createGradescopeAdapter({
    toPdf: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    fetchImpl: async (url) => {
      if (String(url).endsWith("/submissions")) {
        return { ok: true, text: async () => "<html>Please log in</html>" };
      }
      return { ok: true, text: async () => '<meta name="csrf-token" content="tok">' };
    },
  });
  await assert.rejects(
    () =>
      adapter.submitPhotos({
        courseId: "9",
        assignmentId: "8",
        questions: outline.slice(0, 1),
        photos: [{ text: "Question 1\nAnswer" }],
      }),
    /submit_failed/,
  );
});

test("a photo that is not a jpeg does not request gradescope", async () => {
  let called = false;
  const adapter = createGradescopeAdapter({
    fetchImpl: async () => {
      called = true;
      return { ok: false, text: async () => "" };
    },
  });
  await assert.rejects(
    () =>
      adapter.submitPhotos({
        courseId: "9",
        assignmentId: "8",
        questions: outline.slice(0, 1),
        photos: [{ text: "Question 1", bytes: Buffer.from("not-a-jpeg") }],
      }),
    /invalid_jpeg/,
  );
  assert.equal(called, false);
});

test("a bad question id does not read the photo", async () => {
  let read = false;
  const adapter = createGradescopeAdapter({
    readPage: async () => {
      read = true;
      return "";
    },
  });
  await assert.rejects(
    () =>
      adapter.submitPhotos({
        courseId: "9",
        assignmentId: "8",
        questions: [{ id: "1/2", label: "Question 1" }],
        photos: [{ bytes: Buffer.from("x") }],
      }),
    /invalid_outline/,
  );
  assert.equal(read, false);
});

test("a foreign origin is refused before any request", () => {
  let called = false;
  assert.throws(
    () =>
      createGradescopeAdapter({
        origin: "https://www.gradescope.com.evil",
        fetchImpl: async () => {
          called = true;
          return { ok: false, text: async () => "" };
        },
      }),
    /invalid_origin/,
  );
  assert.equal(called, false);
});

test("a select url outside gradescope is dropped", async () => {
  const adapter = createGradescopeAdapter({
    toPdf: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    fetchImpl: async (url) => {
      if (String(url).endsWith("/submissions")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ success: true, url: "https://evil.example/courses/9" }),
        };
      }
      return { ok: true, text: async () => '<meta name="csrf-token" content="tok">' };
    },
  });
  const result = await adapter.submitPhotos({
    courseId: "9",
    assignmentId: "8",
    questions: outline.slice(0, 1),
    photos: [{ text: "Question 1\nAnswer" }],
  });
  assert.equal(result.submitted, true);
  assert.equal(result.selectUrl, null);
});

test("photo reading uses the locked english model", async () => {
  const options = await resolveOcrOptions();
  assert.equal(options.gzip, true);
  assert.equal(options.cacheMethod, "none");
  assert.equal(options.langPath.includes("://"), false);
  assert.equal(options.workerPath.includes("://"), false);
  assert.match(options.workerPath, /worker-script\/node\/index\.js$/);
  await access(path.join(options.langPath, "eng.traineddata.gz"));
  await access(options.workerPath);
});
