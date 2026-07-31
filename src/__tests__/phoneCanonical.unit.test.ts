/** SC-386 · phone canonicalisation — the "two accounts, one number" bug. */
import { canonicalisePhone, phoneVariants, isValidIndianPhone } from '../utils/phone';

describe('SC-386 · canonicalisePhone', () => {
  it.each([
    ['+919876543210', '+919876543210'],
    ['9876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
  ])('%s -> %s', (input, expected) => {
    expect(canonicalisePhone(input)).toBe(expected);
  });

  it('every accepted variant collapses to ONE value — the whole point', () => {
    const forms = ['+919876543210', '9876543210', '919876543210', '09876543210', '+91 98765 43210'];
    expect(new Set(forms.map(canonicalisePhone)).size).toBe(1);
  });

  it.each([['notaphone'], ['12'], ['+14155550100'], ['5000000000'], [''], [null], [undefined]])(
    'refuses to canonicalise %s', (bad) => {
      expect(canonicalisePhone(bad as any)).toBeNull();
    });

  it('agrees with the validator the write paths use', () => {
    for (const ok of ['+919876543210', '9876543210', '919876543210']) {
      expect(isValidIndianPhone(ok)).toBe(true);
      expect(canonicalisePhone(ok)).not.toBeNull();
    }
    for (const bad of ['notaphone', '+14155550100', '5000000000']) {
      expect(isValidIndianPhone(bad)).toBe(false);
      expect(canonicalisePhone(bad)).toBeNull();
    }
  });
});

describe('SC-386 · phoneVariants keeps legacy rows reachable', () => {
  it('lists the canonical form FIRST, then the legacy shapes', () => {
    const v = phoneVariants('9876543210');
    expect(v[0]).toBe('+919876543210');
    expect(v).toEqual(expect.arrayContaining(['9876543210', '919876543210', '09876543210']));
  });
  it('a login for either form resolves to the same candidate set', () => {
    expect(new Set(phoneVariants('+919876543210'))).toEqual(new Set(phoneVariants('9876543210')));
  });
  it('an uncanonicalisable value still looks itself up (never stranded)', () => {
    expect(phoneVariants('notaphone')).toEqual(['notaphone']);
  });
  it('is safe on empty input', () => {
    expect(phoneVariants('')).toEqual([]);
  });
});
