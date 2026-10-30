import { loadEnv } from "vite";
import { createCanvasAuthMiddleware } from "./canvas-auth.mjs";
import { createCanvasDashboardMiddleware } from "./canvas-dashboard.mjs";

export function canvasAuthPlugin() {
  const attach = (server) => {
    const fromFile = loadEnv(server.config.mode, server.config.root, "");
    const env = { ...fromFile, ...process.env };
    server.middlewares.use(createCanvasAuthMiddleware(env));
    server.middlewares.use(createCanvasDashboardMiddleware(env));
  };

  return {
    name: "canvi-canvas-auth",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
