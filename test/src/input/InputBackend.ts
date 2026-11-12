import type { BackendKind, Calibration, InputSample, Vec3 } from '../types';
import { vLen } from '../math/Filter';

export type SampleListener = (s: InputSample) => void;

export interface InputBackend {
  readonly kind: BackendKind;
  readonly label: string;
  readonly connected: boolean;
  /** Human-readable status for the menu ("Waiting for phone…", "Joy-Con (R) connected"). */
  status: string;
  sampleRate: number;     // Hz, smoothed
  latencyMs: number;      // best estimate of sensor → game delay
  connect(): Promise<void>;
  onSample(cb: SampleListener): () => void;
  onStatus(cb: (status: string) => void): () => void;
  calibrate(ms: number): Promise<Calibration>;
  disconnect(): void;
  rumble(strength: number, ms: number): void;
}

/** Shared plumbing: listener sets, sample-rate meter, gyro bias, generic hold-still calibration. */
export abstract class BaseBackend implements InputBackend {
  abstract readonly kind: BackendKind;
  abstract readonly label: string;
  connected = false;
  status = 'Not connected';
  sampleRate = 0;
  latencyMs = 0;
  /** Subtracted from raw gyro by subclasses before filtering. */
  protected bias: Vec3 = [0, 0, 0];
  protected last: InputSample | null = null;
  private sampleCbs = new Set<SampleListener>();
  private statusCbs = new Set<(s: string) => void>();
  private lastT = 0;

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  rumble(_strength: number, _ms: number): void { /* only Joy-Con and phone implement this */ }

  onSample(cb: SampleListener): () => void { this.sampleCbs.add(cb); return () => { this.sampleCbs.delete(cb); }; }
  onStatus(cb: (s: string) => void): () => void { this.statusCbs.add(cb); return () => { this.statusCbs.delete(cb); }; }

  protected setStatus(s: string): void { this.status = s; this.statusCbs.forEach(cb => cb(s)); }

  protected emit(s: InputSample): void {
    if (this.lastT > 0) {
      const dt = s.t - this.lastT;
      if (dt > 0) this.sampleRate += (1000 / dt - this.sampleRate) * 0.05;
    }
    this.lastT = s.t;
    this.last = s;
    this.sampleCbs.forEach(cb => cb(s));
  }

  /**
   * Hold-still calibration: average the gyro (bias) and remember the orientation as "forward".
   * If the controller moved too much, try again (up to 3 attempts).
   */
  async calibrate(ms: number): Promise<Calibration> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const prevBias = this.bias;
      this.bias = [0, 0, 0];
      const samples: InputSample[] = [];
      const off = this.onSample(s => samples.push(s));
      await new Promise(r => setTimeout(r, ms));
      off();
      if (samples.length < 5) { this.bias = prevBias; continue; }
      const sum: Vec3 = [0, 0, 0];
      for (const s of samples) { sum[0] += s.gyro[0]; sum[1] += s.gyro[1]; sum[2] += s.gyro[2]; }
      const mean: Vec3 = [sum[0] / samples.length, sum[1] / samples.length, sum[2] / samples.length];
      let maxDev = 0;
      for (const s of samples) maxDev = Math.max(maxDev, vLen([s.gyro[0] - mean[0], s.gyro[1] - mean[1], s.gyro[2] - mean[2]]));
      if (maxDev > 0.6 && attempt < 2) { this.bias = prevBias; continue; }   // moved too much, retry
      this.bias = mean;
      this.resetOrientation();
      return { gyroBias: mean, forward: this.forwardAfterReset() };
    }
    return { gyroBias: this.bias, forward: this.last?.orientation ?? [0, 0, 0, 1] };
  }

  /** Subclasses with a filter reset it so "forward" is a clean reference. */
  protected resetOrientation(): void { /* default: nothing */ }
  /** Orientation to store as forward, read right after resetOrientation(). */
  protected forwardAfterReset(): InputSample['orientation'] { return this.last?.orientation ?? [0, 0, 0, 1]; }
}
