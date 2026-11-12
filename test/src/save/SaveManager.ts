import type { BuddyConfig } from '../buddy/BuddyConfig';
import {
  fromLegacyPlayers, migrate, MigrationError, emptySave, newProfile, newProfileId, sanitizeProfile, sanitizeSettings
} from './migrations';
import { MAX_PROFILES, SCHEMA_VERSION, STORAGE_KEY, type Profile, type ProfileExport, type SaveData, type SettingsData } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

export type ImportError = 'error.import.json' | 'error.import.shape' | 'error.import.version' | 'error.import.full';
export type ImportResult = { ok: true; profile: Profile } | { ok: false; error: ImportError };

const LEGACY_PLAYERS = 'bb_players_v1';
const LEGACY_TUTORIAL = 'bb_tutorial_done_v1';

/** Probe a storage by writing and removing a key. Private mode Safari and blocked cookies throw here. */
function usable(s: StorageLike | null | undefined): s is StorageLike {
  if (!s) return false;
  try { const k = '__breezy_probe__'; s.setItem(k, '1'); s.removeItem(k); return true; } catch { return false; }
}

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * The single owner of saved data: everything lives under one versioned key.
 * When storage is unavailable (or fills up) it keeps working in memory and sets `warning`
 * so the UI can tell the player progress won't survive closing the tab.
 */
export class SaveManager {
  data: SaveData = emptySave();
  persistent = true;
  /** i18n key of a storage problem to show the player, or null. */
  warning: 'profile.storageWarning' | 'error.storageFull' | null = null;
  private storage: StorageLike;
  private listeners = new Set<() => void>();

  constructor(storage: StorageLike | null | undefined = defaultStorage()) {
    if (usable(storage)) this.storage = storage;
    else { this.storage = new MemoryStorage(); this.persistent = false; this.warning = 'profile.storageWarning'; }
    this.load();
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed(): void { for (const fn of [...this.listeners]) fn(); }

  load(): void {
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { raw = null; }
    if (raw === null) {
      this.data = emptySave();
      this.importLegacy();
      return;
    }
    try {
      this.data = migrate(JSON.parse(raw));
      if (this.data.schemaVersion !== SCHEMA_VERSION) this.data.schemaVersion = SCHEMA_VERSION;
    } catch (e) {
      // Corrupt or from a newer build: keep a copy rather than overwrite it, and start fresh.
      console.warn('Save could not be read, starting fresh', e);
      try { this.storage.setItem(`${STORAGE_KEY}.backup`, raw); } catch { /* ignore */ }
      this.data = emptySave();
    }
  }

  private importLegacy(): void {
    try {
      const players = this.storage.getItem(LEGACY_PLAYERS);
      if (players) this.data.profiles = fromLegacyPlayers(JSON.parse(players));
      if (this.storage.getItem(LEGACY_TUTORIAL)) this.data.settings.tutorialSeen = true;
      if (players || this.data.settings.tutorialSeen) this.save();
    } catch { /* legacy data is optional */ }
  }

  save(): boolean {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.changed();
      return true;
    } catch (e) {
      console.warn('Saving failed, continuing in memory', e);
      const mem = new MemoryStorage();
      mem.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.storage = mem;
      this.persistent = false;
      this.warning = 'error.storageFull';
      this.changed();
      return false;
    }
  }

  /* ---------------- profiles ---------------- */

  get profiles(): readonly Profile[] { return this.data.profiles; }
  get active(): Profile | null { return this.data.profiles.find(p => p.id === this.data.activeProfileId) ?? null; }
  get isFull(): boolean { return this.data.profiles.length >= MAX_PROFILES; }
  get(id: string | null): Profile | null { return id ? this.data.profiles.find(p => p.id === id) ?? null : null; }

  setActive(id: string | null): void {
    this.data.activeProfileId = id && this.get(id) ? id : null;
    this.save();
  }

  createProfile(buddy: BuddyConfig): Profile | null {
    if (this.isFull) return null;
    const p = newProfile(buddy.name, this.data.profiles.length, buddy);
    this.data.profiles.push(p);
    this.save();
    return p;
  }

  updateProfile(id: string, fn: (p: Profile) => void): void {
    const p = this.get(id);
    if (!p) return;
    fn(p);
    p.name = p.buddy.name;
    this.save();
  }

  deleteProfile(id: string): void {
    this.data.profiles = this.data.profiles.filter(p => p.id !== id);
    if (this.data.activeProfileId === id) this.data.activeProfileId = null;
    this.save();
  }

  exportProfile(id: string): string | null {
    const p = this.get(id);
    if (!p) return null;
    const out: ProfileExport = { kind: 'breezyIsle.profile', schemaVersion: SCHEMA_VERSION, profile: p };
    return JSON.stringify(out, null, 2);
  }

  /** Accepts an export file, or a bare profile object. Imported profiles get a fresh id if it clashes. */
  importProfile(json: string): ImportResult {
    let raw: unknown;
    try { raw = JSON.parse(json); } catch { return { ok: false, error: 'error.import.json' }; }
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'error.import.shape' };
    const o = raw as Record<string, unknown>;
    let profileRaw: unknown = o;
    if (o.kind === 'breezyIsle.profile') {
      const v = typeof o.schemaVersion === 'number' ? o.schemaVersion : 0;
      if (v > SCHEMA_VERSION) return { ok: false, error: 'error.import.version' };
      // Run the same migrations as full saves by wrapping the profile in a save shell.
      try { profileRaw = migrate({ schemaVersion: v, profiles: [o.profile], activeProfileId: null, settings: {} }).profiles[0]; }
      catch (e) { return { ok: false, error: e instanceof MigrationError ? e.key : 'error.import.shape' }; }
    }
    const p = sanitizeProfile(profileRaw);
    if (!p) return { ok: false, error: 'error.import.shape' };
    if (this.isFull) return { ok: false, error: 'error.import.full' };
    if (this.get(p.id)) p.id = newProfileId();
    this.data.profiles.push(p);
    this.save();
    return { ok: true, profile: p };
  }

  /* ---------------- settings ---------------- */

  get globalSettings(): SettingsData { return this.data.settings; }

  setGlobalSettings(patch: Partial<SettingsData>): void {
    this.data.settings = sanitizeSettings({ ...this.data.settings, ...patch }, this.data.settings);
    this.save();
  }

  /** Wipe everything (used by tests and a hidden reset). */
  reset(): void {
    this.data = emptySave();
    this.save();
  }
}
