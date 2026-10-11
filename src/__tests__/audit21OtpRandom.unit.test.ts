/** Audit #21 (11 Oct 2026): OTP codes come from crypto.randomInt, not Math.random. */
import fs from 'fs';
import path from 'path';
import { generateOtp } from '../controllers/auth.controller';

describe('audit #21: OTP codes are cryptographically random', () => {
  it('uses crypto.randomInt and never Math.random', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8');
    const body = s.slice(s.indexOf('export function generateOtp('), s.indexOf('}', s.indexOf('export function generateOtp(')));
    expect(body).toMatch(/crypto\.randomInt\(100000, 1000000\)/);
    expect(body).not.toMatch(/Math\.random/);
  });
  it('always 6 digits', () => {
    for (let i = 0; i < 2000; i++) expect(generateOtp()).toMatch(/^[1-9]\d{5}$/);
  });
});
