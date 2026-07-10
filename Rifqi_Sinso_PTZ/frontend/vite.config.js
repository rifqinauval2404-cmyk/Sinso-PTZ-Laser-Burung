import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-mode proxy: the backend runs on 3001 (see backend/.env.example), the Vite
// dev server proxies /api and /ws to it so the frontend can just use relative
// paths in both dev and production (where the backend serves the built dist/).
export default defineConfig({
  // Relative base so the build works whether served from "/" (local) or a reverse-proxy
  // sub-path like "/pkl/<project>/" (see PANDUAN_PKL.md) - the proxy strips its prefix
  // before the request reaches this app's Express server, so asset URLs must resolve
  // relative to wherever the page itself was loaded from, not an absolute "/".
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
