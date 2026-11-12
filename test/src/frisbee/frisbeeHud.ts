import { t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; parent?.appendChild(e); return e;
};

export type FBCallKind = 'catch' | 'big' | 'miss' | 'score' | 'ace' | 'water';

export interface ScorecardRow { name: string; color: string; strokes: Array<number | null>; total: number; vsPar: number }

/**
 * Frisbee HUD. Shared: the board (top left), wind arrow (top right), centre call-outs, the distance /
 * zone read-out, the mouse slingshot (pull line plus bank and nose sliders), hints, the practice read-out
 * and the key line. Golf adds the disc picker, hole info, the scorecard grid and a slot for the mini-map.
 */
export class FBHud {
  readonly root: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly windEl: HTMLDivElement;
  private readonly windArrow: HTMLDivElement;
  private readonly windText: HTMLDivElement;
  private readonly callEl: HTMLDivElement;
  private readonly distEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly keysEl: HTMLDivElement;
  private readonly practiceEl: HTMLDivElement;
  private readonly sliders: HTMLDivElement;
  private readonly bankFill: HTMLDivElement;
  private readonly noseFill: HTMLDivElement;
  private readonly bankVal: HTMLSpanElement;
  private readonly noseVal: HTMLSpanElement;
  private readonly sling: SVGSVGElement;
  private readonly slingLine: SVGLineElement;
  private readonly slingPow: SVGCircleElement;
  private readonly discs: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly gripEl: HTMLDivElement;
  readonly mapSlot: HTMLDivElement;
  private callT = 0;
  private hintT = 0;
  private distT = 0;
  private keysKey = 'fb.keys.dog';
  private discKey = '';
  calm = false;

  constructor(ui: HTMLElement) {
    this.root = el('div', 'fb-hud', ui);
    this.board = el('div', 'fb-board', this.root);
    this.windEl = el('div', 'fb-wind', this.root);
    this.windArrow = el('div', 'fb-wind-arrow', this.windEl, '➤');
    this.windText = el('div', 'fb-wind-text', this.windEl);
    this.callEl = el('div', 'fb-call', this.root);
    this.distEl = el('div', 'fb-dist', this.root);
    this.gripEl = el('div', 'fb-grip', this.root);
    this.practiceEl = el('div', 'fb-practice', this.root);
    this.sliders = el('div', 'fb-sliders', this.root);
    const row = (label: string): [HTMLDivElement, HTMLSpanElement] => {
      const r = el('div', 'fb-slider', this.sliders);
      el('span', 'fb-slider-label', r, label);
      const bar = el('div', 'fb-slider-bar', r);
      const fill = el('div', 'fb-slider-fill', bar);
      const v = el('span', 'fb-slider-val', r);
      return [fill, v];
    };
    [this.bankFill, this.bankVal] = row(t('fb.bank'));
    [this.noseFill, this.noseVal] = row(t('fb.nose'));
    const NS = 'http://www.w3.org/2000/svg';
    this.sling = document.createElementNS(NS, 'svg');
    this.sling.setAttribute('class', 'fb-sling');
    this.slingLine = document.createElementNS(NS, 'line');
    this.slingPow = document.createElementNS(NS, 'circle');
    this.slingPow.setAttribute('r', '10');
    this.sling.append(this.slingLine, this.slingPow);
    this.root.appendChild(this.sling);
    this.discs = el('div', 'fb-discs', this.root);
    this.card = el('div', 'fb-card', this.root);
    this.mapSlot = el('div', 'fb-map', this.root);
    this.hintEl = el('div', 'hud-hint', this.root);
    this.keysEl = el('div', 'hud-keys', this.root);
    this.relabel();
  }

  setKeys(key: string): void { this.keysKey = key; this.keysEl.textContent = t(key); }
  relabel(): void { this.keysEl.textContent = t(this.keysKey); }

  /** Board lines: a title row (name with colour dot) and value rows. */
  setBoard(o: { name: string; color: string; big: string; rows: Array<[string, string]>; badge?: string }): void {
    const b = this.board;
    b.replaceChildren();
    const head = el('div', 'fb-head', b);
    const dot = el('span', 'dot', head); dot.style.background = o.color;
    el('b', 'fb-name', head, o.name);
    el('span', 'fb-big', head, o.big);
    for (const [k, v] of o.rows) { const r = el('div', 'fb-row', b); el('span', '', r, k); el('b', '', r, v); }
    if (o.badge) el('div', 'fb-badge', b, o.badge);
  }

  /** Wind toward `relDeg` relative to the camera (0 = away from you), `speed` m/s; null hides it. */
  wind(relDeg: number | null, speed = 0): void {
    this.windEl.classList.toggle('show', relDeg !== null && speed > 0.2);
    if (relDeg === null) return;
    // the glyph points right; rotate so 0° points up the screen
    this.windArrow.style.transform = `rotate(${relDeg - 90}deg)`;
    this.windText.textContent = t('fb.windSpeed', { n: speed.toFixed(1) });
    this.windEl.classList.toggle('strong', speed >= 5);
  }

  call(text: string, kind: FBCallKind = 'catch', seconds = 1.4): void {
    this.callEl.className = `fb-call show ${kind}${this.calm ? ' calm' : ''}`;
    this.callEl.textContent = text;
    this.callT = seconds;
  }

  /** Distance / zone read-out under the centre. */
  distance(text: string | null, seconds = 2.5): void {
    this.distEl.classList.toggle('show', !!text);
    this.distEl.textContent = text ?? '';
    this.distT = text ? seconds : 0;
  }

  /** "Grip" indicator while the trigger is held. */
  grip(on: boolean, text = ''): void { this.gripEl.classList.toggle('show', on); this.gripEl.textContent = text; }

  /** Mouse sliders: bank −35…35, nose −5…25. null hides them. */
  slingSliders(v: { bank: number; nose: number } | null): void {
    this.sliders.classList.toggle('show', !!v);
    if (!v) return;
    const bk = (v.bank + 35) / 70, ns = (v.nose + 5) / 30;
    this.bankFill.style.left = `${Math.round(Math.min(bk, 0.5) * 100)}%`;
    this.bankFill.style.width = `${Math.round(Math.abs(bk - 0.5) * 100)}%`;
    this.noseFill.style.width = `${Math.round(ns * 100)}%`;
    this.bankVal.textContent = v.bank === 0 ? t('fb.flat') : `${Math.abs(Math.round(v.bank))}° ${v.bank < 0 ? t('fb.bankLeft') : t('fb.bankRight')}`;
    this.noseVal.textContent = `${Math.round(v.nose)}°`;
  }

  /** The pull line of the slingshot (screen px) and its power 0..1; null hides it. */
  slingLineAt(a: { x: number; y: number } | null, b?: { x: number; y: number }, power = 0): void {
    this.sling.classList.toggle('show', !!a);
    if (!a || !b) return;
    this.slingLine.setAttribute('x1', String(a.x)); this.slingLine.setAttribute('y1', String(a.y));
    this.slingLine.setAttribute('x2', String(b.x)); this.slingLine.setAttribute('y2', String(b.y));
    this.slingPow.setAttribute('cx', String(b.x)); this.slingPow.setAttribute('cy', String(b.y));
    this.slingPow.setAttribute('r', String(8 + power * 10));
    this.sling.style.setProperty('--pow', String(power));
  }

  /** Golf disc picker: ids with labels, the selected and the recommended one; null hides it. */
  discPicker(list: Array<{ id: string; label: string; color: string }> | null, sel = '', rec = ''): void {
    // called every frame while aiming: only touch the DOM when something changed
    const key = list ? `${list.map(d => d.label).join(',')}|${sel}|${rec}` : '';
    if (key === this.discKey) return;
    this.discKey = key;
    this.discs.replaceChildren();
    this.discs.classList.toggle('show', !!list);
    for (const d of list ?? []) {
      const c = el('div', 'fb-disc' + (d.id === sel ? ' on' : '') + (d.id === rec ? ' rec' : ''), this.discs);
      const sw = el('span', 'sw', c); sw.style.background = d.color;
      el('span', '', c, d.label);
      if (d.id === rec) el('small', '', c, t('fb.recommended'));
    }
  }

  /** Scorecard grid (golf); null hides it. */
  scorecard(o: { title: string; pars: number[]; rows: ScorecardRow[]; current: number } | null): void {
    this.card.classList.toggle('show', !!o);
    this.card.replaceChildren();
    if (!o) return;
    el('div', 'fb-card-title', this.card, o.title);
    const tb = el('table', 'fb-grid', this.card);
    const head = el('tr', '', tb);
    el('th', '', head, t('fb.hole'));
    o.pars.forEach((_, i) => el('th', i === o.current ? 'cur' : '', head, String(i + 1)));
    el('th', '', head, t('fb.total'));
    const parRow = el('tr', 'par', tb);
    el('td', '', parRow, t('fb.par'));
    o.pars.forEach(p => el('td', '', parRow, String(p)));
    el('td', '', parRow, String(o.pars.reduce((a, b) => a + b, 0)));
    for (const r of o.rows) {
      const tr = el('tr', '', tb);
      const nm = el('td', 'nm', tr); const dot = el('span', 'dot', nm); dot.style.background = r.color; el('span', '', nm, r.name);
      r.strokes.forEach((s, i) => {
        const d = s === null ? 0 : s - o.pars[i];
        el('td', s === null ? '' : d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'parv' : d === 1 ? 'bogey' : 'dbl', tr, s === null ? '' : String(s));
      });
      el('td', 'tot', tr, `${r.total} (${r.vsPar > 0 ? '+' : ''}${r.vsPar === 0 ? 'E' : r.vsPar})`);
    }
  }

  practice(lines: string[] | null): void {
    this.practiceEl.classList.toggle('show', !!lines);
    this.practiceEl.replaceChildren();
    for (const l of lines ?? []) el('div', '', this.practiceEl, l);
  }

  hint(text: string, ms = 3500): void { this.hintEl.textContent = text; this.hintEl.classList.add('show'); this.hintT = ms / 1000; }

  update(dt: number): void {
    if (this.callT > 0) { this.callT -= dt; if (this.callT <= 0) this.callEl.classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
    if (this.distT > 0) { this.distT -= dt; if (this.distT <= 0) this.distEl.classList.remove('show'); }
  }

  dispose(): void { this.root.remove(); }
}
