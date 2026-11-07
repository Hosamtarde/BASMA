import { ALL_TEETH, LOWER_ROW, sortTeeth, teethOfArch, teethOfQuadrant, UPPER_ROW } from '@app/shared';
import type { Arch, Quadrant } from '@app/shared';

/** Selected FDI teeth, always unique and in chart order (upper row left→right, then lower). */
export type Selection = readonly number[];

export type SelectionAction =
  | { type: 'toggle'; tooth: number }
  | { type: 'remove'; tooth: number }
  | { type: 'clear' }
  | { type: 'all' }
  /** Adds the quadrant; if it is already fully selected, removes it (the button toggles). */
  | { type: 'quadrant'; quadrant: Quadrant }
  | { type: 'arch'; arch: Arch }
  | { type: 'set'; teeth: readonly number[] };

function toggleGroup(state: Selection, group: readonly number[]): Selection {
  const current = new Set(state);
  const full = group.every((t) => current.has(t));
  return full ? state.filter((t) => !group.includes(t)) : sortTeeth([...state, ...group]);
}

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'toggle':
      return state.includes(action.tooth)
        ? state.filter((t) => t !== action.tooth)
        : sortTeeth([...state, action.tooth]);
    case 'remove':
      return state.filter((t) => t !== action.tooth);
    case 'clear':
      return [];
    case 'all':
      return [...ALL_TEETH];
    case 'quadrant':
      return toggleGroup(state, teethOfQuadrant(action.quadrant));
    case 'arch':
      return toggleGroup(state, teethOfArch(action.arch));
    case 'set':
      return sortTeeth(action.teeth);
  }
}

export const isQuadrantSelected = (state: Selection, q: Quadrant): boolean =>
  teethOfQuadrant(q).every((t) => state.includes(t));

/**
 * Roving focus inside the chart. The geometry is anatomical and fixed (18 on the viewer's left in
 * both languages), so the arrows follow what the eye sees: ←/→ along the row, ↑/↓ to the facing
 * tooth of the other arch, Home/End to the ends of the row. Returns null for other keys.
 */
export function moveFocus(current: number, key: string): number | null {
  const upper = UPPER_ROW.includes(current);
  const row = upper ? UPPER_ROW : LOWER_ROW;
  const i = row.indexOf(current);
  if (i < 0) return null;
  switch (key) {
    case 'ArrowRight':
      return row[Math.min(i + 1, row.length - 1)] ?? current;
    case 'ArrowLeft':
      return row[Math.max(i - 1, 0)] ?? current;
    case 'ArrowUp':
      return upper ? current : (UPPER_ROW[i] ?? current);
    case 'ArrowDown':
      return upper ? (LOWER_ROW[i] ?? current) : current;
    case 'Home':
      return row[0] ?? current;
    case 'End':
      return row[row.length - 1] ?? current;
    default:
      return null;
  }
}
