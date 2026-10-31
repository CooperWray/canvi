import { isDateKey } from "./model.js";

const HEX = /^#[0-9a-f]{6}$/i;

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function dayHeading(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function calendarSummary(view) {
  if (!view.classes.length && !view.events.length) return "Canvas has no classes for this calendar yet.";
  const due = view.events.filter((event) => event.kind === "assignment" || event.kind === "test").length;
  const exams = view.exams.length;
  const classText = view.classes.length === 1 ? "1 class." : `${view.classes.length} classes.`;
  const dueText = due === 1 ? "1 due date." : `${due} due dates.`;
  const examText = exams === 1 ? "1 syllabus exam." : exams ? `${exams} syllabus exams.` : "No syllabus exam dates.";
  return `${classText} ${dueText} ${examText}`;
}

function chip(event) {
  const item = node("span", "calendar-chip", event.title);
  item.dataset.kind = event.kind;
  item.title = [event.kindLabel, event.classTitle, event.title].filter(Boolean).join(" · ");
  if (HEX.test(event.color)) item.style.borderLeftColor = event.color;
  if (event.submitted) item.classList.add("is-done");
  return item;
}

function agenda(view, selected) {
  const panel = node("section", "calendar-agenda");
  panel.setAttribute("aria-live", "polite");
  if (!selected || !isDateKey(selected)) {
    panel.append(node("h2", "", "Selected day"), node("p", "help", "Select a day."));
    return panel;
  }
  panel.append(node("h2", "", dayHeading(selected)));
  const events = view.events.filter((event) => event.dateKey === selected);
  if (!events.length) {
    panel.append(node("p", "help", "This day has no due dates."));
    return panel;
  }
  const list = node("ul", "calendar-agenda-list");
  for (const event of events) {
    const item = node("li");
    if (HEX.test(event.color)) item.style.borderLeftColor = event.color;
    const href = safeHttpUrl(event.url);
    const title = href ? node("a") : node("strong");
    if (href) {
      title.href = href;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    title.textContent = event.title;
    item.append(title);
    const detail = [event.kindLabel, event.classTitle, event.clock, event.submitted ? "Submitted in Canvas" : ""]
      .filter(Boolean)
      .join(" · ");
    if (detail) item.append(node("span", "", detail));
    list.append(item);
  }
  panel.append(list);
  return panel;
}

export function renderCalendar(root, view, { selected = "" } = {}) {
  root.replaceChildren();

  const toolbar = node("div", "calendar-toolbar");
  const previous = node("button", "btn btn-ghost", "Previous");
  previous.type = "button";
  previous.dataset.calendar = "prev";
  previous.setAttribute("aria-label", "Show the previous month.");
  const next = node("button", "btn btn-ghost", "Next");
  next.type = "button";
  next.dataset.calendar = "next";
  next.setAttribute("aria-label", "Show the next month.");
  const today = node("button", "btn btn-ghost", "Today");
  today.type = "button";
  today.dataset.calendar = "today";
  today.setAttribute("aria-label", "Show today.");
  const heading = node("h2", "calendar-month", view.label);
  heading.id = "calendar-month";
  toolbar.append(previous, heading, next, today);

  const legend = node("ul", "calendar-legend");
  legend.setAttribute("aria-label", "Classes");
  if (!view.classes.length) legend.append(node("li", "help", "No classes yet."));
  for (const course of view.classes) {
    const item = node("li");
    const swatch = node("span", "calendar-swatch");
    if (HEX.test(course.color)) swatch.style.background = course.color;
    item.append(swatch, document.createTextNode(course.concluded ? `${course.title} · Concluded` : course.title));
    legend.append(item);
  }

  const exams = node("section", "calendar-exams");
  exams.append(node("h2", "", "Syllabus exams"));
  if (!view.exams.length) exams.append(node("p", "help", "No syllabus lists a midterm date or a final date."));
  else {
    const list = node("ul");
    for (const exam of view.exams) {
      const item = node("li");
      const button = node("button", "btn btn-text", exam.title);
      button.type = "button";
      button.dataset.calendar = "exam";
      button.dataset.date = exam.dateKey;
      item.append(button);
      const detail = [exam.classTitle, exam.dateKey, exam.clock].filter(Boolean).join(" · ");
      if (detail) item.append(node("span", "", detail));
      list.append(item);
    }
    exams.append(list);
  }

  const board = node("div", "calendar-board");
  board.setAttribute("role", "group");
  board.setAttribute("aria-labelledby", "calendar-month");
  const weekdays = node("div", "calendar-weekdays");
  for (const label of view.weekdays) weekdays.append(node("span", "", label));
  board.append(weekdays);
  for (const week of view.weeks) {
    const row = node("div", "calendar-week");
    for (const day of week) {
      const button = node("button", "calendar-day");
      button.type = "button";
      button.dataset.calendar = "day";
      button.dataset.date = day.dateKey;
      if (!day.inMonth) button.classList.add("is-outside");
      if (day.isToday) button.classList.add("is-today");
      if (selected === day.dateKey) {
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
      }
      const count = day.events.length;
      const countLabel = count === 1 ? "1 item" : `${count} items`;
      button.setAttribute("aria-label", count ? `${day.dateKey}, ${countLabel}` : day.dateKey);
      button.append(node("span", "calendar-day-num", String(day.day)));
      for (const event of day.events.slice(0, 3)) button.append(chip(event));
      if (day.events.length > 3) button.append(node("span", "calendar-more", `+${day.events.length - 3}`));
      row.append(button);
    }
    board.append(row);
  }

  root.append(toolbar, legend, exams, board, agenda(view, selected));
}
