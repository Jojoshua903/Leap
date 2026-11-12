import type { App } from '../app';
import { Screen } from './ScreenManager';
import { button, h } from '../ui/dom';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Music } from '../audio/Music';
import { SPORTS } from '../sports/registry';
import { PLANE_SVG, SPORT_ICONS, STATS_SVG, WRENCH_SVG } from '../sports/icons';
import type { ModeDef, SportDef } from '../sports/types';
import { buddyAvatar } from '../buddy/BuddyAvatar';
import { levelFromXp } from '../progression/xp';
import { ModeSetupScreen } from './ModeSetupScreen';
import { ComingSoonScreen } from '../sports/ComingSoonScreen';
import { SettingsScreen } from './SettingsScreen';
import { StatsScreen } from './StatsScreen';
import { TitleScreen } from './TitleScreen';

/**
 * The six-tile Breezy Isle menu over the island flyover, same layout as the original menu page:
 * two rows of sport tiles joined by a little plane's dashed trail, Title Screen / Stats / Settings along the bottom.
 * Picking a tile opens the mode panel; playable modes continue to setup, the rest to a "coming soon" screen.
 */
export class MainMenuScreen extends Screen {
  readonly name = 'menu';
  private modal: HTMLDivElement | null = null;

  constructor(private readonly app: App) { super(); this.view = app.menuBg; }

  enter(): void { this.render(); Music.play('menu'); }
  relabel(): void { this.render(); }
  resume(): void { this.render(); Music.play('menu'); }

  render(): void {
    this.el.replaceChildren();
    this.modal = null;
    const p = this.app.save.active;

    // profile chip (top right): who is playing, level; click to switch
    const chip = button('', () => this.app.nav.back(), 'profile-chip', this.el);
    if (p) {
      chip.innerHTML = buddyAvatar(p.buddy, 40);
      const lv = levelFromXp(p.xp);
      const info = h('span', 'pc-text', '', chip);
      h('b', '', p.name, info);
      const bar = h('span', 'xpbar', '', info);
      h('i', '', '', bar).style.width = `${Math.round(lv.progress * 100)}%`;
      h('small', '', t('common.level', { n: lv.level }), info);
    } else {
      h('span', 'pc-text', t('common.guest'), chip);
    }

    const menu = h('main', 'menu-grid', '', this.el);
    h('h2', 'menu-pick', t('menu.pick'), menu);
    for (let r = 0; r < 2; r++) {
      if (r > 0) { const tr = h('div', 'trail', '', menu); tr.innerHTML = PLANE_SVG; }
      const row = h('div', 'row', '', menu);
      for (let c = 0; c < 3; c++) {
        const i = r * 3 + c, s = SPORTS[i];
        if (!s) continue;
        const playable = s.modes.some(m => m.status === 'playable');
        const tile = h('button', 'tile' + (playable ? '' : ' soon'), '', row);
        tile.type = 'button';
        tile.dataset.nav = '';
        tile.style.animationDelay = `${i * 55}ms`;
        tile.style.setProperty('--accent', s.accent);
        if (s.id === 'bowling') tile.dataset.autofocus = '';
        h('div', 'name', t(s.nameKey), tile);
        const pic = h('div', 'pic', '', tile); pic.innerHTML = SPORT_ICONS[s.icon];
        h('span', 'ribbon', playable ? t('menu.playNow') : t('menu.soonBadge'), tile);
        tile.onclick = () => this.openSport(s);
      }
    }

    const bottom = h('div', 'bottom', '', this.el);
    const title = button('', () => { sfx.back(); this.app.screens.reset(new TitleScreen(this.app)); }, 'bbtn title', bottom);
    title.innerHTML = '<div class="mini-logo">Breezy Isle<small>SPORTS</small></div><div class="sep"></div>';
    h('span', '', t('menu.titleScreen'), title);
    const stats = button('', () => { sfx.select(); this.app.screens.push(new StatsScreen(this.app)); }, 'bbtn', bottom);
    stats.innerHTML = STATS_SVG; h('span', '', t('menu.stats'), stats);
    const set = button('', () => { sfx.select(); this.app.screens.push(new SettingsScreen(this.app)); }, 'bbtn', bottom);
    set.innerHTML = WRENCH_SVG; h('span', '', t('menu.settings'), set);
  }

  private openSport(s: SportDef): void {
    sfx.select();
    this.modal?.remove();
    const modal = h('div', 'modal show', '', this.el);
    this.modal = modal;
    modal.onclick = e => { if (e.target === modal) this.closeModal(); };
    const panel = h('div', 'panel', '', modal);
    panel.style.setProperty('--accent', s.accent);
    const head = h('div', 'phead', '', panel);
    const pic = h('div', 'pic', '', head); pic.innerHTML = SPORT_ICONS[s.icon];
    const txt = h('div', '', '', head);
    h('h3', '', t(s.nameKey), txt);
    h('p', '', t(s.descKey), txt);
    const body = h('div', 'pbody', '', panel);
    h('div', 'label', t('menu.modes'), body);
    const list = h('div', 'mode-list', '', body);
    const how = h('div', 'how', '', body);
    let picked: ModeDef = s.modes.find(m => m.status === 'playable') ?? s.modes[0];
    const showHow = () => { how.textContent = t(picked.rulesKey); };
    const cards: Array<[ModeDef, HTMLButtonElement]> = [];
    for (const m of s.modes) {
      const card = h('button', 'opt' + (m.status === 'playable' ? '' : ' soon'), '', list);
      card.type = 'button';
      card.dataset.nav = '';
      if (m === picked) card.dataset.autofocus = '';
      const tx = h('div', '', '', card);
      h('b', '', t(m.nameKey), tx);
      h('small', '', t(m.descKey), tx);
      if (m.status !== 'playable') h('span', 'badge', t('menu.soonBadge'), card);
      card.onclick = () => {
        if (picked === m) { this.go(m); return; }  // second click on the same mode = continue
        picked = m; sfx.tick();
        cards.forEach(([mm, el]) => el.classList.toggle('sel', mm === m));
        showHow();
      };
      cards.push([m, card]);
    }
    cards.forEach(([mm, el]) => el.classList.toggle('sel', mm === picked));
    h('div', 'label', t('menu.howTo'), body);
    body.appendChild(how);
    showHow();
    const acts = h('div', 'acts', '', body);
    button(t('common.back'), () => this.closeModal(), 'pbtn', acts);
    button(t('common.start'), () => this.go(picked), 'pbtn go', acts);
    this.app.nav.refresh();
  }

  private go(m: ModeDef): void {
    sfx.select();
    this.closeModal(true);
    if (m.status === 'playable' && m.scene) this.app.screens.push(new ModeSetupScreen(this.app, m));
    else this.app.screens.push(new ComingSoonScreen(this.app, m));
  }

  private closeModal(silent = false): void {
    if (!this.modal) return;
    if (!silent) sfx.back();
    this.modal.remove();
    this.modal = null;
    this.app.nav.refresh();
  }

  /** Back closes the mode panel first; then returns to profile select. */
  onBack(): boolean {
    if (this.modal) { this.closeModal(); return true; }
    return false;
  }
}
