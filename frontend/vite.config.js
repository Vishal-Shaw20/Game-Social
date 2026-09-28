// frontend/vite.config.js
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        "/api": {
          target: env.VITE_API_URL,
          changeOrigin: true,
          secure: true
        },
        "/auth": {
          target: env.VITE_API_URL,
          changeOrigin: true,
          secure: true
        },
        // The shared socket (src/realtime/socket.js) connects to the page's
        // own origin, as in production where the ingress routes /socket.io to
        // the backend. Without this, in dev it hit Vite and never connected:
        // no live notifications, activity or game chat.
        "/socket.io": {
          target: env.VITE_API_URL,
          changeOrigin: true,
          ws: true
        }
      }
    }
  };
});
