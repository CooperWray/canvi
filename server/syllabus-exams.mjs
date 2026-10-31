const MAX_HTML = 200_000;
const MAX_EXAMS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_SLACK_MS = 45 * DAY_MS;

const MONTH = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAME = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const KEYWORD = /\b(mid[\s-]?terms?|finals?)\b/gi;
const KEYWORD_ONE = /\b(?:mid[\s-]?terms?|finals?)\b/i;

function plainText(html) {
  return html
    .slice(0, MAX_HTML)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*$/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*$/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!--[\s\S]*$/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, value) => {
      const code = Number(value);
      return code > 31 && code < 127 ? String.fromCharCode(code) : " ";
    })
    .replace(/&[a-z]+;/gi, " ");
}

function monthNumber(value) {
  return MONTH[String(value ?? "").toLowerCase().replace(/\./g, "")] ?? 0;
}

function numericDate(match) {
  let month = Number(match[1]);
  let day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) {
    const swap = month;
    month = day;
    day = swap;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function datesIn(text) {
  const found = [];
  const patterns = [
    {
      re: /\b(\d{4})-(\d{2})-(\d{2})\b/gi,
      map: (match) => ({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }),
    },
    {
      re: new RegExp(`\\b(${MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(\\d{4}))?\\b`, "gi"),
      map: (match) => ({
        year: match[3] ? Number(match[3]) : null,
        month: monthNumber(match[1]),
        day: Number(match[2]),
      }),
    },
    {
      re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAME})\\.?(?:,)?(?:\\s+(\\d{4}))?\\b`, "gi"),
      map: (match) => ({
        year: match[3] ? Number(match[3]) : null,
        month: monthNumber(match[2]),
        day: Number(match[1]),
      }),
    },
    {
      re: /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g,
      map: numericDate,
    },
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.re)) {
      const mapped = pattern.map(match);
      if (!mapped || mapped.month < 1 || mapped.day < 1) continue;
      found.push({ ...mapped, index: match.index ?? 0 });
    }
  }
  found.sort((left, right) => left.index - right.index);
  return found;
}

function validDate(year, month, day) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseStamp(value) {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function inferYear(month, day, startAt, endAt, now) {
  const start = parseStamp(startAt);
  const end = parseStamp(endAt);
  if (start != null && end != null && end >= start) {
    const startYear = new Date(start).getUTCFullYear();
    const endYear = new Date(end).getUTCFullYear();
    let best = null;
    let bestDist = Infinity;
    for (let year = startYear - 1; year <= endYear + 1; year += 1) {
      if (!validDate(year, month, day)) continue;
      const stamp = Date.UTC(year, month - 1, day);
      let dist = 0;
      if (stamp < start) dist = start - stamp;
      else if (stamp > end) dist = stamp - end;
      if (dist < bestDist) {
        bestDist = dist;
        best = year;
      }
    }
    if (best != null && bestDist <= YEAR_SLACK_MS) return best;
    return null;
  }
  const current = now instanceof Date ? now : new Date();
  const year = current.getUTCFullYear();
  if (!validDate(year, month, day)) return null;
  const stamp = Date.UTC(year, month - 1, day);
  if (stamp < current.getTime() - 200 * DAY_MS) return year + 1;
  return year;
}

function chooseDate(candidates, bounds, now) {
  for (const date of candidates) {
    const year = date.year ?? inferYear(date.month, date.day, bounds.startAt, bounds.endAt, now);
    if (!validDate(year, date.month, date.day)) continue;
    return { year, month: date.month, day: date.day };
  }
  return null;
}

function kindOf(slice) {
  const lower = slice.toLowerCase();
  if (/\bmid[\s-]?terms?\b/.test(lower)) {
    if (/\breview\b/.test(lower) || /\bpractice\b/.test(lower)) return "";
    return "midterm";
  }
  if (/\bfinal\s+(project|paper|draft|report|presentation|essay|portfolio|grade)\b/.test(lower)) return "";
  if (/\breview\b/.test(lower) || /\bpractice\b/.test(lower)) return "";
  if (/\bfinals\b/.test(lower) || /\bfinal\s+(exam|examination)\b/.test(lower) || /\bfinal\s*[:\-–—]/.test(lower)) return "final";
  if (/^\s*final\b/.test(lower)) return "final";
  return "";
}

function examTitle(kind, slice) {
  const base = kind === "final" ? "Final" : "Midterm";
  const numbered = slice.match(/\b(?:mid[\s-]?terms?|finals?)\s*#?\s*(\d{1,2})\b/i);
  if (numbered) return `${base} ${numbered[1]}`;
  if (/\bexam(?:ination)?\b/i.test(slice)) return `${base} exam`;
  return base;
}

function clockOf(text) {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = match[2] ?? "00";
  if (hour < 1 || hour > 12 || Number(minute) > 59) return "";
  const suffix = match[3].toLowerCase().startsWith("a") ? "AM" : "PM";
  return `${hour}:${minute.padStart(2, "0")} ${suffix}`;
}

function isoDate(year, month, day) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function chunksOf(text) {
  const blocks = text
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 500);
  const chunks = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.length < 80 && blocks[index + 1]) chunks.push(`${block} ${blocks[index + 1]}`);
    else chunks.push(block);
  }
  return chunks;
}

export function extractSyllabusExams(html, { courseId, startAt = null, endAt = null, now = new Date() } = {}) {
  const id = String(courseId ?? "");
  if (!/^[0-9]+$/.test(id) || typeof html !== "string" || !html.trim()) return [];
  const bounds = { startAt, endAt };
  const exams = [];
  const seen = new Set();
  for (const chunk of chunksOf(plainText(html))) {
    for (const match of chunk.matchAll(KEYWORD)) {
      const keywordIndex = match.index ?? 0;
      const rest = chunk.slice(keywordIndex + match[0].length);
      const next = rest.search(KEYWORD_ONE);
      const end = keywordIndex + match[0].length + (next === -1 ? 180 : Math.min(next, 180));
      const forward = chunk.slice(keywordIndex, end);
      const kind = kindOf(forward);
      if (!kind) continue;
      const ahead = chooseDate(datesIn(forward), bounds, now);
      const behindText = chunk.slice(Math.max(0, keywordIndex - 48), keywordIndex);
      const behind = ahead || KEYWORD_ONE.test(behindText)
        ? null
        : chooseDate(datesIn(behindText).reverse(), bounds, now);
      const date = ahead ?? behind;
      if (!date) continue;
      const dueAt = isoDate(date.year, date.month, date.day);
      const title = examTitle(kind, forward);
      const key = `${kind}:${dueAt}:${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      exams.push({
        id: `exam:${id}:${kind}:${dueAt}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 80),
        title,
        dueAt,
        examKind: kind,
        courseId: id,
        clock: clockOf(forward),
      });
      if (exams.length >= MAX_EXAMS) return exams;
    }
  }
  return exams;
}
