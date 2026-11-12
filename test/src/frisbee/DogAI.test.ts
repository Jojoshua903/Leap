import { describe, expect, it } from 'vitest';
import { Rng } from '../tabletennis/BallPhysics';
import { DISC_TYPES } from './frisbeeTuning';
import { Disc, FLAT_GROUND, STEP, Wind, simulateFlight, type Launch } from './DiscPhysics';
import { DOG_BREEDS, DogAI, type DogBreed, type DogEvent } from './DogAI';

/** A good, catchable throw: soft and floaty, about 20 m, with a little random aim. */
const goodThrow = (r: Rng): Launch => ({
  pos: { x: 0, y: 1.2, z: 0 }, speed: 12 + r.signed() * 0.6, yawDeg: r.signed() * 6, loftDeg: 15, noseDeg: 2,
  bankDeg: r.signed() * 4, spin: -45, wobble: 0
});

/** Throw once and let the dog go after it. Returns how it ended. */
function trial(breed: DogBreed, seed: number): { caught: boolean; midAir: boolean; events: DogEvent['kind'][] } {
  const r = new Rng(seed * 13 + 1);
  const l = goodThrow(r);
  const dog = new DogAI(breed, seed);
  dog.reset({ x: 0, y: 0, z: 0 });
  const disc = new Disc(DISC_TYPES.dog, seed);
  disc.launch(l);
  dog.throwStarted(simulateFlight(l, DISC_TYPES.dog, { seed, maxT: 10 }));
  const events: DogEvent['kind'][] = [];
  const wind = Wind.calm();
  for (let i = 0; i < 240 * 12; i++) {
    if (!disc.stopped) disc.step(STEP, wind, FLAT_GROUND);
    const e = dog.update(STEP, { pos: disc.pos, phase: disc.phase, landed: disc.landed, t: disc.t, speed: disc.speed, wobble: disc.wobble });
    if (!e) continue;
    events.push(e.kind);
    if (e.kind === 'catch') return { caught: true, midAir: e.midAir, events };
    if (e.kind === 'miss') return { caught: false, midAir: false, events };
  }
  return { caught: false, midAir: false, events };
}

const rate = (breed: DogBreed, n: number, seed0: number): number => {
  let c = 0;
  for (let i = 0; i < n; i++) if (trial(breed, seed0 + i).caught) c++;
  return c / n;
};

describe('DogAI', () => {
  it('the best dog catches a good throw at least 90% of the time', () => {
    expect(rate(DOG_BREEDS.collie, 200, 100)).toBeGreaterThanOrEqual(0.9);
  }, 120_000);

  it('the weakest dog catches it roughly half to two thirds of the time', () => {
    const r = rate(DOG_BREEDS.mutt, 200, 100);
    expect(r).toBeGreaterThanOrEqual(0.45);
    expect(r).toBeLessThanOrEqual(0.8);
  }, 120_000);

  it('breeds are ordered: faster, higher, better hands', () => {
    const [a, b, c] = [DOG_BREEDS.mutt, DOG_BREEDS.retriever, DOG_BREEDS.collie];
    expect(a.speed < b.speed && b.speed < c.speed).toBe(true);
    expect(a.jump < b.jump && b.jump < c.jump).toBe(true);
    expect(a.skill < b.skill && b.skill < c.skill).toBe(true);
    expect(rate(b, 60, 500)).toBeGreaterThanOrEqual(rate(a, 60, 500));
  }, 120_000);

  it('is deterministic for a seed', () => {
    expect(trial(DOG_BREEDS.retriever, 77)).toEqual(trial(DOG_BREEDS.retriever, 77));
  });

  it('catches a high floater in the air and brings the disc back', () => {
    const dog = new DogAI(DOG_BREEDS.collie, 5);
    dog.reset({ x: 0, y: 0, z: 0 });
    const l: Launch = { pos: { x: 0, y: 1.2, z: 0 }, speed: 11, yawDeg: 0, loftDeg: 18, noseDeg: 2, bankDeg: 0, spin: -45, wobble: 0 };
    const disc = new Disc(DISC_TYPES.dog, 5);
    disc.launch(l);
    dog.throwStarted(simulateFlight(l, DISC_TYPES.dog, { seed: 5 }));
    const seen: string[] = [];
    for (let i = 0; i < 240 * 20 && !seen.includes('returned'); i++) {
      if (!dog.carrying && !disc.stopped) disc.step(STEP, Wind.calm(), FLAT_GROUND);
      const e = dog.update(STEP, dog.carrying ? null : { pos: disc.pos, phase: disc.phase, landed: disc.landed, t: disc.t, speed: disc.speed, wobble: disc.wobble });
      if (e) seen.push(e.kind === 'catch' ? `catch:${e.midAir}` : e.kind);
    }
    expect(seen).toContain('returned');
    expect(seen.some(s => s.startsWith('catch') || s === 'pickup')).toBe(true);
  });
});
