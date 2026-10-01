import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { fs: { allow: ["../.."] } }, // fixtures/ is imported as sample pastes
  test: { environment: "node" },
} as any);
