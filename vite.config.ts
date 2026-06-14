import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  plugins: [
    webExtension({
      manifest: "./src/manifest.json",
    }),
  ],
  resolve: {
    alias: {
      "@shared": "/src/shared",
      "@adapters": "/src/adapters",
      "@background": "/src/background",
      "@content": "/src/content",
      "@pages": "/src/pages",
      "@popup": "/src/popup",
    },
  },
});
