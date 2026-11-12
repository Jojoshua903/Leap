import { qConj, qMul, qToEuler } from '../math/Filter';
import type { InputSample, Quat } from '../types';
import type { ScreenManager } from '../screens/ScreenManager';
import { sfx } from '../audio/Sfx';

type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * Menu navigation for mouse, keyboard and motion controllers.
 *  - Every interactive element has `data-nav`. Arrows move a highlight spatially, Enter/Space activates,
 *    Esc/Backspace (and the B button) go back.
 *  - With a phone or Joy-Con, pointing moves the glove cursor; the trigger (or A) selects.
 * Only elements inside the top screen are reachable, so screens underneath can't be clicked by accident.
 */
export class Nav {
  hot: HTMLElement | null = null;
  /** Off while a match is being played (the match uses the controller for bowling). */
  enabled = true;
  private readonly glove: HTMLElement;
  private px = innerWidth / 2;
  private py = innerHeight / 2;
  private ref: Quat | null = null;
  private prev = { trigger: false, a: false, b: false };
  private motionActive = false;

  constructor(private readonly screens: ScreenManager, glove: HTMLElement) {
    this.glove = glove;
    addEventListener('keydown', e => this.onKey(e));
    addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') { this.motionActive = false; this.moveGlove(e.clientX, e.clientY); }
    });
    addEventListener('pointerdown', () => this.glove.classList.add('down'));
    addEventListener('pointerup', () => this.glove.classList.remove('down'));
    // Hovering an element highlights it, so mouse and keyboard share one "hot" item.
    document.addEventListener('pointerover', e => {
      const t = (e.target as HTMLElement | null)?.closest?.('[data-nav]') as HTMLElement | null;
      if (t && this.inTop(t)) this.setHot(t);
    });
  }

  private root(): HTMLElement | null { return this.screens.top?.el ?? null; }
  private inTop(el: HTMLElement): boolean { const r = this.root(); return !!r && r.contains(el); }

  /** Visible, enabled nav targets in the top screen (an open modal inside it wins). */
  items(): HTMLElement[] {
    const r = this.root();
    if (!r) return [];
    const modal = r.querySelector<HTMLElement>('.modal.show');
    const scope = modal ?? r;
    return [...scope.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => {
      if ((el as HTMLButtonElement).disabled) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
  }

  setHot(el: HTMLElement | null, silent = false): void {
    if (el === this.hot) return;
    this.hot?.classList.remove('hot');
    this.hot = el;
    if (el) {
      el.classList.add('hot');
      if (document.activeElement !== el && !(document.activeElement instanceof HTMLInputElement)) el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      if (!silent) sfx.tick();
    }
  }

  /** Call after a screen changes so the highlight lands on something sensible. */
  refresh(): void {
    const items = this.items();
    if (this.hot && items.includes(this.hot)) return;
    const pref = items.find(i => i.hasAttribute('data-autofocus')) ?? null;
    this.setHot(pref, true);
  }

  private onKey(e: KeyboardEvent): void {
    const top = this.screens.top;
    if (top?.onKey(e)) return;
    // During a match only Esc (pause) goes through; the controller owns everything else.
    if (!this.enabled) { if (e.key === 'Escape') { e.preventDefault(); this.back(); } return; }
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text';
    const dirs: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (e.key in dirs) {
      if (typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      e.preventDefault();
      this.move(dirs[e.key]);
    } else if (e.key === 'Enter' || (e.key === ' ' && !typing)) {
      if (this.hot && !(typing && this.hot === document.activeElement)) { e.preventDefault(); this.activate(this.hot); }
    } else if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
      e.preventDefault();
      this.back();
    }
  }

  back(): void { sfx.back(); this.screens.back(); }

  activate(el: HTMLElement): void {
    if (el instanceof HTMLInputElement && el.type === 'text') { el.focus(); return; }
    el.click();
  }

  move(dir: Dir): void {
    const items = this.items();
    if (!items.length) return;
    if (!this.hot || !items.includes(this.hot)) { this.setHot(items[0]); return; }
    const from = this.hot.getBoundingClientRect();
    const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of items) {
      if (el === this.hot) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
      const along = dx * v[0] + dy * v[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * v[1] - dy * v[0]);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.setHot(best);
  }

  private moveGlove(x: number, y: number): void {
    this.px = x; this.py = y;
    this.glove.style.transform = `translate(${x - 9}px, ${y - 4}px) rotate(-18deg)`;
  }

  /** Forget the motion pointer's centre (after recalibration, or when a controller connects). */
  recentre(): void { this.ref = null; }

  /** Feed controller samples; while menus show, pointing becomes a cursor. In a match only B (pause) is used. */
  feed(s: InputSample): void {
    if (!this.enabled) {
      if (s.buttons.b && !this.prev.b) this.screens.back();
      this.prev = { ...s.buttons };
      return;
    }
    if (!this.ref) this.ref = s.orientation;
    const rel = qToEuler(qMul(qConj(this.ref), s.orientation));
    const x = innerWidth / 2 - (rel.yaw / 0.5) * (innerWidth / 2);
    const y = innerHeight / 2 - (rel.pitch / 0.35) * (innerHeight / 2);
    const tx = Math.max(0, Math.min(innerWidth, x)), ty = Math.max(0, Math.min(innerHeight, y));
    const moved = Math.hypot(tx - this.px, ty - this.py) > 2;
    if (moved || this.motionActive) {
      this.motionActive = true;
      this.moveGlove(this.px + (tx - this.px) * 0.35, this.py + (ty - this.py) * 0.35);
      const under = document.elementFromPoint(this.px, this.py)?.closest('[data-nav]') as HTMLElement | null;
      if (under && this.inTop(under)) this.setHot(under);
    }
    const b = s.buttons;
    if ((b.trigger && !this.prev.trigger) || (b.a && !this.prev.a)) {
      this.glove.classList.add('down');
      if (this.hot) this.activate(this.hot);
    }
    if (!b.trigger && this.prev.trigger) this.glove.classList.remove('down');
    if (b.b && !this.prev.b) this.back();
    this.prev = { ...b };
  }
}
