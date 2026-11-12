import { BaseBackend } from './InputBackend';
import type { InputSample, Vec3 } from '../types';
import { ComplementaryFilter, qIdentity } from '../math/Filter';
import { TUNING } from '../tuning';
import type { JoyCon, JoyConInputDetail } from 'joy-con-webhid';

const G = 9.81;

/**
 * Joy-Con axis → game device frame (x right, y up, z toward player), assuming a right Joy-Con held
 * vertically like a remote: stick up, rail facing left. Each entry is [sourceAxis, sign].
 * If a swing reads backwards in the F3 debug panel, flip a sign here (or set TUNING.swingSign to -1).
 */
const AXES: Array<[0 | 1 | 2, 1 | -1]> = [[1, -1], [0, -1], [2, 1]];
const remap = (v: { x: number; y: number; z: number }): Vec3 => {
  const s = [v.x, v.y, v.z];
  return [s[AXES[0][0]] * AXES[0][1], s[AXES[1][0]] * AXES[1][1], s[AXES[2][0]] * AXES[2][1]];
};

export const webHidSupported = (): boolean => typeof navigator !== 'undefined' && 'hid' in navigator;

/**
 * Load the library ahead of the click, so connect() reaches navigator.hid.requestDevice while the
 * click's user activation is still valid. Only on WebHID browsers, because the library touches navigator.hid.
 */
export const preloadJoyCon = (): void => { if (webHidSupported()) void import('joy-con-webhid'); };

export class JoyConBackend extends BaseBackend {
  readonly kind = 'joycon' as const;
  label = 'Joy-Con';
  private joyCon: JoyCon | null = null;
  private filter = new ComplementaryFilter(TUNING.filterGain);
  private lastPacketT = 0;
  private poll = 0;
  private readonly handler = (e: Event): void => this.onInput((e as CustomEvent<JoyConInputDetail>).detail);

  /** Must be called from a click handler: WebHID shows a device picker. */
  async connect(): Promise<void> {
    if (!webHidSupported()) {
      this.setStatus('This browser has no WebHID. Use Chrome or Edge 89+ on desktop (not Firefox or Safari).');
      throw new Error('WebHID unsupported');
    }
    this.setStatus('Choose your Joy-Con in the browser popup…');
    const lib = await import('joy-con-webhid');
    try {
      await lib.connectJoyCon();
    } catch {
      this.setStatus('No Joy-Con selected. Pair it over Bluetooth first, then try again.');
      throw new Error('Joy-Con not selected');
    }
    // The library fills connectedJoyCons asynchronously; poll briefly for the device.
    await new Promise<void>((resolve, reject) => {
      const started = performance.now();
      this.poll = window.setInterval(() => {
        const jc = [...lib.connectedJoyCons.values()][0];
        if (jc) {
          clearInterval(this.poll);
          this.setup(jc).then(resolve, reject);
        } else if (performance.now() - started > 5000) {
          clearInterval(this.poll);
          this.setStatus('Joy-Con did not respond. Re-pair it and try again.');
          reject(new Error('timeout'));
        }
      }, 200);
    });
  }

  private async setup(jc: JoyCon): Promise<void> {
    if (!jc.device.opened) await jc.open();
    await jc.enableStandardFullMode();
    await jc.enableIMUMode();
    await jc.enableVibration();
    if (!jc.eventListenerAttached) { jc.addEventListener('hidinput', this.handler); jc.eventListenerAttached = true; }
    this.joyCon = jc;
    this.label = jc.device.productName || 'Joy-Con';
    this.filter.reset(qIdentity());
    this.connected = true;
    this.setStatus(`${this.label} connected`);
  }

  private onInput(d: JoyConInputDetail): void {
    if (!d.actualAccelerometer || !d.actualGyroscope) return;
    const now = performance.now();
    const dt = this.lastPacketT ? (now - this.lastPacketT) / 1000 : 1 / 60;
    this.lastPacketT = now;
    const a = remap(d.actualAccelerometer);
    const accel: Vec3 = [a[0] * G, a[1] * G, a[2] * G];
    const g = remap(d.actualGyroscope.rps);
    const gyro: Vec3 = [g[0] - this.bias[0], g[1] - this.bias[1], g[2] - this.bias[2]];
    const b = d.buttonStatus ?? {};
    this.filter.gain = TUNING.filterGain;
    const sample: InputSample = {
      t: now, accel, gyro,
      orientation: this.filter.update(gyro, accel, dt),
      buttons: { trigger: !!(b.zr || b.zl || b.r || b.l), a: !!(b.a || b.right), b: !!(b.b || b.down) }
    };
    this.emit(sample);
  }

  protected resetOrientation(): void { this.filter.reset(qIdentity()); }
  protected forwardAfterReset(): InputSample['orientation'] { return qIdentity(); }

  rumble(strength: number, ms: number): void {
    const jc = this.joyCon;
    if (!jc) return;
    const amp = Math.max(0, Math.min(1, strength));
    jc.rumble(160, 320, amp).catch(() => undefined);
    window.setTimeout(() => { jc.rumble(160, 320, 0).catch(() => undefined); }, ms);
  }

  disconnect(): void {
    clearInterval(this.poll);
    if (this.joyCon) {
      this.joyCon.removeEventListener('hidinput', this.handler);
      this.joyCon.eventListenerAttached = false;
    }
    this.joyCon = null;
    this.connected = false;
    this.setStatus('Not connected');
  }
}
