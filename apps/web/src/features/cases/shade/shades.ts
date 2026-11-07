/**
 * Shade guide codes (SPEC §5.5). The shade is stored as free text ≤ 20 (owner decision B2); this
 * list is only a picking aid. Display colours are our own rough approximations computed here
 * (screen colours are a guide only), not taken from any manufacturer or program.
 */
export type ClassicGroup = 'A' | 'B' | 'C' | 'D' | 'bleach';

export interface Shade {
  code: string;
  color: string;
}

const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;

const CLASSIC_HUE: Record<Exclude<ClassicGroup, 'bleach'>, { h: number; s: number }> = {
  A: { h: 36, s: 46 },
  B: { h: 46, s: 52 },
  C: { h: 40, s: 18 },
  D: { h: 28, s: 22 },
};

const classic = (group: Exclude<ClassicGroup, 'bleach'>, steps: string[]): Shade[] =>
  steps.map((step) => {
    const n = Number.parseFloat(step);
    const { h, s } = CLASSIC_HUE[group];
    return { code: `${group}${step}`, color: hsl(h, s + n * 4, 88 - n * 5) };
  });

export const CLASSIC_SHADES: { group: ClassicGroup; shades: Shade[] }[] = [
  { group: 'bleach', shades: ['BL1', 'BL2', 'BL3', 'BL4'].map((code, i) => ({ code, color: hsl(45, 20, 96 - i * 1.5) })) },
  { group: 'A', shades: classic('A', ['1', '2', '3', '3.5', '4']) },
  { group: 'B', shades: classic('B', ['1', '2', '3', '4']) },
  { group: 'C', shades: classic('C', ['1', '2', '3', '4']) },
  { group: 'D', shades: classic('D', ['2', '3', '4']) },
];

/** 3D-Master: lightness level 0–5, then hue L (yellowish), M (middle), R (reddish) and chroma. */
const LEVELS: Record<number, string[]> = {
  0: ['0M1', '0M2', '0M3'],
  1: ['1M1', '1M2'],
  2: ['2L1.5', '2L2.5', '2M1', '2M2', '2M3', '2R1.5', '2R2.5'],
  3: ['3L1.5', '3L2.5', '3M1', '3M2', '3M3', '3R1.5', '3R2.5'],
  4: ['4L1.5', '4L2.5', '4M1', '4M2', '4M3', '4R1.5', '4R2.5'],
  5: ['5M1', '5M2', '5M3'],
};

function threeDColor(code: string): string {
  const level = Number(code[0]);
  const hue = code[1] === 'L' ? 50 : code[1] === 'R' ? 30 : 40;
  const chroma = Number.parseFloat(code.slice(2));
  return hsl(hue, 18 + chroma * 14, 93 - level * 5 - chroma * 2);
}

export const THREE_D_SHADES: { level: number; shades: Shade[] }[] = Object.entries(LEVELS).map(([level, codes]) => ({
  level: Number(level),
  shades: codes.map((code) => ({ code, color: threeDColor(code) })),
}));

const ALL = new Map(
  [...CLASSIC_SHADES.flatMap((g) => g.shades), ...THREE_D_SHADES.flatMap((g) => g.shades)].map((s) => [s.code, s.color]),
);

/** Display colour of a known code; null for free text the guide does not know. */
export const shadeColor = (code: string | null | undefined): string | null => (code ? (ALL.get(code) ?? null) : null);

export const isThreeD = (code: string | null | undefined): boolean => !!code && /^\d/.test(code);
