import type { PlayerInfo } from './types';

/**
 * Default players. The joshibrahim.nl character roster loads client-side and couldn't be read,
 * so these are placeholders. Replace names and colours with your own characters; everything else picks them up.
 */
export const CHARACTERS: PlayerInfo[] = [
  { name: 'Player 1', color: '#ff5a5f' },
  { name: 'Player 2', color: '#2f8fd8' },
  { name: 'Player 3', color: '#3bb37a' },
  { name: 'Player 4', color: '#ffb020' }
];
