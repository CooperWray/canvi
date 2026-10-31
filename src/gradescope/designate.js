function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function questionKey(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  const match = text.match(/^(?:question|problem|q)?\s*(\d{1,3}(?:\.\d{1,3})*[a-z]?)\b/i);
  return match ? match[1].toLowerCase() : "";
}

function headingKey(line) {
  const text = line.trim();
  let match = text.match(/^(?:question|problem)\s+(\d{1,3}(?:\.\d{1,3})*[a-z]?)\b/i);
  if (match) return match[1].toLowerCase();
  match = text.match(/^q\s*(\d{1,3}(?:\.\d{1,3})*[a-z]?)\b/i);
  if (match) return match[1].toLowerCase();
  match = text.match(/^(\d{1,3}(?:\.\d{1,3})+[a-z]?|\d{1,3}[a-z])\b/);
  if (match) return match[1].toLowerCase();
  return "";
}

function matchOutline(found, outline) {
  const exact = outline.filter((item) => item.key === found);
  if (exact.length) return exact;
  const parents = outline.filter((item) => {
    if (!item.key || item.key === found) return false;
    if (found.startsWith(`${item.key}.`)) return true;
    return found.startsWith(item.key) && /^[a-z]/.test(found.slice(item.key.length));
  });
  if (!parents.length) return [];
  const best = parents.reduce((left, right) => (left.key.length >= right.key.length ? left : right));
  return outline.filter((item) => item.key === best.key);
}

function linesOf(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function designateQuestions(questions, pages) {
  if (!Array.isArray(questions) || !questions.length) throw fail("invalid_outline");
  if (!Array.isArray(pages) || !pages.length) throw fail("invalid_pages");
  const outline = questions.map((question, index) => {
    const id = String(question?.id ?? "");
    if (!/^[0-9]+$/.test(id)) throw fail("invalid_outline");
    const label = String(question.label ?? question.title ?? "").trim();
    return { id, label, key: questionKey(label), index };
  });
  const pageList = pages.map((page, index) => ({
    number: Number.isInteger(page?.number) ? page.number : index + 1,
    text: String(page?.text ?? ""),
  }));
  const byId = new Map(outline.map((item) => [item.id, []]));
  let open = [];
  let sawHeading = false;
  let sawMarker = false;

  for (const page of pageList) {
    const lines = linesOf(page.text);
    const found = [];
    lines.forEach((line, index) => {
      const key = headingKey(line);
      if (!key) return;
      sawMarker = true;
      found.push({ key, index });
    });
    const groups = found
      .map((entry) => ({ index: entry.index, items: matchOutline(entry.key, outline) }))
      .filter((entry) => entry.items.length);
    const assigned = new Set();
    if (!groups.length) {
      for (const item of open) assigned.add(item.id);
    } else {
      sawHeading = true;
      if (groups[0].index > 0) {
        for (const item of open) assigned.add(item.id);
      }
      for (const group of groups) {
        for (const item of group.items) assigned.add(item.id);
      }
      open = groups[groups.length - 1].items;
    }
    for (const id of assigned) byId.get(id).push(page.number);
  }

  const sequential = !sawHeading && !sawMarker && pageList.length === outline.length;
  if (sequential) {
    outline.forEach((item, index) => {
      byId.set(item.id, [pageList[index].number]);
    });
  }

  const assignments = outline.map((item) => ({
    id: item.id,
    label: item.label,
    pages: byId.get(item.id),
  }));
  const used = new Set(assignments.flatMap((item) => item.pages));
  return {
    assignments,
    unmatchedQuestions: assignments.filter((item) => !item.pages.length).map((item) => item.id),
    unmatchedPages: pageList.filter((page) => !used.has(page.number)).map((page) => page.number),
    sequential,
  };
}

export function planPageClicks(designation) {
  const clicks = [];
  for (const item of designation?.assignments ?? []) {
    if (!item.pages?.length) continue;
    clicks.push({ type: "question", id: String(item.id) });
    for (const page of item.pages) clicks.push({ type: "page", page });
  }
  clicks.push({ type: "submit" });
  return clicks;
}

export function applyPageClicks(target, designation) {
  for (const click of planPageClicks(designation)) {
    if (click.type === "question") target.selectQuestion(click.id);
    else if (click.type === "page") target.selectPage(click.page);
    else target.submit();
  }
}
