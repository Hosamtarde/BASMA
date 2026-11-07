import { LOWER_ROW, toothInfo, UPPER_ROW } from '@app/shared';
import type { Arch, ToothKind } from '@app/shared';

/**
 * Parametric geometry of the tooth chart (SPEC §1.1), in abstract units close to millimetres.
 * Pure: the same input always gives the same paths, so the artwork, hotspot and badge layers
 * share one layout and the artwork can later be swapped for licensed drawings without touching
 * the other two layers. 18 is always on the viewer's left.
 *
 * - mouth: two U-shaped arches seen from below (occlusal view), teeth placed by arc length on a
 *   quarter ellipse per side, sized from typical crown dimensions.
 * - rows: two straight rows seen from the front, crowns with roots.
 */
export type ChartView = 'mouth' | 'rows';

export interface Pt {
  x: number;
  y: number;
}

export interface ToothShape {
  no: number;
  arch: Arch;
  /** Crown outline (occlusal in the mouth view, labial in the rows view). */
  crown: string;
  /** Roots (rows view only). */
  roots: string | null;
  /** Grooves, ridges and edges for the artwork layer. */
  details: string;
  /** Hit area of the hotspot: crown and roots. */
  hit: string;
  center: Pt;
  /** The badge starts at this point and moves out along badgeDir by its radius. */
  badgeAnchor: Pt;
  badgeDir: Pt;
}

export interface ChartLayout {
  view: ChartView;
  viewBox: { x: number; y: number; w: number; h: number };
  teeth: ToothShape[];
  /** Gum: centre lines drawn with a wide round stroke (mouth) or filled bands (rows). */
  gum: { d: string; width: number | null }[];
  midline: [Pt, Pt][];
  labels: {
    patientRight: Pt;
    patientLeft: Pt;
    upper: Pt | null;
    lower: Pt | null;
    size: number;
  };
  /** Natural badge radius, and the largest one before neighbouring badges would touch. */
  baseBadgeR: number;
  maxBadgeR: number;
}

/** Typical permanent crown sizes (mm): mesio-distal width, bucco-lingual depth, height; root length. */
interface Dim {
  w: number;
  d: number;
  h: number;
  root: number;
}
const DIMS: Record<Arch, Dim[]> = {
  upper: [
    { w: 8.6, d: 7.0, h: 10.5, root: 13 },
    { w: 6.6, d: 6.2, h: 9.0, root: 13 },
    { w: 7.6, d: 8.0, h: 10.0, root: 17 },
    { w: 7.0, d: 9.0, h: 8.5, root: 14 },
    { w: 6.6, d: 9.0, h: 8.0, root: 14 },
    { w: 10.2, d: 11.0, h: 7.5, root: 13 },
    { w: 9.2, d: 11.0, h: 7.0, root: 12 },
    { w: 8.6, d: 10.2, h: 6.5, root: 11 },
  ],
  lower: [
    { w: 5.2, d: 6.0, h: 9.0, root: 12.5 },
    { w: 5.8, d: 6.2, h: 9.5, root: 14 },
    { w: 6.9, d: 7.6, h: 11.0, root: 16 },
    { w: 7.0, d: 7.6, h: 8.5, root: 14 },
    { w: 7.1, d: 8.0, h: 8.0, root: 14.5 },
    { w: 11.0, d: 10.4, h: 7.5, root: 14 },
    { w: 10.4, d: 10.0, h: 7.0, root: 13 },
    { w: 10.0, d: 9.4, h: 6.5, root: 11 },
  ],
};
const dimOf = (no: number): Dim => {
  const t = toothInfo(no);
  return DIMS[t.arch][t.position - 1] as Dim;
};

const isIncisor = (k: ToothKind) => k === 'centralIncisor' || k === 'lateralIncisor';
const isPremolar = (k: ToothKind) => k === 'firstPremolar' || k === 'secondPremolar';
const isMolar = (k: ToothKind) => k === 'firstMolar' || k === 'secondMolar' || k === 'thirdMolar';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A tiny path builder in a tooth's local frame, mapped to chart coordinates by an affine frame. */
type Cmd = ['M' | 'L', number, number] | ['Q', number, number, number, number] | [
  'C',
  number,
  number,
  number,
  number,
  number,
  number,
] | ['Z'];

interface Frame {
  o: Pt;
  u: Pt;
  v: Pt;
}
const map = (f: Frame, x: number, y: number): Pt => ({
  x: f.o.x + f.u.x * x + f.v.x * y,
  y: f.o.y + f.u.y * x + f.v.y * y,
});

function path(f: Frame, cmds: Cmd[], collect?: Pt[]): string {
  const out: string[] = [];
  for (const c of cmds) {
    if (c[0] === 'Z') {
      out.push('Z');
      continue;
    }
    const [op, ...nums] = c;
    const pts: string[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      const p = map(f, nums[i] as number, nums[i + 1] as number);
      collect?.push(p);
      pts.push(`${r2(p.x)},${r2(p.y)}`);
    }
    out.push(`${op}${pts.join(' ')}`);
  }
  return out.join(' ');
}

// ───────────────────────────── mouth view ─────────────────────────────

const GAP = 0.35;
const BASE_BADGE_R = 2.4;
const BADGE_LIMIT = 4.6;
const BADGE_GAP = 0.9;

/** Occlusal outline: a superellipse, narrower on the lingual side for incisors and canines. */
function occlusal(kind: ToothKind, w: number, d: number): Cmd[] {
  const n = isIncisor(kind) ? 2.3 : kind === 'canine' ? 2.2 : isPremolar(kind) ? 2.6 : 3.1;
  const taper = isIncisor(kind) ? 0.38 : kind === 'canine' ? 0.28 : isPremolar(kind) ? 0.1 : 0.05;
  const cmds: Cmd[] = [];
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x = (w / 2) * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = (d / 2) * Math.sign(s) * Math.abs(s) ** (2 / n);
    if (y < 0) x *= 1 - taper * (-y / (d / 2));
    cmds.push([i === 0 ? 'M' : 'L', x, y]);
  }
  cmds.push(['Z']);
  return cmds;
}

/** Occlusal anatomy for the artwork: incisal edges, cusp ridges, fissures. +y = buccal. */
function occlusalDetails(kind: ToothKind, w: number, d: number): Cmd[] {
  if (isIncisor(kind)) return [['M', -0.36 * w, 0.1 * d], ['Q', 0, 0.24 * d, 0.36 * w, 0.1 * d]];
  if (kind === 'canine')
    return [
      ['M', -0.34 * w, 0.02 * d],
      ['L', 0, 0.2 * d],
      ['L', 0.34 * w, 0.02 * d],
      ['M', 0, 0.2 * d],
      ['L', 0, -0.22 * d],
    ];
  if (isPremolar(kind))
    return [
      ['M', -0.3 * w, 0],
      ['Q', 0, 0.08 * d, 0.3 * w, 0],
    ];
  return [
    ['M', -0.36 * w, 0.02 * d],
    ['L', -0.1 * w, -0.06 * d],
    ['L', 0.1 * w, 0.06 * d],
    ['L', 0.36 * w, -0.02 * d],
    ['M', -0.02 * w, 0.02 * d],
    ['L', 0, 0.4 * d],
    ['M', 0.06 * w, -0.04 * d],
    ['L', 0.14 * w, -0.38 * d],
  ];
}

interface ArcTable {
  a: number;
  b: number;
  theta: number[];
  len: number[];
}

/** Arc-length table of x = a·sinθ, y = b·(1 − cosθ) for θ in [0, π/2]. */
function arcTable(a: number, b: number, n = 600): ArcTable {
  const theta: number[] = [0];
  const len: number[] = [0];
  let px = 0;
  let py = 0;
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    const x = a * Math.sin(t);
    const y = b * (1 - Math.cos(t));
    len.push((len[i - 1] as number) + Math.hypot(x - px, y - py));
    theta.push(t);
    px = x;
    py = y;
  }
  return { a, b, theta, len };
}

function thetaAt(table: ArcTable, s: number): number {
  const { len, theta } = table;
  let lo = 0;
  let hi = len.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((len[mid] as number) < s) lo = mid;
    else hi = mid;
  }
  const l0 = len[lo] as number;
  const l1 = len[hi] as number;
  const k = l1 === l0 ? 0 : (s - l0) / (l1 - l0);
  return (theta[lo] as number) + k * ((theta[hi] as number) - (theta[lo] as number));
}

/** Depth b of the ellipse whose quarter is `length` long for half-width a (bisection). */
function depthFor(a: number, length: number): number {
  let lo = a * 0.5;
  let hi = a * 6;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const t = arcTable(a, mid, 200);
    if ((t.len[t.len.length - 1] as number) < length) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** One arch, front at y = 0: the upper opens downward, the lower opens upward. */
function mouthArch(arch: Arch, halfWidth: number): { teeth: ToothShape[]; gum: string; gumWidth: number } {
  const dims = DIMS[arch];
  const needed = dims.reduce((s, d) => s + d.w + GAP, GAP / 2) + 1;
  const table = arcTable(halfWidth, depthFor(halfWidth, needed));
  const { a, b } = table;
  const ySign = arch === 'upper' ? 1 : -1;
  const teeth: ToothShape[] = [];
  const row = arch === 'upper' ? UPPER_ROW : LOWER_ROW;

  for (const no of row) {
    const info = toothInfo(no);
    const dim = dimOf(no);
    // Viewer's left half: the patient's right (quadrants 1 and 4).
    const xSign = info.side === 'right' ? -1 : 1;
    const before = dims.slice(0, info.position - 1).reduce((s, d) => s + d.w + GAP, GAP / 2);
    const t = thetaAt(table, before + dim.w / 2);
    const o = { x: xSign * a * Math.sin(t), y: ySign * b * (1 - Math.cos(t)) };
    const tl = Math.hypot(a * Math.cos(t), b * Math.sin(t));
    const u = { x: (xSign * a * Math.cos(t)) / tl, y: (ySign * b * Math.sin(t)) / tl };
    const nl = Math.hypot(b * Math.sin(t), a * Math.cos(t));
    const v = { x: (xSign * b * Math.sin(t)) / nl, y: (-ySign * a * Math.cos(t)) / nl };
    const frame = { o, u, v };
    const crown = path(frame, occlusal(info.kind, dim.w, dim.d));
    teeth.push({
      no,
      arch,
      crown,
      roots: null,
      details: path(frame, occlusalDetails(info.kind, dim.w, dim.d)),
      hit: crown,
      center: { x: r2(o.x), y: r2(o.y) },
      badgeAnchor: map(frame, 0, dim.d / 2 + BADGE_GAP),
      badgeDir: v,
    });
  }

  // Gum: the arch centre line, both sides, drawn with a wide round stroke.
  const pts: string[] = [];
  const last = table.theta.length - 1;
  for (let i = last; i >= 0; i -= 12) pts.push(`${r2(-a * Math.sin(table.theta[i] as number))},${r2(ySign * b * (1 - Math.cos(table.theta[i] as number)))}`);
  for (let i = 0; i <= last; i += 12) pts.push(`${r2(a * Math.sin(table.theta[i] as number))},${r2(ySign * b * (1 - Math.cos(table.theta[i] as number)))}`);
  const gumWidth = Math.max(...dims.map((d) => d.d)) * 1.3;
  return { teeth, gum: `M${pts.join(' L')}`, gumWidth };
}

function translateShape(s: ToothShape, dy: number): ToothShape {
  const shift = (d: string) =>
    d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${x},${r2(Number(y) + dy)}`);
  return {
    ...s,
    crown: shift(s.crown),
    details: shift(s.details),
    hit: shift(s.hit),
    roots: s.roots === null ? null : shift(s.roots),
    center: { x: s.center.x, y: r2(s.center.y + dy) },
    badgeAnchor: { x: s.badgeAnchor.x, y: s.badgeAnchor.y + dy },
  };
}

const pointsOf = (d: string): Pt[] =>
  [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

const badgeAt = (t: ToothShape, r: number): Pt => ({
  x: t.badgeAnchor.x + t.badgeDir.x * r,
  y: t.badgeAnchor.y + t.badgeDir.y * r,
});

/** Largest radius (≤ limit) at which neighbouring badges of each row keep a small gap. */
function maxRadius(teeth: ToothShape[], limit: number): number {
  const rows = [UPPER_ROW, LOWER_ROW].map((row) => row.map((no) => teeth.find((t) => t.no === no) as ToothShape));
  for (let r = limit; r > 1; r -= 0.05) {
    const fits = rows.every((row) =>
      row.every((t, i) => {
        const next = row[i + 1];
        if (!next) return true;
        const a = badgeAt(t, r);
        const b = badgeAt(next, r);
        return Math.hypot(a.x - b.x, a.y - b.y) >= 2 * r + 0.25;
      }),
    );
    if (fits) return r2(r);
  }
  return 1;
}

function bounds(points: Pt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function mouthLayout(): ChartLayout {
  const upper = mouthArch('upper', 31);
  const lowerRaw = mouthArch('lower', 28.5);
  const upperBox = bounds(upper.teeth.flatMap((t) => pointsOf(t.crown)));
  const lowerBox = bounds(lowerRaw.teeth.flatMap((t) => pointsOf(t.crown)));
  const ARCH_GAP = 9;
  const dy = upperBox.maxY + ARCH_GAP - lowerBox.minY;
  const lower = lowerRaw.teeth.map((t) => translateShape(t, dy));
  const teeth = [...upper.teeth, ...lower];
  const maxBadgeR = maxRadius(teeth, BADGE_LIMIT);

  const labelSize = 3.6;
  const box = bounds([
    ...teeth.flatMap((t) => pointsOf(t.crown)),
    ...teeth.flatMap((t) => {
      const c = badgeAt(t, maxBadgeR);
      return [
        { x: c.x - maxBadgeR, y: c.y - maxBadgeR },
        { x: c.x + maxBadgeR, y: c.y + maxBadgeR },
      ];
    }),
  ]);
  const margin = 1.5;
  const top = box.minY - labelSize * 1.6;
  return {
    view: 'mouth',
    viewBox: {
      x: r2(box.minX - margin),
      y: r2(top - margin),
      w: r2(box.maxX - box.minX + margin * 2),
      h: r2(box.maxY - top + margin * 2),
    },
    teeth,
    gum: [
      { d: upper.gum, width: upper.gumWidth },
      {
        d: lowerRaw.gum.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${x},${r2(Number(y) + dy)}`),
        width: lowerRaw.gumWidth,
      },
    ],
    midline: [
      [
        { x: 0, y: 6 },
        { x: 0, y: upperBox.maxY - 4 },
      ],
      [
        { x: 0, y: lowerBox.minY + dy + 4 },
        { x: 0, y: dy - 6 },
      ],
    ],
    labels: {
      patientRight: { x: box.minX, y: top + labelSize * 0.4 },
      patientLeft: { x: box.maxX, y: top + labelSize * 0.4 },
      upper: { x: 0, y: upperBox.maxY * 0.42 },
      lower: { x: 0, y: dy - (dy - (lowerBox.minY + dy)) * 0.42 },
      size: labelSize,
    },
    baseBadgeR: BASE_BADGE_R,
    maxBadgeR,
  };
}

// ───────────────────────────── rows view ─────────────────────────────

const ROW_GAP = 0.5;
/** Roots drawn shorter than life so the two rows stay low and the chart can be drawn larger. */
const ROOT_SCALE = 0.62;
/** Badges tuck slightly over the incisal edge, as in the approved mockup. */
const ROWS_BADGE_GAP = -1.1;

/** Labial crown outline, local frame: origin at the cervical centre, +y towards the incisal edge. */
function labialCrown(kind: ToothKind, w: number, h: number): Cmd[] {
  const cw = 0.36 * w;
  const side = (sx: number): Cmd[] =>
    sx < 0
      ? [['C', -0.5 * w, 0.22 * h, -0.5 * w, 0.55 * h, -0.48 * w, 0.82 * h]]
      : [['C', 0.5 * w, 0.55 * h, 0.5 * w, 0.22 * h, cw, 0]];
  let edge: Cmd[];
  if (isIncisor(kind)) {
    edge = [
      ['Q', -0.47 * w, h, -0.34 * w, h],
      ['L', 0.34 * w, h],
      ['Q', 0.47 * w, h, 0.48 * w, 0.82 * h],
    ];
  } else if (kind === 'canine' || isPremolar(kind)) {
    const shoulder = kind === 'canine' ? 0.72 : 0.8;
    edge = [
      ['Q', -0.44 * w, shoulder * h + 0.08 * h, -0.2 * w, 0.93 * h],
      ['Q', 0, h * 1.02, 0.2 * w, 0.93 * h],
      ['Q', 0.44 * w, shoulder * h + 0.08 * h, 0.48 * w, 0.82 * h],
    ];
  } else {
    edge = [
      ['Q', -0.42 * w, h, -0.24 * w, h],
      ['Q', -0.06 * w, h, 0, 0.9 * h],
      ['Q', 0.06 * w, h, 0.24 * w, h],
      ['Q', 0.42 * w, h, 0.48 * w, 0.82 * h],
    ];
  }
  return [['M', -cw, 0], ...side(-1), ...edge, ...side(1), ['Q', 0, -0.1 * h, -cw, 0], ['Z']];
}

function labialDetails(kind: ToothKind, w: number, h: number): Cmd[] {
  if (isIncisor(kind)) return [['M', -0.28 * w, 0.86 * h], ['L', 0.28 * w, 0.86 * h]];
  if (isMolar(kind)) return [['M', 0, 0.88 * h], ['L', 0, 0.45 * h]];
  return [['M', 0, 0.95 * h], ['L', 0, 0.42 * h]];
}

/** Roots towards −y: one root, or two with a furcation (molars, upper first premolar). */
function rootsPath(no: number, w: number, len: number): Cmd[] {
  const info = toothInfo(no);
  const cw = 0.36 * w;
  const two = isMolar(info.kind) || (info.arch === 'upper' && info.kind === 'firstPremolar');
  if (!two) {
    return [
      ['M', -cw * 0.96, 0],
      ['C', -cw * 0.9, -0.5 * len, -0.16 * w, -0.92 * len, 0, -len],
      ['C', 0.16 * w, -0.92 * len, cw * 0.9, -0.5 * len, cw * 0.96, 0],
      ['Z'],
    ];
  }
  return [
    ['M', -cw, 0],
    ['C', -cw, -0.5 * len, -0.32 * w, -0.9 * len, -0.22 * w, -len],
    ['C', -0.14 * w, -0.9 * len, -0.08 * w, -0.5 * len, 0, -0.32 * len],
    ['C', 0.08 * w, -0.5 * len, 0.14 * w, -0.88 * len, 0.22 * w, -0.95 * len],
    ['C', 0.32 * w, -0.88 * len, cw, -0.5 * len, cw, 0],
    ['Z'],
  ];
}

function rowsLayout(): ChartLayout {
  const maxR = 3.2;
  const upperRoot = Math.max(...DIMS.upper.map((d) => d.root)) * ROOT_SCALE;
  const upperH = Math.max(...DIMS.upper.map((d) => d.h));
  const lowerH = Math.max(...DIMS.lower.map((d) => d.h));
  const g1 = 0; // upper gum line
  const mid = g1 + upperH + ROWS_BADGE_GAP + 2 * maxR + 1.6 + 2 * maxR + ROWS_BADGE_GAP;
  const g2 = mid + lowerH; // lower gum line
  const teeth: ToothShape[] = [];
  let gumUpper = { min: 0, max: 0 };
  let gumLower = { min: 0, max: 0 };

  for (const [arch, row] of [
    ['upper', UPPER_ROW],
    ['lower', LOWER_ROW],
  ] as const) {
    const dims = row.map(dimOf);
    const leftHalf = dims.slice(0, 8).reduce((s, d) => s + d.w + ROW_GAP, 0);
    let x = -leftHalf + ROW_GAP / 2;
    const gumY = arch === 'upper' ? g1 : g2;
    const s = arch === 'upper' ? 1 : -1;
    row.forEach((no, i) => {
      const dim = dims[i] as Dim;
      const info = toothInfo(no);
      const cx = x + dim.w / 2;
      const frame = { o: { x: cx, y: gumY }, u: { x: 1, y: 0 }, v: { x: 0, y: s } };
      const crown = path(frame, labialCrown(info.kind, dim.w, dim.h));
      const roots = path(frame, rootsPath(no, dim.w, dim.root * ROOT_SCALE));
      teeth.push({
        no,
        arch,
        crown,
        roots,
        details: path(frame, labialDetails(info.kind, dim.w, dim.h)),
        hit: `${crown} ${roots}`,
        center: { x: r2(cx), y: r2(gumY + (s * dim.h) / 2) },
        badgeAnchor: { x: cx, y: gumY + s * (dim.h + ROWS_BADGE_GAP) },
        badgeDir: { x: 0, y: s },
      });
      x += dim.w + ROW_GAP;
    });
    const span = { min: -leftHalf, max: x - ROW_GAP / 2 };
    if (arch === 'upper') gumUpper = span;
    else gumLower = span;
  }

  const band = (y0: number, y1: number, span: { min: number; max: number }) =>
    `M${r2(span.min)},${r2(y0)} H${r2(span.max)} V${r2(y1)} H${r2(span.min)} Z`;
  const maxBadgeR = Math.min(maxRadius(teeth, maxR), maxR);
  const lowerRoot = Math.max(...DIMS.lower.map((d) => d.root)) * ROOT_SCALE;
  const labelSize = 3.8;
  const minX = Math.min(gumUpper.min, gumLower.min);
  const maxX = Math.max(gumUpper.max, gumLower.max);
  const top = g1 - upperRoot - labelSize * 1.7;
  const bottom = g2 + lowerRoot;
  const margin = 1.5;
  return {
    view: 'rows',
    viewBox: { x: r2(minX - margin), y: r2(top - margin), w: r2(maxX - minX + 2 * margin), h: r2(bottom - top + 2 * margin) },
    teeth,
    gum: [
      { d: band(g1 - 5, g1 + 1.4, gumUpper), width: null },
      { d: band(g2 - 1.4, g2 + 5, gumLower), width: null },
    ],
    midline: [
      [
        { x: 0, y: top + labelSize * 1.2 },
        { x: 0, y: bottom },
      ],
    ],
    labels: {
      patientRight: { x: minX, y: top + labelSize * 0.5 },
      patientLeft: { x: maxX, y: top + labelSize * 0.5 },
      upper: null,
      lower: null,
      size: labelSize,
    },
    baseBadgeR: BASE_BADGE_R,
    maxBadgeR,
  };
}

const cache = new Map<ChartView, ChartLayout>();

export function chartLayout(view: ChartView): ChartLayout {
  let layout = cache.get(view);
  if (!layout) {
    layout = view === 'mouth' ? mouthLayout() : rowsLayout();
    cache.set(view, layout);
  }
  return layout;
}

export const badgeCenter = badgeAt;

/**
 * Badge radius (chart units) for a chart drawn at `pxPerUnit`: at least `targetPx` across (16 px,
 * 14 px on very short screens), never smaller than the natural size, and never so big that
 * neighbouring badges touch.
 */
export function badgeRadius(layout: ChartLayout, pxPerUnit: number, targetPx: number): number {
  if (!(pxPerUnit > 0)) return layout.baseBadgeR;
  const wanted = targetPx / 2 / pxPerUnit;
  return Math.min(Math.max(layout.baseBadgeR, wanted), layout.maxBadgeR);
}
