import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { uploadBuffer } from '../utils/r2';

// SC-351: heic/heif accepted — an iPhone's default camera format. Both the honest
// mime and the mislabelled one are handled (see sniffing below).
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 80;

// SC-351 · HEIC support.
//
// sharp CANNOT decode HEIC: its prebuilt libvips parses the container (metadata
// reads fine) but has no HEVC decoder — "Support for this compression format has
// not been built in". So an iPhone photo failed at `sharp()` with an opaque
// "bad seek" 400. heic-convert carries its own libheif build, so it works
// regardless of what the deployed libvips was compiled with.
//
// We must SNIFF rather than trust `mime`: the app labels every non-.png file
// image/jpeg (utils/imageUpload.ts), so a real HEIC arrives claiming to be JPEG.
// Sniffing the bytes catches that case AND a file that lies the other way.
//
// ISO-BMFF layout: [4-byte box size][b'ftyp'][4-byte major brand]. AVIF is the
// same container but sharp DOES decode it, so 'avif'/'avis' deliberately stay off
// this list and keep taking the native path.
const HEIC_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'heif', 'mif1', 'msf1',
]);
function isHeicBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.has(buf.toString('ascii', 8, 12).toLowerCase());
}

/**
 * Decode HEIC to JPEG bytes so the normal sharp pipeline can take over.
 * Rotation is preserved: HEIF stores orientation as a container transform and
 * libheif applies it during decode, so the JPEG that comes out is already
 * upright — and the pipeline's `.rotate()` then no-ops harmlessly on it.
 */
async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  // Lazy import: only an iPhone upload pays the module-load cost.
  const { default: convert } = await import('heic-convert');
  const out = await convert({ buffer: buf, format: 'JPEG', quality: 0.92 });
  return Buffer.from(out);
}

// POST /uploads/profile-photo
// Body: { base64: string, mime: string }
// Change #4: NO file size limit. Server compresses automatically.
// Returns: { url: string }
export async function uploadProfilePhoto(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { base64, mime } = req.body || {};
  if (!base64 || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'base64 is required' });
  }
  if (!mime || !ALLOWED_MIME.has(mime)) {
    return res.status(400).json({ error: 'mime must be image/jpeg, image/png, or image/webp' });
  }

  // Strip optional data:image/*;base64, prefix.
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');

  // SC-109: cap the payload before decoding + sharp. base64 encodes 3 bytes as
  // 4 chars, so ~10MB decoded ≈ 13.4M chars; guard length first (cheap), then
  // re-check the decoded Buffer size to be exact.
  if (cleaned.length > 14_000_000) {
    return res.status(413).json({ error: 'Image too large (max 10MB)' });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 payload' });
  }

  if (buf.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image too large (max 10MB)' });
  }

  // SC-351: HEIC → JPEG before sharp sees it (sharp can't decode HEVC). Keyed on
  // the BYTES, so an iPhone photo mislabelled image/jpeg by the app is caught too.
  if (isHeicBuffer(buf)) {
    try {
      buf = await heicToJpeg(buf);
    } catch (err: any) {
      return res
        .status(400)
        .json({ error: 'Could not read this HEIC image: ' + (err?.message ?? 'unknown'), code: 'HEIC_DECODE_FAILED' });
    }
  }

  // Server-side compression: resize to max 1200px on longest side, JPEG quality 80.
  // SC-350: `.rotate()` (auto-orient) MUST come first. Phone cameras store portrait
  // shots as landscape pixels + an EXIF orientation tag; sharp does not honour that
  // tag unless asked, and it strips EXIF on output — so the old pipeline emitted
  // un-rotated pixels with no orientation hint left and every portrait photo
  // displayed SIDEWAYS. `.rotate()` with no argument bakes the EXIF rotation into
  // the pixels, which is exactly what a metadata-less JPEG needs. Applies to every
  // caller of this endpoint (avatars, post media, chat images, venue photos).
  try {
    buf = await sharp(buf)
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (err: any) {
    return res.status(400).json({ error: 'Could not process image: ' + (err?.message ?? 'unknown') });
  }

  const key = `profile-photos/${userId}/${randomUUID()}.jpg`;

  try {
    const url = await uploadBuffer(key, buf, 'image/jpeg');
    return res.json({ url });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Upload failed' });
  }
}

// ─── Audio uploads · voice notes ──────────────────────────────────────────

const ALLOWED_AUDIO_MIME = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/aac',
  'audio/webm',
  'audio/ogg',
]);
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB; voice notes are short

// POST /uploads/audio
// Body: { base64: string, mime: string, duration_ms?: number }
// Stores audio in R2 (no transcoding) and returns the public URL.
// Used by chat voice-notes.
export async function uploadAudio(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // SC-75: voice notes are disabled — chat is text + link only. This endpoint
  // is chat-voice-only (nothing else uploads audio), so blocking it here is
  // scoped to chat and doesn't affect the shared /uploads/profile-photo path
  // (profile / team logos / post images). Returns 404 so the feature reads as
  // unavailable.
  return res.status(404).json({ error: 'Voice notes are not available.', code: 'VOICE_DISABLED' });

  const { base64, mime } = req.body || {};
  if (!base64 || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'base64 is required' });
  }
  if (!mime || !ALLOWED_AUDIO_MIME.has(mime)) {
    return res.status(400).json({
      error: 'mime must be audio/mp4, audio/m4a, audio/mpeg, audio/aac, audio/webm, or audio/ogg',
    });
  }

  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 payload' });
  }

  if (buf.length > MAX_AUDIO_BYTES) {
    return res.status(413).json({
      error: `Audio too large (${Math.round(buf.length / 1024)} KB). Max ${MAX_AUDIO_BYTES / 1024} KB.`,
    });
  }

  // File extension from mime
  const ext = mime === 'audio/mpeg' ? 'mp3'
    : mime === 'audio/webm' ? 'webm'
    : mime === 'audio/ogg' ? 'ogg'
    : mime === 'audio/aac' ? 'aac'
    : 'm4a';

  const key = `voice-notes/${userId}/${randomUUID()}.${ext}`;

  try {
    const url = await uploadBuffer(key, buf, mime);
    return res.json({ url, bytes: buf.length });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Upload failed' });
  }
}
