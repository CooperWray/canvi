import { createCanvasLoginAdapter } from "./auth/canvas-login.js";

const auth = createCanvasLoginAdapter();

const state = {
  page: "dashboard",
  user: null,
};

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
const pageSettings = document.querySelector("#page-settings");
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

function showApp(user) {
  state.user = user;
  viewLogin.hidden = true;
  viewApp.hidden = false;
  userName.textContent = user.name;
  userAvatar.textContent = user.name.slice(0, 1).toUpperCase();
  menuCanvasId.textContent = `Canvas ID ${user.canvasId}`;
  dashboardStatus.textContent = `Signed in as ${user.name}. Canvas ID ${user.canvasId}.`;
  settingsStatus.textContent = `Account is Canvas ID ${user.canvasId} on ${user.host}.`;
  setPage(state.page);
}

function showLogin() {
  state.user = null;
  viewApp.hidden = true;
  viewLogin.hidden = false;
  userMenu.hidden = true;
  userChip.setAttribute("aria-expanded", "false");
  submitBtn.classList.remove("is-loading");
  submitBtn.disabled = false;
  loginCard.classList.remove("is-busy");
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
  caption("Dashboard and Settings live in the side rail.");
  showApp({ name: "Avery Gold", canvasId: "42", host: "canvas.example.edu" });
  await wait(500);
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
  const on = setPressed(notifyBtn);
  toast(on ? "Notifications armed." : "Notifications quiet.");
});

userChip.addEventListener("click", () => {
  const open = userMenu.hidden;
  userMenu.hidden = !open;
  userChip.setAttribute("aria-expanded", String(open));
});

userMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.action;
  if (action === "logout") {
    auth.logout().finally(() => {
      toast("Signed out.");
      showLogin();
    });
  }
});

segment.addEventListener("click", (event) => {
  const btn = event.target.closest(".segment-btn");
  if (btn) setPage(btn.dataset.page);
});

document.addEventListener("click", (event) => {
  if (!userChip.contains(event.target) && !userMenu.contains(event.target)) {
    userMenu.hidden = true;
    userChip.setAttribute("aria-expanded", "false");
  }
});

attachDynamics();

const walkthroughMode = new URLSearchParams(location.search).has("walkthrough");

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
