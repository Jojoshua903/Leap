import type * as THREE from 'three';

/** Something 3D the main loop can draw behind a screen. */
export interface View {
  scene: THREE.Scene;
  camera: THREE.Camera;
  update(dt: number): void;
  resize(w: number, h: number): void;
  dispose?(): void;
  /** Optional fixed-rate step (matches). */
  fixedStep?(dt: number): void;
}

export const TRANSITION_MS = 250;

/**
 * One full-screen state (title, menu, results…). Subclasses build their DOM in `enter`.
 * `view` is the 3D scene drawn behind it; screens without one show the view of the screen below.
 */
export abstract class Screen {
  abstract readonly name: string;
  readonly el: HTMLDivElement;
  view: View | null = null;
  /** Set by the manager. */
  manager!: ScreenManager;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'screen';
  }

  /** Called once when pushed. Build DOM here. */
  abstract enter(): void;
  /** Called once when removed. Undo listeners here; the element is removed for you. */
  exit(): void { /* optional */ }
  /** Another screen was pushed on top. */
  pause(): void { /* optional */ }
  /** The screen on top was popped. */
  resume(): void { /* optional */ }
  /** Back / B / Esc. Return true if handled; otherwise the manager pops this screen. */
  onBack(): boolean { return false; }
  /** Raw key events while this screen is on top. Return true to swallow. */
  onKey(_e: KeyboardEvent): boolean { return false; }
  /** Called each rendered frame while on top. */
  tick(_dt: number): void { /* optional */ }
  /** Called when the language changes, so screens can rebuild their text. */
  relabel(): void { /* optional */ }
  /** Overlay screens (pause, modals) keep the screen below visible. */
  readonly overlay: boolean = false;
}

/**
 * Stack of screens with 250 ms transitions. Push to go deeper, pop to go back,
 * replace to swap without growing the stack, reset to start over (e.g. back to the title).
 */
export class ScreenManager {
  readonly stack: Screen[] = [];
  onChange: (() => void) | null = null;
  /** Reduced motion turns transitions into instant swaps. */
  instant = false;

  constructor(private readonly root: HTMLElement) {}

  get top(): Screen | undefined { return this.stack[this.stack.length - 1]; }

  /** The view to draw: the top-most screen that has one. */
  get view(): View | null {
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].view) return this.stack[i].view;
    return null;
  }

  private mount(s: Screen): void {
    s.manager = this;
    s.el.classList.add(`screen-${s.name}`);
    if (s.overlay) s.el.classList.add('overlay-screen');
    s.el.classList.add('entering');
    this.root.appendChild(s.el);
    s.enter();
    // next frame: remove the class so the CSS transition plays
    requestAnimationFrame(() => requestAnimationFrame(() => s.el.classList.remove('entering')));
  }

  private unmount(s: Screen): void {
    s.exit();
    s.view?.dispose?.();
    s.el.classList.add('leaving');
    const el = s.el;
    window.setTimeout(() => el.remove(), this.instant ? 0 : TRANSITION_MS);
  }

  private cover(s: Screen, next: Screen): void {
    s.pause();
    if (!next.overlay) s.el.classList.add('covered');
  }

  push(s: Screen): void {
    if (this.top) this.cover(this.top, s);
    this.stack.push(s);
    this.mount(s);
    this.onChange?.();
  }

  pop(): void {
    if (this.stack.length <= 1) return;
    const s = this.stack.pop()!;
    this.unmount(s);
    const t = this.top!;
    t.el.classList.remove('covered');
    t.resume();
    this.onChange?.();
  }

  /** Pop until `name` is on top. */
  popTo(name: string): void {
    while (this.stack.length > 1 && this.top?.name !== name) this.pop();
  }

  replace(s: Screen): void {
    const old = this.stack.pop();
    if (old) this.unmount(old);
    this.stack.push(s);
    this.mount(s);
    this.onChange?.();
  }

  /** Clear everything and start from one screen. */
  reset(s: Screen): void {
    while (this.stack.length) this.unmount(this.stack.pop()!);
    this.stack.push(s);
    this.mount(s);
    this.onChange?.();
  }

  back(): void {
    const t = this.top;
    if (!t) return;
    if (!t.onBack()) this.pop();
  }

  relabelAll(): void { for (const s of this.stack) s.relabel(); }
}
