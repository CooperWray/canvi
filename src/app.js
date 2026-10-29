const state = {
  mode: "signin",
  page: "dashboard",
  user: null,
};

const viewLogin = document.querySelector("#view-login");
const viewApp = document.querySelector("#view-app");
const form = document.querySelector("#login-form");
const emailInput = document.querySelector("#email-input");
const passwordInput = document.querySelector("#password-input");
const nameField = document.querySelector("#name-field");
const nameInput = document.querySelector("#name-input");
const emailHint = document.querySelector("#email-hint");
const loginTitle = document.querySelector("#login-title");
const loginSubtitle = document.querySelector("#login-subtitle");
const submitBtn = document.querySelector("#submit-auth");
const toggleMode = document.querySelector("#toggle-mode");
const togglePassword = document.querySelector("#toggle-password");
const rememberMe = document.querySelector("#remember-me");
const continueGuest = document.querySelector("#continue-guest");
const forgotPassword = document.querySelector("#forgot-password");
const userChip = document.querySelector("#user-chip");
const userMenu = document.querySelector("#user-menu");
const userName = document.querySelector("#user-name");
const userAvatar = document.querySelector("#user-avatar");
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

function setAuthMode(mode) {
  state.mode = mode;
  const signup = mode === "signup";
  nameField.hidden = !signup;
  loginTitle.textContent = signup ? "Create your studio" : "Welcome back";
  loginSubtitle.textContent = signup
    ? "A local account shell. We will connect identity later."
    : "Sign in to continue. Auth wiring comes later — this surface already behaves.";
  submitBtn.querySelector(".btn-label").textContent = signup ? "Create account" : "Sign in";
  toggleMode.textContent = signup ? "I already have an account" : "Create an account";
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function submitAuth(event) {
  event.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const name = nameInput.value.trim();

  if (!validEmail(email)) {
    emailInput.closest(".field").classList.add("is-invalid");
    emailHint.textContent = "Enter a valid email to continue.";
    toast("Email needs a second look.");
    return;
  }

  emailInput.closest(".field").classList.remove("is-invalid");
  emailHint.textContent = "";

  if (password.length < 6) {
    toast("Password must be at least 6 characters.");
    return;
  }

  submitBtn.classList.add("is-loading");
  submitBtn.disabled = true;
  loginCard.classList.add("is-busy");
  await wait(900);

  const display = state.mode === "signup" && name ? name : email.split("@")[0];
  toast(state.mode === "signup" ? "Account shell created." : "Signed in.");
  showApp({ name: display, email, remember: rememberMe.getAttribute("aria-pressed") === "true" });
}

function attachDynamics() {
  document.querySelectorAll(".btn, .switch, .segment-btn, .user-chip, .menu button").forEach((btn) => {
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

async function typeInto(input, value) {
  movePointerTo(input);
  await wait(240);
  input.focus();
  input.value = "";
  for (const char of value) {
    input.value += char;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(45);
  }
}

async function walkthrough() {
  pointer.hidden = false;
  showLogin();
  setAuthMode("signin");
  caption("Login is a live shell — fields, toggles, and submit already respond.");
  await wait(700);
  caption("Typing into email and password.");
  await typeInto(emailInput, "studio@canvi.app");
  await typeInto(passwordInput, "goldleaf");
  caption("Show / hide password.");
  await clickThrough(togglePassword);
  await clickThrough(togglePassword);
  caption("Remember me is a pressable switch.");
  await clickThrough(rememberMe);
  caption("Forgot password toasts until auth is wired.");
  await clickThrough(forgotPassword);
  caption("Flip into create-account mode.");
  await clickThrough(toggleMode);
  await typeInto(nameInput, "Avery Gold");
  caption("Back to sign in.");
  await clickThrough(toggleMode);
  caption("Continue without an account.");
  await clickThrough(continueGuest);
  await wait(500);
  caption("Dashboard and Settings live in the side rail.");
  await clickThrough(document.querySelector('[data-page="settings"]'));
  await wait(450);
  await clickThrough(document.querySelector('[data-page="dashboard"]'));
  caption("Notifications toggle on and off.");
  await clickThrough(notifyBtn);
  caption("User menu: profile stub and sign out.");
  await clickThrough(userChip);
  await wait(350);
  await clickThrough(userMenu.querySelector('[data-action="profile"]'));
  await clickThrough(userChip);
  await wait(200);
  await clickThrough(userMenu.querySelector('[data-action="logout"]'));
  await wait(400);
  caption("Sign in with a loading gold button.");
  await typeInto(emailInput, "studio@canvi.app");
  await typeInto(passwordInput, "goldleaf");
  await clickThrough(submitBtn);
  await wait(1200);
  pointer.hidden = true;
  caption("");
  toast("Walkthrough complete.");
}

form.addEventListener("submit", submitAuth);

togglePassword.addEventListener("click", () => {
  const show = setPressed(togglePassword);
  passwordInput.type = show ? "text" : "password";
  togglePassword.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

rememberMe.addEventListener("click", () => {
  const on = setPressed(rememberMe);
  toast(on ? "We will remember this browser." : "This session stays temporary.");
});

toggleMode.addEventListener("click", () => {
  setAuthMode(state.mode === "signin" ? "signup" : "signin");
});

continueGuest.addEventListener("click", () => {
  toast("Continuing as guest.");
  showApp({ name: "Guest", email: "", remember: false });
});

forgotPassword.addEventListener("click", () => {
  toast("Password reset will connect here later.");
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
    toast("Signed out.");
    showLogin();
  }
  if (action === "profile") {
    toast("Profile comes later.");
    userMenu.hidden = true;
    userChip.setAttribute("aria-expanded", "false");
  }
});

segment.addEventListener("click", (event) => {
  const btn = event.target.closest(".segment-btn");
  if (btn) setPage(btn.dataset.page);
});

emailInput.addEventListener("input", () => {
  emailInput.closest(".field").classList.remove("is-invalid");
  emailHint.textContent = "";
});

document.addEventListener("click", (event) => {
  if (!userChip.contains(event.target) && !userMenu.contains(event.target)) {
    userMenu.hidden = true;
    userChip.setAttribute("aria-expanded", "false");
  }
});

attachDynamics();
setAuthMode("signin");

window.Canvi = { walkthrough, showApp, showLogin, setPage };

if (new URLSearchParams(location.search).has("walkthrough")) {
  walkthrough();
}
