// SC-351: heic-convert ships no types and has no @types package. Minimal ambient
// declaration for the one call shape we use (buffer in → JPEG ArrayBuffer out).
declare module 'heic-convert' {
  interface HeicConvertOptions {
    buffer: Buffer;
    format: 'JPEG' | 'PNG';
    /** 0–1, JPEG only. */
    quality?: number;
  }
  function convert(options: HeicConvertOptions): Promise<ArrayBuffer>;
  export default convert;
}
