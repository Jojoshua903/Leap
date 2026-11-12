import type { InputSample, Throw } from '../types';
import type { InputBackend } from '../input/InputBackend';
import { TUNING, TUNING_META, type TuningKey } from '../tuning';
import { vLen } from '../math/Filter';

const HISTORY = 360;

/** F3 panel: live sensor graphs, backend stats, last swing values and live tuning sliders. */
export class DebugPanel {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly stats: HTMLPreElement;
  private readonly swingEl: HTMLPreElement;
  private readonly accel: number[] = [];
  private readonly gyro: number[] = [];
  private backend: InputBackend | null = null;
  private phase = 'idle';
  private lastText = 0;
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
    const sliders = document.createElement('div'); sliders.className = 'sliders';
    for (const key of Object.keys(TUNING_META) as TuningKey[]) sliders.appendChild(this.slider(key));
    this.root.append(h, this.canvas, legend, this.stats, this.swingEl, sliders);
  }

  private slider(key: TuningKey): HTMLElement {
    const meta = TUNING_META[key];
    const row = document.createElement('label');
    if (!meta) return row;
    const name = document.createElement('span'); name.textContent = key;
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(meta.min); input.max = String(meta.max); input.step = String(meta.step);
    input.value = String(TUNING[key]);
    const val = document.createElement('code'); val.textContent = String(TUNING[key]);
    input.oninput = () => {
      TUNING[key] = Number(input.value);
      val.textContent = input.value;
      this.onTuning(key);
    };
    row.append(name, input, val);
    return row;
  }

  toggle(): void { this.visible = !this.visible; this.root.classList.toggle('show', this.visible); }

  setBackend(b: InputBackend | null): void { this.backend = b; }
  setPhase(p: string): void { this.phase = p; }

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
