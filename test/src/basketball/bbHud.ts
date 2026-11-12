import { t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; parent?.appendChild(e); return e;
};

export type BBCallKind = 'make' | 'money' | 'miss' | 'big' | 'fire' | 'score' | 'count';
export type RackBall = 'ready' | 'money' | 'made' | 'missed' | 'gone';

/**
 * Basketball HUD. Contest: player, score, clock, the rack's five balls (money ball in gold), which rack
 * you're at, the streak and an ON FIRE badge, plus the practice read-out of the last shot. Pickup: both
 * teams' scores, the target, who has the ball and "take it back" when the ball must be cleared. Shared:
 * centre call-outs, the PERFECT / GOOD / EARLY / LATE label, the mouse power meter, hints, replay banner.
 */
export class BBHud {
  private readonly root: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly callEl: HTMLDivElement;
  private readonly gradeEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly replayEl: HTMLDivElement;
  private readonly keysEl: HTMLDivElement;
  private readonly meterEl: HTMLDivElement;
  private readonly meterFill: HTMLDivElement;
  private readonly meterSweet: HTMLDivElement;
  private readonly practiceEl: HTMLDivElement;
  private readonly fireEl: HTMLDivElement;
  private callT = 0;
  private gradeT = 0;
  private hintT = 0;
  private keysKey = 'bb.keys.contest';
  calm = false;

  constructor(ui: HTMLElement) {
    this.root = el('div', 'bb-hud', ui);
    this.board = el('div', 'bb-board', this.root);
    this.fireEl = el('div', 'bb-fire', this.root);
    this.callEl = el('div', 'bb-call', this.root);
    this.gradeEl = el('div', 'bb-grade', this.root);
    this.meterEl = el('div', 'bb-meter', this.root);
    this.meterSweet = el('div', 'bb-meter-sweet', this.meterEl);
    this.meterFill = el('div', 'bb-meter-fill', this.meterEl);
    this.practiceEl = el('div', 'bb-practice', this.root);
    this.hintEl = el('div', 'hud-hint', this.root);
    this.replayEl = el('div', 'bb-replay', this.root);
    this.keysEl = el('div', 'hud-keys', this.root);
    this.relabel();
  }

  setKeys(key: string): void { this.keysKey = key; this.keysEl.textContent = t(key); }

  relabel(): void {
    this.keysEl.textContent = t(this.keysKey);
    this.replayEl.textContent = t('bb.replay');
    this.fireEl.textContent = t('bb.onFire');
  }

  /** Contest board. `clock` null = practice (no clock). */
  contest(o: { name: string; color: string; score: number; clock: number | null; balls: RackBall[]; rack: number; streak: number; next?: string }): void {
    const b = this.board;
    b.replaceChildren();
    const head = el('div', 'bb-head', b);
    const dot = el('span', 'dot', head); dot.style.background = o.color;
    el('b', 'bb-name', head, o.name);
    el('span', 'bb-score', head, String(o.score));
    if (o.clock !== null) {
      const c = el('div', 'bb-clock' + (o.clock <= 10 ? ' hot' : ''), b, o.clock >= 10 ? String(Math.ceil(o.clock)) : o.clock.toFixed(1));
      c.setAttribute('aria-label', t('bb.clock'));
    }
    const balls = el('div', 'bb-balls', b);
    for (const s of o.balls) el('span', `bb-ball ${s}`, balls);
    const racks = el('div', 'bb-racks', b);
    for (let i = 0; i < 5; i++) el('span', 'bb-rack' + (i === o.rack ? ' on' : i < o.rack ? ' done' : ''), racks);
    if (o.streak >= 2) el('div', 'bb-streak', b, t('bb.streak', { n: o.streak }));
    if (o.next) el('div', 'bb-next', b, o.next);
  }

  /** Pickup board. */
  pickup(o: { teams: Array<{ name: string; color: string; score: number }>; target: number; offense: number; clear: boolean }): void {
    const b = this.board;
    b.replaceChildren();
    o.teams.forEach((tm, i) => {
      const row = el('div', 'bb-team' + (i === o.offense ? ' ball' : ''), b);
      const dot = el('span', 'dot', row); dot.style.background = tm.color;
      el('b', 'bb-name', row, tm.name);
      el('span', 'bb-poss', row, i === o.offense ? '●' : '');
      el('span', 'bb-score', row, String(tm.score));
    });
    el('div', 'bb-note', b, t('bb.firstTo', { n: o.target }));
    if (o.clear) el('div', 'bb-clear', b, t('bb.takeBack'));
  }

  setFire(on: boolean): void { this.fireEl.classList.toggle('show', on); }

  call(text: string, kind: BBCallKind = 'make', seconds = 1.2): void {
    this.callEl.className = `bb-call show ${kind}${this.calm ? ' calm' : ''}`;
    this.callEl.textContent = text;
    this.callT = seconds;
  }

  /** The release label, near the shooter on screen. */
  grade(text: string, kind: string, x: number, y: number): void {
    this.gradeEl.className = `bb-grade show ${kind}`;
    this.gradeEl.textContent = text;
    this.gradeEl.style.left = `${Math.round(x)}px`;
    this.gradeEl.style.top = `${Math.round(y)}px`;
    this.gradeT = 0.9;
  }

  /** Mouse power meter: value and sweet spot 0..1; null hides it. */
  meter(m: { value: number; sweet: number; width: number } | null): void {
    this.meterEl.classList.toggle('show', !!m);
    if (!m) return;
    this.meterFill.style.height = `${Math.round(m.value * 100)}%`;
    this.meterSweet.style.bottom = `${Math.round((m.sweet - m.width / 2) * 100)}%`;
    this.meterSweet.style.height = `${Math.round(m.width * 100)}%`;
    const inSweet = Math.abs(m.value - m.sweet) <= m.width / 2;
    this.meterEl.classList.toggle('sweet', inSweet);
  }

  /** Practice read-out after each shot (null hides it). */
  practice(lines: string[] | null): void {
    this.practiceEl.classList.toggle('show', !!lines);
    this.practiceEl.replaceChildren();
    for (const l of lines ?? []) el('div', '', this.practiceEl, l);
  }

  hint(text: string, ms = 3500): void { this.hintEl.textContent = text; this.hintEl.classList.add('show'); this.hintT = ms / 1000; }
  replay(on: boolean): void { this.replayEl.classList.toggle('show', on); }
  show(on: boolean): void { this.root.style.display = on ? '' : 'none'; }

  update(dt: number): void {
    if (this.callT > 0) { this.callT -= dt; if (this.callT <= 0) this.callEl.classList.remove('show'); }
    if (this.gradeT > 0) { this.gradeT -= dt; if (this.gradeT <= 0) this.gradeEl.classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
  }

  dispose(): void { this.root.remove(); }
}
