import { bus } from './events';
import { setLanguage } from '../i18n';
import type { SaveManager } from '../save/SaveManager';
import { PROFILE_SETTING_KEYS, type ProfileSettingKey, type SettingsData } from '../save/types';
import { sanitizeSettings } from '../save/migrations';

/**
 * Effective settings = device-wide settings with the active profile's overrides on top.
 * Controller and accessibility choices follow the player (so a left-handed sibling keeps theirs);
 * audio, graphics and language belong to the device.
 */
export class Settings {
  constructor(private save: SaveManager) {}

  get(): SettingsData {
    const p = this.save.active;
    return p ? { ...this.save.globalSettings, ...p.settings } : this.save.globalSettings;
  }

  isProfileKey(k: keyof SettingsData): k is ProfileSettingKey {
    return (PROFILE_SETTING_KEYS as readonly string[]).includes(k);
  }

  set(patch: Partial<SettingsData>): void {
    const p = this.save.active;
    const clean = sanitizeSettings({ ...this.get(), ...patch }, this.get());
    const global: Partial<SettingsData> = {};
    const local: Partial<SettingsData> = {};
    for (const k of Object.keys(patch) as Array<keyof SettingsData>) {
      const v = clean[k];
      if (p && this.isProfileKey(k)) (local as Record<string, unknown>)[k] = v;
      else (global as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(global).length) this.save.setGlobalSettings(global);
    if (p && Object.keys(local).length) this.save.updateProfile(p.id, pr => { Object.assign(pr.settings, local); });
    if ('language' in patch) setLanguage(clean.language);
    bus.emit('settingsChanged', {});
  }

  /** Re-apply side effects after the active profile changes (its overrides may differ). */
  refresh(): void {
    setLanguage(this.get().language);
    bus.emit('settingsChanged', {});
  }
}
