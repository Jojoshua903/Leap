import type { App } from '../app';
import { Screen } from './ScreenManager';
import { button, h } from '../ui/dom';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Music } from '../audio/Music';
import { Mixer } from '../audio/Mixer';
import { Crowd } from '../audio/CrowdSfx';
import type { MatchSetup, MatchSummary, ModeDef } from '../sports/types';
import type { PlayerReport } from '../progression/applyMatch';
import { getAchievement } from '../progression/achievements';
import { getUnlock } from '../progression/unlocks';
import { levelFromXp } from '../progression/xp';
import { Podium } from '../views/Podium';
import { MatchScreen } from '../match/MatchHost';

/** Places with ties: equal totals share a place (1, 2, 2, 4). */
export function placesFor(totals: number[]): number[] {
  return totals.map(v => 1 + totals.filter(o => o > v).length);
}

/**
 * Results: a 3D podium with reacting Buddies, everyone's score (plus handicap), personal-best badges,
 * XP gained with the level bar, and anything newly earned. Rematch replays the same setup.
 */
export class ResultsScreen extends Screen {
  readonly name = 'results';
  private readonly places: number[];

  constructor(
    private readonly app: App,
    private readonly summary: MatchSummary,
    private readonly reports: PlayerReport[],
    private readonly setup: MatchSetup,
    private readonly mode: ModeDef
  ) {
    super();
    this.places = placesFor(summary.players.map(p => p.total));
    const podium = new Podium(summary.players.map((p, i) => ({ buddy: p.buddy, color: p.color, place: this.places[i] })));
    podium.calm = app.settings.get().reducedMotion;
    podium.resize(innerWidth, innerHeight);
    this.view = podium;
  }

  enter(): void {
    this.render();
    Music.play('results', this.summary.sport);
    Mixer.duck(2);
    Crowd.cheer(0.8);
  }

  relabel(): void { this.render(); }

  render(): void {
    const { summary, reports } = this;
    this.el.replaceChildren();
    const panel = h('div', 'panel results-panel', '', this.el);
    h('h3', 'ptitle', summary.practice ? t('results.practice') : t('results.title'), panel);
    const list = h('ol', 'results', '', panel);
    const order = summary.players.map((_, i) => i).sort((a, b) => this.places[a] - this.places[b]);
    for (const i of order) {
      const p = summary.players[i], r = reports[i];
      const li = h('li', this.places[i] === 1 ? 'winner' : '', '', list);
      h('span', 'place', String(this.places[i]), li);
      const dot = h('span', 'dot', '', li); dot.style.background = p.color;
      const mid = h('div', 'rmid', '', li);
      h('b', 'rname', p.name, mid);
      const st = p.stats;
      h('small', 'rstats', `${t('results.strikes')} ${st.strikes ?? 0} · ${t('results.spares')} ${st.spares ?? 0} · ${t('results.gutters')} ${st.gutters ?? 0}`, mid);
      if (r?.newBest) h('span', 'badge best', t('results.newBest'), mid);
      if (r?.profileId) {
        const prof = this.app.save.get(r.profileId);
        if (prof) {
          const lv = levelFromXp(prof.xp);
          const xp = h('div', 'xprow', '', mid);
          h('span', 'xpgain', t('results.xp', { n: r.xp }), xp);
          const bar = h('span', 'xpbar', '', xp);
          const fill = h('i', '', '', bar);
          fill.style.width = '0%';
          requestAnimationFrame(() => { fill.style.width = `${Math.round(lv.progress * 100)}%`; });
          h('small', '', t('common.level', { n: lv.level }), xp);
          if (r.levelAfter > r.levelBefore) h('span', 'badge level', t('results.levelUp', { n: r.levelAfter }), mid);
        }
        const earned = [
          ...r.achievements.map(id => `🏆 ${t(getAchievement(id)?.nameKey ?? id)}`),
          ...r.unlocks.map(id => `🎁 ${t(getUnlock(id)?.labelKey ?? id)}`)
        ];
        if (earned.length) h('div', 'earned', earned.join('  '), mid);
      }
      const sc = h('span', 'rscore', String(p.total), li);
      if (p.handicap) h('small', 'hcp', `(${p.score} + ${p.handicap})`, sc);
    }
    const acts = h('div', 'acts', '', panel);
    button(t('results.menu'), () => { sfx.back(); this.app.screens.popTo('menu'); }, 'pbtn', acts);
    const again = button(t('results.rematch'), () => { sfx.select(); this.app.screens.replace(new MatchScreen(this.app, this.setup, this.mode)); }, 'pbtn go', acts);
    again.dataset.autofocus = '';
  }

  /** Back = to mode setup, keeping the same players. */
  onBack(): boolean { this.app.screens.popTo('setup'); return true; }
}
