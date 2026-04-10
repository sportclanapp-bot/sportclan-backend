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
