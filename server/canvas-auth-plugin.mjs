import { join } from "node:path";
import { loadEnv } from "vite";
import { createCanvasAuthMiddleware } from "./canvas-auth.mjs";
import { createCanvasDashboardMiddleware } from "./canvas-dashboard.mjs";
import { createSettingsMiddleware } from "./settings.mjs";
import { createSettingsStore } from "./settings-store.mjs";

export function canvasAuthPlugin() {
  const attach = (server) => {
    const fromFile = loadEnv(server.config.mode, server.config.root, "");
    const env = { ...fromFile, ...process.env };
    const secret = env.SESSION_SECRET?.trim() ?? "";
    const store = secret
      ? createSettingsStore({ secret, filePath: join(server.config.root, "data", "settings.json") })
      : null;
    server.middlewares.use(createCanvasAuthMiddleware(env, { onSession: (session) => store?.markConnected(session) }));
    server.middlewares.use(createCanvasDashboardMiddleware(env, { store }));
    server.middlewares.use(createSettingsMiddleware(env, { store }));
  };

  return {
    name: "canvi-canvas-auth",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
