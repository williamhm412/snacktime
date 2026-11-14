import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // forward /api/... calls to `wrangler pages dev` during development
      "/api": "http://localhost:8788",
    },
  },
});
