import type { App } from '../app';
import { Screen } from './ScreenManager';
import { button, chips, h, section, slider, toggle } from '../ui/dom';
import { t, LANGUAGES } from '../i18n';
import { sfx } from '../audio/Sfx';
import type { BackendKind } from '../types';
import type { SettingsData } from '../save/types';
import type { PhoneBackend } from '../input/PhoneBackend';
import { webHidSupported } from '../input/JoyConBackend';

/**
 * Settings, in four groups: controller, graphics, accessibility, audio (+ language).
 * Controller and accessibility choices are stored on the active profile; the rest on this device.
 */
export class SettingsScreen extends Screen {
  readonly name = 'settings';
  private offStatus: (() => void) | null = null;

  constructor(private readonly app: App) { super(); this.view = app.menuBg; }

  enter(): void { this.render(); }
  relabel(): void { this.render(); }
  exit(): void { this.offStatus?.(); }

  private set(patch: Partial<SettingsData>): void { this.app.settings.set(patch); }

  render(): void {
    this.offStatus?.();
    this.offStatus = null;
    const s = this.app.settings.get();
    const prof = this.app.save.active;
    this.el.replaceChildren();
    const panel = h('div', 'panel wide settings-panel', '', this.el);
    const head = h('div', 'phead', '', panel);
    const tx = h('div', '', '', head);
    h('h3', '', t('settings.title'), tx);
    h('p', '', prof ? t('settings.savedFor', { name: prof.name }) : t('settings.savedGlobal'), tx);
    const body = h('div', 'pbody cols scroll', '', panel);
    const left = h('div', 'col', '', body);
    const right = h('div', 'col', '', body);

    /* controller */
    const ctl = section(left, t('settings.controller'));
    const kinds: BackendKind[] = ['mouse', 'phone', 'joycon'];
    const active = this.app.input.active;
    const cards = h('div', 'cards', '', ctl);
    const extra = h('div', 'extra', '', ctl);
    for (const k of kinds) {
      const c = h('button', 'opt' + (active?.kind === k ? ' sel' : ''), '', cards);
      c.type = 'button';
      c.dataset.nav = '';
      if (active?.kind === k) c.dataset.autofocus = '';
      h('div', 'ic', k === 'mouse' ? 'M' : k === 'phone' ? 'P' : 'J', c);
      const ct = h('div', '', '', c);
      h('b', '', t(`ctrl.${k}`), ct);
      const status = h('small', '', k === 'joycon' && !webHidSupported() ? t('ctrl.noHid') : t(`ctrl.${k}Desc`), ct);
      const b = this.app.input.get(k);
      if (b && b.connected) status.textContent = b.status;
      c.onclick = () => void this.pickBackend(k, extra, status);
    }
    if (active?.kind === 'phone') void this.showPhone(extra, active as PhoneBackend);
    const row = h('div', 'acts left', '', ctl);
    button(t('settings.recalibrate'), async () => { sfx.select(); await this.app.input.calibrate(); this.app.nav.recentre(); }, 'mini', row);
    h('div', 'label', t('settings.handed'), ctl);
    chips(ctl, [{ value: 'right' as const, label: t('settings.right') }, { value: 'left' as const, label: t('settings.left') }], s.handed, v => { sfx.tick(); this.set({ handed: v }); });
    slider(ctl, t('settings.sensitivity'), s.sensitivity, v => this.set({ sensitivity: v }), 0.5, 1.5, 0.05);
    toggle(ctl, t('settings.invertHook'), s.invertHook, v => { sfx.toggle(v); this.set({ invertHook: v }); });
    h('div', 'label', t('settings.shotAssist'), ctl);
    chips(ctl, ([0, 1, 2, 3] as const).map(v => ({ value: v, label: t(`settings.assist.${v}`) })), s.shotAssist, v => { sfx.tick(); this.set({ shotAssist: v }); });

    /* graphics */
    const gfx = section(left, t('settings.graphics'));
    h('div', 'label', t('settings.quality'), gfx);
    chips(gfx, (['low', 'med', 'high'] as const).map(q => ({ value: q, label: t(`settings.${q}`) })), s.quality, v => { sfx.tick(); this.set({ quality: v }); });
    toggle(gfx, t('settings.fps'), s.showFps, v => { sfx.toggle(v); this.set({ showFps: v }); });
    toggle(gfx, t('settings.reducedMotion'), s.reducedMotion, v => { sfx.toggle(v); this.set({ reducedMotion: v }); });

    /* accessibility */
    const acc = section(right, t('settings.access'));
    toggle(acc, t('settings.highContrast'), s.highContrast, v => { sfx.toggle(v); this.set({ highContrast: v }); });
    toggle(acc, t('settings.bigText'), s.bigText, v => { sfx.toggle(v); this.set({ bigText: v }); });
    toggle(acc, t('settings.colorblind'), s.colorblind, v => { sfx.toggle(v); this.set({ colorblind: v }); });
    toggle(acc, t('settings.gutterAssist'), s.gutterAssist, v => { sfx.toggle(v); this.set({ gutterAssist: v }); });

    /* audio */
    const au = section(right, t('settings.audio'));
    slider(au, t('settings.master'), s.master, v => this.set({ master: v }));
    slider(au, t('settings.music'), s.music, v => this.set({ music: v }));
    slider(au, t('settings.sfx'), s.sfx, v => { this.set({ sfx: v }); sfx.tick(); });
    toggle(au, t('settings.mute'), s.muted, v => this.set({ muted: v }));

    /* language */
    const lang = section(right, t('settings.language'));
    chips(lang, LANGUAGES.map(l => ({ value: l, label: t(`lang.${l}`) })), s.language, v => {
      sfx.select();
      this.set({ language: v });
      // every screen rebuilds its text on languageChanged; refresh the highlight afterwards
      this.app.nav.refresh();
    });
    button(t('settings.tutorial'), () => { sfx.pop(); this.set({ tutorialSeen: false }); }, 'mini', lang);

    const acts = h('div', 'acts', '', panel);
    button(t('common.done'), () => this.app.nav.back(), 'pbtn go', acts);
  }

  private async pickBackend(kind: BackendKind, extra: HTMLElement, status: HTMLElement): Promise<void> {
    sfx.select();
    extra.replaceChildren();
    try {
      const b = await this.app.input.select(kind);
      this.set({ backend: kind });
      this.offStatus?.();
      this.offStatus = b.onStatus(st => { status.textContent = st; });
      status.textContent = b.status;
      if (kind === 'phone') await this.showPhone(extra, b as PhoneBackend);
      if (b.connected && kind !== 'mouse') { await this.app.input.calibrate(); this.app.nav.recentre(); }
      this.el.querySelectorAll('.cards .opt').forEach((el, i) => el.classList.toggle('sel', (['mouse', 'phone', 'joycon'] as const)[i] === kind));
    } catch {
      sfx.error();
      const b = this.app.input.get(kind);
      if (b) status.textContent = b.status;
    }
  }

  private async showPhone(extra: HTMLElement, b: PhoneBackend): Promise<void> {
    extra.replaceChildren();
    const img = h('img', 'qr', '', extra);
    img.alt = 'QR';
    h('div', 'room', b.room, extra);
    h('div', 'url', b.phoneUrl, extra);
    h('small', 'note', t('ctrl.phoneHint'), extra);
    try { img.src = await b.qrDataUrl(); } catch { img.remove(); }
  }
}
