import type { App } from '../app';
import { Screen } from '../screens/ScreenManager';
import { button, chips, h } from '../ui/dom';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { BuddyPreview } from '../views/BuddyPreview';
import {
  ACCESSORIES, COUNTS, FAV_COLORS, HAIR_COLORS, NAME_MAX, SKIN_TONES,
  checkName, normaliseName, randomBuddy, type Accessory, type BuddyConfig, type IndexField
} from './BuddyConfig';
import { getUnlock, isUnlocked, type Requirement } from '../progression/unlocks';
import { getAchievement } from '../progression/achievements';
import type { Profile } from '../save/types';

type Tab = 'face' | 'hair' | 'clothes' | 'extras';

/** Human text for an unlock requirement ("Reach level 4"). */
export function requirementText(req: Requirement): string {
  switch (req.type) {
    case 'default': return t('req.default');
    case 'level': return t('req.level', { n: req.n });
    case 'games': return t('req.games', { n: req.n, sport: t(`sport.${req.sport}.name`) });
    case 'achievement': { const a = getAchievement(req.id); return t('req.achievement', { name: a ? t(a.nameKey) : req.id }); }
  }
}

/**
 * Buddy creator: live 3D preview on the left (drag to spin), options on the right.
 * Locked items show a padlock and what unlocks them. Used for new profiles, editing, and guests.
 */
export class BuddyCreatorScreen extends Screen {
  readonly name = 'creator';
  private cfg: BuddyConfig;
  private tab: Tab = 'face';
  private readonly preview = new BuddyPreview();
  private errorEl: HTMLElement | null = null;

  constructor(
    private readonly app: App,
    initial: BuddyConfig,
    private readonly profile: Profile | null,
    private readonly onDone: (cfg: BuddyConfig) => void
  ) {
    super();
    this.cfg = { ...initial };
    this.view = this.preview;
  }

  enter(): void {
    this.preview.setBuddy(this.cfg, true);
    this.preview.resize(innerWidth, innerHeight);
    this.render();
  }

  relabel(): void { this.render(); }

  private lockText(field: IndexField | 'accessory', value: number | Accessory): string | null {
    const id = `${field === 'accessory' ? 'acc' : field}:${value}`;
    if (isUnlocked(this.profile, id)) return null;
    const def = getUnlock(id);
    return def ? requirementText(def.req) : null;
  }

  private update(patch: Partial<BuddyConfig>, rebuild = true): void {
    this.cfg = { ...this.cfg, ...patch };
    if (rebuild) this.preview.setBuddy(this.cfg);
  }

  render(): void {
    this.el.replaceChildren();
    const drag = h('div', 'creator-drag', '', this.el);
    h('div', 'drag-hint', t('creator.dragHint'), drag);
    this.preview.bindDrag(drag);

    const panel = h('div', 'panel creator-panel', '', this.el);
    h('h3', 'ptitle', t('creator.title'), panel);
    const body = h('div', 'pbody', '', panel);

    // name
    const nameRow = h('label', 'name-row', '', body);
    h('span', 'label', t('creator.name'), nameRow);
    const input = h('input', '', '', nameRow);
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.value = this.cfg.name;
    input.dataset.nav = '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.oninput = () => { this.update({ name: input.value }, false); this.showNameError(false); };
    this.errorEl = h('div', 'field-error', '', body);

    // tabs
    const tabs = h('div', 'tabs', '', body);
    const tabDefs: Array<[Tab, string]> = [['face', t('creator.skin')], ['hair', t('creator.hair')], ['clothes', t('creator.top')], ['extras', t('creator.accessory')]];
    for (const [id, label] of tabDefs) {
      const b = button(label, () => { this.tab = id; sfx.tick(); this.render(); this.app.nav.refresh(); }, 'tab' + (this.tab === id ? ' sel' : ''), tabs);
      if (this.tab === id) b.dataset.autofocus = '';
    }
    const opts = h('div', 'tab-body', '', body);
    const idxChips = (field: IndexField, labelKey: string, names: string[] | null, swatches?: string[]) => {
      h('div', 'label', t(labelKey), opts);
      chips(opts, Array.from({ length: COUNTS[field] }, (_, i) => ({
        value: i,
        label: names ? names[i] : String(i + 1),
        swatch: swatches?.[i],
        locked: this.lockText(field, i)
      })), this.cfg[field] as number, v => { sfx.tick(); this.update({ [field]: v } as Partial<BuddyConfig>); });
    };
    const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => t(`${prefix}.${i}`));
    switch (this.tab) {
      case 'face':
        idxChips('skin', 'creator.skin', null, SKIN_TONES);
        idxChips('eyes', 'creator.eyes', names('eyes', COUNTS.eyes));
        idxChips('mouth', 'creator.mouth', names('mouth', COUNTS.mouth));
        break;
      case 'hair':
        idxChips('hair', 'creator.hair', names('hair', COUNTS.hair));
        idxChips('hairColor', 'creator.hairColor', null, HAIR_COLORS);
        break;
      case 'clothes':
        idxChips('top', 'creator.top', names('top', COUNTS.top));
        idxChips('bottom', 'creator.bottom', names('bottom', COUNTS.bottom));
        idxChips('color', 'creator.color', null, FAV_COLORS);
        break;
      case 'extras':
        h('div', 'label', t('creator.accessory'), opts);
        chips(opts, ACCESSORIES.map(a => ({ value: a, label: t(`acc.${a}`), locked: this.lockText('accessory', a) })), this.cfg.accessory,
          v => { sfx.tick(); this.update({ accessory: v }); });
        break;
    }

    const acts = h('div', 'acts', '', body);
    button(t('common.back'), () => this.app.nav.back(), 'pbtn', acts);
    button(t('creator.randomize'), () => this.randomise(), 'pbtn', acts);
    button(t('creator.done'), () => this.finish(input.value), 'pbtn go', acts);
  }

  private showNameError(on: boolean, key = ''): void {
    if (this.errorEl) this.errorEl.textContent = on ? t(key) : '';
  }

  private randomise(): void {
    sfx.pop();
    const allowed = (f: IndexField | 'accessory', v: number | Accessory) => !this.lockText(f, v);
    this.cfg = randomBuddy(Math.random, allowed, this.cfg.name);
    this.preview.setBuddy(this.cfg, true);
    this.render();
    this.app.nav.refresh();
  }

  private finish(rawName: string): void {
    const res = checkName(rawName);
    if (res !== 'ok') { sfx.error(); this.showNameError(true, res); return; }
    sfx.select();
    this.preview.play('wave');
    this.onDone({ ...this.cfg, name: normaliseName(rawName) });
  }

  onKey(e: KeyboardEvent): boolean {
    if (document.activeElement instanceof HTMLInputElement) return false;
    if (e.key === 'q' || e.key === 'Q') { this.preview.nudge(-0.4); return true; }
    if (e.key === 'e' || e.key === 'E') { this.preview.nudge(0.4); return true; }
    return false;
  }


}
