import { supabase } from './supabase';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'media';

/**
 * Uploads a buffer to Supabase Storage and returns the public URL.
 * Pass a unique key (e.g. "profile-photos/<userId>/<uuid>.jpg").
 */
export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, body, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(key);

  return urlData.publicUrl;
}
