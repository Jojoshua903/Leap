import { FAV_COLORS, HAIR_COLORS, SKIN_TONES, type BuddyConfig } from './BuddyConfig';

/** A flat 2D head-and-shoulders portrait of a Buddy, for menus (cheap: no WebGL). */
export function buddyAvatar(b: BuddyConfig, size = 64): string {
  const skin = SKIN_TONES[b.skin] ?? SKIN_TONES[0];
  const hair = HAIR_COLORS[b.hairColor] ?? HAIR_COLORS[0];
  const shirt = FAV_COLORS[b.color] ?? FAV_COLORS[0];
  const hairShape = [
    'M14 28a18 18 0 0 1 36 0c-6-7-30-7-36 0z',                                   // short
    'M14 28a18 18 0 0 1 36 0c-4-3-12-2-18 4-4-6-12-7-18-4z',                     // fringe
    'M14 28l3-12 5 6 4-10 6 8 5-9 4 9 5-5 2 13c-6-6-28-6-34 0z',                // spiky
    'M14 28a18 18 0 0 1 36 0c-6-7-30-7-36 0zM48 26c6 4 6 14 2 20',              // ponytail
    'M14 28a18 18 0 0 1 36 0c-6-7-30-7-36 0zM26 10a6 6 0 1 1 12 0a6 6 0 1 1-12 0', // bun
    'M12 44V28a20 20 0 0 1 40 0v16c-2-10-4-14-6-16-8-6-22-6-28 0-2 2-4 6-6 16z', // long
    'M8 30a24 22 0 0 1 48 0c-8-10-40-10-48 0z',                                 // afro
    'M29 4h6v20h-6z'                                                            // mohawk
  ][b.hair] ?? '';
  const acc = b.accessory === 'cap'
    ? `<path d="M14 24a18 16 0 0 1 36 0z" fill="${shirt}"/><path d="M30 24h22c0 3-4 4-8 4h-14z" fill="${shirt}"/>`
    : b.accessory === 'hat'
      ? `<ellipse cx="32" cy="20" rx="26" ry="5" fill="#f2dc9c"/><path d="M20 20c0-10 24-10 24 0z" fill="#f2dc9c"/>`
      : b.accessory === 'headband'
        ? `<path d="M14 25c8-4 28-4 36 0" stroke="${shirt}" stroke-width="4" fill="none"/>`
        : b.accessory === 'glasses'
          ? `<g fill="none" stroke="#222" stroke-width="2"><circle cx="25" cy="33" r="5"/><circle cx="39" cy="33" r="5"/><path d="M30 33h4"/></g>`
          : '';
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
  <rect x="12" y="50" width="40" height="20" rx="12" fill="${shirt}"/>
  <circle cx="32" cy="32" r="18" fill="${skin}"/>
  <circle cx="25" cy="33" r="2.4" fill="#1d1d24"/><circle cx="39" cy="33" r="2.4" fill="#1d1d24"/>
  <path d="M26 40q6 5 12 0" stroke="#8a3a36" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="${hairShape}" fill="${hair}" stroke="${hair}"/>
  ${acc}
</svg>`;
}
