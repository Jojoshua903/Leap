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

  it('only bowling is playable for now', () => {
    for (const m of allModes()) expect(m.status === 'playable').toBe(m.sport === 'bowling');
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
