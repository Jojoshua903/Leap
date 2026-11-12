import type { BackendKind } from '../types';
import { t } from '../i18n';


const ICONS = {
  hold: '<svg viewBox="0 0 64 64"><rect x="20" y="6" width="24" height="44" rx="10" fill="#fff" stroke="#1d3a52" stroke-width="4"/><circle cx="32" cy="22" r="7" fill="#ff8a3c" stroke="#1d3a52" stroke-width="3"/><path d="M10 56h44" stroke="#1d3a52" stroke-width="4" stroke-linecap="round"/></svg>',
  swing: '<svg viewBox="0 0 64 64"><path d="M14 18 A26 26 0 0 0 50 46" fill="none" stroke="#1d3a52" stroke-width="5" stroke-linecap="round"/><path d="M50 46l-12 2 6-11z" fill="#1d3a52"/><circle cx="14" cy="18" r="8" fill="#ff5a5f" stroke="#1d3a52" stroke-width="3"/></svg>',
  release: '<svg viewBox="0 0 64 64"><circle cx="40" cy="36" r="14" fill="#2f8fd8" stroke="#1d3a52" stroke-width="4"/><path d="M8 40h12M10 30h10M12 50h10" stroke="#1d3a52" stroke-width="4" stroke-linecap="round"/><path d="M46 14c6 2 10 6 12 12" fill="none" stroke="#ff8a3c" stroke-width="4" stroke-linecap="round"/></svg>'
};

/** Three-step first-throw tutorial. Skippable; finishes by itself after the first throw. Whether it was seen lives in Settings. */
export class Tutorial {
  private readonly root: HTMLDivElement;
  private step = 0;
  private steps: Array<[keyof typeof ICONS, string, string]> = [];
  active = false;

  constructor(ui: HTMLElement, private readonly onDone: () => void = () => undefined) {
    this.root = document.createElement('div');
    this.root.className = 'tutorial';
    ui.appendChild(this.root);
  }

  maybeShow(kind: BackendKind, seen: boolean): void { if (!seen) this.show(kind); }

  show(kind: BackendKind): void {
    this.steps = kind === 'mouse'
      ? [['hold', t('tut.hold'), t('tut.mouse.hold')],
         ['swing', t('tut.swing'), t('tut.mouse.swing')],
         ['release', t('tut.release'), t('tut.mouse.release')]]
      : [['hold', t('tut.hold'), t('tut.motion.hold')],
         ['swing', t('tut.swing'), t('tut.motion.swing')],
         ['release', t('tut.release'), t('tut.motion.release')]];
    this.step = 0;
    this.active = true;
    this.render();
  }

  private render(): void {
    if (!this.active) { this.root.classList.remove('show'); return; }
    const [icon, title, text] = this.steps[this.step];
    this.root.innerHTML = '';
    const card = document.createElement('div'); card.className = 'tut-card';
    const dots = document.createElement('div'); dots.className = 'tut-dots';
    this.steps.forEach((_, i) => { const d = document.createElement('span'); if (i === this.step) d.className = 'on'; dots.appendChild(d); });
    const ic = document.createElement('div'); ic.className = 'tut-icon'; ic.innerHTML = ICONS[icon];
    const h = document.createElement('h3'); h.textContent = `${this.step + 1}. ${title}`;
    const p = document.createElement('p'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'tut-row';
    const skip = document.createElement('button'); skip.className = 'btn ghost'; skip.textContent = t('tut.skip');
    skip.onclick = () => this.finish();
    const next = document.createElement('button'); next.className = 'btn';
    next.textContent = this.step < this.steps.length - 1 ? t('tut.next') : t('tut.gotIt');
    next.onclick = () => { if (this.step < this.steps.length - 1) { this.step++; this.render(); } else this.finish(); };
    row.append(skip, next);
    card.append(dots, ic, h, p, row);
    this.root.appendChild(card);
    this.root.classList.add('show');
  }

  onThrow(): void { if (this.active) this.finish(); }

  /** Close without marking it as seen (leaving a match early). */
  hide(): void { this.active = false; this.render(); }

  finish(): void {
    this.active = false;
    this.onDone();
    this.render();
  }

}
