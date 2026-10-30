import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "node:path";

// Built into ../public, which the Remuse Agent serves. `npm run dev` proxies /api to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "../public", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3200" } },
});
