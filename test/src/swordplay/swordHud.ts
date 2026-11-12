import { t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; parent?.appendChild(e); return e;
};

export type SWCallKind = 'perfect' | 'good' | 'miss' | 'ko' | 'parry' | 'big' | 'bad';

/** Arrow glyph rotated to a screen angle (degrees, 0 = right, 90 = up). */
const ARROW = '➜';

interface Telegraph { root: HTMLDivElement; arrow: HTMLDivElement; ring: HTMLDivElement; used: boolean }
interface Popup { el: HTMLDivElement; t: number }

/**
 * Swordplay HUD (DOM). Shared parts: a score board, centre call-outs, floating point pop-ups, telegraph
 * arrows over attackers, the guard read-out, hints and the key line. Duel adds the two health bars with
 * stagger meters, round pips and the clock; Showdown adds health, hearts and the stage name; Speed Slice's
 * practice adds the expected-vs-actual direction panel.
 */
export class SwordHud {
  readonly root: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly callEl: HTMLDivElement;
  private readonly guardEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly keysEl: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly duelEl: HTMLDivElement;
  private readonly bars: Array<{ name: HTMLDivElement; hp: HTMLDivElement; ghost: HTMLDivElement; meter: HTMLDivElement; pips: HTMLDivElement }> = [];
  private readonly lifeEl: HTMLDivElement;
  private readonly lifeFill: HTMLDivElement;
  private readonly heartsEl: HTMLDivElement;
  private readonly stageEl: HTMLDivElement;
  private readonly practiceEl: HTMLDivElement;
  private readonly wantArrow: HTMLDivElement;
  private readonly gotArrow: HTMLDivElement;
  private readonly practiceText: HTMLDivElement;
  private readonly popLayer: HTMLDivElement;
  private readonly tgLayer: HTMLDivElement;
  private readonly telegraphs: Telegraph[] = [];
  private readonly popups: Popup[] = [];
  private readonly ghost = [100, 100];
  private callT = 0;
  private hintT = 0;
  private keysKey = 'sw.keys.slice';
  calm = false;

  constructor(ui: HTMLElement) {
    this.root = el('div', 'sw-hud', ui);
    this.board = el('div', 'sw-board', this.root);
    this.clockEl = el('div', 'sw-clock', this.root);
    this.duelEl = el('div', 'sw-duel', this.root);
    for (let i = 0; i < 2; i++) {
      const side = el('div', `sw-side s${i}`, this.duelEl);
      const name = el('div', 'sw-name', side);
      const bar = el('div', 'sw-hp', side);
      const ghost = el('div', 'sw-hp-ghost', bar);
      const hp = el('div', 'sw-hp-fill', bar);
      const mbar = el('div', 'sw-meter', side);
      const meter = el('div', 'sw-meter-fill', mbar);
      const pips = el('div', 'sw-pips', side);
      this.bars.push({ name, hp, ghost, meter, pips });
    }
    this.lifeEl = el('div', 'sw-life', this.root);
    const lb = el('div', 'sw-hp', this.lifeEl);
    this.lifeFill = el('div', 'sw-hp-fill', lb);
    this.heartsEl = el('div', 'sw-hearts', this.lifeEl);
    this.stageEl = el('div', 'sw-stage', this.root);
    this.callEl = el('div', 'sw-call', this.root);
    this.guardEl = el('div', 'sw-guard', this.root);
    this.practiceEl = el('div', 'sw-practice', this.root);
    const row = el('div', 'sw-practice-row', this.practiceEl);
    const want = el('div', 'sw-practice-cell', row); el('small', '', want, t('sw.practice.want'));
    this.wantArrow = el('div', 'sw-practice-arrow want', want, ARROW);
    const got = el('div', 'sw-practice-cell', row); el('small', '', got, t('sw.practice.got'));
    this.gotArrow = el('div', 'sw-practice-arrow got', got, ARROW);
    this.practiceText = el('div', 'sw-practice-text', this.practiceEl);
    this.popLayer = el('div', 'sw-pops', this.root);
    this.tgLayer = el('div', 'sw-tgs', this.root);
    this.hintEl = el('div', 'hud-hint', this.root);
    this.keysEl = el('div', 'hud-keys', this.root);
    this.relabel();
  }

  setKeys(key: string): void { this.keysKey = key; this.keysEl.textContent = t(key); }
  relabel(): void { this.keysEl.textContent = t(this.keysKey); }

  setBoard(o: { name: string; color: string; big: string; rows: Array<[string, string]>; badge?: string } | null): void {
    const b = this.board;
    b.classList.toggle('show', !!o);
    if (!o) return;
    b.replaceChildren();
    const head = el('div', 'sw-head', b);
    const dot = el('span', 'dot', head); dot.style.background = o.color;
    el('span', 'sw-board-name', head, o.name);
    el('span', 'sw-big', head, o.big);
    for (const [k, v] of o.rows) { const r = el('div', 'sw-row', b); el('span', '', r, k); el('b', '', r, v); }
    if (o.badge) el('div', 'sw-badge', b, o.badge);
  }

  clock(text: string | null, urgent = false): void {
    this.clockEl.classList.toggle('show', text !== null);
    this.clockEl.classList.toggle('urgent', urgent);
    if (text !== null) this.clockEl.textContent = text;
  }

  call(text: string, kind: SWCallKind = 'good', seconds = 1.1): void {
    this.callEl.className = `sw-call show ${kind}${this.calm ? ' calm' : ''}`;
    this.callEl.textContent = text;
    this.callT = seconds;
  }

  /** A floating "+250" at a screen position (px). */
  popup(text: string, x: number, y: number, kind: 'good' | 'bad' | 'gold' = 'good'): void {
    let p = this.popups.find(q => q.t <= 0);
    if (!p) {
      if (this.popups.length >= 12) p = this.popups[0];
      else { p = { el: el('div', 'sw-pop', this.popLayer), t: 0 }; this.popups.push(p); }
    }
    p.el.className = `sw-pop show ${kind}`;
    p.el.textContent = text;
    p.el.style.left = `${x}px`; p.el.style.top = `${y}px`;
    p.t = 0.9;
  }

  hint(text: string | null, seconds = 3): void {
    this.hintEl.textContent = text ?? '';
    this.hintEl.classList.toggle('show', !!text);
    this.hintT = text ? seconds : 0;
  }

  /** Current guard (null = none). */
  guard(zone: string | null): void {
    this.guardEl.classList.toggle('show', !!zone);
    if (zone) this.guardEl.textContent = `${t('sw.guard')} · ${t(`sw.zone.${zone}`)}`;
  }

  /* ---------------- duel ---------------- */

  duel(o: {
    names: [string, string]; colors: [string, string]; hp: [number, number]; meter: [number, number];
    wins: [number, number]; toWin: number; staggered: [boolean, boolean];
  } | null): void {
    this.duelEl.classList.toggle('show', !!o);
    if (!o) return;
    for (let i = 0; i < 2; i++) {
      const b = this.bars[i];
      b.name.textContent = o.names[i];
      b.name.style.color = o.colors[i];
      b.hp.style.width = `${Math.max(0, o.hp[i])}%`;
      b.hp.style.background = o.colors[i];
      b.meter.style.width = `${Math.min(100, o.meter[i])}%`;
      b.meter.parentElement!.classList.toggle('stun', o.staggered[i]);
      b.ghost.style.width = `${Math.max(0, this.ghost[i])}%`;
      if (b.pips.childElementCount !== o.toWin) { b.pips.replaceChildren(); for (let k = 0; k < o.toWin; k++) el('span', 'pip', b.pips); }
      [...b.pips.children].forEach((c, k) => c.classList.toggle('on', k < o.wins[i]));
    }
    // the light "ghost" bar trails the real one so a hit reads as a chunk
    for (let i = 0; i < 2; i++) this.ghost[i] = Math.max(o.hp[i], this.ghost[i] - 0.6);
  }

  resetGhost(): void { this.ghost[0] = 100; this.ghost[1] = 100; }

  /* ---------------- showdown ---------------- */

  life(o: { hp: number; hearts: number; stage: string } | null): void {
    this.lifeEl.classList.toggle('show', !!o);
    this.stageEl.classList.toggle('show', !!o);
    if (!o) return;
    this.lifeFill.style.width = `${Math.max(0, o.hp)}%`;
    this.lifeFill.style.background = o.hp > 50 ? '#3bb37a' : o.hp > 25 ? '#ffb020' : '#ff5a5f';
    this.heartsEl.textContent = '♥'.repeat(Math.max(0, o.hearts));
    this.stageEl.textContent = o.stage;
  }

  /* ---------------- telegraphs ---------------- */

  /** Start a frame of telegraph arrows; then call telegraph() for each, then endTelegraphs(). */
  beginTelegraphs(): void { for (const tg of this.telegraphs) tg.used = false; }

  /**
   * An attack coming: an arrow at a screen position (px) showing the blade's movement as the player sees
   * it (degrees, 0 = right, 90 = up; null = a thrust, drawn as a dot), filling up to the hit.
   */
  telegraph(x: number, y: number, angle: number | null, progress: number, label = ''): void {
    let tg = this.telegraphs.find(q => !q.used);
    if (!tg) {
      if (this.telegraphs.length >= 8) return;
      const root = el('div', 'sw-tg', this.tgLayer);
      tg = { root, arrow: el('div', 'sw-tg-arrow', root, ARROW), ring: el('div', 'sw-tg-ring', root), used: false };
      this.telegraphs.push(tg);
    }
    tg.used = true;
    tg.root.classList.add('show');
    tg.root.classList.toggle('thrust', angle === null);
    tg.root.style.transform = `translate(${x}px, ${y}px)`;
    tg.arrow.style.transform = angle === null ? 'none' : `rotate(${-angle}deg)`;
    tg.arrow.textContent = angle === null ? '●' : ARROW;
    tg.ring.style.setProperty('--p', String(Math.max(0, Math.min(1, progress))));
    tg.root.dataset.label = label;
  }

  endTelegraphs(): void { for (const tg of this.telegraphs) if (!tg.used) tg.root.classList.remove('show'); }

  /* ---------------- practice ---------------- */

  practice(o: { want: number | null; got: number | null; text: string } | null): void {
    this.practiceEl.classList.toggle('show', !!o);
    if (!o) return;
    this.wantArrow.style.transform = o.want === null ? 'none' : `rotate(${-o.want}deg)`;
    this.wantArrow.style.opacity = o.want === null ? '0.2' : '1';
    this.gotArrow.style.transform = o.got === null ? 'none' : `rotate(${-o.got}deg)`;
    this.gotArrow.style.opacity = o.got === null ? '0.2' : '1';
    this.practiceText.textContent = o.text;
  }

  update(dt: number): void {
    if (this.callT > 0) { this.callT -= dt; if (this.callT <= 0) this.callEl.classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
    for (const p of this.popups) if (p.t > 0) { p.t -= dt; if (p.t <= 0) p.el.classList.remove('show'); }
  }

  hideAll(): void {
    this.setBoard(null); this.clock(null); this.duel(null); this.life(null); this.practice(null); this.guard(null);
    this.beginTelegraphs(); this.endTelegraphs();
  }

  dispose(): void { this.root.remove(); }
}
