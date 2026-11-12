/**
 * Tiny typed event bus. Game code emits facts (a strike happened, a game ended);
 * audio, achievements, stats and toasts subscribe without the game knowing about them.
 */
import type { MatchSummary } from '../sports/types';

export interface RollEvent {
  sport: string;
  mode: string;
  player: number;
  profileId: string | null;
  pins: number;
  strike: boolean;
  spare: boolean;
  gutter: boolean;
  practice: boolean;
}

export interface GameEvents {
  roll: RollEvent;
  strike: RollEvent;
  spare: RollEvent;
  gutter: RollEvent;
  throwStart: { practice: boolean };
  impact: { speed: number };
  gameEnd: { summary: MatchSummary };
  achievement: { profileId: string; id: string };
  levelUp: { profileId: string; level: number };
  unlock: { profileId: string; id: string };
  toast: { title: string; text?: string; kind?: 'info' | 'achievement' | 'unlock' | 'level' | 'warn' };
  settingsChanged: Record<string, never>;
  languageChanged: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export interface Bus<E> {
  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void;
  emit<K extends keyof E>(event: K, payload: E[K]): void;
  clear(): void;
}

export function createBus<E>(): Bus<E> {
  const map = new Map<keyof E, Set<Handler<never>>>();
  return {
    on(event, fn) {
      let set = map.get(event);
      if (!set) { set = new Set(); map.set(event, set); }
      set.add(fn as Handler<never>);
      return () => { set?.delete(fn as Handler<never>); };
    },
    emit(event, payload) {
      const set = map.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try { (fn as Handler<typeof payload>)(payload); } catch (e) { console.error(`event "${String(event)}" handler failed`, e); }
      }
    },
    clear() { map.clear(); }
  };
}

export const bus = createBus<GameEvents>();
