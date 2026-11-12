import type { InputSample, Throw } from '../types';
import type { InputBackend } from '../input/InputBackend';
import { TUNING, TUNING_META, type TuningKey } from '../tuning';
import { vLen } from '../math/Filter';

const HISTORY = 360;

type Meta = { min: number; max: number; step: number };
type VizFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * F3 panel: live sensor graphs, backend stats, last swing values and live tuning sliders.
 * Scenes can add a text block and a small drawing (table tennis shows ball speed, spin, the last
 * contact on the paddle face, the AI level and its predicted landing point). Extra tuning tables
 * (like TT_TUNING) get their own slider group.
 */
export class DebugPanel {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly stats: HTMLPreElement;
  private readonly swingEl: HTMLPreElement;
  private readonly extraEl: HTMLPreElement;
  private readonly vizCanvas: HTMLCanvasElement;
  private readonly vizCtx: CanvasRenderingContext2D;
  private readonly accel: number[] = [];
  private readonly gyro: number[] = [];
  private backend: InputBackend | null = null;
  private phase = 'idle';
  private lastText = 0;
  private vizFn: VizFn | null = null;
  visible = false;

  constructor(ui: HTMLElement, private readonly onTuning: (key: TuningKey) => void) {
    this.root = document.createElement('div');
    this.root.className = 'debug';
    ui.appendChild(this.root);
    const h = document.createElement('h4'); h.textContent = 'Debug (F3)';
    this.canvas = document.createElement('canvas'); this.canvas.width = 340; this.canvas.height = 130;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const legend = document.createElement('div'); legend.className = 'legend';
    legend.innerHTML = '<span style="color:#ff8a3c">■ accel |a| (m/s², 0–40)</span> <span style="color:#3ff2ff">■ gyro |ω| (rad/s, 0–25)</span>';
    this.stats = document.createElement('pre');
    this.swingEl = document.createElement('pre');
    this.extraEl = document.createElement('pre');
    this.vizCanvas = document.createElement('canvas'); this.vizCanvas.width = 340; this.vizCanvas.height = 150;
    this.vizCanvas.style.display = 'none';
    this.vizCtx = this.vizCanvas.getContext('2d') as CanvasRenderingContext2D;
    const sliders = document.createElement('div'); sliders.className = 'sliders';
    for (const key of Object.keys(TUNING_META) as TuningKey[]) {
      const meta = TUNING_META[key];
      if (meta) sliders.appendChild(this.slider(TUNING as Record<string, number>, key, meta, () => this.onTuning(key)));
    }
    this.root.append(h, this.canvas, legend, this.stats, this.swingEl, this.extraEl, this.vizCanvas, sliders);
  }

  private slider(table: Record<string, number>, key: string, meta: Meta, changed: () => void): HTMLElement {
    const row = document.createElement('label');
    const name = document.createElement('span'); name.textContent = key;
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(meta.min); input.max = String(meta.max); input.step = String(meta.step);
    input.value = String(table[key]);
    const val = document.createElement('code'); val.textContent = String(table[key]);
    input.oninput = () => {
      table[key] = Number(input.value);
      val.textContent = input.value;
      changed();
    };
    row.append(name, input, val);
    return row;
  }

  /** Add a group of sliders for another tuning table (edited in place, like TUNING). */
  addTuning<K extends string>(title: string, table: Record<K, number>, meta: Partial<Record<K, Meta>>, onChange: (key: K) => void): void {
    const head = document.createElement('h4'); head.textContent = title;
    const group = document.createElement('div'); group.className = 'sliders';
    for (const key of Object.keys(meta) as K[]) {
      const m = meta[key];
      if (m) group.appendChild(this.slider(table as Record<string, number>, key, m, () => onChange(key)));
    }
    this.root.append(head, group);
  }

  toggle(): void { this.visible = !this.visible; this.root.classList.toggle('show', this.visible); }

  setBackend(b: InputBackend | null): void { this.backend = b; }
  setPhase(p: string): void { this.phase = p; }

  /** Scene-provided lines under the swing block (empty string hides it). */
  setExtra(text: string): void { if (this.visible) this.extraEl.textContent = text; }

  /** Scene-provided drawing, redrawn every frame while the panel is open. */
  setViz(fn: VizFn | null): void {
    this.vizFn = fn;
    this.vizCanvas.style.display = fn ? 'block' : 'none';
    if (!fn) this.extraEl.textContent = '';
  }

  feed(s: InputSample): void {
    this.accel.push(vLen(s.accel)); this.gyro.push(vLen(s.gyro));
    if (this.accel.length > HISTORY) { this.accel.shift(); this.gyro.shift(); }
  }

  setThrow(t: Throw): void {
    this.swingEl.textContent =
      `last swing  ${t.weak ? '(weak)' : ''}\n` +
      `speed      ${t.speed.toFixed(2)} m/s\n` +
      `angle      ${t.angleDeg.toFixed(2)}°\n` +
      `spin       ${t.spin.toFixed(1)} rad/s\n` +
      `aimX       ${t.aimX.toFixed(2)}\n` +
      `peak rate  ${t.peakRate.toFixed(2)} rad/s\n` +
      `peak accel ${t.peakAccel.toFixed(2)} m/s²\n` +
      `jerk       ${t.jerk.toFixed(1)}`;
  }

  draw(): void {
    if (!this.visible) return;
    const { ctx, canvas } = this, w = canvas.width, h = canvas.height;
    ctx.fillStyle = 'rgba(10,20,40,.85)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
    for (let y = 0; y <= 4; y++) { ctx.beginPath(); ctx.moveTo(0, y * h / 4); ctx.lineTo(w, y * h / 4); ctx.stroke(); }
    const line = (arr: number[], max: number, color: string): void => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
      arr.forEach((v, i) => { const x = i / HISTORY * w, y = h - Math.min(1, v / max) * h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    };
    line(this.accel, 40, '#ff8a3c');
    line(this.gyro, 25, '#3ff2ff');

    if (this.vizFn) {
      const vc = this.vizCtx, vw = this.vizCanvas.width, vh = this.vizCanvas.height;
      vc.fillStyle = 'rgba(10,20,40,.85)'; vc.fillRect(0, 0, vw, vh);
      this.vizFn(vc, vw, vh);
    }

    const now = performance.now();
    if (now - this.lastText > 100) {
      this.lastText = now;
      const b = this.backend;
      this.stats.textContent =
        `backend    ${b ? b.label : 'none'} ${b?.connected ? '(connected)' : '(not connected)'}\n` +
        `rate       ${b ? b.sampleRate.toFixed(0) : 0} Hz\n` +
        `latency    ${b ? b.latencyMs.toFixed(1) : 0} ms (estimate)\n` +
        `swing      ${this.phase}`;
    }
  }
}
