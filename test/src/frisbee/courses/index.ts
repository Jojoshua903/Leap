import type { CourseDef, CourseId } from './types';
import { MEADOW9 } from './meadow9';
import { CLIFFSIDE9 } from './cliffside9';
import { NIGHT9 } from './night9';

export const COURSES: Record<CourseId, CourseDef> = { meadow: MEADOW9, cliffside: CLIFFSIDE9, night: NIGHT9 };
export const courseById = (id: string): CourseDef => COURSES[id as CourseId] ?? MEADOW9;
export * from './types';
