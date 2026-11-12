import { BaseBackend } from './InputBackend';
import type { Calibration, InputSample, Vec3 } from '../types';
import { TUNING } from '../tuning';
import { qFromEuler } from '../math/Filter';

const RATE_HZ = 120;
const G = 9.81;

/**
 * Mouse fallback. Fakes IMU data from mouse movement so SwingDetector works unchanged:
 *  - left button = trigger, right button / Space = A, middle button = B (Esc/Backspace also go back, via the menus)
 *  - before the swing, horizontal mouse position = yaw (aim)
 *  - while held: drag DOWN (backswing) then UP fast (forward swing), release the button to throw
 *  - horizontal mouse speed at release = wrist roll (spin); horizontal drift during the swing = yaw (direction)
 */
export class MouseBackend extends BaseBackend {
  readonly kind = 'mouse' as const;
  readonly label = 'Mouse';
  private x = 0; private y = 0; private px = 0; private py = 0;
  private vx = 0; private vy = 0; private pvx = 0; private pvy = 0;
  private trigger = false; private a = false; private b = false;
  private yawDeg = 0; private pitch = 0;
  private timer = 0;
  private readonly el: HTMLElement;
  private readonly offs: Array<() => void> = [];

  constructor(el: HTMLElement) { super(); this.el = el; }

  /** Raw pointer state (client px + buttons) for modes that drive something directly, like the table-tennis paddle. */
  get pointer(): { x: number; y: number; left: boolean; right: boolean } {
    return { x: this.x, y: this.y, left: this.trigger, right: this.a };
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const on = <K extends keyof WindowEventMap>(type: K, f: (e: WindowEventMap[K]) => void): void => {
      const h = f as EventListener;
      window.addEventListener(type, h);
      this.offs.push(() => window.removeEventListener(type, h));
    };
    on('pointermove', e => { this.x = e.clientX; this.y = e.clientY; });
    on('pointerdown', e => {
      if (e.target !== this.el) return;
      if (e.button === 0) this.trigger = true;
      if (e.button === 2) this.a = true;
      if (e.button === 1) { this.b = true; e.preventDefault(); }
    });
    on('pointerup', e => { if (e.button === 0) this.trigger = false; if (e.button === 2) this.a = false; if (e.button === 1) this.b = false; });
    on('blur', () => { this.trigger = false; this.a = false; this.b = false; });
    on('keydown', e => { if (e.code === 'Space') this.a = true; });
    on('keyup', e => { if (e.code === 'Space') this.a = false; });
    on('contextmenu', e => { if (e.target === this.el) e.preventDefault(); });
    this.px = this.x = innerWidth / 2; this.py = this.y = innerHeight / 2;
    this.timer = window.setInterval(() => this.tick(), 1000 / RATE_HZ);
    this.connected = true;
    this.setStatus('Mouse ready: hold the left button, drag down, flick up, let go');
  }

  disconnect(): void {
    clearInterval(this.timer);
    this.offs.splice(0).forEach(f => f());
    this.connected = false;
    this.setStatus('Not connected');
  }

  /** The mouse needs no real calibration; return at once with a neutral reference. */
  async calibrate(_ms: number): Promise<Calibration> {
    this.yawDeg = 0; this.pitch = 0;
    return { gyroBias: [0, 0, 0], forward: [0, 0, 0, 1] };
  }

  private tick(): void {
    const dt = 1 / RATE_HZ;
    // smoothed mouse velocity in px/s
    const rawVx = (this.x - this.px) / dt, rawVy = (this.y - this.py) / dt;
    this.px = this.x; this.py = this.y;
    this.vx += (rawVx - this.vx) * 0.35;
    this.vy += (rawVy - this.vy) * 0.35;

    // fake gyro: upward mouse motion = forward swing (positive pitch rate)
    const gx = -this.vy * TUNING.mouseRateGain;
    const gz = this.vx * TUNING.mouseSpinGain;            // flick left (vx<0) = counter-clockwise roll = hook left
    let gy = 0;
    if (!this.trigger) {
      const target = -(this.x / innerWidth - 0.5) * 2 * TUNING.aimYawRangeDeg;   // mouse right = yaw right (negative)
      gy = ((target - this.yawDeg) * Math.PI / 180) / dt;
      this.yawDeg = target;
    } else {
      const dYaw = -rawVx * dt * TUNING.mouseYawGain;
      this.yawDeg += dYaw;
      gy = (dYaw * Math.PI / 180) / dt;
    }
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + gx * dt));
    if (!this.trigger) this.pitch *= 0.9;

    // fake accel: gravity plus a little linear accel from the mouse acceleration
    const ax = (this.vx - this.pvx) / dt * 0.0015, ay = -(this.vy - this.pvy) / dt * 0.0015;
    this.pvx = this.vx; this.pvy = this.vy;
    const accel: Vec3 = [ax, G + ay, 0];

    const sample: InputSample = {
      t: performance.now(),
      accel,
      gyro: [gx, gy, gz],
      orientation: qFromEuler(this.yawDeg * Math.PI / 180, this.pitch, 0),
      buttons: { trigger: this.trigger, a: this.a, b: this.b }
    };
    this.emit(sample);
  }
}
