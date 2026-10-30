import { collectDueReminders, reminderSentStorageKey } from "./model.js";

function readKeys(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function createReminderRuntime({ getState, notify, storage, intervalMs = 30000, now = () => new Date() }) {
  let timer = 0;

  function tick() {
    const state = getState();
    if (!state?.user?.canvasId || !state.settings) return [];
    let key;
    try {
      key = reminderSentStorageKey(state.user.canvasId);
    } catch {
      return [];
    }
    const sent = new Set(readKeys(storage, key));
    const due = collectDueReminders({
      settings: state.settings,
      canvas: state.canvas,
      now: now(),
      deviceZone: state.deviceZone,
      sent,
    });
    for (const item of due) {
      notify(item);
      sent.add(item.key);
    }
    if (due.length) storage.setItem(key, JSON.stringify([...sent].slice(-500)));
    return due;
  }

  return {
    start() {
      this.stop();
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = 0;
    },
    tick,
  };
}
