import type * as THREE from 'three';
import type { BackendKind } from './types';
import type { InputBackend } from './input/InputBackend';
import type { SwingDetector } from './input/SwingDetector';
import type { ScreenManager } from './screens/ScreenManager';
import type { Nav } from './core/Nav';
import type { SaveManager } from './save/SaveManager';
import type { Settings } from './core/settings';
import type { MenuBackground } from './views/MenuBackground';
import type { QualityLevel } from './core/Quality';
import type { CalibrationScreen } from './ui/Calibration';
import type { Tutorial } from './ui/Tutorial';
import type { DebugPanel } from './ui/DebugPanel';

/** Controllers: creates backends on demand and routes samples to menus or the match. */
export interface InputHub {
  readonly active: InputBackend | null;
  readonly swing: SwingDetector;
  select(kind: BackendKind): Promise<InputBackend>;
  get(kind: BackendKind): InputBackend | undefined;
  /** Hold-still calibration overlay; instant for the mouse. */
  calibrate(): Promise<void>;
  /** Player 2's controller for split-controller modes. It must be a different kind than player 1's. */
  readonly second: SecondHub;
}

export interface SecondHub {
  readonly backend: InputBackend | null;
  readonly swing: SwingDetector;
  select(kind: BackendKind): Promise<InputBackend>;
  calibrate(): Promise<void>;
  /** Stop routing player 2's samples (leaving the match). The backend stays connected for next time. */
  release(): void;
}

/** Everything a screen may need. Built once in main.ts. */
export interface App {
  ui: HTMLElement;
  renderer: THREE.WebGLRenderer;
  screens: ScreenManager;
  nav: Nav;
  save: SaveManager;
  settings: Settings;
  input: InputHub;
  menuBg: MenuBackground;
  calibration: CalibrationScreen;
  tutorial: Tutorial;
  debug: DebugPanel;
  quality(): QualityLevel;
  /** Shows or hides the in-match flag (cursor hidden, nav off). */
  setInMatch(on: boolean): void;
}
