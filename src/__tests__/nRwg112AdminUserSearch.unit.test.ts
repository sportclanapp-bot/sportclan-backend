/**
 * N-RWG1-12 (launch test plan) · Admin › Users says 'Search name, @username, or phone…'
 * and shows '@username · +91 98765 43210', but the box text went to one ILIKE as typed,
 * so '@name' or a number typed the way the screen shows it found nobody.
 */
import * as admin from '../controllers/admin.controller';

jest.mock('../utils/supabase', () => ({ supabase: {} }));

// Loosely typed so the file also compiles against the code before the fix (the proof run).
const adminUserSearchFilter = (q: string): string => {
  const f = (admin as unknown as { adminUserSearchFilter?: (q: string) => string }).adminUserSearchFilter;
  expect(typeof f).toBe('function');
  return f!(q);
};

it("'@name' searches the username without the @", () => {
  expect(adminUserSearchFilter('@qa_device_a')).toContain('username.ilike."%qa\\\\_device\\\\_a%"');
});

it('a spaced +91 number searches the phone by its 10 digits', () => {
  const f = adminUserSearchFilter('+91 98765 43210');
  expect(f).toContain('phone.ilike."%9876543210%"');
});

it('part of a number, with spaces or dashes, searches its digits', () => {
  expect(adminUserSearchFilter('98765 432')).toContain('phone.ilike."%98765432%"');
  expect(adminUserSearchFilter('987-65')).toContain('phone.ilike."%98765%"');
});

it('a name is still searched as typed, and stays injection-safe', () => {
  const f = adminUserSearchFilter('Smith, John');
  expect(f).toContain('name.ilike."%Smith, John%"');
  expect(f).toContain('username.ilike."%Smith, John%"');
  expect(f.split(',').filter((x) => x.includes('.ilike.')).length).toBe(3);
});
