import type { App } from '../app';
import { Screen } from './ScreenManager';
import { h } from '../ui/dom';
import { t } from '../i18n';
import { Mixer } from '../audio/Mixer';
import { Music } from '../audio/Music';
import { sfx } from '../audio/Sfx';
import { ProfileSelectScreen } from './ProfileSelectScreen';

/**
 * Big logo over the island. Any click, key or controller button continues to profile select.
 * The whole screen is one nav target, so a controller trigger "clicks" it too.
 */
export class TitleScreen extends Screen {
  readonly name = 'title';
  private readonly go = (e: Event) => {
    if (e instanceof KeyboardEvent && (e.key === 'F3' || e.key === 'Tab' || e.key === 'Escape')) return;
    this.next();
  };
  private done = false;

  constructor(private readonly app: App) { super(); this.view = app.menuBg; }

  enter(): void {
    this.render();
    this.listen();
    Music.play('menu');
  }

  private listen(): void {
    // A short delay so the click that opened this screen doesn't skip it.
    setTimeout(() => {
      addEventListener('pointerdown', this.go);
      addEventListener('keydown', this.go);
    }, 300);
  }

  private unlisten(): void {
    removeEventListener('pointerdown', this.go);
    removeEventListener('keydown', this.go);
  }

  render(): void {
    this.el.replaceChildren();
    const box = h('button', 'title-box', '', this.el);
    box.type = 'button';
    box.dataset.nav = '';
    box.dataset.autofocus = '';
    box.onclick = () => this.next();
    const logo = h('div', 'big-logo', 'Breezy Isle', box);
    h('small', '', 'SPORTS', logo);
    h('div', 'press', t('title.press'), box);
  }

  relabel(): void { this.render(); }

  private next(): void {
    if (this.done) return;
    this.done = true;
    this.unlisten();
    Mixer.unlock();
    sfx.select();
    Music.play('menu');
    this.app.screens.push(new ProfileSelectScreen(this.app));
  }

  resume(): void { this.done = false; this.listen(); }
  pause(): void { this.unlisten(); }
  exit(): void { this.unlisten(); }

  /** Nothing to go back to from the title. */
  onBack(): boolean { return true; }
}
