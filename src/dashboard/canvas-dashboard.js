const BLANK = {
  classes: [],
  assignments: [],
  tests: [],
  reminders: [],
  catalog: [],
  exams: [],
};

function safeUrl(value) {
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

function items(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: typeof item?.id === "string" ? item.id : "",
      title: typeof item?.title === "string" ? item.title : "",
      detail: typeof item?.detail === "string" ? item.detail : "",
      url: safeUrl(item?.url),
      courseId: typeof item?.courseId === "string" ? item.courseId : "",
      dueAt: typeof item?.dueAt === "string" ? item.dueAt : null,
      canvasType: typeof item?.canvasType === "string" ? item.canvasType : "",
      examKind: item?.examKind === "midterm" || item?.examKind === "final" ? item.examKind : "",
      clock: typeof item?.clock === "string" && /^\d{1,2}:\d{2} (AM|PM)$/.test(item.clock) ? item.clock : "",
      submitted: item?.submitted === true,
      concluded: item?.concluded === true,
    }))
    .filter((item) => item.title);
}

export function createCanvasDashboardAdapter({ fetchImpl = fetch } = {}) {
  return {
    async load() {
      const response = await fetchImpl("/api/canvas/dashboard", { headers: { accept: "application/json" } });
      if (!response.ok) return { ...BLANK };
      const body = await response.json();
      return {
        classes: items(body?.classes),
        assignments: items(body?.assignments),
        tests: items(body?.tests),
        reminders: items(body?.reminders),
        catalog: items(body?.catalog),
        exams: items(body?.exams),
      };
    },
  };
}
