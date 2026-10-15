import dicomParser, { type DataSet, type Element } from "dicom-parser";
import * as jpegJsModule from "jpeg-js";
import { Decoder as JPEGLosslessDecoder } from "jpeg-lossless-decoder-js";
import i18n from "@/i18n";

const jpegjs: typeof jpegJsModule =
  (jpegJsModule as unknown as { default?: typeof jpegJsModule }).default ?? jpegJsModule;

export type Volume = {
  nx: number;
  ny: number;
  nz: number;
  sx: number;
  sy: number;
  sz: number;
  data: Int16Array;
  min: number;
  max: number;
  windowCenter: number;
  windowWidth: number;
  patientName: string;
  studyDescription: string;
  modality: string;
  origin: [number, number, number];
  rowDir: [number, number, number];
  colDir: [number, number, number];
  sliceDir: [number, number, number];
};

type SliceInfo = {
  pos: number;
  instance: number;
  pixels: Int16Array;
  ipp: [number, number, number];
};

const tag = {
  rows: "x00280010",
  cols: "x00280011",
  samplesPerPixel: "x00280002",
  photometric: "x00280004",
  planarConfig: "x00280006",
  pixelSpacing: "x00280030",
  sliceThickness: "x00180050",
  spacingBetween: "x00180088",
  bitsAllocated: "x00280100",
  bitsStored: "x00280101",
  highBit: "x00280102",
  pixelRepresentation: "x00280103",
  rescaleIntercept: "x00281052",
  rescaleSlope: "x00281053",
  windowCenter: "x00281050",
  windowWidth: "x00281051",
  imagePosition: "x00200032",
  imageOrientation: "x00200037",
  instanceNumber: "x00200013",
  patientName: "x00100010",
  studyDescription: "x00081030",
  modality: "x00080060",
  transferSyntax: "x00020010",
  pixelData: "x7fe00010",
  seriesInstanceUID: "x0020000e",
  seriesDescription: "x0008103e",
  seriesNumber: "x00200011",
};

function num(ds: DataSet, t: string, fallback = 0): number {
  const v = ds.floatString(t);
  return v === undefined || Number.isNaN(v) ? fallback : v;
}

/** Extrai uma mensagem legível de um erro de formato desconhecido. */
function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; exception?: unknown };
    if (record.message != null) return String(record.message);
    if (record.exception != null) return String(record.exception);
  }
  return String(error ?? "");
}

/** Parseia o DICOM, tentando o transfer syntax implícito quando falta o prefixo DICM. */
function parseDicomBuffer(buf: Uint8Array): DataSet | null {
  try {
    return dicomParser.parseDicom(buf);
  } catch (e: unknown) {
    if (!errorMessage(e).includes("DICM prefix not found")) return null;
    try {
      return dicomParser.parseDicom(buf, { TransferSyntaxUID: "1.2.840.10008.1.2" });
    } catch {
      return null;
    }
  }
}

export type ProgressFn = (done: number, total: number, label: string) => void;

const JPEG_BASELINE = new Set(["1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51"]);
const JPEG_LOSSLESS = new Set(["1.2.840.10008.1.2.4.57", "1.2.840.10008.1.2.4.70"]);
const JPEGLS = new Set(["1.2.840.10008.1.2.4.80", "1.2.840.10008.1.2.4.81"]);
const JPEG2000 = new Set(["1.2.840.10008.1.2.4.90", "1.2.840.10008.1.2.4.91"]);
const RLE = "1.2.840.10008.1.2.5";
const NATIVE = new Set([
  "1.2.840.10008.1.2",
  "1.2.840.10008.1.2.1",
  "1.2.840.10008.1.2.2",
  "1.2.840.10008.1.2.1.99",
]);

interface JpegLSDecoderInstance {
  getEncodedBuffer(length: number): Uint8Array;
  getDecodedBuffer(): Uint8Array;
  getFrameInfo?(): unknown;
  decode(): void;
  delete(): void;
}

interface CharLSCodecModule {
  JpegLSDecoder: new () => JpegLSDecoderInstance;
}

interface J2KDecoderInstance {
  getEncodedBuffer(length: number): Uint8Array;
  getDecodedBuffer(): Uint8Array;
  decode(): void;
  delete(): void;
}

interface OpenJPEGCodecModule {
  J2KDecoder: new () => J2KDecoderInstance;
}

/** Resolve um módulo de codec em vários formatos (factory, promise ou módulo). */
async function resolveCodecModule(imported: unknown, named: string): Promise<unknown> {
  const record = imported as Record<string, unknown>;
  const candidate = record["default"] ?? record[named] ?? imported;
  let resolved: unknown;
  if (typeof candidate === "function") {
    resolved = await (candidate as () => Promise<unknown> | unknown)();
  } else if (candidate && typeof (candidate as { then?: unknown }).then === "function") {
    resolved = await (candidate as Promise<unknown>);
  } else {
    resolved = candidate;
  }
  const resolvedRecord = resolved as Record<string, unknown> | null;
  return (resolvedRecord && resolvedRecord["default"]) ?? resolved;
}

let openjpegReady: Promise<OpenJPEGCodecModule> | null = null;
let charlsReady: Promise<CharLSCodecModule> | null = null;

async function getOpenJPEG(): Promise<OpenJPEGCodecModule> {
  if (!openjpegReady) {
    openjpegReady = (async () =>
      (await resolveCodecModule(
        await import("@cornerstonejs/codec-openjpeg/decode"),
        "OpenJPEG",
      )) as OpenJPEGCodecModule)();
  }
  return openjpegReady;
}

async function getCharLS(): Promise<CharLSCodecModule> {
  if (!charlsReady) {
    charlsReady = (async () =>
      (await resolveCodecModule(
        await import("@cornerstonejs/codec-charls/decode"),
        "CharLS",
      )) as CharLSCodecModule)();
  }
  return charlsReady;
}

function getEncapsulatedBuffer(ds: DataSet, el: Element): Uint8Array {
  try {
    const b = dicomParser.readEncapsulatedPixelData(ds, el, 0);
    if (b && b.length) {
      if (b instanceof Uint8Array) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      return new Uint8Array(b);
    }
  } catch {
    /* sem buffer encapsulado via API: usa o fallback por fragmentos */
  }
  if (el.fragments && el.fragments.length) {
    const frag = el.fragments[0]!;
    const ba: Uint8Array = ds.byteArray;
    return new Uint8Array(ba.buffer, ba.byteOffset + frag.position, frag.length);
  }
  return new Uint8Array(0);
}

function decodeBaselineJPEG(
  buf: Uint8Array,
  rows: number,
  cols: number,
  samples: number,
): Uint8Array {
  const decoded = jpegjs.decode(buf, { useTArray: true, colorTransform: false });
  const data: Uint8Array = decoded.data;
  if (samples === 1) {
    const out = new Uint8Array(rows * cols);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = data[j]!;
    return out;
  }
  if (samples === 3) {
    const out = new Uint8Array(rows * cols * 3);
    for (let i = 0, j = 0; i < rows * cols; i++) {
      out[i * 3] = data[j++]!;
      out[i * 3 + 1] = data[j++]!;
      out[i * 3 + 2] = data[j++]!;
      j++;
    }
    return out;
  }
  const out = new Uint8Array(rows * cols);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = data[j]!;
  return out;
}

function decodeJPEGLossless(buf: Uint8Array): Uint8Array {
  const dec = new JPEGLosslessDecoder();
  const ab: ArrayBuffer = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  const out = dec.decompress(ab, 0, ab.byteLength);
  return new Uint8Array(out);
}

function rleDecodeSegment(
  src: Uint8Array,
  srcOff: number,
  srcLen: number,
  dst: Uint8Array,
  dstOff: number,
  dstLen: number,
) {
  let s = srcOff;
  let d = dstOff;
  const end = srcOff + srcLen;
  const dEnd = dstOff + dstLen;
  while (s < end && d < dEnd) {
    const n = (src[s++]! << 24) >> 24;
    if (n >= 0 && n <= 127) {
      const cnt = n + 1;
      for (let i = 0; i < cnt && d < dEnd && s < end; i++) dst[d++] = src[s++]!;
    } else if (n >= -127 && n <= -1) {
      const cnt = -n + 1;
      const v = src[s++]!;
      for (let i = 0; i < cnt && d < dEnd; i++) dst[d++] = v;
    }
  }
}

function decodeRLE(
  buf: Uint8Array,
  rows: number,
  cols: number,
  samples: number,
  bitsAllocated: number,
): Uint8Array {
  const count = rows * cols;
  const numSegments = new DataView(
    buf.buffer,
    buf.byteOffset,
    Math.min(64, buf.byteLength),
  ).getUint32(0, true);
  const offsets: number[] = [];
  for (let i = 0; i < numSegments; i++)
    offsets.push(new DataView(buf.buffer, buf.byteOffset + 4 + i * 4, 4).getUint32(0, true));
  const headerSize = 64;
  if (bitsAllocated === 8) {
    const segments: Uint8Array[] = [];
    for (let s = 0; s < numSegments; s++) {
      const off = offsets[s]!;
      const next = s + 1 < numSegments ? offsets[s + 1]! : buf.length;
      const len = next - off;
      const seg = new Uint8Array(count);
      rleDecodeSegment(buf, off, len, seg, 0, count);
      segments.push(seg);
    }
    if (samples === 1) return segments[0]!;
    const out = new Uint8Array(count * samples);
    for (let s = 0; s < samples && s < segments.length; s++) out.set(segments[s]!, s * count);
    return out;
  } else {
    const bytesPerSample = 2;
    const expected = samples * bytesPerSample;
    const segments: Uint8Array[] = [];
    for (let s = 0; s < expected && s < numSegments; s++) {
      const off = offsets[s]!;
      const next = s + 1 < numSegments ? offsets[s + 1]! : buf.length;
      const len = next - off;
      const seg = new Uint8Array(count);
      rleDecodeSegment(buf, off, len, seg, 0, count);
      segments.push(seg);
    }
    const out = new Uint8Array(count * samples * 2);
    for (let s = 0; s < samples; s++) {
      const hi = segments[s * 2] ?? new Uint8Array(count);
      const lo = segments[s * 2 + 1] ?? new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        out[(i * samples + s) * 2] = hi[i]!;
        out[(i * samples + s) * 2 + 1] = lo[i]!;
      }
    }
    if (samples === 1) {
      const mono = new Uint8Array(count * 2);
      for (let i = 0; i < count; i++) {
        mono[i * 2] = segments[0]![i]!;
        mono[i * 2 + 1] = segments[1]![i]!;
      }
      return mono;
    }
    return out;
  }
}

async function decodeJPEGLSAsync(buf: Uint8Array): Promise<Uint8Array> {
  const mod = await getCharLS();
  const decoder = new mod.JpegLSDecoder();
  const encoded = decoder.getEncodedBuffer(buf.length);
  encoded.set(buf);
  decoder.decode();
  const decoded = decoder.getDecodedBuffer();
  const out = new Uint8Array(decoded.byteLength);
  out.set(new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength));
  const frameInfo = decoder.getFrameInfo ? decoder.getFrameInfo() : null;
  void frameInfo;
  decoder.delete();
  return out;
}

async function decodeJPEG2000Async(buf: Uint8Array): Promise<Uint8Array> {
  const mod = await getOpenJPEG();
  const decoder = new mod.J2KDecoder();
  const encoded = decoder.getEncodedBuffer(buf.length);
  encoded.set(buf);
  decoder.decode();
  const decoded = decoder.getDecodedBuffer();
  const out = new Uint8Array(decoded.byteLength);
  out.set(new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength));
  try {
    decoder.delete();
  } catch {
    /* delete() é opcional em algumas versões do codec */
  }
  return out;
}

function toInt16Pixels(
  decoded: Uint8Array,
  rows: number,
  cols: number,
  bitsAllocated: number,
  bitsStored: number,
  pixelRepresentation: number,
  samples: number,
  photometric: string,
  slope: number,
  intercept: number,
): Int16Array {
  const count = rows * cols;
  const out = new Int16Array(count);
  const maxVal = (1 << bitsStored) - 1;
  const signed = pixelRepresentation === 1;
  const is16 = bitsAllocated === 16 || decoded.byteLength >= count * 2;
  if (is16) {
    const u16 = new Uint16Array(
      decoded.buffer,
      decoded.byteOffset,
      Math.floor(decoded.byteLength / 2),
    );
    const mono1 = photometric === "MONOCHROME1";
    for (let i = 0; i < count; i++) {
      let raw: number;
      if (samples === 1) raw = u16[i]!;
      else {
        const r = u16[i * samples]!;
        const g = u16[i * samples + 1]!;
        const b = u16[i * samples + 2]!;
        raw = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      if (signed) raw = (raw << (32 - bitsStored)) >> (32 - bitsStored);
      else if (mono1) raw = maxVal - raw;
      let v = raw * slope + intercept;
      if (v > 32767) v = 32767;
      if (v < -32768) v = -32768;
      out[i] = v;
    }
  } else {
    const mono1 = photometric === "MONOCHROME1";
    for (let i = 0; i < count; i++) {
      let raw: number;
      if (samples === 1) raw = decoded[i]!;
      else {
        const r = decoded[i * samples]!;
        const g = decoded[i * samples + 1]!;
        const b = decoded[i * samples + 2]!;
        raw = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      if (signed) raw = (raw << (32 - bitsStored)) >> (32 - bitsStored);
      else if (mono1) raw = maxVal - raw;
      let v = raw * slope + intercept;
      if (v > 32767) v = 32767;
      if (v < -32768) v = -32768;
      out[i] = v;
    }
  }
  return out;
}

async function decodePixels(
  ds: DataSet,
  pdEl: Element,
  ts: string,
  rows: number,
  cols: number,
  bitsAllocated: number,
  bitsStored: number,
  pixelRepresentation: number,
  samples: number,
  photometric: string,
  slope: number,
  intercept: number,
): Promise<Int16Array> {
  const count = rows * cols;
  const isNative = NATIVE.has(ts);
  if (isNative && !pdEl.encapsulatedPixelData) {
    const out = new Int16Array(count);
    const bytes: Uint8Array = ds.byteArray;
    const signed = pixelRepresentation === 1;
    if (bitsAllocated === 8) {
      for (let p = 0; p < count; p++) {
        let raw = bytes[pdEl.dataOffset + p]!;
        if (photometric === "MONOCHROME1") raw = (1 << bitsStored) - 1 - raw;
        let v = raw * slope + intercept;
        if (v > 32767) v = 32767;
        if (v < -32768) v = -32768;
        out[p] = v;
      }
      return out;
    } else {
      const dv = new DataView(bytes.buffer, bytes.byteOffset + pdEl.dataOffset, count * 2);
      for (let p = 0; p < count; p++) {
        const rawU = signed ? dv.getInt16(p * 2, true) : dv.getUint16(p * 2, true);
        let raw = rawU;
        if (!signed && photometric === "MONOCHROME1") raw = (1 << bitsStored) - 1 - raw;
        let v = raw * slope + intercept;
        if (v > 32767) v = 32767;
        if (v < -32768) v = -32768;
        out[p] = v;
      }
      return out;
    }
  }

  const compressed = getEncapsulatedBuffer(ds, pdEl);
  if (!compressed.length) throw new Error("PixelData vazio");
  let decoded: Uint8Array;
  if (JPEG_BASELINE.has(ts)) {
    decoded = decodeBaselineJPEG(compressed, rows, cols, samples);
  } else if (JPEG_LOSSLESS.has(ts)) {
    decoded = decodeJPEGLossless(compressed);
  } else if (JPEGLS.has(ts)) {
    decoded = await decodeJPEGLSAsync(compressed);
  } else if (JPEG2000.has(ts)) {
    decoded = await decodeJPEG2000Async(compressed);
  } else if (ts === RLE) {
    decoded = decodeRLE(compressed, rows, cols, samples, bitsAllocated);
  } else if (ts.startsWith("1.2.840.10008.1.2.4")) {
    try {
      decoded = decodeBaselineJPEG(compressed, rows, cols, samples);
    } catch {
      try {
        decoded = decodeJPEGLossless(compressed);
      } catch {
        decoded = await decodeJPEG2000Async(compressed);
      }
    }
  } else {
    throw new Error(`TransferSyntax não suportado: ${ts}`);
  }
  return toInt16Pixels(
    decoded,
    rows,
    cols,
    bitsAllocated,
    bitsStored,
    pixelRepresentation,
    samples,
    photometric,
    slope,
    intercept,
  );
}

export async function buildVolumeFromFiles(
  files: File[],
  onProgress?: ProgressFn,
): Promise<Volume> {
  const slices: SliceInfo[] = [];
  let nx = 0;
  let ny = 0;
  let sx = 1;
  let sy = 1;
  let thickness = 1;
  let wc = NaN;
  let ww = NaN;
  let patientName = "—";
  let studyDescription = "—";
  let modality = "—";
  let normal: [number, number, number] = [0, 0, 1];
  let rowDir: [number, number, number] = [1, 0, 0];
  let colDir: [number, number, number] = [0, 1, 0];
  let skipped = 0;
  const skippedReasons = new Map<string, number>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    if (i % 5 === 0 || i === files.length - 1) {
      onProgress?.(i + 1, files.length, i18n.t("lib.dicom.readingFiles"));
      await new Promise((r) => setTimeout(r));
    }
    let ds: DataSet | null = null;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      ds = parseDicomBuffer(buf);
    } catch {
      ds = null;
    }
    if (!ds) {
      skipped++;
      skippedReasons.set("parse-fail", (skippedReasons.get("parse-fail") ?? 0) + 1);
      continue;
    }
    const pdEl = ds.elements[tag.pixelData];
    if (!pdEl) {
      skipped++;
      skippedReasons.set("no-pixeldata", (skippedReasons.get("no-pixeldata") ?? 0) + 1);
      continue;
    }
    const ts = ds.string(tag.transferSyntax) ?? "1.2.840.10008.1.2";
    const rows = ds.uint16(tag.rows) ?? 0;
    const cols = ds.uint16(tag.cols) ?? 0;
    if (!rows || !cols) {
      skipped++;
      skippedReasons.set("no-dims", (skippedReasons.get("no-dims") ?? 0) + 1);
      continue;
    }
    if (!nx) {
      nx = cols;
      ny = rows;
      const ps = ds.string(tag.pixelSpacing);
      if (ps) {
        const parts = ps.split("\\").map(parseFloat);
        sy = parts[0] || 1;
        sx = parts[1] || parts[0] || 1;
      }
      thickness = num(ds, tag.spacingBetween, 0) || num(ds, tag.sliceThickness, 1) || 1;
      wc = num(ds, tag.windowCenter, NaN);
      ww = num(ds, tag.windowWidth, NaN);
      patientName = (ds.string(tag.patientName) ?? "—").replace(/\^+/g, " ").trim() || "—";
      studyDescription = ds.string(tag.studyDescription) ?? "—";
      modality = ds.string(tag.modality) ?? "—";
      const iop = ds.string(tag.imageOrientation);
      if (iop) {
        const o = iop.split("\\").map(parseFloat);
        if (o.length === 6) {
          rowDir = [o[0]!, o[1]!, o[2]!];
          colDir = [o[3]!, o[4]!, o[5]!];
          normal = [
            o[1]! * o[5]! - o[2]! * o[4]!,
            o[2]! * o[3]! - o[0]! * o[5]!,
            o[0]! * o[4]! - o[1]! * o[3]!,
          ];
        }
      }
    } else if (cols !== nx || rows !== ny) {
      skipped++;
      skippedReasons.set("mismatch-size", (skippedReasons.get("mismatch-size") ?? 0) + 1);
      continue;
    }

    const bitsAllocated = ds.uint16(tag.bitsAllocated) ?? 16;
    const bitsStored = ds.uint16(tag.bitsStored) ?? bitsAllocated;
    const pixelRepresentation = ds.uint16(tag.pixelRepresentation) ?? 0;
    const samples = ds.uint16(tag.samplesPerPixel) ?? 1;
    const photometric = (ds.string(tag.photometric) ?? "MONOCHROME2").trim();
    const slope = num(ds, tag.rescaleSlope, 1) || 1;
    const intercept = num(ds, tag.rescaleIntercept, 0);

    let pixels: Int16Array;
    try {
      pixels = await decodePixels(
        ds,
        pdEl,
        ts,
        rows,
        cols,
        bitsAllocated,
        bitsStored,
        pixelRepresentation,
        samples,
        photometric,
        slope,
        intercept,
      );
    } catch (e) {
      skipped++;
      const k = ts;
      skippedReasons.set(k, (skippedReasons.get(k) ?? 0) + 1);
      continue;
    }

    let pos = 0;
    let ippVec: [number, number, number] = [0, 0, 0];
    const ipp = ds.string(tag.imagePosition);
    if (ipp) {
      const p = ipp.split("\\").map(parseFloat);
      ippVec = [p[0] || 0, p[1] || 0, p[2] || 0];
      pos = ippVec[0] * normal[0] + ippVec[1] * normal[1] + ippVec[2] * normal[2];
    }
    slices.push({
      pos,
      instance: ds.intString(tag.instanceNumber) ?? slices.length,
      pixels,
      ipp: ippVec,
    });
  }

  if (!slices.length) {
    const detail = [...skippedReasons.entries()].map(([k, v]) => `${k}: ${v}`).join(", ");
    throw new Error(
      skipped
        ? i18n.t("lib.dicom.noCompatibleImages", {
            detail: detail || i18n.t("lib.dicom.decodeFallback"),
            skipped,
          })
        : i18n.t("lib.dicom.noValidFiles"),
    );
  }

  const hasPos = slices.some((s) => s.pos !== 0);
  slices.sort((a, b) => (hasPos ? a.pos - b.pos : a.instance - b.instance));
  if (hasPos && slices.length > 1) {
    const d = Math.abs(slices[1]!.pos - slices[0]!.pos);
    if (d > 0.001) thickness = d;
  }

  const nz = slices.length;
  const origin = slices[0]!.ipp;
  let sliceDir: [number, number, number] = [...normal] as [number, number, number];
  if (hasPos && slices.length > 1) {
    const a = slices[0]!.ipp;
    const b = slices[1]!.ipp;
    const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len > 1e-6) sliceDir = [d[0] / len, d[1] / len, d[2] / len];
  }
  onProgress?.(nz, nz, i18n.t("lib.dicom.buildingVolume"));
  await new Promise((r) => setTimeout(r));

  const data = new Int16Array(nx * ny * nz);
  let min = 32767;
  let max = -32768;
  for (let z = 0; z < nz; z++) {
    const src = slices[z]!.pixels;
    data.set(src, z * nx * ny);
    for (let p = 0; p < src.length; p++) {
      const v = src[p]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    slices[z]!.pixels = new Int16Array(0);
  }

  if (!Number.isFinite(wc) || !Number.isFinite(ww) || ww <= 0) {
    wc = (max + min) / 2;
    ww = Math.max(1, max - min);
  }

  return {
    nx,
    ny,
    nz,
    sx,
    sy,
    sz: thickness,
    data,
    min,
    max,
    windowCenter: wc,
    windowWidth: ww,
    patientName,
    studyDescription,
    modality,
    origin,
    rowDir,
    colDir,
    sliceDir,
  };
}

export type DicomSeriesGroup = {
  uid: string;
  key: string;
  description: string;
  seriesNumber: string;
  modality: string;
  displayName: string;
  count: number;
  files: File[];
};

export async function groupFilesBySeries(
  files: File[],
  onProgress?: ProgressFn,
): Promise<DicomSeriesGroup[]> {
  const map = new Map<string, DicomSeriesGroup>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    if (i % 20 === 0) {
      onProgress?.(i + 1, files.length, i18n.t("lib.dicom.identifyingSeries"));
      await new Promise((r) => setTimeout(r));
    }
    let uid = "";
    let desc = "";
    let numStr = "";
    let modality = "";
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const ds = parseDicomBuffer(buf);
      if (ds) {
        uid = (ds.string(tag.seriesInstanceUID) ?? "").trim();
        desc = (ds.string(tag.seriesDescription) ?? "").trim();
        numStr = (ds.string(tag.seriesNumber) ?? "").trim();
        modality = (ds.string(tag.modality) ?? "").trim();
      }
    } catch {
      /* arquivo ilegível: mantém os valores padrão da série */
    }
    let key: string;
    let displayName: string;
    if (uid) {
      key = uid;
      displayName =
        desc ||
        (numStr
          ? i18n.t("lib.dicom.seriesNumber", { number: numStr })
          : uid.slice(-12) || i18n.t("lib.dicom.seriesNoName"));
    } else if (desc || numStr) {
      key = `__desc__${desc}__num__${numStr}`;
      displayName = desc || i18n.t("lib.dicom.seriesNumber", { number: numStr });
    } else {
      key = "__unknown__";
      displayName = i18n.t("lib.dicom.seriesNoId");
    }
    let g = map.get(key);
    if (!g) {
      g = {
        uid: uid || key,
        key,
        description: desc || displayName,
        seriesNumber: numStr,
        modality,
        displayName,
        count: 0,
        files: [],
      };
      map.set(key, g);
    }
    if (!g.modality && modality) g.modality = modality;
    if (g.displayName === i18n.t("lib.dicom.seriesNoId") && desc) {
      g.displayName = desc;
      g.description = desc;
    }
    g.files.push(file);
    g.count = g.files.length;
  }
  const groups = [...map.values()];
  groups.sort((a, b) => b.count - a.count);
  return groups;
}

export type Plane = "axial" | "coronal" | "sagittal";

export function sliceCount(v: Volume, plane: Plane) {
  return plane === "axial" ? v.nz : plane === "coronal" ? v.ny : v.nx;
}

export function sliceDims(v: Volume, plane: Plane) {
  if (plane === "axial") return { w: v.nx, h: v.ny, pw: v.sx, ph: v.sy };
  if (plane === "coronal") return { w: v.nx, h: v.nz, pw: v.sx, ph: v.sz };
  return { w: v.ny, h: v.nz, pw: v.sy, ph: v.sz };
}

export function renderSlice(
  v: Volume,
  plane: Plane,
  index: number,
  center: number,
  width: number,
  invert: boolean,
): ImageData {
  const { w, h } = sliceDims(v, plane);
  const img = new ImageData(w, h);
  const px = img.data;
  const lo = center - width / 2;
  const scale = 255 / Math.max(1, width);
  const nx = v.nx;
  const nxy = v.nx * v.ny;
  const d = v.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let si: number;
      if (plane === "axial") si = index * nxy + y * nx + x;
      else if (plane === "coronal") si = y * nxy + index * nx + x;
      else si = y * nxy + x * nx + index;
      let g = (d[si]! - lo) * scale;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (invert) g = 255 - g;
      const o = (y * w + x) * 4;
      px[o] = g;
      px[o + 1] = g;
      px[o + 2] = g;
      px[o + 3] = 255;
    }
  }
  return img;
}

export function makeTextureVolume(v: Volume, maxDim = 192) {
  const step = Math.max(1, Math.ceil(Math.max(v.nx, v.ny, v.nz) / maxDim));
  const tx = Math.max(2, Math.floor(v.nx / step));
  const ty = Math.max(2, Math.floor(v.ny / step));
  const tz = Math.max(2, Math.floor(v.nz / step));
  const out = new Uint8Array(tx * ty * tz);
  const range = Math.max(1, v.max - v.min);
  const nxy = v.nx * v.ny;
  let i = 0;
  for (let z = 0; z < tz; z++) {
    const zo = Math.min(v.nz - 1, z * step) * nxy;
    for (let y = 0; y < ty; y++) {
      const yo = Math.min(v.ny - 1, y * step) * v.nx;
      for (let x = 0; x < tx; x++) {
        const val = v.data[zo + yo + Math.min(v.nx - 1, x * step)]!;
        out[i++] = ((val - v.min) / range) * 255;
      }
    }
  }
  return { data: out, tx, ty, tz };
}
