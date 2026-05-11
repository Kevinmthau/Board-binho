import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built assets work when dropped into the Android
  // harness APK (loaded via file:// from Android assets) or served from any
  // subpath on a dev server.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
