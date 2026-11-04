import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths are required when web-pack loads the app from its bundle.
  base: "./",
  plugins: [
    {
      name: "matter-js-offline-notice",
      apply: "build",
      enforce: "pre",
      transform(source, id) {
        if (!id.endsWith("/matter-js/build/matter.js")) return;
        // Studio scans comments too. Keep the full MIT notice and omit its optional homepage.
        return source.replace(" * http://brm.io/matter-js/\n", "");
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
