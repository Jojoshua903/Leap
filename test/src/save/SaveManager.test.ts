import { describe, expect, it } from 'vitest';
import { MemoryStorage, SaveManager, type StorageLike } from './SaveManager';
import { migrate } from './migrations';
import { STORAGE_KEY, SCHEMA_VERSION } from './types';
import { defaultBuddy } from '../buddy/BuddyConfig';

/** Storage that refuses every write, like Safari private mode or a full quota. */
class BrokenStorage implements StorageLike {
  getItem(): string | null { return null; }
  setItem(): void { throw new Error('QuotaExceededError'); }
  removeItem(): void { /* nothing */ }
}

/** Storage that works until it fills up. */
class FillingStorage extends MemoryStorage {
  full = false;
  setItem(k: string, v: string): void { if (this.full) throw new Error('QuotaExceededError'); super.setItem(k, v); }
}

describe('SaveManager', () => {
  it('round-trips profiles, stats and settings through storage', () => {
    const store = new MemoryStorage();
    const a = new SaveManager(store);
    const p = a.createProfile(defaultBuddy('Sunny', 3))!;
    a.updateProfile(p.id, pr => {
      pr.xp = 420;
      pr.stats.bowling = { standard: { gamesPlayed: 2, bestScore: 180, totalScore: 300, extras: { strikes: 5 } } };
      pr.achievements.turkey = 123;
    });
    a.setActive(p.id);
    a.setGlobalSettings({ language: 'nl', master: 0.3 });

    const b = new SaveManager(store);
    expect(b.persistent).toBe(true);
    expect(b.profiles).toHaveLength(1);
    expect(b.active?.name).toBe('Sunny');
    expect(b.active?.xp).toBe(420);
    expect(b.active?.stats.bowling.standard.extras.strikes).toBe(5);
    expect(b.active?.achievements.turkey).toBe(123);
    expect(b.globalSettings.language).toBe('nl');
    expect(b.globalSettings.master).toBe(0.3);
    expect(JSON.parse(store.getItem(STORAGE_KEY)!).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('allows at most 4 profiles', () => {
    const s = new SaveManager(new MemoryStorage());
    for (let i = 0; i < 4; i++) expect(s.createProfile(defaultBuddy(`P${i}`))).not.toBeNull();
    expect(s.isFull).toBe(true);
    expect(s.createProfile(defaultBuddy('Five'))).toBeNull();
  });

  it('migrates a v0 save (no schemaVersion, missing fields)', () => {
    const d = migrate({ profiles: [{ name: 'Old', xp: 50 }], settings: { language: 'nl', master: 7 } });
    expect(d.schemaVersion).toBe(1);
    expect(d.profiles[0].name).toBe('Old');
    expect(d.profiles[0].buddy.name).toBe('Old');
    expect(d.profiles[0].xp).toBe(50);
    expect(d.profiles[0].stats).toEqual({});
    expect(d.settings.language).toBe('nl');
    expect(d.settings.master).toBe(1);                 // clamped
    expect(d.settings.backend).toBe('mouse');          // filled in
  });

  it('imports phase 1 player names', () => {
    const store = new MemoryStorage();
    store.setItem('bb_players_v1', JSON.stringify({ count: 2, names: ['Noor', 'Player 2'] }));
    const s = new SaveManager(store);
    expect(s.profiles.map(p => p.name)).toEqual(['Noor']);
  });

  it('keeps a corrupt save as a backup and starts fresh', () => {
    const store = new MemoryStorage();
    store.setItem(STORAGE_KEY, '{not json');
    const s = new SaveManager(store);
    expect(s.profiles).toHaveLength(0);
    expect(store.getItem(`${STORAGE_KEY}.backup`)).toBe('{not json');
  });

  it('export → import gives the same profile under a new id', () => {
    const s = new SaveManager(new MemoryStorage());
    const p = s.createProfile(defaultBuddy('Kai', 5))!;
    s.updateProfile(p.id, pr => { pr.xp = 999; pr.unlocked.push('lane:neon'); });
    const json = s.exportProfile(p.id)!;
    const res = s.importProfile(json);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.profile.id).not.toBe(p.id);
    expect(res.profile.name).toBe('Kai');
    expect(res.profile.xp).toBe(999);
    expect(res.profile.unlocked).toContain('lane:neon');
  });

  it('rejects corrupt imports with clear error keys', () => {
    const s = new SaveManager(new MemoryStorage());
    expect(s.importProfile('{oops')).toEqual({ ok: false, error: 'error.import.json' });
    expect(s.importProfile('42')).toEqual({ ok: false, error: 'error.import.shape' });
    expect(s.importProfile(JSON.stringify({ hello: 'world' }))).toEqual({ ok: false, error: 'error.import.shape' });
    expect(s.importProfile(JSON.stringify({ kind: 'breezyIsle.profile', schemaVersion: 99, profile: {} }))).toEqual({ ok: false, error: 'error.import.version' });
    expect(s.importProfile(JSON.stringify({ name: 'fuck' }))).toEqual({ ok: false, error: 'error.import.shape' });
  });

  it('import fails cleanly when all slots are taken', () => {
    const s = new SaveManager(new MemoryStorage());
    for (let i = 0; i < 4; i++) s.createProfile(defaultBuddy(`P${i}`));
    const json = s.exportProfile(s.profiles[0].id)!;
    expect(s.importProfile(json)).toEqual({ ok: false, error: 'error.import.full' });
  });

  it('falls back to memory with a warning when storage is unavailable', () => {
    const s = new SaveManager(new BrokenStorage());
    expect(s.persistent).toBe(false);
    expect(s.warning).toBe('profile.storageWarning');
    const p = s.createProfile(defaultBuddy('Mem'));
    expect(p).not.toBeNull();
    expect(s.profiles).toHaveLength(1);
  });

  it('switches to memory when storage fills up mid-game', () => {
    const store = new FillingStorage();
    const s = new SaveManager(store);
    s.createProfile(defaultBuddy('A'));
    store.full = true;
    expect(s.createProfile(defaultBuddy('B'))).not.toBeNull();
    expect(s.persistent).toBe(false);
    expect(s.warning).toBe('error.storageFull');
    expect(s.profiles).toHaveLength(2);
  });

  it('deleting the active profile clears it', () => {
    const s = new SaveManager(new MemoryStorage());
    const p = s.createProfile(defaultBuddy('Bye'))!;
    s.setActive(p.id);
    s.deleteProfile(p.id);
    expect(s.active).toBeNull();
    expect(s.profiles).toHaveLength(0);
  });
});
