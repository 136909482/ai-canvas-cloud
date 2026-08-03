import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@ai-canvas-cloud/contracts/http": path.resolve(
        __dirname,
        "../../packages/contracts/src/http.ts",
      ),
      "@ai-canvas-cloud/contracts/site-config": path.resolve(
        __dirname,
        "../../packages/contracts/src/siteConfig.ts",
      ),
      "@ai-canvas-cloud/contracts/canvas-preferences": path.resolve(
        __dirname,
        "../../packages/contracts/src/canvasPreferences.ts",
      ),
      "@ai-canvas-cloud/contracts": path.resolve(
        __dirname,
        "../../packages/contracts/src/index.ts",
      ),
      "@ai-canvas-cloud/project-graph": path.resolve(
        __dirname,
        "../../packages/project-graph/src/index.ts",
      ),
      "@ai-canvas-cloud/shared": path.resolve(
        __dirname,
        "../../packages/shared/src/index.ts",
      ),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "chrome120",
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "app-toolbar",
              test: (id) =>
                id.replace(/\\/g, "/").includes("/src/components/Toolbar.tsx"),
              priority: 20,
            },
            {
              name: "vendor-react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 10,
            },
            {
              name: "vendor-flow",
              test: /node_modules[\\/]@xyflow[\\/]/,
              priority: 10,
            },
            {
              name: "vendor-editor",
              test: /node_modules[\\/](?:@tiptap[\\/]|prosemirror-|orderedmap[\\/]|rope-sequence[\\/])/,
              priority: 10,
            },
            {
              name: "vendor-three",
              test: /node_modules[\\/]three[\\/]/,
              priority: 10,
            },
            {
              name: "vendor-panorama",
              test: /node_modules[\\/]@photo-sphere-viewer[\\/]/,
              priority: 10,
            },
            {
              name: "vendor-icons",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 10,
            },
            {
              name: "vendor-state",
              test: /node_modules[\\/]zustand[\\/]/,
              priority: 10,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 0,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
