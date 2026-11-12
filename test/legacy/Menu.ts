import type { BackendKind, PlayerInfo } from '../types';
import type { InputBackend } from '../input/InputBackend';
import { PhoneBackend } from '../input/PhoneBackend';
import { preloadJoyCon, webHidSupported } from '../input/JoyConBackend';
import type { Sfx } from '../audio/Sfx';
import { TUNING } from '../tuning';
import { CHARACTERS } from '../characters';
import { totalScore } from '../game/Scoring';
import type { ScoreRow } from './Scoreboard';

export interface MenuDeps {
  sfx: Sfx;
  selectBackend(kind: BackendKind): Promise<InputBackend>;
  getBackend(): InputBackend | null;
  onPlay(players: PlayerInfo[]): void;
  onResetTutorial(): void;
}

const SAVE = 'bb_players_v1';
interface Saved { count: number; names: string[] }

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
};

/** Main menu, players, controller, settings, pause and results screens (plain DOM). */
export class Menu {
  private readonly root: HTMLDivElement;
  private count = 1;
  private names: string[] = CHARACTERS.map(c => c.name);
  private offStatus: (() => void) | null = null;
  visible = true;

  constructor(ui: HTMLElement, private readonly d: MenuDeps) {
    this.root = h('div', 'menu');
    ui.appendChild(this.root);
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) ?? 'null') as Saved | null;
      if (s) { this.count = Math.min(4, Math.max(1, s.count)); s.names.forEach((n, i) => { if (n) this.names[i] = n.slice(0, 14); }); }
    } catch { /* ignore broken save */ }
  }

  private save(): void { localStorage.setItem(SAVE, JSON.stringify({ count: this.count, names: this.names })); }

  get players(): PlayerInfo[] {
    return Array.from({ length: this.count }, (_, i) => ({ name: this.names[i] || CHARACTERS[i].name, color: CHARACTERS[i].color }));
  }

  private panel(title: string, sub = ''): HTMLDivElement {
    this.offStatus?.(); this.offStatus = null;
    this.root.innerHTML = '';
    this.root.classList.add('show');
    this.visible = true;
    const p = h('div', 'panel');
    const logo = h('div', 'logo'); logo.innerHTML = 'Breezy<br><span>Bowling</span>';
    p.appendChild(logo);
    if (title) p.appendChild(h('h2', '', title));
    if (sub) p.appendChild(h('p', 'sub', sub));
    this.root.appendChild(p);
    return p;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
    const b = h('button', cls, label);
    b.onclick = () => { this.d.sfx.resume(); this.d.sfx.click(); onClick(); };
    parent.appendChild(b);
    return b;
  }

  hide(): void { this.offStatus?.(); this.offStatus = null; this.root.classList.remove('show'); this.root.innerHTML = ''; this.visible = false; }

  showMain(): void {
    const p = this.panel('');
    const b = this.d.getBackend();
    p.appendChild(h('p', 'sub', `${this.count} player${this.count > 1 ? 's' : ''} · ${b ? b.label : 'Mouse'} controls`));
    const col = h('div', 'col'); p.appendChild(col);
    this.button(col, 'Play', () => this.d.onPlay(this.players), 'btn big');
    this.button(col, 'Players', () => this.showPlayers());
    this.button(col, 'Controller', () => this.showController());
    this.button(col, 'Settings', () => this.showSettings());
  }

  showPlayers(): void {
    const p = this.panel('Players', 'Hot seat: pass the controller after each frame.');
    const counts = h('div', 'row');
    for (let n = 1; n <= 4; n++) {
      const b = this.button(counts, String(n), () => { this.count = n; this.save(); this.showPlayers(); }, n === this.count ? 'chip on' : 'chip');
      b.title = `${n} player${n > 1 ? 's' : ''}`;
    }
    p.appendChild(counts);
    for (let i = 0; i < this.count; i++) {
      const row = h('label', 'name-row');
      const dot = h('span', 'dot'); dot.style.background = CHARACTERS[i].color;
      const input = h('input');
      input.value = this.names[i]; input.maxLength = 14;
      input.oninput = () => { this.names[i] = input.value; this.save(); };
      row.append(dot, input);
      p.appendChild(row);
    }
    this.button(p, 'Back', () => this.showMain(), 'btn ghost');
  }

  showController(): void {
    preloadJoyCon();
    const p = this.panel('Controller', 'Every option uses the same swing detection.');
    const status = h('p', 'status');
    const cards = h('div', 'cards');
    const current = this.d.getBackend()?.kind ?? 'mouse';
    const extra = h('div', 'extra');

    const card = (kind: BackendKind, title: string, desc: string): void => {
      const c = h('button', `card ${current === kind ? 'on' : ''}`);
      c.append(h('b', '', title), h('small', '', desc));
      c.onclick = async () => {
        this.d.sfx.resume(); this.d.sfx.click();
        cards.querySelectorAll('.card').forEach(x => x.classList.remove('on'));
        c.classList.add('on');
        extra.innerHTML = '';
        if (kind === 'joycon' && !webHidSupported()) {
          status.textContent = 'Joy-Con needs WebHID, which only Chrome and Edge (89+) on desktop support. Use the phone or mouse instead.';
          return;
        }
        try {
          const b = await this.d.selectBackend(kind);
          this.watch(b, status);
          if (b instanceof PhoneBackend) await this.phoneInfo(b, extra);
        } catch (e) {
          status.textContent = (this.d.getBackend()?.status) || (e instanceof Error ? e.message : 'Could not connect');
        }
      };
      cards.appendChild(c);
    };
    card('mouse', 'Mouse', 'Hold left button, drag down, flick up, let go.');
    card('phone', 'Phone', 'Scan a QR code and swing your phone.');
    card('joycon', 'Joy-Con', webHidSupported() ? 'Pair over Bluetooth, then connect.' : 'Not supported in this browser.');
    p.append(cards, status, extra);
    const b = this.d.getBackend();
    if (b) {
      this.watch(b, status);
      if (b instanceof PhoneBackend) void this.phoneInfo(b, extra);
    }
    this.button(p, 'Back', () => this.showMain(), 'btn ghost');
  }

  private watch(b: InputBackend, el: HTMLElement): void {
    this.offStatus?.();
    el.textContent = b.status;
    this.offStatus = b.onStatus(s => { el.textContent = s; });
  }

  private async phoneInfo(b: PhoneBackend, into: HTMLElement): Promise<void> {
    into.innerHTML = '';
    const img = h('img', 'qr'); img.alt = 'QR code for the phone controller page';
    img.src = await b.qrDataUrl();
    const code = h('div', 'room', b.room);
    const url = h('code', 'url', b.phoneUrl);
    const note = h('small', '', 'Same Wi-Fi as this computer. Accept the certificate warning on the phone (self-signed HTTPS).');
    into.append(img, code, url, note);
  }

  showSettings(): void {
    const p = this.panel('Settings');
    const vol = h('label', 'setting');
    vol.append(h('span', '', 'Volume'));
    const r = h('input'); r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.01'; r.value = String(TUNING.masterVolume);
    r.oninput = () => this.d.sfx.setVolume(Number(r.value));
    vol.appendChild(r);
    p.appendChild(vol);
    const muteRow = h('div', 'row');
    const mute = this.button(muteRow, this.d.sfx.muted ? 'Unmute (M)' : 'Mute (M)', () => { this.d.sfx.toggleMute(); mute.textContent = this.d.sfx.muted ? 'Unmute (M)' : 'Mute (M)'; }, 'chip');
    this.button(muteRow, 'Show tutorial again', () => { this.d.onResetTutorial(); }, 'chip');
    p.appendChild(muteRow);
    p.appendChild(h('p', 'sub', 'Press F3 in game for sensor graphs and live tuning sliders.'));
    this.button(p, 'Back', () => this.showMain(), 'btn ghost');
  }

  showPause(onResume: () => void, onQuit: () => void): void {
    const p = this.panel('Paused');
    const col = h('div', 'col'); p.appendChild(col);
    this.button(col, 'Resume', onResume, 'btn big');
    this.button(col, 'Settings', () => { this.showSettings(); const back = this.root.querySelector('.btn.ghost') as HTMLButtonElement | null; if (back) back.onclick = () => this.showPause(onResume, onQuit); });
    this.button(col, 'Quit to menu', onQuit, 'btn ghost');
  }

  showResults(rows: ScoreRow[], onAgain: () => void, onMenu: () => void): void {
    const p = this.panel('Results');
    const ranked = rows.map(r => ({ ...r, score: totalScore(r.rolls) })).sort((a, b) => b.score - a.score);
    const list = h('ol', 'results');
    ranked.forEach((r, i) => {
      const li = h('li', i === 0 ? 'winner' : '');
      const dot = h('span', 'dot'); dot.style.background = r.color;
      li.append(h('span', 'place', i === 0 ? '👑' : String(i + 1)), dot, h('span', 'rname', r.name), h('b', 'rscore', String(r.score)));
      list.appendChild(li);
    });
    p.appendChild(list);
    const col = h('div', 'col'); p.appendChild(col);
    this.button(col, 'Play again', onAgain, 'btn big');
    this.button(col, 'Main menu', onMenu, 'btn ghost');
  }
}
