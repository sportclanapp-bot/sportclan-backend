import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { uploadBuffer } from '../utils/r2';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 80;

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
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 payload' });
  }

  // Server-side compression: resize to max 1200px on longest side, JPEG quality 80
  try {
    buf = await sharp(buf)
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
