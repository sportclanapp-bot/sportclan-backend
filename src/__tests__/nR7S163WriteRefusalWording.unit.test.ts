/**
 * N-R7-S163 (case:REG-014): a write refused because ANOTHER person holds the scoring lease (a typed
 * 'Score from the sheet', a match feature, a scoring event from a phone that never held it) said
 * 'Someone else took over scoring this match.' — untrue for a phone that never scored it. Every write
 * refusal now says what is true for every caller: 'Someone else is scoring this match.' The heartbeat
 * (only the holder sends one, so it really was taken over) keeps 'took over'.
 */
import fs from 'fs';
import path from 'path';
import { leaseRefusal } from '../utils/leaseCore';

describe('N-R7-S163 · a refused write says someone else IS scoring', () => {
  test('another person holds the lease', () => {
    expect(leaseRefusal({ code: 'LEASE_LOST', lease: { user_id: 'someone' } }, 'me')).toEqual({
      error: 'Someone else is scoring this match.', code: 'LEASE_LOST',
    });
    expect(leaseRefusal({ code: 'LEASE_LOST', lease: null }).error).toBe('Someone else is scoring this match.');
  });
  test('own other phone and DEVICE_REQUIRED unchanged', () => {
    expect(leaseRefusal({ code: 'LEASE_LOST', lease: { user_id: 'me' } }, 'me').error).toBe('Your other phone is scoring this match.');
    expect(leaseRefusal({ code: 'DEVICE_REQUIRED' }, 'me').code).toBe('DEVICE_REQUIRED');
  });
  test('the heartbeat (the holder displaced) still says took over', () => {
    const m = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect(m).toContain("error: 'Someone else took over scoring this match.',");
  });
});
