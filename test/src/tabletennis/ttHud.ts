import { t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; parent?.appendChild(e); return e;
};

export type CallKind = 'score' | 'game' | 'deuce' | 'rally' | 'point' | 'big';

/**
 * Table-tennis HUD: the corner scoreboard (points, games, server), centre call-outs ("7–5",
 * "Game point!", "Deuce!", "RALLY ×12"), the rally counter, small EARLY / LATE / PERFECT text at
 * the contact point, the Return Challenge readout (score, lives, combo, level), a hint line and the
 * replay banner.
 */
export class TTHud {
  private readonly root: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly rows: Array<{ row: HTMLDivElement; dot: HTMLSpanElement; name: HTMLElement; games: HTMLElement; pts: HTMLElement; serve: HTMLElement }> = [];
  private readonly boardNote: HTMLDivElement;
  private readonly callEl: HTMLDivElement;
  private readonly rallyEl: HTMLDivElement;
  private readonly gradeEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly replayEl: HTMLDivElement;
  private readonly rcEl: HTMLDivElement;
  private readonly keysEl: HTMLDivElement;
  private callT = 0;
  private gradeT = 0;
  private hintT = 0;
  calm = false;

  constructor(ui: HTMLElement) {
    this.root = el('div', 'tt-hud', ui);
    this.board = el('div', 'tt-board', this.root);
    for (let i = 0; i < 2; i++) {
      const row = el('div', 'tt-row', this.board);
      const serve = el('span', 'tt-serve', row, '●');
      const dot = el('span', 'dot', row);
      const name = el('b', 'tt-name', row);
      const games = el('span', 'tt-games', row);
      const pts = el('span', 'tt-pts', row);
      this.rows.push({ row, dot, name, games, pts, serve });
    }
    this.boardNote = el('div', 'tt-note', this.board);
    this.rcEl = el('div', 'tt-rc', this.root);
    this.callEl = el('div', 'tt-call', this.root);
    this.rallyEl = el('div', 'tt-rally', this.root);
    this.gradeEl = el('div', 'tt-grade', this.root);
    this.hintEl = el('div', 'hud-hint', this.root);
    this.replayEl = el('div', 'tt-replay', this.root);
    this.keysEl = el('div', 'hud-keys', this.root);
    this.relabel();
  }

  relabel(): void {
    this.keysEl.textContent = t('tt.keys');
    this.replayEl.textContent = t('tt.replay');
  }

  setPlayers(players: Array<{ name: string; color: string }>): void {
    this.rows.forEach((r, i) => {
      const p = players[i];
      r.row.style.display = p ? '' : 'none';
      if (!p) return;
      r.name.textContent = p.name;
      r.dot.style.background = p.color;
    });
  }

  /** Corner scoreboard. `note` is a short line under it (e.g. "Best of 3"). */
  setScore(points: [number, number], games: [number, number], server: 0 | 1 | null, note = ''): void {
    this.board.style.display = '';
    this.rcEl.style.display = 'none';
    this.rows.forEach((r, i) => {
      r.pts.textContent = String(points[i]);
      r.games.textContent = String(games[i]);
      r.serve.style.visibility = server === i ? 'visible' : 'hidden';
    });
    this.boardNote.textContent = note;
  }

  /** Return Challenge readout instead of the scoreboard. */
  setReturnStats(score: number, lives: number, maxLives: number, multiplier: number, level: number, best: number): void {
    this.board.style.display = 'none';
    this.rcEl.style.display = '';
    const hearts = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, maxLives - lives));
    this.rcEl.innerHTML = '';
    el('div', 'tt-rc-score', this.rcEl, String(score));
    el('div', 'tt-rc-lives', this.rcEl, hearts);
    el('div', 'tt-rc-line', this.rcEl, `${t('tt.combo')} ×${multiplier} · ${t('tt.level', { n: level })}`);
    if (best > 0) el('div', 'tt-rc-line', this.rcEl, `${t('tt.res.best')} ${best}`);
  }

  /** Centre call-out, e.g. "7–5", "Game point!", "Deuce!", "RALLY ×12". */
  call(text: string, kind: CallKind = 'score', seconds = 1.4): void {
    this.callEl.className = `tt-call show ${kind}${this.calm ? ' calm' : ''}`;
    this.callEl.textContent = text;
    this.callT = seconds;
  }

  rally(n: number): void {
    this.rallyEl.textContent = n >= 2 ? t('tt.rallyCount', { n }) : '';
    this.rallyEl.classList.toggle('hot', n >= 10);
  }

  /** Small EARLY / LATE / PERFECT / MISS text at a screen position (px). */
  grade(text: string, kind: string, x: number, y: number): void {
    this.gradeEl.className = `tt-grade show ${kind}`;
    this.gradeEl.textContent = text;
    this.gradeEl.style.left = `${Math.round(x)}px`;
    this.gradeEl.style.top = `${Math.round(y)}px`;
    this.gradeT = 0.7;
  }

  hint(text: string, ms = 3500): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    this.hintT = ms / 1000;
  }

  replay(on: boolean): void { this.replayEl.classList.toggle('show', on); }

  update(dt: number): void {
    if (this.callT > 0) { this.callT -= dt; if (this.callT <= 0) this.callEl.classList.remove('show'); }
    if (this.gradeT > 0) { this.gradeT -= dt; if (this.gradeT <= 0) this.gradeEl.classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
  }

  show(on: boolean): void { this.root.style.display = on ? '' : 'none'; }
  dispose(): void { this.root.remove(); }
}
