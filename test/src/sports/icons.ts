import type { SportId } from './types';

/**
 * Code-drawn tile scenes for each sport (SVG strings, 100x90 viewBox).
 * Ported from the original Breezy Isle menu so the tiles look the same.
 */
const SK = ['#ffd9b8', '#f1c08f', '#c98d5c', '#8d5a3b'];

function fig(x: number, y: number, s = 1, shirt = '#ff5a5a', skin = 0, arm = ''): string {
  const k = SK[skin];
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-7" y="-2" width="14" height="18" rx="6" fill="${shirt}"/>
  <rect x="-6" y="14" width="5" height="11" rx="2.5" fill="#3b4a66"/><rect x="1" y="14" width="5" height="11" rx="2.5" fill="#3b4a66"/>
  ${arm}
  <circle cy="-11" r="9" fill="${k}"/><path d="M-9 -13a9 9 0 0 1 18 0c-3-4-14-4-18 0z" fill="#4a2f22"/>
  <circle cx="-3" cy="-10" r="1.3" fill="#222"/><circle cx="3" cy="-10" r="1.3" fill="#222"/>
  <path d="M-3 -6q3 2.5 6 0" stroke="#a0524a" stroke-width="1.2" fill="none" stroke-linecap="round"/></g>`;
}
const armLine = (x1: number, y1: number, x2: number, y2: number, c: string) =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>`;
const sky = (a = '#5fc0ff', b = '#c9efff') => {
  const id = `g${a.slice(1)}${b.slice(1)}`;
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="90" fill="url(#${id})"/>`;
};
const water = (y: number, c = '#26b6d6') =>
  `<rect y="${y}" width="100" height="${90 - y}" fill="${c}"/><path d="M0 ${y + 8}q8-3 16 0t16 0t16 0t16 0t16 0t16 0" stroke="#fff" stroke-width="1.3" fill="none" opacity=".6"/>`;
const cloud = (x: number, y: number) =>
  `<g fill="#fff" opacity=".9"><ellipse cx="${x}" cy="${y}" rx="10" ry="4"/><ellipse cx="${x + 5}" cy="${y - 3}" rx="6" ry="4"/></g>`;
const palm = (x: number, y: number, h = 26) =>
  `<path d="M${x} ${y}q2 -${h / 2} 0 -${h}" stroke="#9a6233" stroke-width="3" fill="none"/><g fill="#2f9c48"><ellipse cx="${x - 6}" cy="${y - h}" rx="8" ry="3" transform="rotate(20 ${x} ${y - h})"/><ellipse cx="${x + 6}" cy="${y - h}" rx="8" ry="3" transform="rotate(-20 ${x} ${y - h})"/><ellipse cx="${x}" cy="${y - h - 3}" rx="3" ry="7"/></g>`;
const W = (s: string) => `<svg viewBox="0 0 100 90" preserveAspectRatio="xMidYMid slice">${s}</svg>`;

export const SPORT_ICONS: Record<SportId, string> = {
  swordplay: W(sky() + water(62) + cloud(20, 14)
    + `<rect x="8" y="52" width="84" height="12" rx="2" fill="#e6c48e"/><rect x="8" y="62" width="84" height="5" fill="#b98c55"/>`
    + fig(32, 34, 1, '#4b86ff', 0, armLine(5, 4, 22, -10, '#f0d9a8')) + fig(70, 34, 1, '#ff5a5a', 2, armLine(-5, 4, -22, -12, '#f0d9a8'))
    + `<path d="M44 14l14 0" stroke="#fff" stroke-width="2" opacity=".8"/>`),
  airsports: W(`<defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset=".6" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffe9b0"/></linearGradient></defs><rect width="100" height="90" fill="url(#sun)"/>`
    + `<circle cx="26" cy="62" r="14" fill="#fff3c4" opacity=".9"/>` + water(68, '#e9905a')
    + `<g transform="translate(58 36) rotate(-12)"><ellipse rx="20" ry="5" fill="#ffd02b"/><path d="M-4 -2l-8 -16h8l8 16z" fill="#ffb800"/><path d="M-4 2l-8 14h8l8 -14z" fill="#e8a400"/><path d="M-18 -1l-6 -8h5l5 8z" fill="#ffb800"/><circle cx="12" cy="-1" r="3" fill="#7fd6ff"/></g>`
    + `<path d="M4 50q20-8 34-12" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 4" fill="none"/>`),
  bowling: W(`<rect width="100" height="90" fill="#3a2f5c"/><path d="M38 20h24l26 70H12z" fill="#e8b878"/><path d="M50 20v70M44 20l-8 70M56 20l8 70" stroke="#c8935a" stroke-width=".8"/>`
    + `<g fill="#fff">${[[50, 22], [46, 24], [54, 24], [42, 26], [50, 26], [58, 26]].map(p => `<ellipse cx="${p[0]}" cy="${p[1]}" rx="1.8" ry="4"/>`).join('')}</g>`
    + fig(50, 58, 1.25, '#ff5aa5', 0, armLine(6, 4, 10, 14, '#ffd9b8')) + `<circle cx="62" cy="74" r="6" fill="#2b4bd6"/>`),
  basketball: W(`<rect width="100" height="90" fill="#7bc9ff"/><rect y="56" width="100" height="34" fill="#e8a457"/><path d="M0 70h100M30 56l-10 34M70 56l10 34" stroke="#fff" stroke-width="1.2" opacity=".7"/>`
    + `<rect x="70" y="14" width="22" height="16" fill="#fff" stroke="#c33" stroke-width="1.5"/><path d="M76 30h10l-2 10h-6z" fill="none" stroke="#fff" stroke-width="1.2"/><ellipse cx="81" cy="30" rx="6" ry="1.6" fill="none" stroke="#ff6a2b" stroke-width="2"/>`
    + fig(38, 46, 1.15, '#ff7a2b', 3, armLine(5, 2, 12, -14, '#8d5a3b')) + `<circle cx="52" cy="22" r="6" fill="#ff8c2b" stroke="#a14a10" stroke-width="1"/>`),
  tabletennis: W(sky('#8fd6ff', '#e6f9ff') + `<rect y="54" width="100" height="36" fill="#ffe7b8"/>` + palm(10, 56, 30)
    + fig(24, 46, 1, '#ff5a5a', 0, armLine(6, 4, 15, 0, '#ffd9b8')) + fig(78, 46, 1, '#2f80ff', 2, armLine(-6, 4, -15, 0, '#c98d5c'))
    + `<path d="M14 66h72l8 12H6z" fill="#2b6fd6"/><path d="M50 60v12" stroke="#fff" stroke-width="1.5"/><path d="M6 78h88" stroke="#1d4e9b" stroke-width="2"/><circle cx="50" cy="40" r="2.3" fill="#fff"/>`),
  frisbee: W(sky() + `<rect y="58" width="100" height="32" fill="#fff3d4"/>` + water(52, '#3ccbe0') + `<rect y="62" width="100" height="28" fill="#fff3d4"/>`
    + fig(34, 48, 1.1, '#2fc27a', 0, armLine(6, 4, 18, -2, '#ffd9b8')) + `<ellipse cx="62" cy="24" rx="9" ry="3" fill="#fff" stroke="#9ab" stroke-width="1"/>`
    + `<g transform="translate(76 70)"><ellipse rx="9" ry="5" fill="#c58a4e"/><circle cx="8" cy="-5" r="4.5" fill="#c58a4e"/><path d="M-8 -2l-5 -4" stroke="#c58a4e" stroke-width="2.5"/></g>`)
};

/** The little plane that flies along the dashed trail between tile rows. */
export const PLANE_SVG = `<svg viewBox="0 0 32 32"><path d="M3 15l8 1 6-10h4l-3 10 7 0 3-4h3l-2 5 2 5h-3l-3-4h-7l3 10h-4l-6-10-8 1z" fill="#fff" stroke="#8fc6e6" stroke-width="1"/></svg>`;
export const WRENCH_SVG = `<svg width="34" height="34" viewBox="0 0 24 24"><path d="M21 6.5a5 5 0 0 1-6.6 4.8L6 19.7a2 2 0 0 1-2.8-2.8l8.4-8.4A5 5 0 0 1 17.5 2l-3 3 .5 3 3 .5z" fill="#fff" stroke="#2a5a7a" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
export const STATS_SVG = `<svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 20V11h4v9zM10 20V4h4v16zM16 20v-6h4v6z" fill="#fff" stroke="#2a5a7a" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
export const GLOVE_SVG = `<svg id="glove" viewBox="0 0 64 64"><path d="M22 6c3 0 5 2 5 5v18l1-1c0-3 2-5 5-5s4 2 4 4c1-2 3-3 5-3 3 0 4 2 4 5 1-1 2-2 4-2 3 0 4 3 4 6v10c0 10-7 17-17 17h-4c-7 0-11-3-15-9L8 36c-2-3-1-6 1-7 3-2 6 0 8 2l0 0V11c0-3 2-5 5-5z" fill="#fff" stroke="#3c5a72" stroke-width="3" stroke-linejoin="round"/><path d="M33 31v8M41 31v8M49 33v7" stroke="#9fb4c4" stroke-width="2.5" stroke-linecap="round"/></svg>`;
