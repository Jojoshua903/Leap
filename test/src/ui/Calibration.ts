import type { InputBackend } from '../input/InputBackend';
import type { Calibration } from '../types';
import { t } from '../i18n';

/** "Hold the controller still, pointing at the screen" overlay with a progress ring. */
export class CalibrationScreen {
  private readonly root: HTMLDivElement;

  constructor(ui: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'calibration';
    ui.appendChild(this.root);
  }

  async run(backend: InputBackend, ms: number): Promise<Calibration> {
    if (ms <= 0) return backend.calibrate(0);
    this.root.innerHTML = `
      <div class="cal-card">
        <div class="cal-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="track"/><circle cx="50" cy="50" r="42" class="bar"/></svg><span>🎯</span></div>
        <h2>${t('cal.title')}</h2>
        <p>${t('cal.text')}</p>
        <small class="cal-status"></small>
      </div>`;
    const bar = this.root.querySelector('.bar') as SVGCircleElement;
    const status = this.root.querySelector('.cal-status') as HTMLElement;
    const circ = 2 * Math.PI * 42;
    bar.style.strokeDasharray = String(circ);
    bar.style.strokeDashoffset = String(circ);
    this.root.classList.add('show');
    status.textContent = backend.connected ? `${backend.label} · ${Math.round(backend.sampleRate)} Hz` : t('hud.notConnected');

    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const k = Math.min(1, ((performance.now() - start) / ms) % 1.0001);
      bar.style.strokeDashoffset = String(circ * (1 - k));
      raf = requestAnimationFrame(tick);
    };
    tick();
    const result = await backend.calibrate(ms);
    cancelAnimationFrame(raf);
    bar.style.strokeDashoffset = '0';
    status.textContent = t('cal.done');
    await new Promise(r => setTimeout(r, 350));
    this.root.classList.remove('show');
    return result;
  }
}
