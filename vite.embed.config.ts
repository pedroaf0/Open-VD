/**
 * Build config for the WordPress plugin bundle (separate from the main app build).
 * Output: wordpress-plugin/v-dicom/assets/v-dicom.{js,css}
 *
 * O build é ofuscado (obfuscation) como proteção contra cópia/engenharia
 * reversa do código do bundle final.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const ofuscationEnabled = false; // true para ofuscar, false para debug

/**
 * Ofusca o bundle JS após o build, usando javascript-obfuscator.
 * O hook generateBundle substitui o código do chunk antes de ser gravado,
 * funcionando em builds sem HTML (entry iife única).
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
        format: "iife",
        entryFileNames: "v-dicom.js",
        assetFileNames: "v-dicom.[ext]",
        inlineDynamicImports: true,
      },
    },
  },
});
