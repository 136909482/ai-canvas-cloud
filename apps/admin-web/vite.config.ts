import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(new URL("../web/public", import.meta.url)),
  server: {
    host: process.env.ADMIN_WEB_HOST ?? "127.0.0.1",
    port: Number(process.env.ADMIN_WEB_PORT ?? 5174),
    strictPort: true,
  },
});
