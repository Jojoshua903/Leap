import type { Profile } from '../save/types';
import { levelFromXp } from './xp';

/**
 * Unlockable cosmetics. Ids are `<category>:<value>`. Earned unlocks are stored on the profile
 * (so they are never taken away), and `isUnlocked` also accepts defaults. Guests only get defaults.
 * Other sports add items with `registerUnlock`.
 */
export type UnlockCategory = 'lane' | 'ball' | 'trail' | 'hair' | 'top' | 'acc';
export type Requirement =
  | { type: 'default' }
  | { type: 'level'; n: number }
  | { type: 'games'; sport: string; n: number }
  | { type: 'achievement'; id: string };

export interface UnlockDef { id: string; category: UnlockCategory; value: string; labelKey: string; req: Requirement }

const DEFS: UnlockDef[] = [];
const d = (category: UnlockCategory, value: string, labelKey: string, req: Requirement) =>
  DEFS.push({ id: `${category}:${value}`, category, value, labelKey, req });

// Lane looks
d('lane', 'classic', 'look.classic', { type: 'default' });
d('lane', 'neon', 'look.neon', { type: 'level', n: 3 });
d('lane', 'sunset', 'look.sunset', { type: 'games', sport: 'bowling', n: 5 });
// Ball skins
d('ball', 'solid', 'ballskin.solid', { type: 'default' });
d('ball', 'stripes', 'ballskin.stripes', { type: 'default' });
d('ball', 'galaxy', 'ballskin.galaxy', { type: 'level', n: 5 });
d('ball', 'marble', 'ballskin.marble', { type: 'games', sport: 'bowling', n: 10 });
d('ball', 'flame', 'ballskin.flame', { type: 'achievement', id: 'turkey' });
// Trails
d('trail', 'classic', 'trail.classic', { type: 'default' });
d('trail', 'sparkle', 'trail.sparkle', { type: 'level', n: 2 });
d('trail', 'rainbow', 'trail.rainbow', { type: 'achievement', id: 'hook_master' });
d('trail', 'fire', 'trail.fire', { type: 'achievement', id: 'score_200' });
// Buddy items (everything not listed here is available from the start)
d('hair', '6', 'hair.6', { type: 'level', n: 4 });
d('hair', '7', 'hair.7', { type: 'achievement', id: 'ten_games' });
d('top', '6', 'top.6', { type: 'level', n: 6 });
d('top', '7', 'top.7', { type: 'achievement', id: 'comeback' });
d('acc', 'hat', 'acc.hat', { type: 'level', n: 2 });
d('acc', 'headband', 'acc.headband', { type: 'achievement', id: 'first_strike' });

export function registerUnlock(def: UnlockDef): void {
  if (!DEFS.some(x => x.id === def.id)) DEFS.push(def);
}

export const allUnlocks = (): readonly UnlockDef[] => DEFS;
export const unlocksIn = (c: UnlockCategory): UnlockDef[] => DEFS.filter(x => x.category === c);
export const getUnlock = (id: string): UnlockDef | undefined => DEFS.find(x => x.id === id);

function gamesIn(p: Profile, sport: string): number {
  return Object.values(p.stats[sport] ?? {}).reduce((s, m) => s + m.gamesPlayed, 0);
}

export function meets(p: Profile | null, req: Requirement): boolean {
  if (req.type === 'default') return true;
  if (!p) return false;
  switch (req.type) {
    case 'level': return levelFromXp(p.xp).level >= req.n;
    case 'games': return gamesIn(p, req.sport) >= req.n;
    case 'achievement': return req.id in p.achievements;
  }
}

/** Items with no definition (e.g. hair 0–5) are free. */
export function isUnlocked(p: Profile | null, id: string): boolean {
  const def = getUnlock(id);
  if (!def) return true;
  if (def.req.type === 'default') return true;
  return !!p && (p.unlocked.includes(id) || meets(p, def.req));
}

/** Adds every newly met unlock to the profile and returns their ids. */
export function grantUnlocks(p: Profile): string[] {
  const fresh: string[] = [];
  for (const def of DEFS) {
    if (def.req.type === 'default' || p.unlocked.includes(def.id)) continue;
    if (meets(p, def.req)) { p.unlocked.push(def.id); fresh.push(def.id); }
  }
  return fresh;
}
