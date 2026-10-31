import { createCanvasLoginAdapter } from "./auth/canvas-login.js";
import { buildCalendar, isDateKey, shiftMonth } from "./calendar/model.js";
import { calendarSummary, renderCalendar } from "./calendar/page.js";
import { createCanvasDashboardAdapter } from "./dashboard/canvas-dashboard.js";
import { defaultSettings, presentDashboard } from "./settings/model.js";
import { createReminderRuntime } from "./settings/reminder-runtime.js";
import { createSettingsController } from "./settings/settings-page.js";

const auth = createCanvasLoginAdapter();
const dashboard = createCanvasDashboardAdapter();

const state = {
  page: "dashboard",
  user: null,
};

const blankCanvas = {
  classes: [],
  assignments: [],
  tests: [],
  reminders: [],
  catalog: [],
  exams: [],
};

let canvasData = { ...blankCanvas };
let settings = defaultSettings();
let pageChosen = false;
let calendarMonth = null;
let calendarDay = "";

const viewLogin = document.querySelector("#view-login");
const viewApp = document.querySelector("#view-app");
const form = document.querySelector("#login-form");
const canvasHost = document.querySelector("#canvas-host");
const loginHint = document.querySelector("#login-hint");
const submitBtn = document.querySelector("#submit-auth");
const userChip = document.querySelector("#user-chip");
const userMenu = document.querySelector("#user-menu");
const userName = document.querySelector("#user-name");
const userAvatar = document.querySelector("#user-avatar");
const menuCanvasId = document.querySelector("#menu-canvas-id");
const dashboardStatus = document.querySelector("#dashboard-status");
const settingsStatus = document.querySelector("#settings-status");
const notifyBtn = document.querySelector("#notify-btn");
const segment = document.querySelector(".side-nav");
const pageDashboard = document.querySelector("#page-dashboard");
const pageCalendar = document.querySelector("#page-calendar");
const pageSettings = document.querySelector("#page-settings");
const calendarStatus = document.querySelector("#calendar-status");
const calendarRoot = document.querySelector("#calendar-root");
const dashboardBlocks = document.querySelector(".blocks");
const toasts = document.querySelector("#toasts");
const pointer = document.querySelector("#pointer");
const loginCard = document.querySelector("#login-card");

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  toasts.append(el);
  window.setTimeout(() => el.remove(), 2400);
}

function ripple(event) {
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const span = document.createElement("span");
  span.className = "ripple";
  const size = 18;
  const x = (event.clientX || rect.left + rect.width / 2) - rect.left;
  const y = (event.clientY || rect.top + rect.height / 2) - rect.top;
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${x - size / 2}px`;
  span.style.top = `${y - size / 2}px`;
  btn.append(span);
  window.setTimeout(() => span.remove(), 520);
}

function caption(text) {
  const el = document.querySelector("#caption");
  el.hidden = !text;
  el.textContent = text;
}

function setPressed(button, value = null) {
  const next = value ?? button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(next));
  return next;
}

function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function applyAppearance(next) {
  const theme = next?.appearance?.theme ?? "system";
  document.documentElement.dataset.theme = resolvedTheme(theme);
  document.documentElement.dataset.density = next?.appearance?.density === "compact" ? "compact" : "comfortable";
}

function resolvedTheme(theme) {
  if (theme === "night") return "night";
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function paintStatus() {
  if (!state.user) return;
  const name = settings.account.displayName || state.user.name;
  const message = settingsController.getConnection()?.message;
  dashboardStatus.textContent = message
    ? `Signed in as ${name}. Canvas ID ${state.user.canvasId}. ${message}`
    : `Signed in as ${name}. Canvas ID ${state.user.canvasId}.`;
}

function repaint() {
  applyAppearance(settings);
  paintDashboard(presentDashboard(canvasData, settings, new Date(), deviceZone()));
  paintCalendar();
  if (!state.user) return;
  const name = settings.account.displayName || state.user.name;
  userName.textContent = name;
  userAvatar.textContent = name.slice(0, 1).toUpperCase();
  paintStatus();
}

function paintDashboard(view) {
  const container = dashboardBlocks;
  container.replaceChildren();
  if (!view.sections.length) {
    container.append(note("Every dashboard section is hidden. Turn one on in Settings."));
    return;
  }
  for (const section of view.sections) {
    const block = document.createElement("section");
    block.className = "block";
    block.dataset.section = section.id;
    const heading = document.createElement("h2");
    heading.textContent = section.title;
    block.append(heading);
    const items = section.groups.flatMap((group) => group.items);
    if (!items.length) block.append(note(section.empty || "Canvi has no items here yet."));
    for (const group of section.groups) {
      if (!group.items.length) continue;
      if (group.heading) {
        const label = document.createElement("h3");
        label.textContent = group.heading;
        block.append(label);
      }
      const list = document.createElement("ul");
      for (const item of group.items) list.append(itemRow(item));
      block.append(list);
    }
    container.append(block);
  }
}

function currentCalendar() {
  return buildCalendar({
    canvas: canvasData,
    settings,
    now: new Date(),
    deviceZone: deviceZone(),
    month: calendarMonth,
  });
}

function paintCalendar() {
  const view = currentCalendar();
  if (state.user) calendarStatus.textContent = calendarSummary(view);
  renderCalendar(calendarRoot, view, { selected: calendarDay });
}

function note(text) {
  const node = document.createElement("p");
  node.className = "help";
  node.textContent = text;
  return node;
}

function itemRow(item) {
  const li = document.createElement("li");
  if (item.color && /^#[0-9a-f]{6}$/i.test(item.color)) li.style.borderLeftColor = item.color;
  if (item.url) {
    const link = document.createElement("a");
    link.href = item.url;
    link.textContent = item.title;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    li.append(link);
  } else {
    const title = document.createElement("strong");
    title.textContent = item.title;
    li.append(title);
  }
  if (item.detail) li.append(noteSpan(item.detail));
  if (item.typeLabel) li.append(noteSpan(item.typeLabel));
  if (item.submitted) li.append(noteSpan("Submitted in Canvas"));
  if (item.completed) li.append(noteSpan("Complete in Canvi"));
  if (item.canvasType === "course") return li;
  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(itemButton(item.completed ? "Mark not complete" : "Mark complete in Canvi", "complete", item.id));
  if (item.canvasType === "assignment" || item.canvasType === "quiz" || item.origin === "manual") {
    actions.append(itemButton(item.important ? "Remove important" : "Mark important", "important", item.id));
  }
  if (item.canvasType === "assignment") {
    actions.append(itemButton(item.labeledTest ? "Remove test label" : "Label as a test", "label", item.id));
  }
  li.append(actions);
  return li;
}

function noteSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function itemButton(text, action, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-text";
  button.dataset.itemAction = action;
  button.dataset.id = id;
  button.textContent = text;
  return button;
}

function toggleId(list, id) {
  const next = new Set(list);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return [...next];
}

async function loadDashboard() {
  try {
    canvasData = await dashboard.load();
  } catch {
    canvasData = { ...blankCanvas };
  }
  settingsController.setCanvas(canvasData);
  repaint();
}

function showApp(user) {
  state.user = user;
  viewLogin.hidden = true;
  viewApp.hidden = false;
  userName.textContent = user.name;
  userAvatar.textContent = user.name.slice(0, 1).toUpperCase();
  menuCanvasId.textContent = `Canvas ID ${user.canvasId}`;
  dashboardStatus.textContent = `Signed in as ${user.name}. Canvas ID ${user.canvasId}.`;
  setPage(state.page);
  void openWorkspace(user);
}

async function openWorkspace(user) {
  await settingsController.start(user);
  const loaded = settingsController.getSettings();
  if (loaded) settings = loaded;
  if (!walkthroughMode) reminders.start();
  await loadDashboard();
  await settingsController.reload();
  const next = settingsController.getSettings();
  if (next) settings = next;
  repaint();
  if (!pageChosen && next?.appearance.landing === "settings") setPage("settings");
}

function signOut() {
  reminders.stop();
  settingsController.stop();
  settings = defaultSettings();
  canvasData = { ...blankCanvas };
  auth.logout().finally(() => {
    toast("Signed out.");
    showLogin();
  });
}

function showLogin() {
  reminders.stop();
  settingsController.stop();
  state.user = null;
  settings = defaultSettings();
  canvasData = { ...blankCanvas };
  viewApp.hidden = true;
  viewLogin.hidden = false;
  userMenu.hidden = true;
  userChip.setAttribute("aria-expanded", "false");
  submitBtn.classList.remove("is-loading");
  submitBtn.disabled = false;
  loginCard.classList.remove("is-busy");
  dashboardBlocks.replaceChildren();
  calendarRoot.replaceChildren();
  calendarMonth = null;
  calendarDay = "";
  calendarStatus.textContent = "Sign in with Canvas to fill this calendar.";
}

function setPage(page) {
  state.page = page;
  segment.dataset.page = page;
  document.querySelectorAll(".segment-btn").forEach((btn) => {
    const active = btn.dataset.page === page;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  pageDashboard.hidden = page !== "dashboard";
  pageCalendar.hidden = page !== "calendar";
  pageSettings.hidden = page !== "settings";
}

function attachDynamics() {
  document.querySelectorAll(".btn, .segment-btn, .user-chip, .menu button").forEach((btn) => {
    btn.addEventListener("click", ripple);
  });

  document.querySelectorAll("[data-magnetic]").forEach((btn) => {
    btn.addEventListener("pointermove", (event) => {
      const rect = btn.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 8;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 6;
      btn.style.transform = `translate(${x}px, ${y}px)`;
    });
    btn.addEventListener("pointerleave", () => {
      btn.style.transform = "";
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function movePointerTo(el) {
  const rect = el.getBoundingClientRect();
  pointer.hidden = false;
  pointer.style.left = `${rect.left + rect.width / 2}px`;
  pointer.style.top = `${rect.top + rect.height / 2}px`;
}

async function clickThrough(el) {
  movePointerTo(el);
  await wait(320);
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.click();
  await wait(280);
}

async function walkthrough() {
  pointer.hidden = false;
  showLogin();
  caption("Continue with Canvas sends you to Canvas, then brings back your Canvas ID.");
  await wait(700);
  movePointerTo(submitBtn);
  await wait(500);
  caption("Dashboard, Calendar, and Settings live in the side rail.");
  showApp({ name: "Avery Gold", canvasId: "42", host: "canvas.example.edu" });
  await wait(500);
  await clickThrough(document.querySelector('[data-page="calendar"]'));
  await wait(450);
  await clickThrough(document.querySelector('[data-page="settings"]'));
  await wait(450);
  await clickThrough(document.querySelector('[data-page="dashboard"]'));
  caption("Notifications toggle on and off.");
  await clickThrough(notifyBtn);
  caption("The menu shows the Canvas ID. Sign out revokes the Canvas token.");
  await clickThrough(userChip);
  await wait(350);
  await clickThrough(userMenu.querySelector('[data-action="logout"]'));
  await wait(400);
  pointer.hidden = true;
  caption("");
  toast("Walkthrough complete.");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitBtn.classList.add("is-loading");
  submitBtn.disabled = true;
  loginCard.classList.add("is-busy");
  auth.start();
});

notifyBtn.addEventListener("click", () => {
  pageChosen = true;
  setPage("settings");
  settingsController.open("reminders");
  toast("Reminder controls are in Settings.");
});

userChip.addEventListener("click", () => {
  const open = userMenu.hidden;
  userMenu.hidden = !open;
  userChip.setAttribute("aria-expanded", String(open));
});

userMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.action;
  if (action === "logout") signOut();
});

segment.addEventListener("click", (event) => {
  const btn = event.target.closest(".segment-btn");
  if (!btn) return;
  pageChosen = true;
  setPage(btn.dataset.page);
});

calendarRoot.addEventListener("click", (event) => {
  const target = event.target.closest("[data-calendar]");
  if (!target) return;
  const action = target.dataset.calendar;
  if (action === "prev" || action === "next") {
    calendarMonth = shiftMonth(currentCalendar().monthKey, action === "prev" ? -1 : 1);
    calendarDay = "";
    paintCalendar();
  }
  if (action === "today") {
    calendarMonth = null;
    calendarDay = currentCalendar().today;
    paintCalendar();
  }
  if (action === "day" || action === "exam") {
    const date = target.dataset.date ?? "";
    if (!isDateKey(date)) return;
    calendarDay = date;
    if (action === "exam") calendarMonth = date.slice(0, 7);
    paintCalendar();
  }
});

dashboardBlocks.addEventListener("click", (event) => {
  const button = event.target.closest("[data-item-action]");
  const current = settingsController.getSettings();
  if (!button || !current) return;
  const id = button.dataset.id;
  if (button.dataset.itemAction === "complete") {
    void settingsController.patch({ work: { completedIds: toggleId(current.work.completedIds, id) } });
  }
  if (button.dataset.itemAction === "important") {
    void settingsController.patch({ work: { importantIds: toggleId(current.work.importantIds, id) } });
  }
  if (button.dataset.itemAction === "label") {
    void settingsController.patch({ work: { testLabels: toggleId(current.work.testLabels, id) } });
  }
});

document.addEventListener("click", (event) => {
  if (!userChip.contains(event.target) && !userMenu.contains(event.target)) {
    userMenu.hidden = true;
    userChip.setAttribute("aria-expanded", "false");
  }
});

attachDynamics();

const walkthroughMode = new URLSearchParams(location.search).has("walkthrough");

function deliverNotice(item, { browser = false } = {}) {
  toast(`${item.title}. ${item.body}`);
  const current = settingsController.getSettings();
  if (!browser || !current?.reminders.browserEnabled) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(item.title, { body: item.body });
  } catch {
    // The in-page notice still showed.
  }
}

const settingsController = createSettingsController({
  root: document.querySelector("#settings-root"),
  statusNode: settingsStatus,
  onSettings(next) {
    settings = next;
    if (state.user) repaint();
  },
  onConnection() {
    if (state.user) paintStatus();
  },
  onDashboard(data) {
    canvasData = data ?? blankCanvas;
    if (state.user) repaint();
  },
  onSignOut: signOut,
  onNotice(item) {
    deliverNotice(item, { browser: false });
  },
});

const reminders = createReminderRuntime({
  getState: () => ({
    user: state.user,
    settings: settingsController.getSettings(),
    canvas: canvasData,
    deviceZone: deviceZone(),
  }),
  notify: (item) => deliverNotice(item, { browser: true }),
  storage: localStorage,
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings.appearance.theme === "system") applyAppearance(settings);
});

async function boot() {
  const params = new URLSearchParams(location.search);
  const authError = params.get("auth_error");
  if (authError) {
    const message = auth.errorMessage(authError);
    if (message) {
      loginHint.textContent = message;
      toast(message);
    }
    params.delete("auth_error");
    const next = params.toString();
    history.replaceState(null, "", next ? `${location.pathname}?${next}` : location.pathname);
  }

  try {
    const config = await auth.describe();
    canvasHost.textContent = config.host ?? "Not configured";
    if (!config.configured && !loginHint.textContent) {
      loginHint.textContent = auth.errorMessage("not_configured");
    }
  } catch {
    canvasHost.textContent = "Not configured";
    if (!loginHint.textContent) loginHint.textContent = auth.errorMessage("not_configured");
  }

  if (walkthroughMode) {
    walkthrough();
    return;
  }

  try {
    const user = await auth.currentUser();
    if (user) showApp(user);
  } catch {
    showLogin();
  }
}

window.Canvi = { walkthrough, showApp, showLogin, setPage };

boot();
