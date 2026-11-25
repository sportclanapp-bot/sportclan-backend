/**
 * Item 34 (25 Nov 2026) · small copies for the photos uploaded before they were made.
 * ONLY ADDS files (`<id>.s.jpg` beside each `<id>.jpg`); deletes and changes nothing, touches no database row.
 * Safe to stop and run again. Dry run by default:
 *   npx ts-node scripts/small-images-backfill.ts          → how many
 *   npx ts-node scripts/small-images-backfill.ts --write  → make them
 * Then set SMALL_IMAGES_ALL=1 on the server: GET /app/version tells the app older photos have one too.
 * Needs Dipak's OK before --write (it writes to the live photo store).
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { uploadBuffer } from '../src/utils/r2';
import { keysNeedingSmall, SMALL_IMAGE_QUALITY, SMALL_IMAGE_SIDE, smallKeyOf } from '../src/utils/smallImage';

async function main() {
  const write = process.argv.includes('--write');
  const Bucket = process.env.R2_BUCKET || 'sportclan-media';
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' } });
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'profile-photos/', ContinuationToken }));
    keys.push(...(r.Contents ?? []).map((o) => o.Key!).filter(Boolean));
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  const due = keysNeedingSmall(keys);
  console.log(`${keys.length} files, ${due.length} without a small copy`);
  if (!write) return;
  let done = 0; let failed = 0;
  for (const key of due) {
    try {
      const o = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      const small = await sharp(Buffer.from(await o.Body!.transformToByteArray())).resize(SMALL_IMAGE_SIDE, SMALL_IMAGE_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: SMALL_IMAGE_QUALITY }).toBuffer();
      await uploadBuffer(smallKeyOf(key), small, 'image/jpeg');
      done += 1;
    } catch (e) { failed += 1; console.warn('skipped', key, (e as Error).message); }
  }
  console.log(`${done} made, ${failed} skipped`);
}
void main();
