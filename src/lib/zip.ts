/**
 * Streaming ZIP parser, with a robust zip.js fallback.
 *
 * Reads the End of Central Directory record (EOCD) at the end of the file,
 * then walks each Central Directory entry and decompresses one file at a time.
 *
 * Decompression first tries the browser-native `DecompressionStream('deflate-raw')`
 * (very low memory: only one entry in RAM at a time). When that API is not
 * available — common on older mobile WebViews/iOS — or when an entry fails, we
 * fall back to the pure-JS `fflate` implementation, and as a last resort the
 * whole archive is re-expanded with `fflate.unzipSync`.
 *
 * Silent failures on mobile are actively detected with a CRC-32 check on every
 * extracted entry (the native/`fflate` decoders can yield garbage without
 * throwing). When corruption is detected — or nothing could be extracted — we
 * escalate to a separate, more powerful engine: [zip.js](
 * https://gildas-lormeau.github.io/zip.js/) running on the main thread (no web
 * workers, no WebAssembly) whose codec is fflate and whose `checkCrc32` flag
 * rejects damaged output. That catches broken decompressors on phones that
 * otherwise fail silently.
 *
 * Pattern borrowed from indicom.online, rewritten for clarity.
 */
import { inflateSync, unzipSync, Inflate } from "fflate";
import type { Unzipped } from "fflate";
import {
  configure,
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js/lib/zip-core-custom.js";
import i18n from "@/i18n";

const SIG_LFH = 0x04034b50;
const SIG_DD = 0x08074b50;
const SIG_CFH = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_EOCD_LOC = 0x07064b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

type ZipEntry = {
  name: string;
  method: number;
  crc32: number;
  compSize: number;
  uncompSize: number;
  localHeaderOffset: number;
  isDir: boolean;
  isZip64: boolean;
};

function readU16(view: DataView, off: number): number {
  return view.getUint16(off, true);
}
function readU32(view: DataView, off: number): number {
  return view.getUint32(off, true);
}
function readU64(view: DataView, off: number): number {
  const lo = view.getUint32(off, true);
  const hi = view.getUint32(off + 4, true);
  // ZIP64 sizes are capped at 2^53-1 in practice; safe for browser slicing.
  return hi * 0x100000000 + lo;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/**
 * CRC-32 (IEEE) of a byte buffer. Used to actively detect decompressors that
 * fail silently by returning wrong bytes without throwing.
 */
function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Find the EOCD signature by scanning backwards from the end of the buffer. */
function findEocd(buf: Uint8Array): number {
  const n = buf.length;
  const maxBack = Math.min(n, 0xffff + 22);
  // Walk the last `maxBack` bytes looking for the 4-byte signature.
  for (let i = n - 22; i >= n - maxBack; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

/** Parse the central directory listing into an array of entries. */
function parseCentralDirectory(buf: Uint8Array, eocdOff: number): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const totalEntries = readU16(view, eocdOff + 10);
  let cdOffset = readU32(view, eocdOff + 16);
  let cdSize = readU32(view, eocdOff + 12);

  // If ZIP64 markers are present, follow the Zip64 EOCD locator for the real
  // values — required for archives larger than 4 GB.
  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locatorOff = eocdOff - 20;
    if (locatorOff >= 0 && readU32(view, locatorOff) === SIG_ZIP64_EOCD_LOC) {
      const zip64EocdOff = Number(readU64(view, locatorOff + 8));
      if (readU32(view, zip64EocdOff) === SIG_ZIP64_EOCD) {
        cdOffset = Number(readU64(view, zip64EocdOff + 48));
        cdSize = Number(readU64(view, zip64EocdOff + 40));
      }
    }
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  for (let i = 0; i < totalEntries && p + 46 <= end; i++) {
    if (readU32(view, p) !== SIG_CFH) break;
    const method = readU16(view, p + 10);
    const crc32Val = readU32(view, p + 16);
    let compSize = readU32(view, p + 20);
    let uncompSize = readU32(view, p + 24);
    const nameLen = readU16(view, p + 28);
    const extraLen = readU16(view, p + 30);
    const commentLen = readU16(view, p + 32);
    let localHeaderOffset = readU32(view, p + 42);
    const isZip64 =
      compSize === 0xffffffff || uncompSize === 0xffffffff || localHeaderOffset === 0xffffffff;

    // Walk the extra fields to recover the ZIP64 values when needed.
    if (isZip64) {
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const tag = readU16(view, e);
        const size = readU16(view, e + 2);
        if (tag === 0x0001) {
          let q = e + 4;
          if (uncompSize === 0xffffffff) {
            uncompSize = Number(readU64(view, q));
            q += 8;
          }
          if (compSize === 0xffffffff) {
            compSize = Number(readU64(view, q));
            q += 8;
          }
          if (localHeaderOffset === 0xffffffff) {
            localHeaderOffset = Number(readU64(view, q));
            q += 8;
          }
          break;
        }
        e += 4 + size;
      }
    }

    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    let name = new TextDecoder("utf-8").decode(nameBytes);
    try {
      if (name.includes("\u0000")) name = name.split("\u0000")[0]!;
    } catch {
      // ignore: fall back to the raw decoded name
    }
    const isDir = name.endsWith("/");

    entries.push({
      name,
      method,
      crc32: crc32Val,
      compSize,
      uncompSize,
      localHeaderOffset,
      isDir,
      isZip64,
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * True on Safari (macOS + iOS). Safari's native `DecompressionStream('deflate-raw')`
 * is unreliable: on iOS it is known to occasionally return truncated/wrong data
 * or to hang without signaling completion, which would freeze the whole pipeline
 * (symptom: "iPhone Safari nunca descompacta"). We therefore bypass it and use
 * the pure-JS decoder there.
 */
function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|CriOS|Edg|Firefox|FxiOS/.test(ua);
}

/** How long we wait for the native stream before giving up and falling back. */
const NATIVE_INFLATE_TIMEOUT = 30000;

/** Whether the native DecompressionStream API is usable (missing/broken on some browsers). */
function supportsNativeInflate(): boolean {
  if (typeof DecompressionStream === "undefined") return false;
  // Safari's deflate-raw is buggy (truncation / hang) — use the JS decoder.
  return !isSafari();
}

/**
 * Decompress raw-deflate bytes using the browser-native API. Returns null when
 * the API is missing, the stream fails, or it does not finish within
 * `NATIVE_INFLATE_TIMEOUT` (protection against Safari hangs) — always signaling
 * the caller to fall back to the pure-JS decoder.
 */
async function nativeInflateRaw(compressed: Uint8Array): Promise<Uint8Array | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const stream = new Blob([compressed as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    // Safety net: if the platform never signals completion (Safari bug), bail
    // out and let the caller fall back to the JS decoder instead of hanging.
    const timeout = new Promise<"__timeout__">((resolve) => {
      timer = setTimeout(() => {
        try {
          reader?.cancel().catch(() => {});
        } catch {
          // ignored
        }
        resolve("__timeout__");
      }, NATIVE_INFLATE_TIMEOUT);
    });

    for (;;) {
      const settled = await Promise.race([reader.read(), timeout]);
      if (settled === "__timeout__") return null;
      const { value, done } = settled;
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Read a single entry's compressed payload from the local file header and
 * decompress it on the fly. Returns a fresh Uint8Array with the file bytes.
 *
 * Tries the streaming native API first; if that is unavailable or fails, falls
 * back to the pure-JS `fflate` decoder so mobile browsers without
 * `DecompressionStream` still work.
 *
 * The result is verified against the CRC-32 stored in the central directory.
 * Native/`fflate` decoders can fail silently (returning garbage without
 * throwing) on broken mobile WebViews; checking the CRC actively detects that
 * so the caller can escalate to the zip.js fallback instead of pushing a
 * corrupt DICOM file downstream.
 */
async function extractEntry(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lhOff = entry.localHeaderOffset;
  if (readU32(view, lhOff) !== SIG_LFH) {
    throw new Error(`Local file header inválido para ${entry.name}`);
  }
  const nameLen = readU16(view, lhOff + 26);
  const extraLen = readU16(view, lhOff + 28);
  const dataStart = lhOff + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compSize);

  let data: Uint8Array;
  let source: "store" | "native" | "fflate-js";
  if (entry.method === METHOD_STORE) {
    data = new Uint8Array(compressed);
    source = "store";
  } else if (entry.method !== METHOD_DEFLATE) {
    throw new Error(`Método de compressão não suportado (${entry.method}) em ${entry.name}`);
  } else {
    // 1) Streaming deflate-raw via the browser's native DecompressionStream —
    // peak memory equals the largest single file (one DICOM slice).
    if (supportsNativeInflate()) {
      const native = await nativeInflateRaw(compressed);
      if (native) {
        data = native;
        source = "native";
      } else {
        // 2) Fallback: pure-JS decoder (works everywhere, incl. WebViews).
        data = inflateSync(compressed);
        source = "fflate-js";
      }
    } else {
      data = inflateSync(compressed);
      source = "fflate-js";
    }
  }

  // Active silent-failure detection: verify the stored CRC-32. A 0 CRC means
  // the archive did not record one (skip the check to avoid false positives).
  if (entry.crc32 !== 0 && crc32(data) !== entry.crc32) {
    throw new Error(`CRC-32 inválido para ${entry.name} (descompressão silenciosa detectada)`);
  }
  // Also verify the decompressed size. Some mobile decoders (notably Safari)
  // return truncated output even when they do not signal an error or a CRC is
  // not recorded.
  if (entry.uncompSize > 0 && data.length !== entry.uncompSize) {
    throw new Error(
      `Tamanho inesperado para ${entry.name} (esperado ${entry.uncompSize}, obtido ${data.length})`,
    );
  }
  // Throttled per-entry log (studies can have hundreds/thousands of slices).
  entryLogCount++;
  if (entryLogCount <= 5 || entryLogCount % 25 === 0) {
    console.info(
      `[zip-debug] extraiu ${entry.name}: ${data.length} bytes (método ${entry.method}, via ${source}) [#${entryLogCount}]`,
    );
  }
  return data;
}

let entryLogCount = 0;

const isZip = (name: string) => /\.zip$/i.test(name);

/** Returns true if the buffer looks like a ZIP (PK\\x03\\x04 magic at byte 0). */
export function isZipBuffer(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  );
}

function isJunkEntry(name: string): boolean {
  if (!name) return true;
  if (name.startsWith(".") || name.includes("__MACOSX/") || name.includes("/__MACOSX/"))
    return true;
  return false;
}

/* -------------------------------------------------------------------------- *
 * zip.js fallback engine                                                     *
 * -------------------------------------------------------------------------- *
 * zip.js is a full-featured ZIP implementation that decodes the container
 * (central directory, ZIP64, encryption, deflate64, etc.) far more thoroughly
 * than the hand-rolled streaming parser above, and whose `checkCrc32` option
 * rejects damaged output instead of letting it fail silently.
 *
 * To keep it reliable on mobile we run it on the MAIN thread only:
 *   - `useWebWorkers: false` avoids worker/CSP issues in webviews;
 *   - `useCompressionStream: false` + a custom `DecompressionStreamFallback`
 *     avoids the WebAssembly module entirely (it would throw on phones where
 *     the WASM asset cannot load);
 *   - the fallback codec is fflate's pure-JS `Inflate` (already a dependency).
 *
 * `zip-core-custom.js` sets `workerURI`/`wasmURI` to `null`, so no worker or
 * WASM file is ever fetched by the bundler.
 */

let zipJsReady = false;

/** A `deflate-raw` decompression stream backed by fflate's pure-JS Inflate. */
class FflateInflateStream extends TransformStream {
  constructor() {
    let state: { inflate: Inflate } | null = null;
    super({
      start(controller) {
        const inflate = new Inflate((chunk) => {
          if (chunk.length) controller.enqueue(chunk);
        });
        state = { inflate };
      },
      transform(chunk: BufferSource) {
        state!.inflate.push(new Uint8Array(chunk as ArrayBufferLike), false);
      },
      flush() {
        state!.inflate.push(new Uint8Array(), true);
      },
    });
  }
}

function ensureZipJs(): void {
  if (zipJsReady) return;
  zipJsReady = true;
  try {
    configure({
      useWebWorkers: false,
      useCompressionStream: false,
      DecompressionStreamFallback: FflateInflateStream,
    });
    console.info(`[zip-debug] zip.js configurado (main thread, sem worker/wasm).`);
  } catch (e) {
    console.warn("[zip-debug] zip.js não pôde ser configurado:", e);
  }
}

/**
 * Expand a whole archive buffer with zip.js, pushing inner files (and any
 * nested ZIPs, expanded recursively) into `out`. Returns `true` if at least one
 * file was recovered, `false` if zip.js cannot read the archive at all.
 */
async function expandViaZipJs(
  buf: Uint8Array,
  out: File[],
  onProgress?: (p: ExpandProgress) => void,
  label = "ZIP",
  forceJs = false,
): Promise<boolean> {
  ensureZipJs();
  try {
    const reader = new ZipReader(new Uint8ArrayReader(buf), {
      checkCrc32: true,
    });
    const entries = await reader.getEntries();
    console.info(`[zip-debug] zip.js: ${entries.length} entrada(s) em ${label}`);
    let done = 0;
    let recovered = 0;
    for (const entry of entries) {
      onProgress?.({
        done: ++done,
        total: entries.length || 1,
        label: i18n.t("lib.zip.decompressingZipJs", { label }),
      });
      if (entry.directory) continue;
      const name = (entry.filename ?? "").split("/").pop() ?? "";
      if (!name || isJunkEntry(entry.filename)) continue;
      let data: Uint8Array;
      try {
        data = new Uint8Array(await entry.getData(new Uint8ArrayWriter()));
      } catch (e) {
        // A single bad entry must not sink the whole archive.
        console.warn(`[zip-debug] zip.js falhou ao extrair ${entry.filename}:`, e);
        continue;
      }
      if (!data.length) continue;
      recovered++;
      if (isZip(name) && isZipBuffer(data)) {
        await expandBuffer(data, out, onProgress, forceJs, name);
      } else {
        out.push(
          new File([data as unknown as BlobPart], name, { type: "application/octet-stream" }),
        );
      }
    }
    await reader.close();
    console.info(`[zip-debug] zip.js: recuperou ${recovered} arquivo(s) de ${label}.`);
    return recovered > 0;
  } catch (e) {
    console.warn(`[zip-debug] zip.js falhou ao ler ${label}:`, e);
    return false;
  }
}

export type ExpandProgress = {
  /** Files expanded so far across every zip processed in this call. */
  done: number;
  /** Best estimate of total files (may grow as inner zips reveal more entries). */
  total: number;
  /** Short label for the UI. */
  label: string;
};

/**
 * Entrada para a descompactação: um `File` normal (upload local) ou um arquivo
 * cujos bytes já estão em memória (`{ name, data }`). A 2ª forma é usada no
 * download de cenas do WordPress: criar um `File` de centenas de MB e rele-lo
 * via `arrayBuffer()` falha intermitentemente no iOS (NotReadableError /
 * NotFoundError) mesmo em Safari nativo — por isso entregamos os bytes direto,
 * sem voltar a materializar o blob gigante.
 */
export type ExpandInput = File | { name: string; data: Uint8Array };

function inputName(input: ExpandInput): string {
  return input instanceof File ? input.name : input.name;
}

function inputSize(input: ExpandInput): number {
  return input instanceof File ? input.size : input.data.length;
}

/** Obtém os bytes de um `ExpandInput` sem depender de `File.arrayBuffer()` quando já temos os bytes. */
async function inputBytes(input: ExpandInput): Promise<Uint8Array> {
  if (input instanceof File) return readFileAsArrayBuffer(input);
  return input.data;
}

/** Monta um `File` a partir de bytes já descompactados (sempre de um buffer próprio e estável). */
function toFile(data: Uint8Array, name: string): File {
  return new File([data as unknown as BlobPart], name, { type: "application/octet-stream" });
}

/**
 * Expand any `.zip` files in `files` into their inner contents. Non-zip files
 * are returned untouched. Nested zips (a zip inside a zip) are also expanded.
 *
 * Uses the fast streaming parser so peak memory stays small even for huge
 * DICOM studies — only one entry is decompressed at a time. Every extracted
 * entry is verified against its stored CRC-32 to detect silent failures; when
 * corruption is detected (or nothing can be extracted) the whole archive is
 * re-read with the much more robust zip.js engine.
 *
 * When `opts.forceJs` is true, we skip the streaming parser and go straight to
 * zip.js (falling back to `fflate.unzipSync` if even that fails) — that is the
 * most reliable retry path for broken mobile decompressors.
 */
export async function expandArchives(
  files: ExpandInput[],
  onProgress?: (p: ExpandProgress) => void,
  opts?: { forceJs?: boolean },
): Promise<File[]> {
  const out: File[] = [];
  console.info(
    `%c[zip-debug] expandArchives: ${files.length} arquivo(s), forceJs=${!!opts?.forceJs}, Safari=${isSafari()}, userAgent=${navigator.userAgent.slice(0, 120)}`,
    "color:#0af;font-weight:bold",
  );
  for (const f of files) {
    const bytes = await inputBytes(f);
    // Detecta ZIP pela extensão (.zip) OU pela assinatura de bytes (PK) — a URL
    // pode não terminar em `.zip`, mas o conteúdo pode ser um ZIP válido.
    const looksLikeZip = isZip(inputName(f)) || isZipBuffer(bytes);
    if (!looksLikeZip) {
      console.info(
        `[zip-debug] expandArchives: "${inputName(f)}" (${bytes.length} bytes) não é ZIP — repassando direto.`,
      );
      out.push(toFile(bytes, inputName(f)));
      continue;
    }
    console.info(
      `[zip-debug] expandArchives: descompactando ZIP "${inputName(f)}" (${bytes.length} bytes)`,
    );
    try {
      await expandBufferFromBytes(bytes, out, onProgress, !!opts?.forceJs, inputName(f));
    } catch (e) {
      console.warn(`[zip-debug] Falha ao processar ZIP ${inputName(f)}:`, e);
    }
  }
  console.info(`[zip-debug] expandArchives: retornou ${out.length} arquivo(s) expandido(s).`);
  return out;
}

/** Despeja entradas de um `unzipSync` (e recursa em zips aninhados) em `out`. */
async function pushUnzipped(
  byName: Unzipped,
  out: File[],
  onProgress?: (p: ExpandProgress) => void,
  forceJs = false,
): Promise<void> {
  const keys = Object.keys(byName);
  console.info(`[zip-debug] pushUnzipped (fflate.unzipSync): ${keys.length} entrada(s)`);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const dataBytes = byName[k];
    if (!dataBytes || dataBytes.length === 0 || isJunkEntry(k)) continue;
    const baseName = k.split("/").pop() ?? k;
    const data = new Uint8Array(dataBytes as unknown as ArrayBufferLike);
    onProgress?.({
      done: i + 1,
      total: keys.length || 1,
      label: i18n.t("lib.zip.decompressingZip"),
    });
    if (isZip(baseName) && isZipBuffer(data)) {
      await expandBuffer(data, out, onProgress, forceJs);
    } else {
      out.push(
        new File([data as unknown as BlobPart], baseName, {
          type: "application/octet-stream",
        }),
      );
    }
  }
}

/** Formata uma exceção de leitura de arquivo (DOMException/Error) de forma legível. */
function describeFileError(e: unknown): string {
  const err = e as { name?: string; code?: number; message?: string; stack?: string };
  return `name=${err?.name ?? "?"} code=${err?.code ?? "?"} message=${err?.message ?? "?"}`;
}

/**
 * Lê um Blob/File como Uint8Array tentando várias APIs, porque no Safari iOS a
 * `arrayBuffer()` moderna falha com NotReadableError/NotFoundError em blobs
 * grandes criados via `new File(parts)` (File "fantasma"). O `FileReader`, API
 * antiga e estável, costuma conseguir ler onde a moderna falha.
 */
function readFileAsArrayBuffer(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // Estratégia 1: API moderna.
    file
      .arrayBuffer()
      .then((ab) => resolve(new Uint8Array(ab)))
      .catch((err1) => {
        console.warn(
          `[zip-debug] readFileAsArrayBuffer: arrayBuffer() falhou (${describeFileError(err1)}); tentando blob.slice()`,
        );
        // Estratégia 2: blob.slice() para descartar qualquer estado interno ruim.
        const sliced = file.slice(0, file.size, "application/octet-stream");
        sliced
          .arrayBuffer()
          .then((ab) => resolve(new Uint8Array(ab)))
          .catch((err2) => {
            console.warn(
              `[zip-debug] readFileAsArrayBuffer: blob.slice().arrayBuffer() falhou (${describeFileError(err2)}); tentando FileReader`,
            );
            // Estratégia 3: FileReader (mais compatível com iOS).
            const fr = new FileReader();
            fr.onload = () => {
              if (fr.result instanceof ArrayBuffer) {
                resolve(new Uint8Array(fr.result));
              } else {
                reject(new Error(i18n.t("lib.zip.fileReaderNoArrayBuffer")));
              }
            };
            fr.onerror = () => reject(fr.error ?? new Error(i18n.t("lib.zip.fileReaderOnError")));
            fr.readAsArrayBuffer(file);
          });
      });
  });
}

/**
 * Aplica a descompactação sobre bytes já carregados em memória. Não recebe um
 * `File` porque, no iOS, criar um File grande e rele-lo via `arrayBuffer()`
 * falha (NotReadableError/NotFoundError). Os bytes vêm direto do download.
 */
async function expandBufferFromBytes(
  buf: Uint8Array,
  out: File[],
  onProgress?: (p: ExpandProgress) => void,
  forceJs = false,
  label = "ZIP",
): Promise<void> {
  console.info(
    `[zip-debug] expandBufferFromBytes "${label}": buffer=${buf.length} bytes, primeiros=${Array.from(buf.slice(0, 8)).join(",")}, forceJs=${forceJs}`,
  );
  if (!isZipBuffer(buf)) {
    console.warn(`[zip-debug] expandBufferFromBytes "${label}": sem assinatura ZIP — ignorado.`);
    return;
  }
  await expandBuffer(buf, out, onProgress, forceJs, label);
}

/**
 * Expand one archive buffer into `out`. This is the recursive core shared by
 * the top-level files and any nested ZIPs.
 */
async function expandBuffer(
  buf: Uint8Array,
  out: File[],
  onProgress?: (p: ExpandProgress) => void,
  forceJs = false,
  label = "ZIP",
): Promise<void> {
  if (!isZipBuffer(buf)) {
    console.warn(`[zip-debug] expandBuffer: "${label}" sem assinatura ZIP — ignorado.`);
    return;
  }

  // Forcing JS: skip the streaming parser and use the most robust engine first
  // (zip.js), falling back to `fflate.unzipSync` for whatever zip.js cannot do.
  if (forceJs) {
    const ok = await expandViaZipJs(buf, out, onProgress, label, forceJs);
    if (!ok) {
      try {
        await pushUnzipped(unzipSync(buf), out, onProgress, forceJs);
      } catch (e) {
        console.warn(`[zip-debug] ZIP não pôde ser descompactado (${label}):`, e);
      }
    }
    console.info(
      `[zip-debug] forceJs concluído para ${label}: out agora com ${out.length} arquivo(s).`,
    );
    return;
  }

  const eocdOff = findEocd(buf);
  if (eocdOff < 0) {
    // No readable EOCD — the streaming parser cannot walk the archive. Escalate
    // to zip.js (fflate.unzipSync as a last resort).
    console.warn(`[zip-debug] ZIP sem EOCD legível: ${label}; tentando zip.js`);
    const ok = await expandViaZipJs(buf, out, onProgress, label);
    if (!ok) {
      try {
        await pushUnzipped(unzipSync(buf), out, onProgress);
      } catch (e) {
        console.warn(`[zip-debug] ZIP não pôde ser descompactado (${label}):`, e);
      }
    }
    return;
  }

  const entries = parseCentralDirectory(buf, eocdOff).filter(
    (e) => !e.isDir && !isJunkEntry(e.name),
  );
  const total = entries.length;
  console.info(
    `[zip-debug] streaming: ${total} entrada(s) em ${label} -> [${entries.map((e) => e.name).join(", ")}]`,
  );

  // Collect into a local array so a silent corruption detected below lets us
  // *discard* the partial streaming output and replace it with zip.js's.
  const local: File[] = [];
  let done = 0;
  let extracted = 0;
  let corrupt = false;
  for (const entry of entries) {
    onProgress?.({ done, total: total || 1, label: i18n.t("lib.zip.decompressing", { label }) });

    let data: Uint8Array;
    try {
      data = await extractEntry(buf, entry);
    } catch (e) {
      // Includes CRC-32 mismatches that reveal a silently-failing decompressor.
      console.warn(`[zip-debug] Falha ao extrair ${entry.name}:`, e);
      corrupt = true;
      continue;
    }
    done++;
    if (!data.length) continue;

    const baseName = entry.name.split("/").pop() ?? entry.name;
    if (isZip(baseName) && isZipBuffer(data)) {
      // Recurse on the nested zip without ever materializing it as a File,
      // saving a copy of the bytes. The nested expansion handles its own
      // silent-failure fallback internally.
      await expandBuffer(data, local, onProgress, false, baseName);
      continue;
    }
    extracted++;
    local.push(new File([new Uint8Array(data)], baseName, { type: "application/octet-stream" }));
  }
  onProgress?.({ done, total: total || 1, label: i18n.t("lib.zip.decompressing", { label }) });

  // Active silent-failure detection: escalate whenever an entry failed (e.g.
  // CRC-32 mismatch = decompressor returned garbage without throwing) or when
  // nothing was extracted while the central directory promised files.
  if (total > 0 && (corrupt || extracted === 0)) {
    console.warn(
      `[zip-debug] streaming marcou ${label} como corrompido (extraiu ${extracted}/${total}, corrupt=${corrupt}); tentando zip.js`,
    );
    const fresh: File[] = [];
    const ok = await expandViaZipJs(buf, fresh, onProgress, label);
    if (ok) {
      out.push(...fresh);
      return;
    }
    console.warn(`[zip-debug] zip.js não recuperou ${label}; usando resultado parcial.`);
  } else {
    console.info(`[zip-debug] streaming extraiu ${extracted}/${total} de ${label} sem corrupção.`);
  }
  out.push(...local);
}
