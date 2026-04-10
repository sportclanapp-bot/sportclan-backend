"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadBuffer = void 0;
const supabase_1 = require("./supabase");
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'media';
/**
 * Uploads a buffer to Supabase Storage and returns the public URL.
 * Pass a unique key (e.g. "profile-photos/<userId>/<uuid>.jpg").
 */
async function uploadBuffer(key, body, contentType) {
    const { error } = await supabase_1.supabase.storage
        .from(BUCKET)
        .upload(key, body, {
        contentType,
        upsert: true,
        cacheControl: '31536000',
    });
    if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }
    const { data: urlData } = supabase_1.supabase.storage
        .from(BUCKET)
        .getPublicUrl(key);
    return urlData.publicUrl;
}
exports.uploadBuffer = uploadBuffer;
//# sourceMappingURL=r2.js.map