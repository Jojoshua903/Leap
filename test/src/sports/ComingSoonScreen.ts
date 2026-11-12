import type { App } from '../app';
import { Screen } from '../screens/ScreenManager';
import { button, h } from '../ui/dom';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Music } from '../audio/Music';
import { getMode, getSport } from './registry';
import { SPORT_ICONS } from './icons';
import type { ModeDef } from './types';
import { ModeSetupScreen } from '../screens/ModeSetupScreen';

/** Placeholder for modes that aren't built yet: the sport's art, its rules, and a shortcut to bowling. */
export class ComingSoonScreen extends Screen {
  readonly name = 'soon';

  constructor(private readonly app: App, private readonly mode: ModeDef) { super(); this.view = app.menuBg; }

  enter(): void { this.render(); Music.play('menu', this.mode.sport); }
  relabel(): void { this.render(); }

  render(): void {
    const s = getSport(this.mode.sport);
    this.el.replaceChildren();
    const panel = h('div', 'panel soon-panel', '', this.el);
    panel.style.setProperty('--accent', s.accent);
    const head = h('div', 'phead', '', panel);
    const pic = h('div', 'pic', '', head); pic.innerHTML = SPORT_ICONS[s.icon];
    const tx = h('div', '', '', head);
    h('span', 'badge big', t('menu.soonBadge'), tx);
    h('h3', '', t(this.mode.nameKey), tx);
    h('p', '', t(s.nameKey), tx);
    const body = h('div', 'pbody', '', panel);
    h('p', 'soon-text', t('soon.text', { mode: t(this.mode.nameKey) }), body);
    h('div', 'label', t('menu.howTo'), body);
    h('div', 'how', t(this.mode.rulesKey), body);
    const acts = h('div', 'acts', '', body);
    button(t('common.back'), () => this.app.nav.back(), 'pbtn', acts);
    const go = button(t('soon.toBowling'), () => {
      sfx.select();
      this.app.screens.replace(new ModeSetupScreen(this.app, getMode('bowling', 'standard')));
    }, 'pbtn go', acts);
    go.dataset.autofocus = '';
  }
}
