/**
 * A Buddy is the player's avatar. The config is plain JSON so it can live in saves and exports.
 * Every look field is an index into a palette or list below, which keeps validation trivial.
 */
export type Accessory = 'none' | 'hat' | 'cap' | 'glasses' | 'headband' | 'visor' | 'bucket';
export const ACCESSORIES: Accessory[] = ['none', 'hat', 'cap', 'glasses', 'headband', 'visor', 'bucket'];

export interface BuddyConfig {
  v: 1;
  name: string;
  skin: number;       // 0–11
  hair: number;       // 0–7
  hairColor: number;  // 0–15
  eyes: number;       // 0–5
  mouth: number;      // 0–5
  top: number;        // 0–7
  bottom: number;     // 0–5
  color: number;      // 0–15, favourite colour: shirt and the player's colour in matches
  accessory: Accessory;
}

export const SKIN_TONES = [
  '#ffe3cf', '#fcd5b5', '#f6c79d', '#eeb98a', '#e0a674', '#d09463',
  '#bd8154', '#a86e45', '#925c3a', '#7b4b30', '#643c27', '#4e2f1f'
];
export const HAIR_COLORS = [
  '#1f1a17', '#3b2a20', '#5a3b26', '#7a4e2d', '#a0693a', '#c98f4e', '#e2b86a', '#f3dc9a',
  '#d9d4cc', '#8d8d8d', '#b0342d', '#e0672a', '#ff7fb0', '#7a5cff', '#2f8fd8', '#3bb37a'
];
export const FAV_COLORS = [
  '#ff5a5f', '#ff8a3c', '#ffb020', '#ffd84a', '#a6d93a', '#3bb37a', '#1fb5a8', '#3cc8f0',
  '#2f8fd8', '#4b5fe0', '#7a5cff', '#b45cf0', '#ff5fa2', '#f2f2f2', '#6b6f7a', '#2b2f38'
];
export const BOTTOM_COLORS = ['#3b4a66', '#2d3a52', '#5b6b8a', '#6a4f3a', '#3b5d4a', '#4a3b66'];

export const COUNTS = { skin: 12, hair: 8, hairColor: 16, eyes: 6, mouth: 6, top: 8, bottom: 6, color: 16 } as const;
export type IndexField = keyof typeof COUNTS;
export const NAME_MAX = 12;

/**
 * Names are checked after lowercasing and undoing common letter swaps (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s),
 * with spaces and punctuation removed. English and Dutch words.
 */
/** Blocked anywhere inside the name. */
const BLOCK_ANYWHERE = [
  'fuck', 'shit', 'bitch', 'nigg', 'faggot', 'whore', 'slut', 'pussy', 'nazi', 'hitler',
  'penis', 'vagina', 'kanker', 'hoer', 'tyfus', 'mongool', 'neger', 'flikker'
];
/** Blocked only as the whole name, so "Essex", "Dickens", "Lulu", "Pikachu" or "Catering" stay allowed. */
const BLOCK_WHOLE = ['cunt', 'fag', 'dick', 'cock', 'rape', 'porn', 'sex', 'anal', 'kut', 'lul', 'pik', 'tering'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

export function normaliseName(raw: string): string {
  return raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function isNameBlocked(raw: string): boolean {
  const flat = raw.toLowerCase().split('').map(c => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
  return BLOCK_ANYWHERE.some(w => flat.includes(w)) || BLOCK_WHOLE.includes(flat);
}

/** 'ok' | i18n key of the problem. */
export function checkName(raw: string): 'ok' | 'creator.nameEmpty' | 'creator.nameBlocked' {
  const n = normaliseName(raw);
  if (!n) return 'creator.nameEmpty';
  if (isNameBlocked(n)) return 'creator.nameBlocked';
  return 'ok';
}

const FUN_NAMES = ['Sunny', 'Kai', 'Milo', 'Luna', 'Rio', 'Juno', 'Tiko', 'Nova', 'Pip', 'Sam', 'Noor', 'Bo', 'Ziggy', 'Isla', 'Fen', 'Yuki'];

export function defaultBuddy(name = 'Buddy', color = 0): BuddyConfig {
  return { v: 1, name, skin: 2, hair: 0, hairColor: 2, eyes: 0, mouth: 0, top: 0, bottom: 0, color, accessory: 'none' };
}

/** Random look. `allowed(field, index)` lets the creator skip items that are still locked. */
export function randomBuddy(
  rnd: () => number = Math.random,
  allowed: (field: IndexField | 'accessory', value: number | Accessory) => boolean = () => true,
  keepName?: string
): BuddyConfig {
  const pick = (field: IndexField): number => {
    const ok = Array.from({ length: COUNTS[field] }, (_, i) => i).filter(i => allowed(field, i));
    return ok.length ? ok[Math.floor(rnd() * ok.length)] : 0;
  };
  const accs = ACCESSORIES.filter(a => allowed('accessory', a));
  return {
    v: 1,
    name: keepName ?? FUN_NAMES[Math.floor(rnd() * FUN_NAMES.length)],
    skin: pick('skin'), hair: pick('hair'), hairColor: pick('hairColor'), eyes: pick('eyes'), mouth: pick('mouth'),
    top: pick('top'), bottom: pick('bottom'), color: pick('color'),
    accessory: accs.length ? accs[Math.floor(rnd() * accs.length)] : 'none'
  };
}

const clampIdx = (v: unknown, n: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : 0;

/** Turn untrusted JSON into a valid config. Returns null if it isn't an object with a usable name. */
export function validateBuddy(raw: unknown): BuddyConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string') return null;
  const name = normaliseName(o.name);
  if (!name || isNameBlocked(name)) return null;
  return {
    v: 1, name,
    skin: clampIdx(o.skin, COUNTS.skin),
    hair: clampIdx(o.hair, COUNTS.hair),
    hairColor: clampIdx(o.hairColor, COUNTS.hairColor),
    eyes: clampIdx(o.eyes, COUNTS.eyes),
    mouth: clampIdx(o.mouth, COUNTS.mouth),
    top: clampIdx(o.top, COUNTS.top),
    bottom: clampIdx(o.bottom, COUNTS.bottom),
    color: clampIdx(o.color, COUNTS.color),
    accessory: ACCESSORIES.includes(o.accessory as Accessory) ? (o.accessory as Accessory) : 'none'
  };
}

export const buddyColor = (b: BuddyConfig): string => FAV_COLORS[b.color] ?? FAV_COLORS[0];
