import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths are required when web-pack loads the app from its bundle.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
