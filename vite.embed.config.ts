/**
 * Build config for the WordPress plugin bundle (separate from the main app build).
 * Output: wordpress-plugin/v-dicom/assets/v-dicom.{js,css} + chunks/*.js
 *
 * The entry is emitted as an ES module so Vite can split lazy imports (DICOM
 * codecs, Three.js/Volume3D, ZIP fallback) into on-demand chunks. The WordPress
 * page loads this entry with `type="module"` (see class-v-dicom-page.php).
 *
 * O build pode ser ofuscado (obfuscation) como proteção contra cópia/engenharia
 * reversa do código do bundle final.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const ofuscationEnabled = false; // true para ofuscar, false para debug

/**
 * Ofusca o bundle JS após o build, usando javascript-obfuscator.
 * O hook generateBundle substitui o código do entry antes de ser gravado.
 * Chunks lazy não são ofuscados (ficam legíveis para debug).
 */
function obfuscateBundle(): Plugin {
  if (!ofuscationEnabled) {
    return {
      name: "v-dicom-obfuscate",
      generateBundle(_options, bundle) {
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName !== "v-dicom.js") continue;
          if (chunk.type !== "chunk" || !("code" in chunk)) continue;
          this.info(`não ofuscado: ${fileName} (${chunk.code.length} bytes)`);
        }
      },
    };
  } else {
    return {
      name: "v-dicom-obfuscate",
      async generateBundle(_options, bundle) {
        const { default: JavaScriptObfuscator } = await import("javascript-obfuscator");

        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName !== "v-dicom.js") continue;
          if (chunk.type !== "chunk" || !("code" in chunk)) continue;

          const options: Parameters<typeof JavaScriptObfuscator.obfuscate>[1] = {
            compact: true,
            controlFlowFlattening: false,
            //  controlFlowFlatteningThreshold: 0.7,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.3,
            identifierNamesGenerator: "hexadecimal",
            numbersToExpressions: true,
            renameGlobals: false,
            selfDefending: true,
            simplify: true,
            splitStrings: true,
            splitStringsChunkLength: 8,
            stringArray: true,
            stringArrayEncoding: ["base64"],
            stringArrayThreshold: 0.8,
          };

          const obfuscated = JavaScriptObfuscator.obfuscate(
            chunk.code,
            options,
          ).getObfuscatedCode();
          chunk.code = obfuscated;
          this.info(`ofuscado: ${fileName} (${obfuscated.length} bytes)`);
        }
      },
    };
  }
}

export default defineConfig({
  // The entry is loaded from /wp-content/plugins/v-dicom/assets/v-dicom.js;
  // relative URLs keep lazy chunk requests inside the plugin directory.
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss(), tsconfigPaths(), obfuscateBundle()],
  build: {
    outDir: "wordpress-plugin/v-dicom/assets",
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    target: "es2020",
    rollupOptions: {
      input: "src/embed.tsx",
      output: {
        format: "es",
        entryFileNames: "v-dicom.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "v-dicom.[ext]",
      },
    },
  },
});
