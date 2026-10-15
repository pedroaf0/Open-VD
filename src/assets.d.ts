declare module "*.PNG" {
  const source: string;
  export default source;
}
declare module "jpeg-lossless-decoder-js" {
  export class Decoder {
    decompress(buffer: ArrayBuffer, offset: number, length: number): ArrayBuffer;
  }
}
declare module "@cornerstonejs/codec-openjpeg/decode" {
  const mod: unknown;
  export default mod;
  export const OpenJPEG: unknown;
}
declare module "@cornerstonejs/codec-charls/decode" {
  const mod: unknown;
  export default mod;
  export const CharLS: unknown;
}
