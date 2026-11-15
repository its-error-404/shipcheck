import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** In dev (`npm run web:dev`) the API and Socket.io are proxied to the server on :4000. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/socket.io": { target: "http://127.0.0.1:4000", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
