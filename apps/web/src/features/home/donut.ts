/** One arc of the status donut: where it starts and how long it is along the ring. */
export interface DonutArc<K extends string> {
  key: K;
  count: number;
  /** Arc length along the circumference. */
  length: number;
  /** Distance from the start of the ring (12 o'clock) to the start of this arc. */
  start: number;
}

/**
 * Splits a ring of the given circumference into arcs proportional to the counts, in the given
 * order. Zero counts get no arc; the arcs always add up to the whole ring (or nothing when the
 * total is zero), so rounding never leaves a gap at the end.
 */
export function donutArcs<K extends string>(
  entries: readonly { key: K; count: number }[],
  circumference: number,
): DonutArc<K>[] {
  const total = entries.reduce((sum, e) => sum + Math.max(0, e.count), 0);
  if (total === 0) return [];
  const arcs: DonutArc<K>[] = [];
  let seen = 0;
  for (const e of entries) {
    if (e.count <= 0) continue;
    const start = (seen / total) * circumference;
    seen += e.count;
    const end = (seen / total) * circumference;
    arcs.push({ key: e.key, count: e.count, start, length: end - start });
  }
  return arcs;
}

/**
 * Opens a thin gap between neighbouring arcs (direction A's refined ring). Each arc gives up at
 * most half of its length, so a very small status stays visible as a sliver. One arc (or none)
 * is returned unchanged: a full ring needs no gap.
 */
export function withGaps<K extends string>(arcs: readonly DonutArc<K>[], gap: number): DonutArc<K>[] {
  if (arcs.length < 2) return [...arcs];
  return arcs.map((a) => {
    const g = Math.min(gap, a.length / 2);
    return { ...a, start: a.start + g / 2, length: a.length - g };
  });
}
