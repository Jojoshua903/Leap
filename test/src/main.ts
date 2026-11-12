import './style.css';
import * as THREE from 'three';
import { TUNING, type TuningKey } from './tuning';
import type { BackendKind } from './types';
import type { App, InputHub } from './app';
import type { InputBackend } from './input/InputBackend';
import { MouseBackend } from './input/MouseBackend';
import { PhoneBackend } from './input/PhoneBackend';
import { JoyConBackend, preloadJoyCon } from './input/JoyConBackend';
import { SwingDetector } from './input/SwingDetector';
import { bus } from './core/events';
import { Nav } from './core/Nav';
import { Settings } from './core/settings';
import { QUALITY, QualityGovernor, lowerOf, type QualityLevel } from './core/Quality';
import { t, setLanguage } from './i18n';
import { SaveManager } from './save/SaveManager';
import { Mixer } from './audio/Mixer';
import { ScreenManager, type View } from './screens/ScreenManager';
import { TitleScreen } from './screens/TitleScreen';
import { MatchScreen } from './match/MatchHost';
import { MenuBackground } from './views/MenuBackground';
import { CalibrationScreen } from './ui/Calibration';
import { Tutorial } from './ui/Tutorial';
import { DebugPanel } from './ui/DebugPanel';
import { Toasts } from './ui/Toasts';
import { GLOVE_SVG } from './sports/icons';
import { getAchievement } from './progression/achievements';
import { getUnlock } from './progression/unlocks';
import { TT_TUNING, TT_TUNING_META } from './tabletennis/ttTuning';
import { BB_TUNING, BB_TUNING_META } from './basketball/bbTuning';
import { FB_TUNING, FB_TUNING_META } from './frisbee/frisbeeTuning';
import { SW_TUNING, SW_TUNING_META } from './swordplay/swordTuning';
// Registers table tennis, basketball, frisbee and swordplay achievements, unlocks, XP and stats columns before any screen reads them.
import './tabletennis/ttProgression';
import './basketball/bbProgression';
import './frisbee/fbProgression';
import './swordplay/swProgression';

/**
 * Boot: renderer, saves and settings, controllers, screens, and the one render loop.
 * Flow: Title → Profile select → (Buddy creator) → Main menu → Mode setup → Match → Results.
 */
async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLDivElement;

  /* ---------- saves + settings first, so language and accessibility apply before anything shows ---------- */
  const save = new SaveManager();
  const settings = new Settings(save);
  setLanguage(settings.get().language);

  /* ---------- renderer ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;          // lights decide per quality level whether they cast
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* ---------- UI shell ---------- */
  document.body.insertAdjacentHTML('beforeend', GLOVE_SVG);
  const glove = document.getElementById('glove') as HTMLElement;
  const screens = new ScreenManager(ui);
  const nav = new Nav(screens, glove);
  new Toasts(ui);
  const calibration = new CalibrationScreen(ui);
  const tutorial = new Tutorial(ui, () => settings.set({ tutorialSeen: true }));
  const fpsEl = document.createElement('div'); fpsEl.className = 'fps'; ui.appendChild(fpsEl);
  const swing = new SwingDetector();
  const menuBg = new MenuBackground();

  const currentMatch = (): MatchScreen | null => {
    for (let i = screens.stack.length - 1; i >= 0; i--) { const s = screens.stack[i]; if (s instanceof MatchScreen) return s; }
    return null;
  };
  const debug = new DebugPanel(ui, (key: TuningKey) => currentMatch()?.sport?.onTuning?.(key));
  debug.addTuning('Table tennis', TT_TUNING, TT_TUNING_META, key => currentMatch()?.sport?.onTuning?.(key));
  debug.addTuning('Basketball', BB_TUNING, BB_TUNING_META, key => currentMatch()?.sport?.onTuning?.(key));
  debug.addTuning('Frisbee', FB_TUNING, FB_TUNING_META, key => currentMatch()?.sport?.onTuning?.(key));
  debug.addTuning('Swordplay', SW_TUNING, SW_TUNING_META, key => currentMatch()?.sport?.onTuning?.(key));

  /* ---------- quality + governor ---------- */
  let quality: QualityLevel = settings.get().quality;
  let savedQuality = quality;     // what the player picked; `quality` may be lower after auto-lowering
  const applyQuality = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    currentMatch()?.sport?.setQuality(quality);
  };
  // Lowering is for this session only; the saved choice stays what the player picked.
  const governor = new QualityGovernor(() => {
    if (quality === 'low') return false;
    quality = lowerOf(quality);
    applyQuality();
    bus.emit('toast', { title: t('quality.lowered'), kind: 'info' });
    return true;
  });

  /* ---------- controllers ---------- */
  const backends: Partial<Record<BackendKind, InputBackend>> = {};
  let active: InputBackend | null = null;
  let offSample: (() => void) | null = null;
  let inMatch = false;
  if (settings.get().backend === 'joycon') preloadJoyCon();
  const make = (kind: BackendKind): InputBackend => {
    let b = backends[kind];
    if (!b) {
      b = kind === 'mouse' ? new MouseBackend(canvas) : kind === 'phone' ? new PhoneBackend() : new JoyConBackend();
      backends[kind] = b;
    }
    return b;
  };

  // Player 2 (split controllers): its own backend and SwingDetector, never the same kind as player 1.
  const swing2 = new SwingDetector();
  let second: InputBackend | null = null;
  let offSecond: (() => void) | null = null;
  const releaseSecond = (): void => { offSecond?.(); offSecond = null; second = null; swing2.enabled = false; };

  const input: InputHub = {
    get active() { return active; },
    swing,
    get: k => backends[k],
    async select(kind) {
      const b = make(kind);
      if (second === b) releaseSecond();
      if (active !== b) {
        offSample?.();
        const bk = b;
        offSample = bk.onSample(s => {
          if (inMatch) swing.feed(s);
          // The mouse already moves the real cursor; only motion controllers drive the glove.
          if (bk.kind !== 'mouse') nav.feed(s);
          debug.feed(s);
        });
        active = b;
        debug.setBackend(b);
        nav.recentre();
      }
      if (!b.connected) await b.connect();
      return b;
    },
    async calibrate() {
      const b = active;
      if (!b) return;
      const cal = await calibration.run(b, b.kind === 'mouse' ? 0 : TUNING.calibrationMs);
      swing.setCalibration(cal);
      nav.recentre();
    },
    second: {
      get backend() { return second; },
      swing: swing2,
      async select(kind) {
        if (active?.kind === kind) throw new Error('Player 2 needs a different controller than player 1');
        const b = make(kind);
        if (second !== b) {
          releaseSecond();
          offSecond = b.onSample(s => { if (inMatch) swing2.feed(s); });
          second = b;
        }
        if (!b.connected) await b.connect();
        return b;
      },
      async calibrate() {
        const b = second;
        if (!b) return;
        swing2.setCalibration(await calibration.run(b, b.kind === 'mouse' ? 0 : TUNING.calibrationMs));
      },
      release: releaseSecond
    }
  };

  const app: App = {
    ui, renderer, screens, nav, save, settings, input, menuBg, calibration, tutorial, debug,
    quality: () => quality,
    setInMatch(on) {
      inMatch = on;
      nav.enabled = !on;
      document.body.classList.toggle('in-match', on);
      governor.enabled = on && settings.get().autoQuality;
      if (on) governor.reset();
    }
  };

  /* ---------- settings → everything ---------- */
  const applySettings = (): void => {
    const s = settings.get();
    Mixer.setLevels({ master: s.master, music: s.music, sfx: s.sfx, muted: s.muted });
    const body = document.body.classList;
    body.toggle('hc', s.highContrast);
    body.toggle('big', s.bigText);
    body.toggle('cb', s.colorblind);
    body.toggle('calm', s.reducedMotion);
    screens.instant = s.reducedMotion;
    menuBg.calm = s.reducedMotion;
    swing.prefs = { sensitivity: s.sensitivity, invertHook: s.invertHook, handed: s.handed };
    swing2.prefs = { sensitivity: s.sensitivity, invertHook: s.invertHook, handed: 'right' };
    governor.enabled = s.autoQuality && inMatch;
    if (s.quality !== savedQuality) { savedQuality = s.quality; quality = s.quality; applyQuality(); }
    fpsEl.style.display = s.showFps ? 'block' : 'none';
    const m = currentMatch();
    if (m?.sport && !inMatch) m.sport.refreshSettings();       // paused match picks up changes on resume too
  };
  bus.on('settingsChanged', applySettings);
  bus.on('languageChanged', () => { screens.relabelAll(); nav.refresh(); });

  // Progression announcements become toasts.
  const nameOf = (id: string) => save.get(id)?.name ?? '';
  bus.on('achievement', ({ id, profileId }) => {
    const a = getAchievement(id);
    bus.emit('toast', { title: `${t('toast.achievement')}: ${a ? t(a.nameKey) : id}`, text: nameOf(profileId), kind: 'achievement' });
  });
  bus.on('unlock', ({ id, profileId }) => {
    const u = getUnlock(id);
    bus.emit('toast', { title: `${t('toast.unlock')}: ${u ? t(u.labelKey) : id}`, text: nameOf(profileId), kind: 'unlock' });
  });
  bus.on('levelUp', ({ level, profileId }) => bus.emit('toast', { title: t('toast.level', { n: level }), text: nameOf(profileId), kind: 'level' }));
  if (save.warning) bus.emit('toast', { title: t(save.warning), kind: 'warn' });

  /* ---------- keys that work everywhere ---------- */
  window.addEventListener('keydown', e => {
    if (e.code === 'F3') { e.preventDefault(); debug.toggle(); }
    else if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) { Mixer.unlock(); settings.set({ muted: !settings.get().muted }); }
  });
  // Browsers only allow audio after the first input.
  window.addEventListener('pointerdown', () => Mixer.unlock(), { once: true });
  window.addEventListener('keydown', () => Mixer.unlock(), { once: true });

  /* ---------- resize ---------- */
  let lastView: View | null = null;
  const resize = (): void => {
    applyQuality();
    screens.view?.resize(window.innerWidth, window.innerHeight);
    menuBg.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  screens.onChange = () => { requestAnimationFrame(() => nav.refresh()); };

  /* ---------- the loop ---------- */
  let last = performance.now();
  let fpsT = 0;
  let lastThrow = swing.lastThrow;
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const view = screens.view;
    if (view && view !== lastView) { view.resize(window.innerWidth, window.innerHeight); lastView = view; }
    if (view) {
      view.update(dt);
      renderer.render(view.scene, view.camera);
    }
    screens.top?.tick(dt);
    governor.sample(dt);
    fpsT += dt;
    if (fpsT > 0.25) { fpsT = 0; fpsEl.textContent = `${Math.round(governor.current)} FPS · ${quality}`; }
    debug.setPhase(swing.phase);
    if (swing.lastThrow !== lastThrow && swing.lastThrow) { lastThrow = swing.lastThrow; debug.setThrow(lastThrow); }
    debug.draw();
    requestAnimationFrame(frame);
  };

  applySettings();
  resize();
  await input.select('mouse');
  screens.reset(new TitleScreen(app));
  document.querySelector('.loading')?.remove();
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) {
    const box = document.createElement('div');
    box.className = 'fatal';
    box.textContent = `Could not start the game: ${err instanceof Error ? err.message : String(err)}. WebGL and WebAssembly are required.`;
    ui.appendChild(box);
  }
});
