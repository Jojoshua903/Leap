import type { App } from '../app';
import { Screen, type View } from '../screens/ScreenManager';
import { h } from '../ui/dom';
import { t } from '../i18n';
import { bus } from '../core/events';
import { Music } from '../audio/Music';
import { sfx } from '../audio/Sfx';
import type { MatchSetup, MatchSummary, ModeDef, SceneContext, SportScene } from '../sports/types';
import { applyMatch } from '../progression/applyMatch';
import { ResultsScreen } from '../screens/ResultsScreen';
import { PauseScreen } from '../screens/PauseScreen';

const STEP = 1 / 120;          // fixed physics step
const MAX_SUBSTEPS = 5;        // per rendered frame; extra backlog is dropped

/** Runs a SportScene at a fixed 120 Hz with interpolated rendering, as a View the main loop can draw. */
class MatchView implements View {
  private acc = 0;
  constructor(readonly sport: SportScene) {}
  get scene() { return this.sport.scene; }
  get camera() { return this.sport.camera; }
  update(dt: number): void {
    this.acc += dt * this.sport.timeScale;
    let n = 0;
    while (this.acc >= STEP && n < MAX_SUBSTEPS) { this.sport.fixedStep(STEP); this.acc -= STEP; n++; }
    if (n === MAX_SUBSTEPS && this.acc > STEP) this.acc = 0;     // can't keep up: drop the backlog instead of spiralling
    this.sport.frame(this.acc / STEP, dt);
  }
  resize(w: number, h: number): void { this.sport.resize(w, h); }
  dispose(): void { this.sport.dispose(); }
}

/**
 * The match screen: picks the controller, calibrates, loads the mode's scene lazily from the registry,
 * runs it, and hands the summary to progression and the results screen. B / Esc pauses.
 */
export class MatchScreen extends Screen {
  readonly name = 'match';
  sport: SportScene | null = null;
  private cancelled = false;
  private finished = false;

  constructor(private readonly app: App, readonly setup: MatchSetup, readonly mode: ModeDef) { super(); }

  enter(): void {
    h('div', 'loading-card', t('app.loading'), this.el);
    this.app.setInMatch(true);
    Music.play('match', this.setup.sport);
    void this.boot();
  }

  private async boot(): Promise<void> {
    const { app } = this;
    const { input, settings } = app;
    let b = input.active ?? await input.select(settings.get().backend);
    if (!b.connected && b.kind !== 'mouse') {
      b = await input.select('mouse');
      bus.emit('toast', { title: t('hud.notConnected'), kind: 'warn' });
    }
    await input.calibrate();
    if (this.cancelled || !this.mode.scene) return;
    const factory = await this.mode.scene();
    const ctx: SceneContext = {
      renderer: app.renderer,
      ui: this.el,
      setup: this.setup,
      backend: () => input.active,
      swing: input.swing,
      quality: () => app.quality(),
      reducedMotion: () => settings.get().reducedMotion,
      gutterAssist: () => settings.get().gutterAssist,
      handed: () => settings.get().handed,
      onFirstTurn: () => app.tutorial.maybeShow(input.active?.kind ?? 'mouse', settings.get().tutorialSeen),
      onThrown: () => app.tutorial.onThrow(),
      onFinished: s => this.onFinished(s)
    };
    const sport = await factory(ctx);
    if (this.cancelled) { sport.dispose(); return; }
    this.el.querySelector('.loading-card')?.remove();
    this.sport = sport;
    this.view = new MatchView(sport);
    sport.resize(innerWidth, innerHeight);
    sport.start();
  }

  private onFinished(summary: MatchSummary): void {
    if (this.finished) return;
    this.finished = true;
    bus.emit('gameEnd', { summary });
    const reports = applyMatch(this.app.save, summary);
    this.app.screens.replace(new ResultsScreen(this.app, summary, reports, this.setup, this.mode));
  }

  /** Pause overlay on top: stop the match and give the cursor back. */
  pause(): void {
    this.sport?.setPaused(true);
    this.app.setInMatch(false);
  }

  resume(): void {
    this.app.setInMatch(true);
    if (!this.sport) return;
    this.sport.refreshSettings();
    this.sport.setQuality(this.app.quality());
    this.sport.setPaused(false);
  }

  restart(): void { this.sport?.restart(); }

  onBack(): boolean {
    sfx.click();
    this.app.screens.push(new PauseScreen(this.app, this));
    return true;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Tab') { e.preventDefault(); this.sport?.toggleScores?.(); return true; }
    return false;
  }

  exit(): void {
    this.cancelled = true;
    this.app.tutorial.hide();
    this.app.setInMatch(false);
    // the view (and with it the scene) is disposed by the ScreenManager; dispose here if it never became a view
    if (this.sport && !this.view) this.sport.dispose();
  }
}
