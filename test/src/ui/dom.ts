import { t } from '../i18n';

/** Tiny DOM helpers shared by every screen. Interactive elements get `data-nav` so keyboard and motion navigation can reach them. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function button(label: string, onClick: () => void, cls = 'btn', parent?: HTMLElement): HTMLButtonElement {
  const b = h('button', cls, label, parent);
  b.type = 'button';
  b.dataset.nav = '';
  b.onclick = e => { e.stopPropagation(); onClick(); };
  return b;
}

/** A row of choice chips. Returns a function to change the selection from outside. */
export function chips<T>(
  parent: HTMLElement,
  items: Array<{ value: T; label: string; locked?: string | null; swatch?: string; badge?: string }>,
  selected: T,
  onPick: (v: T) => void,
  cls = 'chip'
): (v: T) => void {
  const row = h('div', 'chips', '', parent);
  const els: Array<[T, HTMLButtonElement]> = [];
  const mark = (v: T) => els.forEach(([val, el]) => { el.classList.toggle('sel', val === v); el.setAttribute('aria-pressed', String(val === v)); });
  for (const it of items) {
    const b = h('button', cls + (it.swatch ? ' swatch' : '') + (it.locked ? ' locked' : ''), '', row);
    b.type = 'button';
    b.dataset.nav = '';
    if (it.swatch) { b.style.setProperty('--sw', it.swatch); b.title = it.label; b.setAttribute('aria-label', it.label); }
    else b.textContent = it.label;
    if (it.badge) h('span', 'badge', it.badge, b);
    if (it.locked) {
      h('span', 'lock', '🔒', b);
      b.title = `${t('common.locked')}: ${it.locked}`;
    }
    b.onclick = e => {
      e.stopPropagation();
      if (it.locked) { b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400); return; }
      mark(it.value); onPick(it.value);
    };
    els.push([it.value, b]);
  }
  mark(selected);
  return mark;
}

/** On/off switch styled as a pill. */
export function toggle(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = h('button', 'toggle', '', parent);
  b.type = 'button';
  b.dataset.nav = '';
  h('span', 'tlabel', label, b);
  h('span', 'tknob', '', b);
  const set = (v: boolean) => { b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); };
  set(value);
  b.onclick = e => { e.stopPropagation(); value = !value; set(value); onChange(value); };
  return b;
}

/** Labelled range slider (0..1 by default). Arrow keys adjust it while it is highlighted. */
export function slider(parent: HTMLElement, label: string, value: number, onChange: (v: number) => void, min = 0, max = 1, step = 0.05): HTMLInputElement {
  const row = h('label', 'slider', '', parent);
  h('span', 'slabel', label, row);
  const input = h('input', '', '', row);
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(value);
  input.dataset.nav = '';
  const out = h('output', '', '', row);
  const show = () => { out.textContent = max === 1 && min === 0 ? `${Math.round(Number(input.value) * 100)}%` : Number(input.value).toFixed(2); };
  show();
  input.oninput = () => { show(); onChange(Number(input.value)); };
  return input;
}

export function section(parent: HTMLElement, title: string): HTMLDivElement {
  const s = h('div', 'section', '', parent);
  h('div', 'label', title, s);
  return s;
}

/** Yes/no confirm inside the current screen. */
export function confirmBox(parent: HTMLElement, text: string, onYes: () => void): void {
  const m = h('div', 'modal show', '', parent);
  const p = h('div', 'panel small', '', m);
  h('p', 'confirm-text', text, p);
  const acts = h('div', 'acts', '', p);
  const close = () => m.remove();
  button(t('common.cancel'), close, 'pbtn', acts).dataset.autofocus = '';
  button(t('common.confirm'), () => { close(); onYes(); }, 'pbtn go danger', acts);
}
