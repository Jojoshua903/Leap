import { describe, expect, it } from 'vitest';
import { BallPhysics, Rng, STEP, TABLE_CONTACT_Y, v3, type Contact, type PaddleBody } from './BallPhysics';
import { TABLE } from './ttTuning';

/** Run until `stop` says so (or maxT), collecting contacts. */
function run(b: BallPhysics, maxT: number, stop: (c: Contact[]) => boolean = () => false, paddles: PaddleBody[] = []): Contact[] {
  const all: Contact[] = [];
  for (let t = 0; t < maxT; t += STEP) {
    const cs = b.step(STEP, paddles);
    all.push(...cs);
    if (stop(cs)) break;
  }
  return all;
}

/** Forward speed (toward -z) right after the first table bounce. */
function forwardAfterBounce(spinX: number): number {
  const b = new BallPhysics(new Rng(1));
  b.set(v3(0, TABLE_CONTACT_Y + 0.1, 0.5), v3(0, -2, -6), v3(spinX, 0, 0));
  run(b, 1, cs => cs.some(c => c.kind === 'table'));
  return -b.vel.z;
}

describe('BallPhysics', () => {
  it('a 30 cm drop bounces back to about 24 cm (restitution ≈ 0.9 minus a little drag)', () => {
    const b = new BallPhysics(new Rng(1));
    b.set(v3(0, TABLE_CONTACT_Y + 0.3, 0.6), v3());
    let bounced = false, peak = 0;
    for (let t = 0; t < 2; t += STEP) {
      const cs = b.step();
      if (cs.some(c => c.kind === 'table')) { if (bounced) break; bounced = true; }
      if (bounced) peak = Math.max(peak, b.pos.y - TABLE_CONTACT_Y);
      if (bounced && b.vel.y < 0 && peak > 0.05) break;
    }
    expect(bounced).toBe(true);
    expect(peak).toBeGreaterThan(0.21);
    expect(peak).toBeLessThan(0.26);
  });

  it('topspin kicks forward off the table, backspin slows the ball', () => {
    // toward -z, topspin is negative x
    const top = forwardAfterBounce(-200), none = forwardAfterBounce(0), back = forwardAfterBounce(200);
    expect(top).toBeGreaterThan(none);
    expect(none).toBeGreaterThan(back);
    // heavy topspin (contact point moving backward) actually speeds the ball up
    expect(forwardAfterBounce(-400)).toBeGreaterThan(6);
  });

  it('topspin dips, backspin floats (Magnus)', () => {
    const fly = (spinX: number) => {
      const b = new BallPhysics();
      b.set(v3(0, 1.2, 1.4), v3(0, 0, -10), v3(spinX, 0, 0));
      for (let i = 0; i < 48; i++) b.step();
      return b.pos.y;
    };
    expect(fly(-150)).toBeLessThan(fly(0));
    expect(fly(150)).toBeGreaterThan(fly(0));
  });

  it('sidespin curves the ball', () => {
    const b = new BallPhysics();
    b.set(v3(0, 1.2, 1.4), v3(0, 0, -10), v3(0, 150, 0));
    for (let i = 0; i < 48; i++) b.step();
    expect(Math.abs(b.pos.x)).toBeGreaterThan(0.02);
  });

  it('is deterministic: same seed, same net cords, same result', () => {
    const shot = (seed: number) => {
      const b = new BallPhysics(new Rng(seed));
      // aimed to clip the top of the net
      b.set(v3(0.1, TABLE.height + TABLE.netHeight + 0.01, 0.3), v3(0, 0, -7), v3(0, 20, 0));
      const cs = run(b, 1.5);
      return { cs: cs.map(c => c.kind), p: { ...b.pos }, v: { ...b.vel } };
    };
    const a = shot(42), b = shot(42);
    expect(a.cs).toContain('netCord');
    expect(b).toEqual(a);
  });

  it('does not tunnel through the net at 30 m/s', () => {
    const b = new BallPhysics();
    b.set(v3(0, TABLE.height + 0.08, 1.0), v3(0, 0, -30));
    const cs = run(b, 0.3);
    expect(cs.some(c => c.kind === 'net')).toBe(true);
    expect(b.pos.z).toBeGreaterThan(0);
  });

  it('does not tunnel through the table at 30 m/s', () => {
    const b = new BallPhysics();
    b.set(v3(0, TABLE.height + 0.5, 0.9), v3(0, -30, -2));
    const cs = run(b, 0.1);
    expect(cs[0]?.kind).toBe('table');
    expect(b.pos.y).toBeGreaterThan(TABLE.height);
  });

  it('does not tunnel through a paddle at 30 m/s, and the paddle sends it back', () => {
    const b = new BallPhysics();
    b.set(v3(0, 1.1, -0.2), v3(0, 0, -30));
    const paddle: PaddleBody = { side: 1, pos: v3(0, 1.1, -1.8), vel: v3(0, 0, 3), normal: v3(0, 0, 1), active: true };
    const cs = run(b, 0.2, c => c.some(x => x.kind === 'paddle'), [paddle]);
    expect(cs.some(c => c.kind === 'paddle')).toBe(true);
    expect(b.vel.z).toBeGreaterThan(0);
    expect(b.pos.z).toBeGreaterThan(-1.8);
  });

  it('a brushing paddle (moving up) puts topspin on the ball', () => {
    const b = new BallPhysics();
    b.set(v3(0, 1, 1.5), v3(0, 0, 4));
    // player 1's paddle at +z hits toward -z while moving up
    b.hitWith(v3(0, 0, -1), v3(0, 6, -5), 0.86);
    expect(b.vel.z).toBeLessThan(0);
    expect(b.spin.x).toBeLessThan(-20);       // topspin for a ball going toward -z
  });
});
