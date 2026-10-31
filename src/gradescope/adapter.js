import { designateQuestions, planPageClicks } from "./designate.js";
import { pdfFromJpegs } from "./pdf-pages.js";
import { readPhoto } from "./photo-reader.js";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertId(value) {
  const id = String(value ?? "");
  if (!/^[0-9]+$/.test(id)) throw fail("invalid_id");
  return id;
}

function assertOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw fail("invalid_origin");
  }
  if (url.protocol !== "https:" || url.hostname !== "www.gradescope.com") throw fail("invalid_origin");
  if (url.port || url.username || url.password || url.search || url.hash) throw fail("invalid_origin");
  if (url.pathname !== "/") throw fail("invalid_origin");
  return url.origin;
}

function assertOutline(questions) {
  if (!Array.isArray(questions) || !questions.length) throw fail("invalid_outline");
  for (const question of questions) {
    if (!/^[0-9]+$/.test(String(question?.id ?? ""))) throw fail("invalid_outline");
  }
}

function csrfToken(html) {
  const match = String(html ?? "").match(/<meta name="csrf-token" content="([^"]+)"/i);
  return match ? match[1] : "";
}

function gradescopeSelectUrl(value) {
  if (typeof value !== "string" || !value) return null;
  let url;
  try {
    url = new URL(value, "https://www.gradescope.com");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "www.gradescope.com") return null;
  if (!url.pathname.startsWith("/courses/")) return null;
  return `${url.pathname}${url.search}`;
}

async function readOne(photo, readPage) {
  if (typeof photo?.text === "string") return photo.text;
  if (typeof readPage !== "function") throw fail("reader_missing");
  const text = await readPage(photo);
  if (typeof text !== "string") throw fail("unreadable_photo");
  return text;
}

export function createGradescopeAdapter({
  fetchImpl = fetch,
  readPage = readPhoto,
  toPdf = pdfFromJpegs,
  origin = "https://www.gradescope.com",
} = {}) {
  const base = assertOrigin(origin);

  return {
    designate: designateQuestions,
    planPageClicks,

    async submitPhotos({ courseId, assignmentId, questions, photos, allowUnmatched = false }) {
      const course = assertId(courseId);
      const assignment = assertId(assignmentId);
      assertOutline(questions);
      if (!Array.isArray(photos) || !photos.length) throw fail("invalid_pages");
      const pages = [];
      for (let index = 0; index < photos.length; index += 1) {
        pages.push({ number: index + 1, text: await readOne(photos[index], readPage) });
      }
      const designation = designateQuestions(questions, pages);
      if (!allowUnmatched && designation.unmatchedQuestions.length) {
        return { submitted: false, outlineStored: false, designation, selectUrl: null };
      }

      const pdf = await toPdf(photos);
      const assignmentUrl = `${base}/courses/${course}/assignments/${assignment}`;
      const assignmentPage = await fetchImpl(assignmentUrl, { headers: { accept: "text/html" } });
      const assignmentHtml = await assignmentPage.text();
      const token = csrfToken(assignmentHtml);
      if (!assignmentPage.ok || !token) throw fail("missing_token");

      const body = new FormData();
      body.set("utf8", "✓");
      body.set("authenticity_token", token);
      body.set("submission[method]", "upload");
      body.set("submission[files][]", new Blob([pdf], { type: "application/pdf" }), "submission.pdf");
      const posted = await fetchImpl(`${assignmentUrl}/submissions`, {
        method: "POST",
        body,
        headers: { accept: "application/json, text/html" },
      });
      const raw = await posted.text();
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (!posted.ok || payload?.success !== true) throw fail("submit_failed");
      return {
        submitted: true,
        outlineStored: false,
        designation,
        selectUrl: gradescopeSelectUrl(payload.url),
        clicks: planPageClicks(designation),
      };
    },
  };
}
