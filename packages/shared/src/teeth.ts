/**
 * FDI two-digit tooth numbering for the permanent adult dentition (SPEC §5.3): 32 teeth,
 * quadrant 1 = upper right, 2 = upper left, 3 = lower left, 4 = lower right (the patient's sides),
 * position 1 (central incisor) to 8 (third molar). Language-neutral: labels live in the catalogs.
 */

export type Quadrant = 1 | 2 | 3 | 4;
export type Arch = 'upper' | 'lower';
export type Side = 'right' | 'left';
export type ToothKind =
  | 'centralIncisor'
  | 'lateralIncisor'
  | 'canine'
  | 'firstPremolar'
  | 'secondPremolar'
  | 'firstMolar'
  | 'secondMolar'
  | 'thirdMolar';

export interface ToothInfo {
  /** FDI number, e.g. 13. */
  no: number;
  quadrant: Quadrant;
  /** 1 (central incisor) … 8 (third molar). */
  position: number;
  arch: Arch;
  /** The patient's side. */
  side: Side;
  kind: ToothKind;
}

/** Work that is not on one tooth (API `area`). */
export const CASE_AREAS = ['upper_arch', 'lower_arch', 'both_arches'] as const;
export type CaseArea = (typeof CASE_AREAS)[number];

const KINDS: readonly ToothKind[] = [
  'centralIncisor',
  'lateralIncisor',
  'canine',
  'firstPremolar',
  'secondPremolar',
  'firstMolar',
  'secondMolar',
  'thirdMolar',
];

export const QUADRANTS: readonly Quadrant[] = [1, 2, 3, 4];

const quadrantTeeth = (q: Quadrant): number[] => [1, 2, 3, 4, 5, 6, 7, 8].map((p) => q * 10 + p);

/**
 * The two rows as a viewer facing the patient sees them, from the viewer's left to right:
 * 18 … 11 | 21 … 28 on top and 48 … 41 | 31 … 38 below (18 stays on the viewer's left in every
 * language).
 */
export const UPPER_ROW: readonly number[] = [...quadrantTeeth(1).reverse(), ...quadrantTeeth(2)];
export const LOWER_ROW: readonly number[] = [...quadrantTeeth(4).reverse(), ...quadrantTeeth(3)];
export const ALL_TEETH: readonly number[] = [...UPPER_ROW, ...LOWER_ROW];

export function isToothNo(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  const q = Math.floor(value / 10);
  const p = value % 10;
  return q >= 1 && q <= 4 && p >= 1 && p <= 8;
}

export function toothInfo(no: number): ToothInfo {
  if (!isToothNo(no)) throw new RangeError(`not an FDI permanent tooth: ${no}`);
  const quadrant = Math.floor(no / 10) as Quadrant;
  const position = no % 10;
  return {
    no,
    quadrant,
    position,
    arch: quadrant <= 2 ? 'upper' : 'lower',
    side: quadrant === 1 || quadrant === 4 ? 'right' : 'left',
    kind: KINDS[position - 1] as ToothKind,
  };
}

export const teethOfQuadrant = (q: Quadrant): number[] => quadrantTeeth(q);

export const teethOfArch = (arch: Arch): number[] => [...(arch === 'upper' ? UPPER_ROW : LOWER_ROW)];

/** Sorts FDI numbers in reading order of the chart: upper row left→right, then lower row. */
export function sortTeeth(teeth: Iterable<number>): number[] {
  const order = new Map(ALL_TEETH.map((t, i) => [t, i]));
  return [...new Set(teeth)].filter(isToothNo).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}
