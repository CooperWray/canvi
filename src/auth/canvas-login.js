const AUTH_ERRORS = {
  not_configured: "Canvas sign-in is not configured on this server yet.",
  access_denied: "Canvas did not grant access.",
  invalid_state: "This sign-in attempt expired. Try again.",
  invalid_scope: "The Canvas developer key rejected the requested scopes.",
  token_exchange_failed: "Canvas did not return a session. Check the developer key and redirect URI.",
  missing_canvas_id: "Canvas did not return a user id.",
  oauth_error: "Canvas could not complete sign-in.",
};

export function createCanvasLoginAdapter({ location = window.location, fetchImpl = fetch } = {}) {
  return {
    name: "canvas",

    async currentUser() {
      const response = await fetchImpl("/api/auth/session", { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      const body = await response.json();
      if (!body?.user?.canvasId) return null;
      return body.user;
    },

    async describe() {
      const response = await fetchImpl("/api/auth/canvas/config", { headers: { accept: "application/json" } });
      if (!response.ok) return { configured: false, host: null };
      const body = await response.json();
      return {
        configured: Boolean(body?.configured && body?.host),
        host: typeof body?.host === "string" ? body.host : null,
      };
    },

    start() {
      location.assign("/api/auth/canvas/start");
    },

    async logout() {
      await fetchImpl("/api/auth/canvas/logout", { method: "POST" });
    },

    errorMessage(code) {
      return AUTH_ERRORS[code] ?? null;
    },
  };
}
