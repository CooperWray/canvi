import {
  APPEARANCE_STORAGE_KEY,
  CLASS_COLORS,
  CLASS_ICONS,
  CONFIRM_DISCONNECT,
  CONFIRM_REMOVE_CANVAS,
  CONFIRM_RESET,
  LIMITS,
  REMINDER_TIMINGS,
  applyPatch,
  classRoster,
  commitChange,
  formatDue,
  isTimeZone,
  resolveTimeZone,
} from "./model.js";

const SECTIONS = [
  ["account", "Account"],
  ["canvas", "Canvas"],
  ["classes", "Classes"],
  ["work", "Assignments"],
  ["reminders", "Reminders"],
  ["appearance", "Appearance"],
  ["privacy", "Privacy"],
];

const DASHBOARD_LABELS = {
  classes: "Classes",
  assignments: "Assignments",
  tests: "Tests",
  reminders: "Reminders",
};

const COPY = {
  invalid_time_zone: "Choose a time zone from the list.",
  invalid_choice: "Canvi could not use that choice.",
  invalid_patch: "Canvi could not use those settings.",
  too_large: "That change is too large.",
  saved: "Saved",
  saving: "Canvi saves this change.",
  restored: "Canvi did not save this change and restored the last value.",
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function deviceZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

function zoneGroups() {
  const groups = new Map();
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  for (const zone of zones) {
    const [area] = zone.split("/");
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(zone);
  }
  return groups;
}

function newId(prefix) {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}${raw.replace(/-/g, "")}`;
}

function browserState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function createSettingsController({
  root,
  statusNode,
  onSettings,
  onConnection,
  onDashboard,
  onSignOut,
  onNotice,
  fetchImpl = fetch,
}) {
  let user = null;
  let settings = null;
  let connection = null;
  let catalog = [];
  let canvas = { classes: [], assignments: [], tests: [], reminders: [], catalog: [] };
  let section = "account";
  let mode = "loading";
  let loadMessage = "Canvi loads your settings.";
  let saveMessage = "";
  let queue = Promise.resolve();
  let locked = 0;

  function courses() {
    const source = catalog.length ? catalog : canvas.catalog?.length ? canvas.catalog : canvas.classes ?? [];
    return settings ? classRoster(source, settings) : [];
  }

  function setSave(text) {
    saveMessage = text;
    const node = root.querySelector("#settings-save");
    if (node) node.textContent = text;
  }

  function rememberAppearance(next) {
    try {
      localStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        JSON.stringify({ theme: next.appearance.theme, density: next.appearance.density }),
      );
    } catch {
      // Appearance still applies in this session.
    }
  }

  async function request(method, path, body) {
    const response = await fetchImpl(path, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || COPY.restored);
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function applyPayload(payload) {
    if (payload?.settings) {
      settings = payload.settings;
      onSettings?.(settings);
      rememberAppearance(settings);
    }
    if (payload?.catalog) catalog = payload.catalog;
    if (payload?.connection) {
      connection = payload.connection;
      onConnection?.(connection);
    }
    if (payload?.dashboard) onDashboard?.(payload.dashboard);
  }

  function render() {
    const focusId = document.activeElement?.id;
    statusNode.textContent = mode === "ready" ? connection?.message || "Choose a section." : loadMessage;
    root.replaceChildren(shell());
    if (saveMessage) setSave(saveMessage);
    if (focusId) root.querySelector(`#${CSS.escape(focusId)}`)?.focus();
  }

  function shell() {
    const layout = el("div", { class: "settings-layout" }, [
      el("div", { class: "settings-jump" }, [
        el("label", { class: "set-label", for: "settings-section", text: "Section" }),
        sectionSelect(),
      ]),
      el(
        "nav",
        { class: "settings-nav", "aria-label": "Settings" },
        SECTIONS.map(([id, label]) =>
          el("button", {
            type: "button",
            class: `settings-nav-btn${section === id ? " is-active" : ""}`,
            "data-action": "section",
            "data-section": id,
            "aria-current": section === id ? "true" : false,
            text: label,
          }),
        ),
      ),
      el("div", { class: "settings-panel", id: "settings-panel" }, [panel()]),
    ]);
    return layout;
  }

  function sectionSelect() {
    const select = el("select", { id: "settings-section" });
    for (const [id, label] of SECTIONS) {
      const option = el("option", { value: id, text: label });
      if (id === section) option.selected = true;
      select.append(option);
    }
    return select;
  }

  function panel() {
    if (mode === "loading") return el("p", { class: "help", text: loadMessage });
    if (mode !== "ready" || !settings) {
      return el("div", { class: "settings-card" }, [
        el("p", { text: loadMessage }),
        mode === "error" ? el("button", { type: "button", class: "btn btn-ghost", "data-action": "retry", text: "Try again" }) : null,
      ]);
    }
    const body = {
      account: accountPanel,
      canvas: canvasPanel,
      classes: classesPanel,
      work: workPanel,
      reminders: remindersPanel,
      appearance: appearancePanel,
      privacy: privacyPanel,
    }[section]();
    const heading = SECTIONS.find(([id]) => id === section)?.[1] ?? "Settings";
    return el("section", { "aria-labelledby": "settings-heading" }, [
      el("h2", { id: "settings-heading", tabindex: "-1", text: heading }),
      el("p", { id: "settings-save", class: "save-status", role: "status", text: saveMessage }),
      body,
    ]);
  }

  function help(text) {
    return el("p", { class: "help", text });
  }

  function toggleRow({ id, label, description, pressed, group, key, courseId = "" }) {
    return el("div", { class: "toggle-row" }, [
      el("div", {}, [el("p", { class: "set-label", id: `${id}-label`, text: label }), description ? help(description) : null]),
      el("button", {
        type: "button",
        class: "switch",
        id,
        "aria-pressed": String(pressed),
        "aria-labelledby": `${id}-label`,
        "data-action": "toggle",
        "data-group": group,
        "data-key": key,
        "data-id": courseId || false,
      }, [el("span", { class: "switch-track", "aria-hidden": "true" }, [el("span", { class: "switch-knob" })])]),
    ]);
  }

  function radios({ name, legend, value, options, action }) {
    return el("fieldset", { class: "choice-set" }, [
      el("legend", { text: legend }),
      ...options.map((option) =>
        el("label", { class: "choice" }, [
          el("input", {
            type: "radio",
            name,
            value: option.id,
            checked: option.id === value ? "checked" : false,
            "data-action": action,
            "data-name": name,
          }),
          option.label,
        ]),
      ),
    ]);
  }

  function saveRow() {
    return el("div", { class: "form-actions" }, [
      el("button", { type: "submit", class: "btn btn-gold", text: "Save" }),
      el("button", { type: "button", class: "btn btn-ghost", "data-action": "cancel", text: "Cancel" }),
    ]);
  }

  function accountPanel() {
    const zone = resolveTimeZone(settings, deviceZone());
    const select = el("select", { id: "account-zone", name: "timeZone" });
    for (const [area, zones] of zoneGroups()) {
      const group = el("optgroup", { label: area });
      for (const entry of zones) {
        const option = el("option", { value: entry, text: entry });
        if (entry === zone) option.selected = true;
        group.append(option);
      }
      select.append(group);
    }
    return el("form", { "data-form": "account", class: "settings-card" }, [
      el("label", { class: "set-field", for: "account-name" }, [
        el("span", { class: "set-label", text: "Display name" }),
        el("input", { id: "account-name", name: "displayName", autocomplete: "name", maxlength: "80", value: settings.account.displayName }),
      ]),
      help("This name is only in Canvi. It does not change Canvas."),
      el("div", { class: "set-field" }, [
        el("span", { class: "set-label", text: "Email" }),
        el("p", { class: "set-value", text: "Canvas does not share an email with Canvi." }),
      ]),
      help("You cannot edit an email here."),
      el("div", { class: "set-field" }, [
        el("span", { class: "set-label", text: "Profile photo" }),
        el("p", { class: "set-value", text: user?.name?.slice(0, 1).toUpperCase() || "C" }),
      ]),
      help("Canvi does not import a profile photo."),
      el("label", { class: "set-field", for: "account-zone" }, [el("span", { class: "set-label", text: "Time zone" }), select]),
      help(settings.account.timeZoneSet ? "Your time zone changes deadline times and reminder times." : "Canvi uses this device time zone until you save a time zone."),
      help("It does not change the real deadline."),
      el("label", { class: "set-field", for: "account-date" }, [
        el("span", { class: "set-label", text: "Date format" }),
        dateSelect(),
      ]),
      radios({
        name: "timeFormat",
        legend: "Time format",
        value: settings.account.timeFormat,
        action: "ignore",
        options: [
          { id: "12", label: "12-hour" },
          { id: "24", label: "24-hour" },
        ],
      }),
      saveRow(),
      el("button", { type: "button", class: "btn btn-ghost", "data-action": "sign-out", text: "Sign out" }),
      help("Sign out ends this session and revokes the Canvas token."),
    ]);
  }

  function dateSelect() {
    const select = el("select", { id: "account-date", name: "dateFormat" });
    for (const [id, label] of [
      ["ymd", "2026-11-02"],
      ["mdy", "Nov 2, 2026"],
      ["dmy", "2 Nov 2026"],
    ]) {
      const option = el("option", { value: id, text: label });
      if (id === settings.account.dateFormat) option.selected = true;
      select.append(option);
    }
    return select;
  }

  function canvasPanel() {
    const status = connection?.status || "disconnected";
    const last = connection?.lastSyncAt
      ? formatDue(connection.lastSyncAt, {
          timeZone: resolveTimeZone(settings, deviceZone()),
          dateFormat: settings.account.dateFormat,
          timeFormat: settings.account.timeFormat,
        }).label
      : "No successful sync yet";
    return el("div", { class: "stack" }, [
      el("div", { class: "settings-card" }, [
        el("dl", { class: "facts" }, [
          fact("Institution", connection?.host || user?.host || "Unknown"),
          fact("Canvas URL", connection?.url || "Unknown"),
          fact("Status", statusLabel(status)),
          fact("Last successful sync", last),
        ]),
        help(connection?.message || ""),
        help("Canvi syncs when you open the dashboard or when you choose Sync now."),
        help("Canvi does not sync in the background."),
        help("A failed sync keeps the last imported data."),
        el("div", { class: "form-actions" }, [
          el("button", {
            type: "button",
            class: "btn btn-gold",
            id: "sync-now",
            "data-action": "sync",
            disabled: status === "syncing" || status === "disconnected" ? "disabled" : false,
            text: "Sync now",
          }),
          el("button", { type: "button", class: "btn btn-ghost", "data-action": "reconnect", text: "Reconnect" }),
          el("button", {
            type: "button",
            class: "btn btn-danger",
            "data-action": "disconnect",
            disabled: status === "disconnected" ? "disabled" : false,
            text: "Disconnect",
          }),
        ]),
      ]),
      el("div", { class: "settings-card" }, [
        el("h3", { text: "What Canvi imports" }),
        help("Canvi imports course names, assignments, quizzes, calendar events, and planner notes."),
        help("Canvi does not import grades, files, or inbox messages."),
        help("Canvi marks a Canvas quiz as a test."),
        help("You can label another assignment as a test. Canvi does not detect every test."),
        help("Canvi imports at most 20 courses on a sync."),
        toggleRow({
          id: "include-concluded",
          label: "Concluded courses",
          description: "This choice applies on the next sync.",
          pressed: settings.canvas.includeConcluded,
          group: "canvas",
          key: "includeConcluded",
        }),
        courseForm(),
      ]),
    ]);
  }

  function fact(term, value) {
    return el("div", {}, [el("dt", { text: term }), el("dd", { text: value })]);
  }

  function statusLabel(status) {
    return { connected: "Connected", syncing: "Syncing", expired: "Expired", disconnected: "Disconnected", error: "Error" }[status] || "Disconnected";
  }

  function courseForm() {
    const roster = courses();
    if (!roster.length) return help("Canvi has no courses yet. Choose Sync now.");
    const selected = new Set(settings.canvas.courseIds ?? roster.map((course) => course.id));
    return el("form", { "data-form": "courses" }, [
      el("fieldset", { class: "choice-set" }, [
        el("legend", { text: "Courses to import" }),
        help("Save this list to choose the courses for the next sync."),
        ...roster.map((course) =>
          el("label", { class: "choice" }, [
            el("input", {
              type: "checkbox",
              name: "course",
              value: course.id,
              checked: selected.has(course.id) ? "checked" : false,
            }),
            `${course.displayTitle}${course.concluded ? " (Concluded)" : ""}`,
          ]),
        ),
      ]),
      saveRow(),
    ]);
  }

  function classesPanel() {
    const roster = courses();
    if (!roster.length) return el("div", { class: "settings-card" }, [help("Canvi has no courses yet. Choose Sync now.")]);
    return el("div", { class: "stack" }, [
      help("These choices stay in Canvi. They do not change the Canvas course."),
      help("A hidden class stays in Settings. Reminders stay on until you turn them off."),
      ...roster.map((course, index) => classCard(course, index, roster.length)),
    ]);
  }

  function classCard(course, index, total) {
    return el("article", { class: "settings-card stack" }, [
      el("h3", { text: course.title }),
      course.concluded ? el("p", { class: "badge", text: "Concluded" }) : null,
      course.prefs.hidden ? el("p", { class: "badge", text: "Hidden" }) : null,
      course.prefs.archived ? el("p", { class: "badge", text: "Archived" }) : null,
      el("form", { "data-form": "class", "data-course": course.id, class: "stack" }, [
        el("label", { class: "set-field", for: `class-name-${course.id}` }, [
          el("span", { class: "set-label", text: "Display name" }),
          el("input", { id: `class-name-${course.id}`, name: "displayName", maxlength: "80", value: course.prefs.displayName }),
        ]),
        el("fieldset", { class: "swatches" }, [
          el("legend", { text: "Color" }),
          ...CLASS_COLORS.map((color) =>
            el("label", { class: "swatch" }, [
              el("input", {
                type: "radio",
                name: `color-${course.id}`,
                value: color.id,
                checked: course.prefs.color === color.id ? "checked" : false,
              }),
              el("span", { class: "swatch-chip", style: `background:${color.value}` }),
              color.label,
            ]),
          ),
        ]),
        el("fieldset", { class: "choice-set" }, [
          el("legend", { text: "Icon" }),
          ...CLASS_ICONS.map((icon) =>
            el("label", { class: "choice" }, [
              el("input", {
                type: "radio",
                name: `icon-${course.id}`,
                value: icon.id,
                checked: course.prefs.icon === icon.id ? "checked" : false,
              }),
              icon.label,
            ]),
          ),
        ]),
        saveRow(),
      ]),
      el("div", { class: "form-actions" }, [
        el("button", {
          type: "button",
          class: "btn btn-ghost",
          "data-action": "move-class",
          "data-id": course.id,
          "data-direction": "-1",
          disabled: index === 0 ? "disabled" : false,
          "aria-label": `Move ${course.displayTitle} up`,
          text: "Move up",
        }),
        el("button", {
          type: "button",
          class: "btn btn-ghost",
          "data-action": "move-class",
          "data-id": course.id,
          "data-direction": "1",
          disabled: index === total - 1 ? "disabled" : false,
          "aria-label": `Move ${course.displayTitle} down`,
          text: "Move down",
        }),
      ]),
      toggleRow({
        id: `hide-${course.id}`,
        label: "Hide on the dashboard",
        description: "Reminders for this class stay on until you change them below.",
        pressed: course.prefs.hidden,
        group: "class",
        key: "hidden",
        courseId: course.id,
      }),
      toggleRow({
        id: `archive-${course.id}`,
        label: "Archive",
        description: "Archive hides this class on the dashboard. It does not change Canvas.",
        pressed: course.prefs.archived,
        group: "class",
        key: "archived",
        courseId: course.id,
      }),
      reminderSelect(course),
    ]);
  }

  function reminderSelect(course) {
    const select = el("select", {
      id: `remind-${course.id}`,
      "data-action": "class-reminders",
      "data-id": course.id,
    });
    for (const [id, label] of [
      ["inherit", "Default"],
      ["on", "On"],
      ["off", "Off"],
    ]) {
      const option = el("option", { value: id, text: label });
      if (course.prefs.reminders === id) option.selected = true;
      select.append(option);
    }
    return el("label", { class: "set-field", for: `remind-${course.id}` }, [
      el("span", { class: "set-label", text: "Reminders for this class" }),
      select,
    ]);
  }

  function workPanel() {
    return el("div", { class: "stack" }, [
      el("div", { class: "settings-card" }, [
        radios({
          name: "defaultView",
          legend: "Default view",
          value: settings.work.defaultView,
          action: "work",
          options: [
            { id: "upcoming", label: "Upcoming" },
            { id: "today", label: "Today" },
            { id: "week", label: "This week" },
            { id: "all", label: "All" },
          ],
        }),
        radios({
          name: "sort",
          legend: "Sort",
          value: settings.work.sort,
          action: "work",
          options: [
            { id: "due", label: "Due date" },
            { id: "class", label: "Class" },
            { id: "priority", label: "Priority" },
          ],
        }),
        help("Priority puts important items first. Mark an item important on the dashboard."),
        toggleRow({ id: "show-submitted", label: "Show submitted assignments", description: "Submitted means Canvas has a submission.", pressed: settings.work.showSubmitted, group: "work", key: "showSubmitted" }),
        toggleRow({ id: "show-completed", label: "Show completed personal tasks", description: "This shows items you mark complete in Canvi. It does not use the Canvas submission.", pressed: settings.work.showCompletedTasks, group: "work", key: "showCompletedTasks" }),
        toggleRow({ id: "show-overdue", label: "Show overdue items", pressed: settings.work.showOverdue, group: "work", key: "showOverdue" }),
        toggleRow({ id: "show-undated", label: "Show items with no due date", description: "These items appear in Upcoming and All.", pressed: settings.work.showUndated, group: "work", key: "showUndated" }),
        radios({
          name: "groupBy",
          legend: "Group items",
          value: settings.work.groupBy,
          action: "work",
          options: [
            { id: "date", label: "Date" },
            { id: "class", label: "Class" },
          ],
        }),
        radios({
          name: "weekStartsOn",
          legend: "Week starts",
          value: settings.work.weekStartsOn,
          action: "work",
          options: [
            { id: "sunday", label: "Sunday" },
            { id: "monday", label: "Monday" },
          ],
        }),
        help("Complete in Canvi is your mark. It does not submit work to Canvas."),
      ]),
      el("form", { class: "settings-card", "data-form": "manual-test" }, [
        el("h3", { text: "Add a test" }),
        help("You add this test in Canvi. Canvas did not identify it."),
        el("label", { class: "set-field", for: "manual-title" }, [
          el("span", { class: "set-label", text: "Title" }),
          el("input", { id: "manual-title", name: "title", maxlength: "140", required: "required" }),
        ]),
        coursePicker("manual-course"),
        el("label", { class: "set-field", for: "manual-due" }, [
          el("span", { class: "set-label", text: "Due" }),
          el("input", { id: "manual-due", name: "due", type: "datetime-local" }),
        ]),
        help("A date with no time uses 9:00 in your time zone."),
        el("button", { type: "submit", class: "btn btn-gold", text: "Add test" }),
        ...settings.manualTests.map((item) =>
          el("div", { class: "mini-row" }, [
            el("p", { text: item.title }),
            el("button", { type: "button", class: "btn btn-text", "data-action": "remove-manual", "data-id": item.id, text: "Remove" }),
          ]),
        ),
      ]),
      labeledList(),
    ]);
  }

  function coursePicker(id) {
    const select = el("select", { id, name: "courseId" }, [el("option", { value: "", text: "No class" })]);
    for (const course of courses()) {
      select.append(el("option", { value: course.id, text: course.displayTitle }));
    }
    return el("label", { class: "set-field", for: id }, [el("span", { class: "set-label", text: "Class" }), select]);
  }

  function labeledList() {
    const labels = new Set(settings.work.testLabels);
    const items = (canvas.assignments ?? []).filter((item) => labels.has(item.id));
    if (!items.length) return help("Use Label as a test on a dashboard assignment. Canvi keeps the Canvas item type.");
    return el("div", { class: "settings-card" }, [
      el("h3", { text: "Test labels" }),
      help("These Canvas assignments stay Canvas assignments. You labeled them as tests."),
      ...items.map((item) =>
        el("div", { class: "mini-row" }, [
          el("p", { text: item.title }),
          el("button", { type: "button", class: "btn btn-text", "data-action": "unlabel", "data-id": item.id, text: "Remove label" }),
        ]),
      ),
    ]);
  }

  function remindersPanel() {
    const permission = browserState();
    return el("div", { class: "stack" }, [
      el("div", { class: "settings-card" }, [
        toggleRow({ id: "remind-master", label: "Reminders", description: "The master switch stops every reminder.", pressed: settings.reminders.enabled, group: "reminders", key: "enabled" }),
        toggleRow({ id: "remind-assignments", label: "Assignments", pressed: settings.reminders.assignments, group: "reminders", key: "assignments" }),
        toggleRow({ id: "remind-tests", label: "Tests", pressed: settings.reminders.tests, group: "reminders", key: "tests" }),
        toggleRow({ id: "remind-personal", label: "Personal reminders", pressed: settings.reminders.personal, group: "reminders", key: "personal" }),
        help("A class set to On sends reminders when the master switch is on."),
        help("Off stops that class. Default follows the switches above."),
        ...courses().map((course) => reminderSelect(course)),
      ]),
      el("form", { class: "settings-card", "data-form": "timings" }, [
        el("fieldset", { class: "choice-set" }, [
          el("legend", { text: "Default reminder times" }),
          ...REMINDER_TIMINGS.map((timing) =>
            el("label", { class: "choice" }, [
              el("input", {
                type: "checkbox",
                name: "timing",
                value: timing.id,
                checked: settings.reminders.timings.includes(timing.id) ? "checked" : false,
              }),
              timing.label,
            ]),
          ),
        ]),
        saveRow(),
      ]),
      el("div", { class: "settings-card" }, [
        toggleRow({ id: "digest-enabled", label: "Daily digest", description: "Canvi shows the digest while this tab is open.", pressed: settings.reminders.digestEnabled, group: "reminders", key: "digestEnabled" }),
      ]),
      el("form", { class: "settings-card", "data-form": "quiet" }, [
        el("label", { class: "set-field", for: "digest-time" }, [
          el("span", { class: "set-label", text: "Digest time" }),
          el("input", { id: "digest-time", name: "digestTime", type: "time", value: settings.reminders.digestTime }),
        ]),
        el("label", { class: "set-field", for: "quiet-start" }, [
          el("span", { class: "set-label", text: "Quiet hours start" }),
          el("input", { id: "quiet-start", name: "quietStart", type: "time", value: settings.reminders.quietStart }),
        ]),
        el("label", { class: "set-field", for: "quiet-end" }, [
          el("span", { class: "set-label", text: "Quiet hours end" }),
          el("input", { id: "quiet-end", name: "quietEnd", type: "time", value: settings.reminders.quietEnd }),
        ]),
        help("During quiet hours, Canvi holds reminders."),
        help("Canvi does not send a reminder late if the time window has passed."),
        help("A quiet range can cross midnight."),
        help("Leave both times empty to turn quiet hours off."),
        saveRow(),
      ]),
      el("div", { class: "settings-card" }, [
        el("h3", { text: "Delivery" }),
        help("Canvi checks reminders while this tab is open."),
        help("Canvi has no background scheduler."),
        help("Canvi cannot send email. No mail service is connected."),
        permissionNote(permission),
        permission === "default"
          ? el("button", { type: "button", class: "btn btn-ghost", "data-action": "allow-browser", text: "Allow browser notifications" })
          : null,
        el("button", { type: "button", class: "btn btn-ghost", "data-action": "test-notice", text: "Send a test reminder" }),
        help("This test ignores quiet hours."),
      ]),
      el("form", { class: "settings-card", "data-form": "personal" }, [
        el("h3", { text: "Personal reminder" }),
        el("label", { class: "set-field", for: "personal-title" }, [
          el("span", { class: "set-label", text: "Title" }),
          el("input", { id: "personal-title", name: "title", maxlength: "140" }),
        ]),
        coursePicker("personal-course"),
        el("label", { class: "set-field", for: "personal-due" }, [
          el("span", { class: "set-label", text: "Due" }),
          el("input", { id: "personal-due", name: "due", type: "datetime-local" }),
        ]),
        el("button", { type: "submit", class: "btn btn-gold", text: "Add reminder" }),
        ...settings.personalReminders.map((item) =>
          el("div", { class: "mini-row" }, [
            el("p", { text: item.title }),
            el("button", { type: "button", class: "btn btn-text", "data-action": "remove-personal", "data-id": item.id, text: "Remove" }),
          ]),
        ),
      ]),
    ]);
  }

  function permissionNote(permission) {
    if (permission === "unsupported") return help("This browser does not support notifications. Canvi can still show reminders in this tab.");
    if (permission === "denied") return help("The browser blocked notifications. Allow them for this site in the browser settings.");
    if (permission === "granted" && settings.reminders.browserEnabled) return help("Browser notifications are on while this tab is open.");
    return help("Browser notifications stay off until you allow them.");
  }

  function appearancePanel() {
    const order = settings.appearance.sectionOrder;
    return el("div", { class: "settings-card stack" }, [
      radios({
        name: "theme",
        legend: "Theme",
        value: settings.appearance.theme,
        action: "appearance",
        options: [
          { id: "light", label: "Light" },
          { id: "dark", label: "Dark" },
          { id: "night", label: "Night" },
          { id: "system", label: "System" },
        ],
      }),
      help("Night uses a black page and white accents."),
      radios({
        name: "density",
        legend: "Layout density",
        value: settings.appearance.density,
        action: "appearance",
        options: [
          { id: "comfortable", label: "Comfortable" },
          { id: "compact", label: "Compact" },
        ],
      }),
      radios({
        name: "landing",
        legend: "Default landing page",
        value: settings.appearance.landing,
        action: "appearance",
        options: [
          { id: "dashboard", label: "Dashboard" },
          { id: "settings", label: "Settings" },
        ],
      }),
      toggleRow({ id: "section-classes", label: "Classes section", pressed: settings.appearance.sections.classes, group: "section", key: "classes" }),
      toggleRow({ id: "section-assignments", label: "Assignments section", pressed: settings.appearance.sections.assignments, group: "section", key: "assignments" }),
      toggleRow({ id: "section-tests", label: "Tests section", pressed: settings.appearance.sections.tests, group: "section", key: "tests" }),
      toggleRow({ id: "section-reminders", label: "Reminders section", pressed: settings.appearance.sections.reminders, group: "section", key: "reminders" }),
      el("div", {}, [
        el("p", { class: "set-label", text: "Section order" }),
        ...order.map((id, index) =>
          el("div", { class: "mini-row" }, [
            el("p", { text: DASHBOARD_LABELS[id] || id }),
            el("button", {
              type: "button",
              class: "btn btn-ghost",
              "data-action": "move-section",
              "data-id": id,
              "data-direction": "-1",
              disabled: index === 0 ? "disabled" : false,
              "aria-label": `Move ${DASHBOARD_LABELS[id] || id} up`,
              text: "Move up",
            }),
            el("button", {
              type: "button",
              class: "btn btn-ghost",
              "data-action": "move-section",
              "data-id": id,
              "data-direction": "1",
              disabled: index === order.length - 1 ? "disabled" : false,
              "aria-label": `Move ${DASHBOARD_LABELS[id] || id} down`,
              text: "Move down",
            }),
          ]),
        ),
      ]),
      help("Canvi follows the reduced motion setting on this device."),
    ]);
  }

  function privacyPanel() {
    return el("div", { class: "settings-card stack" }, [
      help("Canvi stores your display name, time zone, and other preferences for this Canvas ID."),
      help("Canvi stores imported course names, assignments, quizzes, calendar events, and planner notes."),
      help("Canvi stores personal reminders and tests that you add."),
      help("Canvi does not put your Canvas access token in this page or in the export."),
      el("button", { type: "button", class: "btn btn-ghost", "data-action": "export", text: "Export data" }),
      el("button", { type: "button", class: "btn btn-ghost", "data-action": "reset", text: "Reset preferences" }),
      el("button", { type: "button", class: "btn btn-danger", "data-action": "remove-data", text: "Remove imported Canvas data" }),
      el("h3", { text: "Delete account" }),
      help("Canvi cannot delete your Canvas account."),
      help("A full account deletion flow is not available."),
      help("You can sign out, disconnect Canvas, and remove imported data."),
    ]);
  }

  async function patch(partial) {
    const run = queue.then(() => patchNow(partial));
    queue = run.then(() => {}, () => {});
    return run;
  }

  async function patchNow(partial) {
    if (!settings) return { ok: false };
    let optimistic;
    try {
      optimistic = applyPatch(settings, partial);
    } catch (error) {
      setSave(COPY[error.code] || COPY.invalid_patch);
      return { ok: false };
    }
    const previous = settings;
    locked += 1;
    settings = optimistic;
    onSettings?.(settings);
    setSave(COPY.saving);
    const result = await commitChange({
      current: previous,
      save: async () => (await request("PUT", "/api/settings", partial)).settings,
    });
    settings = result.settings;
    if (result.ok && partial.appearance) rememberAppearance(settings);
    onSettings?.(settings);
    locked -= 1;
    setSave(result.ok ? COPY.saved : result.error?.message || COPY.restored);
    render();
    return result;
  }

  function formValue(form, name) {
    return new FormData(form).get(name)?.toString() ?? "";
  }

  function localDue(value) {
    if (!value) return "";
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : "";
  }

  async function onSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const kind = form.dataset.form;
    if (kind === "account") {
      await patch({
        account: {
          displayName: formValue(form, "displayName"),
          timeZone: formValue(form, "timeZone"),
          dateFormat: formValue(form, "dateFormat"),
          timeFormat: form.querySelector("input[name=timeFormat]:checked")?.value || "12",
        },
      });
    }
    if (kind === "courses") {
      const ids = [...form.querySelectorAll("input[name=course]:checked")].map((input) => input.value);
      const all = [...form.querySelectorAll("input[name=course]")].map((input) => input.value);
      await patch({ canvas: { courseIds: ids.length === all.length ? null : ids } });
    }
    if (kind === "class") {
      const id = form.dataset.course;
      await patch({
        classes: {
          [id]: {
            displayName: formValue(form, "displayName"),
            color: form.querySelector(`input[name="color-${id}"]:checked`)?.value || "gold",
            icon: form.querySelector(`input[name="icon-${id}"]:checked`)?.value || "",
          },
        },
      });
    }
    if (kind === "timings") {
      const timings = [...form.querySelectorAll("input[name=timing]:checked")].map((input) => input.value);
      if (!timings.length) {
        setSave("Choose at least one reminder time.");
        return;
      }
      await patch({ reminders: { timings } });
    }
    if (kind === "quiet") {
      const quietStart = formValue(form, "quietStart");
      const quietEnd = formValue(form, "quietEnd");
      if ((quietStart && !quietEnd) || (!quietStart && quietEnd) || (quietStart && quietStart === quietEnd)) {
        setSave("Enter both quiet hours, or leave both empty.");
        return;
      }
      await patch({
        reminders: {
          digestTime: formValue(form, "digestTime") || "08:00",
          quietStart,
          quietEnd,
        },
      });
    }
    if (kind === "manual-test" || kind === "personal") {
      const title = formValue(form, "title");
      if (!title.trim()) {
        setSave("Enter a title.");
        return;
      }
      const item = {
        id: newId(kind === "personal" ? "p" : "t"),
        title,
        courseId: formValue(form, "courseId"),
        dueAt: localDue(formValue(form, "due")),
      };
      const key = kind === "personal" ? "personalReminders" : "manualTests";
      await patch({ [key]: [...settings[key], item] });
    }
  }

  function toggleId(button) {
    return button.dataset.id || button.closest("form")?.dataset.course || "";
  }

  async function onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === "section") {
      section = button.dataset.section;
      saveMessage = "";
      render();
      root.querySelector("#settings-heading")?.focus();
      return;
    }
    if (action === "cancel") {
      saveMessage = "";
      render();
      return;
    }
    if (action === "retry") {
      await load();
      return;
    }
    if (action === "sign-out") {
      onSignOut?.();
      return;
    }
    if (action === "sync") return syncNow();
    if (action === "reconnect") {
      window.location.assign("/api/auth/canvas/start");
      return;
    }
    if (action === "disconnect") return confirmDisconnect();
    if (action === "export") return exportData();
    if (action === "reset") return confirmReset();
    if (action === "remove-data") return confirmRemove();
    if (action === "allow-browser") return allowBrowser();
    if (action === "test-notice") return testNotice();
    if (action === "toggle") return onToggle(button);
    if (action === "move-class") return moveClasses(button.dataset.id, Number(button.dataset.direction));
    if (action === "move-section") return moveSections(button.dataset.id, Number(button.dataset.direction));
    if (action === "remove-manual") return removeItem("manualTests", button.dataset.id);
    if (action === "remove-personal") return removeItem("personalReminders", button.dataset.id);
    if (action === "unlabel") {
      await patch({ work: { testLabels: settings.work.testLabels.filter((id) => id !== button.dataset.id) } });
    }
  }

  async function onToggle(button) {
    const next = button.getAttribute("aria-pressed") !== "true";
    const group = button.dataset.group;
    const key = button.dataset.key;
    if (group === "class") {
      const id = toggleId(button);
      await patch({ classes: { [id]: { [key]: next } } });
      return;
    }
    if (group === "section") {
      await patch({ appearance: { sections: { [key]: next } } });
      return;
    }
    await patch({ [group]: { [key]: next } });
  }

  async function moveClasses(id, direction) {
    const ids = courses().map((course) => course.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const [item] = ids.splice(index, 1);
    ids.splice(target, 0, item);
    await patch({ classOrder: ids });
  }

  async function moveSections(id, direction) {
    const ids = settings.appearance.sectionOrder.slice();
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const [item] = ids.splice(index, 1);
    ids.splice(target, 0, item);
    await patch({ appearance: { sectionOrder: ids } });
  }

  async function removeItem(key, id) {
    const ok = await confirmDialog({
      title: "Remove this item",
      lines: ["This removes the item from Canvi."],
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await patch({
      [key]: settings[key].filter((item) => item.id !== id),
      work: { completedIds: settings.work.completedIds.filter((entry) => entry !== id) },
    });
  }

  function onChange(event) {
    const input = event.target;
    if (input.id === "settings-section") {
      section = input.value;
      saveMessage = "";
      render();
      return;
    }
    if (input.dataset.action === "work") {
      void patch({ work: { [input.dataset.name]: input.value } });
    }
    if (input.dataset.action === "appearance") {
      void patch({ appearance: { [input.dataset.name]: input.value } });
    }
    if (input.dataset.action === "class-reminders") {
      void patch({ classes: { [input.dataset.id]: { reminders: input.value } } });
    }
  }

  async function syncNow() {
    if (!connection) connection = { status: "syncing", message: "Canvi syncs with Canvas now." };
    else connection = { ...connection, status: "syncing", message: "Canvi syncs with Canvas now." };
    onConnection?.(connection);
    render();
    try {
      const payload = await request("POST", "/api/canvas/sync");
      applyPayload(payload);
      setSave(payload.connection?.status === "error" ? payload.connection.message : COPY.saved);
    } catch (error) {
      if (error.payload?.settings) applyPayload(error.payload);
      setSave(error.payload?.connection?.message || error.message);
    }
    render();
  }

  async function confirmDisconnect() {
    const ok = await confirmDialog({
      title: "Disconnect Canvas",
      lines: ["This stops future Canvas sync and revokes the Canvas token.", "Imported data stays until you remove it."],
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    try {
      const payload = await request("POST", "/api/canvas/disconnect", { confirm: CONFIRM_DISCONNECT });
      applyPayload(payload);
      setSave(COPY.saved);
    } catch (error) {
      setSave(error.message);
    }
    render();
  }

  async function confirmReset() {
    const ok = await confirmDialog({
      title: "Reset preferences",
      lines: [
        "This restores display and notification choices to their defaults.",
        "This keeps personal reminders, tests you added, and imported Canvas data.",
      ],
      confirmLabel: "Reset preferences",
    });
    if (!ok) return;
    try {
      const payload = await request("POST", "/api/settings/reset", { confirm: CONFIRM_RESET });
      applyPayload(payload);
      setSave(COPY.saved);
    } catch (error) {
      setSave(error.message);
    }
    render();
  }

  async function confirmRemove() {
    const ok = await confirmDialog({
      title: "Remove imported Canvas data",
      lines: [
        "This removes imported courses, assignments, quizzes, calendar events, and planner notes.",
        "This keeps your settings, personal reminders, and tests you added.",
      ],
      confirmLabel: "Remove imported data",
    });
    if (!ok) return;
    try {
      const payload = await request("POST", "/api/canvas/data/remove", { confirm: CONFIRM_REMOVE_CANVAS });
      applyPayload(payload);
      onDashboard?.({ classes: [], assignments: [], tests: [], reminders: [], catalog: [] });
      setSave(COPY.saved);
    } catch (error) {
      setSave(error.message);
    }
    render();
  }

  async function exportData() {
    try {
      const payload = await request("POST", "/api/settings/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = el("a", { href: url, download: "canvi-settings.json" });
      root.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSave("Canvi prepared your export.");
    } catch (error) {
      setSave(error.message);
    }
  }

  async function allowBrowser() {
    if (typeof Notification === "undefined") {
      setSave("This browser does not support notifications.");
      render();
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await patch({ reminders: { browserEnabled: true } });
      return;
    }
    await patch({ reminders: { browserEnabled: false } });
    setSave("The browser blocked notifications. Allow them for this site in the browser settings.");
    render();
  }

  function testNotice() {
    onNotice?.({ title: "Canvi test", body: "This is a test reminder. It does not submit work." });
    if (typeof Notification === "undefined") {
      setSave("Canvi showed the test in this page. This browser does not support notifications.");
      return;
    }
    if (Notification.permission !== "granted" || !settings?.reminders.browserEnabled) {
      setSave("Canvi showed the test in this page. Allow browser notifications to test that channel.");
      return;
    }
    try {
      new Notification("Canvi test", { body: "This is a test reminder. It does not submit work." });
      setSave("Canvi sent the test in this page and in the browser.");
    } catch {
      setSave("Canvi showed the test in this page. The browser did not show a notification.");
    }
  }

  function confirmDialog({ title, lines, confirmLabel }) {
    return new Promise((resolve) => {
      const confirm = el("button", { type: "button", class: "btn btn-danger", disabled: "disabled", text: confirmLabel });
      const cancel = el("button", { type: "button", class: "btn btn-ghost", text: "Cancel" });
      const check = el("input", { type: "checkbox", id: "confirm-understand" });
      const dialog = el("dialog", { class: "confirm-dialog" }, [
        el("h3", { text: title }),
        ...lines.map((line) => help(line)),
        el("label", { class: "choice", for: "confirm-understand" }, [check, "I understand what this removes or changes."]),
        el("div", { class: "form-actions" }, [cancel, confirm]),
      ]);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        dialog.close();
        dialog.remove();
        resolve(value);
      };
      check.addEventListener("change", () => {
        confirm.disabled = !check.checked;
      });
      confirm.addEventListener("click", () => finish(check.checked));
      cancel.addEventListener("click", () => finish(false));
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      root.append(dialog);
      dialog.showModal();
    });
  }

  async function load({ quiet = false } = {}) {
    if (!user) return;
    if (!quiet) {
      mode = "loading";
      loadMessage = "Canvi loads your settings.";
      render();
    }
    try {
      const payload = await request("GET", "/api/settings");
      mode = "ready";
      applyPayload(payload);
    } catch (error) {
      if (quiet && settings) {
        setSave(error.message || "Canvi could not reload settings.");
        return;
      }
      mode = error.status === 503 ? "unavailable" : "error";
      loadMessage = error.message || "Canvi could not load settings.";
      settings = null;
    }
    render();
  }

  root.addEventListener("submit", (event) => {
    if (event.target?.dataset?.form) void onSubmit(event);
  });
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-action]")) void onClick(event);
  });
  root.addEventListener("change", (event) => onChange(event));

  return {
    start(nextUser) {
      user = nextUser;
      return load();
    },
    reload() {
      return load({ quiet: true });
    },
    stop() {
      user = null;
      settings = null;
      connection = null;
    },
    open(next) {
      section = next;
      if (mode !== "loading") render();
    },
    getSettings() {
      return settings;
    },
    getConnection() {
      return connection;
    },
    patch,
    setCanvas(data) {
      canvas = data ?? canvas;
      if (data?.catalog?.length && !catalog.length) catalog = data.catalog;
      if (locked) return;
      if (["classes", "canvas", "work", "reminders"].includes(section) && mode === "ready") render();
    },
    limits: LIMITS,
  };
}
