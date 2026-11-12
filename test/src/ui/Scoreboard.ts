import { cumulativeScores, frameMarks } from '../game/Scoring';
import { hundredCumulative, hundredMarks } from '../sports/scoringHundred';
import { t } from '../i18n';

export interface ScoreRow { name: string; color: string; rolls: number[]; handicap: number }
export type ScoreKind = 'tenpin' | 'pinTotal';

/** Classic frame-layout scoreboard for both bowling modes. Tab pins it open; it also pops up briefly after every ball. */
export class Scoreboard {
  private readonly root: HTMLDivElement;
  private pinned = false;
  private popT = 0;

  constructor(ui: HTMLElement, private kind: ScoreKind = 'tenpin', private frames = 10) {
    this.root = document.createElement('div');
    this.root.className = 'scoreboard';
    ui.appendChild(this.root);
  }

  render(rows: ScoreRow[], current: number): void {
    const F = this.frames;
    const anyHcp = rows.some(r => r.handicap > 0);
    const tbl = document.createElement('table');
    const head = tbl.insertRow();
    const th = (text: string) => { const c = document.createElement('th'); c.textContent = text; head.appendChild(c); };
    th('');
    for (let f = 1; f <= F; f++) th(String(f));
    if (anyHcp) th(t('common.handicapShort'));
    th(t('common.total'));

    rows.forEach((r, i) => {
      const tr = tbl.insertRow();
      if (i === current) tr.className = 'current';
      const nameCell = tr.insertCell();
      nameCell.className = 'pname';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = r.color;
      nameCell.append(dot, document.createTextNode(r.name));
      const hundred = this.kind === 'pinTotal';
      const marks = hundred ? hundredMarks(r.rolls, F) : frameMarks(r.rolls, F);
      const cum: Array<number | null> = hundred ? hundredCumulative(r.rolls, F) : cumulativeScores(r.rolls, F);
      let total = 0;
      for (let f = 0; f < F; f++) {
        const last = f === F - 1;
        const cell = tr.insertCell(); cell.className = `frame${last && !hundred ? ' tenth' : ''}${hundred ? ' wide' : ''}`;
        const boxes = document.createElement('div'); boxes.className = 'boxes';
        const m = marks[f] ?? [];
        // ten-pin frames show a strike in the right-hand box, like a real scoresheet
        const shown = hundred ? [m[0] ?? '', m[1] ?? '']
          : !last ? (m[0] === 'X' ? ['', 'X'] : [m[0] ?? '', m[1] ?? '']) : [m[0] ?? '', m[1] ?? '', m[2] ?? ''];
        for (const s of shown) { const b = document.createElement('span'); b.className = 'box'; b.textContent = s; boxes.appendChild(b); }
        const sc = document.createElement('div'); sc.className = 'cum';
        const v = cum[f];
        sc.textContent = v === null || v === undefined ? '' : String(v);
        if (typeof v === 'number') total = v;
        cell.append(boxes, sc);
      }
      if (anyHcp) { const hc = tr.insertCell(); hc.className = 'hcp'; hc.textContent = r.handicap ? `+${r.handicap}` : ''; }
      const tc = tr.insertCell(); tc.className = 'total'; tc.textContent = String(total + r.handicap);
    });
    this.root.replaceChildren(tbl);
  }

  toggle(): void { this.pinned = !this.pinned; this.apply(); }
  showFor(ms: number): void { this.popT = ms / 1000; this.apply(); }
  hideAll(): void { this.pinned = false; this.popT = 0; this.apply(); }

  update(dt: number): void {
    if (this.popT > 0) { this.popT -= dt; if (this.popT <= 0) this.apply(); }
  }

  private apply(): void { this.root.classList.toggle('show', this.pinned || this.popT > 0); }

  dispose(): void { this.root.remove(); }
}
