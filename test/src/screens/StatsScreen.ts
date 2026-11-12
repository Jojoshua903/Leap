import type { App } from '../app';
import { Screen } from './ScreenManager';
import { button, h } from '../ui/dom';
import { t } from '../i18n';
import { SPORTS } from '../sports/registry';
import { SPORT_ICONS } from '../sports/icons';
import { achievementsFor } from '../progression/achievements';
import { levelFromXp } from '../progression/xp';
import { sportHooks } from '../progression/sportHooks';
import { buddyAvatar } from '../buddy/BuddyAvatar';

/** Per-sport, per-mode stats for the active profile, its level, and the achievement board. */
export class StatsScreen extends Screen {
  readonly name = 'stats';

  constructor(private readonly app: App) { super(); this.view = app.menuBg; }

  enter(): void { this.render(); }
  relabel(): void { this.render(); }

  render(): void {
    this.el.replaceChildren();
    const panel = h('div', 'panel wide stats-panel', '', this.el);
    const head = h('div', 'phead', '', panel);
    const p = this.app.save.active;
    if (p) { const av = h('div', 'pic avatar-pic', '', head); av.innerHTML = buddyAvatar(p.buddy, 96); }
    const tx = h('div', '', '', head);
    h('h3', '', t('stats.title'), tx);
    const body = h('div', 'pbody scroll', '', panel);

    if (!p) {
      h('p', 'note', t('stats.guest'), body);
    } else {
      const lv = levelFromXp(p.xp);
      h('p', '', `${p.name} · ${t('common.level', { n: lv.level })} · ${t('common.xp', { n: p.xp })}`, tx);
      const bar = h('div', 'xpbar big', '', tx);
      h('i', '', '', bar).style.width = `${Math.round(lv.progress * 100)}%`;

      for (const s of SPORTS) {
        const sec = h('div', 'stat-sport', '', body);
        sec.style.setProperty('--accent', s.accent);
        const sh = h('div', 'stat-head', '', sec);
        const ic = h('div', 'stat-icon', '', sh); ic.innerHTML = SPORT_ICONS[s.icon];
        h('b', '', t(s.nameKey), sh);
        const playable = s.modes.filter(m => m.status === 'playable');
        if (!playable.length) { h('small', 'note', t('stats.later'), sec); continue; }
        const table = h('table', 'stat-table', '', sec);
        const hr = table.insertRow();
        const cols = sportHooks(s.id).statColumns;
        const heads = cols ? cols.map(c => c.labelKey) : ['stats.games', 'stats.best', 'stats.avg', 'stats.strikes', 'stats.spares', 'stats.gutters', 'stats.streak'];
        for (const k of ['', ...heads]) {
          const th = document.createElement('th'); th.textContent = k ? t(k) : ''; hr.appendChild(th);
        }
        for (const m of playable) {
          const ms = p.stats[s.id]?.[m.id];
          const r = table.insertRow();
          r.insertCell().textContent = t(m.nameKey);
          if (!ms || !ms.gamesPlayed) { const c = r.insertCell(); c.colSpan = heads.length; c.textContent = t('stats.noGames'); c.className = 'muted'; continue; }
          const x = ms.extras;
          const values = cols ? cols.map(c => c.value(ms, m.id))
            : [ms.gamesPlayed, ms.bestScore, Math.round(ms.totalScore / ms.gamesPlayed), x.strikes ?? 0, x.spares ?? 0, x.gutters ?? 0, x.bestStrikeStreak ?? 0];
          for (const v of values) r.insertCell().textContent = String(v);
        }
        const achs = achievementsFor(s.id);
        if (achs.length) {
          h('div', 'label', t('stats.achievements'), sec);
          const grid = h('div', 'ach-grid', '', sec);
          for (const a of achs) {
            const got = a.id in p.achievements;
            const card = h('div', 'ach' + (got ? ' got' : ''), '', grid);
            h('span', 'ach-icon', got ? '🏆' : '🔒', card);
            const ct = h('div', '', '', card);
            h('b', '', t(a.nameKey), ct);
            h('small', '', t(a.descKey), ct);
          }
        }
      }
    }
    const acts = h('div', 'acts', '', panel);
    button(t('common.back'), () => this.app.nav.back(), 'pbtn go', acts).dataset.autofocus = '';
  }
}
