import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Optional: LIAOBAN_API_PROXY=https://<your-deployment>.vercel.app npm run dev
// sends /api to a deployed copy, so the UI can be worked on without `vercel dev`.
const apiProxy = process.env.LIAOBAN_API_PROXY;

export default defineConfig({
  plugins: [react()],
  server: apiProxy ? { proxy: { "/api": { target: apiProxy, changeOrigin: true } } } : {},
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
