/**
 * BUILD 1.10 · how a groups → knockout draw splits the teams — ONE rule for
 * the app and the server.
 *
 * This file is byte-identical in both repos:
 *   app     src/tournament/groupsPlan.ts
 *   server  src/utils/groupsPlan.ts
 * and `__tests__/groupsPlanParity.test.ts` (app) fails if they differ. Edit
 * both, or neither.
 *
 * The app asked for 4 teams and the server for 2, and neither was the rule.
 * With the default grouping (groups of up to 4, top 2 through) two or three
 * teams make one group and then a final, which finishes. What can't finish is
 * a group of one: it has no matches, so the knockout is never seeded and the
 * tournament stays live for ever (2 teams in 2 groups, say). So: every group
 * needs at least 2 teams, and (BUILD 1.12) none has more than the group size.
 * More qualifiers than a group holds is fine — the empty places are byes.
 * (BUILD 1.13) A group the organiser put a team in is kept.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type GroupsConfig = {
  numGroups?: number | null;
  groupSize?: number | null;
};

/** Teams per group when the organiser didn't set a group count. */
export const DEFAULT_GROUP_SIZE = 4;

/**
 * How many groups `teams` teams are drawn into (the server's draw uses this;
 * it deals the teams round the groups, so sizes differ by at most one). A
 * group count the organiser set is used as set; otherwise the fewest groups
 * that keep every group within the group size.
 */
export function groupCount(teams: number, cfg: GroupsConfig = {}): number {
  if (cfg.numGroups != null) return Math.min(teams, Math.max(1, cfg.numGroups));
  const size = Math.max(1, cfg.groupSize ?? DEFAULT_GROUP_SIZE);
  return Math.max(1, Math.ceil(teams / size));
}

/** The fewest approved teams the groups can be drawn with. */
export function minTeamsForDraw(cfg: GroupsConfig = {}): number {
  return cfg.numGroups != null ? 2 * Math.max(1, cfg.numGroups) : 2;
}

/** A team going into the draw, with the group the organiser put it in, if any. */
export type GroupEntry = { id: string; label?: string | null };

export type GroupsPlan =
  | { ok: true; groups: Array<{ label: string; ids: string[] }> }
  | { ok: false; refusal: string };

const normLabel = (l: string | null | undefined): string | null => {
  const t = String(l ?? '').trim().toUpperCase();
  return t.length > 0 ? t : null;
};

/**
 * The groups, team by team (the server's draw builds them from this).
 *
 * BUILD 1.13: a group the organiser gave a team is kept. The draw dealt every
 * team round the groups A, B, C… and overwrote it. Teams without one fill the
 * smallest group, in draw order — with no labels at all that is exactly the
 * old dealing, so an unlabelled draw comes out the same as before.
 *
 * Every group needs at least 2 teams and (BUILD 1.12) no more than the group
 * size. Labels are compared in capitals, so "a" is group A.
 */
export function planGroups(entries: GroupEntry[], cfg: GroupsConfig = {}): GroupsPlan {
  const teams = entries.length;
  if (teams < 2) return { ok: false, refusal: 'Need at least 2 approved teams to draw the groups.' };
  const named = [...new Set(entries.map((e) => normLabel(e.label)).filter((l): l is string => l !== null))].sort();
  if (cfg.numGroups != null && named.length > cfg.numGroups) {
    return { ok: false, refusal: `Teams are placed in ${plural(named.length, 'group', 'groups')} (${named.join(', ')}), but the tournament has ${cfg.numGroups}.` };
  }
  const count = Math.max(groupCount(teams, cfg), named.length);
  const labels = [...named];
  for (let c = 0; labels.length < count && c < 26; c++) {
    const l = String.fromCharCode(65 + c);
    if (!labels.includes(l)) labels.push(l);
  }
  labels.sort();
  const groups = labels.map((label) => ({ label, ids: [] as string[] }));
  const byLabel = new Map(groups.map((g) => [g.label, g]));
  for (const e of entries) {
    const l = normLabel(e.label);
    if (l) byLabel.get(l)!.ids.push(e.id);
  }
  for (const e of entries) {
    if (normLabel(e.label)) continue;
    let target = groups[0]!;
    for (const g of groups) if (g.ids.length < target.ids.length) target = g;
    target.ids.push(e.id);
  }
  const cap = cfg.groupSize;
  const over = cap != null ? groups.find((g) => g.ids.length > cap) : undefined;
  if (over) {
    if (named.length === 0) {
      return { ok: false, refusal: `${plural(teams, 'team', 'teams')} in ${plural(groups.length, 'group', 'groups')} makes groups of ${over.ids.length}, more than the group size of ${cap}.` };
    }
    return { ok: false, refusal: `Group ${over.label} has ${over.ids.length} teams, more than the group size of ${cap}.` };
  }
  const short = groups.find((g) => g.ids.length < 2);
  if (short) {
    if (named.length > 0) return { ok: false, refusal: `Group ${short.label} has ${short.ids.length} team${short.ids.length === 1 ? '' : 's'}; every group needs at least 2.` };
    return {
      ok: false,
      refusal: cfg.numGroups != null
        ? `Each group needs at least 2 teams, so ${plural(groups.length, 'group', 'groups')} need${groups.length === 1 ? 's' : ''} at least ${groups.length * 2} teams (${teams} approved).`
        : `${plural(teams, 'team', 'teams')} can't make groups of at most ${cfg.groupSize ?? DEFAULT_GROUP_SIZE} with at least 2 in each.`,
    };
  }
  return { ok: true, groups };
}

/**
 * Why the groups can't be drawn, or null when they can — for a count of
 * unlabelled teams, or for the entries themselves (with their groups).
 */
export function groupsDrawRefusal(teams: number | GroupEntry[], cfg: GroupsConfig = {}): string | null {
  const entries = typeof teams === 'number' ? Array.from({ length: Math.max(0, teams) }, (_, i) => ({ id: String(i) })) : teams;
  const plan = planGroups(entries, cfg);
  return plan.ok ? null : plan.refusal;
}
