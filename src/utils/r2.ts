import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Cloudflare R2 is S3-compatible. We talk to it with the AWS SDK using
// the account-scoped endpoint. Real credentials live in the Railway env.
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

// Uploads a buffer to R2 and returns the public URL.
// Pass a unique key (e.g. "profile-photos/<userId>/<uuid>.jpg").
export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = process.env.R2_BUCKET || '';
  const publicBase = process.env.R2_PUBLIC_BASE_URL || '';
  if (!bucket || !publicBase) {
    throw new Error('R2_BUCKET and R2_PUBLIC_BASE_URL must be set');
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
  return `${publicBase.replace(/\/$/, '')}/${key}`;
}
