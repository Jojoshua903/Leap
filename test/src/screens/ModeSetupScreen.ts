import type { App } from '../app';
import { Screen } from './ScreenManager';
import { button, chips, h, section, toggle } from '../ui/dom';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Music } from '../audio/Music';
import { defaultOptions, getSport } from '../sports/registry';
import type { MatchPlayer, MatchSetup, ModeDef, OptionValue } from '../sports/types';
import { FAV_COLORS, randomBuddy, type BuddyConfig } from '../buddy/BuddyConfig';
import { buddyAvatar } from '../buddy/BuddyAvatar';
import { isUnlocked, unlocksIn, getUnlock, type UnlockCategory } from '../progression/unlocks';
import { requirementText } from '../buddy/BuddyCreatorScreen';
import { basisFor, handicapAverage, handicapFor } from '../sports/handicap';
import type { Profile } from '../save/types';
import { MatchScreen } from '../match/MatchHost';
import { SettingsScreen } from './SettingsScreen';

/** Okabe–Ito palette: distinguishable with every common kind of colour blindness. Used for player colours when that setting is on. */
export const COLORBLIND_SAFE = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#000000'];

interface Slot { profileId: string | null; colorIdx: number; guest: BuddyConfig }

/**
 * Before a match: who plays (profiles or guests, each with a Buddy colour), the mode's options,
 * practice, and cosmetics (only what player 1 has unlocked).
 */
export class ModeSetupScreen extends Screen {
  readonly name = 'setup';
  private slots: Slot[] = [];
  private options: Record<string, OptionValue>;
  private practice = false;
  private laneLook = 'classic';
  private ballSkin = 'solid';
  private trail = 'classic';
  private guestN = 0;

  constructor(private readonly app: App, private readonly mode: ModeDef) {
    super();
    this.view = app.menuBg;
    this.options = defaultOptions(mode);
    const active = app.save.active;
    this.slots.push(this.newSlot(active?.id ?? null, active?.buddy.color ?? 0));
    if (active) {
      this.laneLook = active.loadout.laneLook;
      this.ballSkin = active.loadout.ballSkin;
      this.trail = active.loadout.trail;
    }
    this.fixCosmetics();
  }

  private newSlot(profileId: string | null, colorIdx: number): Slot {
    this.guestN += profileId ? 0 : 1;
    const guest = { ...randomBuddy(Math.random, (f, v) => isUnlocked(null, `${f === 'accessory' ? 'acc' : f}:${v}`)), name: `${t('common.guest')} ${this.guestN || 1}` };
    return { profileId, colorIdx, guest };
  }

  private profileOf(s: Slot): Profile | null { return this.app.save.get(s.profileId); }
  private lead(): Profile | null { return this.slots[0] ? this.profileOf(this.slots[0]) : null; }

  /** Drop cosmetics that player 1 doesn't own (e.g. after switching player 1 to a guest). */
  private fixCosmetics(): void {
    const p = this.lead();
    if (!isUnlocked(p, `lane:${this.laneLook}`)) this.laneLook = 'classic';
    if (!isUnlocked(p, `ball:${this.ballSkin}`)) this.ballSkin = 'solid';
    if (!isUnlocked(p, `trail:${this.trail}`)) this.trail = 'classic';
  }

  enter(): void { this.render(); Music.play('menu', this.mode.sport); }
  relabel(): void { this.render(); }
  resume(): void { this.render(); Music.play('menu', this.mode.sport); }

  render(): void {
    const sport = getSport(this.mode.sport);
    this.el.replaceChildren();
    const panel = h('div', 'panel wide setup-panel', '', this.el);
    panel.style.setProperty('--accent', sport.accent);
    const head = h('div', 'phead', '', panel);
    const tx = h('div', '', '', head);
    h('h3', '', t(this.mode.nameKey), tx);
    h('p', '', t(this.mode.descKey), tx);
    const body = h('div', 'pbody cols', '', panel);
    const left = h('div', 'col', '', body);
    const right = h('div', 'col', '', body);

    /* players */
    const ps = section(left, t('setup.players'));
    const max = this.practice ? 1 : this.mode.maxPlayers;
    const used = new Set(this.slots.map(s => s.profileId).filter(Boolean));
    this.slots.forEach((slot, i) => {
      const row = h('div', 'player-row', '', ps);
      const prof = this.profileOf(slot);
      const av = h('div', 'avatar', '', row);
      av.innerHTML = buddyAvatar({ ...(prof?.buddy ?? slot.guest), color: slot.colorIdx }, 48);
      const mid = h('div', 'pr-mid', '', row);
      h('b', '', t('common.player', { n: i + 1 }), mid);
      const whoItems = [
        ...this.app.save.profiles.filter(p => p.id === slot.profileId || !used.has(p.id)).map(p => ({ value: p.id as string | null, label: p.name })),
        { value: null as string | null, label: slot.profileId ? t('common.guest') : slot.guest.name }
      ];
      chips(mid, whoItems, slot.profileId, v => {
        slot.profileId = v;
        const p = this.app.save.get(v);
        if (p) slot.colorIdx = p.buddy.color;
        if (i === 0) this.fixCosmetics();
        this.render(); this.app.nav.refresh();
      });
      const colors = h('div', 'mini-swatches', '', mid);
      h('span', 'label', t('setup.color'), colors);
      chips(colors, FAV_COLORS.map((c, ci) => ({ value: ci, label: c, swatch: c })), slot.colorIdx, v => {
        slot.colorIdx = v; sfx.tick(); this.render(); this.app.nav.refresh();
      });
      if (this.slots.length > 1) button(t('setup.remove'), () => { this.slots.splice(i, 1); sfx.back(); this.render(); this.app.nav.refresh(); }, 'mini danger', row);
    });
    if (this.slots.length < max) {
      button(`+ ${t('setup.addPlayer')}`, () => {
        const free = this.app.save.profiles.find(p => !used.has(p.id));
        const taken = new Set(this.slots.map(s => s.colorIdx));
        const color = free && !taken.has(free.buddy.color) ? free.buddy.color : [...Array(FAV_COLORS.length).keys()].find(c => !taken.has(c)) ?? 0;
        this.slots.push(this.newSlot(free?.id ?? null, color));
        sfx.pop(); this.render(); this.app.nav.refresh();
      }, 'btn ghost add-player', ps);
    }

    /* options */
    const os = section(right, t('setup.options'));
    for (const o of this.mode.options) {
      h('div', 'label', t(o.labelKey), os);
      chips(os, o.choices.map(c => ({ value: c.value, label: t(c.labelKey) })), this.options[o.id], v => { this.options[o.id] = v; sfx.tick(); });
    }
    toggle(os, t('setup.practice'), this.practice, v => {
      this.practice = v;
      if (v) this.slots = this.slots.slice(0, 1);
      this.render(); this.app.nav.refresh();
    });
    if (this.practice) h('p', 'note', t('setup.practiceDesc'), os);

    /* cosmetics */
    const cs = section(right, t('setup.lane'));
    this.cosmetic(cs, 'lane', this.laneLook, v => { this.laneLook = v; });
    h('div', 'label', t('setup.ball'), cs);
    this.cosmetic(cs, 'ball', this.ballSkin, v => { this.ballSkin = v; });
    h('div', 'label', t('setup.trail'), cs);
    this.cosmetic(cs, 'trail', this.trail, v => { this.trail = v; });

    /* controller */
    const ctl = section(right, t('setup.controller'));
    const b = this.app.input.active;
    const line = h('div', 'ctl-line', '', ctl);
    h('span', '', b ? `${t(`ctrl.${b.kind}`)} · ${b.connected ? '✓' : '…'}` : t('ctrl.mouse'), line);
    button(t('menu.settings'), () => { sfx.select(); this.app.screens.push(new SettingsScreen(this.app)); }, 'mini', line);
    if (this.mode.needsGyro && (!b || b.kind === 'mouse')) h('p', 'note', t('setup.mouseNote'), ctl);

    const acts = h('div', 'acts', '', panel);
    button(t('common.back'), () => this.app.nav.back(), 'pbtn', acts);
    const start = button(t('setup.start'), () => this.start(), 'pbtn go', acts);
    start.dataset.autofocus = '';
  }

  private cosmetic(parent: HTMLElement, cat: UnlockCategory, current: string, set: (v: string) => void): void {
    const p = this.lead();
    chips(parent, unlocksIn(cat).map(d => ({
      value: d.value,
      label: t(d.labelKey),
      locked: isUnlocked(p, d.id) ? null : requirementText(getUnlock(d.id)!.req)
    })), current, v => { set(v); sfx.tick(); });
  }

  private start(): void {
    const s = this.app.settings.get();
    const frames = Number(this.options.frames ?? 10);
    const players: MatchPlayer[] = this.slots.map((slot, i) => {
      const prof = this.profileOf(slot);
      const buddy: BuddyConfig = { ...(prof?.buddy ?? slot.guest), color: slot.colorIdx };
      const color = s.colorblind ? COLORBLIND_SAFE[i % COLORBLIND_SAFE.length] : FAV_COLORS[slot.colorIdx];
      let handicap = 0;
      if (this.options.handicap === true && prof && !this.practice) {
        const ms = prof.stats[this.mode.sport]?.[this.mode.id];
        if (ms) handicap = handicapFor(handicapAverage(ms.gamesPlayed, ms.extras.score10Total ?? 0), frames, basisFor(this.mode.id));
      }
      return { name: prof?.name ?? slot.guest.name, color, profileId: prof?.id ?? null, buddy, handicap };
    });
    const setup: MatchSetup = {
      sport: this.mode.sport, mode: this.mode.id, players, options: { ...this.options }, practice: this.practice,
      laneLook: this.laneLook, ballSkin: this.ballSkin, trail: this.trail
    };
    const lead = this.lead();
    if (lead) this.app.save.updateProfile(lead.id, p => { p.loadout = { laneLook: this.laneLook, ballSkin: this.ballSkin, trail: this.trail }; });
    sfx.select();
    this.app.screens.push(new MatchScreen(this.app, setup, this.mode));
  }
}
