/**
 * Phase 4 · K3 — upload size + HEIC regressions (SC-351).
 * sharp, heic-convert and R2 are mocked: this pins the controller's routing
 * of bytes, not the image libraries themselves.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mockSharpInput: Buffer[] = [];
jest.mock('sharp', () => {
  const fn = (buf: Buffer) => {
    mockSharpInput.push(buf);
    const chain: any = {};
    for (const m of ['rotate', 'resize', 'jpeg']) chain[m] = () => chain;
    chain.toBuffer = async () => Buffer.from('jpeg-out');
    return chain;
  };
  return { __esModule: true, default: fn };
});
const mockConvert = jest.fn(async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer);
jest.mock('heic-convert', () => ({ __esModule: true, default: (...a: unknown[]) => (mockConvert as any)(...a) }));
jest.mock('../utils/r2', () => ({ uploadBuffer: jest.fn(async () => 'https://cdn.example/x.jpg') }));

// eslint-disable-next-line import/first
import { uploadProfilePhoto } from '../controllers/uploads.controller';
// eslint-disable-next-line import/first
import { globalErrorHandler } from '../middleware/errorSanitizer';

const res = () => {
  const r: any = { statusCode: 200, body: null, headersSent: false };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const heic = () => {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(24, 0);
  b.write('ftyp', 4, 'ascii');
  b.write('heic', 8, 'ascii');
  return b;
};

beforeEach(() => { mockSharpInput.length = 0; mockConvert.mockClear(); jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {}); });

describe('SC-351 uploads', () => {
  it('K3-1 (ff47574): the JSON body limit is 14mb so a full 10MB base64 image reaches the controller', () => {
    const idx = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(idx).toMatch(/express\.json\(\{\s*limit:\s*'14mb'\s*\}\)/);
    // base64 of 10MB is ~13.34MB — must fit under the parser cap.
    expect(Math.ceil((10 * 1024 * 1024) / 3) * 4).toBeLessThan(14 * 1024 * 1024);
  });

  it('K3-1 (ff47574): a HEIC photo mislabelled image/jpeg is decoded by heic-convert before sharp', async () => {
    const r = res();
    await uploadProfilePhoto({ userId: 'u1', body: { base64: heic().toString('base64'), mime: 'image/jpeg' } } as any, r);
    expect(mockConvert).toHaveBeenCalledTimes(1);
    expect(mockSharpInput[0]).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.body).toEqual({ url: 'https://cdn.example/x.jpg' });
  });

  it('K3-1 (ff47574): image/heic and image/heif are accepted mimes', async () => {
    for (const mime of ['image/heic', 'image/heif']) {
      const r = res();
      await uploadProfilePhoto({ userId: 'u1', body: { base64: heic().toString('base64'), mime } } as any, r);
      expect(r.statusCode).toBe(200);
    }
  });

  it('K3-1 (ff47574): a plain JPEG does not go through heic-convert', async () => {
    const r = res();
    await uploadProfilePhoto({ userId: 'u1', body: { base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64'), mime: 'image/jpeg' } } as any, r);
    expect(mockConvert).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(200);
  });

  it('K3-2 (e562120): a body-parser 413 on an /uploads/ route says "Image too large (max 10MB)"', () => {
    const err = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413, expose: true });
    const r = res();
    globalErrorHandler(err, { method: 'POST', originalUrl: '/uploads/profile-photo' } as any, r, () => {});
    expect([r.statusCode, r.body]).toEqual([413, { error: 'Image too large (max 10MB)' }]);
    const other = res();
    globalErrorHandler(err, { method: 'POST', originalUrl: '/community/posts' } as any, other, () => {});
    expect([other.statusCode, other.body]).toEqual([413, { error: 'Request payload too large' }]);
  });
});
