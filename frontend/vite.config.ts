import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // the example gallery imports ../samples/*.cpp?raw from the repo root
      allow: [".."],
    },
  },
});
