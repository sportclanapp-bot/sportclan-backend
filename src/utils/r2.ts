import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Cloudflare R2 is S3-compatible. Credentials are read from env vars
// set in Railway (never hardcoded).
let _client: S3Client | null = null;

function client(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY must be set');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

/**
 * Uploads a buffer to Cloudflare R2 and returns the public URL.
 * Pass a unique key (e.g. "profile-photos/<userId>/<uuid>.jpg").
 */
export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = process.env.R2_BUCKET || 'sportclan-media';
  const publicBase = process.env.R2_PUBLIC_BASE_URL || '';
  if (!bucket) {
    throw new Error('R2_BUCKET must be set');
  }
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  // If a public base URL is configured (e.g. custom domain or R2 public bucket URL),
  // use it. Otherwise fall back to the S3 endpoint path.
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${key}`;
  }
  const accountId = process.env.R2_ACCOUNT_ID || '';
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
}
