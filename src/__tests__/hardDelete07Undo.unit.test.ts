/**
 * Hard-delete list #7 (27 Sep 2026) · an undo (and an editor's delete) of a
 * scoring event is logged first — who, when, the whole event — and the log
 * row outlives the event (migration 107).
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let insertError: unknown = null;
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      q.eq = rec('eq');
      q.insert = (...args: unknown[]) => { calls.push({ table, op: 'insert', args }); return Promise.resolve({ error: insertError }); };
      q.delete = (...args: unknown[]) => { calls.push({ table, op: 'delete', args }); return q; };
      q.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import { logThenDeleteEvent } from '../utils/scoringAudit';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};
const EVENT = { id: 'e1', match_id: 'm1', event_type: 'ball', payload: { runs: 4 }, created_by: 'u1', created_at: 't' };

beforeEach(() => { calls.length = 0; insertError = null; });

describe('logThenDeleteEvent', () => {
  test('writes who, the action and the whole old event — then deletes', async () => {
    expect(await logThenDeleteEvent(EVENT, 'u1', 'undo')).toEqual({});
    const order = calls.filter((c) => c.op === 'insert' || c.op === 'delete').map((c) => `${c.op}:${c.table}`);
    expect(order).toEqual(['insert:match_event_audit', 'delete:match_events']);
    expect(calls[0].args[0]).toEqual({ event_id: 'e1', match_id: 'm1', changed_by: 'u1', old_payload: EVENT, new_payload: {}, action: 'undo' });
  });
  test('no log row → nothing deleted', async () => {
    insertError = { message: 'check violation' };
    const r = await logThenDeleteEvent(EVENT, 'u1', 'undo');
    expect(r.error).toMatch(/nothing was removed/);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });
});

describe('both removal paths use it', () => {
  test('POST /scoring/:matchId/undo: logs "undo" with the full row; a finished match is still refused', () => {
    const f = fnBody('controllers/scoring.controller.ts', 'undoEvent');
    expect(f).toMatch(/\.select\('\*'\)/);
    expect(f).toMatch(/logThenDeleteEvent\(latest as \{ id: string; match_id: string \}, userId, 'undo'\)/);
    expect(f).not.toMatch(/from\('match_events'\)\.delete\(\)/);
    expect(f.indexOf('isTerminalMatchStatus(auth.match.status)')).toBeLessThan(f.indexOf('logThenDeleteEvent'));
    expect(f).toMatch(/This match is finished and can no longer be edited/);
  });
  test('DELETE /matches/:id/events/:eventId: logs "delete" with the full row (it logged only the payload, and lost it)', () => {
    const f = fnBody('controllers/matchFeatures.controller.ts', 'deleteMatchEvent');
    expect(f).toMatch(/logThenDeleteEvent\(event as \{ id: string; match_id: string \}, userId, 'delete'\)/);
    expect(f).not.toMatch(/old_payload: event\.payload/);
  });
});

describe('migration 107', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '107_scoring_audit_survives.sql'), 'utf8');
  test('the log row outlives its event, and "undo" is allowed', () => {
    expect(sql).toMatch(/ALTER COLUMN event_id DROP NOT NULL/);
    expect(sql).toMatch(/FOREIGN KEY \(event_id\) REFERENCES match_events\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/CHECK \(action IN \('edit', 'delete', 'undo'\)\)/);
    expect(sql).toMatch(/idx_match_event_audit_match/);
  });
  test('it replaces constraints only — no row is deleted', () => {
    const body = sql.replace(/--.*$/gm, '').replace(/ON DELETE SET NULL/g, '').replace(/DROP CONSTRAINT/g, '').replace(/DROP NOT NULL/g, '')
      .replace(/'delete'/g, '');
    expect(body).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
  test('before it, the delete log was cascaded away (why 107 exists)', () => {
    const s021 = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '021_cricheroes_parity.sql'), 'utf8');
    expect(s021).toMatch(/event_id UUID NOT NULL REFERENCES match_events\(id\) ON DELETE CASCADE/);
  });
});

describe('no view of the log exists yet (not built, as decided)', () => {
  test('nothing reads match_event_audit (control: two writers)', () => {
    const src = path.join(__dirname, '..');
    const files = ['controllers', 'utils', 'routes'].flatMap((d) =>
      fs.readdirSync(path.join(src, d)).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(src, d, f), 'utf8')));
    const all = files.join('\n');
    expect(all).not.toMatch(/from\('match_event_audit'\)\s*\.select/);
    expect((all.match(/from\('match_event_audit'\)\.insert/g) ?? []).length).toBe(2);
  });
});
