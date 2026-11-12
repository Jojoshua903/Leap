import { TUNING } from '../tuning';
import { hundredPinLayout, layoutDepth, tenPinLayout, type PinSpot } from '../sports/pinLayouts';

/**
 * Lane dimensions in metres, shared by physics, visuals and the camera.
 * Coordinates: foul line at z = 0, the lane runs toward -z, x = 0 is the lane centre, y = 0 is the lane surface.
 * Standard and 100-Pin lanes differ in width, pin layout and camera distances; everything else reads the spec.
 */
export type LaneKind = 'standard' | 'hundred';

export interface LaneSpec {
  kind: LaneKind;
  halfW: number;
  headZ: number;           // head pin
  spots: PinSpot[];
  pinScale: number;        // visual + collider scale of each pin
  deckEndZ: number;        // back edge of the pin deck
  pitEndZ: number;
  gutterW: number;
  gutterDepth: number;
  approachLen: number;
  kickbackX: number;
  /** aim -1..1 maps to this lateral start position */
  aimHalfWidth: number;
  /** distance between neighbour lanes (visual only) */
  neighbourX: number;
  cam: {
    aim: { back: number; height: number };
    follow: { back: number; height: number; stopBeforeHead: number };
    deck: { x: number; height: number; back: number };
    fov: number;
  };
}

const GUTTER_W = 0.24;
const GUTTER_DEPTH = 0.1;
const APPROACH_LEN = 4.5;

function build(kind: LaneKind): LaneSpec {
  const headZ = -TUNING.laneLength;
  if (kind === 'hundred') {
    const spots = hundredPinLayout(headZ);
    const halfW = 0.95;                                     // 1.9 m wide lane so the 100-pin wedge fits
    const deckEndZ = headZ - layoutDepth(spots) - 0.3;
    const kickbackX = halfW + GUTTER_W + 0.06;
    return {
      kind, halfW, headZ, spots, pinScale: 0.8, deckEndZ, pitEndZ: deckEndZ - 1.4,
      gutterW: GUTTER_W, gutterDepth: GUTTER_DEPTH, approachLen: APPROACH_LEN, kickbackX,
      aimHalfWidth: 0.78, neighbourX: 3.2,
      cam: {
        aim: { back: 3.6, height: 1.75 },
        follow: { back: 2.8, height: 1.15, stopBeforeHead: 4.2 },
        deck: { x: 0.9, height: 1.35, back: 3.6 },
        fov: 56
      }
    };
  }
  const spots = tenPinLayout(headZ);
  const halfW = TUNING.laneWidth / 2;
  const deckEndZ = headZ - layoutDepth(spots) - 0.2;
  return {
    kind, halfW, headZ, spots, pinScale: 1, deckEndZ, pitEndZ: deckEndZ - 1.2,
    gutterW: GUTTER_W, gutterDepth: GUTTER_DEPTH, approachLen: APPROACH_LEN, kickbackX: halfW + GUTTER_W + 0.06,
    aimHalfWidth: TUNING.aimLaneHalfWidth, neighbourX: 2.15,
    cam: {
      aim: { back: 2.7, height: 1.3 },
      follow: { back: 2.0, height: 0.8, stopBeforeHead: 3.2 },
      deck: { x: 0.65, height: 0.7, back: 2.1 },
      fov: 52
    }
  };
}

const cache = new Map<LaneKind, LaneSpec>();
export function laneSpec(kind: LaneKind): LaneSpec {
  let s = cache.get(kind);
  if (!s) { s = build(kind); cache.set(kind, s); }
  return s;
}
