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
 */

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

/**
 * Why the groups can't be drawn with `teams` teams, or null when they can.
 * BUILD 1.12: the group size is a cap — no group is drawn bigger than it.
 */
export function groupsDrawRefusal(teams: number, cfg: GroupsConfig = {}): string | null {
  if (teams < 2) return 'Need at least 2 approved teams to draw the groups.';
  const groups = groupCount(teams, cfg);
  const biggest = Math.ceil(teams / groups);
  if (cfg.groupSize != null && biggest > cfg.groupSize) {
    return `${teams} teams in ${groups} groups makes groups of ${biggest}, more than the group size of ${cfg.groupSize}.`;
  }
  if (Math.floor(teams / groups) < 2) {
    return cfg.numGroups != null
      ? `Each group needs at least 2 teams, so ${groups} groups need at least ${groups * 2} teams (${teams} approved).`
      : `${teams} teams can't make groups of at most ${cfg.groupSize ?? DEFAULT_GROUP_SIZE} with at least 2 in each.`;
  }
  return null;
}
