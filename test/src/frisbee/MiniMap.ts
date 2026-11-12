import type { HoleDef } from './courses';

export interface MapMarker { x: number; z: number; color: string; big?: boolean }

/**
 * The hole from above in the corner: bounds, fairway, water, sand, trees, the basket, everyone's lie,
 * the current aim line and the flying disc. Redrawn only when a marker moved by about half a map pixel.
 */
export class MiniMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private hole: HoleDef | null = null;
  private sc = 1;
  private ox = 0;
  private oz = 0;
  private readonly W = 150;
  private readonly H = 210;
  private base: ImageData | null = null;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.canvas.style.width = `${this.W}px`; this.canvas.style.height = `${this.H}px`;
    this.g = this.canvas.getContext('2d')!;
    this.g.scale(dpr, dpr);
    parent.appendChild(this.canvas);
  }

  set visible(v: boolean) { this.canvas.style.display = v ? '' : 'none'; }

  private px(x: number): number { return (x - this.ox) * this.sc + 6; }
  private pz(z: number): number { return (z - this.oz) * this.sc + 6; }

  setHole(h: HoleDef): void {
    this.hole = h;
    const b = h.bounds;
    this.sc = Math.min((this.W - 12) / (b.x1 - b.x0), (this.H - 12) / (b.z1 - b.z0));
    this.ox = b.x0; this.oz = b.z0;
    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
    g.fillStyle = 'rgba(20,32,52,0.72)';
    g.fillRect(0, 0, this.W, this.H);
    g.fillStyle = '#4f8a3c';
    g.fillRect(this.px(b.x0), this.pz(b.z0), (b.x1 - b.x0) * this.sc, (b.z1 - b.z0) * this.sc);
    // fairway
    const fw = h.fairway ?? [{ x: 0, z: 0 }, h.basket];
    g.strokeStyle = '#86c862'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = (h.fairwayW ?? 8) * 2 * this.sc;
    g.beginPath(); fw.forEach((p, i) => (i ? g.lineTo(this.px(p.x), this.pz(p.z)) : g.moveTo(this.px(p.x), this.pz(p.z)))); g.stroke();
    const ell = (e: { x: number; z: number; rx: number; rz: number; rot?: number }, c: string) => {
      g.fillStyle = c; g.beginPath(); g.ellipse(this.px(e.x), this.pz(e.z), e.rx * this.sc, e.rz * this.sc, e.rot ?? 0, 0, Math.PI * 2); g.fill();
    };
    for (const s of h.sand ?? []) ell(s, '#e6d29c');
    for (const p of h.ponds ?? []) ell(p, '#3b9fcf');
    g.fillStyle = '#2b5e2a';
    for (const t of h.trees ?? []) { g.beginPath(); g.arc(this.px(t.x), this.pz(t.z), Math.max(1.5, 1.8 * (t.s ?? 1) * this.sc), 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#9a968e';
    for (const r of h.rocks ?? []) { g.beginPath(); g.arc(this.px(r.x), this.pz(r.z), Math.max(1.5, (r.s ?? 1) * this.sc), 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#ff5a5f'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    g.strokeRect(this.px(b.x0), this.pz(b.z0), (b.x1 - b.x0) * this.sc, (b.z1 - b.z0) * this.sc);
    g.setLineDash([]);
    // tee and basket
    g.fillStyle = '#c9b79a'; g.fillRect(this.px(0) - 3, this.pz(0) - 2, 6, 5);
    g.fillStyle = '#ffd84a'; g.strokeStyle = '#1d2a3a'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(this.px(h.basket.x), this.pz(h.basket.z), 4, 0, Math.PI * 2); g.fill(); g.stroke();
    this.base = g.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.lastKey = '';
  }

  /** Lies, the aim line from the active lie and the disc. */
  draw(markers: MapMarker[], aim: { x: number; z: number; deg: number; len: number } | null, disc: { x: number; z: number } | null): void {
    if (!this.hole || !this.base) return;
    // skip the redraw when nothing moved more than half a map pixel
    const r = (v: number) => Math.round(v * this.sc * 2);
    const key = `${markers.map(m => `${r(m.x)},${r(m.z)},${m.big ? 1 : 0}`).join(';')}|${aim ? `${r(aim.x)},${r(aim.z)},${aim.deg.toFixed(1)}` : ''}|${disc ? `${r(disc.x)},${r(disc.z)}` : ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.g;
    g.putImageData(this.base, 0, 0);
    if (aim) {
      const a = aim.deg * Math.PI / 180;
      g.strokeStyle = 'rgba(63,242,255,0.9)'; g.lineWidth = 1.5; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(this.px(aim.x), this.pz(aim.z));
      g.lineTo(this.px(aim.x + Math.sin(a) * aim.len), this.pz(aim.z - Math.cos(a) * aim.len)); g.stroke();
      g.setLineDash([]);
    }
    for (const m of markers) {
      g.fillStyle = m.color; g.strokeStyle = '#ffffff'; g.lineWidth = m.big ? 2 : 1;
      g.beginPath(); g.arc(this.px(m.x), this.pz(m.z), m.big ? 4 : 3, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (disc) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(this.px(disc.x), this.pz(disc.z), 2.5, 0, Math.PI * 2); g.fill(); }
  }

  dispose(): void { this.canvas.remove(); }
}
