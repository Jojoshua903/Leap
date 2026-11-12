import type { App } from '../app';
import { Screen } from './ScreenManager';
import { button, h } from '../ui/dom';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import type { MatchScreen } from '../match/MatchHost';
import { SettingsScreen } from './SettingsScreen';

/** Pause overlay over a running match: Resume, Restart, Settings, Quit. B / Esc resumes. */
export class PauseScreen extends Screen {
  readonly name = 'pause';
  readonly overlay = true;

  constructor(private readonly app: App, private readonly match: MatchScreen) { super(); }

  enter(): void { this.render(); }
  relabel(): void { this.render(); }

  render(): void {
    this.el.replaceChildren();
    const panel = h('div', 'panel small pause-panel', '', this.el);
    h('h3', 'ptitle', t('pause.title'), panel);
    const col = h('div', 'pbody col', '', panel);
    const resume = button(t('pause.resume'), () => this.resumeMatch(), 'pbtn go', col);
    resume.dataset.autofocus = '';
    button(t('pause.restart'), () => { sfx.select(); this.app.screens.pop(); this.match.restart(); }, 'pbtn', col);
    button(t('pause.settings'), () => { sfx.select(); this.app.screens.push(new SettingsScreen(this.app)); }, 'pbtn', col);
    button(t('pause.quit'), () => { sfx.back(); this.app.screens.popTo('setup'); }, 'pbtn', col);
  }

  private resumeMatch(): void { sfx.select(); this.app.screens.pop(); }

  onBack(): boolean { this.resumeMatch(); return true; }
}
