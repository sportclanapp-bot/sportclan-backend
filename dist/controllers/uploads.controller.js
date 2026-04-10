"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadProfilePhoto = void 0;
const crypto_1 = require("crypto");
const r2_1 = require("../utils/r2");
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
// POST /uploads/profile-photo
// Body: { base64: string, mime: string }
// Change #4: NO file size limit. Server compresses automatically (TODO).
// Returns: { url: string }
async function uploadProfilePhoto(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { base64, mime } = req.body || {};
    if (!base64 || typeof base64 !== 'string') {
        return res.status(400).json({ error: 'base64 is required' });
    }
    if (!mime || !ALLOWED_MIME.has(mime)) {
        return res.status(400).json({ error: 'mime must be image/jpeg, image/png, or image/webp' });
    }
    // Strip optional data:image/*;base64, prefix.
    const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
    let buf;
    try {
        buf = Buffer.from(cleaned, 'base64');
    }
    catch {
        return res.status(400).json({ error: 'Invalid base64 payload' });
    }
    // TODO: server-side compression with sharp (Change #4 — no client size limit).
    // For Part 3 we upload as-is. Add sharp resize/compress in a later module.
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const key = `profile-photos/${userId}/${(0, crypto_1.randomUUID)()}.${ext}`;
    try {
        const url = await (0, r2_1.uploadBuffer)(key, buf, mime);
        return res.json({ url });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || 'Upload failed' });
    }
}
exports.uploadProfilePhoto = uploadProfilePhoto;
//# sourceMappingURL=uploads.controller.js.map