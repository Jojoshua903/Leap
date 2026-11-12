import type { App } from '../app';
import { Screen } from './ScreenManager';
import { button, confirmBox, h } from '../ui/dom';
import { t } from '../i18n';
import { bus } from '../core/events';
import { sfx } from '../audio/Sfx';
import { buddyAvatar } from '../buddy/BuddyAvatar';
import { randomBuddy } from '../buddy/BuddyConfig';
import { levelFromXp } from '../progression/xp';
import { isUnlocked } from '../progression/unlocks';
import { MAX_PROFILES } from '../save/types';
import { BuddyCreatorScreen } from '../buddy/BuddyCreatorScreen';
import { MainMenuScreen } from './MainMenuScreen';

/** "Who's playing?" Up to 4 profiles, plus guest play, import/export and delete. */
export class ProfileSelectScreen extends Screen {
  readonly name = 'profiles';
  private fileInput: HTMLInputElement | null = null;

  constructor(private readonly app: App) { super(); this.view = app.menuBg; }

  enter(): void { this.render(); }
  relabel(): void { this.render(); }
  resume(): void { this.render(); }

  render(): void {
    const { save } = this.app;
    this.el.replaceChildren();
    const panel = h('div', 'panel wide', '', this.el);
    const head = h('div', 'phead', '', panel);
    h('h3', '', t('profile.title'), head);
    const body = h('div', 'pbody', '', panel);
    if (save.warning) h('div', 'warn', t(save.warning), body);

    const grid = h('div', 'profile-grid', '', body);
    save.profiles.forEach((p, i) => {
      const card = h('div', 'profile-card', '', grid);
      const pick = h('button', 'pc-main', '', card);
      pick.type = 'button';
      pick.dataset.nav = '';
      if (i === 0 || p.id === save.data.activeProfileId) pick.dataset.autofocus = '';
      pick.innerHTML = buddyAvatar(p.buddy, 72);
      const info = h('div', 'pc-info', '', pick);
      h('b', '', p.name, info);
      h('small', '', t('common.level', { n: levelFromXp(p.xp).level }), info);
      pick.onclick = () => this.choose(p.id);
      const tools = h('div', 'pc-tools', '', card);
      button(t('profile.edit'), () => this.edit(p.id), 'mini', tools);
      button(t('profile.export'), () => this.exportProfile(p.id), 'mini', tools);
      button(t('profile.delete'), () => confirmBox(this.el, t('profile.deleteConfirm', { name: p.name }), () => {
        save.deleteProfile(p.id);
        sfx.back();
        this.render();
        this.app.nav.refresh();
      }), 'mini danger', tools);
    });
    for (let i = save.profiles.length; i < MAX_PROFILES; i++) {
      const slot = button('', () => this.create(), 'profile-card empty', grid);
      h('span', 'plus', '+', slot);
      h('span', '', t('profile.new'), slot);
      if (save.profiles.length === 0 && i === 0) slot.dataset.autofocus = '';
    }

    const acts = h('div', 'acts', '', body);
    button(t('common.back'), () => this.app.nav.back(), 'pbtn', acts);
    button(t('profile.import'), () => this.pickFile(), 'pbtn', acts);
    button(t('profile.guest'), () => this.choose(null), 'pbtn go', acts);
  }

  private choose(id: string | null): void {
    sfx.select();
    this.app.save.setActive(id);
    this.app.settings.refresh();
    this.app.screens.push(new MainMenuScreen(this.app));
  }

  private create(): void {
    if (this.app.save.isFull) { bus.emit('toast', { title: t('profile.full'), kind: 'warn' }); return; }
    sfx.select();
    // New Buddies only get the items that are free from the start.
    const start = randomBuddy(Math.random, (f, v) => isUnlocked(null, `${f === 'accessory' ? 'acc' : f}:${v}`));
    this.app.screens.push(new BuddyCreatorScreen(this.app, start, null, cfg => {
      const p = this.app.save.createProfile(cfg);
      if (!p) return;
      this.app.save.setActive(p.id);
      this.app.settings.refresh();
      // Replace the creator with the main menu so Back from the menu returns here.
      this.app.screens.replace(new MainMenuScreen(this.app));
    }));
  }

  private edit(id: string): void {
    const p = this.app.save.get(id);
    if (!p) return;
    sfx.select();
    this.app.screens.push(new BuddyCreatorScreen(this.app, p.buddy, p, cfg => {
      this.app.save.updateProfile(id, pr => { pr.buddy = cfg; });
      this.app.screens.pop();
    }));
  }

  private exportProfile(id: string): void {
    const json = this.app.save.exportProfile(id);
    const p = this.app.save.get(id);
    if (!json || !p) return;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.name.replace(/[^\w-]+/g, '_') || 'buddy'}.breezy.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sfx.pop();
  }

  private pickFile(): void {
    if (!this.fileInput) {
      this.fileInput = h('input', 'hidden-file', '', this.el);
      this.fileInput.type = 'file';
      this.fileInput.accept = 'application/json,.json';
      this.fileInput.onchange = async () => {
        const f = this.fileInput?.files?.[0];
        if (!f) return;
        const res = this.app.save.importProfile(await f.text());
        if (res.ok) { bus.emit('toast', { title: t('profile.importOk', { name: res.profile.name }), kind: 'info' }); sfx.pop(); }
        else { bus.emit('toast', { title: t(res.error), kind: 'warn' }); sfx.error(); }
        this.fileInput = null;
        this.render();
        this.app.nav.refresh();
      };
    }
    this.fileInput.click();
  }
}
