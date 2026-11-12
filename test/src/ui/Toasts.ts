import { bus } from '../core/events';
import { sfx } from '../audio/Sfx';

/** Little pop-up cards in the top-right for achievements, unlocks, level-ups and warnings. */
export class Toasts {
  private readonly root: HTMLDivElement;

  constructor(ui: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'toasts';
    this.root.setAttribute('aria-live', 'polite');
    ui.appendChild(this.root);
    bus.on('toast', ({ title, text, kind }) => this.show(title, text, kind));
  }

  show(title: string, text = '', kind: 'info' | 'achievement' | 'unlock' | 'level' | 'warn' = 'info', ms = 3800): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const icon = { info: 'ℹ️', achievement: '🏆', unlock: '🎁', level: '⭐', warn: '⚠️' }[kind];
    const ic = document.createElement('span'); ic.className = 'ticon'; ic.textContent = icon;
    const body = document.createElement('div');
    const b = document.createElement('b'); b.textContent = title;
    body.appendChild(b);
    if (text) { const s = document.createElement('small'); s.textContent = text; body.appendChild(s); }
    el.append(ic, body);
    this.root.appendChild(el);
    if (kind === 'achievement') sfx.achievement();
    else if (kind === 'level') sfx.levelUp();
    else if (kind === 'unlock') sfx.pop();
    // keep at most 4 on screen
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    window.setTimeout(() => { el.classList.remove('show'); window.setTimeout(() => el.remove(), 300); }, ms);
  }
}
