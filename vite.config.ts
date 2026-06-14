import { defineConfig, type Plugin } from "vite";
import webExtension from "vite-plugin-web-extension";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Copy vendored PDF.js assets to dist/ after bundle */
function copyPdfJsAssets(): Plugin {
  return {
    name: "copy-pdfjs-assets",
    closeBundle() {
      const srcDir = resolve(__dirname, "pdf-reader");
      const outDir = resolve(__dirname, "dist/pdf-reader");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      copyFileSync(resolve(srcDir, "pdf.min.js"), resolve(outDir, "pdf.min.js"));
      copyFileSync(
        resolve(srcDir, "pdf.worker.min.js"),
        resolve(outDir, "pdf.worker.min.js")
      );
    },
  };
}

export default defineConfig({
  plugins: [
    webExtension({
      manifest: "./src/manifest.json",
      additionalInputs: [
        "src/pages/pdf-viewer/index.html",
        "src/pages/epub-viewer/index.html",
      ],
    }),
    copyPdfJsAssets(),
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
