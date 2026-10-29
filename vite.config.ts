import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canvasAuthPlugin } from "./server/canvas-auth-plugin.mjs";

export default defineConfig({
  plugins: [react(), canvasAuthPlugin()],
});
