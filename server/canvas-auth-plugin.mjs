import { loadEnv } from "vite";
import { createCanvasAuthMiddleware } from "./canvas-auth.mjs";

export function canvasAuthPlugin() {
  const attach = (server) => {
    const fromFile = loadEnv(server.config.mode, server.config.root, "");
    server.middlewares.use(createCanvasAuthMiddleware({ ...fromFile, ...process.env }));
  };

  return {
    name: "canvi-canvas-auth",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
