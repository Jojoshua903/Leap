import { describe, expect, it } from 'vitest';
import { SPORTS, allModes, defaultOptions, getMode } from './registry';
import { en } from '../i18n/en';
import { nl } from '../i18n/nl';

const enKeys = new Set(Object.keys(en));
const nlKeys = new Set(Object.keys(nl));

describe('sports registry', () => {
  it('has the 6 sports from the menu, in menu order', () => {
    expect(SPORTS.map(s => s.id)).toEqual(['swordplay', 'airsports', 'bowling', 'basketball', 'tabletennis', 'frisbee']);
  });

  it('lists every mode from the menu', () => {
    expect(allModes().map(m => `${m.sport}/${m.id}`)).toEqual([
      'swordplay/duel', 'swordplay/speedSlice', 'swordplay/showdown',
      'airsports/islandFlyover', 'airsports/dogfight', 'airsports/skydiving',
      'bowling/standard', 'bowling/hundred',
      'basketball/threePoint', 'basketball/pickup',
      'tabletennis/matchPlay', 'tabletennis/returnChallenge',
      'frisbee/frisbeeDog', 'frisbee/frisbeeGolf'
    ]);
  });

  it('every mode has valid fields', () => {
    const ids = new Set<string>();
    for (const m of allModes()) {
      const key = `${m.sport}/${m.id}`;
      expect(ids.has(key), key).toBe(false);
      ids.add(key);
      expect(m.minPlayers).toBeGreaterThanOrEqual(1);
      expect(m.maxPlayers).toBeGreaterThanOrEqual(m.minPlayers);
      expect(m.maxPlayers).toBeLessThanOrEqual(4);
      expect(m.controllers.length).toBeGreaterThan(0);
      expect(['playable', 'comingSoon']).toContain(m.status);
      // playable modes must have a scene; coming-soon modes must not pretend to
      if (m.status === 'playable') expect(typeof m.scene).toBe('function');
      else expect(m.scene).toBeNull();
      for (const o of m.options) {
        expect(o.choices.some(c => c.value === o.default), `${key} option ${o.id}`).toBe(true);
      }
    }
  });

  it('swordplay, bowling, basketball, table tennis and frisbee are playable, the rest is coming soon', () => {
    const live = ['swordplay', 'bowling', 'basketball', 'tabletennis', 'frisbee'];
    for (const m of allModes()) expect(m.status === 'playable').toBe(live.includes(m.sport));
  });

  it('swordplay: duel 1–2 (split, AI level 1–5), speed slice 1–4 with practice, showdown solo', () => {
    const du = getMode('swordplay', 'duel'), ss = getMode('swordplay', 'speedSlice'), sd = getMode('swordplay', 'showdown');
    expect([du.minPlayers, du.maxPlayers, du.splitControllers, du.practice]).toEqual([1, 2, true, false]);
    expect([ss.minPlayers, ss.maxPlayers, ss.practice]).toEqual([1, 4, true]);
    expect([sd.minPlayers, sd.maxPlayers, sd.practice]).toEqual([1, 1, false]);
    expect(defaultOptions(du)).toEqual({ rounds: 3, ai: 2 });
    expect(du.options.find(o => o.id === 'ai')!.choices.map(c => c.value)).toEqual([1, 2, 3, 4, 5]);
    expect(du.cosmetics).toEqual(['blade', 'bladeTrail', 'arena', 'outfit']);
  });

  it('basketball: contest for 1–4 with a money-rack option, pickup solo to 11 or 21', () => {
    const tp = getMode('basketball', 'threePoint'), pu = getMode('basketball', 'pickup');
    expect([tp.minPlayers, tp.maxPlayers, tp.practice]).toEqual([1, 4, true]);
    expect([pu.minPlayers, pu.maxPlayers, pu.practice]).toEqual([1, 1, false]);
    expect(defaultOptions(tp)).toEqual({ moneyRack: false });
    expect(defaultOptions(pu)).toEqual({ target: 11, difficulty: 'normal' });
    expect(tp.cosmetics).toEqual(['hoopball', 'jersey', 'net', 'court']);
  });

  it('table tennis: match play for 1–2 with split controllers, return challenge solo', () => {
    const mp = getMode('tabletennis', 'matchPlay'), rc = getMode('tabletennis', 'returnChallenge');
    expect([mp.minPlayers, mp.maxPlayers, mp.splitControllers]).toEqual([1, 2, true]);
    expect([rc.minPlayers, rc.maxPlayers]).toEqual([1, 1]);
    expect(defaultOptions(mp)).toEqual({ games: 3, ai: 1 });
    expect(mp.cosmetics).toEqual(['paddle', 'table', 'hall']);
  });

  it('frisbee: dog and golf for 1–4 with practice, golf aim aid Short by default', () => {
    const dog = getMode('frisbee', 'frisbeeDog'), golf = getMode('frisbee', 'frisbeeGolf');
    expect([dog.minPlayers, dog.maxPlayers, dog.practice]).toEqual([1, 4, true]);
    expect([golf.minPlayers, golf.maxPlayers, golf.practice]).toEqual([1, 4, true]);
    expect(dog.cosmetics).toEqual(['dog', 'disc', 'discTrail']);
    expect(golf.cosmetics).toEqual(['course', 'disc', 'discTrail']);
    expect(defaultOptions(golf)).toEqual({ aids: 'short' });
  });

  it('every sport has an accent colour and icon', () => {
    for (const s of SPORTS) {
      expect(s.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.icon).toBe(s.id);
    }
  });

  it('every i18n key used by the registry exists in English and Dutch', () => {
    const keys: string[] = [];
    for (const s of SPORTS) {
      keys.push(s.nameKey, s.descKey);
      for (const m of s.modes) {
        keys.push(m.nameKey, m.descKey, m.rulesKey);
        for (const o of m.options) keys.push(o.labelKey, ...o.choices.map(c => c.labelKey));
      }
    }
    for (const k of keys) {
      expect(enKeys.has(k), `en: ${k}`).toBe(true);
      expect(nlKeys.has(k), `nl: ${k}`).toBe(true);
    }
  });

  it('English and Dutch have exactly the same keys and placeholders', () => {
    expect([...nlKeys].sort()).toEqual([...enKeys].sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of enKeys) expect(ph(nl[k as keyof typeof nl]), k).toBe(ph(en[k as keyof typeof en]));
  });

  it('default options for bowling', () => {
    expect(defaultOptions(getMode('bowling', 'standard'))).toEqual({ frames: 10, handicap: false });
  });

  it('unknown modes throw instead of returning junk', () => {
    expect(() => getMode('bowling', 'duel')).toThrow();
  });
});
