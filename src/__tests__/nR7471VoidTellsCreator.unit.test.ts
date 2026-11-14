/**
 * N-R7-471 (RW-G3-027, Step 2 Batch 14 B26 on emulator-5560): the umpire voided a casual match that QA A
 * created but did not play in; QA A was never told (the void / restore notice went only to the players and
 * the two teams' members). The match's creator now hears about a void and a restore by someone else too.
 */
import fs from 'fs';
import path from 'path';
import { withMatchCreator } from '../utils/notify';

describe('N-R7-471 · the creator is in the void / restore audience', () => {
  it('adds the creator once, never twice, and skips a missing one', () => {
    expect(withMatchCreator(['p1', 'p2'], 'c1').sort()).toEqual(['c1', 'p1', 'p2']);
    expect(withMatchCreator(['c1', 'p1'], 'c1').sort()).toEqual(['c1', 'p1']);
    expect(withMatchCreator(['p1'], null)).toEqual(['p1']);
  });
  it('the void and the restore both use it', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
    const voidBody = src.slice(src.indexOf('export async function voidMatch'), src.indexOf('export async function unvoidMatch'));
    const unvoidBody = src.slice(src.indexOf('export async function unvoidMatch'), src.indexOf('export async function unvoidMatch') + 12000);
    for (const b of [voidBody, unvoidBody]) expect(b).toContain('withMatchCreator(await matchAudienceIds(id, match.team_a_id, match.team_b_id), match.created_by)');
  });
});
