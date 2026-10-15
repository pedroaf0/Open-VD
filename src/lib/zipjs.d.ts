/**
 * Types for the zip.js "custom core" build used by `src/lib/zip.ts`.
 *
 * The package exposes types only on its main entry (`@zip.js/zip.js`), but the
 * `./lib/zip-core-custom.js` subpath (worker/WASM-free, configurable codec) has
 * no accompanying `.d.ts`. Re-export the same types from the typed entry so the
 * subpath import type-checks correctly.
 */
declare module "@zip.js/zip.js/lib/zip-core-custom.js" {
  export type {
    Configuration,
    ZipReaderConstructorOptions,
    ZipReaderGetEntriesOptions,
  } from "@zip.js/zip.js";

  export { configure } from "@zip.js/zip.js";
  export { ZipReader } from "@zip.js/zip.js";
  export { Uint8ArrayReader } from "@zip.js/zip.js";
  export { Uint8ArrayWriter } from "@zip.js/zip.js";
}
