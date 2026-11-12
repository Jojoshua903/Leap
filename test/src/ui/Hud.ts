import type { Throw } from '../types';
import { TUNING } from '../tuning';
import { t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; parent?.appendChild(e); return e;
};

/** In-game HUD: current player, frame / ball, last-throw power meter, hint line, practice readout. */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly dot: HTMLSpanElement;
  private readonly name: HTMLElement;
  private readonly fb: HTMLSpanElement;
  private readonly fill: HTMLDivElement;
  private readonly val: HTMLSpanElement;
  private readonly spin: HTMLSpanElement;
  private readonly hintEl: HTMLDivElement;
  private readonly phaseEl: HTMLDivElement;
  private readonly practiceEl: HTMLDivElement;
  private readonly label: HTMLElement;
  private readonly keys: HTMLDivElement;
  private hintT = 0;

  constructor(ui: HTMLElement) {
    this.root = el('div', 'hud hidden', ui);
    const p = el('div', 'hud-player', this.root);
    this.dot = el('span', 'dot', p);
    this.name = el('b', 'name', p);
    this.fb = el('span', 'fb', p);
    const pw = el('div', 'hud-power', this.root);
    this.label = el('small', '', pw);
    const meter = el('div', 'meter', pw);
    this.fill = el('div', 'fill', meter);
    this.val = el('span', 'val', pw, '–');
    this.spin = el('span', 'spin', pw);
    this.phaseEl = el('div', 'hud-phase', this.root);
    this.hintEl = el('div', 'hud-hint', this.root);
    this.practiceEl = el('div', 'hud-practice', this.root);
    this.keys = el('div', 'hud-keys', this.root);
    this.relabel();
  }

  /** Re-apply static strings after a language change. */
  relabel(): void {
    this.label.textContent = t('hud.lastThrow');
    this.keys.textContent = t('hud.keys');
  }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  setTurn(name: string, color: string, frame: number, ball: number, practice = false): void {
    this.name.textContent = name;
    this.dot.style.background = color;
    this.fb.textContent = practice ? t('hud.practiceFrame', { b: ball }) : t('hud.frame', { f: frame + 1, b: ball });
  }

  setPhase(text: string): void { this.phaseEl.textContent = text; }

  showPower(th: Throw, practice = false): void {
    const k = Math.min(1, th.speed / TUNING.speedMax);
    this.fill.style.width = `${Math.round(k * 100)}%`;
    this.fill.classList.toggle('weak', th.weak);
    this.val.textContent = `${(th.speed * 3.6).toFixed(0)} km/h`;
    const s = Math.round((th.spin / Math.max(1, TUNING.maxSpin)) * 100);
    this.spin.textContent = Math.abs(s) < 8 ? t('hud.noHook') : t('hud.hook', { dir: s > 0 ? '◀' : '▶', n: Math.abs(s) });
    if (practice) {
      this.practiceEl.textContent = t('hud.practiceStats', { speed: (th.speed * 3.6).toFixed(1), angle: th.angleDeg.toFixed(1), spin: th.spin.toFixed(1) });
      this.practiceEl.classList.add('show');
    }
  }

  hint(text: string, ms = 3500): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    this.hintT = ms / 1000;
  }

  update(dt: number): void {
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
  }

  dispose(): void { this.root.remove(); }
}
